import chalk from 'chalk';
import inquirer from 'inquirer';
import type Database from 'better-sqlite3';

export async function runSCE(db: Database.Database) {
  const startups = db.prepare('SELECT id, name FROM startups').all() as any[];
  if (startups.length === 0) {
    console.log(chalk.yellow('Aucune startup en base.'));
    return;
  }

  const { startupId, sceE1, sceE2, sceFinal, icc } = await inquirer.prompt([
    {
      type: 'list',
      name: 'startupId',
      message: 'Quelle startup voulez-vous calibrer ?',
      choices: startups.map(s => ({ name: s.name, value: s.id }))
    },
    { type: 'number', name: 'sceE1', message: 'Score SCE Expert 1 (E1) :' },
    { type: 'number', name: 'sceE2', message: 'Score SCE Expert 2 (E2) :' },
    { type: 'number', name: 'sceFinal', message: 'Score SCE Final (Consensus) :' },
    { type: 'number', name: 'icc', message: 'ICC (Cohérence inter-évaluateurs) :', default: 0.8 }
  ]);

  db.prepare(`
    UPDATE startups 
    SET sce_E1_final = ?, sce_E2_final = ?, sce_final = ?, icc = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(sceE1, sceE2, sceFinal, icc, startupId);

  console.log(chalk.green('Calibration expert enregistrée.'));
}
