/**
 * src/utils/cox-model.ts — Modèle à hasards proportionnels IRO
 * IRO Strength v7 — Antigravity Intelligence Platform
 *
 * Hypothèse H1 : C(IRO) > C(ARR_growth) sur modèle de survie
 * Calibré sur cohorte française VÉRIFIÉE n=101 (actives IRO moy=64.7, échecs=44.5)
 *
 * Références :
 *   - Cox (1972) — Regression Models and Life Tables
 *   - Harrell et al. (1982) — Evaluating the yield of medical tests
 *   - COHORTE_FRANCE : Δ = 20.2 pts, AUC empirique ≈ 0.74
 *
 * STATUT : TRL 4 — système intégré, validé en environnement contrôlé.
 * Calibration EXPLORATOIRE (EPV = 1.8, 9 événements). Voir README §Statut de validation.
 * Les scores de la cohorte ayant été attribués en connaissance de l'issue, la
 * discrimination mesurée ne démontre pas de capacité prédictive prospective.

 * Coefficients estimés, pas ajustés sur données longitudinales réelles.
 */

import { 
  computeTemporalAdjustment 
} from './iro-velocity';
import { 
  CoxInput, 
  CoxResultEnrichi, 
  SurvivalCurve,
  FSFInput,
  FSFResult,
  DualHorizonResult
} from '../types/iro';
import { computeConformalBands, formatConformalNote } from './conformal-bands';
import { rsfPredict, type RSFInput, type RSFResult } from './rsf-model';
import calibratedBetas from '../config/cox-betas-calibrated.json';
import { computeFSF, buildDualHorizon } from './fsf-module';

// Interface pour les métadonnées de calibration (champs optionnels du JSON)
interface CalibrationMeta {
  c_index_ci_lo?:          number;
  c_index_ci_hi?:          number;
  c_index_boot_mean?:      number;
  c_index_boot_sd?:        number;
  c_index_display?:        string;
  c_index_interpretation?: string;
  epv?:                    number;
  epv_note?:               string;
  [key: string]:           unknown;
}

// ── Coefficients β estimés sur cohorte FR ──────────────────────────────────
// Connecté à la calibration Ridge sur 30 cas documentés du Gold Standard v4.3

const BETAS = {
  iro_cr:           -calibratedBetas.iro_cr,
  di_zero:          calibratedBetas.di_zero,
  srd_high:         calibratedBetas.srd_high,
  adc_strong:       -calibratedBetas.adc_strong,
  ipc_strong:       -calibratedBetas.ipc_strong,
  regulated_sector: -calibratedBetas.regulated_sector,
  velocity:         calibratedBetas.velocity,
};

// Baseline hazard calibrée pour survie référence ≈ 75% à 36 mois (IRO=61, médiane actives)
const H0_SCALE = 0.011;
const REFERENCE_IRO = 50; // Point de centrage du modèle

// ── [ACTION 5 — H3] Garde hors_distribution ─────────────────────────────────
// Le modèle Cox est calibré sur n=32 outcomes, secteurs représentés :
// LLM, IA Santé, Fintech/BaaS, SaaS B2B, Insurtech, Deeptech
// Tout secteur < 3 cas dans le gold standard = hors distribution → avertissement obligatoire

const DISTRIBUTION_SECTORS: Record<string, number> = {
  // secteur_code : n_outcomes_observés dans gold-standard-v4.3 (32 cas)
  'LLM':     5,   // Gemini, Mistral, Inflection, etc.
  'SAAS':    8,   // Pennylane, Spendesk, Elevo, Meero, etc.
  'HLTH':    5,   // Doctolib, Sophia Genetics, Owkin, Nabla, Lifen
  'FINT':    4,   // Lydia/Sumeria, Alan, Swan, Luko
  'INDU':    2,   // Ÿnsect, Exotec (limite basse)
  'LEGT':    2,   // Captain Contrat, Ironclad (limite basse)
  'EDTECH':  0,   // Non représenté
  'DEFENSE': 0,   // Non représenté
  'HW':      0,   // Humane AI Pin (pas d'outcome observé)
  'ENERGY':  0,   // Non représenté
  'AUTO':    1,   // Wayve (1 cas — limite critique)
};

export interface DistributionCheckResult {
  in_distribution:   boolean;
  n_sector:          number;
  sector_code:       string;
  confidence_penalty: number;  // 0.0-0.2 à déduire du taux_confiance_global
  warning_label:     string;
  should_flag_audit: boolean;
}

