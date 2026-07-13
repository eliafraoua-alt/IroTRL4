/**
 * src/utils/iro-engine.ts — Moteur de calcul IRO V7
 * Antigravity Intelligence Platform
 *
 * Toutes les fonctions de calcul extraites de App.tsx et corrigées.
 * App.tsx importe depuis ici → séparation logique/UI.
 *
 * CORRECTIONS AUDIT v4.3 :
 *   [F1]  Gold standard insuffisant : annotation R², suppression gradient descent in-browser
 *   [F2]  Double pénalité DI/DFL : calcSRD accepte les poids ajustés de computeSRDWeights()
 *   [F3]  CMP (ex-SHAP) : formule correcte avec vérification d'additivité
 *   [F4]  Variance tripartie : seuil calibré sur gold standard
 *   [F5]  IRO_Certified : annotation R² et warning gold standard
 *   [NEW] Termes d'interaction DI×ADC et IPC×GCH
 *
 * MISE À JOUR v6.6 (Mai 2026) :
 *   [GS]  Gold standard étendu à n=125 (scoring rétrospectif)
 *         Seuil n=60 désormais atteint → mode prédictif activé, GOLD_STANDARD_WARN=false
 *         IRO_Certified passe de « expérimental » à « normatif (avec annotation Spearman) »
 */

import { 
  GOLD_STANDARD,
  computeSRDWeights,
  applyTRLRules,
  computeVRINScore,
} from '../types/iro';

import type { 
  CMPValues,
  IRO_CertifiedResult,
  SRDWeights,
  SRDResult,
  VarianceReport,
  VarianceDecomposition,
  TRLScore,
  StartupModel,
  GoodhartAlert,
  GoldStandardEntry,
  IROResult,
  IROScores,
  IROBatchResult,
  GitHubData,
  FinancialData,
  CorroborationMetrics,
} from '../types/iro';
import { detectGoodharting } from './goodhart-detector';
import { logger } from './logger';

import { IRO_WEIGHTS, SRD_WEIGHTS } from './weights-registry';

import {
  applyFlagPenalties,
  applyDimensionCaps,
  type IROFlagsV45,
} from '../types/iro-flags-v45';

import {
  getSectorWeights,
  type SectorCode,
} from '../config/sector-weights';

// ── Constantes ──────────────────────────────────────────────────────────────

const AXES_WEIGHTS = IRO_WEIGHTS as Record<string, number>;
const SRD_WEIGHTS_BASE = SRD_WEIGHTS;

export const GOLD_STANDARD_N    = GOLD_STANDARD.length;    // 125 depuis v6.6 — TOTAL, y compris sans outcome
// [Correctif 10/07/2026] GOLD_STANDARD_N compte les entrées existant dans le fichier,
// mais 93 des 125 (74%) n'ont aucun outcome.event renseigné — inutilisables pour le
// modèle de survie. Le seuil statistique doit porter sur GOLD_STANDARD_N_OUTCOMES,
// pas sur GOLD_STANDARD_N, sous peine de désactiver l'avertissement à tort (125≥60
// alors que le N réellement exploitable par le Cox est 32, et le nombre d'événements
// event=1 n'est que 9 — cf. audit du 10/07/2026, EPV=9/7=1.29).
export const GOLD_STANDARD_N_OUTCOMES = GOLD_STANDARD.filter(e => e.outcome != null).length;
export const GOLD_STANDARD_N_EVENTS   = GOLD_STANDARD.filter(e => e.outcome?.event === 1).length;
export const GOLD_STANDARD_MIN  = 60;                       // Minimum statistique (entrées AVEC outcome)
export const GOLD_STANDARD_WARN = GOLD_STANDARD_N_OUTCOMES < GOLD_STANDARD_MIN; // true — 32 < 60


export const AXES_CONFIG = [
  { key: 'DI',  label: 'Dépendance Infra',       short: 'DI',  color: '#818cf8', weight: 0.18 },
  { key: 'ADC', label: 'Actif de Données',        short: 'ADC', color: '#34d399', weight: 0.22 },
  { key: 'IPC', label: 'Processus Critiques',     short: 'IPC', color: '#fbbf24', weight: 0.22 },
  { key: 'AR',  label: 'Anticipation Réglo',      short: 'AR',  color: '#60a5fa', weight: 0.13 },
  { key: 'CA',  label: 'Capacité Adaptation',     short: 'CA',  color: '#f87171', weight: 0.10 },
  { key: 'GCH', label: 'Gouvernance Cap. Hum.',   short: 'GCH', color: '#e879f9', weight: 0.12 },
  { key: 'LU',  label: 'Lead User Integration',   short: 'LU',  color: '#2dd4bf', weight: 0.15 },
] as const;

// ── Fonctions utilitaires statistiques ──────────────────────────────────────

export function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function std(arr: number[]): number {
  const mu = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - mu) ** 2, 0) / arr.length);
}

export function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 === 0
    ? (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    : s[Math.floor(s.length / 2)];
}

export function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return z >= 0 ? 1 - p : p;
}

// ── [CORE] computeIRO — Score IRO principal ────────────────────────────────────

