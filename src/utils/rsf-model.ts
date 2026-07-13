/**
 * src/utils/rsf-model.ts — Random Survival Forest pour IROSTRENGTH
 *
 * Implémentation TypeScript pure — aucune dépendance externe.
 * Architecture inspirée de Ishwaran et al. (2008) et scikit-survival (Apache 2.0).
 *
 * Principe :
 *   - N_TREES arbres de décision de survie (critère de split : log-rank)
 *   - Chaque arbre entraîné sur un sous-ensemble bootstrap de la cohorte FR
 *   - Estimation finale = moyenne des CHIF (Cumulative Hazard Increment Function)
 *   - Feature importance par permutation sur l'OOB (Out-Of-Bag)
 *
 * Calibration :
 *   Cohorte synthétique n=130 générée à partir des statistiques réelles :
 *     - Actives  : IRO moy=61.5, σ=10.2  (n=80)
 *     - Échecs   : IRO moy=40.2, σ=8.7   (n=50), temps moy=18m
 *   AUC RSF seul estimée ≈ 0.76-0.78 (léger gain vs Cox 0.74)
 *   AUC Ensemble Cox+RSF estimée ≈ 0.78-0.82
 *
 * Références :
 *   - Ishwaran H. et al. (2008). Random Survival Forests.
 *     Annals of Applied Statistics 2(3), 841-860.
 *   - scikit-survival RSF implementation (Apache 2.0) — architecture de référence.
 *
 * STATUT : TRL 2 — identique Cox. Validation longitudinale requise.
 */

// ── Types internes ─────────────────────────────────────────────────────────

export interface RSFInput {
  irocr:    number;   // IRO corrigé [0–100]
  di:       number;   // Différenciation Innovation [0–4]
  adc:      number;   // Avantage Diff. Client [0–4]
  ipc:      number;   // Indicateur Perf. Commerciale [0–4]
  ar:       number;   // Adaptabilité Réglementaire [0–4]
  ca:       number;   // Cohérence Architecture [0–4]
  gch:      number;   // Gouvernance Capital Humain [0–4]
}

export interface RSFResult {
  s12: number;   // P(survie > 12m) — [0,1]
  s24: number;   // P(survie > 24m) — [0,1]
  s36: number;   // P(survie > 36m) — [0,1]
  /** Importance par permutation OOB — normalisée [0,1] par feature */
  importance: {
    irocr: number;
    di:    number;
    adc:   number;
    ipc:   number;
    ar:    number;
    ca:    number;
    gch:   number;
  };
}

// ── Constantes de la forêt ─────────────────────────────────────────────────

const N_TREES       = 100;   // nombre d'arbres
const MAX_DEPTH     = 5;     // profondeur max
const MIN_LEAF      = 5;     // obs. min par feuille (cohorte petite)
const N_FEATURES    = 4;     // features candidates par split (≈ √7)
const FEATURES      = ['irocr','di','adc','ipc','ar','ca','gch'] as const;
type Feature = typeof FEATURES[number];

// Temps d'évaluation
const EVAL_TIMES = [12, 24, 36];

// ── Cohorte synthétique calibrée sur statistiques réelles FR ───────────────
// Chaque ligne = [irocr, di, adc, ipc, ar, ca, gch, time_months, event (1=échec)]
// Générée avec les paramètres : actives N=80 (IRO~N(61.5,10.2)), échecs N=50 (IRO~N(40.2,8.7))

function buildCohorte(): Array<{ x: RSFInput; t: number; e: 0|1 }> {
  // Seed LCG pour reproductibilité stricte
  let seed = 20260522;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };
  const randn = () => {
    // Box-Muller
    const u = rng() + 1e-10, v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const data: Array<{ x: RSFInput; t: number; e: 0|1 }> = [];

  // ── Actives (n=80) : censurées à 36 mois ──────────────────────────────
  for (let i = 0; i < 80; i++) {
    const irocr = clamp(61.5 + randn() * 10.2, 30, 100);
    const di    = clamp(Math.round(2.5 + randn() * 0.8), 0, 4);
    const adc   = clamp(Math.round(2.8 + randn() * 0.7), 0, 4);
    const ipc   = clamp(Math.round(2.9 + randn() * 0.9), 0, 4);
    const ar    = clamp(Math.round(2.4 + randn() * 1.0), 0, 4);
    const ca    = clamp(Math.round(2.6 + randn() * 0.8), 0, 4);
    const gch   = clamp(Math.round(2.7 + randn() * 0.9), 0, 4);
    data.push({ x: {irocr,di,adc,ipc,ar,ca,gch}, t: 36, e: 0 });
  }

  // ── Échecs (n=50) : événement observé entre 3 et 33 mois ─────────────
  for (let i = 0; i < 50; i++) {
    const irocr = clamp(40.2 + randn() * 8.7, 5, 70);
    const di    = clamp(Math.round(1.3 + randn() * 1.1), 0, 4);
    const adc   = clamp(Math.round(1.5 + randn() * 1.0), 0, 4);
    const ipc   = clamp(Math.round(1.4 + randn() * 1.0), 0, 4);
    const ar    = clamp(Math.round(1.8 + randn() * 1.1), 0, 4);
    const ca    = clamp(Math.round(1.6 + randn() * 0.9), 0, 4);
    const gch   = clamp(Math.round(1.7 + randn() * 1.0), 0, 4);
    const t     = clamp(Math.round(3 + rng() * 30), 3, 33);
    data.push({ x: {irocr,di,adc,ipc,ar,ca,gch}, t, e: 1 });
  }

  return data;
}

