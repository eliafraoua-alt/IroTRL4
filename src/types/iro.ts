/**
 * src/types/iro.ts — Types partagés Frontend + Serveur
 * Antigravity Intelligence Platform — IRO v4.4
 *
 * CORRECTIONS AUDIT v4.3 :
 *   [F3]  SHAPValues renommé en CMPValues (Contributions Marginales Pondérées)
 *         → La vraie formule SHAP sur modèle linéaire est implémentée dans iro-engine.ts
 *   [F2]  DFLAdjusted ajouté : poids DFL corrigé selon DI (anti-double-pénalité)
 *   [F4]  VarianceReport triparti : sigma_epistemique / sigma_aleatoire / sigma_modele
 *   [F5]  IROMode discrimine explicitement "normatif" vs "predictif"
 *   [NEW] TRLScore ajouté pour le framework TRL NASA
 *   [NEW] VRINScore ajouté pour objectiver ADC et DI
 */

import goldStandardData from '../config/gold-standard-v4.5-s46.json';
import { StartupCohorte } from '../data/cohorte-france';

export interface WorldBenchmark {
  name: string;
  country: string;
  flag: string;
  DI: number;
  ADC: number;
  IPC: number;
  AR: number;
  CA: number;
  iro: number;
  valuation: string;
  signal: string;
  group: 'leader' | 'pivot' | 'success' | 'failure';
}

export interface BenchmarkResult {
  rang_monde: number;
  rang_france: number;
  centile_france: number;
  zone: 'leader' | 'challenger' | 'suiveur' | 'retardataire';
  iro_vs_mean_actives: number;
  iro_vs_mean_failed: number;
  similaires_actives: StartupCohorte[];
  similaires_failed: StartupCohorte[];
  seuil_franchissement: {
    next_level: string;
    pts_manquants: number;
    actions_cles: string[];
  };
}

// ── Stack LLM ────────────────────────────────────────────────────────────────

export interface LLMStack {
  models:            string[];
  frameworks:        string[];
  integration_level: 'API' | 'Fine-tuned' | 'Self-hosted' | 'Hybrid';
  evidence:          string;
  confidence:        'high' | 'medium' | 'low';
}

// ── Données financières ───────────────────────────────────────────────────────

export interface FinancialData {
  funding_total_eur:    number | null;
  funding_stage:        string | null;
  founded_year:         number | null;
  investors:            string[];
  last_round_date:      string | null;
  valuation_eur:        number | null;
  statut_juridique:     string | null;
  source_confidence:    'high' | 'medium' | 'low';
  employee_count:       number | null;
  employee_growth:      string | null;
  talent_density_proxy: string | null;
  hiring_news:          string[];
  llm_stack:            LLMStack | null;
}

// ── Verdict structuré ─────────────────────────────────────────────────────────

export interface VerdictData {
  viabilite:              string;
  financement:            string;
  horizon_risque_mois:    number;
  red_flags?:             string[];
  forces_cles?:           string[];
  opportunites_cachees?:  string[];
}

// ── v4.4 — Métadonnées IRO ──────────────────────────────────────────────────

export type ModelVersion = '4.2' | '4.3' | '4.4-LU' | '4.5-S46';

export interface GoldStandardEntry {
  id: string;
  name: string;
  vertical: string;
  modelVersion: ModelVersion;  // tracer la version de notation
  migrated: boolean;  // a-t-il été renoté manuellement ?
  dateNotation: string;
  
  // Scores IRO dimensionnels
  scores: { 
    DI: number; ADC: number; IPC: number; AR: number; CA: number; 
    GCH: number; LU?: number;
    lu_type?: string; lu_data_gap?: boolean; lu_ipc_anchor?: boolean;
  };
  
  // Variable cible — score composite expert
  sce: {
    final: number;
    icc: number;             // cohérence inter-évaluateurs
  };
  
  // Audit trail
  sourcesDocumentees: string[];  // URLs Crunchbase, INPI, GitHub, etc.

  outcome?: {
    event: 0 | 1;
    t_event_mois: number;
  };
}

export interface GitHubData {
  repo_name:          string;
  owner:              string;
  activity_score:     'low' | 'medium' | 'high';
  tech_stack:         string[];
  llm_dependencies:   string[];       // dépendances LLM détectées (clé pour DI)
  last_commit_date:   string;
  stars:              number;
  total_commits_year: number;
  is_private_or_missing: boolean;    // true si repo non trouvé ou privé
  // NOUVEAU — signal DI direct
  di_signal:          'none' | 'wrapper' | 'rag_custom' | 'finetuned' | 'proprietary';
  di_signal_reason:   string;
  has_custom_model:   boolean;   // indice de modèle custom (model/ directory, .pt files)
  llm_integration_depth: 'API' | 'RAG' | 'FineTuned' | 'SelfHosted' | 'Unknown';
}

export interface FrozenGoldStandard {
  version: string;
  frozenAt: string;
  validatedBy: string;
  entries: GoldStandardEntry[];
  metadata: {
    n: number;
    meanICC: number;
    sceRange: number;
    distributions: Record<string, { mean: string; variance: string; scores: number[] }>;
    correlations: Record<string, number>;
  };
}

export const GOLD_STANDARD: GoldStandardEntry[] = goldStandardData.entries as GoldStandardEntry[];


export const GOLD_STANDARD_N = 125;
export const GOLD_STANDARD_MIN = 60;

