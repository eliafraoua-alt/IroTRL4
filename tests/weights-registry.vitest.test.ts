// tests/weights-registry.vitest.test.ts
import { describe, it, expect } from 'vitest';
import { IRO_WEIGHTS, SRD_WEIGHTS, WEIGHTS_VERSION } from '../src/utils/weights-registry';
import rawConfig from '../src/config/iro-weights-v4.5-protocol-sources.json';

describe('Weights Registry — source unique de vérité', () => {
  it('somme des poids IRO = 1.12 (à ±0.001)', () => {
    const sum = Object.values(IRO_WEIGHTS).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.12, 2);
  });

  it('somme des poids SRD = 1.00 (à ±0.001)', () => {
    const sum = Object.values(SRD_WEIGHTS).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('valeurs identiques au fichier JSON source', () => {
    expect(IRO_WEIGHTS).toEqual(rawConfig.weights);
    expect(SRD_WEIGHTS).toEqual(rawConfig.srd_weights);
  });

  it('version ≥ 4.3', () => {
    const ver = parseFloat(WEIGHTS_VERSION);
    expect(ver).toBeGreaterThanOrEqual(4.3);
  });
});
