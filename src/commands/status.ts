import type Database from 'better-sqlite3';
import chalk from 'chalk';
import Table from 'cli-table3';

export async function runStatus(db: Database.Database) {
  const rows = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN raw_data IS NOT NULL THEN 1 ELSE 0 END) as collected,
      SUM(CASE WHEN manual_IPC IS NOT NULL THEN 1 ELSE 0 END) as scored_p2,
      SUM(CASE WHEN sce_E1_final IS NOT NULL THEN 1 ELSE 0 END) as scored_e1,
      SUM(CASE WHEN sce_E2_final IS NOT NULL THEN 1 ELSE 0 END) as scored_e2,
      SUM(CASE WHEN sce_final IS NOT NULL AND final_GCH IS NOT NULL THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN collect_errors != '[]' AND collect_errors IS NOT NULL THEN 1 ELSE 0 END) as errors
    FROM startups
  `).get() as any;

  const pct = (n: number, t: number) =>
    chalk.gray(`(${Math.round(n/t*100)}%)`);

  console.log(chalk.bold('\n── État de la pipeline ──\n'));
  console.log(`  Total startups      : ${chalk.bold(rows.total)}`);
  console.log(`  Phase 1 — Collecte  : ${chalk.cyan(rows.collected)}/${rows.total} ${pct(rows.collected, rows.total)}`);
  console.log(`  Phase 2 — IPC/GCH   : ${chalk.cyan(rows.scored_p2)}/${rows.total} ${pct(rows.scored_p2, rows.total)}`);
  console.log(`  Phase 3 — SCE E1    : ${chalk.cyan(rows.scored_e1)}/${rows.total} ${pct(rows.scored_e1, rows.total)}`);
  console.log(`  Phase 3 — SCE E2    : ${chalk.cyan(rows.scored_e2)}/${rows.total} ${pct(rows.scored_e2, rows.total)}`);
  console.log(`  Prêts à geler       : ${chalk.green(rows.ready)}/${rows.total} ${pct(rows.ready, rows.total)}`);
  if (rows.errors > 0) {
    console.log(`  Erreurs collecte    : ${chalk.red(rows.errors)}`);
  }

  // Détail par verticale
  const byVertical = db.prepare(`
    SELECT vertical,
      COUNT(*) as n,
      SUM(CASE WHEN sce_final IS NOT NULL THEN 1 ELSE 0 END) as done
    FROM startups
    GROUP BY vertical
    ORDER BY vertical
  `).all() as any[];

  console.log(chalk.bold('\n── Par verticale ──\n'));
  const table = new Table({
    head: ['Verticale', 'Total', 'Terminées', 'Avancement'],
    style: { head: ['cyan'] }
  });

  for (const row of byVertical) {
    const bar = '█'.repeat(Math.round(row.done / row.n * 10)) +
                '░'.repeat(10 - Math.round(row.done / row.n * 10));
    table.push([row.vertical, row.n, row.done, bar]);
  }
  console.log(table.toString());

  // Startups avec erreurs de collecte
  if (rows.errors > 0) {
    const errored = db.prepare(`
      SELECT name, collect_errors FROM startups
      WHERE collect_errors != '[]' AND collect_errors IS NOT NULL
    `).all() as any[];

    console.log(chalk.bold.red('\n── Erreurs de collecte ──\n'));
    for (const e of errored) {
      console.log(`  ${chalk.yellow(e.name)}: ${e.collect_errors}`);
    }
  }

  console.log('');
}
