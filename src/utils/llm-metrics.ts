/**
 * src/utils/llm-metrics.ts
 * IRO Strength v6.6.2 — CORRECTIF OPS-02 (nouveau fichier)
 *
 * Enregistre latence, taux d'échec et percentiles p50/p95/p99
 * par provider LLM. Rolling window de 1000 appels.
 * Exposé via GET /api/metrics (server.ts).
 */

import { logger } from './logger';

export type LLMProvider = 'Gemini' | 'Claude' | 'Mistral';

// ── B3 : Tracking tokens + coût d'inférence ──────────────────────────────────
// Tarifs mai 2026 — gemini-3.5-flash (à jour)
const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'gemini-3.5-flash':         { inputPer1M: 1.50, outputPer1M: 9.00 },
  'gemini-3-flash-preview':   { inputPer1M: 1.50, outputPer1M: 9.00 },
  'gemini-3.1-flash-lite':    { inputPer1M: 0.30, outputPer1M: 1.20 },
  'gemini-2.5-pro-preview':   { inputPer1M: 7.00, outputPer1M: 21.00 },
  'claude-3-5-sonnet-20241022': { inputPer1M: 3.00, outputPer1M: 15.00 },
};

export function estimateCostUSD(
  modelId: string,
  promptTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[modelId] ?? { inputPer1M: 1.50, outputPer1M: 9.00 };
  return (promptTokens / 1_000_000) * pricing.inputPer1M
       + (outputTokens / 1_000_000) * pricing.outputPer1M;
}

export interface LLMCallRecord {
  provider:      LLMProvider;
  latencyMs:     number;
  success:       boolean;
  timestamp?:    number;
  // B3 : champs tokens + coût (optionnels pour rétrocompatibilité)
  modelId?:      string;
  promptTokens?: number;
  outputTokens?: number;
  costUSD?:      number;
  promptId?:     string; // B1 : identifiant du prompt utilisé
}

interface Stats {
  calls:            number;
  failures:         number;
  totalMs:          number;
  latencies:        number[];  // rolling 1000
  p50:              number;
  p95:              number;
  p99:              number;
  lastFailAt:       number | null;
  // B3 : agrégats tokens + coût
  totalPromptTokens:  number;
  totalOutputTokens:  number;
  totalCostUSD:       number;
}

function mkStats(): Stats {
  return {
    calls: 0, failures: 0, totalMs: 0, latencies: [],
    p50: 0, p95: 0, p99: 0, lastFailAt: null,
    totalPromptTokens: 0, totalOutputTokens: 0, totalCostUSD: 0,
  };
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(i, sorted.length - 1))];
}

const store = new Map<LLMProvider, Stats>([
  ['Gemini',  mkStats()],
  ['Claude',  mkStats()],
  ['Mistral', mkStats()],
]);

export function recordLLMCall(r: LLMCallRecord): void {
  const s = store.get(r.provider);
  if (!s) return;
  s.calls++;
  s.totalMs += r.latencyMs;
  if (!r.success) {
    s.failures++;
    s.lastFailAt = r.timestamp ?? Date.now();
  }

  s.latencies.push(r.latencyMs);
  if (s.latencies.length > 1000) s.latencies.shift();

  const sorted = [...s.latencies].sort((a, b) => a - b);
  s.p50 = pct(sorted, 50);
  s.p95 = pct(sorted, 95);
  s.p99 = pct(sorted, 99);

  // B3 : agrégation tokens + coût
  if (r.promptTokens  != null) s.totalPromptTokens  += r.promptTokens;
  if (r.outputTokens  != null) s.totalOutputTokens  += r.outputTokens;
  if (r.costUSD       != null) s.totalCostUSD       += r.costUSD;
  else if (r.modelId && r.promptTokens != null && r.outputTokens != null) {
    s.totalCostUSD += estimateCostUSD(r.modelId, r.promptTokens, r.outputTokens);
  }

  // Log LLMOps structuré — visible dans les logs Cloud Logging / pino
  logger.info(JSON.stringify({
    level: 'info',
    event: 'llm_call',
    provider: r.provider,
    modelId: r.modelId ?? 'unknown',
    success: r.success,
    latencyMs: r.latencyMs,
    promptTokens: r.promptTokens ?? null,
    outputTokens: r.outputTokens ?? null,
    costUSD: r.costUSD != null
      ? r.costUSD
      : (r.modelId && r.promptTokens != null && r.outputTokens != null
          ? estimateCostUSD(r.modelId, r.promptTokens, r.outputTokens)
          : null),
    promptId: r.promptId ?? null,
    timestamp: new Date(r.timestamp ?? Date.now()).toISOString(),
  }));
}

