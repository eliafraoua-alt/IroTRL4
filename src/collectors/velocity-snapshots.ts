/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FICHIER 4 — src/collectors/velocity-snapshots.ts (NOUVEAU)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Collecte automatique de snapshots multi-temporels pour alimenter
 * computeIROVelocity() et calibrer β_velocity.
 *
 * Sources :
 *   - GitHub : commit frequency → proxy DI velocity
 *   - LinkedIn : employee growth → proxy CA/GCH velocity
 *   - Crunchbase : nouveaux rounds → proxy funding_stage evolution
 *   - Gemini : re-scoring IRO automatique avec date
 */

export interface VelocitySnapshotRaw {
  startup_name:     string;
  timestamp:        string;       // ISO date de la collecte
  iro_total:        number;
  iro_cr:           number;
  DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number;
  ipc_conf:  number;
  adc_conf:  number;
  gch_conf:  number;
  source_type:      'gemini_rescore' | 'github_proxy' | 'manual';
  github_commits_delta?: number;  // commits depuis le dernier snapshot
  employee_growth?:      number;  // % croissance employés
  new_funding?:          boolean; // nouveau round depuis le dernier snapshot
}

// Convertit un résultat Gemini IRO en VelocitySnapshotRaw
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseGeminiToSnapshot(
  geminiResult: any,
  startupName: string,
  computedIRO: number,
  computedIROCR: number
): VelocitySnapshotRaw {
  const dims = (geminiResult.dimensions ?? {}) as Record<string, { score: number; confiance: number }>;

  return {
    startup_name: startupName,
    timestamp:    new Date().toISOString(),
    iro_total:    computedIRO,
    iro_cr:       computedIROCR,
    DI:           dims.DI?.score   ?? 0,
    ADC:          dims.ADC?.score  ?? 0,
    IPC:          dims.IPC?.score  ?? 0,
    AR:           dims.AR?.score   ?? 0,
    CA:           dims.CA?.score   ?? 0,
    GCH:          dims.GCH?.score  ?? 0,
    ipc_conf:     dims.IPC?.confiance ?? 0.5,
    adc_conf:     dims.ADC?.confiance ?? 0.5,
    gch_conf:     dims.GCH?.confiance ?? 0.5,
    source_type:  'gemini_rescore',
  };
}

// Proxy velocity depuis GitHub (via Proxy SEC-01) → DI signal
export async function computeGitHubVelocityProxy(
  owner: string,
  repo: string,
  since: string  // ISO date du dernier snapshot
): Promise<{ commits_delta: number; di_velocity_signal: 'improving' | 'stable' | 'declining' }> {
  try {
    const res = await fetch(
      `/api/github/${owner}/${repo}/commits?since=${since}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return { commits_delta: 0, di_velocity_signal: 'stable' };
    const commits = await res.json();
    const count = Array.isArray(commits) ? commits.length : 0;

    return {
      commits_delta:        count,
      di_velocity_signal:   count > 50 ? 'improving' : count > 10 ? 'stable' : 'declining',
    };
  } catch {
    return { commits_delta: 0, di_velocity_signal: 'stable' };
  }
}
