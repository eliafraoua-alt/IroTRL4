/**
 * src/utils/goodhart-graph-reasoning.ts
 * IROSTRENGTH v7.0 — Correctif 4 : LLM Graph Reasoning pour Goodhart avancé
 *
 * Référence : arXiv:2512.23489 (2025)
 *             "The Gaining Paths to Investment Success: Information-Driven
 *              LLM Graph Reasoning for Venture Capital Prediction"
 *
 * Principe :
 *   Le goodhart-detector.ts actuel détecte des patterns binaires locaux.
 *   Ce module ajoute un raisonnement graphique sur les 6 dimensions :
 *   chaque paire de dimensions forme un arc dans le graphe, et un LLM
 *   analyse les tensions structurelles (contradictions non-locales).
 *
 *   Exemple : DI=4 ET IPC=1 → tension "technologie sans marché"
 *   Ce signal n'est pas capturé par les patterns binaires actuels.
 *
 * Architecture :
 *   1. buildDimensionGraph()      — graphe de 15 arcs (C(6,2)) avec tension
 *   2. GRAPH_TENSION_RULES        — règles de tension définies statiquement
 *   3. analyzeGraphTensions()     — détection statique des tensions fortes
 *   4. buildLLMGraphPrompt()      — prompt pour analyse LLM multi-hop
 *   5. parseGraphReasoning()      — parsing défensif de la réponse LLM
 *
 * Intégration :
 *   Complète (ne remplace pas) detectGoodharting() dans goodhart-detector.ts.
 *   Appeler analyzeGraphTensions() d'abord (synchrone, rapide).
 *   Appeler buildLLMGraphPrompt() + LLM pour l'analyse approfondie (async).
 */

import type { DimensionScores } from '../types/iro';

// ── Types ──────────────────────────────────────────────────────────────────────

export type DimKey = 'DI' | 'ADC' | 'IPC' | 'AR' | 'CA' | 'GCH';

export interface GraphArc {
  from:         DimKey;
  to:           DimKey;
  tension_type: 'complementary' | 'contradictory' | 'redundant' | 'neutral';
  tension_score: number;   // [0-1] — 1 = tension maximale
  description:  string;
}

export interface GraphTension {
  arc:          GraphArc;
  severity:     'critical' | 'warning' | 'info';
  label:        string;
  recommendation: string;
}

export interface GraphReasoningResult {
  tensions:         GraphTension[];
  critical_count:   number;
  warning_count:    number;
  coherence_score:  number;   // [0-100] — 100 = parfaitement cohérent
  dominant_pattern: string;
  llm_ready:        boolean;   // true si des tensions méritent analyse LLM
  llm_prompt?:      string;    // prompt prêt à envoyer au LLM si llm_ready
}

export interface LLMGraphAnalysis {
  raw_reasoning:    string;
  identified_risk:  string;
  recommendation:   string;
  coherence_note:   string;
  model_used:       string;
}

// ── Règles de tension statiques (15 arcs = C(6,2)) ───────────────────────────
//
// Chaque règle définit la tension attendue entre deux dimensions.
// tension_score = f(delta) — plus les scores divergent avec une tension
// attendue, plus la tension est élevée.

