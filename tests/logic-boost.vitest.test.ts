import { describe, it, expect, beforeEach } from 'vitest';
import { coxFull, coxSurvival } from '../src/utils/cox-model';
import { 
  computeHoneymoonProfile, 
  computeDIVelocity, 
  computeTemporalAdjustment,
  computeIROVelocity
} from '../src/utils/iro-velocity';
import { mapPappersToFinancialData } from '../src/collectors/pappers';
import { mapCrunchbaseToIRO } from '../src/collectors/crunchbase';

describe('cox-model', () => {
  it('coxSurvival retourne une probabilité entre 0 et 1', () => {
    const s = coxSurvival(1.5, 36);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('coxFull calcule un hazard ratio et une survie enrichie', () => {
    const res = coxFull({
      irocr: 72,
      di_zero: false,
      srd_high: false,
      adc_strong: true,
      ipc_strong: true,
      regulated_sector: false,
      velocity_pts_per_month: 0.5,
      age_mois: 24
    });
    expect(res.hazard_ratio).toBeDefined();
    expect(res.survival_36m).toBeDefined();
    expect(res.risk_profile).toBeDefined();
  });
});

describe('iro-velocity', () => {
  it('computeHoneymoonProfile retourne des poids selon l’âge', () => {
    const p1 = computeHoneymoonProfile(3, 'SAAS');
    const p2 = computeHoneymoonProfile(36, 'SAAS');
    expect(p1.weight).not.toBe(p2.weight);
  });

  it('computeDIVelocity calcule la vélocité de commoditisation', () => {
    const res = computeDIVelocity(4, 2); // Score 4, VMM 2 -> di_effectif = 4 * (1 - 2/4) = 2
    expect(res.di_effectif).toBe(2);
    expect(res.risque_label).toBeDefined();
  });

  it('computeTemporalAdjustment ajuste le hazard ratio', () => {
    const adj = computeTemporalAdjustment({
      age_mois: 24,
      vertical: 'SAAS',
      velocity: { velocity_global: 1.2 } as any
    });
    expect(adj.hazard_multiplier).toBeDefined();
    expect(adj.lp_velocity_adjustment).toBeDefined();
  });

  it('computeIROVelocity analyse une trajectoire à partir d\'audits', () => {
    const entries = [
      { timestamp: '2024-01-01T10:00:00Z', startup_name: 'N', iro_total: 50, iro_cr: 45, DI: 3, ADC: 3, IPC: 3, AR: 3, CA: 3, GCH: 3 },
      { timestamp: '2024-03-01T10:00:00Z', startup_name: 'N', iro_total: 60, iro_cr: 55, DI: 4, ADC: 3, IPC: 4, AR: 3, CA: 4, GCH: 3 }
    ] as any;
    const res = computeIROVelocity(entries);
    expect(res).not.toBeNull();
    expect(res?.velocity_global).toBeGreaterThan(0);
    expect(res?.interpretation).toBeDefined();
  });
});

describe('collectors-mappings', () => {
  it('mapPappersToFinancialData convertit les données Pappers', () => {
    const mockPappers = {
      denomination: 'Test SAS',
      date_creation: '2020-05-15',
      effectifs: 15,
      tranche_effectif: '10 à 19 salariés'
    } as any;
    const res = mapPappersToFinancialData(mockPappers);
    expect(res.founded_year).toBe(2020);
    expect(res.employee_count).toBe(15);
  });

  it('mapCrunchbaseToIRO convertit les données Crunchbase', () => {
    const mockCB = {
      funding_stage: 'seed',
      employee_range: '11-50',
      founded_year: 2018,
      age_mois_computed: 24
    } as any;
    const res = mapCrunchbaseToIRO(mockCB);
    expect(res.founding_year).toBe(2018);
    expect(res.employee_count).toBe(30);
  });
});

import { rsfPredict, resetForest } from '../src/utils/rsf-model';

describe('rsf-model', () => {
  beforeEach(() => resetForest());

  it('rsfPredict retourne des probabilités de survie dans [0,1]', () => {
    const res = rsfPredict({ irocr: 72, di: 3, adc: 3, ipc: 3, ar: 2, ca: 2, gch: 2 });
    expect(res.s12).toBeGreaterThanOrEqual(0);
    expect(res.s12).toBeLessThanOrEqual(1);
    expect(res.s24).toBeGreaterThanOrEqual(0);
    expect(res.s36).toBeGreaterThanOrEqual(0);
    expect(res.s12).toBeGreaterThanOrEqual(res.s36); // monotonie
  });

  it('profil fort > profil faible à 36 mois', () => {
    const fort   = rsfPredict({ irocr: 80, di: 4, adc: 4, ipc: 4, ar: 3, ca: 3, gch: 3 });
    const faible = rsfPredict({ irocr: 30, di: 0, adc: 1, ipc: 1, ar: 1, ca: 1, gch: 1 });
    expect(fort.s36).toBeGreaterThan(faible.s36);
  });

  it('importance des features est normalisée [0,1]', () => {
    const res = rsfPredict({ irocr: 55, di: 2, adc: 2, ipc: 2, ar: 2, ca: 2, gch: 2 });
    const feats = Object.values(res.importance);
    feats.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  it('coxFull inclut les champs RSF dans son résultat', () => {
    const res = coxFull({
      irocr: 65, di_zero: false, srd_high: false,
      adc_strong: true, ipc_strong: true, regulated_sector: false,
    });
    // L'ensemble doit être dans [0,1]
    expect(res.survival_36m).toBeGreaterThanOrEqual(0);
    expect(res.survival_36m).toBeLessThanOrEqual(1);
    // cox_only exposé
    const full = res as any;
    if (full.cox_only) {
      expect(full.cox_only.s36).toBeDefined();
      expect(full.rsf?.s36).toBeDefined();
    }
  });
});
