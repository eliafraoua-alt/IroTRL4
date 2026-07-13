/**
 * src/utils/competing-risks.ts
 * IROSTRENGTH v7.0 — Correctif 3 : DeepHit Competing Risks
 *
 * Référence : Lee, Zame, Yoon & van der Schaar (AAAI 2018)
 *             "DeepHit: A Deep Learning Approach to Survival Analysis
 *              with Competing Risks"
 *
 * Ce module délègue désormais la prédiction à l'implémentation DeepHit
 * (deephit-competing-risks.ts) qui remplace l'hypothèse restrictive de Fine-Gray.
 */

import { CompetingRisksInput, CompetingRisksResult } from '../types/iro';
import { computeCompetingRisksDeepHit } from './deephit-competing-risks';

/**
 * Calcul des risques compétitifs basé sur un modèle DeepHit simplifié.
 * Permet d'intégrer la PMF discrète et d'éviter les hypothèses de proportionnalité
 * non vérifiables sur une cohorte de taille intermédiaire (n=125).
 */
export function computeCompetingRisks(input: CompetingRisksInput): CompetingRisksResult {
  return computeCompetingRisksDeepHit(input);
}
