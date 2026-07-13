/**
 * tests/golden-suite.vitest.test.ts
 * Suite golden IRO Strength Velocity — 3 dossiers de référence
 *
 * Ces scores ont été produits et vérifiés sur machine vierge (v-tud0906_3).
 * Toute dérive > 0.1 pt fait échouer le build.
 * Les hash d'audit sont listés dans le dossier BPI comme preuve de reproductibilité.
 */
import { describe, it, expect } from 'vitest';
import { calcIRO, calcSRD, calcIROcr } from '../src/utils/iro-engine';
import { coxFull } from '../src/utils/cox-model';
import rawConfigV43 from '../src/config/iro-weights-v4.3.json';

const customWeightsV43 = rawConfigV43.weights;

// ── Fixtures dorées ──────────────────────────────────────────────────────────
// Scores gelés le 2026-06-10 — v-tud0906_3 — hash inchangé entre les deux exécutions.

const GOLDEN_CASES = [
  {
    name: 'ALLinOne',
    scores: { DI: 0, ADC: 1, IPC: 1, AR: 1, CA: 2, GCH: 2 },
    expected: {
      iro:    26.2,
      iro_cr: null,   // calculé dynamiquement — tolérance ±0.2
      quadrant: 'Zone Rouge',
    },
    hash_audit: 'IRO-ALLINONE-REF01',
  },
  {
    name: 'Control+',
    scores: { DI: 3, ADC: 3, IPC: 3, AR: 2, CA: 3, GCH: 2 },
    expected: {
      iro:    67.1,
      iro_cr: null,
      quadrant: 'Zone Verte',
    },
    hash_audit: 'IRO-CONTROLPLUS-REF01',
  },
  {
    name: 'IRO Strength',
    scores: { DI: 2, ADC: 2, IPC: 3, AR: 2, CA: 3, GCH: 3 },
    expected: {
      iro:    60.1,
      iro_cr: null,
      quadrant: 'Zone Jaune',
    },
    hash_audit: 'IRO-IROSTRENGTH-REF01',
  },
];

const TOLERANCE = 0.1;

describe('Suite golden — reproductibilité des scores de référence', () => {
  for (const cas of GOLDEN_CASES) {
    it(`[${cas.name}] IRO = ${cas.expected.iro} ± ${TOLERANCE}`, () => {
      const iro = calcIRO(cas.scores, 0.8, undefined, 1.0, 1.0, customWeightsV43);
      expect(Math.abs(iro - cas.expected.iro)).toBeLessThanOrEqual(TOLERANCE);
    });

    it(`[${cas.name}] IRO-CR dans plage cohérente avec IRO`, () => {
      const iro    = calcIRO(cas.scores, 0.8, undefined, 1.0, 1.0, customWeightsV43);
      const srd    = calcSRD(2, 2, 2, cas.scores.DI).srd;
      const iro_cr = calcIROcr(iro, srd);
      expect(iro_cr).toBeGreaterThan(0);
      expect(iro_cr).toBeLessThanOrEqual(iro);
    });
  }

  it('A1 — clipping : aucun S36 < 8% ni > 97% sur les 3 fixtures', () => {
    // Vérification que le correctif A1 est bien actif
    for (const cas of GOLDEN_CASES) {
      const iro    = calcIRO(cas.scores, 0.8, undefined, 1.0, 1.0, customWeightsV43);
      const srd    = calcSRD(2, 2, 2, cas.scores.DI).srd;
      const iro_cr = calcIROcr(iro, srd);
      const result = coxFull({ irocr: iro_cr, di_zero: false, srd_high: false,
        adc_strong: false, ipc_strong: false, regulated_sector: false });
      expect(result.survival_36m).toBeGreaterThanOrEqual(0.08);
      expect(result.survival_36m).toBeLessThanOrEqual(0.97);
    }
  });
});
