/**
 * Test de non-régression — parité inter-implémentations (T6, audit 10/07/2026).
 *
 * Contexte : le dépôt contenait trois implémentations indépendantes de la formule
 * de scoring IRO (iro-engine.ts, batch_iro.ts, batch_gemini_iro.py), qui ont divergé
 * silencieusement au fil des versions (cf. rapport d'audit du 10/07/2026, constats
 * T1/T2/T3). Ce test verrouille le comportement du moteur canonique (iro-engine.ts)
 * sur un jeu de vecteurs partagé avec le script Python (tests/fixtures/parity-vectors.json),
 * de sorte que toute divergence future soit détectée immédiatement en CI plutôt que
 * découverte des mois plus tard lors d'un audit externe.
 */
import { describe, it, expect } from 'vitest';
import { calcIRO, calcInteractionBonus } from '../src/utils/iro-engine';
import fixtures from './fixtures/parity-vectors.json';

function computeScore(scores: Record<string, number>, ipcConf: number, adcConf: number, gchConf: number): number {
  const brut = calcIRO(scores, ipcConf, undefined, adcConf, gchConf);
  const bonus = calcInteractionBonus(scores);
  return Math.max(0, Math.min(100, Math.round((brut + bonus.bonus_total) * 10) / 10));
}

describe('Parité inter-implémentations du scoring IRO', () => {
  const { ipcConf, adcConf, gchConf } = fixtures.confidence_defaults;

  for (const vector of fixtures.vectors) {
    it(`${vector.label} — attend ${vector.expected_iro}`, () => {
      const result = computeScore(vector.scores, ipcConf, adcConf, gchConf);
      expect(result).toBeCloseTo(vector.expected_iro, 1);
    });
  }
});
