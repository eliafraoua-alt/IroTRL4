import { createRequire } from 'module';
import { logger } from './utils/logger';
import path from 'path';
import fs from 'fs';

/**
 * CORRECTIF AUDIT PROD-01 — Le serveur de production ne démarrait pas.
 *
 * `createRequire(import.meta.url)` fonctionne en ESM (mode dev via tsx), mais le
 * build de production est bundlé en CJS par esbuild (`--format=cjs`). Dans ce
 * contexte, esbuild remplace `import.meta` par `{}` : `import.meta.url` vaut donc
 * `undefined`, et createRequire lève une ERR_INVALID_ARG_VALUE au chargement du
 * module — le processus meurt avant même d'écouter sur son port.
 *
 * Symptôme : `npm run build` réussit, puis `npm start` (ou `node dist/server.cjs`)
 * plante instantanément. Le bug touchait tout déploiement réel (Docker, Hugging
 * Face, VPS), pas seulement le développement local.
 *
 * Correctif : on ne dépend plus d'`import.meta.url`. En CJS, `require` existe déjà
 * nativement ; en ESM, on le reconstruit à partir d'un chemin de fichier absolu.
 */
const nodeRequire: NodeRequire = (() => {
  // Contexte CJS (build de production) : `require` est déjà disponible.
  if (typeof require === 'function') return require as unknown as NodeRequire;
  // Contexte ESM (dev via tsx) : reconstruction depuis le répertoire courant.
  return createRequire(path.join(process.cwd(), 'index.js'));
})();

export interface IroDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: any[]): { lastInsertRowid: any };
    get<T = any>(...params: any[]): T | undefined;
    all<T = any>(...params: any[]): T[];
  };
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
}

// ── Adaptateur better-sqlite3 ──────────────────────────────────────────────

class BetterSqlite3Wrapper implements IroDatabase {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: any[]) => {
        const res = stmt.run(...params);
        return { lastInsertRowid: res?.lastInsertRowid ?? null };
      },
      get: <T = any>(...params: any[]): T | undefined => {
        return stmt.get(...params);
      },
      all: <T = any>(...params: any[]): T[] => {
        return stmt.all(...params);
      }
    };
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }
}

// ── Adaptateur sql.js (WASM) ──────────────────────────────────────────────

class SqlJsWrapper implements IroDatabase {
  private db: any;
  private dbPath: string;

  constructor(db: any, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  private persist() {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  exec(sql: string): void {
    this.db.run(sql);
    this.persist();
  }

  prepare(sql: string) {
    const db = this.db;
    const persist = () => this.persist();
    return {
      run: (...params: any[]) => {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        stmt.step();
        stmt.free();
        persist();
        return { lastInsertRowid: null };
      },
      get: <T = any>(...params: any[]): T | undefined => {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const hasRow = stmt.step();
        let result: T | undefined = undefined;
        if (hasRow) {
          result = stmt.getAsObject() as T;
          if (Object.keys(result as object).length === 0) {
            result = undefined;
          }
        }
        stmt.free();
        return result;
      },
      all: <T = any>(...params: any[]): T[] => {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results: T[] = [];
        while (stmt.step()) {
          const row = stmt.getAsObject() as T;
          results.push(row);
        }
        stmt.free();
        return results;
      }
    };
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    const db = this.db;
    const persist = () => this.persist();
    return ((...args: any[]) => {
      db.run('BEGIN TRANSACTION');
      try {
        const res = fn(...args);
        db.run('COMMIT');
        persist();
        return res;
      } catch (err) {
        db.run('ROLLBACK');
        throw err;
      }
    }) as unknown as T;
  }

  close(): void {
    this.persist();
    this.db.close();
  }
}

// ── Adaptateur JSON (Dernier recours) ──────────────────────────────────────────────

class JsonWrapper implements IroDatabase {
  private jsonPath: string;
  private store: Record<string, any[]> = {};

  constructor(jsonPath: string) {
    this.jsonPath = jsonPath;
    logger.warn('[DB] Utilisation du fallback JSON — développement uniquement');
    if (fs.existsSync(this.jsonPath)) {
      try {
        this.store = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8'));
      } catch {
        this.store = {};
      }
    }
  }

  private persist() {
    fs.writeFileSync(this.jsonPath, JSON.stringify(this.store, null, 2), 'utf8');
  }

  exec(sql: string): void {
    this.persist();
  }

  prepare(sql: string) {
    return {
      run: (...params: any[]) => {
        this.persist();
        return { lastInsertRowid: null };
      },
      get: <T = any>(...params: any[]): T | undefined => {
        return undefined;
      },
      all: <T = any>(...params: any[]): T[] => {
        return [];
      }
    };
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      const res = fn(...args);
      this.persist();
      return res;
    }) as unknown as T;
  }