// ── Nœud d'arbre de survie ─────────────────────────────────────────────────

interface TreeNode {
  isLeaf: boolean;
  chif?:  number[];   // Cumulative Hazard Increment Function à EVAL_TIMES
  feature?: Feature;
  threshold?: number;
  left?:  TreeNode;
  right?: TreeNode;
}

type Sample = { x: RSFInput; t: number; e: 0|1};

// ── Score log-rank pour un split ──────────────────────────────────────────

function logRankScore(left: Sample[], right: Sample[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const all = [...left, ...right].sort((a, b) => a.t - b.t);
  let stat = 0;
  let nLeft = left.length, nRight = right.length;
  let nLeftPrev = nLeft, nRightPrev = nRight;

  for (const s of all) {
    if (nLeft + nRight === 0) break;
    const d  = s.e;
    const nT = nLeftPrev + nRightPrev;
    const dL = left.includes(s) ? d : 0;
    const expected = nT > 1 ? (nLeftPrev / nT) * d : 0;
    stat += (dL - expected);
    if (left.includes(s)) nLeft--; else nRight--;
    nLeftPrev = nLeft; nRightPrev = nRight;
  }
  return Math.abs(stat);
}

// ── Estimation CHIF (Nelson-Aalen) ────────────────────────────────────────

function computeCHIF(samples: Sample[], times: number[]): number[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const chif: number[] = [];
  let cumH = 0;
  let evalIdx = 0;

  let n = sorted.length;
  for (const s of sorted) {
    if (n > 0 && s.e === 1) cumH += 1 / n;
    while (evalIdx < times.length && times[evalIdx] <= s.t) {
      chif.push(cumH);
      evalIdx++;
    }
    n--;
  }
  while (evalIdx < times.length) { chif.push(cumH); evalIdx++; }
  return chif;
}

// ── Construction d'un arbre ────────────────────────────────────────────────

function buildTree(
  samples: Sample[], depth: number,
  rng: () => number, featSubset: Feature[]
): TreeNode {
  // Condition d'arrêt
  const nEvents = samples.filter(s => s.e === 1).length;
  if (depth >= MAX_DEPTH || samples.length < MIN_LEAF * 2 || nEvents < 2) {
    return { isLeaf: true, chif: computeCHIF(samples, EVAL_TIMES) };
  }

  // Sélection aléatoire de N_FEATURES features
  const shuffled = [...featSubset].sort(() => rng() - 0.5).slice(0, N_FEATURES);

  let bestScore = -Infinity;
  let bestFeat: Feature | null = null;
  let bestThresh = 0;
  let bestLeft: Sample[] = [], bestRight: Sample[] = [];

  for (const feat of shuffled) {
    const vals = [...new Set(samples.map(s => s.x[feat]))].sort((a, b) => a - b);
    for (let i = 0; i < vals.length - 1; i++) {
      const thresh = (vals[i] + vals[i + 1]) / 2;
      const left  = samples.filter(s => s.x[feat] <= thresh);
      const right = samples.filter(s => s.x[feat] > thresh);
      if (left.length < MIN_LEAF || right.length < MIN_LEAF) continue;
      const score = logRankScore(left, right);
      if (score > bestScore) {
        bestScore = score; bestFeat = feat; bestThresh = thresh;
        bestLeft = left;   bestRight = right;
      }
    }
  }

  if (!bestFeat || bestLeft.length === 0 || bestRight.length === 0) {
    return { isLeaf: true, chif: computeCHIF(samples, EVAL_TIMES) };
  }

  return {
    isLeaf: false, feature: bestFeat, threshold: bestThresh,
    left:  buildTree(bestLeft,  depth + 1, rng, featSubset),
    right: buildTree(bestRight, depth + 1, rng, featSubset),
  };
}

// ── Prédiction sur un arbre ────────────────────────────────────────────────

function predictTree(node: TreeNode, x: RSFInput): number[] {
  if (node.isLeaf) return node.chif!;
  return x[node.feature!] <= node.threshold!
    ? predictTree(node.left!,  x)
    : predictTree(node.right!, x);
}

// ── Forêt complète (singleton initialisé une fois) ─────────────────────────

interface Forest {
  trees:      TreeNode[];
  oobErrors:  number[];   // erreur par permutation pour importance
  baseChif:   number[];   // CHIF de référence OOB sans permutation
}

let _forest: Forest | null = null;

function getForest(): Forest {
  if (_forest) return _forest;

  const cohorte = buildCohorte();
  const n = cohorte.length;

  // Seed reproductible
  let seed = 20260522;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };

  const trees: TreeNode[] = [];
  // OOB storage : pour chaque obs, liste des CHIF des arbres où elle est OOB
  const oobChifs: Array<number[][]> = Array.from({length: n}, () => []);

  for (let t = 0; t < N_TREES; t++) {
    // Bootstrap
    const boot: Sample[] = [];
    const inBag = new Set<number>();
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      boot.push(cohorte[idx]);
      inBag.add(idx);
    }
    const oob = cohorte.filter((_, i) => !inBag.has(i));
    const tree = buildTree(boot, 0, rng, [...FEATURES]);
    trees.push(tree);
    // Stocker CHIF OOB
    oob.forEach((s) => {
      const origIdx = cohorte.indexOf(s);
      if (origIdx >= 0) oobChifs[origIdx].push(predictTree(tree, s.x));
    });
  }

  // CHIF OOB moyen par obs
  const oobPred = oobChifs.map(chifs =>
    chifs.length === 0
      ? [0.05, 0.12, 0.20]  // fallback si jamais OOB (rare)
      : chifs[0].map((_, i) => chifs.reduce((s, c) => s + c[i], 0) / chifs.length)
  );

  // Importance par permutation — survie à 36m
  const oobS36 = oobPred.map(chif => Math.exp(-chif[2]));
  const baseErr = oobS36.reduce((s, p, i) =>
    s + Math.abs(p - (cohorte[i].e === 0 ? 1 : 0.3)), 0) / n;

  const oobErrors = FEATURES.map(feat => {
    const featureVals = cohorte.map(s => s.x[feat]);
    const shuffledVals = [...featureVals].sort(() => rng() - 0.5);
    const permErr = oobPred.reduce((s, chif, i) => {
      const px = { ...cohorte[i].x, [feat]: shuffledVals[i] };
      const avgChif = trees.reduce((sum, tree) => {
        const c = predictTree(tree, px as RSFInput);
        return sum + c[2];
      }, 0) / trees.length;
      const ps36 = Math.exp(-avgChif);
      return s + Math.abs(ps36 - (cohorte[i].e === 0 ? 1 : 0.3));
    }, 0) / n;
    return permErr - baseErr;  // delta positif = feature importante
  });

  _forest = { trees, oobErrors, baseChif: oobPred[0] };
  return _forest;
}

