import { describe, it, expect, vi } from 'vitest';
import { callLLMWithFallback } from '../src/services/aiService';

// Mock simple pour le router LLM utilisé par aiService
vi.mock('../src/utils/llm-router', () => ({
  callLLMWithRouter: vi.fn(() => Promise.resolve({ 
    response: '{"status": "ok"}',
    providerUsed: 'Gemini'
  })),
}));

// Mock simple pour le logger
vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock pour better-sqlite3 (utilisé par audit-journal)
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(() => ({
      prepare: vi.fn(() => ({
        run: vi.fn(() => ({ lastInsertRowid: 123 })),
        all: vi.fn(() => []),
        get: vi.fn(() => ({ count: 0 })),
      })),
      exec: vi.fn(),
    })),
  };
});

describe('aiService-coverage', () => {
  it('callLLMWithFallback délègue au router', async () => {
    const res = await callLLMWithFallback('gemini-3.5-flash', 'Hello');
    expect(res.text).toBeDefined();
    expect(res.provider).toBe('gemini');
  });
});

describe('stress-test-coverage', () => {
  it('peut lancer un stress test complet', async () => {
    const { runFullStressTest, TECH_SHOCKS } = await import('../src/utils/stress-test');
    expect(TECH_SHOCKS.length).toBeGreaterThan(0);
    const res = runFullStressTest({ DI: 2, ADC: 3, IPC: 2, AR: 2, CA: 2, GCH: 3 }, 65);
    expect(res.results.length).toBe(TECH_SHOCKS.length);
  });
});

describe('audit-journal-coverage', () => {
  it('peut ajouter et lire des entrées (mock sqlite)', async () => {
    const { addEntry, getEntries, getStats } = await import('../src/utils/audit-journal');
    const entry = {
      timestamp: new Date().toISOString(),
      startup_name: 'Nabla', iro_total: 65, iro_cr: 60,
      srd: 20, DI: 4, ADC: 3, IPC: 4, AR: 3, CA: 4, GCH: 3,
      ipc_conf: 4, adc_conf: 4, gch_conf: 4, trl: 3,
      evaluator: 'E1', model_version: 'V6', source_type: 'manual',
      goodhart_patterns: '[]', notes: 'Test', status: 'active'
    } as any;
    const id = addEntry(entry);
    expect(id).toBe(123);
    const entries = getEntries();
    expect(Array.isArray(entries)).toBe(true);
    expect(getStats()).toBeDefined();
  });
});

describe('scenario-simulator-coverage', () => {
  it('peut lancer une simulation complète', async () => {
    const { simulateAll } = await import('../src/utils/scenario-simulator');
    const res = simulateAll({
      DI: 4, ADC: 3, IPC: 4, AR: 3, CA: 2, GCH: 3
    }, 20);
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].scenario).toBeDefined();
  });
});

describe('calibrate-beta-coverage', () => {
  it('peut effectuer une calibration simplifiée', async () => {
    const { calibrateBetaVelocity } = await import('../src/utils/calibrate-beta');
    const dataset = [
      { startup_name: 'S1', status: 'active', velocity_global: 1.2, irocr_last: 60, age_mois: 24 },
      { startup_name: 'S2', status: 'failed', velocity_global: -0.5, irocr_last: 30, age_mois: 18 }
    ] as any;
    const res = calibrateBetaVelocity(dataset);
    expect(res.beta_velocity).toBeDefined();
  });
});

describe('goodhart-detector-coverage', () => {
  it('détecte des patterns anormaux', async () => {
    const { detectGoodharting } = await import('../src/utils/goodhart-detector');
    const alerts = detectGoodharting({ DI: 4, ADC: 1, IPC: 4, AR: 4, CA: 4, GCH: 4 });
    expect(alerts.patterns).toBeDefined();
  });
});

describe('benchmark-service-coverage', () => {
  it('calcule des benchmarks mondiaux et france', async () => {
    const { getBenchmarkPosition } = await import('../src/utils/benchmark-service');
    const res = getBenchmarkPosition(65, 60);
    expect(res.centile_france).toBeDefined();
  });
});
