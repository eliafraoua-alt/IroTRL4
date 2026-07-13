/**
 * src/services/aiService.ts
 * IRO Strength v6.6.2 — CORRECTIF LLM-01 (alignement multi-provider)
 *
 * Précédemment : Claude redirigé silencieusement vers Gemini
 *   → "Claude non disponible sous AI Studio — bascule Gemini".
 *   Comportement trompeur : l'appelant croit utiliser Claude.
 *
 * Maintenant : délégation propre au router multi-provider.
 *   Le router choisit le meilleur provider disponible selon
 *   le circuit breaker. Le service ne force plus de redirection.
 */

import { callLLMWithRouter, type LLMProvider } from '../utils/llm-router';
import { logger } from '../utils/logger';

export const LLM_PROVIDERS = {
  gemini:  { primary: 'Gemini'  as LLMProvider, fallback: 'Claude'  as LLMProvider },
  claude:  { primary: 'Claude'  as LLMProvider, fallback: 'Gemini'  as LLMProvider },
  mistral: { primary: 'Mistral' as LLMProvider, fallback: 'Gemini'  as LLMProvider },
} as const;

export interface LLMResponse {
  text:     string;
  provider: string;
  model:    string;
}

export interface LLMOptions {
  systemInstruction?: string;
  temperature?:       number;
  maxOutputTokens?:   number;
  useSearch?:         boolean;
  fallbackModel?:     string;
  modelId?:           string;
  forceProvider?:     LLMProvider;
}

export async function callLLMWithFallback(
  primaryModelId: string,
  prompt: string,
  options: LLMOptions = {},
): Promise<LLMResponse> {
  // Détecter le provider demandé depuis le modelId
  let forceProvider: LLMProvider | undefined = options.forceProvider;
  if (!forceProvider) {
    const id = primaryModelId.toLowerCase();
    if (id.includes('claude'))  forceProvider = 'Claude';
    if (id.includes('mistral')) forceProvider = 'Mistral';
    if (id.includes('gemini'))  forceProvider = 'Gemini';
  }

  try {
    const result = await callLLMWithRouter(
      prompt,
      options.systemInstruction ?? '',
      {
        modelId:       forceProvider === 'Gemini' ? primaryModelId : undefined,
        forceProvider: forceProvider,
        timeoutMs:     30_000,
      }
    );

    return {
      text:     result.response,
      provider: result.providerUsed.toLowerCase(),
      model:    forceProvider === 'Gemini' ? primaryModelId : result.providerUsed.toLowerCase(),
    };
  } catch (e) {
    logger.error('[aiService] Échec tous providers', { error: String(e) });
    throw e;
  }
}
