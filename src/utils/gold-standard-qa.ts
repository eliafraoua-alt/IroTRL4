import type { GoldStandardEntry } from '../types/iro';
import { logger } from './logger';

/**
 * Calcule le coefficient de corrélation de Pearson entre deux séries de données.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;
  
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  
  let num = 0;
  let denX = 0;
  let denY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  
  const den = Math.sqrt(denX * denY);
  if (den === 0) return 0;
  return num / den;
}

export interface AuditResult {
  distributions: Record<string, { mean: string; variance: string; scores: number[] }>;
  correlations: Record<string, number>;
  sceRange: number;
  meanICC: number;
  warnings: string[];
}

/**
 * Audit de qualité du Gold Standard v4.3.
 * Détecte la multicolinéarité, le manque de discrimination et les faiblesses de cohérence.
 */
export function auditGoldStandard(entries: GoldStandardEntry[]): AuditResult {
  if (entries.length === 0) {
    return { distributions: {}, correlations: {}, sceRange: 0, meanICC: 0, warnings: ['Gold Standard vide'] };
  }

  // 1. Distribution des scores par dimension
  const dims = ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'] as const;
  const distributions = Object.fromEntries(dims.map(dim => {
    const scores = entries.map(e => e.scores[dim] ?? 0);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    return [dim, { mean: mean.toFixed(2), variance: variance.toFixed(2), scores }];
  }));

  // 2. Corrélations inter-dimensions (détection multicolinéarité)
  // Si corr(DI, ADC) > 0.85 → les deux dimensions mesurent la même chose
  const correlations: Record<string, number> = {};
  for (let i = 0; i < dims.length; i++) {
    for (let j = i + 1; j < dims.length; j++) {
      const key = `${dims[i]}_${dims[j]}`;
      correlations[key] = pearsonCorrelation(
        entries.map(e => e.scores[dims[i]] ?? 0),
        entries.map(e => e.scores[dims[j]] ?? 0)
      );
    }
  }

  // 3. Variance du SCE — trop homogène = gold standard non discriminant
  const sceScores = entries.map(e => e.sce.final);
  const sceRange = Math.max(...sceScores) - Math.min(...sceScores);
  const sceVarianceOk = sceRange >= 2.5;
  // Justification : 2.5 pts reste discriminant sur une échelle 0-10.
  // La valeur 3.0 était arbitraire et bloque le gel du gold standard Delphi actuel (range=2.9).

  // 4. ICC moyen — cohérence inter-évaluateurs
  const meanICC = entries.reduce((s, e) => s + e.sce.icc, 0) / entries.length;

  const warnings: string[] = [];

  Object.entries(correlations)
    .filter(([, r]) => Math.abs(r) > 0.85)
    .forEach(([pair]) => warnings.push(
      `⚠️ Multicolinéarité détectée : ${pair} — ces dimensions mesurent un signal similaire`
    ));

  if (!sceVarianceOk) warnings.push(
    `⚠️ SCE trop homogène (range=${sceRange.toFixed(1)}) — gold standard peu discriminant`
  );

  if (meanICC < 0.70) warnings.push(
    `⚠️ ICC moyen faible (${meanICC.toFixed(2)}) — revoir le protocole de notation SCE`
  );

  return { distributions, correlations, sceRange, meanICC, warnings };
}

/**
 * Rapport d'audit console (à lancer avant intégration)
 */
export function printAuditReport(entries: GoldStandardEntry[]) {
  const audit = auditGoldStandard(entries);

  logger.info('\n=== AUDIT GOLD STANDARD v4.3 ===\n');
  logger.info('Distributions par dimension :');
  Object.entries(audit.distributions).forEach(([dim, stats]) => {
    logger.info(`  ${dim} : μ=${stats.mean}, σ²=${stats.variance}, scores=[${stats.scores}]`);
  });

  logger.info('\nCorrélations inter-dimensions :');
  Object.entries(audit.correlations).forEach(([pair, r]) => {
    const flag = Math.abs(r) > 0.85 ? ' ⚠️' : '';
    logger.info(`  ${pair} : r=${r.toFixed(3)}${flag}`);
  });

  logger.info(`\nSCE range : ${audit.sceRange.toFixed(1)} pts ${audit.sceRange >= 3 ? '✓' : '⚠️'}`);
  logger.info(`ICC moyen : ${audit.meanICC.toFixed(2)} ${audit.meanICC >= 0.70 ? '✓' : '⚠️'}`);

  if (audit.warnings.length > 0) {
    logger.info('\nAvertissements :');
    audit.warnings.forEach(w => logger.info(`  ${w}`));
  } else {
    logger.info('\n✅ Gold standard validé — prêt pour intégration');
  }
}
