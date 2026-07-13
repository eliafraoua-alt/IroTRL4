/**
 * src/utils/scenario-simulator.ts — Simulateur de scénarios stratégiques
 * IRO Strength v6 — Antigravity Intelligence Platform
 *
 * Permet de comparer l'impact de différentes décisions stratégiques
 * sur le score IRO, le SRD et la probabilité de survie à 36 mois.
 */

import { DimensionScores } from '../types/iro';
import { coxSurvival } from './cox-model';
import { IRO_WEIGHTS } from './weights-registry';

export interface ScenarioDelta {
  DI?: number;
  ADC?: number;
  IPC?: number;
  AR?: number;
  CA?: number;
  GCH?: number;
  srd_delta?: number;    // Impact sur SRD [+/-]
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  category: 'growth' | 'risk' | 'compliance' | 'team' | 'negative';
  delta: ScenarioDelta;
  effort_months: number;   // Durée estimée de mise en œuvre
  cost_estimate: string;   // Estimation budgétaire
  success_probability: number; // [0-1]
  color: string;
}

export interface ScenarioResult {
  scenario: Scenario;
  base: { iro: number; irocr: number; survival_36m: number };
  projected: { iro: number; irocr: number; survival_36m: number };
  delta_iro: number;
  delta_irocr: number;
  delta_survival: number;
  roi_score: number;    // (delta_survival * success_prob) / effort_months
}

