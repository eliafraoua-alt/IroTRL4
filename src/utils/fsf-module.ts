/**
 * PATCH 4 — Approche 3 : Deux horizons séparés
 * Fichier : src/utils/fsf-module.ts  (nouveau fichier)
 *
 * Financial Sustainability Factor (FSF) — Module horizon 0–18 mois.
 *
 * PRINCIPE :
 *   Le modèle Cox prédit la survie structurelle à 36 mois (actifs VRIN).
 *   Le FSF prédit la survie opérationnelle à 18 mois (métriques financières).
 *   Les deux modules sont INDÉPENDANTS et n'échangent pas de données.
 *   Si les métriques financières sont absentes → FSF désactivé, Cox inchangé.
 *
 * UTILISATION DANS GOOGLE AI STUDIO :
 *   Le LLM extrait les métriques financières du pitch deck si disponibles.
 *   S'il ne les trouve pas, il renvoie fsf: undefined → module désactivé silencieusement.
 *   Aucun champ manquant ne pénalise le score Cox structurel.
 *
 * TRL : 2 — normatif, bêtas FSF non calibrés sur cohorte (manque d'annotations financières)
 */

import type { FSFInput, FSFResult, DualHorizonResult } from '../types/iro';

// ── Seuils FSF ───────────────────────────────────────────────────────────────

const FSF_THRESHOLDS = {
  ltv_cac: {
    critique:  1.0,   // < 1.0 → critique
    fragile:   2.0,   // < 2.0 → fragile
    sain:      3.0,   // < 3.0 → sain
    solide:    5.0,   // < 5.0 → solide
    // ≥ 5.0 → exceptionnel
  },
  roas: {
    critique:  0.50,  // < 50%  → critique
    fragile:   0.80,  // < 80%  → fragile
    sain:      1.00,  // < 100% → sain
    solide:    1.30,  // < 130% → solide
    // ≥ 130% → exceptionnel
  },
  growth_12m: {
    critique:  1.0,   // < ×1   → critique (décroissance)
    fragile:   1.5,   // < ×1.5 → fragile
    sain:      2.0,   // < ×2   → sain
    solide:    3.0,   // < ×3   → solide
    // ≥ ×3 → exceptionnel
  },
} as const;

// ── Score partiel [0–4] ───────────────────────────────────────────────────────

function scoreMetric(
  value: number,
  thresholds: { critique: number; fragile: number; sain: number; solide: number },
): number {
  if (value < thresholds.critique) return 0;
  if (value < thresholds.fragile)  return 1;
  if (value < thresholds.sain)     return 2;
  if (value < thresholds.solide)   return 3;
  return 4;
}

// ── Calcul du FSF ─────────────────────────────────────────────────────────────

/**
 * Calcule le Financial Sustainability Factor.
 * Retourne fsf_available = false si les données sont insuffisantes.
 *
 * Règle de disponibilité : au moins 2 métriques parmi (ltv/cac, roas, arr_growth)
 * doivent être fournies pour produire un score fiable.
 */
