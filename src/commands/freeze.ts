import type Database from 'better-sqlite3';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs';

export async function runFreeze(db: Database.Database) {
  const ready = (db.prepare(`
    SELECT COUNT(*) as n FROM startups
    WHERE sce_final IS NOT NULL AND final_GCH IS NOT NULL
  `).get() as any).n;

  const total = (db.prepare('SELECT COUNT(*) as n FROM startups').get() as any).n;

  if (ready < total) {
    console.log(chalk.yellow(
      `\n⚠ ${total - ready} startup(s) incomplète(s). ` +
      `Geler quand même ? (le gold standard sera partiel)\n`
    ));
    const { proceed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'proceed',
      message: `Geler avec ${ready}/${total} entrées ?`,
      default: false
    }]);
    if (!proceed) return;
  }

  const { validatedBy } = await inquirer.prompt([{
    type: 'input',
    name: 'validatedBy',
    message: 'Validé par (nom + rôle) :',
    validate: (v: string) => v.length >= 3 || 'Requis'
  }]);

  // Construire le gold standard complet (10 Delphi + nouveaux)
  const newEntries = db.prepare(`
    SELECT * FROM startups
    WHERE sce_final IS NOT NULL AND final_GCH IS NOT NULL
  `).all() as any[];

  // Charger les 10 entrées Delphi
  const delphiPath = './data/gold-standard-delphi-v43.json';
  const delphi = fs.existsSync(delphiPath)
    ? JSON.parse(fs.readFileSync(delphiPath, 'utf-8'))
    : [];

  const allEntries = [
    ...delphi,
    ...newEntries.map(e => ({
      id: e.id,
      name: e.name,
      vertical: e.vertical,
      modelVersion: '4.3',
      migrated: false,
      dateNotation: e.scored_P2_at,
      scores: {
        DI: e.final_DI, ADC: e.final_ADC, IPC: e.final_IPC,
        AR: e.final_AR, CA: e.final_CA,  GCH: e.final_GCH
      },
      confidence: {
        ipc_confiance: e.ipc_confiance,
        adc_confiance: e.adc_confiance,
        gch_confiance: e.gch_confiance
      },
      sce: { final: e.sce_final, icc: e.icc },
      notes: e.notes,
      sourcesDocumentees: []
    }))
  ];

  const frozen = {
    version: '4.3',
    frozenAt: new Date().toISOString(),
    validatedBy,
    n: allEntries.length,
    entries: allEntries
  };

  const outPath = `./data/output/gold-standard-v4.3-n${allEntries.length}.json`;
  fs.mkdirSync('./data/output', { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(frozen, null, 2));

  console.log(chalk.bold.green(`\n✓ Gold standard gelé : ${outPath}`));
  console.log(`  ${allEntries.length} entrées (${delphi.length} Delphi + ${newEntries.length} nouvelles)`);
  console.log(chalk.bold('\nProchaines étapes :'));
  console.log('  1. Copier le fichier dans /public/config/ de l\'application IRO');
  console.log('  2. Lancer npm run r2 pour le rapport R² final');
  console.log('  3. Mettre à jour l\'annotation R² dans l\'UI\n');
}