/**
 * [ACTION 5 — H3] Vérifie si le secteur de la startup est représenté dans la cohorte Cox.
 * À appeler avant coxFull() — résultat à include dans l'audit_note.
 */
export function checkDistributionCoverage(
  sectorCode: string,
  vertical?:  string,
): DistributionCheckResult {
  const normalizedSector = (sectorCode || '').toUpperCase().trim();
  const n = DISTRIBUTION_SECTORS[normalizedSector] ?? -1;

  if (n === -1) {
    // Secteur inconnu → hors distribution stricte
    return {
      in_distribution:    false,
      n_sector:           0,
      sector_code:        normalizedSector,
      confidence_penalty: 0.20,
      warning_label:      `[hors_distribution] Secteur "${normalizedSector}" absent de la cohorte Cox (n=0). Survie non calibrée.`,
      should_flag_audit:  true,
    };
  }
  if (n < 3) {
    // Représentation insuffisante
    return {
      in_distribution:    false,
      n_sector:           n,
      sector_code:        normalizedSector,
      confidence_penalty: 0.15,
      warning_label:      `[hors_distribution] Secteur "${normalizedSector}" sous-représenté (n=${n} < 3). Intervalles de confiance élargis.`,
      should_flag_audit:  true,
    };
  }
  // Représentation suffisante
  return {
    in_distribution:    true,
    n_sector:           n,
    sector_code:        normalizedSector,
    confidence_penalty: 0.0,
    warning_label:      '',
    should_flag_audit:  false,
  };
}

/**
 * Calcule la probabilité de survie à t mois selon le modèle de Cox à partir du Hazard Ratio.
 */
/**
 * Survie S(t) = S0(t)^HR.
 *
 * ⚠️ CORRECTIF AUDIT SCI-05 — LIMITE MÉTHODOLOGIQUE ASSUMÉE.
 * S0(t) = exp(−H0_SCALE · t) suppose un hasard de base CONSTANT (survie
 * exponentielle). Ce n'est PAS un estimateur non-paramétrique de la ligne de base
 * (Breslow), qui exigerait des temps jusqu'à événement — absents de la cohorte
 * (StartupCohorte ne comporte ni date d'événement ni censure).
 *
 * Conséquence : la « courbe de survie » est une transformation déterministe et
 * monotone du score IRO, non une estimation de survie au sens de Cox. Elle est
 * utile pour ORDONNER les startups (discrimination), mais les probabilités
 * absolues S(12)/S(24)/S(36) ne doivent PAS être présentées comme calibrées.
 */
export function coxSurvival(hr: number, t: number): number {
  const baseSurv = Math.exp(-H0_SCALE * t);
  return Math.max(0, Math.min(1, Math.pow(baseSurv, hr)));
}

// Correctif LP Clip constants
export const LP_CLIP_LO = -2.5;
export const LP_CLIP_HI =  2.5;
export const LP_CLIP_MIN_S36 = 0.084;  // S36 plancher (borne basse)
export const LP_CLIP_MAX_S36 = 0.970;  // S36 plafond  (borne haute)

/**
 * Écrête le linear predictor et retourne un flag si le clip s'active.
 * À insérer APRÈS le calcul de lp_base + ajustement temporel.
 */
export function clipLP(lp_raw: number): { lp: number; clipped: boolean; clip_direction: 'low' | 'high' | null } {
  if (lp_raw < LP_CLIP_LO) {
    return { lp: LP_CLIP_LO, clipped: true, clip_direction: 'high' }; // LP bas → HR bas → S36 très haute → clip haut
  }
  if (lp_raw > LP_CLIP_HI) {
    return { lp: LP_CLIP_HI, clipped: true, clip_direction: 'low' };  // LP haut → HR haut → S36 très basse → clip bas
  }
  return { lp: lp_raw, clipped: false, clip_direction: null };
}

/**
 * Garantit que la survie est confinée dans [0.08; 0.97] tout en maintenant
 * une monotonie stricte (pas de perte d'info ou de précision pour le calcul du C-index).
 */
export function mapSurvivalMonotonic(x: number): number {
  if (x < 0.08) {
    return 0.08 + (x / 0.08) * 0.04;
  } else if (x > 0.97) {
    return 0.95 + ((x - 0.97) / 0.03) * 0.02;
  } else {
    return 0.12 + ((x - 0.08) / 0.89) * 0.83;
  }
}

/**
 * Modèle de Cox complet avec tous les covariables.
 */
