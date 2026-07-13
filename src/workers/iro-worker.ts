// src/workers/iro-worker.ts
import type { GoldStandardEntry, IROScores } from '../types/iro';
import { IRO_WEIGHTS } from '../utils/weights-registry';

interface Weights {
  DI: number;
  ADC: number;
  IPC: number;
  AR: number;
  CA: number;
  GCH: number;
}

interface IROWorkerMessage {
  goldStandard: GoldStandardEntry[];
  currentScores: IROScores;
  ipcConf: number;
  iterations?: number;
}

self.onmessage = (event: MessageEvent<IROWorkerMessage>) => {
  const { goldStandard, currentScores, ipcConf, iterations = 500 } = event.data;
  const keys = ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'] as const;

  // Poids initiaux (théoriques)
  let w: Weights = { ...IRO_WEIGHTS };
  const lr = 0.001;

  for (let iter = 0; iter < iterations; iter++) {
    const grad: Record<string, number> = { DI: 0, ADC: 0, IPC: 0, AR: 0, CA: 0, GCH: 0 };

    for (const g of goldStandard) {
      const s = g.scores;
      const gch = s.GCH ?? 0;
      const ipcE = s.IPC * (0.5 + 0.5 * 0.8); // On utilise 0.8 comme dans iro-engine.ts pour le gold standard
      const brut = s.DI * w.DI + s.ADC * w.ADC + ipcE * w.IPC + s.AR * w.AR + s.CA * w.CA + gch * w.GCH;
      let pred = (brut / 4) * 100;
      if (s.DI === 0) pred = Math.min(pred, 40);
      const err = pred - g.sce.final;

      for (const k of keys) {
        const feat = k === 'IPC' ? s[k] * (0.5 + 0.5 * 0.8) : (s[k] ?? 0);
        grad[k] += err * (feat / 4) * 100;
      }
    }

    for (const k of keys) {
      w[k] = Math.max(0.05, w[k] - lr * grad[k] / goldStandard.length);
    }
    
    const total = keys.reduce((s, k) => s + w[k], 0);
    for (const k of keys) {
      w[k] = Math.round((w[k] / total) * 1000) / 1000;
    }

    if (iter % 50 === 0) {
      self.postMessage({ type: 'progress', iteration: iter, weights: w });
    }
  }

  // Calcul final du R2
  const goldMean = goldStandard.reduce((acc: number, g: GoldStandardEntry) => acc + g.sce.final, 0) / goldStandard.length;
  let ssTot = 0, ssRes = 0;

  for (const g of goldStandard) {
    const s = g.scores;
    const gch = s.GCH ?? 0;
    const ipcE = s.IPC * (0.5 + 0.5 * 0.8);
    const brut = s.DI * w.DI + s.ADC * w.ADC + ipcE * w.IPC + s.AR * w.AR + s.CA * w.CA + gch * w.GCH;
    let pred = (brut / 4) * 100;
    if (s.DI === 0) pred = Math.min(pred, 40);
    ssTot += Math.pow(g.sce.final - goldMean, 2);
    ssRes += Math.pow(g.sce.final - pred, 2);
  }

  const r2 = Math.max(0, Math.round((1 - ssRes / ssTot) * 100) / 100);
  const n = goldStandard.length;
  const k = keys.length;
  const r2Adjusted = n > k + 1 ? 1 - ((1 - r2) * (n - 1) / (n - k - 1)) : r2;
  const meanICC = goldStandard.reduce((acc: number, g: GoldStandardEntry) => acc + (g.sce?.icc || 0), 0) / n;

  // ── Nouvelles métriques normatives ────────────────────────────────────────
  const actuals = goldStandard.map(g => g.sce.final);
  const predicteds = goldStandard.map(g => {
    const s = g.scores;
    const gch = s.GCH ?? 0;
    const ipcE = s.IPC * (0.5 + 0.5 * 0.8);
    const brut = s.DI * w.DI + s.ADC * w.ADC + ipcE * w.IPC + s.AR * w.AR + s.CA * w.CA + gch * w.GCH;
    let pred = (brut / 4) * 100;
    if (s.DI === 0) pred = Math.min(pred, 40);
    return pred / 10; // Normalisation SCE [0-10]
  });

  const spearman = pearsonCorrelation(computeRanks(actuals), computeRanks(predicteds));
  const rmse = Math.sqrt(actuals.reduce((s: number, a: number, i: number) => s + (a - predicteds[i]) ** 2, 0) / n);
  const mae = actuals.reduce((s: number, a: number, i: number) => s + Math.abs(a - predicteds[i]), 0) / n;

  // Calcul du score certifié pour la startup actuelle
  const ipcEff = currentScores.IPC * (0.5 + 0.5 * ipcConf);
  const gchEff = currentScores.GCH ?? 0;
  const brutFin = currentScores.DI * w.DI + currentScores.ADC * w.ADC + ipcEff * w.IPC + currentScores.AR * w.AR + currentScores.CA * w.CA + gchEff * w.GCH;
  let certified = Math.round((brutFin / 4) * 100 * 10) / 10;
  if (currentScores.DI === 0) certified = Math.min(certified, 40);

  self.postMessage({ 
    type: 'complete', 
    weights: w, 
    r2, 
    r2Adjusted,
    meanICC,
    spearman,
    rmse,
    mae,
    certified,
    sampleSize: n,
    variableCount: k,
    isStatisticallyValid: spearman >= 0.70 && meanICC >= 0.70
  });
};

// ── Helpers statistiques ──────────────────────────────────────────────────────

function computeRanks(arr: number[]): number[] {
  const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks  = new Array(arr.length);
  sorted.forEach((item, rank) => { ranks[item.i] = rank + 1; });
  return ranks;
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n   = a.length;
  if (n === 0) return 0;
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
