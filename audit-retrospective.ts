/**
 * scripts/audit-retrospective.ts — Détection des reconstructions rétrospectives
 * dans le journal d'audit IROStrength.
 *
 * CONTEXTE
 * --------
 * Le modèle de Cox dynamique (cox-temporal-covariates.ts) utilise computeIROVelocity(),
 * qui calcule une vélocité (Δ IRO / mois) à partir de la première et de la dernière
 * entrée horodatée (AuditEntry.timestamp) pour une même startup. Cette formule n'est un
 * signal prédictif valide QUE SI chaque entrée a été évaluée avec l'information disponible
 * à sa propre date — et non reconstruite après coup, en connaissance de l'issue finale.
 *
 * Le schéma actuel (audit-journal.ts) n'a qu'un seul champ de date (`timestamp`), sans
 * distinction entre la date que l'entrée prétend représenter et la date réelle de son
 * insertion en base. Ce script exploite deux signaux disponibles malgré cette limite :
 *
 *   H1 — source_type : les entrées marquées 'import' sont explicitement issues d'un
 *        chargement en lot (signal direct, déjà présent dans le schéma).
 *
 *   H2 — cohérence id / timestamp, PAR ENTREPRISE : dans un système alimenté en continu,
 *        l'id auto-incrémenté (proxy de l'ordre d'insertion réel) doit être globalement
 *        croissant avec `timestamp` POUR UNE MÊME STARTUP. Toute inversion (une entrée
 *        insérée après une autre mais datée avant) est la preuve directe qu'au moins
 *        l'une des deux n'a pas été insérée au moment réel qu'elle prétend représenter.
 *        (Comparer les timestamps entre entreprises DIFFÉRENTES n'a pas de sens : chacune
 *        est évaluée à un moment différent de son propre cycle de vie.)
 *
 *   H3 — entreprises multi-entrées : pour les startups ayant ≥2 entrées (celles qui
 *        alimentent computeIROVelocity), on croise H1/H2 spécifiquement sur leurs paires
 *        d'entrées, puisque ce sont les seules dont la vélocité calculée est directement
 *        affectée par un éventuel problème.
 *
 * USAGE
 * -----
 *   npx tsx scripts/audit-retrospective.ts data/iro-journal.db
 *   npx tsx scripts/audit-retrospective.ts --demo      (démonstration sur données synthétiques)
 *
 * SORTIE
 * ------
 * Un rapport dans la console + un CSV détaillé (audit_retrospective_findings.csv).
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';

interface Entry {
  id: number;
  timestamp: string;
  startup_name: string;
  source_type: string;
  iro_total: number;
}

interface Inversion {
  id: number;
  startup_name: string;
  timestamp: string;
  source_type: string;
  reason: string;
}

interface VelocityFlag {
  startup_name: string;
  n_entries: number;
  id_order_consistent: boolean;
  contains_import: boolean;
  ids: number[];
}

function loadEntries(dbPath: string): Entry[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(
    'SELECT id, timestamp, startup_name, source_type, iro_total FROM audit_entries ORDER BY id'
  ).all() as Entry[];
  db.close();
  return rows;
}

function audit(rows: Entry[]) {
  const n = rows.length;

  // ---- H1 : source_type ----
  const sourceCounts: Record<string, number> = {};
  for (const r of rows) sourceCounts[r.source_type] = (sourceCounts[r.source_type] ?? 0) + 1;
  const nImport = sourceCounts['import'] ?? 0;

  // ---- Regroupement par entreprise ----
  const byStartup = new Map<string, Entry[]>();
  for (const r of rows) {
    if (!byStartup.has(r.startup_name)) byStartup.set(r.startup_name, []);
    byStartup.get(r.startup_name)!.push(r);
  }

  // ---- H2 : cohérence id/timestamp, PAR ENTREPRISE ----
  const inversions: Inversion[] = [];
  for (const [name, entries] of byStartup) {
    const byId = [...entries].sort((a, b) => a.id - b.id);
    let maxTsSoFar: Date | null = null;
    let maxIdAtMaxTs: number | null = null;
    for (const r of byId) {
      const ts = new Date(r.timestamp);
      if (maxTsSoFar !== null && ts < maxTsSoFar) {
        inversions.push({
          id: r.id, startup_name: r.startup_name, timestamp: r.timestamp, source_type: r.source_type,
          reason: `pour ${name} : timestamp antérieur à l'entrée id=${maxIdAtMaxTs} déjà insérée ` +
                  `(cette entrée id=${r.id} a été insérée APRÈS, mais prétend représenter une date ANTÉRIEURE)`,
        });
      } else {
        maxTsSoFar = ts;
        maxIdAtMaxTs = r.id;
      }
    }
  }

  // ---- H3 : entreprises multi-entrées suspectes ----
  const multiEntry = [...byStartup.entries()].filter(([, v]) => v.length >= 2);
  const velocityFlagged: VelocityFlag[] = [];
  for (const [name, entries] of multiEntry) {
    const byId = [...entries].sort((a, b) => a.id - b.id).map(e => e.id);
    const byTs = [...entries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).map(e => e.id);
    const consistent = JSON.stringify(byId) === JSON.stringify(byTs);
    const hasImport = entries.some(e => e.source_type === 'import');
    if (!consistent || hasImport) {
      velocityFlagged.push({
        startup_name: name, n_entries: entries.length,
        id_order_consistent: consistent, contains_import: hasImport, ids: byId,
      });
    }
  }

  // ---- Rapport ----
  const lines: string[] = [];
  lines.push('='.repeat(78));
  lines.push("AUDIT DES RECONSTRUCTIONS RÉTROSPECTIVES — JOURNAL D'AUDIT IROSTRENGTH");
  lines.push('='.repeat(78));
  lines.push(`\nEntrées totales analysées : ${n}`);
  lines.push(`Entreprises distinctes    : ${byStartup.size}`);
  lines.push(`Entreprises multi-entrées (alimentant la vélocité Cox) : ${multiEntry.length}`);

  lines.push('\n--- H1 : répartition par source_type ---');
  for (const [st, c] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
    const pct = n ? Math.round((c / n) * 1000) / 10 : 0;
    lines.push(`  ${st.padEnd(20)} : ${String(c).padStart(5)}  (${pct}%)`);
  }
  if (n) lines.push(`\n  => ${Math.round((nImport / n) * 1000) / 10}% des entrées sont explicitement issues d'un import en lot.`);

  lines.push('\n--- H2 : inversions id/timestamp (preuve directe de reconstruction) ---');
  if (inversions.length) {
    lines.push(`  ${inversions.length} inversion(s) détectée(s) :`);
    for (const inv of inversions.slice(0, 20)) {
      lines.push(`    id=${String(inv.id).padStart(5)}  ${inv.startup_name.padEnd(30)}  ${inv.timestamp}  (${inv.source_type})`);
      lines.push(`      -> ${inv.reason}`);
    }
    if (inversions.length > 20) lines.push(`    ... et ${inversions.length - 20} de plus (voir CSV)`);
  } else {
    lines.push('  Aucune inversion détectée.');
  }

  lines.push(`\n--- H3 : entreprises multi-entrées suspectes (${velocityFlagged.length}/${multiEntry.length}) ---`);
  if (velocityFlagged.length) {
    for (const f of velocityFlagged.slice(0, 20)) {
      const reasons: string[] = [];
      if (!f.id_order_consistent) reasons.push('ordre id/timestamp incohérent');
      if (f.contains_import) reasons.push("contient une entrée 'import'");
      lines.push(`    ${f.startup_name.padEnd(30)} (${f.n_entries} entrées) — ${reasons.join(', ')}`);
    }
    if (velocityFlagged.length > 20) lines.push(`    ... et ${velocityFlagged.length - 20} de plus (voir CSV)`);
  } else {
    lines.push('  Aucune entreprise multi-entrées suspecte.');
  }

  const pctFlagged = multiEntry.length ? Math.round((velocityFlagged.length / multiEntry.length) * 1000) / 10 : 0;
  lines.push('\n' + '='.repeat(78));
  lines.push(`ESTIMATION : ${pctFlagged}% des entreprises multi-entrées (celles qui alimentent`);
  lines.push('la covariable de vélocité du modèle de Cox) présentent au moins un signal de');
  lines.push('reconstruction rétrospective potentielle.');
  lines.push('='.repeat(78));

  console.log(lines.join('\n'));
  return { inversions, velocityFlagged, pctFlagged };
}

function writeCsv(result: { inversions: Inversion[]; velocityFlagged: VelocityFlag[] }, path: string) {
  const rows = [['type', 'startup_name', 'id_or_ids', 'timestamp', 'source_type', 'detail']];
  for (const inv of result.inversions) {
    rows.push(['inversion_id_timestamp', inv.startup_name, String(inv.id), inv.timestamp, inv.source_type, inv.reason]);
  }
  for (const vf of result.velocityFlagged) {
    const detail: string[] = [];
    if (!vf.id_order_consistent) detail.push('ordre_incoherent');
    if (vf.contains_import) detail.push('contient_import');
    rows.push(['entreprise_multi_entrees_suspecte', vf.startup_name, vf.ids.join(';'), '', '', detail.join(';')]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  fs.writeFileSync(path, csv, 'utf-8');
  console.log(`\nCSV détaillé écrit : ${path}`);
}

function buildDemoDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE audit_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, startup_name TEXT,
    source_type TEXT, iro_total REAL)`);

  const insert = db.prepare(
    'INSERT INTO audit_entries (timestamp, startup_name, source_type, iro_total) VALUES (?,?,?,?)'
  );

  // CleanCo : 3 évaluations réellement espacées, insérées dans l'ordre chronologique
  const base = new Date('2024-01-01T00:00:00Z').getTime();
  const dayMs = 86400000;
  for (let i = 0; i < 3; i++) {
    const months = [0, 6, 12][i];
    insert.run(new Date(base + months * 30 * dayMs).toISOString(), 'CleanCo', 'gemini_pipeline', 70 - i * 5);
  }

  // ImportCo : une seule grosse entrée d'import (cohort historique)
  insert.run(new Date('2025-03-01T00:00:00Z').toISOString(), 'ImportCo', 'import', 55);

  // BackfillCo : entrées insérées dans le désordre chronologique
  insert.run(new Date('2023-01-01T00:00:00Z').toISOString(), 'BackfillCo', 'manual', 65); // id le + bas, timestamp le + ancien : OK
  insert.run(new Date('2024-11-01T00:00:00Z').toISOString(), 'BackfillCo', 'manual', 30); // OK jusque là
  insert.run(new Date('2024-03-01T00:00:00Z').toISOString(), 'BackfillCo', 'manual', 48); // inséré APRÈS mais daté AVANT -> inversion

  return db;
}

// ---- Point d'entrée ----
const arg = process.argv[2];
if (arg === '--demo') {
  console.log('*** MODE DÉMONSTRATION — données synthétiques, pas vos données réelles ***\n');
  const db = buildDemoDb();
  const rows = db.prepare(
    'SELECT id, timestamp, startup_name, source_type, iro_total FROM audit_entries ORDER BY id'
  ).all() as Entry[];
  const result = audit(rows);
  writeCsv(result, 'audit_retrospective_findings_DEMO.csv');
} else if (arg) {
  const rows = loadEntries(arg);
  if (!rows.length) {
    console.log(`Aucune entrée trouvée dans ${arg}`);
    process.exit(1);
  }
  const result = audit(rows);
  writeCsv(result, 'audit_retrospective_findings.csv');
} else {
  console.log('Usage : npx tsx scripts/audit-retrospective.ts <chemin-vers-iro-journal.db>');
  console.log('        npx tsx scripts/audit-retrospective.ts --demo');
  process.exit(1);
}
