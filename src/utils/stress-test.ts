/**
 * src/utils/stress-test.ts — Stress test chocs technologiques
 * IRO Strength v6 — Antigravity Intelligence Platform
 *
 * Simule 4 chocs documentés sur l'IA agentique (présentation slide 4)
 * et calcule la résistance IRO à chaque scénario.
 *
 * Seuil de résistance : IRO_cr ≥ 40 après choc (zone Fragile vs Critique)
 */

import { coxSurvival } from './cox-model';
import { IRO_WEIGHTS } from './weights-registry';

export interface TechShock {
  id: string;
  name: string;
  description: string;
  year: string;
  real_examples: string;
  dimension_impacts: Record<string, number>;  // delta sur chaque dimension
  srd_delta: number;
  probability_next_2y: number;  // [0-1]
}

export interface StressResult {
  shock: TechShock;
  base_iro: number;
  base_irocr: number;
  shocked_iro: number;
  shocked_irocr: number;
  delta_iro: number;
  delta_irocr: number;
  survived: boolean;           // IRO_cr ≥ 40 après choc
  survival_base_36m: number;
  survival_shocked_36m: number;
  resilience_factors: string[];  // Quelles dimensions ont protégé
  vulnerability_factors: string[]; // Quelles dimensions ont cédé
}

export const TECH_SHOCKS: TechShock[] = [
  {
    id: 'gpt_next',
    name: 'Lancement GPT-Next / commoditisation LLM',
    description: 'Modèle génératif de base remplace 80% des wrappers conversationnels. Coût API ÷ 10.',
    year: '2025-2026',
    real_examples: 'Jasper AI -80%, ChatGPT Plugins 2023, GPT-4 Turbo 2024',
    dimension_impacts: { DI: -1, IPC: -1, ADC: 0, CA: 0, AR: 0, GCH: 0 },
    srd_delta: 20,
    probability_next_2y: 0.90,
  },
  {
    id: 'ai_act',
    name: 'AI Act entrée en vigueur — conformité obligatoire',
    description: 'Exigences conformité haute risque. Coût compliance ou opportunité barrière selon préparation.',
    year: '2025-2026',
    real_examples: 'Startups non conformes = blocage UE, délai 2 ans pour adaptation',
    dimension_impacts: { AR: -2, CA: -1, DI: 0, ADC: 0, IPC: 0, GCH: 0 },
    srd_delta: 10,
    probability_next_2y: 0.95,
  },
  {
    id: 'hyperscaler_pivot',
    name: 'Hyperscaler lance concurrent direct natif',
    description: 'AWS/Azure/Google intègre fonctionnalité équivalente dans sa suite. Prix < 50% du marché.',
    year: '2024-2025',
    real_examples: 'GitHub Copilot 2022, Google Duet 2023, Microsoft 365 Copilot 2024',
    dimension_impacts: { DI: -2, IPC: -1, ADC: 0, CA: 0, AR: 0, GCH: 0 },
    srd_delta: 25,
    probability_next_2y: 0.75,
  },
  {
    id: 'vc_winter',
    name: 'Hiver VC — assèchement financement IA',
    description: 'Taux élevés + correction valorisations IA -60%. Runways coupés. Recrutements gelés.',
    year: '2023-2024',
    real_examples: 'Iziwork liquidation, Openclassrooms -292 postes, Jellysmack -40%, Meero pivot 2023',
    dimension_impacts: { CA: -1, GCH: -1, ADC: 0, DI: 0, IPC: 0, AR: 0 },
    srd_delta: 30,
    probability_next_2y: 0.55,
  },
];

const W = IRO_WEIGHTS;

function calcIROSimple(scores: Record<string, number>): number {
  const brut = Object.entries(W).reduce((s, [k, w]) => s + (scores[k] ?? 0) * (w as number), 0);
  let v = Math.round((brut / 4) * 100 * 10) / 10;
  if ((scores.DI ?? 0) === 0) v = Math.min(v, 40);
  return v;
}

/**
 * Applique un choc aux scores et calcule la résistance.
 */
