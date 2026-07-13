import { describe, it, expect } from 'vitest';
import { 
  computeLURiskScore, 
  compareWithCoxModel, 
  LU_MODEL_METADATA 
} from '../src/utils/lu-threshold-model';

describe('LU Threshold Model - Core Engine & Risk Classification', () => {
  it('should export stable metadata matching the 2026-07-10 calibration', () => {
    expect(LU_MODEL_METADATA.beta_lu_ge_2).toBe(-4.5109);
    expect(LU_MODEL_METADATA.epv).toBe(13);
    expect(LU_MODEL_METADATA.n_total).toBe(87);
    expect(LU_MODEL_METADATA.n_events).toBe(13);
  });

  describe('computeLURiskScore', () => {
    it('should handle undefined, null, or NaN gracefully', () => {
      const resUndef = computeLURiskScore(undefined);
      expect(resUndef.risk_level).toBe('INDÉTERMINÉ');
      expect(resUndef.seuil_franchi).toBe(false);
      expect(resUndef.linear_predictor).toBeNaN();

      const resNull = computeLURiskScore(null);
      expect(resNull.risk_level).toBe('INDÉTERMINÉ');

      const resNaN = computeLURiskScore(NaN);
      expect(resNaN.risk_level).toBe('INDÉTERMINÉ');
    });

    it('should classify LU < 2 as ÉLEVÉ risk with linear predictor = 0', () => {
      const res0 = computeLURiskScore(0);
      expect(res0.risk_level).toBe('ÉLEVÉ');
      expect(res0.seuil_franchi).toBe(false);
      expect(res0.linear_predictor).toBe(0);

      const res1 = computeLURiskScore(1);
      expect(res1.risk_level).toBe('ÉLEVÉ');
      expect(res1.seuil_franchi).toBe(false);
      expect(res1.linear_predictor).toBe(0);
    });

    it('should classify LU >= 2 as FAIBLE risk with linear predictor = beta_lu_ge_2', () => {
      const res2 = computeLURiskScore(2);
      expect(res2.risk_level).toBe('FAIBLE');
      expect(res2.seuil_franchi).toBe(true);
      expect(res2.linear_predictor).toBe(LU_MODEL_METADATA.beta_lu_ge_2);

      const res4 = computeLURiskScore(4);
      expect(res4.risk_level).toBe('FAIBLE');
      expect(res4.seuil_franchi).toBe(true);
      expect(res4.linear_predictor).toBe(LU_MODEL_METADATA.beta_lu_ge_2);
    });
  });

  describe('compareWithCoxModel', () => {
    it('should handle missing/indeterminate LU score', () => {
      const comparison = compareWithCoxModel('TestStartup', null, true);
      expect(comparison.agreement).toBe(true);
      expect(comparison.recommandation).toContain('Score LU manquant');
    });

    it('should report agreement when both models identify low risk', () => {
      // LU = 3 (FAIBLE risk), Cox high risk = false (FAIBLE risk)
      const comparison = compareWithCoxModel('CleanCo', 3, false);
      expect(comparison.agreement).toBe(true);
      expect(comparison.recommandation).toContain('Les deux modèles concordent');
    });

    it('should report agreement when both models identify high risk', () => {
      // LU = 1 (ÉLEVÉ risk), Cox high risk = true (ÉLEVÉ risk)
      const comparison = compareWithCoxModel('RiskyCo', 1, true);
      expect(comparison.agreement).toBe(true);
      expect(comparison.recommandation).toContain('Les deux modèles concordent');
    });

    it('should report disagreement when LU is low risk (>=2) but Cox is high risk', () => {
      // LU = 2 (FAIBLE risk), Cox high risk = true
      const comparison = compareWithCoxModel('DisagreeCo1', 2, true);
      expect(comparison.agreement).toBe(false);
      expect(comparison.recommandation).toContain('DÉSACCORD');
    });

    it('should report disagreement when LU is high risk (<2) but Cox is low risk', () => {
      // LU = 0 (ÉLEVÉ risk), Cox high risk = false
      const comparison = compareWithCoxModel('DisagreeCo2', 0, false);
      expect(comparison.agreement).toBe(false);
      expect(comparison.recommandation).toContain('DÉSACCORD');
    });
  });
});