export function getMetrics(): Record<string, object> {
  const out: Record<string, object> = {};
  for (const [p, s] of store.entries()) {
    const totalTokens = s.totalPromptTokens + s.totalOutputTokens;
    out[p] = {
      calls:              s.calls,
      failures:           s.failures,
      successRate:        s.calls > 0 ? `${((s.calls - s.failures) / s.calls * 100).toFixed(1)}%` : 'N/A',
      avgMs:              s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0,
      p50Ms:              s.p50,
      p95Ms:              s.p95,
      p99Ms:              s.p99,
      lastFailAt:         s.lastFailAt ? new Date(s.lastFailAt).toISOString() : null,
      // B3 : métriques tokens + coût
      totalPromptTokens:  s.totalPromptTokens,
      totalOutputTokens:  s.totalOutputTokens,
      totalTokens,
      totalCostUSD:       Math.round(s.totalCostUSD * 100000) / 100000,
      avgCostPerCallUSD:  s.calls > 0 ? Math.round((s.totalCostUSD / s.calls) * 100000) / 100000 : 0,
      avgTokensPerCall:   s.calls > 0 ? Math.round(totalTokens / s.calls) : 0,
    };
  }

  // Totaux session toutes providers confondus
  const allStats = [...store.values()];
  const sessionTotalCost = allStats.reduce((a, s) => a + s.totalCostUSD, 0);
  const sessionTotalTokens = allStats.reduce((a, s) => a + s.totalPromptTokens + s.totalOutputTokens, 0);
  out['_session'] = {
    totalCostUSD:    Math.round(sessionTotalCost * 100000) / 100000,
    totalTokens:     sessionTotalTokens,
    totalCalls:      allStats.reduce((a, s) => a + s.calls, 0),
    totalFailures:   allStats.reduce((a, s) => a + s.failures, 0),
    // Projection batch : coût estimé pour 500 startups × moyenne actuelle
    batchCost500Estimate: allStats.reduce((a, s) => a + s.calls, 0) > 0
      ? `$${(Math.round((sessionTotalCost / allStats.reduce((a, s) => a + s.calls, 0)) * 500 * 100) / 100).toFixed(2)}`
      : 'N/A (aucun appel effectué)',
  };

  return out;
}

export function getPrometheusMetrics(): string {
  const lines = ['# IRO Strength LLM Metrics'];
  for (const [p, s] of store.entries()) {
    const lbl = `provider="${p}"`;
    lines.push(`iro_llm_calls_total{${lbl}} ${s.calls}`);
    lines.push(`iro_llm_failures_total{${lbl}} ${s.failures}`);
    lines.push(`iro_llm_p50_ms{${lbl}} ${s.p50}`);
    lines.push(`iro_llm_p95_ms{${lbl}} ${s.p95}`);
    lines.push(`iro_llm_p99_ms{${lbl}} ${s.p99}`);
    // B3
    lines.push(`iro_llm_prompt_tokens_total{${lbl}} ${s.totalPromptTokens}`);
    lines.push(`iro_llm_output_tokens_total{${lbl}} ${s.totalOutputTokens}`);
    lines.push(`iro_llm_cost_usd_total{${lbl}} ${s.totalCostUSD.toFixed(6)}`);
  }
  return lines.join('\n');
}

export function resetMetrics(): void {
  for (const p of store.keys()) store.set(p, mkStats());
}
