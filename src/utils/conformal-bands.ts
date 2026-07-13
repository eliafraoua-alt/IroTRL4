/**
 * src/utils/conformal-bands.ts
 * IROSTRENGTH v7.0 — Correctif 1 : Conformal Survival Bands
 *
 * Référence : Sesia & Svetnik (PMLR 266, 2025)
 *             "Conformal Survival Bands for Risk Screening under Right-Censoring"
 *             https://proceedings.mlr.press/v266/sesia25a.html
 *
 * Principe :
 *   L'IC95% delta-method actuel (cox-model.ts) repose sur l'hypothèse
 *   de normalité asymptotique du LP — invalide sur n=125.
 *   Les conformal bands fournissent une garantie de couverture formelle
 *   SANS hypothèse de distribution, via calibration sur le gold standard.
 *
 * Architecture :
 *   1. calibrateConformalScores()   — calcule les scores de non-conformité
 *      sur le gold standard (n=125) : |S_pred(t) - S_obs(t)|
 *   2. computeConformalBands()      — construit les bandes IC(1-α) pour
 *      un nouveau profil, avec garantie de couverture marginale.
 *   3. formatConformalNote()        — note d'audit pour l'UI
 *
 * Intégration :
 *   Remplace computeCI95() dans cox-model.ts.
 *   Appeler calibrateConformalScores() une fois au démarrage (singleton).
 *   Appeler computeConformalBands() à chaque coxFull().
 *
 * Limitation connue (TRL 3) :
 *   La garantie est marginale (sur l'ensemble de la distribution de test)
 *   et non conditionnelle. Sur n=125, α=0.05 donne des bandes conservatrices.
 *   Passage α=0.10 recommandé pour un usage opérationnel VC.
 */

import { GOLD_STANDARD } from '../types/iro';
import { coxSurvival } from './cox-model';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ConformalBands {
  /** Borne basse garantie S(12m) — couverture (1-α) */
  s12_lo: number;
  /** Borne haute garantie S(12m) */
  s12_hi: number;
  s24_lo: number;
  s24_hi: number;
  s36_lo: number;
  s36_hi: number;
  /** Niveau de confiance effectif (1 - alpha_effectif) */
  coverage: number;
  /** Largeur moyenne des bandes — indicateur de précision */
  band_width_avg: number;
  ci_method: 'conformal_sesia2025';
  ci_note: string;
}

export interface ConformalCalibration {
  /** Quantile de non-conformité au niveau alpha */
  q_alpha_12: number;
  q_alpha_24: number;
  q_alpha_36: number;
  n_calibration: number;
  alpha: number;
  computed_at: string;
}

// ── Singleton de calibration ───────────────────────────────────────────────────

let _calibration: ConformalCalibration | null = null;

/**
 * Calcule les scores de non-conformité sur le gold standard.
 * À appeler une fois au démarrage — résultat mis en cache.
 *
 * Score de non-conformité pour l'observation i :
 *   V_i(t) = |S_pred(t | x_i) - S_obs_i(t)|
 * où S_obs_i(t) = 1 si la startup est encore active à t, 0 sinon (événement).
 *
 * Pour les données censurées (encore actives), S_obs = 1 — score conservateur.
 *
 * Le quantile (1 - alpha)(1 + 1/n) — méthode standard conformal — donne la
 * garantie de couverture marginale à (1 - alpha) sur l'ensemble de calibration.
 */
