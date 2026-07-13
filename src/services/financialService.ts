/**
 * Financial Service 
 * Collecte financement via Gemini web search (Frontend-side)
 *
 * Corrections v1.1 :
 *   - LLMStack et FinancialData supprimés d'ici (étaient dupliqués).
 *   - Importés depuis src/types/iro.ts — source de vérité unique.
 */

import { callLLMAndParseJSON } from '../utils/llm-router';
import { logger } from '../utils/logger';
import type { FinancialData } from '../types/iro';

const EMPTY_FINANCIAL_DATA: FinancialData = {
  funding_total_eur:    null,
  funding_stage:        null,
  founded_year:         null,
  investors:            [],
  last_round_date:      null,
  valuation_eur:        null,
  statut_juridique:     null,
  source_confidence:    'low',
  employee_count:       null,
  employee_growth:      null,
  talent_density_proxy: null,
  hiring_news:          [],
  llm_stack:            null,
};

export async function fetchFinancialData(
  companyName: string
): Promise<FinancialData> {
  try {
    const response = await callLLMAndParseJSON<FinancialData>(
      `Recherche les données financières, juridiques, RH et la stack technique LLM de la startup "${companyName}".

SOURCES OBLIGATOIRES À CONSULTER DANS CET ORDRE :
1. Site officiel de la startup — page "Technology", "How it works", ou blog technique
2. GitHub de la startup (si public) — README, package.json, requirements.txt
3. LinkedIn de la startup — description produit, offres d'emploi tech (indice du stack)
4. Crunchbase/Dealroom — financement, investisseurs
5. Presse tech (TechCrunch, The Batch, Le Monde Informatique) — mentions du stack

RÈGLES CRITIQUES POUR LLM STACK :
- NE PAS inventer de modèles. Si la startup ne mentionne pas explicitement ses LLM, écrire models:[]
- Une offre d'emploi "ML Engineer experienced with fine-tuning" → integration_level="Fine-tuned"
- Une page "Powered by OpenAI" sans autre mention → integration_level="API", models:["GPT-4"]
- "Built on open-source models" sans précision → models:["Open-source (non précisé)"]
- Si le site dit "proprietary AI model" ou "our own model" → integration_level="Self-hosted"
- Croiser avec les job descriptions LinkedIn : "training large models" → "Self-hosted"

Retourne UNIQUEMENT ce JSON sans texte autour :
{
  "funding_total_eur": null,
  "funding_stage": "",
  "founded_year": null,
  "investors": [],
  "last_round_date": null,
  "valuation_eur": null,
  "statut_juridique": null,
  "source_confidence": "low",
  "employee_count": null,
  "employee_growth": "",
  "talent_density_proxy": "",
  "hiring_news": [],
  "llm_stack": {
    "models": [],
    "frameworks": [],
    "integration_level": "API",
    "evidence": "",
    "confidence": "low"
  }
}

CHAMPS :
- llm_stack.evidence : phrase courte expliquant la source de la détection (ex: "Site officiel mentionne GPT-4o")
- llm_stack.confidence : "high" si source directe officielle, "medium" si presse/LinkedIn, "low" si inféré
- source_confidence : "high" si Crunchbase/Dealroom directs, "medium" si presse, "low" si inconnu`,
      "Tu es un analyste financier et technologique expert en startups IA.",
      { tools: [{ googleSearch: {} }] }
    );

    return { ...EMPTY_FINANCIAL_DATA, ...response.data };

  } catch (error) {
    logger.error(`[financialService] Erreur (${companyName})`, { error: String(error) });
    return EMPTY_FINANCIAL_DATA;
  }
}
