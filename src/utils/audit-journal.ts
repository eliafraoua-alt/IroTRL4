/**
 * src/utils/audit-journal.ts — Journal d'audit IRO
 * IRO Strength v7.3 — CORRECTIF F-02
 *
 * PROBLÈME CORRIGÉ :
 *   seedFromCohorte() injectait GCH: 2 pour TOUTES les entrées,
 *   indépendamment des scores GCH documentés dans le gold standard.
 *   Cela contaminait le C-index Cox (0.901) et violait la règle anti-GCH=2-défaut.
 *
 * SOLUTION v7.3 :
 *   - L'interface d'entrée accepte maintenant GCH optionnel
 *   - Si GCH documenté est fourni → on l'utilise + gch_conf=0.8
 *   - Si GCH manquant → GCH=1, gch_conf=0.2, notes signale le manque
 *     (conforme à la règle du prompt registry : inconnu → GCH=1 + confiance=0.2)
 *   - Un champ gch_source trace l'origine du score pour l'auditabilité
 */

import Database from 'better-sqlite3';
import { logger } from './logger';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';

export interface AuditEntry {
  id?: number;
  timestamp: string;
  startup_name: string;
  iro_total: number;
  iro_cr: number;
  srd: number;
  DI: number;
  ADC: number;
  IPC: number;
  AR: number;
  CA: number;
  GCH: number;
  ipc_conf: number;
  adc_conf: number;
  gch_conf: number;
  trl: number;
  evaluator: string;
  model_version: string;
  source_type: 'manual' | 'gemini_pipeline' | 'gold_standard' | 'import';
  goodhart_patterns: string;
  notes: string;
  status?: 'active' | 'failed' | 'unknown';
  gold_standard_ref?: string;
  audit_hash?: string;
  prev_hash?: string;
}

export interface JournalStats {
  total_entries: number;
  n_actives: number;
  n_failed: number;
  n_unknown: number;
  mean_iro: number;
  mean_iro_actives: number;
  mean_iro_failed: number;
  delta_separation: number;
  evaluators: string[];
  date_first: string;
  date_last: string;
}

let _db: any = null;

export interface ChainFields {
  audit_hash: string;
  prev_hash:  string;
}

export function applyChainMigration(db: any): void {
  try { db.exec("ALTER TABLE audit_entries ADD COLUMN audit_hash TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE audit_entries ADD COLUMN prev_hash  TEXT DEFAULT '0000000000000000'"); } catch {}
}

export function computeAuditHash(entry: {
  timestamp?:    string;
  startup_name: string;
  iro_total:    number;
  iro_cr?:       number;
  srd?:          number;
  DI?: number; ADC?: number; IPC?: number; AR?: number; CA?: number; GCH?: number;
  evaluator?:    string;
  prev_hash:    string;
}): string {
  const content = JSON.stringify({
    timestamp:    entry.timestamp || '',
    startup_name: entry.startup_name,
    iro_total:    Math.round((entry.iro_total ?? 0) * 10) / 10,
    iro_cr:       Math.round((entry.iro_cr ?? 0) * 10) / 10,
    srd:          Math.round((entry.srd ?? 0) * 10) / 10,
    DI: entry.DI ?? 0, 
    ADC: entry.ADC ?? 0, 
    IPC: entry.IPC ?? 0,
    AR: entry.AR ?? 0, 
    CA: entry.CA ?? 0,  
    GCH: entry.GCH ?? 0,
    evaluator:    entry.evaluator || 'E1',
    prev_hash:    entry.prev_hash,
  });
  return createHash('sha256').update(content).digest('hex').slice(0, 16).toUpperCase();
}

export function getLastHash(db: any): string {
  try {
    const last = db.prepare(
      "SELECT audit_hash FROM audit_entries WHERE audit_hash != '' ORDER BY id DESC LIMIT 1"
    ).get() as { audit_hash: string } | undefined;
    return last?.audit_hash ?? '0000000000000000';
  } catch {
    return '0000000000000000';
  }
}