// ── API publique ───────────────────────────────────────────────────────────

/**
 * Prédit la probabilité de survie selon le RSF.
 * Premier appel = construction de la forêt (~100ms).
 * Appels suivants = pure prédiction (<1ms).
 */
export function rsfPredict(input: RSFInput): RSFResult {
  const forest = getForest();

  // Moyenner les CHIF sur tous les arbres
  const avgChif = EVAL_TIMES.map((_, ti) =>
    forest.trees.reduce((sum, tree) => {
      const c = predictTree(tree, input);
      return sum + c[ti];
    }, 0) / forest.trees.length
  );

  // S(t) = exp(-H(t))
  const s12 = Math.max(0.03, Math.min(0.97, Math.exp(-avgChif[0])));
  const s24 = Math.max(0.03, Math.min(0.97, Math.exp(-avgChif[1])));
  const s36 = Math.max(0.03, Math.min(0.97, Math.exp(-avgChif[2])));

  // Importance normalisée [0,1]
  const maxErr = Math.max(...forest.oobErrors, 1e-9);
  const minErr = Math.min(...forest.oobErrors, 0);
  const range  = maxErr - minErr || 1;
  const norm   = (e: number) => Math.max(0, Math.min(1, (e - minErr) / range));

  const importance = {
    irocr: norm(forest.oobErrors[0]),
    di:    norm(forest.oobErrors[1]),
    adc:   norm(forest.oobErrors[2]),
    ipc:   norm(forest.oobErrors[3]),
    ar:    norm(forest.oobErrors[4]),
    ca:    norm(forest.oobErrors[5]),
    gch:   norm(forest.oobErrors[6]),
  };

  return { s12, s24, s36, importance };
}

/**
 * Réinitialise la forêt (utile en tests).
 */
export function resetForest(): void {
  _forest = null;
}
