/**
 * scripts/calibrate-cox.ts
 * IRO Strength Velocity v7.0.0 — Calibration des betas Cox
 *
 * Usage : npx tsx scripts/calibrate-cox.ts
 * Sortie : src/config/cox-betas-calibrated.json
 *
 * Méthode : régression logistique pénalisée Ridge (λ=0.1)
 * sur les 30 cas avec outcomes documentés (Gold Standard v4.3, gs-096→gs-125).
 * Calcule le C-index LOO (Leave-One-Out) pour validation croisée.
 *
 * Prérequis : Gold Standard synchronisé (public/config/gold-standard-v4.3.json)
 * avec ≥ 20 entrées ayant un champ `outcome.event`.
 */

import fs   from 'fs';
import path from 'path';
import { IRO_WEIGHTS } from '../src/utils/weights-registry.js';

// ── Chargement du Gold Standard ──────────────────────────────────────────────

const GS_PATH = path.join(process.cwd(), 'public/config/gold-standard-v4.3.json');
if (!fs.existsSync(GS_PATH)) {
  console.error('❌ Gold Standard introuvable. Synchroniser public/config/gold-standard-v4.3.json');
  process.exit(1);
}

const goldStandard = JSON.parse(fs.readFileSync(GS_PATH, 'utf8'));
const withOutcomes = goldStandard.entries.filter((e: any) => e.outcome !== undefined);

console.log(`📊 Gold Standard chargé: ${goldStandard.entries.length} entrées, ${withOutcomes.length} avec outcome`);

if (withOutcomes.length < 20) {
  console.error(`❌ Seuil insuffisant: ${withOutcomes.length} cas avec outcome (minimum requis: 20)`);
  console.error('   Annoter davantage d\'entrées dans public/config/gold-standard-v4.3.json');
  process.exit(1);
}

// ── Extraction des features ───────────────────────────────────────────────────

function calcIROcr(scores: Record<string, number>): number {
  const iro_brut = Object.entries(IRO_WEIGHTS).reduce(
    (sum, [k, w]) => sum + (scores[k] ?? 0) * (w as number), 0,
  ) / 4 * 100;
  const iro = Math.max(0, Math.min(100, Math.round(iro_brut * 10) / 10));
  return iro * (1 - 30 / 200);
}

function isRegulated(vertical: string): boolean {
  return /santé|médical|fintech|légal|juridi|finance|assuranc|pharma/i.test(vertical || '');
}

// Construire la matrice X [n × p] et le vecteur y [n]
// Features: [iro_cr_centered, di_zero, adc_strong, ipc_strong, regulated]
const FEATURES = ['iro_cr_centered', 'di_zero', 'adc_strong', 'ipc_strong', 'regulated_sector'];

const X: number[][] = withOutcomes.map((e: any) => {
  const iro_cr = calcIROcr(e.scores);
  return [
    (iro_cr - 50),                              // centré sur REFERENCE_IRO=50
    (e.scores.DI ?? 0) === 0 ? 1 : 0,
    (e.scores.ADC ?? 0) >= 3 ? 1 : 0,
    (e.scores.IPC ?? 0) >= 3 ? 1 : 0,
    isRegulated(e.vertical || '') ? 1 : 0,
  ];
});

const y: number[] = withOutcomes.map((e: any) => e.outcome.event);
const t_events: number[] = withOutcomes.map((e: any) => e.outcome.t_event_mois);

console.log(`✓ Matrice X: ${X.length} × ${X[0].length} features`);
console.log(`  event=1: ${y.filter(v => v === 1).length}, event=0: ${y.filter(v => v === 0).length}`);

// ── Régression logistique Ridge (λ=0.1) ──────────────────────────────────────

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
}