// [ACTION 2 — M2] computeIRO accepte les valeurs SRD réelles du consensus LLM
// Signature étendue : srdOverride optionnel pour éviter les SRD hardcodés à (2,2,2)
export function computeIRO(
  dims: Record<string, number>,
  srdOverride?: { VMM: number; NCD: number; DFL: number },
): IROResult {
  const scores = dims as IROScores;
  const iro100Brut = calcIRO(scores);
  const interaction = calcInteractionBonus(scores);
  const iro100 = Math.max(0, Math.min(100, Math.round((iro100Brut + interaction.bonus_total) * 10) / 10));

  // [FIX M2] Utiliser les valeurs SRD du consensus si disponibles,
  // sinon fallback à (2,2,2) avec avertissement dans la justification
  const srdIn = srdOverride ?? { VMM: 2, NCD: 2, DFL: 2 };
  if (!srdOverride) {
    // Pas d'override → SRD neutres, noter dans audit
    // Le appelant devrait fournir consensus.srd pour éviter la double pénalité DI/DFL
  }
  const srdResult = calcSRD(srdIn.VMM, srdIn.NCD, srdIn.DFL, scores.DI);
  const iroCR = calcIROcr(iro100, srdResult.srd);
  
  return {
    startup_name: "Computation Engine",
    millesime: "2026",
    version: "v4.5-S46",
    secteur: "Auto-Analysis",
    vertical: "SAAS",
    age_mois: 0,
    clients_actifs: null,
    stade_financement: "N/A",
    iro: {
        scores: dims as IROScores,
        ipc_confiance: 0.8,
        ipc_eff: dims.IPC * 0.9,
        score_100: iro100,
        interpretation: interpIRO(iro100),
        justifications: {}
    },
    srd: {
        VMM: { score: srdIn.VMM, justification: srdOverride ? "SRD depuis consensus LLM" : "Valeur neutre (2) — fournir srdOverride pour précision" },
        NCD: { score: srdIn.NCD, justification: srdOverride ? "SRD depuis consensus LLM" : "Valeur neutre (2)" },
        DFL: { score: srdIn.DFL, justification: srdOverride ? "SRD depuis consensus LLM" : "Valeur neutre (2)" },
        srd_100: srdResult.srd,
        iro_cr: iroCR,
        interpretation: srdOverride ? `Risque dynamique (VMM=${srdIn.VMM} NCD=${srdIn.NCD} DFL=${srdIn.DFL} DI-dédupliqué=${srdResult.deduplicationActive})` : "Standard Risk (SRD neutres)",
        horizon_risque_mois: null,
        quadrant: getQuadrant(iro100, srdResult.srd),
        plan_mitigation: []
    },
    benchmark: {
        percentile: 50,
        iro_relatif: 0,
        iro_ajuste: 0,
        position: "Suiveur",
        axes_forts: [],
        axes_faibles: []
    },
    hypotheses: {},
    flags: {
        floor_activated: dims.DI === 0,
        ancrage_warning: false,
        integration_maturity_warning: false,
        commoditisation_imminente: false,
        double_lock_in: false,
        data_moat_absent: false,
        single_founder_warning: false,
        team_homogeneity_warning: false,
        key_person_risk: false
    },
    synthese: {
        forces: [],
        risques: [],
        recommandation: "Analyse automatique générée.",
        verdict_investisseur: "Neutre"
    },
    sources_utilisees: []
  };
}

export function calcIRO(
  scores:        Record<string, any>,
  ipcConf:       number = 0.8,
  trl?:          TRLScore,
  adcConf:       number = 1.0,
  gchConf:       number = 1.0,
  customWeights?: Record<string, number>,
  flagsV45?:     Partial<IROFlagsV45>,   // [v4.5] flags protocole sources
  sectorCode?:   SectorCode,             // [v4.8] poids sectoriels calibrés
): number {
  // [v4.5] Plafonnement dimensionnel selon les flags (brevet_non_verifie, dirigeant_anonyme…)
  const effectiveScores = flagsV45 ? applyDimensionCaps(scores, flagsV45) : scores;

  let ipc = effectiveScores.IPC ?? 0;

  // Application des règles TRL si fournies
  if (trl && trl.niveau <= 4 && ipc > 2) ipc = 2;

  const ipcEff = ipc * (0.5 + 0.5 * ipcConf);
  const adcEff = (effectiveScores.ADC ?? 0) * (0.5 + 0.5 * adcConf);
  const gchEff = (effectiveScores.GCH ?? 0) * (0.5 + 0.5 * gchConf);

  // [v4.8] Résolution des poids : customWeights > sectorCode > poids base
  const w = customWeights
    ?? (sectorCode ? getSectorWeights(sectorCode) : null)
    ?? AXES_WEIGHTS
    ?? IRO_WEIGHTS;

  const luEff = Number(effectiveScores.LU ?? 0);

  const brut =
    (Number(effectiveScores.DI || 0)) * (w.DI  || 0) +
    Number(adcEff || 0)               * (w.ADC || 0) +
    Number(ipcEff || 0)               * (w.IPC || 0) +
    (Number(effectiveScores.AR || 0)) * (w.AR  || 0) +
    (Number(effectiveScores.CA || 0)) * (w.CA  || 0) +
    Number(gchEff || 0)               * (w.GCH || 0) +
    luEff                             * (w.LU  || 0);

  const sumW =
    (w.DI  || 0) +
    (w.ADC || 0) +
    (w.IPC || 0) +
    (w.AR  || 0) +
    (w.CA  || 0) +
    (w.GCH || 0) +
    (w.LU  || 0);
  const divisor = 4 * (sumW || 1);

  let s = Math.round((brut / divisor) * 100 * 10) / 10;
  if (isNaN(s)) s = 0;

  // REV1-V2 (assouplie — validée par panel humain, juin 2026 ; portée depuis
  // batch_gemini_iro.py pour unifier les deux implémentations, cf. audit du 10/07/2026) :
  //   DI=0 + ADC≤1 → plafond strict à 35 (wrapper sans actifs propres)
  //   DI=0 + ADC=2 → plafond assoupli à 50 (wrapper avec actifs partiels)
  //   DI=0 + ADC≥3 → pas de plafond (données propriétaires réelles malgré DI=0) ;
  //                  utiliser getAncrageWarning(scores) si un signal de vigilance est nécessaire.
  if (scores.DI === 0) {
    const adcScore = Number(effectiveScores.ADC ?? 0);
    if (adcScore <= 1) s = Math.min(s, 35);
    else if (adcScore === 2) s = Math.min(s, 50);
    // adcScore >= 3 : pas de plafond, cf. getAncrageWarning() ci-dessous.
  }

  // REV13 : concentration_anchor
  // Malus si un seul client représente >25% du CA et portefeuille ≤20 clients.
  // Un IPC/LU élevé porté par un anchor unique ne reflète pas une résilience réelle.
  // Seuils experts normatifs (règles de plafonnement B2B SaaS).
  // AUDIT SCI-B : la mention « calibrés sur cohorte 500 » a été retirée — aucune donnée
  // du dépôt ne la soutenait. Ces seuils sont NORMATIFS (arbitrage d'auteur), non calibrés.
  // Métriques réelles et reproductibles : src/config/validation-n442.json
  //   >40% CA + ≤20 clients → −8 pts
  //   >25% CA + ≤20 clients → −4 pts
  const rev13PctTopClient: number = (scores._pct_top_client ?? 0);
  const rev13NbClients:    number = (scores._nb_clients    ?? 9999);
  if (rev13NbClients <= 20) {
    if (rev13PctTopClient >= 0.40) s = Math.round((s - 8.0) * 10) / 10;
    else if (rev13PctTopClient >= 0.25) s = Math.round((s - 4.0) * 10) / 10;
  }

  // REV12 : adc_ipc_gap
  // Malus −5 pts si ADC≥3 ET IPC≤1 ET LU≤1.
  // Un actif de données élevé sans intégration client ni lead user ancré ne produit
  // pas de flywheel défendable. Calibré sur 8 FP persistants (Meero, Tinyclues,
  // Sendinblue IA, Algolia AI Search, Malt IA unit…) — cohorte n=87, juin 2026.
  // Condition LU≤1 évite de pénaliser les startups B2B à fort ancrage (LU=2+).
  const rev12ADC: number = Number(scores.ADC ?? 0);
  const rev12IPC: number = Number(scores.IPC ?? 0);
  const rev12LU:  number = Number(scores.LU  ?? 0);
  if (rev12ADC >= 3 && rev12IPC <= 1 && rev12LU <= 1) {
    s = Math.round((s - 5.0) * 10) / 10;
  }

  // [v4.5] Malus flags protocole sources (liquidation, contrat_retire, data_stale…)
  if (flagsV45) {
    const { score: sAfterFlags } = applyFlagPenalties(s, flagsV45, effectiveScores);
    s = sAfterFlags;
  }

  s = Math.max(0, s);

  return s;
}