export function applyShock(
  baseScores: Record<string, number>,
  baseSRD: number,
  shock: TechShock,
): StressResult {
  const shocked: Record<string, number> = { ...baseScores };
  Object.entries(shock.dimension_impacts).forEach(([k, v]) => {
    shocked[k] = Math.max(0, Math.min(4, (shocked[k] ?? 0) + v));
  });

  const shockedSRD = Math.min(100, baseSRD + shock.srd_delta);
  const baseIRO = calcIROSimple(baseScores);
  const baseICR = Math.round(baseIRO * (1 - baseSRD / 200) * 10) / 10;
  const shockedIRO = calcIROSimple(shocked);
  const shockedICR = Math.round(shockedIRO * (1 - shockedSRD / 200) * 10) / 10;

  // Facteurs de résilience : dimensions qui ont absorbé le choc (score ≥ 3 après impact)
  const resilience_factors: string[] = [];
  const vulnerability_factors: string[] = [];

  Object.entries(shock.dimension_impacts).forEach(([k, delta]) => {
    if (delta < 0) {
      if ((baseScores[k] ?? 0) >= 3) {
        resilience_factors.push(`${k}=${baseScores[k]} — marge d'absorption suffisante`);
      } else {
        vulnerability_factors.push(`${k}=${baseScores[k]} — score faible amplifié par le choc`);
      }
    }
  });

  if (shock.srd_delta > 15) {
    if (baseSRD < 40) resilience_factors.push('SRD bas — marge conjoncturelle disponible');
    else vulnerability_factors.push('SRD élevé — amplification conjoncturelle du choc');
  }

  return {
    shock,
    base_iro: baseIRO,
    base_irocr: baseICR,
    shocked_iro: shockedIRO,
    shocked_irocr: shockedICR,
    delta_iro: Math.round((shockedIRO - baseIRO) * 10) / 10,
    delta_irocr: Math.round((shockedICR - baseICR) * 10) / 10,
    survived: shockedICR >= 40,
    survival_base_36m: Math.round(coxSurvival(baseICR, 36) * 1000) / 10,
    survival_shocked_36m: Math.round(coxSurvival(shockedICR, 36) * 1000) / 10,
    resilience_factors,
    vulnerability_factors,
  };
}

/**
 * Stress test complet sur tous les chocs.
 */
export function runFullStressTest(
  baseScores: Record<string, number>,
  baseSRD: number,
): {
  results: StressResult[];
  survived_count: number;
  total_count: number;
  resilience_score: number;  // [0-100]
  most_dangerous: TechShock;
  key_vulnerabilities: string[];
} {
  const results = TECH_SHOCKS.map(shock => applyShock(baseScores, baseSRD, shock));
  const survived = results.filter(r => r.survived).length;

  // Score de résilience : pondéré par probabilité des chocs
  const weighted_score = results.reduce((s, r) => {
    return s + (r.survived ? 1 : 0) * r.shock.probability_next_2y;
  }, 0);
  const total_prob = results.reduce((s, r) => s + r.shock.probability_next_2y, 0);
  const resilience_score = Math.round((weighted_score / total_prob) * 100);

  const most_dangerous = results
    .sort((a, b) => a.delta_irocr - b.delta_irocr)[0].shock;

  const key_vulnerabilities = [
    ...(baseScores.DI === 0 ? ['DI=0 — REV1 active, vulnérabilité maximale aux chocs LLM'] : []),
    ...(baseSRD > 60 ? ['SRD > 60% — amplificateur conjoncturel présent'] : []),
    ...((baseScores.AR ?? 0) < 2 ? ['AR faible — exposition AI Act élevée'] : []),
    ...((baseScores.CA ?? 0) < 2 ? ['CA faible — adaptation lente aux ruptures technologiques'] : []),
  ];

  return {
    results,
    survived_count: survived,
    total_count: TECH_SHOCKS.length,
    resilience_score,
    most_dangerous,
    key_vulnerabilities,
  };
}

export const RESILIENCE_THRESHOLD_IRO_CR = 40;
