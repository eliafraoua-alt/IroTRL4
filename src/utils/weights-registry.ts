// src/utils/weights-registry.ts  — SOURCE UNIQUE DE VÉRITÉ
// [Unification 10/07/2026, T4] Fichier renommé de iro-weights-v4.8.json vers
// iro-weights-v4.9-es.json pour faire correspondre son nom à son champ interne
// "version": "4.9-ES" — l'incohérence de nommage entretenait la confusion sur
// la version réellement active. Voir aussi les en-têtes _status ajoutés aux
// 6 autres fichiers de poids (v4.3 à v4.7), désormais explicitement archivés.
import weightsConfig from '../config/iro-weights-v4.9-es.json';

export interface IRO_Weights {
  DI: number;
  ADC: number;
  IPC: number;
  AR: number;
  CA: number;
  GCH: number;
  LU: number;
}

export interface SRD_Weights {
  VMM: number;
  NCD: number;
  DFL: number;
}

export const IRO_WEIGHTS: Readonly<IRO_Weights> = weightsConfig.weights as IRO_Weights;
export const SRD_WEIGHTS: Readonly<SRD_Weights> = weightsConfig.srd_weights as SRD_Weights;
export const WEIGHTS_VERSION: string            = weightsConfig.version;
export const WEIGHTS_FROZEN: boolean            = weightsConfig.frozen;

// Fonction utilitaire pour les calculs inline (stress-test, scenario-simulator, etc.)
export function calcWeightedScore(
  scores: Partial<IRO_Weights>,
  weights: IRO_Weights = IRO_WEIGHTS,
): number {
  return Object.entries(weights).reduce(
    (sum, [k, w]) => sum + (scores[k as keyof IRO_Weights] ?? 0) * w,
    0,
  );
}
