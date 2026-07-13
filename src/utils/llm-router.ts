/**
 * src/utils/llm-router.ts — Gemini-only (AI Studio)
 *
 * Version simplifiée pour déploiement AI Studio :
 *   - Gemini uniquement (GEMINI_API_KEY injectée automatiquement par AI Studio)
 *   - Clé cherchée dans tous les emplacements possibles
 *   - Côté client : appel via proxy Express /api/llm
 *   - Côté serveur : appel direct @google/genai
 *   - Interfaces préservées pour compatibilité avec les imports existants
 */

import { extractJSON } from './json-utils';
import { logger } from './logger';
import { enqueueRequest } from './llm-queue';
import { getCircuitBreaker } from './circuit-breaker';
import { recordLLMCall } from './llm-metrics';

// ── Types publics (interfaces préservées) ─────────────────────────────────────

export type LLMProvider = 'Gemini' | 'Claude' | 'Mistral';

export interface LLMRouterResult {
  response:          string;
  providerUsed:      LLMProvider;
  fallbackTriggered: boolean;
  latencyMs:         number;
}

export interface LLMRouterJSONResult<T> {
  data:              T;
  rawResponse:       string;
  providerUsed:      LLMProvider;
  fallbackTriggered: boolean;
  latencyMs:         number;
}

export interface LLMCallOptions {
  timeoutMs?:     number;
  modelId?:       string;
  forceProvider?: LLMProvider;
  maxRetries?:    number;
  tools?:         unknown[];
}

// ── Interfaces & Clients de Fournisseurs LLM (getLLMClient) ──────────────────

export interface LLMClient {
  generate(prompt: string, sPrompt: string, opts?: LLMCallOptions): Promise<string>;
}

export class GeminiProvider implements LLMClient {
  async generate(prompt: string, sPrompt: string, opts: LLMCallOptions = {}): Promise<string> {
    const rawModelId = opts.modelId ?? 'gemini-3.5-flash';
    const modelId = mapToGeminiModel(rawModelId);
    const timeout = opts.timeoutMs ?? 30_000;
    return callGeminiDirect(prompt, sPrompt, modelId, timeout, opts.tools);
  }
}

export class ClaudeProvider implements LLMClient {
  async generate(prompt: string, sPrompt: string, opts: LLMCallOptions = {}): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) {
      throw new Error('Support Claude inactif : ANTHROPIC_API_KEY manquante');
    }

    const modelId = opts.modelId ?? 'claude-3-5-sonnet-20241022';
    const timeout = opts.timeoutMs ?? 30_000;
    
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
          system: sPrompt || undefined,
          temperature: 0.1,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`Erreur API Claude (${res.status}): ${errorBody}`);
      }

      const data = await res.json() as any;
      const text = data.content?.[0]?.text;
      if (!text) {
        throw new Error('Réponse Claude vide ou malformée');
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class MistralProvider implements LLMClient {
  async generate(prompt: string, sPrompt: string, opts: LLMCallOptions = {}): Promise<string> {
    const apiKey = process.env.MISTRAL_API_KEY || '';
    if (!apiKey) {
      throw new Error('Support Mistral inactif : MISTRAL_API_KEY manquante');
    }

    const modelId = opts.modelId ?? 'mistral-large-latest';
    const timeout = opts.timeoutMs ?? 30_000;
    
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            ...(sPrompt ? [{ role: 'system', content: sPrompt }] : []),
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`Erreur API Mistral (${res.status}): ${errorBody}`);
      }

      const data = await res.json() as any;
      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('Réponse Mistral vide ou malformée');
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function getLLMClient(provider: LLMProvider) {
  switch (provider) {
    case 'Gemini':
      return new GeminiProvider();
    case 'Claude':
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('Support Claude inactif : ANTHROPIC_API_KEY manquante');
      }
      return new ClaudeProvider();
    case 'Mistral':
      if (!process.env.MISTRAL_API_KEY) {
        throw new Error('Support Mistral inactif : MISTRAL_API_KEY manquante');
      }
      return new MistralProvider();
    default:
      throw new Error(`Fournisseur non implémenté : ${provider}`);
  }
}