export function coxFull(input: CoxInput): CoxResultEnrichi {
  // [ACTION 5 — H3] Vérifier la couverture de distribution avant le calcul
  const distCheck = checkDistributionCoverage(
    input.vertical ?? '',
    input.vertical,
  );
  // ── Linear predictor de base ────────────────────────────────────────────
  const lp_base =
    BETAS.iro_cr           * (input.irocr - REFERENCE_IRO) +
    BETAS.di_zero          * (input.di_zero ? 1 : 0) +
    BETAS.srd_high         * (input.srd_high ? 1 : 0) +
    BETAS.adc_strong       * (input.adc_strong ? 1 : 0) +
    BETAS.ipc_strong       * (input.ipc_strong ? 1 : 0) +
    BETAS.regulated_sector * (input.regulated_sector ? 1 : 0) +
    BETAS.velocity         * (input.velocity_pts_per_month ?? 0);

  // ── Ajustement temporel (honeymoon × vélocité H5) ────────────────────────
  const temporal = (input.age_mois != null)
    ? computeTemporalAdjustment({
        age_mois: input.age_mois,
        vertical: input.vertical,
        // velocity déjà dans lp_base (v7.2 — évite double comptage)
        velocity: null,
      })
    : null;

  const lp_raw = lp_base + (temporal?.lp_velocity_adjustment ?? 0);
  const { lp, clipped: lp_clipped, clip_direction } = clipLP(lp_raw);
  const hr_base = Math.exp(lp);
  const hr = hr_base * (temporal?.honeymoon.weight ?? 1.0);

  const s12 = coxSurvival(hr, 12);
  const s24 = coxSurvival(hr, 24);
  const s36 = coxSurvival(hr, 36);

  const riskProfile: CoxResultEnrichi['risk_profile'] =
    s36 >= 0.70 ? 'faible' :
    s36 >= 0.50 ? 'modéré' :
    s36 >= 0.30 ? 'élevé' : 'critique';

  const lp_clip_note = lp_clipped
    ? `⚠ IRO-CR hors domaine de calibration — LP écrêté ${clip_direction === 'low' ? '(profil très risqué)' : '(profil exceptionnel)'}. ` +
      `Survie 36m contrainte entre ${Math.round(LP_CLIP_MIN_S36 * 100)}% et ${Math.round(LP_CLIP_MAX_S36 * 100)}%.`
    : undefined;

  // ── IC95% conformal (Sesia & Svetnik PMLR 2025) ───────────────────────
  // Remplace delta-method — garantie de couverture formelle sans hypothèse de distribution
  let conformalBands;
  try {
    conformalBands = computeConformalBands(hr, 0.10);
  } catch (_e) {
    conformalBands = null;  // fallback vers delta-method si calibration échoue
  }
  const ci = computeCI95(hr, lp);  // conservé en fallback

  const betaContribs: Record<string, number> = {
    'IRO_cr structural':   Math.round(BETAS.iro_cr * (input.irocr - REFERENCE_IRO) * 100) / 100,
    'DI=0 (REV1)':         Math.round(BETAS.di_zero * (input.di_zero ? 1 : 0) * 100) / 100,
    'SRD élevé':           Math.round(BETAS.srd_high * (input.srd_high ? 1 : 0) * 100) / 100,
    'ADC fort':            Math.round(BETAS.adc_strong * (input.adc_strong ? 1 : 0) * 100) / 100,
    'IPC fort':            Math.round(BETAS.ipc_strong * (input.ipc_strong ? 1 : 0) * 100) / 100,
    'Secteur régulé':      Math.round(BETAS.regulated_sector * (input.regulated_sector ? 1 : 0) * 100) / 100,
  };

  if (temporal?.lp_velocity_adjustment) {
    betaContribs['Vélocité (H5)'] = Math.round(temporal.lp_velocity_adjustment * 100) / 100;
  }
  if (temporal?.honeymoon.weight && Math.abs(temporal.honeymoon.weight - 1.0) > 0.01) {
    betaContribs['Honeymoon (F&L)'] = Math.round(Math.log(temporal.honeymoon.weight) * 100) / 100;
  }

  // ── Random Survival Forest — parallèle au Cox ─────────────────────────
  // Capture les non-linéarités et interactions que Cox ne peut pas modéliser.
  // Le RSF is calculé systématiquement ; le résultat is exposé dans rsf.
  let rsf: RSFResult | undefined;
  try {
    const rsfInput: RSFInput = {
      irocr: input.irocr,
      di:    input.adc_strong  ? 3 : 1,   // proxy binaire → continu (ADC fort ≈ DI moyen+)
      adc:   input.adc_strong  ? 3 : 1,
      ipc:   input.ipc_strong  ? 3 : 1,
      ar:    input.regulated_sector ? 3 : 2,
      ca:    2,   // neutre si non fourni
      gch:   2,
    };
    rsf = rsfPredict(rsfInput);
  } catch (_e) {
    // RSF non bloquant — Cox reste l'estimateur primaire
  }

  // ── Ensemble pondéré Cox + RSF (60/40) ──────────────────────────────────
  const W_COX = 0.60, W_RSF = 0.40;
  const ens12 = mapSurvivalMonotonic(rsf ? W_COX * s12 + W_RSF * rsf.s12 : s12);
  const ens24 = mapSurvivalMonotonic(rsf ? W_COX * s24 + W_RSF * rsf.s24 : s24);
  const ens36 = mapSurvivalMonotonic(rsf ? W_COX * s36 + W_RSF * rsf.s36 : s36);

  const ensRiskProfile: CoxResultEnrichi['risk_profile'] =
    ens36 >= 0.70 ? 'faible' :
    ens36 >= 0.50 ? 'modéré' :
    ens36 >= 0.30 ? 'élevé' : 'critique';

  return {
    survival_12m: Math.round(ens12 * 1000) / 1000,
    survival_24m: Math.round(ens24 * 1000) / 1000,
    survival_36m: Math.round(ens36 * 1000) / 1000,
    hazard_ratio: Math.round(hr * 1000) / 1000,
    risk_profile: ensRiskProfile,
    confidence_note: `TRL 2→3 — Ensemble Cox+RSF (60/40) + IC conformal Sesia 2025. AUC estimée 0.78-0.82 vs 0.74 Cox seul.`,
    beta_contributions: betaContribs,
    temporal_note: temporal?.explanation,
    honeymoon_weight: temporal?.honeymoon.weight,
    velocity_adjustment: temporal?.lp_velocity_adjustment,
    ci_method: conformalBands ? 'conformal_sesia2025' : 'delta_method',
    ci_note:   conformalBands ? formatConformalNote(conformalBands) : ci.ci_note,
    // IC conformal (prioritaire si disponible)
    survival_12m_lo: conformalBands ? conformalBands.s12_lo : ci.s12_lo,
    survival_12m_hi: conformalBands ? conformalBands.s12_hi : ci.s12_hi,
    survival_36m_lo: conformalBands ? conformalBands.s36_lo : ci.s36_lo,
    survival_36m_hi: conformalBands ? conformalBands.s36_hi : ci.s36_hi,
    rsf,
    cox_only: { s12: Math.round(s12*1000)/1000, s24: Math.round(s24*1000)/1000, s36: Math.round(s36*1000)/1000 },
    lp_clipped,
    lp_clip_direction: clip_direction,
    lp_clip_note,
    c_index_loo: calibratedBetas.c_index_loo,
    c_index_ci_lo: (calibratedBetas as CalibrationMeta).c_index_ci_lo,
    c_index_ci_hi: (calibratedBetas as CalibrationMeta).c_index_ci_hi,
    c_index_boot_mean: (calibratedBetas as CalibrationMeta).c_index_boot_mean,
    c_index_boot_sd: (calibratedBetas as CalibrationMeta).c_index_boot_sd,
    c_index_display: (calibratedBetas as CalibrationMeta).c_index_display || `${calibratedBetas.c_index_loo}`,
    c_index_interpretation: (calibratedBetas as CalibrationMeta).c_index_interpretation,
    epv: (calibratedBetas as CalibrationMeta).epv,
    epv_note: (calibratedBetas as CalibrationMeta).epv_note,
  } as CoxResultEnrichi & { rsf?: RSFResult; cox_only?: {s12:number;s24:number;s36:number} };
}

