/**
 * src/utils/pilot-telemetry.ts
 * Pilot Telemetry for value tracking at pilot clients (G1).
 */

export interface PilotSession {
  session_id:        string;
  pilot_client:      string;
  analyst_id:        string;    // anonymisé
  startup_id:        string;
  started_at:        string;
  completed_at:      string | null;
  duration_minutes:  number | null;
  iro_score_used:    boolean;
  analyst_agreed:    boolean | null;    // accord analyste/IRO
  time_saved_est_h:  number | null;     // déclaré par l'analyste
  adopted_in_committee: boolean | null;
}

export function computePilotMetrics(sessions: PilotSession[]) {
  const completed = sessions.filter(s => s.completed_at !== null);
  const avgDuration = completed.reduce((s, v) => s + (v.duration_minutes ?? 0), 0)
    / Math.max(completed.length, 1);
  const adoptionRate = completed.filter(s => s.adopted_in_committee).length
    / Math.max(completed.length, 1);
  const agreementRate = completed.filter(s => s.analyst_agreed).length
    / Math.max(completed.length, 1);
  const totalTimeSaved = completed.reduce((s, v) => s + (v.time_saved_est_h ?? 0), 0);

  return {
    n_sessions:      sessions.length,
    n_completed:     completed.length,
    avg_duration_min: Math.round(avgDuration),
    adoption_rate:   Math.round(adoptionRate * 100) / 100,
    agreement_rate:  Math.round(agreementRate * 100) / 100,
    total_time_saved_h: Math.round(totalTimeSaved),
    avg_time_saved_h_per_session: Math.round(totalTimeSaved / Math.max(completed.length, 1) * 10) / 10,
  };
}

// Exposer llm-metrics.ts en dashboard (existe déjà, brancher dans l'UI)
export const LLM_METRICS_DASHBOARD_ENDPOINT = '/api/metrics/llm';
