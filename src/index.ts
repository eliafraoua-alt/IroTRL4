import 'dotenv/config';
import { logger } from './utils/logger';
import chalk from 'chalk';
import { initDB } from './database';
import { runCollect }   from './commands/collect';
import { runScore }     from './commands/score';
import { runSCE }       from './commands/sce';
import { runValidate }  from './commands/validate';
import { runFreeze }    from './commands/freeze';
import { runR2 }        from './commands/r2';
import { runStatus }    from './commands/status';
import { runBatch }     from './commands/batch_iro';

const db = await initDB(process.env.DB_PATH ?? './data/pipeline.db') as any;
const command = process.argv[2];

const COMMANDS: Record<string, () => Promise<void>> = {
  collect:  () => runCollect(db),
  score:    () => runScore(db),
  sce:      () => runSCE(db),
  validate: () => runValidate(db),
  freeze:   () => runFreeze(db),
  r2:       () => runR2(db),
  status:   () => runStatus(db),
  batch:    () => runBatch(),
};

async function main() {
  logger.info(chalk.bold.blue('\n══ IRO Pipeline CLI v1.0 ══\n'));

  if (!command || !COMMANDS[command]) {
    logger.info(chalk.yellow('Commandes disponibles :'));
    logger.info('  npm run status    — état de la pipeline');
    logger.info('  npm run collect   — phase 1 : collecte API');
    logger.info('  npm run score     — phase 2 : notation IPC/GCH');
    logger.info('  npm run sce       — phase 3 : notation SCE');
    logger.info('  npm run validate  — audit du gold standard');
    logger.info('  npm run r2        — calcul R²');
    logger.info('  npm run freeze    — gel et export JSON');
    logger.info('  npm run batch     — annotation batch TRL 4\n');
    process.exit(0);
  }

  try {
    await COMMANDS[command]();
  } catch (err: any) {
    logger.error(chalk.red('\n✗ Erreur :'), err);
    process.exit(1);
  }
}

main();
