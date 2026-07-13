export interface CalibrationEntry {
  startup_name:   string;
  status:         'active' | 'failed';
  velocity_global: number;    // Δ IRO/mois
  irocr_last:     number;     // dernier IRO_cr connu
  age_mois:       number;
}

export interface CalibrationResult {
  beta_velocity:    number;    // β calibré (remplace −0.020)
  beta_se:          number;    // erreur standard du β
  ci_lo:            number;    // IC95% borne basse
  ci_hi:            number;    // IC95% borne haute
  c_index:          number;    // Harrell C avec velocity
  c_index_base:     number;    // Harrell C sans velocity (référence)
  delta_c:          number;    // gain en C-index grâce à velocity
  n:                number;    // nombre de startups
  h5_confirmed:     boolean;   // H5 : ci_lo < 0 et beta < 0
  interpretation:   string;
}

/** Corrélation de Spearman simplifiée (rang) */
function spearmanRho(x: number[], y: number[]): number {
  const n  = x.length;
  const rx = rankArray(x);
  const ry = rankArray(y);
  const dSq = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0);
  return 1 - (6 * dSq) / (n * (n ** 2 - 1));
}

function rankArray(arr: number[]): number[] {
  const sorted = [...arr].sort((a, b) => a - b);
  return arr.map(v => sorted.indexOf(v) + 1);
}

/** Harrell C-statistic sur paires concordantes */
function harrellC(scores: number[], outcomes: number[]): number {
  let concordant = 0, discordant = 0, tied = 0;
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      if (outcomes[i] === outcomes[j]) continue;
      // outcome=1 (failed) devrait avoir un score plus bas
      const hi = outcomes[i] > outcomes[j] ? scores[j] : scores[i];
      const lo = outcomes[i] > outcomes[j] ? scores[i] : scores[j];
      if (hi > lo) concordant++;
      else if (hi < lo) discordant++;
      else tied++;
    }
  }
  const total = concordant + discordant + tied;
  return total > 0 ? concordant / total : 0.5;
}

/** Gradient descent logistique pour estimer β_velocity */
function estimateBeta(
  velocities: number[],
  irocrs:     number[],
  outcomes:   number[],   // 1=failed, 0=active
  lr  = 0.001,
  epochs = 2000
): { beta_v: number; beta_iro: number; se: number } {
  let bv = -0.020;  // initialisation depuis l'estimé actuel
  let bi = -0.048;

  for (let e = 0; e < epochs; e++) {
    let grad_v = 0, grad_i = 0;
    for (let i = 0; i < velocities.length; i++) {
      const lp  = bv * velocities[i] + bi * (irocrs[i] - 50);
      const p   = 1 / (1 + Math.exp(-lp));  // sigmoid → P(failed)
      const err = outcomes[i] - p;
      grad_v   += err * velocities[i];
      grad_i   += err * (irocrs[i] - 50);
    }
    bv += lr * grad_v / velocities.length;
    bi += lr * grad_i / velocities.length;
  }

  // Erreur standard approximée (inverse Fisher information, diagonal)
  let info_v = 0;
  for (let i = 0; i < velocities.length; i++) {
    const lp = bv * velocities[i] + bi * (irocrs[i] - 50);
    const p  = 1 / (1 + Math.exp(-lp));
    info_v  += p * (1 - p) * velocities[i] ** 2;
  }
  const se = info_v > 0 ? 1 / Math.sqrt(info_v) : 0.05;

  return { beta_v: bv, beta_iro: bi, se };
}

/**
 * calibrateBetaVelocity — calibre β_velocity depuis le journal d'audit.
 *
 * @param entries  ≥10 entrées avec ≥2 snapshots par startup
 * @returns CalibrationResult avec β calibré et verdict H5
 */
export function calibrateBetaVelocity(entries: CalibrationEntry[]): CalibrationResult {
  const n = entries.length;

  if (n < 10) {
    return {
      beta_velocity:  -0.020,
      beta_se:         0.050,
      ci_lo:          -0.120,
      ci_hi:          +0.080,
      c_index:         0.74,
      c_index_base:    0.74,
      delta_c:         0.00,
      n,
      h5_confirmed:    false,
      interpretation: `Calibration impossible : n=${n} < 10 requis. Conserver β=-0.020 (estimé).`,
    };
  }

  const velocities = entries.map(e => e.velocity_global);
  const irocrs     = entries.map(e => e.irocr_last);
  const outcomes   = entries.map(e => e.status === 'failed' ? 1 : 0);

  const { beta_v, se } = estimateBeta(velocities, irocrs, outcomes);

  const z    = 1.96;
  const ci_lo = beta_v - z * se;
  const ci_hi = beta_v + z * se;

  // Harrell C avec velocity vs sans
  const scores_with    = entries.map(e => -(beta_v * e.velocity_global + (-0.048) * (e.irocr_last - 50)));
  const scores_without = entries.map(e => -(-0.048 * (e.irocr_last - 50)));
  const c_with    = harrellC(scores_with,    outcomes);
  const c_without = harrellC(scores_without, outcomes);
  const delta_c   = c_with - c_without;

  const h5 = ci_lo < 0 && beta_v < 0;

  const interpretation = h5
    ? `H5 CONFIRMÉE : β_velocity=${beta_v.toFixed(4)} (IC95% [${ci_lo.toFixed(4)}, ${ci_hi.toFixed(4)}]). Velocity protectrice. ΔC=${delta_c >= 0 ? '+' : ''}${(delta_c * 100).toFixed(1)}%.`
    : ci_lo >= 0
    ? `H5 INFIRMÉE : β_velocity=${beta_v.toFixed(4)} ≥ 0. Velocity non protectrice. Revoir le modèle.`
    : `H5 INDÉTERMINÉE : IC95% inclut 0. n insuffisant ou β faible. Ajouter ${Math.max(0, 30 - n)} entrées.`;

  return {
    beta_velocity: Math.round(beta_v * 10000) / 10000,
    beta_se:       Math.round(se * 10000) / 10000,
    ci_lo:         Math.round(ci_lo * 10000) / 10000,
    ci_hi:         Math.round(ci_hi * 10000) / 10000,
    c_index:       Math.round(c_with * 1000) / 1000,
    c_index_base:  Math.round(c_without * 1000) / 1000,
    delta_c:       Math.round(delta_c * 1000) / 1000,
    n,
    h5_confirmed:  h5,
    interpretation,
  };
}