// ── Import protocole sources v4.5 ────────────────────────────────────────────

// ── [F2] calcSRD — Score de Risque Dynamique avec poids ajustés ─────────────

/**
 * [CORRECTION F2] calcSRD avec règle de déduplication.
 * DI=0 signifie dépendance totale déjà capturée → poids DFL réduit de 30% à 15%.
 */
export function calcSRD(
  vmm:     number,
  ncd:     number,
  dfl:     number,
  diScore: number,
): SRDResult {
  const weights = computeSRDWeights(diScore);
  const srdRaw = (vmm * weights.VMM + ncd * weights.NCD + dfl * weights.DFL);
  const srd = Math.round((srdRaw / 4) * 100 * 10) / 10;

  return {
    srd,
    dflWeightApplied: weights.DFL,
    deduplicationActive: weights.dfl_adjusted,
    explanation: weights.dfl_adjustment_reason
  };
}

export function calcIROcr(iro: number, srd: number): number {
  const i = Number(iro || 0);
  const s = Number(srd || 0);
  const res = Math.round(i * (1 - s / 200) * 10) / 10;
  return isNaN(res) ? 0 : res;
}

// ── [NEW] Termes d'interaction DI×ADC et IPC×GCH ───────────────────────────

/**
 * [REV1-V2, unification 10/07/2026] Signal de vigilance pour le cas DI=0 + ADC≥3 :
 * une startup sans infrastructure propre (DI=0) mais avec des actifs de données
 * substantiels (ADC≥3) n'est pas plafonnée par REV1-V2 (cf. calcIRO ci-dessus),
 * mais ce profil reste atypique et mérite un signal explicite pour la revue humaine —
 * l'absence de plafond ne doit pas être lue comme une absence de risque.
 * Ne modifie pas le score ; à consommer par l'UI/les rapports si besoin.
 */
export function getAncrageWarning(scores: Record<string, any>): boolean {
  const di  = Number(scores.DI  ?? 0);
  const adc = Number(scores.ADC ?? 0);
  return di === 0 && adc >= 3;
}

/**
 * Bonus/malus d'interaction entre dimensions.
 * Un modèle additif pur traite DI=0,ADC=4 identiquement à DI=4,ADC=4
 * sur ces deux dimensions — ce qui est économiquement absurde.
 *
 * Implémentation : correction linéaire proportionnelle à l'écart
 * par rapport à la configuration "équilibrée" (DI=ADC, IPC=GCH).
 *
 * Amplitude maximale : ±3 pts sur le score final (non compensable par REV1).
 */
export function calcInteractionBonus(scores: Record<string, number>): {
  bonus_total:   number;
  di_adc_bonus:  number;
  ipc_gch_bonus: number;
  details:       string[];
} {
  const details: string[] = [];

  // Interaction DI × ADC
  // Données riches (ADC≥3) sans infra propre (DI≤1) → pénalité : données non exploitables durablement
  // Infra propre (DI≥3) sans données (ADC≤1) → pénalité : capacité sans carburant
  const di  = scores.DI  ?? 0;
  const adc = scores.ADC ?? 0;
  let di_adc_bonus = 0;

  if (adc >= 3 && di <= 1) {
    di_adc_bonus = -0.03 * (adc - di) * 100;  // pénalité proportionnelle en pts
    details.push(`DI×ADC: données riches (ADC=${adc}) sans infra propre (DI=${di}) → ${di_adc_bonus.toFixed(1)} pts`);
  } else if (di >= 3 && adc <= 1) {
    di_adc_bonus = -0.02 * (di - adc) * 100;
    details.push(`DI×ADC: infra propre (DI=${di}) sans actif data (ADC=${adc}) → ${di_adc_bonus.toFixed(1)} pts`);
  } else if (di >= 3 && adc >= 3) {
    di_adc_bonus = +0.015 * Math.min(di, adc) * 100 * 0.1;  // léger bonus synergie
    details.push(`DI×ADC: synergie infra+données → +${di_adc_bonus.toFixed(1)} pts`);
  }

  // Interaction IPC × GCH
  // Criticité processus élevée (IPC≥3) avec équipe faible (GCH≤1) → risque opérationnel
  const ipc = scores.IPC ?? 0;
  const gch = scores.GCH ?? 0;
  let ipc_gch_bonus = 0;

  if (ipc >= 3 && gch <= 1) {
    ipc_gch_bonus = -0.02 * (ipc - gch) * 100 * 0.15;
    details.push(`IPC×GCH: intégration critique (IPC=${ipc}) avec équipe faible (GCH=${gch}) → ${ipc_gch_bonus.toFixed(1)} pts`);
  } else if (ipc >= 3 && gch >= 3) {
    ipc_gch_bonus = +0.01 * Math.min(ipc, gch) * 100 * 0.1;
    details.push(`IPC×GCH: synergie intégration+équipe → +${ipc_gch_bonus.toFixed(1)} pts`);
  }

  const bonus_total = Math.round((di_adc_bonus + ipc_gch_bonus) * 10) / 10;

  return {
    bonus_total: Math.max(-3, Math.min(3, bonus_total)),  // cap ±3 pts
    di_adc_bonus: Math.round(di_adc_bonus * 10) / 10,
    ipc_gch_bonus: Math.round(ipc_gch_bonus * 10) / 10,
    details,
  };
}

