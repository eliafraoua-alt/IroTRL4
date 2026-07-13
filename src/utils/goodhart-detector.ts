import { analyzeGraphTensions } from './goodhart-graph-reasoning';
import { DimensionScores, GoodhartPattern, GoodhartAlert, GoodhartLog } from '../types/iro';

export const GOODHART_PATTERNS: GoodhartPattern[] = [
  {
    id: 'adc_sans_ipc',
    label: "Données sans usage client",
    description: "ADC=4 suggère des données propriétaires exclusives, mais IPC≤1 indique une intégration client quasi-nulle. Ces données sont-elles réellement exploitées ?",
    detect: s => s.ADC === 4 && (s.IPC ?? 0) <= 1,
    severity: 'warning'
  },
  {
    id: 'ar_sans_infra',
    label: "Conformité sans infrastructure",
    description: "AR≥3 indique une anticipation réglementaire avancée, mais DI=0 révèle une dépendance infra totale. La conformité repose sur un tiers non contrôlé.",
    detect: s => (s.AR ?? 0) >= 3 && (s.DI ?? 0) === 0,
    severity: 'warning'
  },
  {
    id: 'gch_sans_adaptation',
    label: "Équipe star sans agilité",
    description: "GCH=4 signale une équipe d'excellence, mais CA≤1 indique une faible capacité d'adaptation. Les profils brillants ne garantissent pas l'agilité organisationnelle.",
    detect: s => (s.GCH ?? 0) === 4 && (s.CA ?? 0) <= 1,
    severity: 'info'
  },
  {
    id: 'ipc_sans_adc',
    label: "Intégration profonde sans actif data",
    description: "IPC≥3 suggère une intégration dans les processus critiques clients, mais ADC≤1 indique aucun actif de données accumulé. L'intégration ne produit pas de flywheel.",
    detect: s => (s.IPC ?? 0) >= 3 && (s.ADC ?? 0) <= 1,
    severity: 'info'
  },
  {
    id: 'score_parfait',
    label: "Profil trop homogène",
    description: "Toutes les dimensions ≥3. Un profil aussi équilibré est statistiquement rare dans l'univers des startups early-stage. Vérifier la source de chaque score.",
    detect: s => Object.values(s).every(v => v >= 3),
    severity: 'warning'
  },
  {
    id: 'di_sans_adc',
    label: "Infrastructure propriétaire sans données",
    description: "DI=4 indique une infrastructure entièrement propriétaire, mais ADC≤1 suggère aucune donnée exclusive. L'avantage infra sans actif data est difficile à défendre.",
    detect: s => (s.DI ?? 0) === 4 && (s.ADC ?? 0) <= 1,
    severity: 'info'
  },
  {
    id: 'orchestration_sans_actifs',
    label: "Sophistication opérationnelle sans actifs défendables",
    description: "CA≥3 signale une forte capacité d'adaptation et d'orchestration, mais DI≤1 et ADC≤1 indiquent l'absence d'actifs propriétaires sous-jacents. Dans l'ère post-subvention (2026+), une couche d'orchestration sans infrastructure ni données exclusives est imitable en quelques semaines par un concurrent mieux capitalisé.",
    detect: s => (s.CA ?? 0) >= 3 && (s.DI ?? 0) <= 1 && (s.ADC ?? 0) <= 1,
    severity: 'warning'
  },
  {
    id: 'adc_ipc_gap',
    label: "Données sans usage client ancré (REV12)",
    description: "ADC≥3 suggère un actif de données potentiellement fort, mais IPC≤1 indique une intégration client quasi-nulle et LU≤1 confirme l'absence de lead user ancré (von Hippel 1986). Ces données ne produisent pas de flywheel défendable : elles sont accumulées sans être irréplicables. Pattern observé sur 8 FP persistants de la cohorte n=87 (Meero, Tinyclues, Sendinblue IA, Algolia AI Search, Malt IA unit…). Le moteur applique automatiquement un malus REV12 de −5 pts.",
    detect: s => (s.ADC ?? 0) >= 3 && (s.IPC ?? 0) <= 1 && (s.LU ?? 0) <= 1,
    severity: 'warning'
  }
];

