// Tests unitaires — Protocole Sources IRO v4.5
// Couvre : applyFlagPenalties, applyDimensionCaps, computeConfidenceRate, SOURCING_CAPS
// Calibré sur les 3 défaillances cohorte IRO-2026-Q2 (Quadratic, HIoTee, Bonjour Henry)

import { describe, it, expect } from 'vitest';
import {
  applyFlagPenalties,
  applyDimensionCaps,
  computeConfidenceRate,
  SOURCING_CAPS,
  SOURCING_REQUIRED,
  INVESTIGATION_SEQUENCE,
  type SourceEntry,
} from '../src/types/iro-flags-v45';

// ── applyDimensionCaps ────────────────────────────────────────────────────────
describe('applyDimensionCaps — plafonnement dimensionnel v4.5', () => {
  it('brevet_non_verifie : DI > 3 → plafonné à 3', () => {
    const capped = applyDimensionCaps(
      { DI:4, ADC:3, IPC:3, AR:2, CA:2, GCH:2, LU:2 },
      { brevet_non_verifie: true }
    );
    expect(capped.DI).toBe(3);
  });

  it('dirigeant_anonyme : GCH > 2 → plafonné à 2 (cas HIoTee)', () => {
    const capped = applyDimensionCaps(
      { DI:2, ADC:2, IPC:2, AR:2, CA:2, GCH:3, LU:1 },
      { dirigeant_anonyme: true }
    );
    expect(capped.GCH).toBe(2);
  });

  it('operateur_certifie : IPC > 2 → plafonné à 2', () => {
    const capped = applyDimensionCaps(
      { DI:2, ADC:2, IPC:4, AR:2, CA:2, GCH:2, LU:2 },
      { operateur_certifie: true }
    );
    expect(capped.IPC).toBe(2);
  });

  it('lu_data_gap : LU > 3 → plafonné à 3', () => {
    const capped = applyDimensionCaps(
      { DI:2, ADC:1, IPC:2, AR:2, CA:2, GCH:2, LU:4 },
      { lu_data_gap: true }
    );
    expect(capped.LU).toBe(3);
  });

  it('sans flag : aucun plafonnement', () => {
    const scores = { DI:4, ADC:4, IPC:4, AR:4, CA:4, GCH:4, LU:4 };
    const capped = applyDimensionCaps(scores, {});
    expect(capped).toEqual(scores);
  });

  it('flags cumulables : brevet + dirigeant', () => {
    const capped = applyDimensionCaps(
      { DI:4, ADC:3, IPC:3, AR:2, CA:2, GCH:4, LU:2 },
      { brevet_non_verifie: true, dirigeant_anonyme: true }
    );
    expect(capped.DI).toBe(3);
    expect(capped.GCH).toBe(2);
    expect(capped.ADC).toBe(3);   // non plafonné
  });
});