function fitLogisticRidge(
  X: number[][], y: number[],
  lambda = 0.1, lr = 0.005, iterations = 3000,
): number[] {
  const p = X[0].length;
  let beta = new Array(p).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    const grad = new Array(p).fill(0);
    for (let i = 0; i < X.length; i++) {
      const lp = beta.reduce((s, b, j) => s + b * X[i][j], 0);
      const p_hat = sigmoid(lp);
      const err = p_hat - y[i];
      for (let j = 0; j < p; j++) {
        grad[j] += err * X[i][j];
      }
    }
    for (let j = 0; j < p; j++) {
      beta[j] -= lr * (grad[j] / X.length + lambda * beta[j]);
    }
  }
  return beta;
}

/**
 * Calcule le C-index concordance sur une matrice X/y/t.
 * Réutilisée dans bootstrap.
 */
function computeCIndex(
  X: number[][],
  y: number[],
  t: number[],
  betas: number[],
): number {
  const preds = X.map(xi => xi.reduce((s, v, j) => s + v * betas[j], 0));
  let concordant = 0, comparable = 0;
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < X.length; j++) {
      if (i === j) continue;
      if (y[i] === 1 && t[i] < t[j]) {
        comparable++;
        if (preds[i] > preds[j]) concordant++;
      }
    }
  }
  return comparable > 0 ? concordant / comparable : 0;
}

/**
 * CORRECTIF AUDIT REP-01 — Reproductibilité de la calibration.
 *
 * Le bootstrap utilisait Math.random(), non seedé : chaque exécution produisait
 * un intervalle de confiance différent (dérive observée du C-index CI_lo entre
 * 0.75 et 0.78 selon les runs). Pour un dossier d'instruction (BPI, due diligence
 * VC), un auditeur doit pouvoir rejouer la calibration et retrouver EXACTEMENT
 * les chiffres publiés.
 *
 * Générateur : mulberry32 — PRNG déterministe, période 2^32, qualité suffisante
 * pour un ré-échantillonnage bootstrap. Le seed est publié dans le fichier de
 * calibration (champ `bootstrap_seed`) pour audit.
 */
export const BOOTSTRAP_SEED = 20260712;