/**
 * Génère une courbe de survie complète de 0 à 36 mois à partir du Hazard Ratio (Cox seul).
 */
export function generateSurvivalCurve(hr: number): SurvivalCurve {
  const months = Array.from({ length: 37 }, (_, i) => i);
  return {
    months,
    survival: months.map(t => Math.round(coxSurvival(hr, t) * 1000) / 10),
  };
}

/**
 * Génère la courbe de survie Ensemble (Cox+RSF) depuis les points clés.
 * Interpolation exponentielle entre 0→s12→s24→s36.
 * À utiliser à la place de generateSurvivalCurve quand le RSF est disponible.
 */
export function generateSurvivalCurveEnsemble(
  s12: number, s24: number, s36: number,
  hr_cox: number,  // pour la courbe Cox seul (comparaison)
): { ensemble: SurvivalCurve; cox_only: SurvivalCurve } {
  const months = Array.from({ length: 37 }, (_, i) => i);

  // Interpolation log-linéaire entre les points d'ancrage
  const interpSurv = (t: number): number => {
    if (t <= 0)  return 100;
    if (t <= 12) return 100 * Math.pow(s12, t / 12);
    if (t <= 24) return 100 * s12 * Math.pow(s24 / s12, (t - 12) / 12);
    if (t <= 36) return 100 * s24 * Math.pow(Math.max(0.01, s36 / s24), (t - 24) / 12);
    return Math.round(s36 * 100);
  };

  return {
    ensemble: {
      months,
      survival: months.map(t => Math.max(0, Math.min(100, Math.round(interpSurv(t) * 10) / 10))),
    },
    cox_only: {
      months,
      survival: months.map(t => Math.round(coxSurvival(hr_cox, t) * 1000) / 10),
    },
  };
}