export function detectGoodharting(scores: DimensionScores): GoodhartAlert {
  const triggered = GOODHART_PATTERNS.filter(p => p.detect(scores));

  if (triggered.length < 2) {
    return { triggered: false, patterns: [], recommendation: '' };
  }

  // ── Analyse graphique des tensions (correctif 4) ─────────────────────
  const graphResult = analyzeGraphTensions(scores);
  const graphTensions = graphResult.tensions
    .filter(t => t.severity === 'critical' || t.severity === 'warning')
    .map(t => t.label)
    .join(', ');

  const rec = triggered.length >= 2
    ? `${triggered.length} pattern(s) atypique(s) détecté(s).`
    : `${graphResult.critical_count} tension(s) critique(s) dans le graphe IRO.`;

  return {
    triggered: true,
    patterns: triggered,
    graph_reasoning: graphResult,   // v7 — GraphReasoningResult complet
    recommendation: rec
      + (graphTensions ? ` Tensions structurelles : ${graphTensions}.` : '')
      + ` Cohérence graphe : ${graphResult.coherence_score}/100.`
      + ` Vérifier les sources avant usage décisionnel.`,
    graph_tensions: graphResult,       // disponible dans l'UI via cast (as any)
    graph_coherence: graphResult.coherence_score,
    llm_analysis_prompt: graphResult.llm_prompt,
  };
}

// Logging agrégé pour analyse des patterns fréquents
export function logGoodhartAlert(
  startupName: string,
  alert: GoodhartAlert,
  existingLogs: GoodhartLog[]
): GoodhartLog[] {
  if (!alert.triggered) return existingLogs;
  return [
    ...existingLogs,
    {
      startup: startupName,
      patterns: alert.patterns.map(p => p.id),
      timestamp: new Date().toISOString()
    }
  ];
}

// ── G4 — Versionnage des patterns Goodhart ───────────────────────────────────

export interface GoodhartPatternVersioned {
  id:           string;
  version:      string;     // e.g. 'v1.0'
  introduced:   string;     // date ISO
  deprecated?:  string;     // date ISO si retiré
  label:        string;
  description:  string;
  detect:       (s: any) => boolean;
  severity:     'info' | 'warning' | 'critical';
  rotation_key?: string;    // clé pour la rotation (masquée en prod)
}

export const PATTERN_VERSION = 'goodhart-patterns-v1.1';
export const PATTERNS_HASH   = 'sha256-c632ba35ab3bfd5b00e4f75de7cdd368225798baa218aaba37921534895177b8';

// Drift detector : surveille la distribution des scores entrants
export interface PatternDriftReport {
  pattern_id:    string;
  trigger_rate:  number;    // taux d'activation sur la fenêtre
  baseline_rate: number;    // taux attendu (calculé à l'introduction du pattern)
  drift_factor:  number;    // trigger_rate / baseline_rate
  alert:         boolean;   // true si drift_factor > 3 (optimisation de masse suspectée)
  window_n:      number;
  computed_at:   string;
}

export function computePatternDrift(
  pattern_id: string,
  recent_triggers: number,
  window_n: number,
  baseline_rate: number,
): PatternDriftReport {
  const rate = window_n > 0 ? recent_triggers / window_n : 0;
  const drift = baseline_rate > 0 ? rate / baseline_rate : 0;
  return {
    pattern_id,
    trigger_rate: Math.round(rate * 1000) / 1000,
    baseline_rate,
    drift_factor: Math.round(drift * 100) / 100,
    alert: drift > 3,
    window_n,
    computed_at: new Date().toISOString(),
  };
}

