import type Database from 'better-sqlite3';
import chalk from 'chalk';
import * as ss from 'simple-statistics';
import { IRO_WEIGHTS } from '../utils/weights-registry';

export async function runR2(db: Database.Database) {
  const entries = db.prepare(`
    SELECT *
    FROM startups
    WHERE sce_final IS NOT NULL
      AND final_DI IS NOT NULL AND final_ADC IS NOT NULL
      AND final_IPC IS NOT NULL AND final_AR IS NOT NULL
      AND final_CA IS NOT NULL AND final_GCH IS NOT NULL
    ORDER BY name
  `).all() as any[];

  if (entries.length < 10) {
    console.log(chalk.red(
      `\n✗ Données insuffisantes : ${entries.length} entrée(s) complète(s). ` +
      `Minimum requis : 10.\n`
    ));
    return;
  }

  const n = entries.length;
  const k = 6; // dimensions

  // Poids v4.3
  const WEIGHTS = IRO_WEIGHTS;

  // Calculer IRO pour chaque entrée
  const data = entries.map(e => {
    const ipc_eff = e.final_IPC * (0.5 + 0.5 * (e.ipc_confiance ?? 0.5));
    const adc_eff = e.final_ADC * (0.5 + 0.5 * (e.adc_confiance ?? 0.5));
    const gch_eff = e.final_GCH * (0.5 + 0.5 * (e.gch_confiance ?? 0.5));

    const iro = (
      e.final_DI  * WEIGHTS.DI +
      adc_eff     * WEIGHTS.ADC +
      ipc_eff     * WEIGHTS.IPC +
      e.final_AR  * WEIGHTS.AR +
      e.final_CA  * WEIGHTS.CA +
      gch_eff     * WEIGHTS.GCH
    ) * 25;

    return { name: e.name, iro, sce: e.sce_final, icc: e.icc };
  });

  // R² — corrélation IRO ~ SCE
  const iroValues = data.map(d => d.iro);
  const sceValues = data.map(d => d.sce);

  const r = ss.sampleCorrelation(iroValues, sceValues);
  const r2 = r * r;
  const r2Adjusted = 1 - ((1 - r2) * (n - 1) / (n - k - 1));

  // ICC moyen
  const meanICC = data.reduce((s, d) => s + d.icc, 0) / n;

  // Statistiques descriptives
  const iroMean = ss.mean(iroValues);
  const iroStd  = ss.standardDeviation(iroValues);
  const sceMean = ss.mean(sceValues);
  const sceStd  = ss.standardDeviation(sceValues);

  // Résidus et outliers
  const residuals = data.map(d => ({
    name: d.name,
    residual: d.sce - (sceMean + r * (sceStd / iroStd) * (d.iro - iroMean)),
    iro: d.iro,
    sce: d.sce
  })).sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));

  const outliers = residuals.filter(r => Math.abs(r.residual) > 1.5);

  // Affichage
  console.log(chalk.bold('\n══ RÉSULTATS R² — Gold Standard v4.3 ══\n'));
  console.log(`  n = ${chalk.bold(n)} startups | k = ${k} variables`);
  console.log(`  r  = ${chalk.bold(r.toFixed(4))} (corrélation Pearson)`);
  console.log(`  R² = ${chalk.bold(r2.toFixed(4))}`);
  console.log(`  R² ajusté = ${chalk.bold(r2Adjusted.toFixed(4))}`);
  console.log(`  ICC moyen inter-évaluateurs = ${chalk.bold(meanICC.toFixed(3))}`);

  // Interprétation
  console.log(chalk.bold('\n── Interprétation ──\n'));
  const interpretation =
    r2 >= 0.70 ? chalk.green('✓ Forte cohérence IRO ~ SCE expert') :
    r2 >= 0.50 ? chalk.yellow('◑ Cohérence modérée — enrichissement recommandé') :
    r2 >= 0.30 ? chalk.red('⚠ Cohérence faible — revoir les dimensions') :
                 chalk.red('✗ Cohérence très faible — modèle à réviser');

  console.log(`  ${interpretation}`);

  const significance =
    n >= 60 ? chalk.green(`✓ Significatif (n=${n} ≥ 60)`) :
    n >= 30 ? chalk.yellow(`◑ Partiellement significatif (n=${n}, recommandé : 60)`) :
              chalk.red(`⚠ Non significatif (n=${n} — minimum : 30)`);

  console.log(`  ${significance}`);

  // Annotation complète pour l'UI
  const uiAnnotation = n >= 60
    ? `R² = ${r2.toFixed(2)} (ajusté : ${r2Adjusted.toFixed(2)}) — ` +
      `calibré sur ${n} startups, score expert composite (ICC=${meanICC.toFixed(2)}) — ` +
      `validité de construit, non prédictif`
    : `R² = ${r2.toFixed(2)} ⚠️ — calibré sur ${n} startups ` +
      `(recommandé : 60+) — interpréter avec précaution`;

  console.log(chalk.bold('\n── Annotation UI à utiliser ──\n'));
  console.log(chalk.cyan(`  "${uiAnnotation}"`));

  // Top/Bottom performers
  console.log(chalk.bold('\n── Top 5 IRO ──'));
  [...data].sort((a,b) => b.iro - a.iro).slice(0, 5).forEach((d, i) => {
    console.log(`  ${i+1}. ${d.name.padEnd(25)} IRO=${d.iro.toFixed(1)} SCE=${d.sce.toFixed(1)}`);
  });

  console.log(chalk.bold('\n── Bottom 5 IRO ──'));
  [...data].sort((a,b) => a.iro - b.iro).slice(0, 5).forEach((d, i) => {
    console.log(`  ${i+1}. ${d.name.padEnd(25)} IRO=${d.iro.toFixed(1)} SCE=${d.sce.toFixed(1)}`);
  });

  if (outliers.length > 0) {
    console.log(chalk.bold('\n── Outliers (résidu > 1.5) ──'));
    outliers.forEach(o => {
      console.log(
        `  ${chalk.yellow(o.name.padEnd(25))} ` +
        `IRO=${o.iro.toFixed(1)} SCE=${o.sce.toFixed(1)} ` +
        `résidu=${o.residual > 0 ? '+' : ''}${o.residual.toFixed(2)}`
      );
    });
    console.log(chalk.gray('  → Ces startups méritent une revérification des sources'));
  }

  // Sauvegarder les résultats
  const report = {
    computedAt: new Date().toISOString(),
    n, k, r, r2, r2Adjusted, meanICC,
    uiAnnotation, data, outliers
  };

  const fs = await import('fs');
  const reportPath = './data/output/r2-report.json';
  fs.mkdirSync('./data/output', { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(chalk.bold(`\n✓ Rapport sauvegardé : ${reportPath}\n`));
}
