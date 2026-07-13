/**
 * src/utils/llm-queue.ts
 * File d'attente centralisée LLM — budget tokens/min par provider
 * Correctif B6 — 5 analyses simultanées sans quota 429
 */

interface QueuedRequest {
  id:       string;
  provider: string;
  fn:       () => Promise<any>;
  resolve:  (v: any) => void;
  reject:   (e: any) => void;
  enqueuedAt: number;
}

interface ProviderBudget {
  rpm:         number;   // requêtes par minute max
  calls:       number;   // appels dans la fenêtre courante
  windowStart: number;   // début de la fenêtre (ms)
}

const PROVIDER_BUDGETS: Record<string, ProviderBudget> = {
  Gemini:  { rpm: 14, calls: 0, windowStart: Date.now() },  // 15 req/min → marge 1
  Claude:  { rpm: 50, calls: 0, windowStart: Date.now() },
  Mistral: { rpm: 60, calls: 0, windowStart: Date.now() },
};

const queue: QueuedRequest[] = [];
let processing = false;

function resetWindowIfNeeded(budget: ProviderBudget) {
  const now = Date.now();
  if (now - budget.windowStart >= 60_000) {
    budget.calls = 0;
    budget.windowStart = now;
  }
}

function canCall(provider: string): boolean {
  const budget = PROVIDER_BUDGETS[provider] ?? PROVIDER_BUDGETS['Gemini'];
  resetWindowIfNeeded(budget);
  return budget.calls < budget.rpm;
}

function recordCall(provider: string) {
  const budget = PROVIDER_BUDGETS[provider] ?? PROVIDER_BUDGETS['Gemini'];
  budget.calls++;
}

async function waitUntilAvailable(provider: string): Promise<void> {
  while (!canCall(provider)) {
    const budget = PROVIDER_BUDGETS[provider] ?? PROVIDER_BUDGETS['Gemini'];
    const remaining = 60_000 - (Date.now() - budget.windowStart);
    await new Promise(r => setTimeout(r, Math.max(remaining + 100, 500)));
    resetWindowIfNeeded(budget);
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const req = queue.shift()!;
    try {
      await waitUntilAvailable(req.provider);
      recordCall(req.provider);
      const result = await req.fn();
      req.resolve(result);
    } catch (err) {
      // Backoff exponentiel sur 429
      const is429 = String(err).includes('429') || String(err).includes('quota');
      if (is429) {
        const budget = PROVIDER_BUDGETS[req.provider] ?? PROVIDER_BUDGETS['Gemini'];
        budget.calls = budget.rpm; // forcer l'attente de la prochaine fenêtre
        queue.unshift(req);        // remettre en tête de file
        await new Promise(r => setTimeout(r, 2000));
      } else {
        req.reject(err);
      }
    }
  }

  processing = false;
}

/**
 * Enfile une requête LLM avec gestion du budget provider.
 * Usage : await enqueueRequest('Gemini', () => callGemini(prompt))
 */
export function enqueueRequest<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push({
      id:         crypto.randomUUID(),
      provider,
      fn,
      resolve,
      reject,
      enqueuedAt: Date.now(),
    });
    processQueue();
  });
}

export function getQueueMetrics() {
  return {
    queue_length: queue.length,
    budgets: Object.fromEntries(
      Object.entries(PROVIDER_BUDGETS).map(([p, b]) => [
        p,
        { calls_in_window: b.calls, rpm_limit: b.rpm, available: canCall(p) },
      ])
    ),
  };
}