// ── applyFlagPenalties ────────────────────────────────────────────────────────
describe('applyFlagPenalties — malus IRO flags v4.5', () => {
  const baseScores = { DI:2, ADC:2, IPC:2, AR:2, CA:2, GCH:2, LU:2 };

  it('liquidation_judiciaire → −10 pts (cas Bonjour Henry)', () => {
    const { score, penalties } = applyFlagPenalties(60, { liquidation_judiciaire: true }, baseScores);
    expect(score).toBeCloseTo(50, 0);
    expect(penalties.some(p => p.includes('liquidation'))).toBe(true);
  });

  it('redressement_judiciaire → −5 pts', () => {
    const { score } = applyFlagPenalties(60, { redressement_judiciaire: true }, baseScores);
    expect(score).toBeCloseTo(55, 0);
  });

  it('score jamais négatif même avec cumul de malus', () => {
    const { score } = applyFlagPenalties(8, {
      liquidation_judiciaire: true,
      redressement_judiciaire: true,
      data_stale: true,
      contrat_retire: true,
    }, baseScores);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('sans flag : score inchangé', () => {
    const { score, penalties } = applyFlagPenalties(72.5, {}, baseScores);
    expect(score).toBeCloseTo(72.5, 1);
    expect(penalties).toHaveLength(0);
  });

  it('contrat_retire → malus IPC (cas Quadratic AFD)', () => {
    const { score, penalties } = applyFlagPenalties(65, { contrat_retire: true }, baseScores);
    expect(score).toBeLessThan(65);
    expect(penalties.some(p => p.includes('contrat'))).toBe(true);
  });
});

// ── computeConfidenceRate ─────────────────────────────────────────────────────
describe('computeConfidenceRate — taux de confiance global v4.5', () => {
  const makeSource = (trust_code: SourceEntry['trust_code']): SourceEntry => ({
    dim: 'DI', source: 'test', trust_code, freshness: 'F', assertion: 'test'
  });

  it('100% V → high, publishable', () => {
    const sources: SourceEntry[] = Array(10).fill(null).map(() => makeSource('V'));
    const rate = computeConfidenceRate(sources);
    expect(rate.rate).toBe(100);
    expect(rate.label).toBe('high');
    expect(rate.publishable).toBe(true);
  });

  it('62% V (cas Quadratic estimé) → low, publishable=false', () => {
    const sources: SourceEntry[] = [
      ...Array(62).fill(null).map(() => makeSource('V')),
      ...Array(28).fill(null).map(() => makeSource('I')),
      ...Array(10).fill(null).map(() => makeSource('NT')),
    ];
    const rate = computeConfidenceRate(sources);
    expect(rate.label).toBe('low');
    expect(rate.publishable).toBe(false);
  });

  it('55% V (cas HIoTee initial) → low, publishable=false', () => {
    const sources: SourceEntry[] = [
      ...Array(55).fill(null).map(() => makeSource('V')),
      ...Array(25).fill(null).map(() => makeSource('I')),
      ...Array(20).fill(null).map(() => makeSource('NT')),
    ];
    const rate = computeConfidenceRate(sources);
    expect(rate.publishable).toBe(false);
    expect(rate.rate).toBe(55);
  });

  it('85% V → high, publishable', () => {
    const sources: SourceEntry[] = [
      ...Array(85).fill(null).map(() => makeSource('V')),
      ...Array(10).fill(null).map(() => makeSource('I')),
      ...Array(5).fill(null).map(() => makeSource('NT')),
    ];
    const rate = computeConfidenceRate(sources);
    expect(rate.label).toBe('high');
    expect(rate.publishable).toBe(true);
  });

  it('C compte comme V pour le taux', () => {
    const sources: SourceEntry[] = [
      ...Array(80).fill(null).map(() => makeSource('V')),
      ...Array(10).fill(null).map(() => makeSource('C')),
      ...Array(10).fill(null).map(() => makeSource('I')),
    ];
    const rate = computeConfidenceRate(sources);
    expect(rate.rate).toBe(90);
    expect(rate.label).toBe('high');
  });

  it('0 source → rate 0, critical', () => {
    const rate = computeConfidenceRate([]);
    expect(rate.rate).toBe(0);
    expect(rate.label).toBe('critical');
  });
});

// ── SOURCING_CAPS ─────────────────────────────────────────────────────────────
describe('SOURCING_CAPS — plafonds si sources ★ manquantes', () => {
  it('DI plafonné à 3 sans INPI/site officiel', () => {
    expect(SOURCING_CAPS.DI).toBe(3);
  });
  it('ADC plafonné à 2 sans bilan daté', () => {
    expect(SOURCING_CAPS.ADC).toBe(2);
  });
  it('GCH plafonné à 2 si dirigeant anonyme', () => {
    expect(SOURCING_CAPS.GCH).toBe(2);
  });
  it('IPC plafonné à 3 sans marchés publics vérifiés', () => {
    expect(SOURCING_CAPS.IPC).toBe(3);
  });
});

// ── INVESTIGATION_SEQUENCE ────────────────────────────────────────────────────
describe('INVESTIGATION_SEQUENCE — 9 étapes obligatoires', () => {
  it('9 étapes définies', () => {
    expect(INVESTIGATION_SEQUENCE).toHaveLength(9);
  });
  it('Étape 2 est BLOQUANTE (BODACC)', () => {
    const step2 = INVESTIGATION_SEQUENCE.find(s => s.step === 2);
    expect(step2?.output).toContain('BLOQUANT');
    expect(step2?.sources).toContain('BODACC (36 mois)');
  });
  it('Étape 9 est le scoring IRO', () => {
    const step9 = INVESTIGATION_SEQUENCE.find(s => s.step === 9);
    expect(step9?.name).toContain('Scoring');
  });
});