function computeArcTension(
  from: DimKey, to: DimKey,
  scores: DimensionScores,
): GraphArc {
  const a = scores[from] ?? 2;
  const b = scores[to]   ?? 2;

  // Règles de tension prédéfinies
  const TENSION_RULES: Record<string, {
    type: GraphArc['tension_type'];
    computeTension: (a: number, b: number) => number;
    description: string;
  }> = {
    'DI-ADC': {
      type: 'complementary',
      computeTension: (di, adc) => (di >= 3 && adc <= 1) ? 0.9 : (di === 0 && adc >= 3) ? 0.5 : 0.1,
      description: 'Technologie propriétaire doit s\'alimenter en données exclusives',
    },
    'DI-IPC': {
      type: 'complementary',
      computeTension: (di, ipc) => (di >= 4 && ipc <= 1) ? 0.95 : (di === 0 && ipc >= 4) ? 0.4 : 0.1,
      description: 'Tech frontier sans traction commerciale = lab spin-off signal',
    },
    'ADC-IPC': {
      type: 'complementary',
      computeTension: (adc, ipc) => (adc >= 4 && ipc <= 1) ? 0.85 : 0.1,
      description: 'Données exclusives non monétisées = actif dormant',
    },
    'DI-AR': {
      type: 'complementary',
      computeTension: (di, ar) => (di === 0 && ar >= 4) ? 0.7 : 0.05,
      description: 'Conformité réglementaire dépendante d\'un tiers (DI=0) = fragilité',
    },
    'IPC-CA': {
      type: 'complementary',
      computeTension: (ipc, ca) => (ipc >= 4 && ca <= 1) ? 0.75 : 0.05,
      description: 'Intégration profonde sans architecture évolutive = dette technique critique',
    },
    'GCH-CA': {
      type: 'complementary',
      computeTension: (gch, ca) => (gch >= 4 && ca <= 1) ? 0.65 : 0.05,
      description: 'Équipe brillante sans agilité organisationnelle = bureaucratie émergente',
    },
    'ADC-CA': {
      type: 'complementary',
      computeTension: (adc, ca) => (adc >= 3 && ca <= 1) ? 0.6 : 0.05,
      description: 'Actifs data sans architecture adaptable = flywheel bloqué',
    },
    'AR-DI': {
      type: 'complementary',
      computeTension: (ar, di) => 0.05,  // même règle que DI-AR (symétrie)
      description: '',
    },
    'GCH-IPC': {
      type: 'complementary',
      computeTension: (gch, ipc) => (gch >= 4 && ipc <= 1) ? 0.55 : 0.05,
      description: 'Équipe sénior sans traction = exécution en question',
    },
    'DI-GCH': {
      type: 'complementary',
      computeTension: (di, gch) => (di >= 4 && gch <= 1) ? 0.80 : 0.05,
      description: 'Infrastructure propriétaire sans équipe pour la maintenir = risque technique majeur',
    },
    'AR-IPC': {
      type: 'complementary',
      computeTension: (ar, ipc) => (ar >= 4 && ipc <= 1) ? 0.50 : 0.05,
      description: 'Avantage réglementaire non converti en traction = opportunité non saisie',
    },
    'ADC-GCH': {
      type: 'complementary',
      computeTension: (adc, gch) => 0.05,
      description: 'Données et équipe en synergie naturelle',
    },
    'IPC-AR': {
      type: 'complementary',
      computeTension: (ipc, ar) => 0.05,
      description: 'Intégration et conformité en synergie sectorielle',
    },
    'CA-AR': {
      type: 'complementary',
      computeTension: (ca, ar) => 0.05,
      description: 'Architecture et adaptation réglementaire en synergie',
    },
    'CA-GCH': {
      type: 'complementary',
      computeTension: (ca, gch) => 0.05,
      description: 'Architecture et gouvernance en synergie',
    },
  };

  const key = `${from}-${to}`;
  const rule = TENSION_RULES[key] ?? {
    type: 'neutral' as const,
    computeTension: () => 0.05,
    description: '',
  };

  return {
    from, to,
    tension_type: rule.type,
    tension_score: rule.computeTension(a, b),
    description: rule.description,
  };
}

// ── Analyse statique des tensions ─────────────────────────────────────────────

const DIMENSION_PAIRS: [DimKey, DimKey][] = [
  ['DI','ADC'], ['DI','IPC'], ['DI','AR'], ['DI','CA'], ['DI','GCH'],
  ['ADC','IPC'], ['ADC','CA'], ['ADC','GCH'], ['ADC','AR'],
  ['IPC','CA'], ['IPC','AR'], ['IPC','GCH'],
  ['CA','AR'], ['CA','GCH'],
  ['AR','GCH'],
];

const TENSION_LABELS: Record<string, { label: string; severity: GraphTension['severity']; recommendation: string }> = {
  'DI-IPC:high':   { severity: 'critical', label: 'Technologie sans marché',      recommendation: 'Valider la PMF avant de pousser DI plus haut. IPC=1 avec DI=4 = profil lab spin-off à haut risque commercial.' },
  'DI-ADC:high':   { severity: 'critical', label: 'IP sans données',              recommendation: 'Activer un flywheel de données (partenariats exclusifs, API propriétaire) pour nourrir l\'infrastructure DI.' },
  'ADC-IPC:high':  { severity: 'warning',  label: 'Données dormantes',            recommendation: 'Les données exclusives ne sont pas monétisées. Définir une stratégie IPC : contrats SLA, pricing volumétrique.' },
  'DI-AR:high':    { severity: 'warning',  label: 'Conformité externalisée',       recommendation: 'Internaliser la conformité réglementaire. DI=0 + AR≥3 = risque de rupture si le fournisseur LLM change.' },
  'IPC-CA:high':   { severity: 'warning',  label: 'Intégration sans scalabilité', recommendation: 'Investir en architecture (CA) avant de pousser IPC. Risque de dette technique bloquante à l\'échelle.' },
  'GCH-CA:high':   { severity: 'info',     label: 'Équipe star peu agile',        recommendation: 'Injecter des profils opérationnels (CTO, VP Eng) pour compenser GCH fort / CA faible.' },
  'DI-GCH:high':   { severity: 'critical', label: 'IP sans équipe technique',     recommendation: 'Recruter d\'urgence un CTO senior. Une infrastructure propriétaire sans équipe pour la maintenir = risque technique majeur.' },
};