// ── [F3] calcCMP — Contributions Marginales Pondérées (ex-SHAP) ─────────────

/**
 * [CORRECTION F3] Vraie décomposition linéaire sur modèle additif.
 *
 * Formule : φᵢ = wᵢ × (xᵢ − E[xᵢ]) × ipc_mult
 * où E[xᵢ] est la moyenne de la dimension dans le gold standard.
 *
 * Propriété d'additivité : Σφᵢ = IRO_prédit − IRO_baseline
 * (garantie exactement pour un modèle linéaire — Lundberg & Lee, 2017)
 *
 * Annotation UI obligatoire :
 *   "Contributions Marginales Pondérées (CMP) — décomposition linéaire,
 *    approximation pour modèle additif"
 */
export function calcCMP(
  scores:  Record<string, number>,
  ipcConf: number,
  adcConf: number = 1.0,
  gchConf: number = 1.0,
): CMPValues {
  // Moyennes gold standard par dimension
  const goldMeans: Record<string, number> = {};
  for (const k of ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH', 'LU'] as const) {
    goldMeans[k] = mean(GOLD_STANDARD.map(g => g.scores[k] ?? 0));
  }

  const baseline  = calcIRO(goldMeans, 0.8);
  const predicted = calcIRO(scores, ipcConf, undefined, adcConf, gchConf);

  const phi: Record<string, number> = {};

  // Support correct scaleFactor calculations
  const sumW =
    (AXES_WEIGHTS.DI   || 0) +
    (AXES_WEIGHTS.ADC  || 0) +
    (AXES_WEIGHTS.IPC  || 0) +
    (AXES_WEIGHTS.AR   || 0) +
    (AXES_WEIGHTS.CA   || 0) +
    (AXES_WEIGHTS.GCH  || 0) +
    (AXES_WEIGHTS.LU   || 0);
  const scaleFactor = 100 / (4 * (sumW || 1));

  for (const k of ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH', 'LU'] as const) {
    const w       = AXES_WEIGHTS[k];
    let scoreEff = scores[k] ?? 0;
    if (k === 'IPC') scoreEff *= (0.5 + 0.5 * ipcConf);
    if (k === 'ADC') scoreEff *= (0.5 + 0.5 * adcConf);
    if (k === 'GCH') scoreEff *= (0.5 + 0.5 * gchConf);

    let meanEff = goldMeans[k];
    if (k === 'IPC') meanEff *= 0.9;

    phi[k]        = Math.round((scoreEff - meanEff) * w * scaleFactor * 10) / 10;
  }
  const phiSum = phi.DI + phi.ADC + phi.IPC + phi.AR + phi.CA + phi.GCH + phi.LU;

  // Vérification d'additivité : |Σφᵢ - (predicted - baseline)| < 0.5 pts
  const expected_diff = predicted - baseline;
  const additivity_ok = Math.abs(phiSum - expected_diff) < 0.5;

  return {
    DI:  phi.DI,
    ADC: phi.ADC,
    IPC: phi.IPC,
    AR:  phi.AR,
    CA:  phi.CA,
    GCH: phi.GCH,
    LU:  phi.LU,
    baseline:        Math.round(baseline  * 10) / 10,
    predicted,
    additivity_check: additivity_ok,
  };
}

// ── [F1+F5] calcIROCertified — Poids recalibrés avec annotation R² ──────────

/**
 * [CORRECTION F1] :
 *   - Annotation R² obligatoire : "non significatif (n=10, surajustement probable)"
 *   - Warning gold standard affiché quand n < 60
 *   - Le gradient descent in-browser est conservé MAIS ses résultats
 *     sont annotés comme non-fiables et ne remplacent pas les poids théoriques
 *     dans le score principal.
 *
 * [CORRECTION F5] :
 *   - Le score IRO_Certified est clairement étiqueté "expérimental"
 *   - Ne doit pas remplacer l'IRO standard dans l'UI principale
 */
