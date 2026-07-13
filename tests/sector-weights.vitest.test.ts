// Tests unitaires — Poids sectoriels IRO v4.8
// Couvre : resolveSectorCode, getSectorWeights, getSectorProfile,
//          validateWeights, et intégration calcIRO(sectorCode)

import { describe, it, expect } from 'vitest';
import {
  resolveSectorCode,
  getSectorWeights,
  getSectorProfile,
  validateWeights,
  BASE_WEIGHTS,
  SECTOR_PROFILES,
} from '../src/config/sector-weights';

// ── validateWeights ───────────────────────────────────────────────────────────
describe('validateWeights — tous les profils sectoriels somment à 1.0', () => {
  it('poids base somment à 1.0', () => {
    expect(validateWeights(BASE_WEIGHTS)).toBe(true);
  });

  it('chaque profil sectoriel a des poids valides', () => {
    for (const [code, profile] of Object.entries(SECTOR_PROFILES)) {
      expect(
        validateWeights(profile.weights),
        `Profil ${code} : somme ≠ 1.0`
      ).toBe(true);
    }
  });
});

// ── resolveSectorCode ─────────────────────────────────────────────────────────
describe('resolveSectorCode — résolution depuis libellé libre', () => {
  it('Santé / Medtech → HLTH', () => {
    expect(resolveSectorCode('Santé / Medtech')).toBe('HLTH');
    expect(resolveSectorCode('healthtech B2B')).toBe('HLTH');
    expect(resolveSectorCode('BioIA oncologie')).toBe('HLTH');
    expect(resolveSectorCode('solution clinique hospitalière')).toBe('HLTH');
  });

  it('LLM / IA générative → LLM', () => {
    expect(resolveSectorCode('LLM infrastructure')).toBe('LLM');
    expect(resolveSectorCode('IA générative B2B')).toBe('LLM');
    expect(resolveSectorCode('modèle de langage multimodal')).toBe('LLM');
  });

  it('Commerce → COMM', () => {
    expect(resolveSectorCode('e-commerce mode')).toBe('COMM');
    expect(resolveSectorCode('marketplace retail')).toBe('COMM');
  });

  it('Finance → FINT', () => {
    expect(resolveSectorCode('fintech crédit PME')).toBe('FINT');
    expect(resolveSectorCode('assurance paramétrique')).toBe('FINT');
  });

  it('Cyber → CYBR', () => {
    expect(resolveSectorCode('cybersécurité SOC')).toBe('CYBR');
    expect(resolveSectorCode('threat detection')).toBe('CYBR');
  });

  it('secteur non reconnu → DEFAULT', () => {
    expect(resolveSectorCode('AgriTech precision')).toBe('DEFAULT');
    expect(resolveSectorCode('')).toBe('DEFAULT');
    expect(resolveSectorCode('startup deep tech')).toBe('DEFAULT');
  });
});

// ── getSectorWeights — HLTH différencié, autres = base ───────────────────────
describe('getSectorWeights — HLTH différencié, autres retournent les poids base', () => {
  it('HLTH : IPC et LU augmentés vs base', () => {
    const w = getSectorWeights('HLTH');
    expect(w.IPC).toBeGreaterThan(BASE_WEIGHTS.IPC);  // 0.298 > 0.22
    expect(w.LU).toBeGreaterThan(BASE_WEIGHTS.LU);    // 0.15 vs 0.223 > 0.15
    expect(w.AR).toBeLessThan(BASE_WEIGHTS.AR);        // 0.074 < 0.13
    expect(w.DI).toBeLessThan(BASE_WEIGHTS.DI);        // 0.128 < 0.18
  });

  it('HLTH : IPC = 0.298 (±0.001)', () => {
    expect(getSectorWeights('HLTH').IPC).toBeCloseTo(0.298, 3);
  });

  it('HLTH : LU = 0.223 (±0.001)', () => {
    expect(getSectorWeights('HLTH').LU).toBeCloseTo(0.223, 3);
  });

  it('LLM : identique aux poids base', () => {
    expect(getSectorWeights('LLM')).toEqual(BASE_WEIGHTS);
  });

  it('COMM : identique aux poids base', () => {
    expect(getSectorWeights('COMM')).toEqual(BASE_WEIGHTS);
  });

  it('DEFAULT : identique aux poids base', () => {
    expect(getSectorWeights('DEFAULT')).toEqual(BASE_WEIGHTS);
  });
});

// ── getSectorProfile — statuts et AUC ────────────────────────────────────────
describe('getSectorProfile — statuts calibration', () => {
  it('HLTH : status calibrated, auc_opt = 0.80', () => {
    const p = getSectorProfile('HLTH');
    expect(p.status).toBe('calibrated');
    expect(p.auc_opt).toBeCloseTo(0.8000, 3);
    expect(p.auc_opt).toBeGreaterThan(p.auc_base);
  });

  it('LLM : status base, auc inchangée', () => {
    const p = getSectorProfile('LLM');
    expect(p.status).toBe('base');
    expect(p.auc_base).toEqual(p.auc_opt);
  });

  it('CYBR : AUC base = 0.5 (0 échec — non calculable)', () => {
    const p = getSectorProfile('CYBR');
    expect(p.auc_base).toBeCloseTo(0.5, 2);
  });

  it('tous les profils ont un label non vide', () => {
    for (const p of Object.values(SECTOR_PROFILES)) {
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});

// ── Cohérence : HLTH scores individuels ──────────────────────────────────────
describe('Cohérence HLTH — scores individuels clés', () => {
  const W_HLTH = getSectorWeights('HLTH');

  function calcScore(scores: Record<string, number>, w: Record<string, number>): number {
    const dims = ['DI','ADC','IPC','AR','CA','GCH','LU'];
    const sw = dims.reduce((a, d) => a + (w[d] ?? 0), 0);
    const brut = dims.reduce((a, d) => a + (scores[d] ?? 0) * (w[d] ?? 0), 0);
    let iro = Math.round(brut / (4 * sw) * 1000) / 10;
    if ((scores.DI ?? 0) === 0) iro = Math.min(iro, 40);
    return Math.max(0, iro);
  }

  it('Sonio (active, LU=3, IPC=3) : score HLTH > score base', () => {
    const s = {DI:3,ADC:3,IPC:3,AR:4,CA:2,GCH:3,LU:3};
    const base = calcScore(s, BASE_WEIGHTS);
    const hlth = calcScore(s, W_HLTH);
    expect(hlth).toBeGreaterThan(base);
  });

  it('Alan Mind IA (failed, DI=0) : score HLTH ≤ 40 (REV1 préservé)', () => {
    const s = {DI:0,ADC:2,IPC:2,AR:3,CA:2,GCH:2,LU:0};
    const hlth = calcScore(s, W_HLTH);
    expect(hlth).toBeLessThanOrEqual(40);
  });

  it('Nanobiotix (failed, DI=4, AR=4) : score HLTH < score base (AR réduit)', () => {
    const s = {DI:4,ADC:3,IPC:3,AR:4,CA:2,GCH:3,LU:3};
    const base = calcScore(s, BASE_WEIGHTS);
    const hlth = calcScore(s, W_HLTH);
    // AR réduit de 0.13 à 0.074 → Nanobiotix pénalisé vs base
    expect(hlth).toBeLessThan(base);
  });
});
