import type Database from 'better-sqlite3';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { fetchCrunchbase } from '../collectors/crunchbase';
import { fetchGitHub }     from '../collectors/github';
import { fetchPatents }    from '../collectors/patents';
import { normalizeToIROScores } from '../normalizer';

export async function runCollect(db: Database.Database) {
  // Récupérer uniquement les startups non encore collectées
  const pending = db.prepare(`
    SELECT * FROM startups WHERE raw_data IS NULL
    ORDER BY name
  `).all() as any[];

  if (pending.length === 0) {
    console.log(chalk.green('✓ Toutes les startups ont déjà été collectées.'));
    console.log('  Relancer avec --force pour re-collecter.\n');
    return;
  }

  console.log(chalk.bold(`\nCollecte de ${pending.length} startup(s)...\n`));

  const update = db.prepare(`
    UPDATE startups SET
      raw_data = ?, collect_date = datetime('now'),
      collect_errors = ?,
      auto_DI = ?, auto_ADC = ?, auto_AR = ?, auto_CA = ?,
      auto_completeness = ?,
      status = 'collected',
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const rateLimitMs = parseInt(process.env.RATE_LIMIT_MS ?? '1200');

  for (let i = 0; i < pending.length; i++) {
    const startup = pending[i];
    const spinner = ora(
      `[${i+1}/${pending.length}] ${startup.name}`
    ).start();

    const errors: string[] = [];
    let crunchbase = null, github = null, patents = null;

    try {
      crunchbase = await fetchCrunchbase(startup.crunchbase_slug);
    } catch (e: any) {
      errors.push(`Crunchbase: ${e.message}`);
    }

    try {
      if (startup.github_org) {
        github = await fetchGitHub(startup.github_org);
      }
    } catch (e: any) {
      errors.push(`GitHub: ${e.message}`);
    }

    try {
      patents = await fetchPatents(startup.name);
    } catch (e: any) {
      errors.push(`Patents: ${e.message}`);
    }

    const raw = { crunchbase, github, patents };
    const normalized = normalizeToIROScores({
      name: startup.name,
      vertical: startup.vertical,
      crunchbase, github, patents,
      financials: null,
      collectDate: new Date().toISOString(),
      errors
    });

    // Sauvegarder les données brutes
    const rawPath = path.join('./data/raw', `${startup.id}.json`);
    fs.mkdirSync('./data/raw', { recursive: true });
    fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));

    update.run(
      JSON.stringify(raw),
      JSON.stringify(errors),
      normalized.scores.DI ?? null,
      normalized.scores.ADC ?? null,
      normalized.scores.AR ?? null,
      normalized.scores.CA ?? null,
      normalized.completeness,
      startup.id
    );

    if (errors.length > 0) {
      spinner.warn(`${startup.name} — ${errors.length} erreur(s): ${errors.join(', ')}`);
    } else {
      spinner.succeed(`${startup.name} — complétude: ${Math.round(normalized.completeness * 100)}%`);
    }

    // Rate limiting
    if (i < pending.length - 1) {
      await new Promise(r => setTimeout(r, rateLimitMs));
    }
  }

  console.log(chalk.bold.green(`\n✓ Collecte terminée — ${pending.length} startup(s) traitées\n`));
  console.log('Prochaine étape : npm run score\n');
}
