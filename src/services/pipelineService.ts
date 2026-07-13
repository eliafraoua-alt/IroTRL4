/**
 * src/services/pipelineService.ts
 * Bridge between UI and Python Real-World Data Pipeline
 */

export interface PipelineParams {
  startup: string;
  sector?: string;
  vertical?: string;
  github?: string;
  linkedin?: string;
  crunchbase?: string;
  status?: 'active' | 'failed' | 'unknown';
}

export interface CalibrationResult {
  date: string;
  n_startups: number;
  beta_velocity: number;
  ci_lo: number;
  ci_hi: number;
  harrell_c: number;
  h5_confirmed: boolean;
  calibrated?: boolean;
}

export const pipelineService = {
  async runAnalysis(params: PipelineParams) {
    const res = await fetch('/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async calibrate() {
    const res = await fetch('/api/pipeline/calibrate', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getConfig(): Promise<CalibrationResult | null> {
    const res = await fetch('/api/pipeline/config');
    if (!res.ok) return null;
    return res.json();
  }
};
