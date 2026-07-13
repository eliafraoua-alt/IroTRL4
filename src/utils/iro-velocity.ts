/**
 * src/utils/iro-velocity.ts — IRO Velocity & Dynamique temporelle
 * IRO Strength v6.6 — Antigravity Intelligence Platform
 *
 * Opérationnalise l'hypothèse H5 du rapport pédagogique :
 *   "La trajectoire IRO (variation t₀→t₀+n) prédit mieux la survie à t₀+36
 *    que le niveau IRO absolu à t₀."
 *
 * Intègre également :
 *   - Fichman & Levinthal (1991) — honeymoon effect × stade
 *   - Vélocité de commoditisation DI : DI_eff = DI × (1 - VMM/4)
 *   - Coefficient de pondération honeymoon appliqué au modèle Cox
 *
 * STATUT : TRL 2 — normatif, requiert validation longitudinale
 */

import { 
  DimensionScores, 
  IROVelocity, 
  VelocitySnapshot, 
  VelocityLabel, 
  HoneymoonProfile, 
  HoneymoonStade, 
  DIVelocity 
} from '../types/iro';
import { AuditEntry } from './audit-journal';

// ── Constantes ─────────────────────────────────────────────────────────────

const VELOCITY_THRESHOLDS = {
  forte_acceleration: 1.5,
  progression_saine:  0.5,
  stable_low:        -0.5,
  degradation_mod:   -1.5,
} as const;

// Coefficient Cox ajouté/soustrait en fonction de la vélocité IRO
// Basé sur l'intuition que Δ+1pt/mois ≈ -0.02 sur le log-hazard
const BETA_VELOCITY = -0.020;

// ── Honeymoon effect (Fichman & Levinthal, 1991) ───────────────────────────

interface SectorHoneymoonCal {
  disc_weight:  number;  // 0-6m
  valid_weight: number;  // 6-pic_start
  peak_weight:  number;  // pic_start-pic_end  ← mortalité maximale
  effic_weight: number;  // pic_end-48m
  pic_start:    number;  // mois début pic
  pic_end:      number;  // mois fin pic
}

export const SECTOR_HONEYMOON: Record<string, SectorHoneymoonCal> = {
  // Santé IA : réglementation longue → ressources disponibles + longtemps
  // Pic tardif à ~28-36m quand les fonds pre-CE s'épuisent
  HLTH: { disc_weight: 0.70, valid_weight: 0.85, peak_weight: 1.20, effic_weight: 1.05, pic_start: 24, pic_end: 36 },

  // Finance réglementée / LegalTech : cycle vente long, pic ~20-28m
  FINT: { disc_weight: 0.75, valid_weight: 0.88, peak_weight: 1.30, effic_weight: 1.08, pic_start: 18, pic_end: 28 },
  LEGL: { disc_weight: 0.76, valid_weight: 0.88, peak_weight: 1.28, effic_weight: 1.07, pic_start: 20, pic_end: 28 },

  // SaaS B2B : cycle standard, pic ~15-22m (ACV à renégocier)
  SAAS: { disc_weight: 0.75, valid_weight: 0.90, peak_weight: 1.38, effic_weight: 1.10, pic_start: 14, pic_end: 22 },

  // IA générative B2C : commoditisation rapide, pic très précoce ~8-14m
  B2C:  { disc_weight: 0.80, valid_weight: 0.92, peak_weight: 1.52, effic_weight: 1.15, pic_start: 8,  pic_end: 16 },

  // Industrie / MLOps / Infra : cycles longs, pic ~20-30m
  INDU: { disc_weight: 0.72, valid_weight: 0.86, peak_weight: 1.22, effic_weight: 1.06, pic_start: 20, pic_end: 30 },

  // Défaut universel (Fichman & Levinthal 1991 original)
  DFLT: { disc_weight: 0.75, valid_weight: 0.90, peak_weight: 1.35, effic_weight: 1.10, pic_start: 12, pic_end: 24 },
};

/**
 * computeHoneymoonProfile — VERSION SECTORIELLE (remplace l'existante)
 *
 * @param age_mois  âge de la startup en mois (certifié Pappers si disponible)
 * @param vertical  code vertical IRO ('HLTH'|'FINT'|'LEGL'|'SAAS'|'B2C'|'INDU')
 *                  optionnel — fallback 'DFLT' si absent (rétrocompatible)
 */