export function analyzeGraphTensions(scores: DimensionScores): GraphReasoningResult {
  const arcs = DIMENSION_PAIRS.map(([from, to]) => computeArcTension(from, to, scores));
  const tensions: GraphTension[] = [];

  for (const arc of arcs) {
    if (arc.tension_score < 0.5) continue;

    const key = `${arc.from}-${arc.to}:high`;
    const meta = TENSION_LABELS[key];
    if (!meta) continue;

    tensions.push({
      arc,
      severity: meta.severity,
      label: meta.label,
      recommendation: meta.recommendation,
    });
  }

  const critical = tensions.filter(t => t.severity === 'critical').length;
  const warnings = tensions.filter(t => t.severity === 'warning').length;

  // Score de cohérence : 100 - pénalités
  const coherence = Math.max(0, Math.min(100,
    100 - critical * 25 - warnings * 10 - tensions.filter(t => t.severity === 'info').length * 5
  ));

  // Pattern dominant
  let dominant = 'Profil cohérent — aucune tension structurelle majeure';
  if (critical > 0) dominant = tensions.find(t => t.severity === 'critical')?.label ?? dominant;
  else if (warnings > 0) dominant = tensions.find(t => t.severity === 'warning')?.label ?? dominant;

  // Prompt LLM si tensions méritent analyse
  const llm_ready = critical > 0 || warnings >= 2;
  const llm_prompt = llm_ready ? buildLLMGraphPrompt(scores, tensions) : undefined;

  return {
    tensions,
    critical_count: critical,
    warning_count: warnings,
    coherence_score: coherence,
    dominant_pattern: dominant,
    llm_ready,
    llm_prompt,
  };
}

// ── Prompt LLM (graphe → raisonnement multi-hop) ──────────────────────────────

export function buildLLMGraphPrompt(
  scores: DimensionScores,
  tensions: GraphTension[],
): string {
  const dims = Object.entries(scores).map(([k, v]) => `${k}=${v}`).join(', ');
  const tensionList = tensions
    .map(t => `- ${t.label} (${t.arc.from}=${scores[t.arc.from] ?? '?'} × ${t.arc.to}=${scores[t.arc.to] ?? '?'}): ${t.arc.description}`)
    .join('\n');

  return `Tu es un expert en évaluation de startups IA (modèle IRO v7.0).
Une startup présente les scores IRO suivants : ${dims}

Le modèle a détecté ces tensions structurelles dans le graphe des dimensions :
${tensionList}

Raisonne en 3 étapes (chain-of-thought) :
1. Quelle est la tension la plus critique et pourquoi ?
2. Ce profil est-il cohérent avec une startup réelle viable, ou révèle-t-il un artefact de scoring ?
3. Quelle recommandation actionnable permet de résoudre la tension principale ?

Réponds en JSON uniquement :
{
  "identified_risk": "description du risque principal en 1 phrase",
  "is_artifact": true_ou_false,
  "recommendation": "action concrète en 1-2 phrases",
  "coherence_note": "note de cohérence globale en 1 phrase",
  "confidence": 0.7
}`;
}

/** Parsing défensif de la réponse LLM */
export function parseGraphReasoning(
  raw: string,
  modelId: string = 'gemini-3-flash',
): LLMGraphAnalysis {
  try {
    const match = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    const p = match ? JSON.parse(match[0]) : {};
    return {
      raw_reasoning:    raw.slice(0, 500),
      identified_risk:  String(p.identified_risk  || 'Non identifié'),
      recommendation:   String(p.recommendation   || 'Vérifier manuellement les scores.'),
      coherence_note:   String(p.coherence_note   || ''),
      model_used:       modelId,
    };
  } catch {
    return {
      raw_reasoning:  raw.slice(0, 200),
      identified_risk: 'Parsing échoué',
      recommendation:  'Relancer l\'analyse ou vérifier manuellement.',
      coherence_note:  '',
      model_used:      modelId,
    };
  }
}
