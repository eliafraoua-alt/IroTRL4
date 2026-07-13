import type Database from 'better-sqlite3';
import chalk from 'chalk';
import inquirer from 'inquirer';

const GCH_DESCRIPTIONS = [
  '0 — Équipe non documentée, aucun parcours vérifiable',
  '1 — Profils LinkedIn cohérents, expérience startup limitée',
  '2 — Équipe établie, au moins un fondateur avec exit ou rôle senior',
  '3 — Profils Tier-1 vérifiables (ex-GAFAM, publications NeurIPS/ICML)',
  '4 — Combinaison rare : publications rang A + expérience op + track record'
];

const IPC_DESCRIPTIONS = [
  '0 — Aucun client, usage non documenté',
  '1 — Pilotes en cours, pas d\'engagement contractuel',
  '2 — Clients nommés, intégration légère, switching possible',
  '3 — Intégration profonde dans processus opérationnels, coût switching réel',
  '4 — Co-construit avec le client, contrats pluriannuels, switching quasi-impossible'
];

export async function runScore(db: Database.Database) {
  const toScore = db.prepare(`
    SELECT s.*, 
      COALESCE(s.auto_DI, 'N/A') as di,
      COALESCE(s.auto_ADC, 'N/A') as adc,
      COALESCE(s.auto_AR, 'N/A') as ar,
      COALESCE(s.auto_CA, 'N/A') as ca
    FROM startups s
    WHERE s.raw_data IS NOT NULL
      AND s.manual_IPC IS NULL
    ORDER BY s.name
  `).all() as any[];

  if (toScore.length === 0) {
    console.log(chalk.green('✓ Toutes les startups ont été notées (IPC/GCH).'));
    return;
  }

  const { evaluator } = await inquirer.prompt([{
    type: 'input',
    name: 'evaluator',
    message: 'Votre identifiant évaluateur (ex: E1_Jean) :',
    validate: (v: string) => v.length >= 2 || 'Identifiant requis'
  }]);

  console.log(chalk.bold(`\n${toScore.length} startup(s) à noter — session : ${evaluator}\n`));
  console.log(chalk.gray('Commandes : [s] passer, [q] quitter et sauvegarder\n'));

  const update = db.prepare(`
    UPDATE startups SET
      manual_IPC = ?, manual_GCH = ?,
      ipc_confiance = ?, adc_confiance = ?, gch_confiance = ?,
      final_IPC = ?, final_GCH = ?,
      evaluator_P2 = ?, scored_P2_at = datetime('now'),
      status = 'scored_p2',
      notes = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  for (let i = 0; i < toScore.length; i++) {
    const s = toScore[i];

    console.log(chalk.bold.cyan(`\n── [${i+1}/${toScore.length}] ${s.name} ──`));
    console.log(chalk.gray(`Verticale : ${s.vertical}`));
    console.log(chalk.gray(`Scores auto : DI=${s.di} ADC=${s.adc} AR=${s.ar} CA=${s.ca}`));

    // Afficher les données brutes collectées
    if (s.raw_data) {
      const raw = JSON.parse(s.raw_data);
      if (raw.crunchbase) {
        console.log(chalk.gray(`Crunchbase : ${raw.crunchbase.totalFundingUsd ?
          '$' + (raw.crunchbase.totalFundingUsd / 1e6).toFixed(1) + 'M levés' : 'N/A'} — ` +
          `${raw.crunchbase.lastFundingType ?? 'N/A'} — ` +
          `${raw.crunchbase.employeeRange ?? 'N/A'} employés`
        ));
      }
      if (raw.github) {
        const gh = raw.github;
        const stars = gh.totalStars ?? gh.stars ?? 0;
        const commits = gh.recentCommits6Months ?? Math.round((gh.total_commits_year ?? 0) / 2);
        
        console.log(chalk.gray(`GitHub : ${stars} stars — ${commits} commits/6m`));
        
        if (gh.tech_stack?.length > 0) {
          console.log(chalk.gray(`  Stack : ${gh.tech_stack.slice(0, 5).join(', ')}${gh.tech_stack.length > 5 ? '...' : ''}`));
        }
        if (gh.llm_dependencies?.length > 0) {
          console.log(chalk.blue(`  LLM Deps : ${gh.llm_dependencies.join(', ')}`));
        }
      }
      if (raw.patents) {
        console.log(chalk.gray(`Brevets : ${raw.patents.totalPatents} total`));
      }
    }

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'skip',
        message: 'Action :',
        choices: ['noter', 'passer (plus tard)', 'quitter'],
        default: 'noter'
      }
    ]);

    if (answers.skip === 'quitter') {
      console.log(chalk.yellow('\n✓ Session sauvegardée. Reprendre avec npm run score.\n'));
      break;
    }
    if (answers.skip === 'passer (plus tard)') continue;

    // Notation IPC
    console.log(chalk.bold('\nIPC — Intégration Processus Critiques :'));
    IPC_DESCRIPTIONS.forEach(d => console.log(chalk.gray(`  ${d}`)));

    const ipcAnswers = await inquirer.prompt([
      {
        type: 'list',
        name: 'ipc',
        message: 'Score IPC :',
        choices: ['0', '1', '2', '3', '4']
      },
      {
        type: 'list',
        name: 'ipc_confiance',
        message: 'Confiance IPC :',
        choices: [
          { name: '0.2 — Non vérifié, aucun client nommé', value: '0.2' },
          { name: '0.5 — Partiel, références vagues',       value: '0.5' },
          { name: '0.8 — Probable, références cohérentes',  value: '0.8' },
          { name: '1.0 — Vérifié, contrats documentés',     value: '1.0' },
        ]
      }
    ]);

    // Notation GCH
    console.log(chalk.bold('\nGCH — Gouvernance et Capital Humain :'));
    GCH_DESCRIPTIONS.forEach(d => console.log(chalk.gray(`  ${d}`)));

    const gchAnswers = await inquirer.prompt([
      {
        type: 'list',
        name: 'gch',
        message: 'Score GCH :',
        choices: ['0', '1', '2', '3', '4']
      },
      {
        type: 'list',
        name: 'gch_confiance',
        message: 'Confiance GCH :',
        choices: [
          { name: '0.5 — Non vérifié',                            value: '0.5' },
          { name: '0.8 — LinkedIn / publications vérifiées',      value: '0.8' },
          { name: '1.0 — Références croisées documentées',        value: '1.0' },
        ]
      }
    ]);

    // Confiance ADC
    const adcAnswer = await inquirer.prompt([{
      type: 'list',
      name: 'adc_confiance',
      message: 'Confiance ADC (données vérifiables ?) :',
      choices: [
        { name: '0.5 — Déclaratif, non auditable', value: '0.5' },
        { name: '0.8 — Partiellement vérifiable',  value: '0.8' },
        { name: '1.0 — Sources documentées',        value: '1.0' },
      ]
    }]);

    const noteAnswer = await inquirer.prompt([{
      type: 'input',
      name: 'notes',
      message: 'Notes (sources, doutes, signaux) [optionnel] :',
    }]);

    update.run(
      parseInt(ipcAnswers.ipc),
      parseInt(gchAnswers.gch),
      parseFloat(ipcAnswers.ipc_confiance),
      parseFloat(adcAnswer.adc_confiance),
      parseFloat(gchAnswers.gch_confiance),
      parseInt(ipcAnswers.ipc),   // final_IPC = manual_IPC
      parseInt(gchAnswers.gch),   // final_GCH = manual_GCH
      evaluator,
      noteAnswer.notes || null,
      s.id
    );

    console.log(chalk.green(
      `✓ ${s.name} — IPC=${ipcAnswers.ipc} GCH=${gchAnswers.gch} sauvegardés`
    ));
  }

  // Afficher l'avancement
  const done = (db.prepare(
    'SELECT COUNT(*) as n FROM startups WHERE manual_IPC IS NOT NULL'
  ).get() as any).n;
  const total = (db.prepare('SELECT COUNT(*) as n FROM startups').get() as any).n;
  console.log(chalk.bold(`\nAvancement phase 2 : ${done}/${total}\n`));
}