  close(): void {
    this.persist();
  }
}

// ── Factory principale ─────────────────────────────────────────────────────

export async function initDB(dbPath: string): Promise<IroDatabase> {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let db: IroDatabase | null = null;

  // 1. Essai better-sqlite3
  try {
    let Database = nodeRequire('better-sqlite3');
    if (Database.default) Database = Database.default;
    const nativeDb = new Database(dbPath);
    db = new BetterSqlite3Wrapper(nativeDb);
    logger.info('[DB] better-sqlite3 (natif) — OK');
  } catch (err) {
    // 2. Essai sql.js WASM
    try {
      const initSqlJs = nodeRequire('sql.js');
      const SQL = await initSqlJs();
      const fileBuffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
      const wasmDb = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();
      db = new SqlJsWrapper(wasmDb, dbPath);
      logger.warn('[DB] Fallback sql.js (WASM) — better-sqlite3 non disponible');
    } catch (err2) {
      // 3. Fallback JSON
      const jsonPath = dbPath.replace('.db', '.json');
      db = new JsonWrapper(jsonPath);
      logger.error('[DB] Fallback JSON — aucun moteur SQLite disponible');
    }
  }

  // Initialisation du schéma de la base
  db.exec(`
    CREATE TABLE IF NOT EXISTS startups (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      vertical      TEXT NOT NULL,
      crunchbase_slug TEXT,
      github_org    TEXT,
      status        TEXT DEFAULT 'pending',
      -- phase 1
      raw_data      TEXT,
      collect_date  TEXT,
      collect_errors TEXT,
      -- auto scores
      auto_DI       INTEGER, auto_ADC INTEGER, auto_IPC INTEGER,
      auto_AR       INTEGER, auto_CA  INTEGER,
      auto_completeness REAL,
      -- phase 2 — notation manuelle
      manual_IPC    INTEGER, manual_GCH INTEGER,
      ipc_confiance REAL,    adc_confiance REAL, gch_confiance REAL,
      evaluator_P2  TEXT,    scored_P2_at TEXT,
      -- phase 3 — SCE évaluateur 1
      sce_E1_robustesse    REAL, sce_E1_diff REAL, sce_E1_maturite REAL,
      sce_E1_final         REAL, sce_E1_evaluator TEXT,
      -- phase 3 — SCE évaluateur 2
      sce_E2_robustesse    REAL, sce_E2_diff REAL, sce_E2_maturite REAL,
      sce_E2_final         REAL, sce_E2_evaluator TEXT,
      -- résultats finaux
      sce_final     REAL,    icc REAL,
      final_DI      INTEGER, final_ADC INTEGER, final_IPC INTEGER,
      final_AR      INTEGER, final_CA  INTEGER, final_GCH INTEGER,
      iro_computed  REAL,
      sources       TEXT,
      notes         TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pipeline_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      phase     TEXT,
      startup   TEXT,
      action    TEXT,
      detail    TEXT,
      logged_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS regression_tests (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_version  TEXT,
      startup_name    TEXT,
      expected_min    REAL, expected_max REAL,
      actual_iro      REAL,
      passed          INTEGER,
      tested_at       TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seeding si startups est vide
  const countObj = db.prepare('SELECT COUNT(*) as n FROM startups').get();
  const count = countObj ? (countObj as any).n : 0;
  if (count === 0) {
    seedTargets(db);
  }

  return db;
}

function seedTargets(db: IroDatabase) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO startups (id, name, vertical, crunchbase_slug, github_org, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `);

  const targets = [
    ['cb-001', 'Cohere',           'LLM B2B',              'cohere-ai',         'cohere-ai'],
    ['cb-002', 'AI21 Labs',        'LLM généraliste',       'ai21-labs',         'AI21Labs'],
    ['cb-003', 'Aleph Alpha',      'LLM souverain',         'aleph-alpha',       'Aleph-Alpha'],
    ['cb-004', 'Together AI',      'LLM infra',             'together-ai',       'togethercomputer'],
    ['cb-005', 'Owkin',            'IA santé / oncologie',  'owkin',             'owkin'],
    ['cb-006', 'Bioptimus',        'IA biologie',           'bioptimus',         'bioptimus'],
    ['cb-007', 'Incepto',          'IA radiologie',         'incepto',           null],
    ['cb-008', 'Cradle',           'IA protéines',          'cradle-bio',        null],
    ['cb-009', 'Ezra',             'IA détection cancer',   'ezra-health',       null],
    ['cb-010', 'Sonio',            'IA échographie',        'sonio',             null],
    ['cb-011', 'Glean',            'IA recherche entreprise','glean-2',          null],
    ['cb-012', 'Writer',           'IA contenu entreprise', 'writer-2',          'writer'],
    ['cb-013', 'Gong',             'IA sales intelligence', 'gong-io',           null],
    ['cb-014', 'Ironclad',         'IA contrats légaux',    'ironclad',          null],
    ['cb-015', 'Runway',           'IA vidéo créatif',      'runway-2',          null],
    ['cb-016', 'Synthesia',        'IA vidéo avatar',       'synthesia',         null],
    ['cb-017', 'Descript',         'IA audio/vidéo édit.',  'descript',          null],
    ['cb-018', 'Leena AI',         'IA RH',                 'leena-ai',          null],
    ['cb-019', 'Exotec',           'IA robotique logistique','exotec-solutions', null],
    ['cb-020', 'Hugging Face',     'IA MLOps / hub',        'hugging-face',      'huggingface'],
    ['cb-021', 'Weights & Biases', 'IA expérimentation',    'weights-biases',    'wandb'],
    ['cb-022', 'Scale AI',         'IA data labeling',      'scale-ai',          'scaleapi'],
    ['cb-023', 'Landing AI',       'IA vision industrielle','landing-ai',        'landing-ai'],
    ['cb-024', 'Tractable',        'IA sinistres assurance','tractable',         null],
    ['cb-025', 'Helsing',          'IA défense',            'helsing',           null],
    ['cb-026', 'Preligens',        'IA imagerie satellite', 'preligens',         null],
    ['cb-027', 'Harvey',           'IA juridique',          'harvey-2',          null],
    ['cb-028', 'Casetext',         'IA recherche légale',   'casetext',          null],
    ['cb-029', 'Planful',          'IA finance planning',   'planful',           null],
    ['cb-030', 'Numeral',          'IA compliance TVA',     'numeral',           null],
    ['cb-031', 'Nous Research',    'LLM open',              'nous-research',     'NousResearch'],
    ['cb-032', 'Imbue',            'LLM raisonnement',      'imbue',             null],
    ['cb-033', 'Inflection AI',    'LLM assistant',         'inflection-ai',     null],
    ['cb-034', 'xAI',              'LLM généraliste',       'x-ai',              'xai-org'],
    // Startups benchmark bas — biais de survie
    ['cb-035', 'Stability AI',     'LLM image (restructuré)','stability-ai',     'Stability-AI'],
    ['cb-036', 'Adept AI',         'IA agents (acquis)',    'adept-ai-labs',     'adept-ai-labs'],
    ['cb-037', 'Character.AI',     'LLM consumer',          'character-ai',      null],
    ['cb-038', 'Jasper AI',        'IA contenu (stagnant)', 'jasper-ai',         null],
    ['cb-039', 'Covariant',        'IA robotique',          'covariant-ai',      null],
    ['cb-040', 'Sakana AI',        'LLM évolutionnaire',    'sakana-ai',         'SakanaAI'],
  ];

  const insertMany = db.transaction(() => {
    for (const t of targets) insert.run(...t);
  });
  insertMany();
  logger.info(`✓ ${targets.length} startups initialisées en base`);
}