export function calcIROCertified(
  scores:  Record<string, number>,
  ipcConf: number,
): IRO_CertifiedResult {
  const keys = ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'] as const;

  // Poids initiaux (théoriques)
  const w: Record<string, number> = { ...IRO_WEIGHTS };

  // [F1] Gradient descent sur n=10 — conservé à titre expérimental UNIQUEMENT
  // Ne PAS présenter le R² comme significatif (surajustement certain sur n=10)
  const lr = 0.001;
  for (let iter = 0; iter < 500; iter++) {
    const grad: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]));

    for (const g of GOLD_STANDARD) {
      const s = g.scores;
      const gch = s.GCH ?? 0;
      const ipcE = s.IPC * (0.5 + 0.5 * 0.8);
      const brut = s.DI * w.DI + s.ADC * w.ADC + ipcE * w.IPC + s.AR * w.AR + s.CA * w.CA + gch * w.GCH;
      let pred = (brut / 4) * 100;
      if (s.DI === 0) pred = Math.min(pred, 40);
      const err = pred - g.sce.final;

      for (const k of keys) {
        const feat = k === 'IPC' ? s[k] * (0.5 + 0.5 * 0.8) : (s[k] ?? 0);
        grad[k] += err * (feat / 4) * 100;
      }
    }

    for (const k of keys) w[k] = Math.max(0.05, w[k] - lr * grad[k] / GOLD_STANDARD.length);
    const total = keys.reduce((s, k) => s + w[k], 0);
    for (const k of keys) w[k] = Math.round((w[k] / total) * 1000) / 1000;
  }

  // R² — intentionnellement surestimé sur n=10
  const goldMean = mean(GOLD_STANDARD.map(g => g.sce.final));
  let ssTot = 0, ssRes = 0;

  for (const g of GOLD_STANDARD) {
    const s = g.scores;
    const gch = s.GCH ?? 0;
    const ipcE = s.IPC * (0.5 + 0.5 * 0.8);
    const brut = s.DI*w.DI + s.ADC*w.ADC + ipcE*w.IPC + s.AR*w.AR + s.CA*w.CA + gch*w.GCH;
    let pred = (brut / 4) * 100;
    if (s.DI === 0) pred = Math.min(pred, 40);
    ssTot += (g.sce.final - goldMean) ** 2;
    ssRes += (g.sce.final - pred)    ** 2;
  }

  const r2 = Math.max(0, Math.round((1 - ssRes / ssTot) * 100) / 100);
  const sampleSize = GOLD_STANDARD.length;

  // ── Nouvelles métriques normatives ────────────────────────────────────────
  const actuals = GOLD_STANDARD.map(g => g.sce.final);
  const predicteds = GOLD_STANDARD.map(g => {
    const s = g.scores;
    const gch = s.GCH ?? 0;
    const ipcE = s.IPC * (0.5 + 0.5 * 0.8);
    const brut = s.DI * w.DI + s.ADC * w.ADC + ipcE * w.IPC + s.AR * w.AR + s.CA * w.CA + gch * w.GCH;
    let pred = (brut / 4) * 100;
    if (s.DI === 0) pred = Math.min(pred, 40);
    return pred / 10; // Normalisation SCE [0-10]
  });

  const spearman = pearsonCorrelation(computeRanks(actuals), computeRanks(predicteds));
  const rmse = Math.sqrt(actuals.reduce((s, a, i) => s + (a - predicteds[i]) ** 2, 0) / sampleSize);
  const mae = actuals.reduce((s, a, i) => s + Math.abs(a - predicteds[i]), 0) / sampleSize;

  // Score certifié (expérimental)
  const ipcEff  = scores.IPC * (0.5 + 0.5 * ipcConf);
  const brutFin = scores.DI*w.DI + scores.ADC*w.ADC + ipcEff*w.IPC + scores.AR*w.AR + scores.CA*w.CA + scores.GCH*w.GCH;
  let certified = Math.round((brutFin / 4) * 100 * 10) / 10;
  if (scores.DI === 0) certified = Math.min(certified, 40);

  const standard = calcIRO(scores, ipcConf);
  const variableCount = Object.keys(scores).length;
  const r2Adjusted = sampleSize > variableCount + 1 ? 1 - ((1 - r2) * (sampleSize - 1) / (sampleSize - variableCount - 1)) : r2;
  const meanICC = GOLD_STANDARD.reduce((s, e) => s + e.sce.icc, 0) / sampleSize;

  return {
    poids_appris:           w,
    iro_certified:          certified,
    delta_vs_standard:      Math.round((certified - standard) * 10) / 10,
    confiance_calibration:  r2,
    r2Adjusted,
    meanICC,
    spearman,
    rmse,
    mae,
    // [F1] Annotation R² obligatoire
    r2_annotation: GOLD_STANDARD_WARN
      ? `Spearman ρ=${spearman.toFixed(2)} — non significatif (n=${GOLD_STANDARD_N_OUTCOMES} avec outcome sur ${GOLD_STANDARD_N} entrées totales, dont ${GOLD_STANDARD_N_EVENTS} événements — surajustement probable, minimum requis : ${GOLD_STANDARD_MIN})`
      : `Spearman ρ=${spearman.toFixed(2)}`,
    // [F1] Warning gold standard
    gold_standard_warning: GOLD_STANDARD_WARN
      ? `Gold standard insuffisant (n=${GOLD_STANDARD_N_OUTCOMES}/${GOLD_STANDARD_MIN} avec outcome observé ; ${GOLD_STANDARD_N_EVENTS} événements event=1 seulement — EPV=${(GOLD_STANDARD_N_EVENTS/7).toFixed(2)} avec les 7 covariables actuelles du modèle de Cox, très inférieur au seuil recommandé de 10). ` +
        `IRO_Certified est expérimental et ne doit pas remplacer l'IRO standard. ` +
        `Étendre le gold standard à ${GOLD_STANDARD_MIN}+ startups avec outcomes observés (pas seulement ${GOLD_STANDARD_N} entrées au total).`
      : null,
    sampleSize,
    variableCount,
    isStatisticallyValid: spearman >= 0.70 && meanICC >= 0.70
  };
}

// ── [F4] buildVarianceReport — Décomposition tripartie de la variance ────────

/**
 * [CORRECTION F4] Le σ brut des 3 passages est décomposé en 3 composantes :
 *   - Épistémique  : manque d'info sur la startup (sources convergentes ?)
 *   - Aléatoire    : stochasticité du LLM (calibrée sur gold standard)
 *   - Modèle       : sous-spécification du prompt (dimensions instables > 2σ_ref)
 *
 * Le seuil d'instabilité est calibré sur le gold standard (Mistral AI référence)
 * plutôt que fixé arbitrairement à 8 pts.
 */
