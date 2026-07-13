export interface NormalizedResult {
  scores: {
    DI?: number;
    ADC?: number;
    IPC?: number;
    AR?: number;
    CA?: number;
    GCH?: number;
  };
  completeness: number;
}

/**
 * Données brutes acceptées en entrée de la normalisation.
 * Tous les champs sont optionnels — la completeness reflète le taux de remplissage.
 */
export interface RawInputData {
  DI?: number | string;
  ADC?: number | string;
  IPC?: number | string;
  AR?: number | string;
  CA?: number | string;
  GCH?: number | string;
  [key: string]: number | string | undefined;
}

export function normalizeToIROScores(data: RawInputData): NormalizedResult {
  const DIMS = ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'] as const;

  const scores: NormalizedResult['scores'] = {};
  let filled = 0;

  for (const dim of DIMS) {
    const raw = data[dim];
    if (raw !== undefined && raw !== '') {
      const val = typeof raw === 'string' ? parseFloat(raw) : raw;
      if (!isNaN(val) && val >= 0 && val <= 4) {
        scores[dim] = val;
        filled++;
      }
    }
  }

  return {
    scores,
    completeness: filled / DIMS.length,
  };
}
