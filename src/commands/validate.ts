import chalk from 'chalk';
import Table from 'cli-table3';
import type Database from 'better-sqlite3';

export async function runValidate(db: Database.Database) {
  const data = db.prepare(`
    SELECT name, iro_computed, sce_final, icc
    FROM startups 
    WHERE iro_computed IS NOT NULL AND sce_final IS NOT NULL
    ORDER BY updated_at DESC
  `).all() as any[];

  if (data.length === 0) {
    console.log(chalk.yellow('Pas assez de données pour la validation (besoin de IRO + SCE).'));
    return;
  }

  const table = new Table({
    head: ['Startup', 'IRO (LLM)', 'SCE (Expert)', 'Delta', 'ICC'],
    colAligns: ['left', 'center', 'center', 'center', 'center']
  });

  data.forEach(row => {
    const delta = Math.abs(row.iro_computed - row.sce_final).toFixed(1);
    table.push([
      row.name,
      row.iro_computed.toFixed(1),
      row.sce_final.toFixed(1),
      delta,
      row.icc.toFixed(2)
    ]);
  });

  console.log(chalk.cyan('\n--- Rapport de Validation IRO vs SCE ---'));
  console.log(table.toString());
}