// ── Résolution de la clé Gemini ───────────────────────────────────────────────
// AI Studio injecte GEMINI_API_KEY dans process.env automatiquement.

export function mapToGeminiModel(modelId?: string): string {
  const lower = (modelId || '').toLowerCase().trim();
  if (!lower) {
    return 'gemini-3.5-flash';
  }

  // Handle prohibited / unsupported / deprecated models explicitly first
  if (
    lower.includes('1.5-flash') ||
    lower.includes('2.0-flash') ||
    lower.includes('2.5-flash-preview') ||
    lower.includes('2.5-flash-preview-05-20')
  ) {
    return 'gemini-3.5-flash';
  }

  if (
    lower.includes('1.5-pro') ||
    lower.includes('2.0-pro') ||
    lower.includes('2.0-flash-thinking') ||
    lower.includes('gemini-pro')
  ) {
    return 'gemini-3.1-pro-preview';
  }

  // If it's a known valid Gemini, Imagen, Veo, or Lyria model, keep it as is
  if (
    lower.startsWith('gemini-3.5-flash') ||
    lower.startsWith('gemini-3-flash-preview') ||
    lower.startsWith('gemini-3.1-flash-lite') ||
    lower.startsWith('gemini-3.1-pro-preview') ||
    lower.startsWith('imagen-') ||
    lower.startsWith('veo-') ||
    lower.startsWith('lyria-') ||
    lower === 'gemini-flash-latest'
  ) {
    return modelId!;
  }

  // If it's a generic gemini but we didn't match the specific ones above, keep it as is
  if (lower.startsWith('gemini-')) {
    return modelId!;
  }

  // Map typical pro/large premium models to gemini-3.1-pro-preview
  if (
    lower.includes('claude') || 
    lower.includes('gpt-4') || 
    lower.includes('gpt4') || 
    lower.includes('large') || 
    lower.includes('pro')
  ) {
    return 'gemini-3.1-pro-preview';
  }

  // Default fallback for any other non-Gemini model
  return 'gemini-3.5-flash';
}

function resolveGeminiKey(): string {
  // En priorité, on cherche dans process.env (injecté par AI Studio au runtime ou serveur)
  if (typeof process !== 'undefined' && process.env) {
    const k = (process.env.GEMINI_API_KEY || '').trim();
    if (k && k.length > 5) return k;
  }
  return '';
}

function isServer(): boolean {
  return typeof window === 'undefined' && typeof process !== 'undefined';
}

// ── Appel Gemini direct (côté serveur) ───────────────────────────────────────

