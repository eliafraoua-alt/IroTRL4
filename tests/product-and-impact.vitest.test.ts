import { describe, it, expect } from 'vitest';
import { computePilotMetrics, PilotSession } from '../src/utils/pilot-telemetry';
import { checkFSFActivation } from '../src/utils/fsf-module';
import { computePatternDrift, PATTERN_VERSION, PATTERNS_HASH } from '../src/utils/goodhart-detector';

describe('G1 — Télémétrie de Valeur des Clients Pilotes', () => {
  it('calcule correctement les statistiques agrégées à partir de sessions pilotes', () => {
    const sessions: PilotSession[] = [
      {
        session_id: 's-001',
        pilot_client: 'BPI France',
        analyst_id: 'anonym-1',
        startup_id: 'gs-001',
        started_at: '2026-06-10T10:00:00Z',
        completed_at: '2026-06-10T10:15:00Z',
        duration_minutes: 15,
        iro_score_used: true,
        analyst_agreed: true,
        time_saved_est_h: 2.5,
        adopted_in_committee: true,
      },
      {
        session_id: 's-002',
        pilot_client: 'BPI France',
        analyst_id: 'anonym-1',
        startup_id: 'gs-014',
        started_at: '2026-06-10T11:00:00Z',
        completed_at: '2026-06-10T11:25:00Z',
        duration_minutes: 25,
        iro_score_used: true,
        analyst_agreed: false,
        time_saved_est_h: 1.5,
        adopted_in_committee: false,
      },
      {
        session_id: 's-003',
        pilot_client: 'Isai',
        analyst_id: 'anonym-2',
        startup_id: 'gs-096',
        started_at: '2026-06-10T14:00:00Z',
        completed_at: null, // non complétée
        duration_minutes: null,
        iro_score_used: false,
        analyst_agreed: null,
        time_saved_est_h: null,
        adopted_in_committee: null,
      }
    ];

    const metrics = computePilotMetrics(sessions);

    expect(metrics.n_sessions).toBe(3);
    expect(metrics.n_completed).toBe(2);
    expect(metrics.avg_duration_min).toBe(20); // (15 + 25) / 2
    expect(metrics.adoption_rate).toBe(0.5); // 1 active adoption sur 2 complétées
    expect(metrics.agreement_rate).toBe(0.5); // 1 agreement sur 2 complétés
    expect(metrics.total_time_saved_h).toBe(4); // 2.5 + 1.5
    expect(metrics.avg_time_saved_h_per_session).toBe(2); // 4 / 2
  });
});

describe('G3 — Activation de Financial Sustainability Factor (FSF)', () => {
  it('active le FSF si la condition minimale de 2 métriques est remplie', () => {
    const fsf_input = {
      arr_eur: 500000,
      burn_rate_eur: 40000,
    };
    const check = checkFSFActivation(fsf_input);
    expect(check.can_compute).toBe(true);
    expect(check.available_metrics).toContain('arr_eur');
    expect(check.available_metrics).toContain('burn_rate_eur');
    expect(check.activation_note).toContain('FSF calculé');
  });

  it('active le FSF avec 1 seule métrique clé si c\'est ARR ou Runway', () => {
    const fsf_input = {
      arr_eur: 300000,
    };
    const check = checkFSFActivation(fsf_input);
    expect(check.can_compute).toBe(true);
    expect(check.available_metrics).toContain('arr_eur');
    expect(check.activation_note).toContain('FSF calculé');
  });

  it('désactive le FSF si aucune métrique clé n\'est disponible de façon critique', () => {
    const fsf_input = {
      nrr_pct: 12, // non suffisant seul
    };
    const check = checkFSFActivation(fsf_input);
    expect(check.can_compute).toBe(false);
    expect(check.activation_note).toContain('FSF non calculable');
  });
});

describe('G4 — Versionnage et Drift des Patterns Goodhart', () => {
  it('met à disposition les constantes de versionning des patterns', () => {
    expect(PATTERN_VERSION).toBe('goodhart-patterns-v1.1');
    expect(PATTERNS_HASH).not.toBeNull();
  });

  it('signale une alerte de dérive (drift) si le facteur de taux d\'activation > 3', () => {
    // Cas normal : trigg_rate = 0.05, baseline = 0.04 -> pas d'alerte
    const normalDrift = computePatternDrift('adc_sans_ipc', 2, 40, 0.04);
    expect(normalDrift.alert).toBe(false);
    expect(normalDrift.drift_factor).toBe(1.25); // 0.05 / 0.04

    // Cas d'alerte : trigg_rate = 0.15, baseline = 0.03 -> alerte car drift_factor = 5 (> 3)
    const criticalDrift = computePatternDrift('ar_sans_infra', 6, 40, 0.03);
    expect(criticalDrift.alert).toBe(true);
    expect(criticalDrift.drift_factor).toBe(5);
  });
});