export function computeFSF(input?: FSFInput): FSFResult {
  if (!input) {
    return {
      fsf_available: false,
      data_completeness: 0,
      missing_fields: ['arr_growth_12m', 'roas', 'ltv_eur', 'cac_eur'],
      note: 'Données financières non fournies — module FSF désactivé. Le score Cox structurel reste valide et inchangé.',
    };
  }

  // Calcul des métriques disponibles
  const ltv_cac = (input.ltv_eur != null && input.cac_eur != null && input.cac_eur > 0)
    ? input.ltv_eur / input.cac_eur
    : undefined;

  const roas = input.roas;
  const growth = input.arr_growth_12m;
  const runway = input.runway_months
    ?? (input.monthly_burn_eur != null && input.arr_eur != null
      ? Math.round(input.arr_eur / 12 / input.monthly_burn_eur * 10) / 10
      : undefined);

  // Champs manquants
  const missing: string[] = [];
  if (ltv_cac === undefined) missing.push('ltv_eur / cac_eur');
  if (roas === undefined)    missing.push('roas');
  if (growth === undefined)  missing.push('arr_growth_12m');

  // Disponibilité : au moins 2 métriques
  const available_metrics = [ltv_cac, roas, growth].filter(v => v !== undefined).length;
  const data_completeness  = available_metrics / 3;

  if (available_metrics < 2) {
    return {
      fsf_available: false,
      data_completeness,
      missing_fields: missing,
      note: `Métriques insuffisantes (${available_metrics}/3 disponibles). Minimum requis : 2. Module FSF désactivé.`,
    };
  }

  // Scores partiels
  const ltv_cac_score = ltv_cac !== undefined
    ? scoreMetric(ltv_cac, FSF_THRESHOLDS.ltv_cac) : undefined;
  const roas_score = roas !== undefined
    ? scoreMetric(roas, FSF_THRESHOLDS.roas) : undefined;
  const growth_score = growth !== undefined
    ? scoreMetric(growth, FSF_THRESHOLDS.growth_12m) : undefined;

  // Poids adaptatifs selon disponibilité
  const weights: { ltv_cac: number; roas: number; growth: number } = { ltv_cac: 0.40, roas: 0.35, growth: 0.25 };

  // Redistribuer le poids des métriques absentes
  let total_weight = 0;
  let weighted_sum = 0;
  if (ltv_cac_score !== undefined) { weighted_sum += ltv_cac_score * weights.ltv_cac; total_weight += weights.ltv_cac; }
  if (roas_score    !== undefined) { weighted_sum += roas_score    * weights.roas;    total_weight += weights.roas; }
  if (growth_score  !== undefined) { weighted_sum += growth_score  * weights.growth;  total_weight += weights.growth; }

  const fsf_score = total_weight > 0
    ? Math.round((weighted_sum / total_weight) * 100) / 100
    : undefined;

  if (fsf_score === undefined) {
    return {
      fsf_available: false,
      data_completeness,
      missing_fields: missing,
      note: 'Calcul FSF impossible malgré métriques partielles. Module désactivé.',
    };
  }

  // Label FSF
  const fsf_label: FSFResult['fsf_label'] =
    fsf_score < 1   ? 'critique'     :
    fsf_score < 2   ? 'fragile'      :
    fsf_score < 3   ? 'sain'         :
    fsf_score < 3.5 ? 'solide'       : 'exceptionnel';

  // Survie opérationnelle à 18 mois
  // Approximation logistique : P(survie 18m) = sigmoid(fsf_score - 2) × 0.5 + 0.5
  // FSF=0 → ~50%, FSF=2 → ~73%, FSF=3.73 → ~93%, FSF=4 → ~95%
  const survival_18m = Math.min(0.97, Math.max(0.30,
    1 / (1 + Math.exp(-(fsf_score - 2) * 1.5)) * 0.5 + 0.5
  ));

  const survival_18m_label =
    survival_18m >= 0.85 ? `Traction solide — survie opérationnelle à 18 mois estimée à ${Math.round(survival_18m * 100)}%` :
    survival_18m >= 0.70 ? `Métriques correctes — survie opérationnelle à 18 mois estimée à ${Math.round(survival_18m * 100)}%` :
    survival_18m >= 0.55 ? `Métriques fragiles — survie opérationnelle à 18 mois estimée à ${Math.round(survival_18m * 100)}%` :
                           `Métriques critiques — risque opérationnel à 18 mois élevé (${Math.round(survival_18m * 100)}%)`;

  const note = missing.length > 0
    ? `FSF calculé sur ${available_metrics}/3 métriques. Champs manquants : ${missing.join(', ')}. Score partiel — à interpréter avec prudence.`
    : `FSF calculé sur 3/3 métriques. Score pleinement fiable pour l'horizon 18 mois.`;

  return {
    fsf_available: true,
    fsf_score,
    fsf_label,
    ltv_cac_ratio: ltv_cac !== undefined ? Math.round(ltv_cac * 100) / 100 : undefined,
    roas_score,
    growth_score,
    survival_18m_operational: Math.round(survival_18m * 1000) / 1000,
    survival_18m_label,
    data_completeness,
    missing_fields: missing,
    note,
  };
}

// ── buildDualHorizon ─────────────────────────────────────────────────────────

/**
 * Construit le résultat deux horizons à partir du résultat Cox (structurel)
 * et du résultat FSF (opérationnel).
 *
 * Les deux modules sont indépendants. Le FSF peut être absent sans affecter Cox.
 */