export const SCENARIOS_PRESETS: Scenario[] = [
  {
    id: 'pivot_data',
    name: 'Pivot données propriétaires',
    description: 'Partenariat exclusif data ou acquisition actif données sectoriel',
    category: 'growth',
    delta: { ADC: 2, srd_delta: -10 },
    effort_months: 6,
    cost_estimate: '50-200K€ selon secteur',
    success_probability: 0.65,
    color: '#639922',
  },
  {
    id: 'certif_regl',
    name: 'Certification réglementaire',
    description: 'Obtention CE, HDS, ANSSI, ISO 27001 ou certification sectorielle',
    category: 'compliance',
    delta: { AR: 2, IPC: 1, srd_delta: -5 },
    effort_months: 9,
    cost_estimate: '30-150K€ selon certification',
    success_probability: 0.80,
    color: '#185FA5',
  },
  {
    id: 'infra_propre',
    name: 'Infrastructure propriétaire',
    description: 'Migration GPU propres, fine-tuning modèle ou développement architecture IA interne',
    category: 'growth',
    delta: { DI: 2, srd_delta: -15 },
    effort_months: 12,
    cost_estimate: '200K-2M€ selon scale',
    success_probability: 0.55,
    color: '#534AB7',
  },
  {
    id: 'integration_deep',
    name: 'Intégration client profonde',
    description: 'Contrats d\'intégration critique, SLA, API privées, switching cost élevé',
    category: 'growth',
    delta: { IPC: 2, CA: 1, srd_delta: -8 },
    effort_months: 6,
    cost_estimate: '50-300K€ (coût vente enterprise)',
    success_probability: 0.70,
    color: '#1D9E75',
  },
  {
    id: 'recrutement_expert',
    name: 'Recrutement équipe senior',
    description: 'Embauche ex-GAFAM + publications scientifiques + board technique',
    category: 'team',
    delta: { GCH: 2, CA: 1, srd_delta: 0 },
    effort_months: 4,
    cost_estimate: '300-800K€/an (salaires + equity)',
    success_probability: 0.75,
    color: '#BA7517',
  },
  {
    id: 'ai_act_compliance',
    name: 'Conformité AI Act native',
    description: 'Traçabilité, explicabilité, supervision humaine — anticipation réglementaire UE',
    category: 'compliance',
    delta: { AR: 2, CA: 1, srd_delta: -5 },
    effort_months: 8,
    cost_estimate: '20-100K€ (audit + ingénierie)',
    success_probability: 0.85,
    color: '#7F77DD',
  },
  {
    id: 'strategic_acquisition',
    name: 'Acquisition données stratégiques',
    description: 'Rachat startup avec actif data exclusif ou base clients VRIN',
    category: 'growth',
    delta: { ADC: 3, IPC: 1, srd_delta: -12 },
    effort_months: 12,
    cost_estimate: '500K-5M€',
    success_probability: 0.50,
    color: '#0C447C',
  },
  {
    id: 'wrapper_risk',
    name: 'Scénario dégradé — wrapper LLM',
    description: 'Perte d\'infra propre, dépendance totale API tier (scénario négatif)',
    category: 'negative',
    delta: { DI: -2, ADC: -1, srd_delta: 25 },
    effort_months: 0,
    cost_estimate: 'Impact interne',
    success_probability: 1.0,
    color: '#A32D2D',
  },
  {
    id: 'hyperscaler_shock',
    name: 'Choc hyperscaler concurrent',
    description: 'AWS/Azure/Google lance service équivalent natif (stress test)',
    category: 'negative',
    delta: { DI: -2, IPC: -1, srd_delta: 25 },
    effort_months: 0,
    cost_estimate: 'Exogène',
    success_probability: 1.0,
    color: '#D85A30',
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
 * Applique un scénario aux scores de base et calcule les résultats.
 */
export function applyScenario(
  baseScores: Record<string, number>,
  baseSRD: number,
  scenario: Scenario,
): ScenarioResult {
  // Scores projetés
  const projected: Record<string, number> = { ...baseScores };
  Object.entries(scenario.delta).forEach(([k, v]) => {
    if (k !== 'srd_delta') {
      projected[k] = Math.max(0, Math.min(4, (projected[k] ?? 0) + (v as number)));
    }
  });

  const projectedSRD = Math.max(0, Math.min(100, baseSRD + (scenario.delta.srd_delta ?? 0)));

  // Calculs IRO
  const baseIRO = calcIROSimple(baseScores);
  const baseICR = Math.round(baseIRO * (1 - baseSRD / 200) * 10) / 10;
  const projIRO = calcIROSimple(projected);
  const projICR = Math.round(projIRO * (1 - projectedSRD / 200) * 10) / 10;

  const baseSurv = Math.round(coxSurvival(baseICR, 36) * 1000) / 10;
  const projSurv = Math.round(coxSurvival(projICR, 36) * 1000) / 10;

  const roi_score = scenario.effort_months > 0
    ? Math.round(((projSurv - baseSurv) * scenario.success_probability) / scenario.effort_months * 100) / 100
    : 0;

  return {
    scenario,
    base: {
      iro: baseIRO,
      irocr: baseICR,
      survival_36m: baseSurv,
    },
    projected: {
      iro: projIRO,
      irocr: projICR,
      survival_36m: projSurv,
    },
    delta_iro: Math.round((projIRO - baseIRO) * 10) / 10,
    delta_irocr: Math.round((projICR - baseICR) * 10) / 10,
    delta_survival: Math.round((projSurv - baseSurv) * 10) / 10,
    roi_score,
  };
}

/**
 * Simule tous les scénarios et les trie par ROI score.
 */
export function simulateAll(
  baseScores: Record<string, number>,
  baseSRD: number,
): ScenarioResult[] {
  return SCENARIOS_PRESETS
    .map(sc => applyScenario(baseScores, baseSRD, sc))
    .sort((a, b) => b.roi_score - a.roi_score);
}

/**
 * Retourne les 3 scénarios les plus impactants (hors négatifs).
 */
export function getTopRecommendations(
  baseScores: Record<string, number>,
  baseSRD: number,
): ScenarioResult[] {
  return simulateAll(baseScores, baseSRD)
    .filter(r => r.scenario.category !== 'negative' && r.delta_irocr > 0)
    .slice(0, 3);
}