export function buildVarianceReport(
  scorePasses:       Array<Record<string, number>>,
  iroPasses:         number[],
  sourcesCollected:  number,
  sourcesConvergent: boolean,
): VarianceReport {
  const sigmaIRO = Math.round(std(iroPasses) * 10) / 10;
  const sigmaAxes: Record<string, number> = {};
  const consensusScores: Record<string, number> = {};

  for (const k of ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH']) {
    const vals    = scorePasses.map(p => p[k] ?? 0);
    sigmaAxes[k]  = Math.round(std(vals) * 100) / 100;
    consensusScores[k] = median(vals);
  }

  // Seuil calibré : σ_ref estimé sur Mistral AI (gold standard bien connu)
  // Valeur empirique de référence ≈ 1.2 pts IRO inter-passages
  // Instabilité = σ > 3 × σ_ref = 3.6 pts → arrondi à 4 pts
  const sigma_ref     = 1.2;
  const seuil_calibre = Math.round(sigma_ref * 3 * 10) / 10;  // 3.6 pts

  // Dimensions instables : σ_dim > 2 × sigma_ref
  const dimensions_instables = Object.entries(sigmaAxes)
    .filter(([, s]) => s > sigma_ref)
    .map(([k]) => k);

  // Décomposition tripartie
  const decomposition: VarianceDecomposition = {
    epistemique:          sourcesCollected < 3 ? 'haute' : sourcesConvergent ? 'faible' : 'moyenne',
    sources_convergentes: sourcesConvergent,
    aleatoire_estimee:    sigma_ref,
    modele:               dimensions_instables.length > 0 ? 'detectee' : 'non_detectee',
    dimensions_instables,
  };

  const sigma_interpretation = sigmaIRO > seuil_calibre
    ? (sourcesConvergent
        ? `Variance interne LLM (σ=${sigmaIRO.toFixed(1)}) — sources convergentes`
        : `Variance réel (σ=${sigmaIRO.toFixed(1)}) — opacité informationnelle startup`)
    : `Stabilité confirmée (σ=${sigmaIRO.toFixed(1)})`;

  return {
    scores_passes:     scorePasses,
    iro_passes:        iroPasses,
    sigma_iro:         sigmaIRO,
    sigma_axes:        sigmaAxes,
    instable:          sigmaIRO > seuil_calibre,
    consensus_scores:  consensusScores,
    decomposition,
    seuil_instabilite: seuil_calibre,
    seuil_source:      'calibre_gold',
    sigma_interpretation,
  };
}

/**
 * À appeler dans buildVarianceReport() pour chaque analyse.
 * sources_active : map source → boolean (collecteur actif ou non)
 */
export function computeCorroborationMetrics(
  dimDetails: Array<{ missing_data?: string[] }>,
  sourcesActive: Record<string, boolean>,
): CorroborationMetrics {
  const totalClaims = dimDetails.length * 6; // 6 dimensions par dossier
  const missingCount = dimDetails.reduce((s, d) => s + (d.missing_data?.length ?? 0), 0);
  const corroborated = totalClaims - missingCount;
  const rate = totalClaims > 0 ? corroborated / totalClaims : 0;

  const bySource: Record<string, { present: number; total: number; rate: number }> = {};
  for (const [src, active] of Object.entries(sourcesActive)) {
    bySource[src] = { present: active ? 1 : 0, total: 1, rate: active ? 1 : 0 };
  }

  // Décote automatique si moins de 50% des claims corroborés
  const penalty = rate < 0.5 ? (0.5 - rate) * 0.2 : 0;

  return {
    total_claims: totalClaims,
    corroborated_claims: corroborated,
    rate: Math.round(rate * 1000) / 1000,
    by_source: bySource,
    auto_confidence_penalty: Math.round(penalty * 1000) / 1000,
    display_label: rate >= 0.7
      ? `Corroboration ${Math.round(rate*100)}% ✓`
      : `⚠ Corroboration ${Math.round(rate*100)}% — données partielles`,
  };
}

// ── Fonctions benchmark et utilitaires (Mise à jour v4.5-S46) ────────────────

export const SEUIL_VIABILITE = 46;
export const SEUIL_ALERTE = 50;

export function interpIRO(s: number): string {
  if (s >= 80) return 'Excellent';
  if (s >= 65) return 'Solide';
  if (s >= 46) return 'Vigilance';
  return 'Risque élevé';
}

export function scoreColor(s: number): string {
  if (s >= 80) return '#10b981'; // Excellent - Green
  if (s >= 65) return '#059669'; // Solide - Emerald/Teal
  if (s >= 46) return '#fbbf24'; // Vigilance - Amber/Yellow
  return '#f43f5e';             // Risque élevé - Red/Rose
}

export interface ZoneIRO {
  label: string;
  color: string;   // texte
  bg:    string;   // fond
  desc:  string;
}

export function zoneIRO(s: number): ZoneIRO {
  if (s >= 80) return { label: 'Excellent',    color: '#085041', bg: '#5DCAA5', desc: '0% d\'échec · actif VRIN documenté' };
  if (s >= 65) return { label: 'Solide',       color: '#085041', bg: '#9FE1CB', desc: '0% d\'échec · viabilité confirmée' };
  if (s >= SEUIL_VIABILITE)
               return { label: 'Vigilance',    color: '#633806', bg: '#FAC775', desc: '7.5% d\'échec · due diligence renforcée' };
  return       { label: 'Risque élevé',        color: '#791F1F', bg: '#F09595', desc: '98.8% d\'échec · exclusion recommandée' };
}

export function srdColor(s: number): string {
  if (s <= 24) return '#00c896';
  if (s <= 44) return '#60a5fa';
  if (s <= 64) return '#f59e0b';
  if (s <= 79) return '#f97316';
  return '#ef4444';
}

export function getQuadrant(iro: number, srd: number): string {
  if (iro >= 65 && srd < 65)  return 'Forteresse';
  if (iro >= 65 && srd >= 65) return 'Château de Sable';
  if (iro < 65  && srd < 65)  return 'Embryon Solide';
  return 'Zone Rouge';
}

export interface SectorBenchmarkEntry {
  name?:  string;       // nom du secteur
  mu:     number;
  sigma:  number;
  fds:    number;
  source: string;       // référence ou 'indicatif — n sectoriel < 30'
  n:      number;       // taille de l'échantillon interne
  label:  'calibré' | 'indicatif';  // 'indicatif' si n < 30
}

/**
 * Wrapper à utiliser dans calcBenchmark() — affiche le label source
 */
export function getSectorBenchmarkNote(entry: SectorBenchmarkEntry): string {
  if (entry.label === 'indicatif') {
    return `⚠ Benchmark indicatif (n=${entry.n} < 30) — à recalibrer dès n ≥ 30 dans ce vertical`;
  }
  return `Source : ${entry.source} (n=${entry.n})`;
}

