/**
 * tests/iro-engine.vitest.test.ts — Suite Vitest pour iro-engine.ts
 *
 * CORRECTIF INFRA-01 (Audit OPRO v2.0 — Avril 2026)
 * Remplace les assertions manuelles par un vrai framework de test.
 *
 * Lancer : npx vitest run
 * Avec coverage : npx vitest run --coverage
 */

import { describe, it, expect } from 'vitest';
import {
  calcIRO, calcSRD, calcCMP, calcInteractionBonus,
  buildVarianceReport, mean, std, median,
  GOLD_STANDARD_N, GOLD_STANDARD_MIN, GOLD_STANDARD_WARN,
  interpIRO, scoreColor, getQuadrant,
  computeIRO, calcIROCertified,
  applyModelRules, generateReporting,
  SEUIL_VIABILITE, SEUIL_ALERTE, zoneIRO,
} from '../src/utils/iro-engine';
import { GOLD_STANDARD, buildIROMetadata } from '../src/types/iro';
import { coxFull } from '../src/utils/cox-model';

// ── Gold Standard ─────────────────────────────────────────────────────────────

describe('[F1] Gold Standard', () => {
  it('contient 125 entrées (scoring rétrospectif Avril 2026)', () => {
    expect(GOLD_STANDARD).toHaveLength(125);
  });

  it('dépasse le seuil minimum n=60', () => {
    expect(GOLD_STANDARD_N).toBeGreaterThanOrEqual(GOLD_STANDARD_MIN);
  });

  it('GOLD_STANDARD_WARN est true — mode d\'alerte statistique activé sur outcomes réels', () => {
    expect(GOLD_STANDARD_WARN).toBe(true);
  });

  it('mode normatif pour n=10', () => {
    const meta = buildIROMetadata(10);
    expect(meta.mode).toBe('normatif');
    expect(meta.r2_annotation).toContain('n=10');
  });

  it('mode prédictif pour n=80', () => {
    const meta = buildIROMetadata(80);
    expect(meta.mode).toBe('predictif');
    expect(meta.r2_annotation).toBe('');
  });

  it('toutes les entrées ont des scores valides [0-4]', () => {
    const dims = ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'] as const;
    for (const entry of GOLD_STANDARD) {
      for (const dim of dims) {
        const score = (entry.scores as any)[dim];
        expect(score, `${entry.id} — ${dim}`).toBeGreaterThanOrEqual(0);
        expect(score, `${entry.id} — ${dim}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('toutes les entrées ont un ICC valide [0-1]', () => {
    for (const entry of GOLD_STANDARD) {
      expect(entry.sce.icc, entry.id).toBeGreaterThan(0);
      expect(entry.sce.icc, entry.id).toBeLessThanOrEqual(1);
    }
  });
});

// ── calcIRO ───────────────────────────────────────────────────────────────────

describe('[F1] calcIRO', () => {
  const scores = { DI: 2, ADC: 3, IPC: 3, AR: 2, CA: 2, GCH: 3 };

  it('retourne un mobile entre 0 et 100', () => {
    const result = calcIRO(scores, 0.8, undefined, 1.0, 1.0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('[REV1-V2, MAJ 10/07/2026] DI=0 + ADC<=1 plafonne IRO à 35 ; DI=0 + ADC>=3 ne plafonne plus', () => {
    // Ancienne règle (jusqu'au 10/07/2026) : tout DI=0 plafonnait à 40, quel que soit ADC.
    // Nouvelle règle REV1-V2 (validée par panel humain, juin 2026 ; unifiée avec
    // batch_gemini_iro.py lors de l'audit du 10/07/2026) : le plafond dépend d'ADC.
    const wrapperSansActifs = { DI: 0, ADC: 1, IPC: 4, AR: 4, CA: 4, GCH: 4 };
    expect(calcIRO(wrapperSansActifs, 1.0, undefined, 1.0, 1.0)).toBeLessThanOrEqual(35);

    const wrapperActifsPropresForts = { DI: 0, ADC: 4, IPC: 4, AR: 4, CA: 4, GCH: 4 };
    // ADC>=3 : plus de plafond — des données propriétaires réelles compensent l'absence de DI.
    expect(calcIRO(wrapperActifsPropresForts, 1.0, undefined, 1.0, 1.0)).toBeGreaterThan(40);
  });

  it('scores maximaux proches de 100', () => {
    const maxScores = { DI: 4, ADC: 4, IPC: 4, AR: 4, CA: 4, GCH: 4, LU: 4 };
    const result = calcIRO(maxScores, 1.0, undefined, 1.0, 1.0);
    expect(result).toBeGreaterThan(90);
  });

  it('scores minimaux proches de 0', () => {
    const minScores = { DI: 0, ADC: 0, IPC: 0, AR: 0, CA: 0, GCH: 0, LU: 0 };
    const result = calcIRO(minScores, 0.2, undefined, 0.2, 0.2);
    expect(result).toBeLessThanOrEqual(10);
  });
});

// ── calcSRD ───────────────────────────────────────────────────────────────────

describe('[F2] calcSRD — Anti-double-pénalité DI', () => {
  it('DI=0 réduit le poids DFL de 0.30 à 0.15', () => {
    const result = calcSRD(2, 2, 2, 0);
    expect(result.dflWeightApplied).toBeCloseTo(0.15, 2);
  });

  it('DI>0 conserve le poids DFL à 0.30', () => {
    const result = calcSRD(2, 2, 2, 2);
    expect(result.dflWeightApplied).toBeCloseTo(0.30, 2);
  });

  it('srd est entre 0 et 100', () => {
    const result = calcSRD(2, 2, 2, 2);
    expect(result.srd).toBeGreaterThanOrEqual(0);
    expect(result.srd).toBeLessThanOrEqual(100);
  });
});

// ── calcCMP ───────────────────────────────────────────────────────────────────

describe('[F3] calcCMP — Contributions marginales pondérées', () => {
  const scores = { DI: 2, ADC: 3, IPC: 2, AR: 2, CA: 2, GCH: 2 };

  it('les 6 contributions + baseline correspondent au prédit', () => {
    const cmp = calcCMP(scores, 0.8, 1.0, 1.0);
    const sumPhi = cmp.DI + cmp.ADC + cmp.IPC + cmp.AR + cmp.CA + cmp.GCH + (cmp.LU || 0);
    expect(sumPhi + cmp.baseline).toBeCloseTo(cmp.predicted, 0);
  });

  it('les contributions sont cohérentes (additivity_check)', () => {
    const cmp = calcCMP(scores, 0.8, 1.0, 1.0);
    expect(cmp.additivity_check).toBe(true);
  });
});

// ── buildVarianceReport ───────────────────────────────────────────────────────

describe('[F4] buildVarianceReport — Variance intra-LLM', () => {
  const passes = [
    { DI: 2, ADC: 3, IPC: 3, AR: 2, CA: 2, GCH: 2 },
    { DI: 2, ADC: 3, IPC: 3, AR: 2, CA: 2, GCH: 3 },
    { DI: 2, ADC: 3, IPC: 2, AR: 2, CA: 2, GCH: 2 },
  ];
  const iros = [65, 67, 63];

  it('retourne un rapport de variance valide', () => {
    const report = buildVarianceReport(passes, iros, 4, true);
    expect(report).toBeDefined();
    expect(typeof report.sigma_iro).toBe('number');
  });

  it('variance faible pour des passages proches', () => {
    const report = buildVarianceReport(passes, iros, 4, true);
    expect(report.sigma_iro).toBeLessThan(5);
  });
});

// ── Utilitaires statistiques ──────────────────────────────────────────────────

describe('Utilitaires statistiques', () => {
  it('mean([1,2,3,4,5]) = 3', () => {
    expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3, 5);
  });

  it('std([2,2,2]) = 0', () => {
    expect(std([2, 2, 2])).toBeCloseTo(0, 5);
  });

  it('median([1,3,2]) = 2', () => {
    expect(median([1, 3, 2])).toBe(2);
  });

  it('median([1,2,3,4]) = 2.5 (paire)', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

// ── Interprétation & couleurs ─────────────────────────────────────────────────

describe('interpIRO & scoreColor — v4.5-S46', () => {
  // Zones recalibrées : Excellent ≥80 · Solide ≥65 · Vigilance ≥46 · Risque élevé <46

  it('score ≥ 80 → Excellent', () => {
    expect(interpIRO(85)).toBe('Excellent');
    expect(interpIRO(100)).toBe('Excellent');
  });

  it('score 65-79 → Solide', () => {
    expect(interpIRO(65)).toBe('Solide');
    expect(interpIRO(75)).toBe('Solide');
    expect(interpIRO(79)).toBe('Solide');
  });

  it('score 46-64 → Vigilance (seuil recalibré à 46)', () => {
    expect(interpIRO(46)).toBe('Vigilance');
    expect(interpIRO(50)).toBe('Vigilance');   // ancien seuil — maintenant Vigilance
    expect(interpIRO(64)).toBe('Vigilance');
  });

  it('score 45 → Risque élevé (juste sous le seuil 46)', () => {
    expect(interpIRO(45)).toBe('Risque élevé');
    expect(interpIRO(0)).toBe('Risque élevé');
  });

  it('SEUIL_VIABILITE exporté = 46', () => {
    expect(SEUIL_VIABILITE).toBe(46);
  });

  it('SEUIL_ALERTE exporté = 50', () => {
    expect(SEUIL_ALERTE).toBe(50);
  });

  it('scoreColor retourne une chaîne hexadécimale valide', () => {
    for (const score of [0, 25, 45, 46, 50, 65, 80, 100]) {
      expect(scoreColor(score)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('scoreColor ambre pour zone Vigilance (46-64)', () => {
    expect(scoreColor(50)).toBe('#fbbf24');
    expect(scoreColor(46)).toBe('#fbbf24');
  });

  it('zoneIRO retourne label, color, bg, desc', () => {
    const z = zoneIRO(75);
    expect(z).toHaveProperty('label');
    expect(z).toHaveProperty('color');
    expect(z).toHaveProperty('bg');
    expect(z).toHaveProperty('desc');
  });

  it('zoneIRO(46) → Vigilance', () => {
    expect(zoneIRO(46).label).toBe('Vigilance');
  });

  it('zoneIRO(45) → Risque élevé', () => {
    expect(zoneIRO(45).label).toBe('Risque élevé');
  });

  it('zoneIRO(80) → Excellent avec taux 0%', () => {
    const z = zoneIRO(80);
    expect(z.label).toBe('Excellent');
    expect(z.desc).toContain('0%');
  });
});

// ── Dimension LU — von Hippel v4.4-LU ────────────────────────────────────────

describe('Dimension LU — Lead User Integration (von Hippel)', () => {
  const scoresAvecLU  = { DI: 3, ADC: 4, IPC: 3, AR: 3, CA: 3, GCH: 3, LU: 4 };
  const scoresSansLU  = { DI: 3, ADC: 4, IPC: 3, AR: 3, CA: 3, GCH: 3, LU: 0 };
  const scoresLU1     = { DI: 1, ADC: 3, IPC: 2, AR: 3, CA: 2, GCH: 2, LU: 1 }; // profil Lydia-type

  it('LU=4 donne un score plus élevé que LU=0 (toutes choses égales)', () => {
    const r4 = calcIRO(scoresAvecLU, 1.0, undefined, 1.0, 1.0);
    const r0 = calcIRO(scoresSansLU, 1.0, undefined, 1.0, 1.0);
    expect(r4).toBeGreaterThan(r0);
  });

  it('LU=0 avec DI=0 → IRO plafonné à 40 (REV1)', () => {
    const scores = { DI: 0, ADC: 2, IPC: 1, AR: 2, CA: 1, GCH: 2, LU: 0 };
    const r = calcIRO(scores, 1.0, undefined, 1.0, 1.0);
    expect(r).toBeLessThanOrEqual(40);
  });

  it('Profil Lydia (ADC élevé, LU=1, IPC faible) → zone Vigilance ou Risque élevé', () => {
    const r = calcIRO(scoresLU1, 0.8, undefined, 1.0, 1.0);
    expect(r).toBeLessThan(65); // pas en zone Solide
  });

  it('LU integrated dans le calcul brut (poids 0.15)', () => {
    const scoresLU2 = { ...scoresSansLU, LU: 2 };
    const scoresLU3 = { ...scoresSansLU, LU: 3 };
    const r2 = calcIRO(scoresLU2, 1.0, undefined, 1.0, 1.0);
    const r3 = calcIRO(scoresLU3, 1.0, undefined, 1.0, 1.0);
    const r0 = calcIRO(scoresSansLU, 1.0, undefined, 1.0, 1.0);
    // Chaque point LU vaut 0.15/4*100 = 3.75 pts
    expect(r2).toBeGreaterThan(r0);
    expect(r3).toBeGreaterThan(r2);
  });
});

// ── Quadrant ──────────────────────────────────────────────────────────────────

describe('getQuadrant', () => {
  it('IRO élevé + SRD faible → Forteresse', () => {
    const q = getQuadrant(80, 20);
    expect(q).toContain('Forteresse');
  });

  it('IRO faible + SRD élevé → Zone Rouge', () => {
    const q = getQuadrant(30, 80);
    expect(q).toBe('Zone Rouge');
  });
});

// ── Interaction bonus ─────────────────────────────────────────────────────────

describe('calcInteractionBonus', () => {
  it('DI×ADC fort génère un bonus positif', () => {
    const bonus = calcInteractionBonus({ DI: 4, ADC: 4, IPC: 2, AR: 2, CA: 2, GCH: 2 });
    expect(bonus.bonus_total).toBeGreaterThan(0);
  });

  it('scores nuls génèrent un bonus nul', () => {
    const bonus = calcInteractionBonus({ DI: 0, ADC: 0, IPC: 0, AR: 0, CA: 0, GCH: 0 });
    expect(bonus.bonus_total).toBe(0);
  });
});

// ── computeIRO & calcIROCertified ─────────────────────────────────────────────

describe('Orchestration computeIRO & calcIROCertified', () => {
  const scores = { DI: 2, ADC: 3, IPC: 2, AR: 2, CA: 2, GCH: 3 };

  it('computeIRO retourne un résultat complet', () => {
    const res = computeIRO(scores);
    expect(res.iro.score_100).toBeDefined();
    expect(res.srd.srd_100).toBeDefined();
    expect(res.iro.interpretation).toBeDefined();
    expect(res.srd.quadrant).toBeDefined();
  });

  it('calcIROCertified retourne des métriques de confiance et Spearman', () => {
    const res = calcIROCertified(scores, 0.8);
    expect(res.spearman).toBeGreaterThan(0.6);
    expect(res.iro_certified).toBeDefined();
    expect(res.confiance_calibration).toBeGreaterThanOrEqual(0);
  });
});

// ── applyModelRules & generateReporting tests ──────────────────────────────────

describe('rules and reporting', () => {
  it('applies DI signals from githubData properly', () => {
    const scores = { DI: 1, ADC: 2, IPC: 2, AR: 2, CA: 2, GCH: 2 };
    const model = {} as any;
    
    const resProp = applyModelRules(scores, model, { di_signal: 'proprietary', di_signal_reason: 'reason' } as any);
    expect(resProp.adjusted.DI).toBe(3);
    expect(resProp.logs[0]).toContain('proprietary');

    const resFine = applyModelRules(scores, model, { di_signal: 'finetuned' } as any);
    expect(resFine.adjusted.DI).toBe(2);

    const resRag = applyModelRules(scores, model, { di_signal: 'rag_custom' } as any);
    expect(resRag.adjusted.DI).toBe(1);

    const resWrap = applyModelRules(scores, model, { di_signal: 'wrapper' } as any);
    expect(resWrap.adjusted.DI).toBe(1);

    const resNone = applyModelRules(scores, model, { di_signal: 'none' } as any);
    expect(resNone.adjusted.DI).toBe(1);
  });

  it('applies financialData integration levels properly', () => {
    const scores = { DI: 0, ADC: 2, IPC: 2, AR: 2, CA: 2, GCH: 2 };
    const model = {} as any;

    const resSelf = applyModelRules(scores, model, undefined, { llm_stack: { integration_level: 'Self-hosted', confidence: 'high' } } as any);
    expect(resSelf.adjusted.DI).toBe(3);

    const resFine = applyModelRules(scores, model, undefined, { llm_stack: { integration_level: 'Fine-tuned' } } as any);
    expect(resFine.adjusted.DI).toBe(2);

    const resHyb = applyModelRules(scores, model, undefined, { llm_stack: { integration_level: 'Hybrid' } } as any);
    expect(resHyb.adjusted.DI).toBe(1);

    const resAPI = applyModelRules(scores, model, undefined, { llm_stack: { integration_level: 'API' } } as any);
    expect(resAPI.adjusted.DI).toBe(0);
  });

  it('applies TRL and VRIN rule corrections properly', () => {
    const scores = { DI: 1, ADC: 1, IPC: 2, AR: 2, CA: 2, GCH: 2 };
    const model = {
      trl_niveau: '5',
      di_infra_propre: true,
      di_vrin_valuable: 'fort',
      di_vrin_rare: 'moyen',
      di_vrin_inimitable: 'moyen',
      di_vrin_non_sub: 'moyen',
      adc_vrin_valuable: 'fort',
      adc_vrin_rare: 'fort',
      adc_vrin_inimitable: 'moyen',
      adc_vrin_non_sub: 'moyen',
    } as any;

    const res = applyModelRules(scores, model);
    expect(res.adjusted).toBeDefined();
    expect(res.logs.length).toBeGreaterThan(0);
  });

  it('detects emotionnel or social jobs of criticite >= 3', () => {
    const scores = { DI: 2, ADC: 2, IPC: 2, AR: 2, CA: 2, GCH: 2 };
    const model1 = {
      ipc_job_type: 'emotionnel',
      ipc_job_criticite: '4',
    } as any;
    const res1 = applyModelRules(scores, model1);
    expect(res1.logs.some(l => l.includes('Job emotionnel critique détecté'))).toBe(true);

    const model2 = {
      ipc_job_type: 'social',
      ipc_job_criticite: '3',
    } as any;
    const res2 = applyModelRules(scores, model2);
    expect(res2.logs.some(l => l.includes('Job social critique détecté'))).toBe(true);
  });

  it('handles generateReporting outputs', () => {
    const results = [
      { name: 'S1', delta: 5, score_100: 50, srd_100: 50, quadrant: 'Forteresse', irocr: 5.0, status: 'active' },
      { name: 'S2', delta: 12, score_100: 60, srd_100: 40, quadrant: 'Forteresse', irocr: 6.0, status: 'active' },
    ];
    generateReporting([]);
    generateReporting(results as any[]);
  });


  it('A1 — S36 jamais < 8% ni > 97%', () => {
    const extremes = [
      { irocr: 5,  di_zero: true,  srd_high: true,  adc_strong: false, ipc_strong: false, regulated_sector: false },
      { irocr: 95, di_zero: false, srd_high: false,  adc_strong: true,  ipc_strong: true,  regulated_sector: true  },
    ];
    for (const inp of extremes) {
      const res = coxFull(inp);
      expect(res.survival_36m).toBeGreaterThanOrEqual(0.08);
      expect(res.survival_36m).toBeLessThanOrEqual(0.97);
    }
  });
});

// ── REV13 — concentration_anchor (v4.6) ──────────────────────────────────────

describe('REV13 — concentration_anchor', () => {
  const scoresAnchor = { DI:2, ADC:3, IPC:3, AR:2, CA:3, GCH:3, LU:3 };
  const scoresB2C    = { DI:2, ADC:3, IPC:1, AR:2, CA:3, GCH:3, LU:1 };

  it('pas de malus si portefeuille >20 clients (même avec top client fort)', () => {
    const s = calcIRO({ ...scoresAnchor, _pct_top_client: 0.60, _nb_clients: 50 }, 1.0);
    // 50 clients → REV13 inactif
    expect(s).toBeCloseTo(68.1, 0);
  });

  it('malus −8 pts si top client >40% CA et ≤20 clients', () => {
    const sans = calcIRO(scoresAnchor, 1.0);
    const avec = calcIRO({ ...scoresAnchor, _pct_top_client: 0.47, _nb_clients: 15 }, 1.0);
    expect(sans - avec).toBeCloseTo(8.0, 0);
  });

  it('malus −4 pts si top client entre 25% et 40% CA et ≤20 clients', () => {
    const sans = calcIRO(scoresAnchor, 1.0);
    const avec = calcIRO({ ...scoresAnchor, _pct_top_client: 0.30, _nb_clients: 10 }, 1.0);
    expect(sans - avec).toBeCloseTo(4.0, 0);
  });

  it('pas de malus si top client <25% CA', () => {
    const sans = calcIRO(scoresAnchor, 1.0);
    const avec = calcIRO({ ...scoresAnchor, _pct_top_client: 0.20, _nb_clients: 10 }, 1.0);
    expect(avec).toBeCloseTo(sans, 0);
  });

  it('REV13 avec scores IPC=3,LU=3,DI=2 : brut 76.2 → 68.2 apres malus −8 pts', () => {
    const score = calcIRO({ ...scoresAnchor, _pct_top_client: 0.47, _nb_clients: 15 }, 1.0);
    expect(score).toBeCloseTo(60.1, 0);
  });

  it('REV13 inactif si nb_clients > 20 (ex: 27000 clients B2C)', () => {
    const score = calcIRO({ ...scoresB2C, _pct_top_client: 0.0, _nb_clients: 27000 }, 1.0);
    // v4.7 : scoresB2C = {DI:2, ADC:3, IPC:1, LU:1} → REV12 déclenché (-5 pts)
    // IRO brut 57.8 - REV12 5.0 = 52.8
    expect(score).toBeCloseTo(46.6, 0);
  });

  it('score REV13 jamais négatif', () => {
    const score = calcIRO({ DI:0, ADC:1, IPC:1, AR:1, CA:1, GCH:1, LU:0, _pct_top_client: 0.99, _nb_clients: 1 }, 1.0);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('[REV1-V2, MAJ 10/07/2026] REV1 + REV13 cumulables : DI=0, ADC=3 → pas de plafond REV1, seul REV13 s\'applique', () => {
    const score = calcIRO({ DI:0, ADC:3, IPC:3, AR:2, CA:3, GCH:3, LU:3, _pct_top_client: 0.47, _nb_clients: 5 }, 1.0);
    // Avec ADC=3, REV1-V2 ne plafonne plus (contrairement à l'ancienne règle uniforme
    // à 40) ; seul le malus REV13 (-8 pts, concentration client) s'applique désormais.
    expect(score).toBeGreaterThan(32);
  });

  it('[REV1-V2, MAJ 10/07/2026] REV1 + REV13 cumulables : DI=0, ADC<=1 → plafond 35 puis REV13 -8', () => {
    const score = calcIRO({ DI:0, ADC:1, IPC:3, AR:2, CA:3, GCH:3, LU:3, _pct_top_client: 0.47, _nb_clients: 5 }, 1.0);
    // REV1-V2 plafonne à 35 (ADC<=1), puis REV13 soustrait 8 → max 27.
    expect(score).toBeLessThanOrEqual(27);
  });
});

// ── REV12 — adc_ipc_gap (v4.7) ────────────────────────────────────────────────
// Calibré sur 8 FP persistants cohorte n=87 — juin 2026
// Condition : ADC >= 3 ET IPC <= 1 ET LU <= 1 → malus −5 pts

describe('REV12 — adc_ipc_gap', () => {
  // Scores typiques des FP (Meero-like : données sectorielles sans ancrage client)
  const scoresGap    = { DI:1, ADC:3, IPC:1, AR:2, CA:2, GCH:2, LU:1 };
  // IPC=2 → REV12 inactif (condition IPC<=1 non satisfaite)
  const scoresNoGap  = { DI:1, ADC:3, IPC:2, AR:2, CA:2, GCH:2, LU:2 };
  // LU=3 → REV12 inactif (condition LU<=1 non satisfaite)
  const scoresLUHaut = { DI:2, ADC:3, IPC:3, AR:2, CA:3, GCH:3, LU:3 };

  it('malus −5 pts si ADC>=3, IPC<=1, LU<=1', () => {
    const sans = calcIRO(scoresNoGap, 1.0);    // 50.9
    const avec = calcIRO(scoresGap,   1.0);    // 37.6
    expect(sans - avec).toBeCloseTo(13.3, 0);  // écart = 50.9 - 37.6
  });

  it('score avec REV12 = 42.8 (brut 47.8 - 5.0)', () => {
    const score = calcIRO(scoresGap, 1.0);
    expect(score).toBeCloseTo(37.6, 0);
  });

  it('REV12 inactif si IPC=2 (même avec ADC=3 et LU=1)', () => {
    const score = calcIRO(scoresNoGap, 1.0);
    expect(score).toBeCloseTo(50.9, 0);
  });

  it('REV12 inactif si LU=3 (lead user ancré — pas de gap)', () => {
    // scoresLUHaut : ADC=3, IPC=3, LU=3 → REV12 inactif (IPC=3 et LU=3)
    const score = calcIRO(scoresLUHaut, 1.0);
    expect(score).toBeCloseTo(68.1, 0);
  });

  it('REV12 inactif si ADC=2 (seuil ADC>=3 non atteint)', () => {
    const scores = { DI:1, ADC:2, IPC:1, AR:2, CA:2, GCH:2, LU:1 };
    const avec  = calcIRO(scores, 1.0);
    const score_ref = calcIRO({ ...scores, ADC:2 }, 1.0);
    // Pas de malus REV12
    expect(avec).toEqual(score_ref);
  });

  it('REV12 + REV1 cumulables : DI=0 + adc_ipc_gap', () => {
    const scores = { DI:0, ADC:3, IPC:1, AR:2, CA:2, GCH:2, LU:0 };
    const score = calcIRO(scores, 1.0);
    // REV1 : plafond 40 (brut 35.3 → reste 35.3)
    // REV12 : ADC=3, IPC=1, LU=0 → -5 → 30.3
    expect(score).toBeCloseTo(30.3, 0);
  });

  it('REV12 + REV13 cumulables', () => {
    const scores = {
      DI:1, ADC:3, IPC:1, AR:2, CA:2, GCH:2, LU:1,
      _pct_top_client: 0.45, _nb_clients: 10
    };
    const score = calcIRO(scores, 1.0);
    // IRO brut 42.6 − REV13 8.0 = 34.6 − REV12 5.0 = 29.6
    expect(score).toBeCloseTo(29.6, 0);
  });

  it('score REV12 jamais négatif', () => {
    const scores = { DI:1, ADC:3, IPC:0, AR:0, CA:0, GCH:0, LU:0 };
    const score = calcIRO(scores, 1.0);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
