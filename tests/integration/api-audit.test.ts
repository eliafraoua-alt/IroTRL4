import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, stopTestServer, baseUrl }       from './setup';

import Database from 'better-sqlite3';
import path from 'path';

beforeAll(async () => {
  await startTestServer();
  try {
    const dbPath = path.join(process.cwd(), 'data', 'iro-journal.db');
    const db = new Database(dbPath);
    db.prepare("DELETE FROM audit_entries").run();
  } catch (err) {
    // ignore if table doesn't exist yet
  }
});

afterAll(stopTestServer);

describe('API Audit Journal — intégration', () => {
  const testEntry = {
    startup_name: 'AuditTestInc',
    iro_total: 75.5,
    iro_cr: 12.0,
    srd: 0.85,
    DI: 3,
    ADC: 3,
    IPC: 2,
    AR: 3,
    CA: 2,
    GCH: 3,
    ipc_conf: 0.9,
    adc_conf: 0.8,
    gch_conf: 0.85,
    trl: 4,
    evaluator: 'evaluator-integration-test',
    model_version: 'IRO v7.0.0-test',
    source_type: 'gemini_pipeline',
    goodhart_patterns: '[]',
    notes: 'Test d\'intégration',
    status: 'active'
  };

  it('ajoute une entrée avec succès via POST /api/audit', async () => {
    const res = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testEntry),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; id: number };
    expect(body.success).toBe(true);
    expect(body.id).toBeGreaterThan(0);
  });

  it('retourne les entrées filtrées via GET /api/audit', async () => {
    const res = await fetch(`${baseUrl}/api/audit?startup=AuditTestInc`);
    expect(res.status).toBe(200);
    const entries = await res.json() as any[];
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].startup_name).toBe('AuditTestInc');
  });

  it('lit les statistiques d\'audit via GET /api/audit/stats', async () => {
    const res = await fetch(`${baseUrl}/api/audit/stats`);
    expect(res.status).toBe(200);
    const stats = await res.json() as { total_entries: number; n_actives: number };
    expect(stats.total_entries).toBeGreaterThanOrEqual(1);
    expect(stats.n_actives).toBeGreaterThanOrEqual(1);
  });

  it('exporte le journal en CSV via GET /api/audit/csv', async () => {
    const res = await fetch(`${baseUrl}/api/audit/csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain('startup_name');
    expect(csv).toContain('AuditTestInc');
  });

  it('vérifie l\'intégrité cryptographique du journal via GET /api/audit/verify', async () => {
    const res = await fetch(`${baseUrl}/api/audit/verify`);
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; n_entries: number; summary: string };
    expect(body).toHaveProperty('valid');
    expect(body.valid).toBe(true);
    expect(body).toHaveProperty('summary');
    expect(body.summary).toContain('Journal intègre');
  });
});