const SECTORS: Record<string, SectorBenchmarkEntry> = {
  HLTH: { name: 'Healthtech / MedIA', mu: 64.9, sigma: 11.2, fds: 1.20, source: 'Revue Delphi v4.3 et cohorte pilote Tudigo', n: 42, label: 'calibré' },
  FINT: { name: 'Fintech / InsurIA',  mu: 63.4, sigma: 10.4, fds: 1.15, source: 'Revue Delphi v4.3 et cohorte pilote Tudigo', n: 35, label: 'calibré' },
  LEGT: { name: 'LegalTech / GovIA',  mu: 59.0, sigma:  8.2, fds: 1.10, source: 'indicatif — n sectoriel < 30', n: 12, label: 'indicatif' },
  INDU: { name: 'Industrie / IoT IA', mu: 60.1, sigma: 11.8, fds: 1.05, source: 'indicatif — n sectoriel < 30', n: 18, label: 'indicatif' },
  SAAS: { name: 'Enterprise SaaS IA', mu: 60.8, sigma: 14.1, fds: 1.00, source: 'Revue Delphi v4.3 et cohorte pilote Tudigo', n: 54, label: 'calibré' },
};


export function calcBenchmark(score: number, code: keyof typeof SECTORS) {
  const s = SECTORS[code];
  if (!s) return null;
  const rel = Math.round(((score - s.mu) / s.sigma) * 100) / 100;
  const pct = Math.max(1, Math.min(99, Math.round(normalCDF(rel) * 100)));
  const adj = Math.round(score * s.fds * 10) / 10;
  let pos: 'Leader' | 'Challenger' | 'Suiveur' | 'Retardataire' = 'Retardataire';
  if (pct >= 75) pos = 'Leader';
  else if (pct >= 50) pos = 'Challenger';
  else if (pct >= 25) pos = 'Suiveur';
  return { rel, pct, adj, pos };
}

export function checkGoldStandard(name: string, iro100: number) {
  const ref = GOLD_STANDARD.find(g => g.name.toLowerCase() === name.trim().toLowerCase());
  if (!ref) return null;
  const iro_ref = ref.sce.final;
  const tol = 5; // Tolérance par défaut v4.5-S46
  const delta = Math.abs(iro100 - iro_ref);
  return {
    is_gold: true,
    id: ref.id,
    iro_ref,
    delta,
    within_tolerance: delta <= tol,
    status: (delta <= tol ? 'calibre' : delta <= tol * 2 ? 'derive_moderee' : 'derive_critique') as 'calibre' | 'derive_moderee' | 'derive_critique',
  };
}

/**
 * [F1] Calcul du R² pour une série de prédictions vs références.
 */
export function computeR2(actual: number[], predicted: number[]): number {
  if (actual.length !== predicted.length || actual.length === 0) return 0;
  const meanActual = actual.reduce((a, b) => a + b, 0) / actual.length;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < actual.length; i++) {
    ssTot += Math.pow(actual[i] - meanActual, 2);
    ssRes += Math.pow(actual[i] - predicted[i], 2);
  }
  if (ssTot === 0) return 0;
  return Math.max(0, 1 - ssRes / ssTot);
}

/**
 * [F1] Calcul R² enrichi avec métadonnées statistiques.
 * Évalue la qualité globale de la base Gold Standard et du modèle actuel.
 */
export function calcR2Enriched(goldStandard: GoldStandardEntry[]) {
  const n = goldStandard.length;
  const k = 6;

  const actuals    = goldStandard.map(g => g.sce.final);
  const predicteds = goldStandard.map(g => calcIRO(g.scores, 0.8, undefined, 1.0, 1.0) / 10);
  // Division par 10 : IRO [0-100] → [0-10] pour comparer aux SCE [0-10]

  // ── Métriques correctes pour instrument normatif ──────────────────────────

  // 1. Corrélation de rang Spearman — mesure si l'IRO classe correctement
  const rankActual    = computeRanks(actuals);
  const rankPredicted = computeRanks(predicteds);
  const spearman = pearsonCorrelation(rankActual, rankPredicted);

  // 2. RMSE — erreur absolue moyenne en points SCE
  const rmse = Math.sqrt(
    actuals.reduce((s, a, i) => s + (a - predicteds[i]) ** 2, 0) / n
  );

  // 3. MAE — erreur médiane (robuste aux outliers)
  const mae = actuals.reduce((s, a, i) => s + Math.abs(a - predicteds[i]), 0) / n;

  // 4. R² brut — conservé pour transparence, avec annotation claire
  const meanA = actuals.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (actuals[i] - meanA) ** 2;
    ssRes += (actuals[i] - predicteds[i]) ** 2;
  }
  const r2 = Math.max(0, 1 - ssRes / ssTot);
  // R² ajusté conservé pour transparence uniquement — ne pas afficher comme métrique principale
  const r2Adjusted = n > k + 1 ? 1 - ((1 - r2) * (n - 1) / (n - k - 1)) : r2;

  const meanICC = goldStandard.reduce((s, e) => s + e.sce.icc, 0) / n;

  // Validité statistique : basée sur Spearman + ICC, pas sur R²
  const isStatisticallyUsable = spearman >= 0.70 && meanICC >= 0.70;
  const isFullyValid           = n >= 50 && spearman >= 0.70 && meanICC >= 0.70;

  return {
    // Métriques primaires (normatives)
    spearman,
    rmse,
    mae,
    meanICC,
    n, k,
    // Métriques secondaires (transparence)
    r2,
    r2Adjusted,
    // Statut
    isStatisticallyUsable,
    isFullyValid,
    // Labels UI
    label: isFullyValid
      ? `Spearman ρ=${spearman.toFixed(2)} — RMSE=${rmse.toFixed(2)} pts — n=${n} ✓`
      : `Spearman ρ=${spearman.toFixed(2)} — RMSE=${rmse.toFixed(2)} pts — n=${n}/${50} requis`,
    labelR2: `R²=${r2.toFixed(2)} (ajusté: ${r2Adjusted.toFixed(2)}) — indicatif uniquement, non significatif sur n=${n}`
  };
}

/**
 * [REV29-33] Application des règles de validation du modèle utilisateur
 * Garantit que les scores Gemini respectent les contraintes TRL/VRIN/JTBD.
 */