function getDB(): Database.Database {
  if (!_db) {
    const dbPath = path.join(process.cwd(), 'data', 'iro-journal.db');
    try {
      _db = new Database(dbPath);
      _db.exec(`
        CREATE TABLE IF NOT EXISTS audit_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          startup_name TEXT NOT NULL,
          iro_total REAL NOT NULL,
          iro_cr REAL,
          srd REAL,
          DI INTEGER, ADC INTEGER, IPC INTEGER, AR INTEGER, CA INTEGER, GCH INTEGER,
          ipc_conf REAL DEFAULT 0.8,
          adc_conf REAL DEFAULT 1.0,
          gch_conf REAL DEFAULT 0.8,
          trl INTEGER DEFAULT 5,
          evaluator TEXT DEFAULT 'E1',
          model_version TEXT DEFAULT 'IRO v4.5-S46',
          source_type TEXT DEFAULT 'manual',
          goodhart_patterns TEXT DEFAULT '[]',
          notes TEXT DEFAULT '',
          status TEXT DEFAULT 'unknown',
          gold_standard_ref TEXT
        )
      `);
      applyChainMigration(_db);
    } catch {
      logger.warn('[DB-JOURNAL] better-sqlite3 non disponible, bascule sur le journal en mémoire JSON');
      const mockDbPath = dbPath.replace('.db', '.json');
      const dir = path.dirname(mockDbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let store: any[] = [];
      if (fs.existsSync(mockDbPath)) {
        try { store = JSON.parse(fs.readFileSync(mockDbPath, 'utf8')); } catch {}
      }
      const persist = () => {
        fs.writeFileSync(mockDbPath, JSON.stringify(store, null, 2), 'utf8');
      };
      _db = {
        exec: () => {},
        prepare: (sql: string) => {
          if (sql.includes('INSERT INTO audit_entries')) {
            return {
              run: (...params: any[]) => {
                const nextId = store.length + 1;
                const newRow = {
                  id: nextId,
                  timestamp: params[0],
                  startup_name: params[1],
                  iro_total: params[2],
                  iro_cr: params[3],
                  srd: params[4],
                  DI: params[5], ADC: params[6], IPC: params[7], AR: params[8], CA: params[9], GCH: params[10],
                  ipc_conf: params[11], adc_conf: params[12], gch_conf: params[13], trl: params[14],
                  evaluator: params[15], model_version: params[16], source_type: params[17],
                  goodhart_patterns: params[18], notes: params[19], status: params[20], gold_standard_ref: params[21],
                  audit_hash: params[22],
                  prev_hash: params[23]
                };
                store.push(newRow);
                persist();
                return { lastInsertRowid: nextId };
              }
            };
          }
          return {
            all: (...params: any[]) => {
              if (sql.includes('audit_hash')) {
                // Return entries with non-empty audit_hash, ordered by id ASC
                return store.filter(e => e.audit_hash && e.audit_hash !== '').sort((a,b) => a.id - b.id);
              }
              const filters: any = params[0] || {};
              return [...store];
            },
            get: (...params: any[]) => {
              if (sql.includes('audit_hash')) {
                const valid = store.filter(e => e.audit_hash && e.audit_hash !== '');
                if (valid.length === 0) return undefined;
                return { audit_hash: valid[valid.length - 1].audit_hash };
              }
              return undefined;
            }
          };
        }
      };
    }
  }
  return _db as Database.Database;
}

export function addEntry(entry: Omit<AuditEntry, 'id'>): number {
  const db = getDB();
  const timestamp = entry.timestamp || new Date().toISOString();
  const prev_hash  = getLastHash(db);
  const audit_hash = computeAuditHash({ ...entry, timestamp, prev_hash });

  const stmt = db.prepare(`
    INSERT INTO audit_entries (
      timestamp, startup_name, iro_total, iro_cr, srd,
      DI, ADC, IPC, AR, CA, GCH,
      ipc_conf, adc_conf, gch_conf, trl,
      evaluator, model_version, source_type,
      goodhart_patterns, notes, status, gold_standard_ref,
      audit_hash, prev_hash
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `);
  const result = stmt.run(
    timestamp,
    entry.startup_name,
    entry.iro_total,
    entry.iro_cr,
    entry.srd,
    entry.DI, entry.ADC, entry.IPC, entry.AR, entry.CA, entry.GCH,
    entry.ipc_conf, entry.adc_conf, entry.gch_conf, entry.trl,
    entry.evaluator, entry.model_version, entry.source_type,
    entry.goodhart_patterns, entry.notes, entry.status ?? 'unknown',
    entry.gold_standard_ref ?? null,
    audit_hash,
    prev_hash
  );
  return result.lastInsertRowid as number;
}

export interface ChainVerificationResult {
  valid:       boolean;
  n_entries:   number;
  n_verified:  number;
  broken_at?:  { id: number; startup_name: string; expected_hash: string; stored_hash: string };
  gap_at?:     { id: number; startup_name: string; expected_prev: string; stored_prev: string };
  summary:     string;
}

export function verifyChainIntegrity(db?: any): ChainVerificationResult {
  const targetDb = db || getDB();
  const entries: Array<{
    id: number; timestamp: string; startup_name: string;
    iro_total: number; iro_cr: number; srd: number;
    DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number;
    evaluator: string; audit_hash: string; prev_hash: string;
  }> = targetDb.prepare(
    "SELECT id, timestamp, startup_name, iro_total, iro_cr, srd, DI, ADC, IPC, AR, CA, GCH, evaluator, audit_hash, prev_hash FROM audit_entries WHERE audit_hash != '' ORDER BY id ASC"
  ).all();

  if (entries.length === 0) {
    return { valid: true, n_entries: 0, n_verified: 0, summary: 'Journal vide ou non chaîné (migration E2 requise)' };
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    // Vérifier le hash de l'entrée
    const expected_hash = computeAuditHash({ ...e, prev_hash: e.prev_hash });
    if (expected_hash !== e.audit_hash) {
      return {
        valid: false, n_entries: entries.length, n_verified: i,
        broken_at: { id: e.id, startup_name: e.startup_name, expected_hash, stored_hash: e.audit_hash },
        summary: `⚠ Intégrité compromise à l'entrée id=${e.id} (${e.startup_name})`,
      };
    }
    // Vérifier le chaînage avec l'entrée précédente
    if (i > 0) {
      const expected_prev = entries[i - 1].audit_hash;
      if (e.prev_hash !== expected_prev) {
        return {
          valid: false, n_entries: entries.length, n_verified: i,
          gap_at: { id: e.id, startup_name: e.startup_name, expected_prev, stored_prev: e.prev_hash },
          summary: `⚠ Rupture de chaîne à l'entrée id=${e.id} (${e.startup_name})`,
        };
      }
    }
  }

  return {
    valid: true,
    n_entries: entries.length,
    n_verified: entries.length,
    summary: `✓ Journal intègre — ${entries.length} entrées vérifiées`,
  };
}

export function getEntries(filters?: {
  status?: 'active' | 'failed' | 'unknown';
  evaluator?: string;
  min_iro?: number;
  max_iro?: number;
  limit?: number;
  startup?: string;
}): AuditEntry[] {
  const db = getDB();
  let query = 'SELECT * FROM audit_entries WHERE 1=1';
  const params: any[] = [];

  if (filters?.status)   { query += ' AND status = ?';                     params.push(filters.status); }
  if (filters?.evaluator){ query += ' AND evaluator = ?';                  params.push(filters.evaluator); }
  if (filters?.min_iro !== undefined) { query += ' AND iro_total >= ?';    params.push(filters.min_iro); }
  if (filters?.max_iro !== undefined) { query += ' AND iro_total <= ?';    params.push(filters.max_iro); }
  if (filters?.startup)  { query += ' AND LOWER(startup_name) = LOWER(?)'; params.push(filters.startup); }

  query += ' ORDER BY timestamp DESC';
  if (filters?.limit) { query += ` LIMIT ${filters.limit}`; }

  return db.prepare(query).all(...params) as AuditEntry[];
}

export function getStats(): JournalStats {
  const db = getDB();
  const all = db.prepare('SELECT * FROM audit_entries').all() as AuditEntry[];

  if (all.length === 0) {
    return {
      total_entries: 0, n_actives: 0, n_failed: 0, n_unknown: 0,
      mean_iro: 0, mean_iro_actives: 0, mean_iro_failed: 0, delta_separation: 0,
      evaluators: [], date_first: '', date_last: '',
    };
  }

  const actives = all.filter(e => e.status === 'active');
  const failed  = all.filter(e => e.status === 'failed');
  const mean = (arr: AuditEntry[]) =>
    arr.length ? Math.round(arr.reduce((s, e) => s + e.iro_total, 0) / arr.length * 10) / 10 : 0;

  return {
    total_entries:   all.length,
    n_actives:       actives.length,
    n_failed:        failed.length,
    n_unknown:       all.filter(e => e.status === 'unknown').length,
    mean_iro:        mean(all),
    mean_iro_actives: mean(actives),
    mean_iro_failed:  mean(failed),
    delta_separation: Math.round((mean(actives) - mean(failed)) * 10) / 10,
    evaluators:      [...new Set(all.map(e => e.evaluator))],
    date_first:      all[all.length - 1]?.timestamp ?? '',
    date_last:       all[0]?.timestamp ?? '',
  };
}

export function exportCSV(): string {
  const entries = getEntries();
  const header = [
    'id', 'timestamp', 'startup_name', 'iro_total', 'iro_cr', 'srd',
    'DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH',
    'evaluator', 'model_version', 'source_type', 'status', 'notes',
  ].join(',');

  const rows = entries.map(e => [
    e.id, e.timestamp, `"${e.startup_name}"`, e.iro_total, e.iro_cr, e.srd,
    e.DI, e.ADC, e.IPC, e.AR, e.CA, e.GCH,
    e.evaluator, e.model_version, e.source_type, e.status, `"${e.notes}"`,
  ].join(','));

  return [header, ...rows].join('\n');
}

export function exportJSON(): object {
  const entries = getEntries();
  const stats = getStats();
  return {
    metadata: {
      export_date:  new Date().toISOString(),
      instrument:   'IRO v4.5-S46',
      institution:  'Antigravity Intelligence Platform',
      n_total:      stats.total_entries,
      note:         'TRL 2→3 — données transversales, validation longitudinalen cours',
    },
    statistics: stats,
    entries,
  };
}

/**
 * CORRECTIF F-02 — seedFromCohorte()
 *
 * Interface étendue : GCH est maintenant optionnel dans la signature.
 * Règle appliquée :
 *   - GCH fourni et documenté (0-4) → utilisé tel quel, gch_conf=0.8
 *   - GCH absent ou undefined     → GCH=1, gch_conf=0.2 (conforme règle prompt registry)
 *     La note indique explicitement "GCH non documenté dans l'import"
 *
 * IMPORTANT : l'appelant doit fournir les scores GCH du gold standard
 *   quand ils sont disponibles. Voir src/types/iro.ts → GOLD_STANDARD[].scores.GCH
 */
export function seedFromCohorte(entries: Array<{
  name:   string;
  iro:    number;
  status: 'active' | 'failed';
  DI:     number;
  ADC:    number;
  IPC:    number;
  AR:     number;
  CA:     number;
  GCH?:   number;   // ← OPTIONNEL : si absent → GCH=1 + confiance=0.2
}>) {
  const existing = getEntries({ limit: 1 });
  if (existing.length > 0) return;

  let missingGCH = 0;

  entries.forEach(e => {
    // Règle GCH : utiliser le score documenté ou signaler l'absence
    const hasDocumentedGCH = typeof e.GCH === 'number' && e.GCH >= 0 && e.GCH <= 4;
    const gchScore = hasDocumentedGCH ? e.GCH! : 1;
    const gchConf  = hasDocumentedGCH ? 0.8    : 0.2;
    if (!hasDocumentedGCH) missingGCH++;

    const gchNote = hasDocumentedGCH
      ? `GCH=${gchScore} documenté (gold standard).`
      : `GCH non documenté — GCH=1 + confiance=0.2 (règle prompt registry v4.5-S46).`;

    addEntry({
      timestamp:         new Date().toISOString(),
      startup_name:      e.name,
      iro_total:         e.iro,
      iro_cr:            e.iro * 0.85,
      srd:               30,
      DI: e.DI, ADC: e.ADC, IPC: e.IPC, AR: e.AR, CA: e.CA,
      GCH:               gchScore,
      ipc_conf:          0.8,
      adc_conf:          0.8,
      gch_conf:          gchConf,
      trl:               5,
      evaluator:         'E1',
      model_version:     'IRO v4.5-S46',
      source_type:       'import',
      goodhart_patterns: '[]',
      notes:             `Import cohorte France — annotation rétrospective. ${gchNote}`,
      status:            e.status,
    });
  });

  if (missingGCH > 0) {
    logger.warn(
      `[AuditJournal] seedFromCohorte — ${missingGCH}/${entries.length} entrées sans GCH documenté. ` +
      `GCH=1 + conf=0.2 appliqué. Enrichir depuis gold-standard-v4.3.json pour améliorer la précision du C-index Cox.`
    );
  }
}