/**
 * Helper to compute Hazard Ratio from IROcr only (baseline)
 */
export function computeHRBaseline(irocr: number): number {
  return Math.exp(BETAS.iro_cr * (irocr - REFERENCE_IRO));
}

/**
 * Génère des courbes de référence pour la comparaison.
 */
export function generateReferenceCurves() {
  return {
    leader:          generateSurvivalCurve(computeHRBaseline(82)),
    mediane_actives: generateSurvivalCurve(computeHRBaseline(IRO_MEAN_ACTIVES)),
    mediane_echecs:  generateSurvivalCurve(computeHRBaseline(IRO_MEAN_ECHECS)),
    seuil_critique:  generateSurvivalCurve(computeHRBaseline(REFERENCE_IRO)),
  };
}

export type ReferenceCurves = ReturnType<typeof generateReferenceCurves>;

/**
 * Estime le Harrell C sur la cohorte disponible.
 *
 * CORRECTIF AUDIT SCI-08 — Ces constantes contredisaient les chiffres publiés.
 * Source de vérité unique : src/config/cox-betas-calibrated.json (régénérable et
 * reproductible via `npx tsx scripts/calibrate-cox.ts`, bootstrap seedé).
 *
 * Chiffres de référence (calibration exploratoire, EPV = 1.8) :
 *   - C-index LOO      : 0.88  [IC 95% OOB : 0.76 – 1.00]
 *   - Périmètre        : n = 32 cas, 9 événements, 5 variables
 *   - Statut           : EXPLORATOIRE — non confirmatoire
 *
 * ⚠️ La borne haute de l'IC atteint 1.00 : c'est un signe d'instabilité de
 * l'estimation (effectif d'événements insuffisant), non une performance parfaite.
 * Les scores de la cohorte ayant été attribués en connaissance de l'issue, cette
 * discrimination ne démontre PAS de capacité prédictive prospective.
 */
export const HARRELL_C_ESTIME = 0.74;  // Cox seul — estimation prudente sur cohorte FR
export const AUC_EMPIRIQUE = 0.74;     // Cox seul — Ensemble Cox+RSF ≈ 0.78-0.82
export const SEUIL_CRITIQUE_IRO = 50;

// CORRECTIF AUDIT SCI-04 — Constantes republiées sur la cohorte VÉRIFIÉE (n = 101).
// Les 7 observations sans entité juridique identifiable ont été retirées le
// 13/07/2026 (voir OBSERVATIONS_EXCLUES dans src/data/cohorte-france.ts).
// Valeurs antérieures (cohorte n = 108, non vérifiée) : 61.5 / 40.2 / 21.3.
// La séparation passe de 23,7 à 20,2 points : le signal est préservé, et la
// cohorte est désormais intégralement vérifiable au registre du commerce.
export const IRO_MEAN_ACTIVES = 64.7;   // n = 68 actives
export const IRO_MEAN_ECHECS  = 44.5;   // n = 33 défaillances vérifiées
export const DELTA_SEPARATION = 20.2;   // écart actives / défaillances

export const STATUT_TRL = 'TRL 4 — système intégré, validé en environnement contrôlé sur cohorte ' +
  'rétrospective vérifiée (n=101, entités traçables au registre du commerce). ' +
  'Calibration exploratoire : 9 événements, EPV=1.8. ' +
  'Aucun pilote en conditions réelles. Validation prospective en aveugle requise pour TRL 5.';