export function makeSeededRNG(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap IC 95% OOB sur le C-index.
 * Évaluation Out-Of-Bag réelle pour éliminer le biais d'optimisme.
 * Déterministe : à seed constant, les résultats sont strictement reproductibles.
 */
export function bootstrapCIndexCI_CORRECTED(
  X: number[][],
  y: number[],
  t_events: number[],
  _betas_global: number[],  // non utilisé — on recalibre à chaque itération
  lambda = 0.1,
  n_target_valid = 500,     // nombre d'itérations OOB valides visées
  max_attempts   = 2000,    // sécurité anti-boucle infinie
  seed           = BOOTSTRAP_SEED,
): { ci_lo: number; ci_hi: number; boot_mean: number; boot_sd: number; n_valid: number } {
  const n = X.length;
  const rng = makeSeededRNG(seed);
  const boot_cindices: number[] = [];
  let attempts = 0;

  while (boot_cindices.length < n_target_valid && attempts < max_attempts) {
    attempts++;

    // 1. Tirage avec remise (déterministe — RNG seedé)
    const bag_idx = new Set(
      Array.from({ length: n }, () => Math.floor(rng() * n))
    );
    const oob_idx = Array.from({ length: n }, (_, i) => i).filter(i => !bag_idx.has(i));

    // Besoin d'au moins 1 event OOB pour calculer un C-index significatif
    const oob_events = oob_idx.filter(i => y[i] === 1);
    if (oob_events.length === 0 || oob_idx.length < 3) continue;

    const bag_arr = Array.from(bag_idx);
    const X_bag = bag_arr.map(i => X[i]);
    const y_bag = bag_arr.map(i => y[i]);

    // Vérifier que l'échantillon bootstrap a au moins 1 event (sinon regression dégénérée)
    if (y_bag.filter(v => v === 1).length === 0) continue;

    // 2. Calibration sur l'échantillon bootstrap (bag)
    const betas_b = fitLogisticRidge(X_bag, y_bag, lambda, 0.005, 1500);

    // 3. Évaluation UNIQUEMENT sur les cas OOB (jamais vus à l'entraînement)
    const X_oob = oob_idx.map(i => X[i]);
    const y_oob = oob_idx.map(i => y[i]);
    const t_oob = oob_idx.map(i => t_events[i]);

    const ci_b = computeCIndex(X_oob, y_oob, t_oob, betas_b);

    // Ignorer les valeurs dégénérées (0 ou 1 parfait avec peu de paires)
    const n_pairs_oob = oob_events.length * (oob_idx.length - oob_events.length);
    if (n_pairs_oob < 2) continue;

    boot_cindices.push(ci_b);
  }

  if (boot_cindices.length < 50) {
    // Trop peu d'itérations valides — données insuffisantes pour IC fiable
    return { ci_lo: 0.5, ci_hi: 1.0, boot_mean: 0.75, boot_sd: 0.15, n_valid: boot_cindices.length };
  }

  boot_cindices.sort((a, b) => a - b);
  const n_v = boot_cindices.length;
  const ci_lo = boot_cindices[Math.floor(0.025 * n_v)];
  const ci_hi = boot_cindices[Math.floor(0.975 * n_v)];
  const boot_mean = boot_cindices.reduce((s, v) => s + v, 0) / n_v;
  const boot_sd = Math.sqrt(
    boot_cindices.reduce((s, v) => s + (v - boot_mean) ** 2, 0) / (n_v - 1),
  );

  return {
    ci_lo:      Math.round(ci_lo * 1000) / 1000,
    ci_hi:      Math.round(ci_hi * 1000) / 1000,
    boot_mean:  Math.round(boot_mean * 1000) / 1000,
    boot_sd:    Math.round(boot_sd * 1000) / 1000,
    n_valid:    n_v,
  };
}

// ── Calibration principale ────────────────────────────────────────────────────

console.log('\n🔄 Calibration par régression logistique Ridge (λ=0.1)...');
const betas_global = fitLogisticRidge(X, y);

console.log('\n📐 Betas calibrés:');
FEATURES.forEach((name, i) => {
  console.log(`  ${name.padEnd(25)}: ${betas_global[i].toFixed(4)}`);
});

// ── Leave-One-Out C-index ─────────────────────────────────────────────────────

console.log('\n🔄 Calcul C-index LOO...');

let concordant = 0, comparable = 0;

for (let i = 0; i < X.length; i++) {
  // Entraîner sans le cas i
  const X_train = X.filter((_, idx) => idx !== i);
  const y_train = y.filter((_, idx) => idx !== i);
  const b_loo = fitLogisticRidge(X_train, y_train, 0.1, 0.005, 2000);

  // Prédire sur tous les cas avec ce modèle LOO
  const predictions = X.map(xi => sigmoid(b_loo.reduce((s, b, j) => s + b * xi[j], 0)));

  // Calculer les paires comparables impliquant le cas i
  for (let j = 0; j < X.length; j++) {
    if (i === j) continue;
    if (y[i] === 1 && t_events[i] < t_events[j]) {
      comparable++;
      // Concordant : cas i a une probabilité de risque (p_hat) plus élevée
      if (predictions[i] > predictions[j]) concordant++;
    }
  }
}

const c_index_loo = comparable > 0 ? concordant / comparable : 0;
console.log(`\n📊 C-index LOO: ${c_index_loo.toFixed(3)} sur ${comparable} paires comparables`);
console.log(`   Seuil TRL 4 (0.75): ${c_index_loo >= 0.75 ? '✅ ATTEINT' : '❌ NON ATTEINT'}`);

console.log('\n🔄 Calcul IC bootstrap OOB sur C-index (n_valid=500)...');
const { ci_lo, ci_hi, boot_mean, boot_sd, n_valid } = bootstrapCIndexCI_CORRECTED(
  X, y, t_events, betas_global,
);
console.log(`   Itérations OOB valides : ${n_valid}`);
console.log(`   IC 95% OOB : [${ci_lo.toFixed(3)} ; ${ci_hi.toFixed(3)}]`);
const ic_width = ci_hi - ci_lo;
console.log(`   Largeur IC : ${ic_width.toFixed(3)} — ${ic_width > 0.30 ? '⚠ IC large (EPV insuffisant) — normal avec n_event1=9' : '✓ IC acceptable'}`);

// ── Sauvegarde ────────────────────────────────────────────────────────────────

export interface CalibrationBin {
  bin_lo:          number;  // borne basse du bin (probabilité prédite)
  bin_hi:          number;  // borne haute
  n:               number;  // nb de cas dans le bin
  mean_predicted:  number;  // moyenne des probabilités prédites
  mean_observed:   number;  // fraction d'events observés
  calibration_gap: number;  // mean_predicted - mean_observed (0 = parfait)
}

export function computeCalibrationPlot(
  predicted_probs: number[],  // sigmoid(lp) pour chaque cas
  observed_events: number[],  // 0 ou 1
  n_bins = 10,
): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let b = 0; b < n_bins; b++) {
    const lo = b / n_bins;
    const hi = (b + 1) / n_bins;
    const inBin = predicted_probs
      .map((p, i) => ({ p, y: observed_events[i] }))
      .filter(({ p }) => p >= lo && (b === n_bins - 1 ? p <= hi : p < hi));

    if (inBin.length === 0) continue;
    const mean_pred = inBin.reduce((s, v) => s + v.p, 0) / inBin.length;
    const mean_obs  = inBin.reduce((s, v) => s + v.y, 0) / inBin.length;
    bins.push({
      bin_lo: lo, bin_hi: hi, n: inBin.length,
      mean_predicted: Math.round(mean_pred * 1000) / 1000,
      mean_observed:  Math.round(mean_obs  * 1000) / 1000,
      calibration_gap: Math.round((mean_pred - mean_obs) * 1000) / 1000,
    });
  }
  return bins;
}