export function computeHoneymoonProfile(
  age_mois: number,
  vertical?: string
): HoneymoonProfile {
  const calKey = vertical && SECTOR_HONEYMOON[vertical] ? vertical : 'DFLT';
  const cal    = SECTOR_HONEYMOON[calKey];

  let stade: HoneymoonStade;
  let weight: number;
  let mortality_peak = false;
  let honeymoon_level: HoneymoonProfile['honeymoon_level'];
  let pivot_cost: HoneymoonProfile['pivot_cost'];
  let interpretation: string;
  let action_prioritaire: string;

  if (age_mois <= 6) {
    stade = 'discovery'; weight = cal.disc_weight;
    honeymoon_level = 'haute'; pivot_cost = 'faible';
    interpretation = `Phase initiale (${calKey}) — ressources intactes, hazard réduit ×${weight}`;
    action_prioritaire = 'Valider l\'hypothèse fondatrice · Construire ADC et IPC avant l\'épuisement des ressources';

  } else if (age_mois <= cal.pic_start) {
    stade = 'validation'; weight = cal.valid_weight;
    honeymoon_level = 'décroissante'; pivot_cost = 'modéré';
    interpretation = `Validation (${calKey}) — ressources en déclin, hazard légèrement réduit ×${weight}`;
    action_prioritaire = 'Activer les premières intégrations IPC critiques avant le pic de mortalité';

  } else if (age_mois <= cal.pic_end) {
    stade = 'pic_risque'; weight = cal.peak_weight; mortality_peak = true;
    honeymoon_level = 'épuisée'; pivot_cost = 'élevé';
    interpretation = `⚠ PIC MORTALITÉ (${calKey}) — hazard ×${weight} — ressources initiales épuisées`;
    action_prioritaire = 'WAR ROOM : consolider la trésorerie · Passer à profitabilité ou lever dans les 90j · Éviter tout CAPEX non-critique';

  } else if (age_mois <= 48) {
    stade = 'efficiency'; weight = cal.effic_weight;
    honeymoon_level = 'absente'; pivot_cost = 'élevé';
    interpretation = `Efficiency (${calKey}) — pic dépassé, sortie du honeymoon, hazard ×${weight}`;
    action_prioritaire = 'Focus ARR et rétention · Optimiser le coût d\'acquisition · Préparer Série A';

  } else {
    stade = 'mature'; weight = 1.00;
    honeymoon_level = 'absente'; pivot_cost = 'maximal';
    interpretation = `Maturité — plus de honeymoon, reconfiguration stratégique (Teece 1997)`;
    action_prioritaire = 'Dynamic Capabilities — sensing/seizing/reconfiguring · Expansion géographique';
  }

  return {
    age_mois,
    stade,
    weight,
    mortality_peak,
    pivot_cost,
    honeymoon_level,
    interpretation,
    action_prioritaire,
    sector_cal: calKey,
  };
}

// ── DI effectif (vélocité de commoditisation) ──────────────────────────────

/**
 * Calcule le DI effectif corrigé par la vélocité de commoditisation LLM.
 * Recommandation rapport pédagogique : DI_eff = DI × (1 - VMM/4)
 *
 * @param di_score Score DI déclaré [0–4]
 * @param vmm Vélocité marché LLM issue du SRD [0–4]
 */