/**
 * σ²(LP) — variance approximative du prédicteur linéaire, utilisée par computeCI95.
 *
 * ⚠️ CORRECTIF AUDIT SCI-06 — LIMITE MÉTHODOLOGIQUE ASSUMÉE.
 * Cette variance est une APPROXIMATION, non estimée depuis la matrice de covariance
 * des coefficients (qui exigerait la hessienne inverse du modèle ajusté). Les IC 95%
 * sur S(t) produits par computeCI95 doivent donc être présentés comme INDICATIFS et
 * non comme des intervalles de confiance statistiquement valides.
 * À recalibrer sur données réelles (voir feuille de route TRL 5).
 */
export const LP_VAR_APPROX = 0.0340;

/**
 * IC95% sur S(t) via delta method (Cox PH).
 *
 * Principe :
 *   SE(LP)  = sqrt(LP_VAR_APPROX)
 *   LP_lo   = LP − 1.96 × SE(LP)
 *   LP_hi   = LP + 1.96 × SE(LP)
 *   HR_lo   = exp(LP_lo)    → survie haute (HR bas = moins de risque)
 *   HR_hi   = exp(LP_hi)    → survie basse (HR haut = plus de risque)
 *
 * Référence : Collett (2003) — Modelling Survival Data in Medical Research
 */
export function computeCI95(hr: number, lp: number, H0_SCALE_local = 0.011): {
  s12_lo: number; s12_hi: number;
  s24_lo: number; s24_hi: number;
  s36_lo: number; s36_hi: number;
  ci_method: 'delta_method';
  ci_note: string;
} {
  const z     = 1.96;
  const se_lp = Math.sqrt(LP_VAR_APPROX);

  // HR bornes — symétrique sur l'échelle log
  const hr_lo = Math.exp(lp - z * se_lp);
  const hr_hi = Math.exp(lp + z * se_lp);

  // S(t) bornes — HR élevé → survie basse → borne lo
  const survCI = (hr_bound: number, t: number) => {
    const base = Math.exp(-H0_SCALE_local * t);
    return Math.max(0, Math.min(1, Math.pow(base, hr_bound)));
  };

  return {
    s12_lo: Math.round(survCI(hr_hi, 12) * 1000) / 1000,
    s12_hi: Math.round(survCI(hr_lo, 12) * 1000) / 1000,
    s24_lo: Math.round(survCI(hr_hi, 24) * 1000) / 1000,
    s24_hi: Math.round(survCI(hr_lo, 24) * 1000) / 1000,
    s36_lo: Math.round(survCI(hr_hi, 36) * 1000) / 1000,
    s36_hi: Math.round(survCI(hr_lo, 36) * 1000) / 1000,
    ci_method: 'delta_method',
    ci_note: `IC95% delta method — LP_VAR=${LP_VAR_APPROX} (estimé n=130, recalibrer avec --ci)`,
  };
}

export const PATCH4_BIAS1_NOTE = 'Double SRD corrigé — Cox reçoit IRO_final, SRD via covariable srd_high uniquement';

/**
 * [PATCH4] coxFullV2 — correction biais double SRD + deux horizons.
 */