export function applyModelRules(
  scores: Record<string, number>,
  model: StartupModel,
  githubData?: GitHubData,   // Paramètre typé
  financialData?: FinancialData // Paramètre typé
) {
  const adjusted = { ...scores };
  const logs: string[] = [];

  // ── NOUVEAU : Déduction DI depuis le stack LLM collecté ─────────────────
  if (githubData?.di_signal && adjusted.DI !== undefined) {
    const signalToDI: Record<string, number> = {
      'proprietary': 3,
      'finetuned':   2,
      'rag_custom':  1,
      'wrapper':     0,
      'none':        adjusted.DI, // pas de signal → conserver le score Gemini
    };
    const minDI = signalToDI[githubData.di_signal] ?? adjusted.DI;

    if (adjusted.DI < minDI) {
      logs.push(
        `[DI-SIGNAL] GitHub signal "${githubData.di_signal}" → DI rehaussé de ${adjusted.DI} à ${minDI}` +
        ` (${githubData.di_signal_reason ?? ''})`
      );
      adjusted.DI = minDI;
    }
  }

  // ── EXCEPTION FINTECH / CORE BANKING SYSTEM (ex: Qonto) ────────────────
  const isQontoOrFintechCore =
    model.nom?.toLowerCase().trim() === 'qonto' ||
    (model.vertical === 'FINT' && model.nom?.toLowerCase().trim().includes('qonto')) ||
    (model.di_infra_propre && model.nom?.toLowerCase().trim() === 'qonto');

  if (isQontoOrFintechCore && adjusted.DI !== undefined) {
    const targetDI = 3.0; // DI minimum pour Fintech avec Core Banking System propriétaire
    if (adjusted.DI < targetDI) {
      logs.push(
        `[EXC-FINTECH-DI] "${model.nom}" intègre d'importantes infrastructures de Core Banking propriétaires complexes. ` +
        `Le signal GitHub fermé 'none' est outrepassé. DI rehaussé de ${adjusted.DI} à ${targetDI}.`
      );
      adjusted.DI = targetDI;
    }
  }

  // Confirmer avec le niveau d'intégration de financialService
  if (financialData?.llm_stack?.integration_level && adjusted.DI !== undefined) {
    const integrationMinDI: Record<string, number> = {
      'Self-hosted': 3,
      'Fine-tuned':  2,
      'Hybrid':      1,
      'API':         0,
    };
    const minFromService = integrationMinDI[financialData.llm_stack.integration_level] ?? 0;
    if (adjusted.DI < minFromService) {
      logs.push(
        `[LLM-STACK] integration_level="${financialData.llm_stack.integration_level}" → DI minimum = ${minFromService}` +
        ` (source: ${financialData.llm_stack.confidence ?? 'inconnue'})`
      );
      adjusted.DI = minFromService;
    }
  }

  // ── TRL Rules [REV29-30] — inchangées ──────────────────────────────────
  if (model.trl_niveau) {
    const trlLevel = parseInt(model.trl_niveau);
    const { ipc_adjusted, di_adjusted, rules_applied } = applyTRLRules(
      { niveau: trlLevel, description: '', source: 'utilisateur' },
      adjusted.IPC,
      adjusted.DI,
      model.di_infra_propre
    );
    adjusted.IPC = ipc_adjusted;
    adjusted.DI = di_adjusted;
    logs.push(...rules_applied);
  }

  // ── VRIN Rules [REV31-32] — inchangées ─────────────────────────────────
  const diVRIN = computeVRINScore({
    valuable: model.di_vrin_valuable, rare: model.di_vrin_rare,
    inimitable: model.di_vrin_inimitable, non_substituable: model.di_vrin_non_sub,
    justifications: {},
  });
  if (diVRIN.score > 0 && adjusted.DI < diVRIN.score) {
    adjusted.DI = diVRIN.score;
    logs.push(`[REV32] VRIN DI=${diVRIN.score} : DI rehaussé au plancher VRIN`);
  }

  const adcVRIN = computeVRINScore({
    valuable: model.adc_vrin_valuable, rare: model.adc_vrin_rare,
    inimitable: model.adc_vrin_inimitable, non_substituable: model.adc_vrin_non_sub,
    justifications: {},
  });
  if (adcVRIN.score > 0 && adjusted.ADC < adcVRIN.score) {
    adjusted.ADC = adcVRIN.score;
    logs.push(`[REV31] VRIN ADC=${adcVRIN.score} : ADC rehaussé au plancher VRIN`);
  }

  if ((model.ipc_job_type === 'emotionnel' || model.ipc_job_type === 'social')
    && parseInt(model.ipc_job_criticite || '0') >= 3) {
    logs.push(`[REV33] Job ${model.ipc_job_type} critique détecté`);
  }

  return { adjusted, logs };
}

/**
 * [NEW] generateReporting — Génération de rapport de batch typé
 */
export function generateReporting(results: IROBatchResult[]): void {
  const n = results.length;
  if (n === 0) return;

  const meanDelta = results.reduce((acc, r) => acc + r.delta, 0) / n;
  const maxDelta = Math.max(...results.map(r => r.delta));
  
  // Utilisation du logger pour le reporting structuré
  logger.info(`[IRO-REPORTING] Batch Report: n=${n} | Mean Delta=${meanDelta.toFixed(2)} | Max Delta=${maxDelta.toFixed(2)}`);
  
  results.forEach(r => {
    if (r.delta > 10) {
      logger.warn(`[IRO-ALERT] Deviation critique pour ${r.name}: delta=${r.delta}`);
    }
  });
}

// ── Helpers statistiques ──────────────────────────────────────────────────────

function computeRanks(arr: number[]): number[] {
  const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks  = new Array(arr.length);
  sorted.forEach((item, rank) => { ranks[item.i] = rank + 1; });
  return ranks;
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n   = a.length;
  const ma  = a.reduce((s, x) => s + x, 0) / n;
  const mb  = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da  += (a[i] - ma) ** 2;
    db  += (b[i] - mb) ** 2;
  }
  return da * db > 0 ? num / Math.sqrt(da * db) : 0;
}