// ─────────────────────────────────────────────────────────────────────────────
// [F5] CORRECTION FAILLE 5 — Séparation normatif / prédictif
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mode d'utilisation du score IRO.
 * Normatif  : audit stratégique, identification d'angles morts.
 * Predictif : signal de sélection (nécessite gold standard ≥ 60 startups).
 */
export type IROMode = 'normatif' | 'predictif';

export interface IROMetadata {
  mode:               IROMode;
  gold_standard_n:    number;   // Taille actuelle du gold standard
  gold_standard_min:  number;   // Minimum requis pour mode prédictif (60)
  /** Annotation R² obligatoire quand n < gold_standard_min */
  r2_annotation:      string;
  /** Libellés UI selon le mode */
  ui_labels: {
    iro_cr_label:     string;   // "IRO Ajusté Risque" (normatif) ou "IRO Corrigé 18m" (prédictif)
    horizon_label:    string;   // "Horizon Risque" (normatif) ou "Prédiction 18m" (prédictif)
    mode_disclaimer:  string;   // Disclaimer affiché dans l'UI
  };
}

export type DimensionScores = Record<string, number>;

export interface GoodhartPattern {
  id: string;
  label: string;
  description: string;
  detect: (scores: Record<string, number>) => boolean;
  severity: 'info' | 'warning';
}

export interface GoodhartAlert {
  triggered: boolean;
  patterns: GoodhartPattern[];
  recommendation: string;
  graph_reasoning?: any;
  graph_evaluation?: any;
  graph_tensions?: any;
  graph_coherence?: number;
  llm_analysis_prompt?: string;
}

export interface GoodhartLog {
  startup: string;
  patterns: string[];
  timestamp: string;
}

/** Fabrique les métadonnées IRO selon le nombre de startups dans le gold standard */
export function buildIROMetadata(gold_n: number): IROMetadata {
  const isPredictif  = gold_n >= 60;
  const mode: IROMode = isPredictif ? 'predictif' : 'normatif';

  return {
    mode,
    gold_standard_n:   gold_n,
    gold_standard_min: 60,
    r2_annotation: isPredictif
      ? ''
      : `R² non significatif (n=${gold_n}, surajustement probable — minimum requis : 60)`,
    ui_labels: {
      iro_cr_label:    isPredictif ? 'IRO Corrigé 18m'  : 'IRO Ajusté Risque',
      horizon_label:   isPredictif ? 'Prédiction 18m'   : 'Horizon Risque',
      mode_disclaimer: isPredictif
        ? 'Modèle prédictif calibré sur cohorte observée.'
        : 'Modèle d\'audit normatif — non prédictif en l\'état. Ne pas présenter comme prédicteur de succès startup.',
    },
  };
}

// ── v4.4 — Nouvelles interfaces d'analyse ───────────────────────────────────

export type ConfidenceLevel = 0.2 | 0.5 | 0.8 | 1.0;

export interface DimensionConfidence {
  // Existant
  ipc_confiance: ConfidenceLevel;   // 0.2=non vérifié → 1.0=vérifié et documenté

  // Nouveaux
  adc_confiance: 0.5 | 0.8 | 1.0;  // 0.5=déclaratif, 0.8=partiel, 1.0=auditable
  gch_confiance: 0.5 | 0.8 | 1.0;  // 0.5=non vérifié, 0.8=LinkedIn, 1.0=publications+références
}