export function computeDIVelocity(di_score: number, vmm: number): DIVelocity {
  const di_effectif = Math.round(di_score * (1 - vmm / 4) * 100) / 100;
  const delta_depreciation = Math.round((di_score - di_effectif) * 100) / 100;

  let risque_label: DIVelocity['risque_label'];
  let interpretation: string;

  if (delta_depreciation <= 0.25) {
    risque_label = 'nul';
    interpretation =
      `DI=${di_score} résistant : VMM faible (${vmm}/4) — l'avantage infra se déprécie lentement. ` +
      'Secteur à évolution lente (médical, juridique, défense).';
  } else if (delta_depreciation <= 0.75) {
    risque_label = 'faible';
    interpretation =
      `DI=${di_score} partiellement exposé (DI effectif=${di_effectif}). ` +
      'La commoditisation est en cours mais la fenêtre de défendabilité reste ouverte (12-18 mois).';
  } else if (delta_depreciation <= 1.5) {
    risque_label = 'modéré';
    interpretation =
      `DI=${di_score} → DI effectif=${di_effectif} : perte de ${delta_depreciation} point(s) par effet VMM. ` +
      'L\'avantage infrastructure est en train de se commoditiser. ' +
      'Recommandation : construire ADC et IPC en parallèle avant que DI ne tombe à 0.';
  } else {
    risque_label = 'critique';
    interpretation =
      `DI=${di_score} → DI effectif=${di_effectif} : dépréciation sévère (-${delta_depreciation} pts). ` +
      'Dans un marché LLM à VMM maximum, cet avantage infrastructure sera neutralisé ' +
      'en quelques mois. Sans ADC ou IPC compensatoire, le plancher REV1 (IRO≤40) ' +
      'deviendra actif prochainement.';
  }

  return { di_score, vmm, di_effectif, delta_depreciation, risque_label, interpretation };
}

// ── IRO Velocity (H5) ──────────────────────────────────────────────────────

/**
 * Calcule la vélocité IRO à partir de l'historique du journal d'audit.
 * Requiert au minimum 2 évaluations pour le même startup.
 *
 * @param entries Entrées triées par timestamp ASC (du plus ancien au plus récent)
 */
export function computeIROVelocity(entries: AuditEntry[]): IROVelocity | null {
  if (entries.length < 2) return null;

  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const first = sorted[0];
  const last  = sorted[sorted.length - 1];

  const ms_diff = new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime();
  const period_months = Math.max(1, Math.round(ms_diff / (1000 * 60 * 60 * 24 * 30.44)));

  const delta_iro = last.iro_total - first.iro_total;
  const velocity_global = Math.round((delta_iro / period_months) * 100) / 100;

  // Vélocité par dimension
  const DIMS = ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'] as const;
  const dim_velocities = {} as Record<keyof DimensionScores, number>;
  for (const dim of DIMS) {
    const d_first = (first as unknown as Record<string, number>)[dim] ?? 0;
    const d_last  = (last  as unknown as Record<string, number>)[dim] ?? 0;
    dim_velocities[dim] = Math.round(((d_last - d_first) / period_months) * 100) / 100;
  }

  // Label de vélocité
  let velocity_label: VelocityLabel;
  let velocity_color: string;
  if (velocity_global > VELOCITY_THRESHOLDS.forte_acceleration) {
    velocity_label = 'accélération forte';
    velocity_color = '#3B6D11'; // green-800
  } else if (velocity_global > VELOCITY_THRESHOLDS.progression_saine) {
    velocity_label = 'progression saine';
    velocity_color = '#639922'; // green-600
  } else if (velocity_global > VELOCITY_THRESHOLDS.stable_low) {
    velocity_label = 'stable';
    velocity_color = '#888780'; // gray-400
  } else if (velocity_global > VELOCITY_THRESHOLDS.degradation_mod) {
    velocity_label = 'dégradation modérée';
    velocity_color = '#BA7517'; // amber-600
  } else {
    velocity_label = 'dégradation critique';
    velocity_color = '#A32D2D'; // red-600
  }

  // Trend (volatilité inter-snapshots)
  const iro_series = sorted.map(e => e.iro_total);
  const diffs = iro_series.slice(1).map((v, i) => v - iro_series[i]);
  const sign_changes = diffs.slice(1).filter((d, i) => Math.sign(d) !== Math.sign(diffs[i])).length;
  let trend: IROVelocity['trend'];
  if (sign_changes >= Math.floor(diffs.length / 2)) {
    trend = 'volatile';
  } else if (delta_iro > 2) {
    trend = 'ascending';
  } else if (delta_iro < -2) {
    trend = 'descending';
  } else {
    trend = 'stable';
  }

  // Confiance selon nombre de snapshots
  const confidence: IROVelocity['confidence'] =
    sorted.length >= 4 ? 'high' :
    sorted.length >= 2 ? 'medium' : 'low';

  // Honeymoon weight du dernier snapshot (si age_mois disponible)
  const honeymoon_weight = 1.0; // Neutre par défaut — nécessite age_mois externe

  // Ajustement Cox : β_velocity × velocity_global
  const cox_adjustment = Math.round(BETA_VELOCITY * velocity_global * 1000) / 1000;

  // Interprétation
  const interpretation = buildVelocityInterpretation(
    velocity_label, velocity_global, period_months, delta_iro, dim_velocities, trend
  );

  const snapshots: VelocitySnapshot[] = sorted.map(e => ({
    timestamp: e.timestamp,
    iro_total: e.iro_total,
    iro_cr: e.iro_cr,
    scores: { DI: e.DI, ADC: e.ADC, IPC: e.IPC, AR: e.AR, CA: e.CA, GCH: e.GCH },
  }));

  return {
    startup_name: first.startup_name,
    n_snapshots: sorted.length,
    velocity_global,
    velocity_label,
    velocity_color,
    delta_iro,
    period_months,
    dim_velocities,
    trend,
    confidence,
    snapshots,
    honeymoon_weight,
    cox_adjustment,
    interpretation,
  };
}