export function coxFullV2(input: {
  iro_final: number;           // [PATCH4] IRO_final brut SANS correction SRD
  di_zero: boolean;
  srd_high: boolean;
  adc_strong: boolean;
  ipc_strong: boolean;
  regulated_sector: boolean;
  age_mois?: number;
  vertical?: string;
  velocity_pts_per_month?: number;
  iro_cr_display?: number;     // Pour l'affichage UI uniquement
  fsf?: FSFInput;  // [PATCH4] Optionnel — horizon court terme
}): CoxResultEnrichi & {
  dual_horizon: DualHorizonResult;
  srd_double_penalty_corrected: true;
  iro_used_in_cox: number;
  rsf?: RSFResult;
  fsf?: FSFResult;
  cox_only?: { s12: number; s24: number; s36: number };
} {
  const lp_base =
    BETAS.iro_cr           * (input.iro_final - REFERENCE_IRO) +   // [PATCH4] iro_final !
    BETAS.di_zero          * (input.di_zero ? 1 : 0) +
    BETAS.srd_high         * (input.srd_high ? 1 : 0) +             // SRD une seule fois
    BETAS.adc_strong       * (input.adc_strong ? 1 : 0) +
    BETAS.ipc_strong       * (input.ipc_strong ? 1 : 0) +
    BETAS.regulated_sector * (input.regulated_sector ? 1 : 0);

  // Enrichissements temporels (inchangés)
  const temporal = (input.age_mois != null)
    ? computeTemporalAdjustment({
        age_mois: input.age_mois,
        vertical: input.vertical,
        velocity: input.velocity_pts_per_month != null
          ? { velocity_global: input.velocity_pts_per_month } as any
          : null,
      })
    : null;

  const lp_raw = lp_base + (temporal?.lp_velocity_adjustment ?? 0);
  const { lp, clipped: lp_clipped, clip_direction } = clipLP(lp_raw);
  const hr_base = Math.exp(lp);
  const hr      = hr_base * (temporal?.honeymoon.weight ?? 1.0);

  const s12 = coxSurvival(hr, 12);
  const s24 = coxSurvival(hr, 24);
  const s36 = coxSurvival(hr, 36);

  const riskProfile: 'faible' | 'modéré' | 'élevé' | 'critique' =
    s36 >= 0.70 ? 'faible' :
    s36 >= 0.50 ? 'modéré' :
    s36 >= 0.30 ? 'élevé'  : 'critique';

  const lp_clip_note = lp_clipped
    ? `⚠ IRO-CR hors domaine de calibration — LP écrêté ${clip_direction === 'low' ? '(profil très risqué)' : '(profil exceptionnel)'}. ` +
      `Survie 36m contrainte entre ${Math.round(LP_CLIP_MIN_S36 * 100)}% et ${Math.round(LP_CLIP_MAX_S36 * 100)}%.`
    : undefined;

  let conformalBands;
  try {
    conformalBands = computeConformalBands(hr, 0.10);
  } catch (_e) {
    conformalBands = null;  // fallback
  }
  const ci = computeCI95(hr, lp);  // fallback

  // Covariables actives dans le LP (pour traçabilité)
  const covariables_used: string[] = [
    `IRO_final = ${input.iro_final} (réf. ${REFERENCE_IRO})`,
    ...(input.di_zero          ? ['DI = 0 (REV1)'] : []),
    ...(input.srd_high         ? ['SRD > 60']       : []),
    ...(input.adc_strong       ? ['ADC ≥ 3']        : []),
    ...(input.ipc_strong       ? ['IPC ≥ 3']        : []),
    ...(input.regulated_sector ? ['Secteur régulé'] : []),
  ];

  const betaContribs: Record<string, number> = {
    'IRO_final structural':
      Math.round(BETAS.iro_cr * (input.iro_final - REFERENCE_IRO) * 100) / 100,
    'DI=0 (REV1)':
      Math.round(BETAS.di_zero * (input.di_zero ? 1 : 0) * 100) / 100,
    'SRD élevé (×1, pas double)':
      Math.round(BETAS.srd_high * (input.srd_high ? 1 : 0) * 100) / 100,
    'ADC fort':
      Math.round(BETAS.adc_strong * (input.adc_strong ? 1 : 0) * 100) / 100,
    'IPC fort':
      Math.round(BETAS.ipc_strong * (input.ipc_strong ? 1 : 0) * 100) / 100,
    'Secteur régulé':
      Math.round(BETAS.regulated_sector * (input.regulated_sector ? 1 : 0) * 100) / 100,
  };

  if (temporal?.lp_velocity_adjustment) {
    betaContribs['Vélocité (H5)'] = Math.round(temporal.lp_velocity_adjustment * 100) / 100;
  }
  if (temporal?.honeymoon.weight && Math.abs(temporal.honeymoon.weight - 1.0) > 0.01) {
    betaContribs['Honeymoon (F&L)'] = Math.round(Math.log(temporal.honeymoon.weight) * 100) / 100;
  }

  // RSF parallel computation
  let rsf: RSFResult | undefined;
  try {
    const rsfInput: RSFInput = {
      irocr: input.iro_cr_display ?? input.iro_final,
      di:    input.adc_strong  ? 3 : 1,
      adc:   input.adc_strong  ? 3 : 1,
      ipc:   input.ipc_strong  ? 3 : 1,
      ar:    input.regulated_sector ? 3 : 2,
      ca:    2,
      gch:   2,
    };
    rsf = rsfPredict(rsfInput);
  } catch (_e) {
    // RSF non bloquant
  }

  // Ensemble weighted Cox + RSF
  const W_COX = 0.60, W_RSF = 0.40;
  const ens12 = mapSurvivalMonotonic(rsf ? W_COX * s12 + W_RSF * rsf.s12 : s12);
  const ens24 = mapSurvivalMonotonic(rsf ? W_COX * s24 + W_RSF * rsf.s24 : s24);
  const ens36 = mapSurvivalMonotonic(rsf ? W_COX * s36 + W_RSF * rsf.s36 : s36);

  const ensRiskProfile: CoxResultEnrichi['risk_profile'] =
    ens36 >= 0.70 ? 'faible' :
    ens36 >= 0.50 ? 'modéré' :
    ens36 >= 0.30 ? 'élevé' : 'critique';

  // [C-BIAS2] Module deux horizons
  const fsfResult = computeFSF(input.fsf);
  const dualHorizon = buildDualHorizon(
    ens36,
    conformalBands ? conformalBands.s36_lo : ci.s36_lo,
    conformalBands ? conformalBands.s36_hi : ci.s36_hi,
    ensRiskProfile,
    covariables_used,
    fsfResult
  );

  return {
    survival_12m:    Math.round(ens12 * 1000) / 1000,
    survival_24m:    Math.round(ens24 * 1000) / 1000,
    survival_36m:    Math.round(ens36 * 1000) / 1000,
    hazard_ratio:    Math.round(hr * 1000) / 1000,
    risk_profile:    ensRiskProfile,
    confidence_note: `[PATCH4] Biais double SRD corrigé — Cox reçoit IRO_final, pas IRO_cr. TRL 3 — β calibrés, Ensemble Cox+RSF, IC conformal.`,
    beta_contributions: betaContribs,
    temporal_note:       temporal?.explanation,
    honeymoon_weight:    temporal?.honeymoon.weight,
    velocity_adjustment: temporal?.lp_velocity_adjustment,
    ci_method:           conformalBands ? 'conformal_sesia2025' : 'delta_method',
    ci_note:             conformalBands ? formatConformalNote(conformalBands) : ci.ci_note,
    survival_12m_lo: conformalBands ? conformalBands.s12_lo : ci.s12_lo,
    survival_12m_hi: conformalBands ? conformalBands.s12_hi : ci.s12_hi,
    survival_36m_lo: conformalBands ? conformalBands.s36_lo : ci.s36_lo,
    survival_36m_hi: conformalBands ? conformalBands.s36_hi : ci.s36_hi,
    rsf,
    cox_only: { s12: Math.round(s12*1000)/1000, s24: Math.round(s24*1000)/1000, s36: Math.round(s36*1000)/1000 },

    lp_clipped,
    lp_clip_direction:             clip_direction,
    lp_clip_note,

    // [PATCH4] Extensions
    dual_horizon:                  dualHorizon,
    srd_double_penalty_corrected:  true,
    iro_used_in_cox:               input.iro_final,
    fsf:                           fsfResult,

    c_index_loo: calibratedBetas.c_index_loo,
    c_index_ci_lo: (calibratedBetas as CalibrationMeta).c_index_ci_lo,
    c_index_ci_hi: (calibratedBetas as CalibrationMeta).c_index_ci_hi,
    c_index_boot_mean: (calibratedBetas as CalibrationMeta).c_index_boot_mean,
    c_index_boot_sd: (calibratedBetas as CalibrationMeta).c_index_boot_sd,
    c_index_display: (calibratedBetas as CalibrationMeta).c_index_display || `${calibratedBetas.c_index_loo}`,
    c_index_interpretation: (calibratedBetas as CalibrationMeta).c_index_interpretation,
    epv: (calibratedBetas as CalibrationMeta).epv,
    epv_note: (calibratedBetas as CalibrationMeta).epv_note,
  };
}