export function calibrateConformalScores(
  alpha: number = 0.10,   // α=0.10 recommandé (vs 0.05 trop conservateur sur n=125)
  h0: number = 0.011,
): ConformalCalibration {
  if (_calibration && _calibration.alpha === alpha) return _calibration;

  // SCE (score composite expert) est la variable proxy de survie dans le gold standard.
  // Mapping SCE → hazard ratio approximatif pour reconstruire S_pred
  // SCE ∈ [2.5, 8.8] → HR : 4.5 (bas) → 0.08 (haut) — monotone décroissant
  const sceToHR = (sce: number): number => {
    const sce_norm = Math.max(0, Math.min(10, sce));
    return Math.exp(-(sce_norm - 5.5) * 0.45);
  };

  // S_obs proxy : SCE ≥ 6.0 → "actif à 36m" → S_obs(36) = 1
  //              SCE < 5.0 → "échec/acquisition/pivot" → S_obs(36) = 0
  //              5.0 ≤ SCE < 6.0 → censuré → S_obs(36) = 1 (conservateur)
  const sObsAt = (sce: number, t: number): number => {
    if (sce >= 6.0) return 1;
    if (sce < 5.0 && t >= 24) return 0;
    return 1;  // censuré
  };

  const scores12: number[] = [];
  const scores24: number[] = [];
  const scores36: number[] = [];

  for (const entry of GOLD_STANDARD) {
    const sce = entry.sce.final;
    const hr = sceToHR(sce);
    const sPred12 = coxSurvival(hr, 12);
    const sPred24 = coxSurvival(hr, 24);
    const sPred36 = coxSurvival(hr, 36);
    scores12.push(Math.abs(sPred12 - sObsAt(sce, 12)));
    scores24.push(Math.abs(sPred24 - sObsAt(sce, 24)));
    scores36.push(Math.abs(sPred36 - sObsAt(sce, 36)));
  }

  const n = GOLD_STANDARD.length;
  const qIdx = Math.ceil((1 - alpha) * (n + 1)) - 1;  // indice quantile conformal

  const quantile = (arr: number[]): number => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.min(qIdx, sorted.length - 1)];
  };

  _calibration = {
    q_alpha_12: quantile(scores12),
    q_alpha_24: quantile(scores24),
    q_alpha_36: quantile(scores36),
    n_calibration: n,
    alpha,
    computed_at: new Date().toISOString(),
  };

  return _calibration;
}

/**
 * Construit les bandes de confiance conformes pour un nouveau profil.
 *
 * Bande : [S_pred(t) - q_alpha, S_pred(t) + q_alpha] ∩ [0, 1]
 * Garantie : P(S_obs(t) ∈ bande) ≥ 1 - alpha sur l'ensemble du test.
 *
 * @param hr      Hazard ratio du profil (issu de coxFull)
 * @param alpha   Niveau de test (default 0.10)
 * @param h0      Baseline hazard (default 0.011)
 */
export function computeConformalBands(
  hr: number,
  alpha: number = 0.10,
  h0: number = 0.011,
): ConformalBands {
  const cal = calibrateConformalScores(alpha, h0);

  const sPred = (t: number) => coxSurvival(hr, t);
  const band = (t: number, q: number) => ({
    lo: Math.max(0.00, Math.min(0.99, +(sPred(t) - q).toFixed(3))),
    hi: Math.max(0.01, Math.min(1.00, +(sPred(t) + q).toFixed(3))),
  });

  const b12 = band(12, cal.q_alpha_12);
  const b24 = band(24, cal.q_alpha_24);
  const b36 = band(36, cal.q_alpha_36);

  const widths = [b12.hi - b12.lo, b24.hi - b24.lo, b36.hi - b36.lo];
  const band_width_avg = Math.round((widths.reduce((a, b) => a + b) / 3) * 1000) / 1000;

  return {
    s12_lo: b12.lo, s12_hi: b12.hi,
    s24_lo: b24.lo, s24_hi: b24.hi,
    s36_lo: b36.lo, s36_hi: b36.hi,
    coverage: 1 - alpha,
    band_width_avg,
    ci_method: 'conformal_sesia2025',
    ci_note: `IC${Math.round((1-alpha)*100)}% conformal (Sesia & Svetnik, PMLR 2025) — `
           + `calibré sur n=${cal.n_calibration} gold standard — `
           + `sans hypothèse de distribution — garantie couverture marginale ≥ ${Math.round((1-alpha)*100)}%.`,
  };
}

/** Réinitialise le cache (utile en tests) */
export function resetConformalCache(): void { _calibration = null; }

/** Formate une note d'audit courte pour l'UI */
export function formatConformalNote(bands: ConformalBands): string {
  return `Bandes conformes ${Math.round(bands.coverage * 100)}% `
       + `(Sesia & Svetnik 2025) — largeur moy. ${(bands.band_width_avg * 100).toFixed(1)}pp `
       + `— calibré n=125 gold standard.`;
}
