import type { GoldStandardEntry, FrozenGoldStandard, BlindAnnotation, ICCResult } from '../types/iro';
import { auditGoldStandard } from './gold-standard-qa';

/**
 * Calcul du Kappa de Cohen pour deux annotateurs binaires.
 */
export function computeCohenKappa(
  annotations_A: number[],  // 0 ou 1
  annotations_B: number[],
): ICCResult {
  if (annotations_A.length !== annotations_B.length) throw new Error('Longueurs inégales');
  const n = annotations_A.length;

  // Observed agreement
  let po = annotations_A.filter((v, i) => v === annotations_B[i]).length / n;

  // Expected agreement
  const p1_A = annotations_A.filter(v => v === 1).length / n;
  const p1_B = annotations_B.filter(v => v === 1).length / n;
  const pe = p1_A * p1_B + (1 - p1_A) * (1 - p1_B);

  const kappa = pe < 1 ? (po - pe) / (1 - pe) : 1;

  // IC bootstrap simplifié (500 itérations)
  const boots: number[] = [];
  for (let b = 0; b < 500; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(Math.random() * n));
    const a = idx.map(i => annotations_A[i]);
    const bb = idx.map(i => annotations_B[i]);
    const po_b = a.filter((v, i) => v === bb[i]).length / n;
    const p1a = a.filter(v => v === 1).length / n;
    const p1b = bb.filter(v => v === 1).length / n;
    const pe_b = p1a * p1b + (1 - p1a) * (1 - p1b);
    boots.push(pe_b < 1 ? (po_b - pe_b) / (1 - pe_b) : 1);
  }
  boots.sort((a, b) => a - b);

  return {
    method: 'cohen_kappa',
    value: Math.round(kappa * 1000) / 1000,
    n_pairs: n,
    ci_lo: Math.round(boots[12] * 1000) / 1000,   // percentile 2.5%
    ci_hi: Math.round(boots[487] * 1000) / 1000,  // percentile 97.5%
    interpretation: kappa >= 0.80 ? 'excellent' : kappa >= 0.70 ? 'good' : kappa >= 0.60 ? 'acceptable' : 'insufficient',
    computed_at: new Date().toISOString(),
    annotation_ids: [],
  };
}


/**
 * Gèle le Gold Standard V7 après audit de qualité.
 * Lève une erreur si des avertissements bloquants sont détectés.
 */
export function freezeGoldStandard(
  entries: GoldStandardEntry[],
  validatedBy: string
): FrozenGoldStandard {

  const audit = auditGoldStandard(entries);

  if (audit.warnings.length > 0) {
    throw new Error(
      `Gold standard non validé — corriger les avertissements avant gel :\n` +
      audit.warnings.join('\n')
    );
  }

  return {
    version: 'V7',
    frozenAt: new Date().toISOString(),
    validatedBy,
    entries,
    metadata: {
      n: entries.length,
      meanICC: audit.meanICC,
      sceRange: audit.sceRange,
      distributions: audit.distributions,
      correlations: audit.correlations
    }
  };
}

/**
 * Exporte le Gold Standard gelé en format JSON.
 */
export function exportToJSON(frozen: FrozenGoldStandard): string {
  return JSON.stringify(frozen, null, 2);
}

/**
 * Charge un Gold Standard gelé depuis le dossier de configuration.
 * Fichier source : /config/gold-standard-v4.5-s46.json
 */
export async function loadFrozenGoldStandard(): Promise<FrozenGoldStandard> {
  const response = await fetch('/config/gold-standard-v4.5-s46.json');
  if (!response.ok) {
    throw new Error('Gold standard config introuvable (attendu dans /config/gold-standard-v4.5-s46.json)');
  }
  return response.json();
}