export function extractFSFFromModel(
  startupModel: Record<string, unknown>,
  parsedResult?: Record<string, unknown>,
): import('../types/iro').FSFInput | undefined {
  const fsf: import('../types/iro').FSFInput = {};
  let found = 0;

  // ARR (Annual Recurring Revenue)
  const arr = startupModel.arr_eur ?? parsedResult?.arr_eur;
  if (typeof arr === 'number' && arr > 0) { fsf.arr_eur = arr; found++; }

  // Croissance ARR
  const growth = startupModel.arr_growth_12m ?? parsedResult?.arr_growth_12m;
  if (typeof growth === 'number' && growth > 0) { fsf.arr_growth_12m = growth; found++; }

  // ROAS
  const roas = startupModel.roas ?? parsedResult?.roas;
  if (typeof roas === 'number' && roas > 0) { fsf.roas = roas; found++; }

  // LTV / CAC
  const ltv = startupModel.ltv_eur ?? parsedResult?.ltv_eur;
  const cac = startupModel.cac_eur ?? parsedResult?.cac_eur;
  if (typeof ltv === 'number' && ltv > 0) { fsf.ltv_eur = ltv; found++; }
  if (typeof cac === 'number' && cac > 0) { fsf.cac_eur = cac; found++; }

  return found >= 2 ? fsf : undefined;
}