// ── Ajustement Cox avec honeymoon + vélocité ───────────────────────────────

/**
 * Calcule le log-hazard ajusté en combinant :
 *   1. Vélocité IRO (H5) → β_velocity × velocity_global
 *   2. Honeymoon weight (Fichman & Levinthal) → multiplicateur du hazard
 *
 * À utiliser dans coxFull() comme terme additionnel au linear predictor.
 */
export function computeTemporalAdjustment(params: {
  age_mois: number;
  vertical?: string;
  velocity?: IROVelocity | null;
}): {
  honeymoon: HoneymoonProfile;
  lp_velocity_adjustment: number;   // Ajout au linear predictor Cox
  hazard_multiplier: number;         // Multiplicateur final sur le hazard
  explanation: string;
} {
  const honeymoon = computeHoneymoonProfile(params.age_mois, params.vertical);

  const lp_velocity = 0; // PATCH CORRECTIF 4 : set to 0 to avoid double counting as velocity is now handled directly in lp_base of Cox model.

  // Le multiplicateur final combine honeymoon weight et ajustement vélocité
  const hazard_multiplier = honeymoon.weight * Math.exp(lp_velocity);

  const explanation = [
    `Âge: ${params.age_mois} mois → stade ${honeymoon.stade} (weight honeymoon: ×${honeymoon.weight})`,
    params.velocity
      ? `Vélocité IRO: ${params.velocity.velocity_global > 0 ? '+' : ''}${params.velocity.velocity_global} pts/mois → Traitée dans Cox`
      : 'Vélocité IRO: non disponible (snapshot unique)',
    `Multiplicateur hazard final: ×${hazard_multiplier.toFixed(3)}`,
  ].join(' | ');

  return { honeymoon, lp_velocity_adjustment: lp_velocity, hazard_multiplier, explanation };
}

// ── Helpers internes ───────────────────────────────────────────────────────

function buildVelocityInterpretation(
  label: VelocityLabel,
  velocity: number,
  period: number,
  delta: number,
  dims: Record<keyof DimensionScores, number>,
  trend: IROVelocity['trend'],
): string {
  const sign = velocity >= 0 ? '+' : '';
  const top_dim = Object.entries(dims)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${v >= 0 ? '+' : ''}${v} pts/mois`)
    .join(', ');

  const trend_label =
    trend === 'volatile' ? 'trajectoire volatile (signaux contradictoires)' :
    trend === 'ascending' ? 'tendance haussière continue' :
    trend === 'descending' ? 'tendance baissière continue' : 'trajectoire stable';

  return (
    `Vélocité ${label} (${sign}${velocity} pts IRO/mois sur ${period} mois, Δtotal: ${sign}${delta} pts). ` +
    `Dimensions motrices : ${top_dim}. Tendance : ${trend_label}. ` +
    (label === 'dégradation critique'
      ? 'ALERTE H5 : la trajectoire IRO prédit une dégradation structurelle — ' +
        'le niveau absolu peut masquer une érosion continue des actifs défendables.'
      : label === 'accélération forte'
      ? 'Signal H5 positif : la trajectoire confirme une accumulation d\'actifs robuste, ' +
        'potentiellement plus prédictive que le niveau IRO absolu pour la survie à 36 mois.'
      : 'Surveillance H5 recommandée sur les 3 prochains mois.')
  );
}