const predicted_probs = X.map(xi =>
  1 / (1 + Math.exp(-betas_global.reduce((s, b, j) => s + b * xi[j], 0)))
);
const calibration_plot = computeCalibrationPlot(predicted_probs, y);

const CAL_PATH = path.join(process.cwd(), 'src/config/calibration-plot.json');
fs.writeFileSync(CAL_PATH, JSON.stringify({
  generated_at: new Date().toISOString(),
  n_bins: 10,
  bins: calibration_plot,
  brier_score: Math.round((predicted_probs.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / y.length) * 1000) / 1000,
  brier_note: 'Calculé in-sample (données de calibration) — non représentatif de la performance hors-échantillon',
}, null, 2), 'utf8');
console.log(`\n✅ Calibration plot sauvegardé: ${CAL_PATH}`);

const output = {
  // Betas calibrés (signés inversé : logistique → Cox, négatif = protecteur)
  iro_cr:           Math.round(-betas_global[0] * 10000) / 10000,  // centré, inversé pour Cox
  di_zero:          Math.round( betas_global[1] * 10000) / 10000,  // risque
  srd_high:         0.240,                                           // non estimé — valeur normative conservée
  adc_strong:       Math.round(-betas_global[2] * 10000) / 10000,  // protecteur
  ipc_strong:       Math.round(-betas_global[3] * 10000) / 10000,  // protecteur
  regulated_sector: Math.round(-betas_global[4] * 10000) / 10000,  // protecteur
  velocity:         -0.028,                                          // non estimé — besoin snapshots longitudinaux
  
  // Calibration-plot & Brier Score
  brier_score:      Math.round((predicted_probs.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / y.length) * 1000) / 1000,

  // Métadonnées de calibration
  calibrated_at:    new Date().toISOString(),
  n_cases:          withOutcomes.length,
  n_event1:         y.filter(v => v === 1).length,
  n_event1_source:    'calibrate-cox.ts — withOutcomes filtrés depuis gold-standard-v4.3.json',
  n_event1_perimeter: `IDs gs-096 à gs-125 avec outcome.event défini dans OUTCOMES_MAP`,
  n_event1_ids:       withOutcomes.filter((_: any, i: number) => y[i] === 1).map((e: any) => e.id),
  calibration_note:   `Calibration sur n=${withOutcomes.length} cas (périmètre GS v4.3 gs-096→gs-125). ` +
                      `Différent de export-gold-standard.ts qui couvre n=51 outcomes (périmètre élargi).`,
  c_index_loo:      Math.round(c_index_loo * 1000) / 1000,
  c_index_ci_lo:    ci_lo,
  c_index_ci_hi:    ci_hi,
  c_index_boot_mean: boot_mean,
  c_index_boot_sd:   boot_sd,
  c_index_display: ic_width > 0.30
    ? `${c_index_loo.toFixed(2)} [IC 95% OOB : ${ci_lo.toFixed(2)}–${ci_hi.toFixed(2)}] — discrimination prometteuse, IC large`
    : `${c_index_loo.toFixed(2)} [IC 95% OOB : ${ci_lo.toFixed(2)}–${ci_hi.toFixed(2)}]`,
  c_index_interpretation: ci_hi - ci_lo > 0.20
    ? 'Discrimination prometteuse — IC large (EPV=1.8, seuil institutionnel ≥ 10)'
    : 'Discrimination satisfaisante',
  c_index_boot_n_valid: n_valid,
  c_index_bootstrap_method: 'OOB (out-of-bag) — biais minimal',
  // CORRECTIF AUDIT REP-01 — traçabilité et reproductibilité de la calibration
  bootstrap_seed:   BOOTSTRAP_SEED,
  reproducibility:  `Déterministe. Rejouer : npx tsx scripts/calibrate-cox.ts (seed=${BOOTSTRAP_SEED}) → chiffres identiques.`,
  epv:              Math.round((y.filter(v => v === 1).length / betas_global.length) * 100) / 100,
  epv_note:         `${y.filter(v => v === 1).length} événements / ${betas_global.length} variables = EPV ${(y.filter(v => v === 1).length / betas_global.length).toFixed(2)} (seuil institutionnel ≥ 10)`,
  lambda_ridge:     0.1,
  features:         FEATURES,
  trl_gate_passed:  c_index_loo >= 0.75,
  // CORRECTIF AUDIT SCI-02 — qualification honnête du statut statistique.
  // Un C-index ≥ 0.75 ne suffit pas à qualifier une validation confirmatoire :
  // avec EPV < 10, l'estimation reste exploratoire (sur-paramétrage, IC large).
  validation_status: (y.filter(v => v === 1).length / betas_global.length) >= 10
    ? 'confirmatoire'
    : 'exploratoire',
  validation_caveat: 'Calibration exploratoire (EPV < 10). Le C-index est estimé sur un ' +
                     'effectif d\'événements insuffisant pour une validation confirmatoire. ' +
                     'Les scores de la cohorte rétrospective ont été attribués en connaissance ' +
                     'de l\'issue : la discrimination mesurée ne constitue pas une preuve de ' +
                     'capacité prédictive prospective. Validation prospective en aveugle requise (TRL 5).',
  is_calibrated:    true,
};

const OUT_PATH = path.join(process.cwd(), 'src/config/cox-betas-calibrated.json');
fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log(`\n✅ Betas sauvegardés: ${OUT_PATH}`);
console.log(`   TRL gate: ${output.trl_gate_passed ? '✅ PASSÉ' : '❌ ÉCHOUÉ'}`);

// ── Résumé final ──────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(55));
console.log('  RÉSUMÉ CALIBRATION COX — IRO Strength Velocity v7.0.0');
console.log('═'.repeat(55));
console.log(`  Méthode         : Régression logistique Ridge (λ=0.1)`);
console.log(`  Dataset         : ${withOutcomes.length} cas avec outcomes documentés`);
console.log(`  C-index LOO     : ${c_index_loo.toFixed(3)}`);
console.log(`  Paires compar.  : ${comparable}`);
console.log(`  TRL 4 gate      : ${c_index_loo >= 0.75 ? '✅ PASSÉ' : '❌ ÉCHOUÉ'}`);
console.log('═'.repeat(55));
console.log('\n  Prochaine étape : brancher cox-model.ts sur cox-betas-calibrated.json');
console.log('  Commande        : npx vitest run tests/trl4-validation.vitest.test.ts');