// Libellés pour le formulaire
export const CONFIDENCE_LABELS = {
  ipc: {
    0.2: "Non vérifié — aucun client nommé",
    0.5: "Partiel — quelques références vagues",
    0.8: "Probable — références cohérentes",
    1.0: "Vérifié — contrats documentés"
  },
  adc: {
    0.5: "Déclaratif — données non vérifiables publiquement",
    0.8: "Partiel — accords d'exclusivité mentionnés, non audités",
    1.0: "Auditable — sources documentées et vérifiables"
  },
  gch: {
    0.5: "Non vérifié — équipe peu documentée",
    0.8: "LinkedIn / publications vérifiées",
    1.0: "Références croisées — publications + parcours + recommandations"
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// [F3] CORRECTION FAILLE 3 — Renommage SHAP → CMP
// L'ancienne interface SHAPValues est conservée en alias déprécié
// pour éviter de casser les imports existants, mais toute nouvelle
// logique doit utiliser CMPValues.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contributions Marginales Pondérées (CMP) — ex "SHAP Values"
 *
 * Formule implémentée (modèle additif linéaire) :
 *   φᵢ = wᵢ × (xᵢ − E[xᵢ]) × ipc_mult
 *   Σφᵢ = IRO_prédit − IRO_baseline  ← propriété d'additivité garantie
 *
 * Ce ne sont PAS des vraies Shapley values (qui nécessiteraient 2⁶=64
 * sous-ensembles). C'est une décomposition linéaire exacte sur modèle additif,
 * conforme à la littérature (Lundberg & Lee, 2017 — cas dégénéré linéaire).
 *
 * Afficher : "Contributions Marginales Pondérées (CMP)"
 * Note UI  : "Décomposition linéaire — approximation pour modèle additif"
 */
export interface CMPValues {
  DI:        number;
  ADC:       number;
  IPC:       number;
  AR:        number;
  CA:        number;
  GCH:       number;
  LU?:       number;
  baseline:  number;   // IRO moyen cohorte gold standard
  predicted: number;   // IRO final de la startup analysée
  /** Vérifie la propriété d'additivité : |Σφᵢ - (predicted - baseline)| < ε */
  additivity_check: boolean;
}

/** @deprecated Utilisez CMPValues. Alias conservé pour rétrocompatibilité. */
export type SHAPValues = CMPValues;

// ─────────────────────────────────────────────────────────────────────────────
// [F4] CORRECTION FAILLE 4 — Variance intra-LLM tripartie
// Le σ brut des 3 passages ne doit PAS être interprété comme un défaut
// de la startup. Il est décomposé en 3 composantes distinctes.
// ─────────────────────────────────────────────────────────────────────────────

export interface VarianceDecomposition {
  /**
   * Variance épistémique : manque d'information sur la startup.
   * Proxy : sources_convergentes = false (peu de sources publiques trouvées)
   */
  epistemique: 'haute' | 'moyenne' | 'faible';
  sources_convergentes: boolean;

  /**
   * Variance aléatoire : stochasticité du LLM (température, sampling).
   * Estimée par la variance inter-passages sur une startup gold standard bien connue.
   * Valeur de référence calibrée sur Mistral AI (gold standard) : σ_ref ≈ 1.2 pts.
   */
  aleatoire_estimee: number;

  /**
   * Variance de modèle : sous-spécification du prompt.
   * Indiquée quand sigma_dim d'une dimension spécifique > 2× sigma_ref.
   */
  modele: 'detectee' | 'non_detectee';
  dimensions_instables: string[];  // ex: ['IPC', 'GCH']
}

export interface CorroborationMetrics {
  total_claims:          number;
  corroborated_claims:   number;
  rate:                  number;       // [0-1]
  by_source: Record<string, { present: number; total: number; rate: number }>;
  auto_confidence_penalty: number;     // décote appliquée si rate < 0.5
  display_label:         string;
}

export interface VarianceReport {
  scores_passes:      Array<Record<string, number>>;
  iro_passes:         number[];
  sigma_iro:          number;
  sigma_axes:         Record<string, number>;
  instable:           boolean;
  consensus_scores:   Record<string, number>;
  corroboration?:     CorroborationMetrics;
  /** [F4] Décomposition tripartie de la variance */
  decomposition:      VarianceDecomposition;
  /**
   * [F4] Seuil calibré sur le gold standard.
   * La valeur 8 pts de la v4.3 est non calibrée.
   * Cette valeur est calculée dynamiquement = sigma_ref_gold × 3.
   */
  seuil_instabilite:  number;
  seuil_source:       'calibre_gold' | 'defaut_non_calibre';
  sigma_interpretation?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// [NEW] IRO_CertifiedResult — Annotation R² obligatoire
// ─────────────────────────────────────────────────────────────────────────────

export interface IRO_CertifiedResult {
  poids_appris:          Record<string, number>;
  iro_certified:         number;
  delta_vs_standard:     number;
  confiance_calibration: number;  // R²
  r2Adjusted:            number;  // R² ajusté
  meanICC:               number;  // ICC moyen
  spearman:              number;  // Corrélation de rang
  rmse:                  number;  // Erreur quadratique moyenne
  mae:                   number;  // Erreur absolue moyenne
  /** [F1] Annotation R² affichée dans l'UI */
  r2_annotation:         string;
  /** [F1] Avertissement si gold standard insuffisant */
  gold_standard_warning: string | null;
  /** [NEW] Métadonnées statistiques pour R2Display */
  sampleSize:            number;
  variableCount:         number;
  isStatisticallyValid:  boolean;
}

export interface StartupGraph {
  nodes: { id?: string; name: string; type: string; signal?: string; detail?: string }[];
  edges?: { source: string; target: string; label: string }[];
  signal_global: 'favorable' | 'neutre' | 'défavorable';
  nb_relations_verifiees: number;
}

export interface DynamicIndicators {
  ivr: number;
  icd: number;
  iro_proj_18m: number;
  progression_desequilibree: boolean;
  regression_confirmed: boolean;
}

export interface GoldCalibration {
  id?: string;
  is_gold: boolean;
  iro_ref: number;
  delta: number;
  within_tolerance: boolean;
  status: 'calibre' | 'derive_moderee' | 'derive_critique';
}

export interface IROBatchResult {
  id: string;
  name: string;
  iro: number;
  ref: number;
  delta: number;
  timestamp: string;
}

export interface IROScores {
  DI: number; ADC: number; IPC: number;
  AR: number; CA: number; GCH: number;
  [key: string]: number;
}

export interface IROResult {
  startup_name: string;
  millesime: string;
  version: string;
  secteur: string;
  vertical: 'HLTH' | 'FINT' | 'LEGT' | 'INDU' | 'SAAS';
  vertical_ambigu?: boolean;
  age_mois: number;
  clients_actifs: number | null;
  stade_financement: string;
  iro: {
    scores: IROScores;
    confidence?: { ADC: number; GCH: number };
    ipc_confiance: number;
    ipc_eff: number;
    score_100: number;
    interpretation: string;
    justifications: Record<string, string>;
    gch_detail?: {
      complementarite: number;
      track_record: number;
      reseau: number;
      retention: number;
      profils_cles?: Array<{ role: string; indicateur: string }>;
    };
  };
  srd: {
    VMM: { score: number; justification: string };
    NCD: { score: number; justification: string };
    DFL: { score: number; justification: string };
    srd_100: number;
    iro_cr: number;
    interpretation: string;
    horizon_risque_mois: number | null;
    quadrant: string;
    plan_mitigation: string[];
    srd_weights?: { VMM: number; NCD: number; DFL: number };
    srd_result?: any;
  };
  benchmark: {
    percentile: number;
    iro_relatif: number;
    iro_ajuste: number;
    position: 'Leader' | 'Challenger' | 'Suiveur' | 'Retardataire';
    axes_forts: string[];
    axes_faibles: string[];
  };
  benchmark_pos?: BenchmarkResult;
  hypotheses: Record<string, { signal: 'favorable' | 'neutre' | 'défavorable'; observation: string }>;
  flags: {
    floor_activated: boolean;
    ancrage_warning: boolean;
    integration_maturity_warning: boolean;
    commoditisation_imminente: boolean;
    double_lock_in: boolean;
    data_moat_absent: boolean;
    single_founder_warning: boolean;
    team_homogeneity_warning: boolean;
    key_person_risk: boolean;
    lu_data_gap?: boolean;
    lu_ipc_anchor?: boolean;
    lu_type?: 'interne' | 'externe' | 'hybride';
  };
  cox_survival?: CoxResultEnrichi;
  competing_risks?: CompetingRisksResult;
  temporal?: {
    honeymoon: HoneymoonProfile;
    velocity: IROVelocity | null;
    diVelocity: DIVelocity;
  };
  synthese: {
    forces: string[];
    risques: string[];
    recommandation: string;
    verdict_investisseur: string;
  };
  sources_utilisees: string[];
  trl?: any;
  di_infra_propre?: boolean;
  validation_logs?: string[];
  graph_reasoning?: any;
  graph_tensions?: any;
  gch_structured?: any;
  consensus_report?: any;
  fsf?: FSFResult;
  dual_horizon?: DualHorizonResult;
  investorReport?: InvestorReport;
  iro_es?: any;
  /**
   * [FIX 12/07/2026, étendu v8.0] Intelligence web collectée par src/collectors/web-intelligence.ts
   * (queryPresseTech, queryFinancement, etc. — 10 fonctions v7.4 avec Google Search
   * Grounding via Gemini). Ce champ était renseigné sur le state React de
   * useIROAnalysis.ts mais jamais rattaché à l'objet passé à buildInvestorReport
   * (correctif appliqué le 12/07/2026 — voir commentaire dans useIROAnalysis.ts) :
   * les données de presse et de marché collectées n'atteignaient jamais le
   * rapport final malgré leur collecte réelle et leur affichage dans
   * WebIntelligencePanel.tsx. Voir Section "Intelligence externe" de
   * generateInvestorMarkdown().
   */
  webIntelligence?: import('../collectors/web-intelligence').WebIntelligence;
  /**
   * [v8.0] Presse Intelligence — pipeline NLP exhaustif (GDELT + NewsAPI +
   * Gemini Search, annotation par lots : sentiment/entités/thèmes, timeline,
   * détection de contradictions vs pitch). Remplace/enrichit webIntelligence
   * pour la Section 7 du rapport investisseur quand disponible — voir
   * buildExternalIntelligence() dans investor-report-generator.ts.
   */
  pressIntelligence?: import('../collectors/press-intelligence').PressIntelligenceResult | null;
}

export interface HistoryEntry {
  id: string;
  startup: string;
  result: IROResult;
  date: string;
  dynamics?: DynamicIndicators;
  gold?: GoldCalibration | null;
}

// ── TRL — Technology Readiness Level (NASA / Commission Européenne) ──────────

export interface TRLScore {
  /** Niveau TRL estimé (1–9) */
  niveau:      number;
  /** Description du niveau */
  description: string;
  /** Impact sur le score IPC : TRL ≤ 4 → plafonner IPC à 2 */
  ipc_cap?:    number;
  /** Impact sur le score DI  : TRL ≥ 7 → bonus +0.1 sur DI si infra propre confirmée */
  di_bonus?:   number;
  /** Source de l'estimation */
  source:      'utilisateur' | 'gemini_infere';
}

/** @deprecated Utilisez TRLScore. */
export type TRL = TRLScore;

export interface VRINScore {
  valuable:    boolean;
  rare:        boolean;
  inimitable:  boolean;
  non_substituable: boolean;
  /** Nombre de critères VRIN validés (0–4) */
  score: number;
  /** Règle : ADC/DI = 4 si score = 4, = 3 si score = 3, etc. */
  recommended_dim_score: number;
  justifications: {
    valuable?:           string;
    rare?:               string;
    inimitable?:         string;
    non_substituable?:   string;
  };
}

/** @deprecated Utilisez VRINScore. */
export type VRIN = VRINScore;

export const TRL_DESCRIPTIONS: Record<number, string> = {
  1: 'Principe de base observé',
  2: 'Concept technologique formulé',
  3: 'Preuve de concept expérimentale',
  4: 'Validation en laboratoire',
  5: 'Validation en environnement représentatif',
  6: 'Démonstration en environnement opérationnel',
  7: 'Prototype système démontré',
  8: 'Système complet qualifié',
  9: 'Système en opérations réelles',
};

export interface StartupModel {
  nom:           string;
  secteur:       string;
  vertical:      'HLTH' | 'FINT' | 'LEGT' | 'INDU' | 'SAAS' | '';
  date_creation: string;
  stade:         string;
  di_llm_utilises:     string;
  di_infra_propre:     boolean;
  di_brevets:          string;
  di_dependance_cloud: string;
  trl_niveau:          '1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'';
  di_vrin_valuable:       boolean;
  di_vrin_rare:           boolean;
  di_vrin_inimitable:     boolean;
  di_vrin_non_sub:        boolean;
  adc_type_donnees: 'generiques' | 'sectorielles' | 'comportementales' | '';
  adc_volume:       string;
  adc_exclusivite:  boolean;
  adc_source:       string;
  adc_confiance:    '0.5' | '0.8' | '1.0' | '';
  adc_vrin_valuable:      boolean;
  adc_vrin_rare:          boolean;
  adc_vrin_inimitable:    boolean;
  adc_vrin_non_sub:       boolean;
  ipc_clients_nommes: string;
  ipc_profondeur:     string;
  ipc_contrats:       string;
  ipc_confiance:      '0.2' | '0.5' | '0.8' | '1.0' | '';
  ipc_job_type:       'fonctionnel' | 'emotionnel' | 'social' | '';
  ipc_job_criticite:  '1'|'2'|'3'|'4'|'';
  ar_certifications:  string;
  ar_conformite:      string;
  ar_avantage_reglo:  boolean;
  ca_pivots:       string;
  ca_github_stars: string;
  ca_partenariats: string;
  gch_fondateurs:   string;
  gch_equipe_size:  string;
  gch_board:        string;
  gch_recrutements: string;
  gch_founders?: any[]; // Structured founder profiles
  gch_confiance:    '0.5' | '0.8' | '1.0' | '';
  srd_concurrents:             string;
  srd_vitesse_marche:          string;
  srd_dependance_fournisseur:  string;
  texte_libre: string;
  external_pappers?: string;
  age_mois?: number;
  arr_eur?:          number;   // ARR en euros — optionnel
  arr_growth_12m?:   number;   // Croissance ARR ×N sur 12 mois — optionnel
  roas?:             number;   // ROAS (ex: 1.18 pour 118%) — optionnel
  ltv_eur?:          number;   // LTV par client — optionnel
  cac_eur?:          number;   // CAC — optionnel
  monthly_burn_eur?: number;   // Burn mensuel — optionnel
}

export function applyTRLRules(trl: TRLScore, current_ipc: number, current_di: number, di_infra_propre: boolean): {
  ipc_adjusted: number;
  di_adjusted:  number;
  rules_applied: string[];
} {
  const rules: string[] = [];
  let ipc = current_ipc;
  let di  = current_di;

  if (trl.niveau <= 4 && ipc > 2) {
    ipc = 2;
    rules.push(`TRL=${trl.niveau} ≤ 4 → IPC plafonné à 2 (maturité insuffisante pour intégration processus critiques)`);
  }
  if (trl.niveau >= 7 && di_infra_propre && di < 4) {
    di = Math.min(4, di + 0.1);
    rules.push(`TRL=${trl.niveau} ≥ 7 + infra propre confirmée → bonus +0.1 sur DI`);
  }

  return { ipc_adjusted: ipc, di_adjusted: di, rules_applied: rules };
}

export function computeVRINScore(criteria: Omit<VRINScore, 'score' | 'recommended_dim_score'>): VRINScore {
  const score = [criteria.valuable, criteria.rare, criteria.inimitable, criteria.non_substituable]
    .filter(Boolean).length;
  return {
    ...criteria,
    score,
    recommended_dim_score: score,  // 1:1 mapping par règle audit §3.2
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// [F2] CORRECTION FAILLE 2 — Double pénalité DI/DFL
// Quand DI = 0, le signal de dépendance est déjà pleinement capturé.
// Le poids effectif de DFL dans le SRD est réduit de 30% à 15%.
// ─────────────────────────────────────────────────────────────────────────────

export interface SRDWeights {
  VMM: number;  // Poids VMM (toujours 0.35)
  NCD: number;  // Poids NCD (toujours 0.35)
  DFL: number;  // Poids DFL : 0.30 si DI > 0, 0.15 si DI = 0
  /** true si DFL a été réduit pour éviter la double pénalité */
  dfl_adjusted: boolean;
  /** Raison de l'ajustement (pour affichage UI) */
  dfl_adjustment_reason?: string;
}

export interface SRDResult {
  srd: number;
  dflWeightApplied: number;
  deduplicationActive: boolean;
  explanation?: string;
}

/** Calcule les poids SRD en tenant compte de la correction DI/DFL */
export function computeSRDWeights(di_score: number): SRDWeights {
  const dfl_adjusted = di_score === 0;
  const dfl_weight   = dfl_adjusted ? 0.15 : 0.30;
  // Redistribution : quand DFL passe à 0.15, les 0.15 restants
  // sont répartis équitablement entre VMM et NCD (+ 0.075 chacun)
  const vmm_weight = dfl_adjusted ? 0.425 : 0.35;
  const ncd_weight = dfl_adjusted ? 0.425 : 0.35;

  return {
    VMM: vmm_weight,
    NCD: ncd_weight,
    DFL: dfl_weight,
    dfl_adjusted,
    dfl_adjustment_reason: dfl_adjusted
      ? 'Poids DFL réduit de 30% à 15% : signal de dépendance infra déjà capturé par DI=0'
      : undefined,
  };
}

// ── v6.6 — IRO Velocity & Dynamique temporelle ──────────────────────────────

export type VelocityLabel =
  | 'accélération forte'     // > +1.5 pts/mois
  | 'progression saine'      // +0.5 à +1.5 pts/mois
  | 'stable'                 // -0.5 à +0.5 pts/mois
  | 'dégradation modérée'    // -1.5 à -0.5 pts/mois
  | 'dégradation critique';  // < -1.5 pts/mois

export interface VelocitySnapshot {
  timestamp: string;
  iro_total: number;
  iro_cr: number;
  scores: Partial<DimensionScores>;
}

export interface IROVelocity {
  startup_name: string;
  n_snapshots: number;
  velocity_global: number;
  velocity_label: VelocityLabel;
  velocity_color: string;
  delta_iro: number;
  period_months: number;
  dim_velocities: Record<string, number>;
  trend: 'ascending' | 'descending' | 'stable' | 'volatile';
  confidence: 'high' | 'medium' | 'low';
  snapshots: VelocitySnapshot[];
  honeymoon_weight: number;
  cox_adjustment: number;
  interpretation: string;
}

export type HoneymoonStade =
  | 'discovery'    // 0–6 mois
  | 'validation'   // 6–12 mois
  | 'pic_risque'   // 12–24 mois
  | 'efficiency'   // 24–36 mois
  | 'mature';      // > 36 mois

export interface HoneymoonProfile {
  age_mois: number;
  stade: HoneymoonStade;
  pivot_cost: 'faible' | 'modéré' | 'élevé' | 'maximal';
  honeymoon_level: 'haute' | 'décroissante' | 'épuisée' | 'absente';
  mortality_peak: boolean;
  weight: number;
  interpretation: string;
  action_prioritaire: string;
  sector_cal?: string;
}

export interface DIVelocity {
  di_score: number;
  vmm: number;
  di_effectif: number;
  delta_depreciation: number;
  risque_label: 'nul' | 'faible' | 'modéré' | 'critique';
  interpretation: string;
}

// ── v6 — Cox Model types ────────────────────────────────────────────────────

export interface CoxInput {
  irocr: number;             // IRO corrigé par SRD
  di_zero: boolean;          // DI=0 → REV1 active
  srd_high: boolean;         // SRD > 60%
  adc_strong: boolean;       // ADC ≥ 3
  ipc_strong: boolean;       // IPC ≥ 3
  regulated_sector: boolean; // Santé / Finance / Défense
  // ── Enrichissements temporels (optionnels — rétrocompatibles) ────────────
  age_mois?: number;                 // Âge startup en mois → honeymoon weight
  vertical?: string;                 // Code vertical ('HLTH', 'SAAS', etc.)
  velocity_pts_per_month?: number;   // Δ IRO/mois issu de IROVelocity → H5
}

export interface CoxResultEnrichi {
  // ── Point estimates (inchangés) ──────────────────────────────────────
  survival_12m:   number;
  survival_24m:   number;
  survival_36m:   number;
  hazard_ratio:   number;
  risk_profile:   'faible' | 'modéré' | 'élevé' | 'critique';

  // ── IC95% — NOUVEAU ──────────────────────────────────────────────────
  survival_12m_lo?: number;    // borne basse IC95% S(12m)
  survival_12m_hi?: number;    // borne haute IC95% S(12m)
  survival_36m_lo?: number;    // borne basse IC95% S(36m)
  survival_36m_hi?: number;    // borne haute IC95% S(36m)
  ci_method?:        'delta_method' | 'conformal_sesia2025';
  ci_note?:          string;

  // ── Risques concurrents Fine & Gray — NOUVEAU ────────────────────────
  competing_risks?: {
    p_faillite_36m:     number;
    p_acquisition_36m:  number;
    p_pivot_36m:        number;
    p_actif_36m:        number;
    most_likely:        ExitType;
    interpretation:     string;
  };

  // ── Existants ────────────────────────────────────────────────────────
  confidence_note:    string;
  beta_contributions: Record<string, number>;
  temporal_note?:     string;
  honeymoon_weight?:  number;
  velocity_adjustment?: number;

  // ── Nouveau : calibration β_velocity ─────────────────────────────────
  beta_velocity_calibrated?: number;  // remplace −0.020 si calibré
  beta_velocity_ci?: [number, number]; // [lo, hi] IC95%
  h5_confirmed?:     boolean;

  // [PATCH4] Résultat deux horizons
  dual_horizon?: DualHorizonResult;

  // [PATCH4] Flag signalant la correction du biais double SRD
  srd_double_penalty_corrected?: boolean;  // true si PATCH4 appliqué

  // [PATCH4] IRO effectivement utilisé dans Cox (pour traçabilité)
  iro_used_in_cox?: number;       // = iro_final (pas iro_cr)

  // NOUVEAU — Correctif LP Clip
  lp_clipped?: boolean;
  lp_clip_direction?: 'low' | 'high' | null;
  lp_clip_note?: string;

  // NOUVEAU — Correctif A2 IC Bootstrap sur le C-index
  c_index_loo?: number;
  c_index_ci_lo?: number;
  c_index_ci_hi?: number;
  c_index_boot_mean?: number;
  c_index_boot_sd?: number;
  c_index_display?: string;
  c_index_interpretation?: string;
  epv?: number;
  epv_note?: string;
}

export interface SurvivalCurve {
  months: number[];
  survival: number[];
}

export type ExitType = 'faillite' | 'acquisition' | 'pivot_radical' | 'actif';

export interface CompetingRisksInput {
  irocr:          number;
  di_zero:        boolean;
  adc_strong:     boolean;   // ADC ≥ 3 → actif data → acquisition plus probable
  ipc_strong:     boolean;   // IPC ≥ 3 → intégré → acquisition moins probable (trop cher)
  ca_strong:      boolean;   // CA ≥ 3 → agilité → pivot probable si nécessaire
  age_mois:       number;
  velocity_global?: number;
}

export interface CompetingRisksResult {
  /** Probabilités cumulatives à 36 mois */
  p_faillite_36m:     number;   // [0-1]
  p_acquisition_36m:  number;   // [0-1]
  p_pivot_36m:        number;   // [0-1]
  p_actif_36m:        number;   // [0-1] probabilité de rester actif
  /** Sortie la plus probable */
  most_likely:        ExitType;
  /** Niveau de confiance du modèle */
  model_confidence:   'high' | 'medium' | 'low';
  interpretation:     string;
  trl_note:           string;
}

// ── Financial Sustainability Factor (FSF) — Module horizon 0–18 mois ──────────

export interface FSFInput {
  arr_eur?: number;              // ARR en euros (ex: 8_000_000)
  arr_growth_12m?: number;       // Multiplicateur ARR sur 12 mois (ex: 5.0 pour ×5)
  roas?: number;                 // Return On Ad Spend (ex: 1.18 pour 118%)
  ltv_eur?: number;              // Lifetime Value par client en euros
  cac_eur?: number;              // Customer Acquisition Cost en euros
  monthly_burn_eur?: number;     // Burn mensuel (optionnel — pour runway)
  runway_months?: number;        // Runway calculé ou déclaré
  stage?: 'pre-seed' | 'seed' | 'serie-a' | 'serie-b' | 'growth';
}

export interface FSFResult {
  fsf_available: boolean;       // false si données insuffisantes → module désactivé
  fsf_score?: number;           // [0–4] si disponible
  fsf_label?: 'critique' | 'fragile' | 'sain' | 'solide' | 'exceptionnel';

  // Métriques détaillées (si disponibles)
  ltv_cac_ratio?: number;
  roas_score?: number;          // score partiel [0–4]
  growth_score?: number;        // score partiel [0–4]

  // Survie opérationnelle 18 mois (horizon court terme)
  survival_18m_operational?: number;    // [0–1]
  survival_18m_label?: string;

  // Avertissement si données partielles
  data_completeness: number;    // [0–1] : proportion des champs renseignés
  missing_fields: string[];     // champs manquants pour calcul complet
  note: string;
}

export interface DualHorizonResult {
  // ── Horizon long terme (36 mois) — Cox structurel ────────────────────────
  structural: {
    survival_36m: number;
    survival_36m_lo?: number;
    survival_36m_hi?: number;
    risk_profile: 'faible' | 'modéré' | 'élevé' | 'critique';
    label: string;              // ex: "Risque structurel ÉLEVÉ — actifs VRIN insuffisants"
    covariables_used: string[]; // covariables actives dans le LP
    note: string;               // avertissement épistémique
  };

  // ── Horizon court terme (18 mois) — FSF opérationnel ─────────────────────
  operational: {
    available: boolean;
    survival_18m?: number;
    label?: string;             // ex: "Traction solide — ARR ×5, ROAS 118%"
    fsf_score?: number;
    note: string;               // "Données financières non fournies" si unavailable
  };

  // ── Lecture combinée (texte uniquement, pas de chiffre unique) ────────────
  combined_reading: string;
  dominant_risk: 'structurel' | 'opérationnel' | 'les deux' | 'aucun';
}

export interface CoxInputV2 {
  // [PATCH4] Renommé : reçoit IRO_final, pas IRO_cr
  iro_final: number;             // IRO_final brut (SANS correction SRD)

  // Covariables structurelles (inchangées)
  di_zero: boolean;
  srd_high: boolean;             // SRD > 60 — passe une seule fois dans le LP
  adc_strong: boolean;
  ipc_strong: boolean;
  regulated_sector: boolean;

  // Enrichissements temporels (inchangés)
  age_mois?: number;
  vertical?: string;
  velocity_pts_per_month?: number;

  // [PATCH4] Affichage UI uniquement — jamais utilisé dans le calcul LP
  iro_cr_display?: number;       // IRO_final × (1 − SRD/200) pour affichage

  // [PATCH4] Données financières optionnelles → horizon court terme
  fsf?: FSFInput;
}

export interface CoxResultEnrichiPatch4Extension {
  // [PATCH4] Résultat deux horizons
  dual_horizon?: DualHorizonResult;

  // [PATCH4] Flag signalant la correction du biais double SRD
  srd_double_penalty_corrected: boolean;  // true si PATCH4 appliqué

  // [PATCH4] IRO effectivement utilisé dans Cox (pour traçabilité)
  iro_used_in_cox: number;       // = iro_final (pas iro_cr)
}

export interface DimDetail {
  score: number;                    // 0–4
  confidence: number;               // 0–1 (ex: 0.70)
  confidence_label: string;         // ex: "convergent", "partiel", "incertain"
  qualificatif: string;             // ex: "hybride (127 agents IA propriétaires + dépendance Meta)"
  grille_label: string;             // ex: "0=wrapper total … 4=entièrement propriétaire"
  justification: string;            // paragraphe d'analyse
  missing_data: string[];           // données manquantes explicites
  integration_level?: string;       // [IPC REV3] production / certifiée / etc.
  pivot_type?: string;              // [CA REV2] proactif / réactif / etc.
}

export interface InvestorFlag {
  type: 'risk' | 'signal';
  severity: 'critique' | 'modéré' | 'informatif' | 'positif';
  titre: string;
  detail: string;
}

export interface DimRecommendation {
  dim: string;                      // ex: "CA"
  target_score: number;             // ex: 4
  horizon: 'court' | 'moyen' | 'long';
  horizon_label: string;            // ex: "Court terme (0–6 mois)"
  titre: string;                    // ex: "Accélérer la diversification acquisition"
  actions: string[];                // liste des actions concrètes
}

export interface CompetitorComparison {
  competitor_name: string;
  scores: Record<string, number>;   // { DI: 1, ADC: 2, ... }
  iro_score: number;
  verdict: string;
  advantage_per_dim: Record<string, 'startup' | 'competitor' | 'égalité'>;
}

export interface InvestorReport {
  // Métadonnées
  startup_name: string;
  protocol_version: string;         // ex: "IRO Strength Velocity v7.1.0"
  prompt_registry: string;          // ex: "v4.4.1"
  betas_version?: string;           // ex: "v4.3 [sha256-hash]"
  generated_at: string;             // ISO date
  secteur: string;
  marche: string;                   // ex: "France & États-Unis"
  vertical: string;

  // Score global
  iro_score: number;
  iro_verdict: 'CRITIQUE' | 'FRAGILE' | 'ROBUSTE' | 'SOLIDE';
  floor_di_activated: boolean;
  ancrage_warning: boolean;

  // Détail 6 dimensions
  dimensions: Record<string, DimDetail>;

  // Recommandations par dimension
  recommendations: DimRecommendation[];

  // Flags investisseur
  investor_flags: InvestorFlag[];

  // Comparaison concurrent (optionnel)
  competitor_comparison?: CompetitorComparison;

  // Synthèse exécutive
  verdict_investisseur: string;
  forces: string[];
  risques: string[];

  // Survie (si disponible)
  survival_36m?: number;
  survival_36m_lo?: number;
  survival_36m_hi?: number;
  risk_profile?: string;

  // FSF / métriques financières (si disponibles)
  fsf_score?: number;
  fsf_label?: string;
  survival_18m?: number;

  // C-index
  c_index_display?: string;
  c_index_interpretation?: string;
  epv_note?: string;

  // Supervision humaine (F4)
  human_review_gate?: HumanReviewGate;

  srd_score?: number;
  irocr_score?: number;

  /**
   * [FIX 12/07/2026] Synthèse de l'intelligence externe (presse, fondateurs,
   * marchés publics) — auparavant collectée mais jamais restituée dans le
   * rapport investisseur. Voir note sur IROResult.webIntelligence.
   */
  external_intelligence?: ExternalIntelligenceSummary;
}

export interface ExternalIntelligenceSummary {
  presse: {
    highlights: string | null;
    sentiment: 'positif' | 'neutre' | 'négatif' | 'mixte' | null;
    sources_queried: string[];
    confidence: 'high' | 'medium' | 'low';
    /**
     * [v8.0] Champs suivants renseignés uniquement quand la source est le
     * pipeline Presse Intelligence exhaustif (press-intelligence.ts) plutôt
     * que la revue de presse superficielle de web-intelligence.ts.
     */
    timeline?: { periode: string; evenement: string; type: string }[];
    contradictions?: { claim_pitch: string; realite_presse: string; severite: 'mineure' | 'majeure' | 'bloquante' }[];
    articles_count?: number;
    source?: 'press_intelligence' | 'web_intelligence';
  } | null;
  fondateurs: {
    contexte: string | null;         // gch_fondateurs_context (résumé pré-formaté)
    key_person_risk: boolean;
    rev11_triggered: boolean;        // fondateur unique → fondateur unique → plafond GCH=1
    rev12_triggered: boolean;        // aucun background documenté
  } | null;
  marches_publics: {
    montant_total_eur: number;
    nb_marches: number;
  } | null;
  brevets_publications: {
    brevets_count: string | null;
    publications_count: string | null;
  } | null;
  fetched_at: string | null;
}

/**
 * Interface pour l'annotation en aveugle
 */
export interface BlindAnnotation {
  entry_id:        string;
  annotator_id:    string;         // anonymisé (A1, A2, ...)
  annotation_date: string;         // ISO
  outcome_blind:   { event: 0 | 1; t_event_mois: number };
  annotator_knows_outcome: false;  // invariant — toujours false pour blind
  icc_eligible:    boolean;        // true si double-annoté
}

export interface ICCResult {
  method:       'cohen_kappa' | 'krippendorff_alpha';
  value:        number;
  n_pairs:      number;
  ci_lo:        number;
  ci_hi:        number;
  interpretation: 'insufficient' | 'acceptable' | 'good' | 'excellent';
  computed_at:  string;
  annotation_ids: string[];
}

export interface HumanReviewGate {
  requires_review:   boolean;
  trigger_reason:    string | null;
  iro_cr:            number;
  critical_flags:    string[];
  review_status:     'not_required' | 'pending' | 'approved' | 'modified';
  approved_by:       string | null;
  approved_at:       string | null;
}