export function buildDualHorizon(
  coxS36: number,
  coxS36Lo: number | undefined,
  coxS36Hi: number | undefined,
  coxRiskProfile: 'faible' | 'modéré' | 'élevé' | 'critique',
  coxCovariables: string[],
  fsf: FSFResult,
): DualHorizonResult {

  const structural_label =
    coxRiskProfile === 'faible'   ? `Risque structurel FAIBLE — actifs VRIN défendables à 36 mois (S = ${Math.round(coxS36 * 100)}%)` :
    coxRiskProfile === 'modéré'   ? `Risque structurel MODÉRÉ — actifs partiellement défendables (S = ${Math.round(coxS36 * 100)}%)` :
    coxRiskProfile === 'élevé'    ? `Risque structurel ÉLEVÉ — actifs insuffisants pour 36 mois (S = ${Math.round(coxS36 * 100)}%)` :
                                    `Risque structurel CRITIQUE — défaillance probable à 36 mois (S = ${Math.round(coxS36 * 100)}%)`;

  const structural_note = [
    '⚠ Horizon long terme (36 mois) — actifs structurels VRIN uniquement.',
    'Ne reflète pas la traction financière court terme.',
    'EPV = 6.7 (< 10 requis) — estimations directionnelles.',
  ].join(' ');

  // Lecture combinée
  let combined_reading: string;
  let dominant_risk: DualHorizonResult['dominant_risk'];

  if (!fsf.fsf_available) {
    combined_reading = `Horizon structurel (36m) : ${coxRiskProfile}. Horizon opérationnel (18m) : non calculable (données financières absentes). Verdict partiel — seul le profil structurel est évalué.`;
    dominant_risk = coxRiskProfile === 'faible' ? 'aucun' : 'structurel';
  } else {
    const fsf_ok = (fsf.fsf_score ?? 0) >= 3.0;
    const cox_ok = coxS36 >= 0.50;

    if (cox_ok && fsf_ok) {
      combined_reading = `Profil favorable sur les deux horizons : traction financière solide (FSF = ${fsf.fsf_score?.toFixed(1)}/4) and actifs structurels défendables (S36m = ${Math.round(coxS36 * 100)}%).`;
      dominant_risk = 'aucun';
    } else if (!cox_ok && fsf_ok) {
      combined_reading = `Tension horizon court/long terme : traction financière solide (FSF = ${fsf.fsf_score?.toFixed(1)}/4) mais actifs structurels insuffisants pour 36 mois (S = ${Math.round(coxS36 * 100)}%). La croissance actuelle ne protège pas contre la commoditisation à terme.`;
      dominant_risk = 'structurel';
    } else if (cox_ok && !fsf_ok) {
      combined_reading = `Tension inverse : actifs structurels défendables (S36m = ${Math.round(coxS36 * 100)}%) mais métriques financières fragiles (FSF = ${fsf.fsf_score?.toFixed(1)}/4). Risque de défaillance opérationnelle avant que les actifs structurels produisent leur effet protecteur.`;
      dominant_risk = 'opérationnel';
    } else {
      combined_reading = `Risque élevé sur les deux horizons : métriques financières fragiles (FSF = ${fsf.fsf_score?.toFixed(1)}/4) ET actifs structurels insuffisants (S36m = ${Math.round(coxS36 * 100)}%).`;
      dominant_risk = 'les deux';
    }
  }

  return {
    structural: {
      survival_36m:     coxS36,
      survival_36m_lo:  coxS36Lo,
      survival_36m_hi:  coxS36Hi,
      risk_profile:     coxRiskProfile,
      label:            structural_label,
      covariables_used: coxCovariables,
      note:             structural_note,
    },
    operational: {
      available:         fsf.fsf_available,
      survival_18m:      fsf.survival_18m_operational,
      label:             fsf.survival_18m_label,
      fsf_score:         fsf.fsf_score,
      note:              fsf.note,
    },
    combined_reading,
    dominant_risk,
  };
}

// ── G3 — Augmenter le taux d'activation du FSF ───────────────────────────────

export interface FSFActivationResult {
  can_compute:       boolean;
  available_metrics: string[];
  missing_metrics:   string[];
  activation_note:   string;
}

export function checkFSFActivation(fsf_input: any): FSFActivationResult {
  const REQUIRED = ['arr_eur', 'burn_rate_eur', 'runway_mois', 'nrr_pct'];
  const available = REQUIRED.filter(k => fsf_input?.[k] != null && fsf_input[k] > 0);
  const missing   = REQUIRED.filter(k => !available.includes(k));

  // Seuil abaissé à 1 (au lieu de 2) si ARR ou Runway présent
  const hasKeyMetric = available.includes('arr_eur') || available.includes('runway_mois');
  const can_compute  = available.length >= 2 || (hasKeyMetric && available.length >= 1);

  return {
    can_compute,
    available_metrics: available,
    missing_metrics:   missing,
    activation_note:   can_compute
      ? `FSF calculé sur ${available.length}/4 métriques`
      : `FSF non calculable — métriques manquantes : ${missing.join(', ')}. Ajouter dans les annexes financières.`,
  };
}

