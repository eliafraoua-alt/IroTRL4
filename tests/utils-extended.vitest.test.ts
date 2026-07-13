import { describe, it, expect, vi } from 'vitest';
import { extractJSON, repairJSON } from '../src/utils/json-utils';
import { analyzeVRIN } from '../src/utils/vrin-analyzer';
import { computeAHPWeights } from '../src/utils/ahp';
import { computeCompetingRisks } from '../src/utils/competing-risks';
import { generateReporting } from '../src/utils/iro-engine';
import { getPrometheusMetrics } from '../src/utils/llm-metrics';
import { logger } from '../src/utils/logger';

describe('json-utils', () => {
  it('repairJSON ferme les guillemets et accolades', () => {
    const raw = '{"key": "value';
    expect(repairJSON(raw)).toBe('{"key": "value"}');
  });

  it('extractJSON trouve du JSON dans un bloc markdown', () => {
    const text = 'Voici le résultat : \n```json\n{"status": "ok"}\n```';
    expect(extractJSON(text)).toEqual({ status: 'ok' });
  });

  it('extractJSON répare du JSON mal formé', () => {
    const text = '{"key": "unfinished business...';
    expect(extractJSON(text)).toEqual({ key: 'unfinished business...' });
  });
});

describe('vrin-analyzer', () => {
  it('produit un score VRIN global cohérent', () => {
    const scores = { DI: 4, ADC: 3, IPC: 2, AR: 1, CA: 3, GCH: 4 };
    const res = analyzeVRIN(scores);
    expect(res.global_vrin).toBeGreaterThan(0);
    expect(res.moat_score).toBeGreaterThan(0);
    expect(Array.isArray(res.vrin_dimensions)).toBe(true);
  });

  it('identifie les dimensions VRIN (score >= 3)', () => {
    const scores = { DI: 4, ADC: 1, IPC: 1, AR: 1, CA: 1, GCH: 1 };
    const res = analyzeVRIN(scores);
    expect(res.vrin_dimensions).toContain('DI');
    expect(res.vrin_dimensions).not.toContain('ADC');
  });
});

describe('ahp-logic', () => {
  it('computeAHPWeights dérive des poids cohérents', () => {
    const matrix = {
      dimensions: ['A', 'B'],
      comparisons: [
        [1, 3],
        [1/3, 1]
      ]
    };
    const res = computeAHPWeights(matrix);
    expect(res.weights.A).toBeGreaterThan(res.weights.B);
    expect(res.isConsistent).toBe(true);
  });
});

describe('competing-risks', () => {
  it('calcule des probabilités de sortie cumulées', () => {
    const input = {
      irocr: 75,
      di_zero: false,
      adc_strong: true,
      ipc_strong: false,
      ca_strong: false,
      age_mois: 24
    };
    const res = computeCompetingRisks(input);
    expect(res.p_actif_36m).toBeDefined();
    expect(res.most_likely).toBeDefined();
    expect(res.interpretation).toContain('%');
    expect(res.trl_note).toContain('DeepHit');
    expect(res.trl_note).toContain('Lee et al. AAAI 2018');
  });

  it('respecte la coherence ordinale (un plus haut score irocr diminue le risque de faillite)', () => {
    const weakInput = {
      irocr: 30,
      di_zero: true,
      adc_strong: false,
      ipc_strong: false,
      ca_strong: false,
      age_mois: 24
    };
    const strongInput = {
      irocr: 80,
      di_zero: false,
      adc_strong: true,
      ipc_strong: true,
      ca_strong: true,
      age_mois: 24
    };

    const weakRes = computeCompetingRisks(weakInput);
    const strongRes = computeCompetingRisks(strongInput);

    expect(strongRes.p_faillite_36m).toBeLessThan(weakRes.p_faillite_36m);
    expect(strongRes.p_actif_36m).toBeGreaterThan(weakRes.p_actif_36m);
  });
});

describe('iro-engine-reporting', () => {
  it('generateReporting logue les résultats du batch', () => {
    const spy = vi.spyOn(logger, 'info');
    generateReporting([
      { id: 'b1', name: 'S1', iro: 45, ref: 40, delta: 5, timestamp: new Date().toISOString() }
    ]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('generateReporting ignore les batchs vides', () => {
    const spy = vi.spyOn(logger, 'info');
    generateReporting([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('llm-metrics-prometheus', () => {
  it('getPrometheusMetrics retourne des lignes formatées', () => {
    const metrics = getPrometheusMetrics();
    expect(metrics).toContain('# IRO Strength LLM Metrics');
  });
});
