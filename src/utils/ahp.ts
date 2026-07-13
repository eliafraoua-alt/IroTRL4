/**
 * ahp.ts — Module de calcul AHP (Analytic Hierarchy Process)
 * Utilisé pour dériver et valider les poids des dimensions IRO.
 */

export interface AHPMatrix {
  dimensions: string[];
  comparisons: number[][];  // matrice n×n de comparaisons par paires (échelle 1-9 Saaty)
}

export interface AHPResult {
  weights: Record<string, number>;
  consistencyRatio: number;
  isConsistent: boolean;
  lambdaMax: number;
  warning?: string;
}

/**
 * Calcule les poids à partir d'une matrice de comparaison par paires.
 * Implémente la méthode du vecteur propre (approximation par normalisation).
 */
export function computeAHPWeights(matrix: AHPMatrix): AHPResult {
  const n = matrix.dimensions.length;
  const M = matrix.comparisons;
  
  // 1. Normaliser chaque colonne
  // Somme de chaque colonne
  const colSums = M[0].map((_, j) => M.reduce((s, row) => s + row[j], 0));
  
  // Matrice normalisée
  const normalized = M.map(row => row.map((val, j) => val / colSums[j]));
  
  // 2. Vecteur de priorité = moyenne de chaque ligne normalisée
  const weights = normalized.map(row => row.reduce((s, v) => s + v, 0) / n);
  
  // 3. Ratio de cohérence (CR) — CR < 0.10 requis pour la validité
  // Calcul de lambdaMax
  const weightedSum = M.map((row, i) =>
    row.reduce((s, val, j) => s + val * weights[j], 0)
  );
  
  const lambdaMax = weightedSum.reduce((s, ws, i) => s + ws / weights[i], 0) / n;
  const CI = (lambdaMax - n) / (n - 1);
  
  // Index aléatoire de Saaty (Random Index)
  const RI_TABLE: Record<number, number> = { 
    1: 0, 
    2: 0, 
    3: 0.58, 
    4: 0.90, 
    5: 1.12, 
    6: 1.24, 
    7: 1.32,
    8: 1.41,
    9: 1.45,
    10: 1.49
  };
  
  const CR = CI / (RI_TABLE[n] || 1.24);
  
  return {
    weights: Object.fromEntries(matrix.dimensions.map((d, i) => [d, weights[i]])),
    consistencyRatio: CR,
    isConsistent: CR < 0.10,
    lambdaMax,
    warning: CR >= 0.10 ? `Matrice incohérente (CR=${CR.toFixed(3)}) — réviser les jugements` : undefined
  };
}

/**
 * Matrice AHP pré-remplie à partir des poids Delphi v4.3.
 * Sert de base de référence pour le panel d'experts.
 */
export const INITIAL_AHP_MATRIX: AHPMatrix = {
  dimensions: ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'],
  comparisons: [
    //       DI    ADC   IPC   AR    CA    GCH
    /* DI  */ [1,    0.82, 0.82, 1.38, 1.38, 1.50],
    /* ADC */ [1.22, 1,    1,    1.69, 1.69, 1.83],
    /* IPC */ [1.22, 1,    1,    1.69, 1.69, 1.83],
    /* AR  */ [0.72, 0.59, 0.59, 1,    1,    1.08],
    /* CA  */ [0.72, 0.59, 0.59, 1,    1,    1.08],
    /* GCH */ [0.67, 0.55, 0.55, 0.92, 0.92, 1   ],
  ]
};
