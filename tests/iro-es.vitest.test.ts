// Tests unitaires — IRO-ES v1.0 (Module Early Stage)
// Couvre l'éligibilité, la répartition des poids, les règles REVs et les cas rétrospectifs connus.

import { describe, it, expect } from 'vitest';
import {
  isEarlyStage,
  calcIROES,
  applyIROESRevs,
  getIROESZone,
  IRO_ES_WEIGHTS,
  IRO_ES_GRILLES,
} from '../src/utils/iro-es';

describe('IRO-ES — Module Early Stage v1.0', () => {

  // ── Éligibilité (isEarlyStage) ──────────────────────────────────────────────
  describe('isEarlyStage — Critères d\'éligibilité', () => {
    it('1. Éligible si < 18 mois et < 5 clients (les deux)', () => {
      expect(isEarlyStage({ mois_operations: 12, nb_clients_payants: 2 })).toBe(true);
    });

    it('2. Éligible si < 18 mois mais >= 5 clients', () => {
      expect(isEarlyStage({ mois_operations: 10, nb_clients_payants: 8 })).toBe(true);
    });

    it('3. Éligible si >= 18 mois mais < 5 clients', () => {
      expect(isEarlyStage({ mois_operations: 24, nb_clients_payants: 3 })).toBe(true);
    });

    it('4. Non éligible si >= 18 mois et >= 5 clients (revenir à IRO v4.8)', () => {
      expect(isEarlyStage({ mois_operations: 24, nb_clients_payants: 10 })).toBe(false);
    });

    it('5. Éligible à la limite stricte de 17 mois', () => {
      expect(isEarlyStage({ mois_operations: 17, nb_clients_payants: 5 })).toBe(true);
    });

    it('6. Éligible à la limite stricte de 4 clients payants', () => {
      expect(isEarlyStage({ mois_operations: 18, nb_clients_payants: 4 })).toBe(true);
    });
  });

  // ── Poids et Grilles ────────────────────────────────────────────────────────
  describe('Poids et Grilles d\'évaluation', () => {
    it('7. Somme de tous les poids IRO-ES vaut bien 1.0', () => {
      const sum = Object.values(IRO_ES_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
    });

    it('8. Les poids remappent correctement l\'importance de GCH et CA', () => {
      expect(IRO_ES_WEIGHTS.GCH).toBe(0.22);
      expect(IRO_ES_WEIGHTS.CA).toBe(0.18);
    });

    it('9. Toutes les dimensions ont une grille d\'évaluation complète [0-4]', () => {
      const keys = ['DI', 'GCH', 'CA', 'AR', 'ADC', 'IPC', 'LU'];
      keys.forEach(k => {
        expect(IRO_ES_GRILLES[k]).toBeDefined();
        expect(IRO_ES_GRILLES[k].length).toBe(5);
      });
    });
  });

  // ── Zones de score ──────────────────────────────────────────────────────────
  describe('getIROESZone — Catégorisation des scores', () => {
    it('10. Un score de 70 est classé en "Thèse solide"', () => {
      const z = getIROESZone(70);
      expect(z.label).toBe('Thèse solide');
      expect(z.color).toBe('green');
    });

    it('11. Un score de 55 est classé en "Thèse à construire"', () => {
      const z = getIROESZone(55);
      expect(z.label).toBe('Thèse à construire');
      expect(z.color).toBe('amber');
    });

    it('12. Un score de 30 est classé en "Thèse fragile"', () => {
      const z = getIROESZone(30);
      expect(z.label).toBe('Thèse fragile');
      expect(z.color).toBe('orange');
    });

    it('13. Un score de 15 est classé en "Signal d\'arrêt"', () => {
      const z = getIROESZone(15);
      expect(z.label).toBe("Signal d'arrêt");
      expect(z.color).toBe('red');
    });
  });

  // ── Règles REV early-stage ──────────────────────────────────────────────────
  describe('applyIROESRevs — Règles d\'ajustement REVs', () => {
    it('14. REV-ES1 applique un plafond strict de 20 pts (wrapper pur sans équipe)', () => {
      // Pour éviter de déclencher REV-ES2, on donne CA: 1
      const { score, revs_applied } = applyIROESRevs(65, { DI: 0, GCH: 1, CA: 1 });
      expect(score).toBe(20);
      expect(revs_applied[0]).toContain('REV-ES1');
    });

    it('15. REV-ES1 est inactive si l\'équipe est de niveau suffisant (GCH >= 2)', () => {
      // Pour éviter de déclencher REV-ES2, on donne CA: 1
      const { score, revs_applied } = applyIROESRevs(65, { DI: 0, GCH: 2, CA: 1 });
      expect(score).toBe(65);
      expect(revs_applied.length).toBe(0);
    });

    it('16. REV-ES2 applique un plafond strict de 35 pts si CA = 0 (aucune itération)', () => {
      // Pour éviter de déclencher REV-ES1, on donne DI: 1 et GCH: 2
      const { score, revs_applied } = applyIROESRevs(55, { DI: 1, GCH: 2, CA: 0 });
      expect(score).toBe(35);
      expect(revs_applied[0]).toContain('REV-ES2');
    });

    it('17. REV-ES3 accorde un bonus de +5 pts (early traction + équipe solide)', () => {
      // Pour éviter de déclencher REV-ES1/2, on donne DI: 1, CA: 1
      const { score, revs_applied } = applyIROESRevs(60, { DI: 1, GCH: 3, CA: 1, IPC: 2 });
      expect(score).toBe(65);
      expect(revs_applied[0]).toContain('REV-ES3');
    });

    it('18. REV-ES3 plafonne correctement le score final à 85 pts', () => {
      // Pour éviter de déclencher REV-ES1/2, on donne DI: 1, CA: 1
      const { score, revs_applied } = applyIROESRevs(83, { DI: 1, GCH: 3, CA: 1, IPC: 3 });
      expect(score).toBe(85);
      expect(revs_applied[0]).toContain('REV-ES3');
    });
  });

  // ── Cas d\'école et Rétroprojections ───────────────────────────────────────
  describe('calcIROES — Évaluations finales et Rétroprojections', () => {
    it('19. Cas Doctolib 2013 (early-stage retroprojeté)', () => {
      // Profil estimé : DI=2, GCH=2, CA=3, AR=2, ADC=1, IPC=2, LU=1
      const scores = { DI: 2, GCH: 2, CA: 3, AR: 2, ADC: 1, IPC: 2, LU: 1 };
      const { score_final, zone, revs_applied } = calcIROES(scores);
      
      expect(score_final).toBeCloseTo(50.7, 1);
      expect(zone.label).toBe('Thèse à construire');
      expect(revs_applied.length).toBe(0);
    });

    it('20. Cas Doctolib 2013 avec bonus équipe renforcée GCH=3', () => {
      const scores = { DI: 2, GCH: 3, CA: 3, AR: 2, ADC: 1, IPC: 2, LU: 1 };
      const { score_final, zone, revs_applied } = calcIROES(scores);
      
      // brut augmentant de 0.22, REV-ES3 s'active (+5pts)
      expect(score_final).toBeGreaterThan(55);
      expect(zone.label).toBe('Thèse à construire');
      expect(revs_applied[0]).toContain('REV-ES3');
    });

    it('21. Cas Inato 2018 (early-stage retroprojeté)', () => {
      // Profil estimé : DI=3, GCH=3, CA=2, AR=2, ADC=2, IPC=2, LU=0
      const scores = { DI: 3, GCH: 3, CA: 2, AR: 2, ADC: 2, IPC: 2, LU: 0 };
      const { score_brut, score_final, revs_applied } = calcIROES(scores);
      
      expect(score_brut).toBeCloseTo(58.5, 1);
      // REV-ES3 s'active (IPC=2 et GCH=3) -> +5pts => 63.5
      expect(score_final).toBeCloseTo(63.5, 1);
      expect(revs_applied[0]).toContain('REV-ES3');
    });

    it('22. Cas Omybox 2026 (score live live-like)', () => {
      // Profil live-like : DI=1, GCH=2, CA=1, AR=1, ADC=1, IPC=1, LU=0
      const scores = { DI: 1, GCH: 2, CA: 1, AR: 1, ADC: 1, IPC: 1, LU: 0 };
      const { score_final, zone } = calcIROES(scores);
      
      expect(score_final).toBeLessThan(35);
      expect(score_final).toBeGreaterThan(25);
      expect(zone.label).toBe('Thèse fragile');
    });

    it('23. Cas critique extrême : DI=0 et GCH=0 (sans équipe, sans produit, note: plafonds inactifs si le score brut est déjà inférieur au plafond)', () => {
      const scores = { DI: 0, GCH: 0, CA: 0, AR: 0, ADC: 0, IPC: 0, LU: 0 };
      const { score_final } = calcIROES(scores);
      
      expect(score_final).toBe(0);
    });

    it('24. Cas de score maximal possible à l\'évaluation brute', () => {
      const scores = { DI: 4, GCH: 4, CA: 4, AR: 4, ADC: 4, IPC: 4, LU: 4 };
      const { score_brut, score_final } = calcIROES(scores);
      
      expect(score_brut).toBe(100.0);
      // REV-ES3 s'active mais on plafonne à 85 pts
      expect(score_final).toBe(85);
    });
  });

});