async function callGeminiDirect(
  prompt: string,
  system: string,
  modelId: string,
  timeoutMs: number,
  tools?: unknown[],
  retry = 0,
): Promise<string> {
  const apiKey = resolveGeminiKey();

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY est manquante. ' +
      'Veuillez cliquer sur "Settings" (en haut à droite dans AI Studio), puis ajouter le secret GEMINI_API_KEY.'
    );
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs + 3000);

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        systemInstruction: system || undefined,
        temperature:       0.1,
        maxOutputTokens:   4096,
        ...(tools && tools.length > 0 ? { tools: tools as any } : {}),
      },
    });

    const text = response.text;
    if (!text) throw new Error('Réponse Gemini vide');
    return text;

  } catch (err) {
    const msg = String(err);
    const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('temporary') || msg.includes('high demand') || msg.includes('overloaded') || msg.includes('Service Unavailable');

    // If we hit a rate limit/quota error, try model rotation to ensure high availability
    if (isRateLimit) {
      if (modelId.includes('pro') || modelId.includes('imagen') || modelId.includes('veo') || modelId.includes('lyria')) {
        const fallbackModel = 'gemini-3.5-flash';
        logger.warn(`[LLMRouter] Graceful downgrade: active quota limit on ${modelId}. Switching to high-availability ${fallbackModel}.`);
        return callGeminiDirect(prompt, system, fallbackModel, timeoutMs, tools, retry);
      } else if (modelId === 'gemini-3.5-flash' && retry < 3) {
        const fallbackModel = 'gemini-3-flash-preview';
        logger.warn(`[LLMRouter] Active quota limit on ${modelId}. Switching to alternative high-availability ${fallbackModel}.`);
        return callGeminiDirect(prompt, system, fallbackModel, timeoutMs, tools, retry + 1);
      } else if (modelId === 'gemini-3-flash-preview' && retry < 3) {
        const fallbackModel = 'gemini-3.1-flash-lite';
        logger.warn(`[LLMRouter] Active quota limit on ${modelId}. Switching to alternative high-availability gemini-3.1-flash-lite.`);
        return callGeminiDirect(prompt, system, fallbackModel, timeoutMs, tools, retry + 1);
      }
    }

    if (isRateLimit && retry < 3) {
      const wait = Math.pow(2, retry) * 2000;
      logger.warn(`[LLMRouter] Rate limit on ${modelId} — retry ${retry + 1}/3 dans ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      return callGeminiDirect(prompt, system, modelId, timeoutMs, tools, retry + 1);
    }

    if (msg.includes('401') || msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED')) {
      throw new Error(
        `Clé Gemini invalide (401). ` +
        `Clé lue : "${apiKey.slice(0, 6)}...${apiKey.slice(-4)}". ` +
        `Sous AI Studio : régénérez la clé dans les paramètres du projet.`
      );
    }

    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// IRO: Retry avec backoff exponentiel sur 429
async function callWithRetry(
  fn: () => Promise<Response>,
  maxRetries = 3,
  baseDelayMs = 3000
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fn();
    if (res.status !== 429) return res;

    const delay = baseDelayMs * Math.pow(2, attempt); // 60s, 120s, 240s
    logger.info(`[IRO:llm-router] 429 reçu — attente ${delay / 1000}s (tentative ${attempt + 1}/${maxRetries})`);
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error('Proxy Gemini 429 — quota épuisé après 3 tentatives');
}

// ── Appel via proxy Express (côté client browser) ────────────────────────────

async function callViaProxy(
  prompt: string,
  system: string,
  modelId: string,
  timeoutMs: number,
  tools?: unknown[],
): Promise<string> {
  const fetchWithTimeout = async () => {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch('/api/llm', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt, system, provider: 'Gemini', modelId, tools }),
        signal:  ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const res = await callWithRetry(fetchWithTimeout);

  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    const preview = (await res.text()).slice(0, 120);
    throw new Error(
      `Le proxy /api/llm a retourné du HTML (${res.status}). ` +
      `Vérifiez que server.ts utilise appType:'custom'. Aperçu: ${preview}`
    );
  }

  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(`Proxy Gemini ${res.status}: ${e.message ?? e.error ?? res.statusText}`);
  }

  const d = await res.json() as { text?: string; response?: string };
  return d.text ?? d.response ?? '';
}

// ── API publique ──────────────────────────────────────────────────────────────

export async function callLLMWithRouter(
  prompt: string,
  systemPrompt: string,
  options: LLMCallOptions = {},
): Promise<LLMRouterResult> {
  const timeout = options.timeoutMs ?? 30_000;
  const rawModelId = options.modelId  ?? 'gemini-3.5-flash';
  const modelId = mapToGeminiModel(rawModelId);
  const maxRetries = options.maxRetries ?? 1; // 1 retry on failure = 2 attempts total
  const t0      = Date.now();

  const providers: LLMProvider[] = options.forceProvider
    ? [options.forceProvider]
    : ['Gemini', 'Claude', 'Mistral'];

  let lastError: Error | null = null;
  let fallbackCount = 0;

  for (const provider of providers) {
    const cb = getCircuitBreaker(provider);

    if (!cb.canAttempt()) {
      logger.warn(`[LLMRouter] ${provider} circuit OPEN — skip`);
      fallbackCount++;
      continue;
    }

    const attempts = maxRetries + 1;
    let providerSucceeded = false;
    const t_provider = Date.now();

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        let response = '';
        const runCall = async () => {
          if (isServer()) {
            let client: any = null;
            try {
              client = getLLMClient(provider);
            } catch {
              // Pas de clé ou non implémenté. Fallback Gemini direct.
            }

            if (client) {
              logger.info(`[LLMRouter] Serveur - execution via ${provider} client (tentative ${attempt})`);
              return await client.generate(prompt, systemPrompt, { ...options, modelId, timeoutMs: timeout });
            } else {
              // Fallback direct sur le SDK Gemini si le provider n'a pas de clé disponible ou n'est pas implémenté
              const apiKey = resolveGeminiKey();
              if (apiKey) {
                logger.info(`[LLMRouter] Gemini direct SDK fallback (${modelId}) - provider: ${provider} - tent. ${attempt}`);
                return await callGeminiDirect(prompt, systemPrompt, modelId, timeout, options.tools);
              } else {
                throw new Error('La clé GEMINI_API_KEY est manquante. Veuillez configurer le secret.');
              }
            }
          } else {
            // Côté client : appel via le proxy Express
            logger.info(`[LLMRouter] Gemini via proxy /api/llm (fallback) (${modelId}) - provider: ${provider} - tent. ${attempt}`);
            return await callViaProxy(prompt, systemPrompt, modelId, timeout, options.tools);
          }
        };

        response = await enqueueRequest(provider, runCall);

        cb.recordSuccess();
        const latencyMs = Date.now() - t_provider;
        recordLLMCall({ provider, latencyMs, success: true });
        logger.info(`[LLMRouter] ${provider} OK (${latencyMs}ms)`);
        return { response, providerUsed: provider, fallbackTriggered: fallbackCount > 0, latencyMs: Date.now() - t0 };
      } catch (err: any) {
        lastError = err;
        logger.error(`[LLMRouter] Echec ${provider} tent. ${attempt}/${attempts}`, { error: err.message || String(err) });
        if (err.message && err.message.includes('GEMINI_API_KEY est manquante')) {
          throw err;
        }
      }
    }

    cb.recordFailure();
    const latencyErrorMs = Date.now() - t_provider;
    recordLLMCall({ provider, latencyMs: latencyErrorMs, success: false });
    fallbackCount++;
  }

  throw new Error(`Tous les providers LLM ont échoué. Dernier échec : ${lastError?.message || 'Inconnu'}`);
}

export async function callLLMAndParseJSON<T>(
  prompt: string,
  systemPrompt: string,
  options: LLMCallOptions = {},
): Promise<LLMRouterJSONResult<T>> {
  const result = await callLLMWithRouter(prompt, systemPrompt, options);

  try {
    const data = extractJSON(result.response) as T;
    return {
      data,
      rawResponse:       result.response,
      providerUsed:      result.providerUsed,
      fallbackTriggered: result.fallbackTriggered,
      latencyMs:         result.latencyMs,
    };
  } catch (err) {
    logger.error('[LLMRouter] Parsing JSON échoué', { error: String(err) });
    throw new Error(`Réponse Gemini non-JSON : ${result.response.slice(0, 200)}`);
  }
}

export async function callLLMParallelPasses(
  prompt: string,
  systemPrompt: string,
  passes = 3,
  options: LLMCallOptions = {},
): Promise<string[]> {
  logger.info(`[LLMRouter] REV20 — ${passes} passes Gemini`);

  const results = await Promise.allSettled(
    Array.from({ length: passes }, (_, idx) =>
      new Promise<string>((resolve, reject) => {
        setTimeout(() => {
          callLLMWithRouter(prompt, systemPrompt, {
            ...options,
            modelId: options.modelId ?? 'gemini-3.5-flash',
          })
            .then(r => resolve(r.response))
            .catch(reject);
        }, idx * 800);
      })
    )
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    logger.warn(`[LLMRouter] Passe REV20 ${i + 1} échouée : ${r.reason}`);
    throw new Error(`Passe REV20 ${i + 1} échouée`);
  });
}
