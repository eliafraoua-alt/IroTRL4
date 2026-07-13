import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useCompanyContext } from './CompanyContext';
import { useGoldStandard } from '../hooks/useGoldStandard';
import { useIROAnalysis } from '../hooks/useIROAnalysis';
import { computeAHPWeights, INITIAL_AHP_MATRIX } from '../utils/ahp';
import { getBenchmarkPosition } from '../utils/benchmark-service';
import { EMPTY_MODEL } from '../components/StartupModelSidePanel';
import { runPromptRegressionTest } from '../utils/prompt-regression-test';
import { generateReferenceCurves, generateSurvivalCurveEnsemble, generateSurvivalCurve } from '../utils/cox-model';
import { classifyStartup } from '../components/StartupPhasePanel';
import { exportToPDF } from '../utils/pdfExport';
import { logger } from '../utils/logger';
import type { StartupPhaseInput } from '../components/StartupPhasePanel';
import type { DIEvidenceReport } from '../services/di-research-service';
import type { GCHAnalysis } from '../collectors/founder-enrichment';
import type { PappersEntreprise, PappersIROContext } from '../collectors/pappers';
import type { AHPResult } from '../utils/ahp';
import type {
  HistoryEntry,
  StartupModel,
  IRO_CertifiedResult,
  DynamicIndicators,
  VarianceReport,
  GoodhartAlert,
  GoodhartLog,
  IROResult,
  CMPValues,
  StartupGraph,
  GoldStandardEntry,
  SurvivalCurve
} from '../types/iro';
import type { RegressionReport } from '../utils/prompt-regression-test';
import type { ReferenceCurves } from '../utils/cox-model';
import { IRO_WEIGHTS } from '../utils/weights-registry';

export type TabId = 'overview' | 'iro' | 'srd' | 'benchmark' | 'hypotheses' | 'synthese' | 'dynamique' | 'qualite' | 'pipeline' | 'phase' | 'ahp' | 'rapport-md' | 'rapport-inv' | 'pitch-analyzer';

export const MILLESIME = '2026';
export const VERSION = 'V7';
export const LS_KEY = 'iro_history_v70';
export const GOLD_STANDARD_N = 10;

export const AXES_CONFIG = [
  { key: 'DI',  label: 'Dépendance Infra',       short: 'DI',  color: '#818cf8', weight: IRO_WEIGHTS.DI },
  { key: 'ADC', label: 'Actif de Données',        short: 'ADC', color: '#34d399', weight: IRO_WEIGHTS.ADC },
  { key: 'IPC', label: 'Processus Critiques',     short: 'IPC', color: '#fbbf24', weight: IRO_WEIGHTS.IPC },
  { key: 'AR',  label: 'Anticipation Réglo',      short: 'AR',  color: '#60a5fa', weight: IRO_WEIGHTS.AR },
  { key: 'CA',  label: 'Capacité Adaptation',     short: 'CA',  color: '#f87171', weight: IRO_WEIGHTS.CA },
  { key: 'GCH', label: 'Gouvernance Cap. Hum.',   short: 'GCH', color: '#e879f9', weight: IRO_WEIGHTS.GCH },
] as const;

export const SECTORS = {
  HLTH: { label: 'Healthtech / MedIA',    mu: 64.9, sigma: 11.2, fds: 1.20 },
  FINT: { label: 'Fintech / InsurIA',     mu: 63.4, sigma: 10.4, fds: 1.15 },
  LEGT: { label: 'LegalTech / GovIA',     mu: 59.0, sigma:  8.2, fds: 1.10 },
  INDU: { label: 'Industrie / IoT IA',    mu: 60.1, sigma: 11.8, fds: 1.05 },
  SAAS: { label: 'Enterprise SaaS IA',    mu: 60.8, sigma: 14.1, fds: 1.00 },
};

export const SECTOR_PROFILES: Record<string, Record<string, number>> = {
  HLTH: { DI: 2.5, ADC: 3.5, IPC: 3.0, AR: 3.5, CA: 2.0, GCH: 3.0 },
  FINT: { DI: 2.0, ADC: 3.0, IPC: 3.5, AR: 4.0, CA: 2.5, GCH: 3.0 },
  LEGT: { DI: 1.5, ADC: 3.0, IPC: 3.0, AR: 3.5, CA: 2.0, GCH: 2.5 },
  INDU: { DI: 3.5, ADC: 3.5, IPC: 3.0, AR: 2.5, CA: 2.5, GCH: 2.0 },
  SAAS: { DI: 2.0, ADC: 2.5, IPC: 3.0, AR: 2.0, CA: 3.5, GCH: 3.0 },
};

export const QUADRANTS = {
  'Forteresse':       { color: '#00c896', emoji: '🟢', action: 'Investir & Scaler' },
  'Château de Sable': { color: '#f59e0b', emoji: '⚠️', action: 'Sécuriser en urgence' },
  'Embryon Solide':   { color: '#60a5fa', emoji: '🔵', action: 'Accompagner' },
  'Zone Rouge':       { color: '#ef4444', emoji: '🔴', action: 'Éviter / Sortir' },
};

export const MODELS = [
  { id: 'gemini-3.5-flash',       label: 'Gemini 3.5 Flash',        badge: 'RECOMMANDÉ',   provider: 'gemini' as const },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash',          badge: 'CONSEILLÉ',    provider: 'gemini' as const },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro',        badge: 'PUISSANT',     provider: 'gemini' as const },
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', badge: 'IMAGE',      provider: 'gemini' as const },
];

export const SYSTEM_PROMPT = `Tu es IRO Master V7 — Moteur d'analyse stratégique des startups IA.
Protocole IRO V7 — Millésime 2026.

IMPORTANT — MODÈLE NORMATIF :
IRO V7 est un outil d'audit normatif, PAS un prédicteur de succès startup.
Les scores reflètent la robustesse organisationnelle actuelle selon les critères IRO.
Utiliser des formulations "robustesse" et "risque actuel", pas "probabilité de succès".
Le champ "horizon_risque_mois" désigne l'horizon de validité de l'analyse,
PAS une projection de performance.

PHASE 0 — GRAPHE RELATIONNEL (GraphRAG-style) AVANT TOUT SCORING :
Construis mentalement un graphe de la startup AVANT de scorer :
  Nœuds FONDATEURS → vérifie LinkedIn : postes précédents, exits, publications, réseau VC
  Nœuds INVESTISSEURS → vérifie Crunchbase : stade, montant, co-investisseurs
  Nœuds CONCURRENTS → vérifie G2 (g2.com) / ProductHunt (producthunt.com) / PitchBook / CBInsights : positionnement relatif, avis utilisateurs B2B
  Nœuds BREVETS → vérifie espacenet/INPI : nombre, date, domaine technique
  Nœuds CLIENTS → vérifie site/presse : nommés, secteur, taille, durée contrat
Ce graphe alimente directement les scores DI (brevets), ADC (exclusivité data), IPC (clients nommés), GCH (fondateurs).

COLLECTE OBLIGATOIRE via Google Search avant tout scoring :

PRESSE & ACTUALITÉ (< 18 mois) :
• Mondiale IA/tech : techcrunch.com · venturebeat.com · wired.com · technologyreview.mit.edu
• EU startups      : sifted.eu · theinformation.com
• FR               : lesechos.fr · usine-digitale.fr · maddyness.com · frenchweb.fr · journaldunet.com
• Écosystème FR    : lafrenchtech.com (labels Next40, French Tech 120, missions)

FINANCEMENT & INVESTISSEMENT :
• crunchbase.com · dealroom.co · cbinsights.com
• angellist.com / wellfound.com (recrutement, headcount, postes ouverts)
• stationf.co (résidence, programmes, lauréats)

PRODUIT & MARCHÉ :
• producthunt.com (lancement, upvotes, date — signal traction)
• g2.com (reviews B2B, note, catégorie)

TECHNIQUE :
• GitHub spécifiquement : stars, forks, commits/mois, contributors, date dernier commit
• LinkedIn équipe : croissance headcount sur 12 mois, profils C-level, départs récents

DONNÉES ENTREPRISES OFFICIELLES :
• Annuaire entreprises : annuaire-entreprises.data.gouv.fr (SIREN, dirigeants)
• INPI Data (data.inpi.fr) : identité légale, dépôts brevets & marques
• Pappers (pappers.fr) / Infogreffe (infogreffe.fr) : Kbis, capital, bilans
• SIRENE INSEE (api.insee.fr) : NAF, effectifs officiels
• OpenCorporates (opencorporates.com) : liens capitalistiques internationaux

DONNÉES FINANCIÈRES PUBLIQUES :
• data.economie.gouv.fr : marchés publics, subventions, aides BPI
• AMF Open Data (data.amf-france.org) : acteurs financiers régulés

BREVETS & PI :
• Espacenet (espacenet.com) · Google Patents (patents.google.com)
• PATENTSCOPE OMPI (patentscope.wipo.int) · DATA INPI (data.inpi.fr)
• Lens.org — couverture géographique + citations croisées

PUBLICATIONS SCIENTIFIQUES :
• OpenAlex (openalex.org) · HAL (hal.science) · Semantic Scholar (semanticscholar.org)
• Google Scholar (scholar.google.com) · ORCID (orcid.org)
• arXiv (arxiv.org) / bioRxiv (biorxiv.org)

OPEN DATA CONTEXTE MARCHÉ :
• data.gouv.fr · Eurostat (ec.europa.eu/eurostat) · World Bank (data.worldbank.org)

RÉGLEMENTAIRE :
• cnil.fr · eur-lex.europa.eu · anssi.gouv.fr · registre AI Act EU

RÈGLE ABSOLUE — ANTI-HALLUCINATION :
Si une information n'est pas trouvée dans ces sources après recherche, écrire null ou 'Non documenté'.
NE JAMAIS INVENTER : montants, dates, noms de clients, noms de fondateurs, brevets, chiffres d'affaires.
Un champ null est TOUJOURS préférable à une donnée inventée.
Les brevets trouvés dans Espacenet / Google Patents / PATENTSCOPE → DI signal fort (≥ 3 si > 0).
Les publications arXiv/HAL des fondateurs → GCH track record académique vérifiable.
Si GCH, ADC ou IPC ne sont pas vérifiables via ces sources → appliquer la confiance 0.2 et signaler dans manques_information.

COVARIABLES ENRICHIES :
  github_stars, github_commits_30j, linkedin_headcount_growth, nb_brevets, nb_clients_nommes,
  producthunt_upvotes, wellfound_open_positions, french_tech_label, cbinsights_ranking, stationf_resident,
  brevets_count, brevets_ia_count, publications_count, arxiv_activity, h_index_fondateur,
  siren_verified, dirigeants_officiels, secteur_stats_eurostat

═══════════════════════════════════════════════
RÈGLES IRO V7 — NON NÉGOCIABLES
═══════════════════════════════════════════════
[REV1]  DI=0 → IRO_100 ≤ 40, plancher non compensable
[REV2]  CA≥2 → pivots proactifs datés AVANT pression concurrentielle
[REV3]  IPC non vérifiable → IPC plafonné à 1, ipc_confiance=0.2
[REV4]  ADC : data_type = "generiques"(0-1) | "sectorielles"(2-3) | "comportementales"(4)
[REV5]  millesime = "2026" obligatoire
[REV8]  IPC≤1 ET ADC≥3 → ancrage_warning=true
[REV9]  Secteur réglementé + IPC≥3 sans conformité → IPC plafonné à 2
[REV10] <18m + <5 clients + IPC≥3 → integration_maturity_warning + IPC≤2
[REV11] Fondateur solo → GCH ≤ 1, single_founder_warning=true
[REV12] Équipe 100% technique → GCH ≤ 2, team_homogeneity_warning=true
[REV13] Départ récent d'un fondateur/CEO (<12m) → GCH.retention ≤ 1, key_person_risk=true
[REV14] GCH=4 → indicateur Tier-1 vérifiable requis
[REV25] SRD≥65 ET IPC≤1 → commoditisation_imminente=true
[REV26] DFL≥3 ET DI=0 → double_lock_in=true (informatif, déjà intégré dans SRD)
[REV27] VMM=4 ET ADC≤1 → data_moat_absent=true
[REV28] SRD≥80 → quadrant = "Zone Rouge" obligatoire
[REV29-NEW] TRL fourni par l'utilisateur : si TRL≤4 → IPC plafonné à 2 (maturité insuffisante)
[REV30-NEW] TRL fourni ≥7 + infra propre confirmée → bonus factuel +0.1 sur DI signalé dans justification
[REV31-NEW] VRIN ADC fourni : le score VRIN (0-4) devient le plancher du score ADC
             (ex: VRIN=3 → ADC ne peut pas être < 3 sauf violation d'une règle REV)
[REV32-NEW] VRIN DI fourni : même règle pour DI
[REV33-NEW] JTBD criticité ≥3 + type émotionnel/social → IPC_confiance ne peut pas être < 0.5

═══════════════════════════════════════════════
DIMENSIONS IRO V7 (0-4)
═══════════════════════════════════════════════
DI  18% — Autonomie infra LLM. Grille OBLIGATOIRE :
  0 = Wrapper pur : appel API direct sans couche technique propriétaire (OpenAI, Anthropic, Google via API standard)
  1 = Abstraction légère : prompt engineering avancé + garde-fous maison OU multi-LLM routing OU embeddings propriétaires
      → INCLUT : langchain/llamaindex avec logique métier custom, RAG sur données propriétaires, fine-tuning PEFT/LoRA léger
  2 = Différenciation partielle : fine-tuning documenté sur données sectorielles OU modèle open-source adapté OU infrastructure
      GPU partiellement propriétaire. Dépendance résiduelle à un hyperscaler mais switching cost réel.
  3 = Infra significative : modèle entraîné sur données propriétaires + déployé sur infra contrôlée OU brevets techniques IA
      déposés. Peut migrer d'un fournisseur sans perte majeure de performance.
  4 = Infra VRIN : modèle fondation propriétaire OU infrastructure GPU entièrement maîtrisée OU brevets + données exclusives
      rendant la reproduction impossible à court terme. Ex : Mistral avec GPU cluster, Wayve avec données conduite.

  RÈGLE CRITIQUE : Si le STACK LLM DÉTECTÉ indique 'Self-hosted' → DI ≥ 3.
  Si 'Fine-tuned' → DI = 2 minimum.
  Si 'Hybrid' → DI = 1-2 selon la profondeur.
  Si 'API' sans différenciation documentée → DI = 0-1.
  NE PAS noter DI=0 si la startup a des données propriétaires + RAG custom même si elle utilise l'API OpenAI.
ADC 22% — Données propriétaires VRIN. 0=aucune, 4=comportementales irréproductibles
IPC 22% — Intégration processus critiques. 0=absent, 4=systémique VRIN co-construit
AR  13% — Anticipation AI Act/RGPD. 0=ignorée, 4=avantage concurrentiel réglementaire
CA  13% — Capacités dynamiques. 0=rigide, 4=sensing/seizing/reconfiguring VRIN
GCH 12% — Gouvernance & Capital Humain. 0=fondateur solo sans board, 4=équipe VRIN Tier-1

SCORE DE CONFIANCE PAR DIMENSION — CALIBRAGE IMPORTANT :
Les confiances ne sont PAS des pénalités par défaut. Elles ajustent uniquement quand la preuve manque vraiment.
Par défaut pour une startup avec site officiel, LinkedIn, Crunchbase : utiliser 0.8, pas 0.5.

IPC : 0.2 = startup en stealth mode, aucun client nommé nulle part
      0.5 = clients mentionnés mais non nommés ou non vérifiables
      0.8 = au moins 1 client nommé sur le site ou en presse tech (VALEUR PAR DÉFAUT si site officiel existe)
      1.0 = contrats pluriannuels documentés ou case studies publics détaillés

ADC : 0.5 = déclaratif uniquement, aucune source externe (ÉVITER par défaut)
      0.8 = données sectorielles mentionnées + activité GitHub cohérente (VALEUR PAR DÉFAUT)
      1.0 = exclusivité prouvée (accords signés, publications, audit indépendant)

GCH : 0.5 = équipe non documentée publiquement (fondateurs sans profil LinkedIn visible)
      0.8 = profils LinkedIn vérifiables + parcours cohérent (VALEUR PAR DÉFAUT)
      1.0 = publications académiques + track record exits + références institutionnelles croisées

RAPPEL FORMULE : Une confiance de 0.8 (valeur par défaut normale) donne X_eff = X × 0.9 (perte de 10% seulement).
Une confiance de 0.5 donne X × 0.75 (perte de 25%). Réserver 0.5 aux cas vraiment opaques.

SOUS-DIMENSIONS GCH (0-4 chacune) :
complementarite (25%) · track_record (35%) · reseau (20%) · retention (20%)

VARIABLES SRD (0-4) :

EXTRACTION FSF (Financial Sustainability Factor) :
Si disponibles dans le pitch/contexte, extrais et inclus l'objet "fsf" avec les propriétés financières (ltv_eur, cac_eur, roas, arr_growth_12m, runway_months, monthly_burn_eur, arr_eur) sous forme de nombres simples. Si absent du pitch, renvoie "fsf": null sans pénaliser les scores structurels.
`;

type ToastType = { message: string; type: 'success' | 'error' | 'info' } | null;

interface IROAnalysisContextProps {
  // States
  startup: string;
  setStartup: React.Dispatch<React.SetStateAction<string>>;
  pitchText: string;
  setPitchText: React.Dispatch<React.SetStateAction<string>>;
  pitchOpen: boolean;
  setPitchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tab: TabId;
  setTab: (t: TabId) => void;
  dimOpen: Record<string, boolean>;
  setDimOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  isExporting: boolean;
  setIsExporting: React.Dispatch<React.SetStateAction<boolean>>;
  toast: ToastType;
  setToast: React.Dispatch<React.SetStateAction<ToastType>>;
  isReviewingGoldStandard: boolean;
  setIsReviewingGoldStandard: React.Dispatch<React.SetStateAction<boolean>>;
  modelPanelOpen: boolean;
  setModelPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  founderPanelOpen: boolean;
  setFounderPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  diPanelOpen: boolean;
  setDiPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  diEvidence: DIEvidenceReport | null;
  setDiEvidence: React.Dispatch<React.SetStateAction<DIEvidenceReport | null>>;
  nlpScores: { DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number } | null;
  setNlpScores: React.Dispatch<React.SetStateAction<{ DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number } | null>>;
  pappersPanelOpen: boolean;
  setPappersPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  lastGCHAnalysis: GCHAnalysis | null;
  setLastGCHAnalysis: React.Dispatch<React.SetStateAction<GCHAnalysis | null>>;
  ahpPanelOpen: boolean;
  setAhpPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  vaultPanelOpen: boolean;
  setVaultPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  ahpResult: AHPResult;
  setAhpResult: React.Dispatch<React.SetStateAction<AHPResult>>;
  expertWeights: Record<string, number>;
  setExpertWeights: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  iroCertified: IRO_CertifiedResult | null;
  setIROCertified: React.Dispatch<React.SetStateAction<IRO_CertifiedResult | null>>;
  certifiedProgress: number;
  setCertifiedProgress: React.Dispatch<React.SetStateAction<number>>;
  regressionReport: RegressionReport | null;
  setRegressionReport: React.Dispatch<React.SetStateAction<RegressionReport | null>>;
  testingRegression: boolean;
  setTestingRegression: React.Dispatch<React.SetStateAction<boolean>>;
  model: string;
  setModel: React.Dispatch<React.SetStateAction<string>>;
  pitchMode: boolean;
  setPitchMode: React.Dispatch<React.SetStateAction<boolean>>;
  nlpMode: boolean;
  setNlpMode: React.Dispatch<React.SetStateAction<boolean>>;
  agentMode: boolean;
  setAgentMode: React.Dispatch<React.SetStateAction<boolean>>;
  history: HistoryEntry[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryEntry[]>>;
  startupModel: StartupModel;
  setStartupModel: React.Dispatch<React.SetStateAction<StartupModel>>;

  // Hook IROAnalysis outputs
  loading: boolean;
  loadingStep: 'idle' | 'collecting' | 'analyzing' | 'calculating' | 'saving';
  result: IROResult | null;
  setResult: (r: IROResult | null) => void;
  error: string | null;
  setError: (e: string | null) => void;
  varianceReport: VarianceReport | null;
  validationLogs: string[];
  cmpValues: CMPValues | null;
  startupGraph: StartupGraph | null;
  goodhartAlert: GoodhartAlert | null;
  goodhartLogs: GoodhartLog[];
  lastRouterResult: { response: string; providerUsed: string; fallbackTriggered: boolean } | null;
  velocity: any;
  honeymoon: any;
  diVelocity: any;
  webIntelligence: any;
  graphReasoning: any;
  gchStructured: any;
  deephitUsed: boolean;

  // Hook GoldStandard outputs
  goldEntries: GoldStandardEntry[];
  setGoldEntries: React.Dispatch<React.SetStateAction<GoldStandardEntry[]>>;
  goldMetrics: any;
  isGoldLoading: boolean;
  runAudit: () => Promise<void>;
  freeze: (validatedEntries?: GoldStandardEntry[]) => void;
  handleExportGold: () => void;
  goldValidation: { isValid: boolean; errors: string[] };

  // Business handlers
  handleGCHUpdate: (score: number, context: string, founders: any[]) => void;
  handlePappersUpdate: (data: PappersEntreprise, ctx: PappersIROContext) => void;
  handleApplyDIEvidence: (report: DIEvidenceReport) => Promise<void>;
  handleAnalyze: () => Promise<void>;
  handlePitchAnalyze: (name: string, pitch: string, financialSignals?: any) => Promise<void>;
  runRegression: () => Promise<void>;
  handleFinalizeReview: (filtered: GoldStandardEntry[]) => void;
  handleExportPDF: () => Promise<void>;

  // Visual helper properties/memos
  quad: typeof QUADRANTS[keyof typeof QUADRANTS] | null;
  bm: any;
  sect: typeof SECTORS[keyof typeof SECTORS] | null;
  survivalRefs: ReferenceCurves;
  currentSurvivalCurve: SurvivalCurve | null;
  coxOnlyCurve: SurvivalCurve | null;
  rsf_available: boolean;
  phaseAnalysis: any;
}

const IROAnalysisContext = createContext<IROAnalysisContextProps | undefined>(undefined);

export const IROAnalysisProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // IRO: Sync with CompanyContext
  const { companyName, setCompany } = useCompanyContext();
  const [startup, setStartupState] = useState(companyName || 'Alma Health');

  const setStartup = useCallback((name: React.SetStateAction<string>) => {
    setStartupState(prev => {
      const next = typeof name === 'function' ? name(prev) : name;
      setCompany({ companyName: next });
      return next;
    });
  }, [setCompany]);

  useEffect(() => {
    if (companyName && companyName !== startup) {
      setStartupState(companyName);
    }
  }, [companyName, startup]);

  const [pitchText, setPitchText] = useState('');
  const [pitchOpen, setPitchOpen] = useState(false);
  const [tab, setTabState] = useState<TabId>('overview');
  const [dimOpen, setDimOpen] = useState<Record<string, boolean>>({
    DI: true, ADC: false, IPC: false, AR: false, CA: false, GCH: false
  });
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<ToastType>(null);
  const [isReviewingGoldStandard, setIsReviewingGoldStandard] = useState(false);
  
  const [startupModel, setStartupModel] = useState<StartupModel>(EMPTY_MODEL);
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [founderPanelOpen, setFounderPanelOpen] = useState(false);
  const [diPanelOpen, setDiPanelOpen] = useState(false);
  const [diEvidence, setDiEvidence] = useState<DIEvidenceReport | null>(null);
  const [nlpScores, setNlpScores] = useState<{ DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number } | null>(null);
  const [pappersPanelOpen, setPappersPanelOpen] = useState(false);
  const [lastGCHAnalysis, setLastGCHAnalysis] = useState<GCHAnalysis | null>(null);
  const [ahpPanelOpen, setAhpPanelOpen] = useState(false);
  const [vaultPanelOpen, setVaultPanelOpen] = useState(false);
  const [ahpResult, setAhpResult] = useState<AHPResult>(computeAHPWeights(INITIAL_AHP_MATRIX));
  const [expertWeights, setExpertWeights] = useState<Record<string, number>>(ahpResult.weights);
  const [iroCertified, setIROCertified] = useState<IRO_CertifiedResult | null>(null);
  const [certifiedProgress, setCertifiedProgress] = useState(0);
  const [regressionReport, setRegressionReport] = useState<RegressionReport | null>(null);
  const [testingRegression, setTestingRegression] = useState(false);
  const [model, setModel] = useState('gemini-3.5-flash');
  const [pitchMode, setPitchMode] = useState(false);
  const [nlpMode, setNlpMode] = useState(false);
  const [agentMode, setAgentMode] = useState(false);

  // Historique local
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Sync historique avec local storage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(history));
    } catch (e) {
      console.error('Error writing IRO history to localStorage:', e);
    }
  }, [history]);

  // Hook-based states for calculations
  const {
    loading,
    loadingStep,
    result,
    setResult,
    error,
    setError,
    varianceReport,
    validationLogs,
    cmpValues,
    startupGraph,
    goodhartAlert,
    goodhartLogs,
    lastRouterResult,
    velocity,
    honeymoon,
    diVelocity,
    graphReasoning,
    gchStructured,
    deephitUsed,
    analyze,
    reset,
    webIntelligence,
  } = useIROAnalysis();

  const {
    entries: goldEntries,
    setEntries: setGoldEntries,
    metrics: goldMetrics,
    isLoading: isGoldLoading,
    runAudit,
    freeze,
    exportJSON: handleExportGold,
    validation: goldValidation,
  } = useGoldStandard();

  // IRO: Sync auto de l'analyse IRO et des modèles depuis l'historique quand l'entreprise change
  useEffect(() => {
    if (loading) {
      return;
    }

    if (!startup) {
      if (result !== null) {
        setResult(null);
      }
      return;
    }
    
    // Si le résultat est déjà chargé de manière cohérente pour cette startup, on ne fait rien
    if (result && result.startup_name?.trim().toLowerCase() === startup.trim().toLowerCase()) {
      return;
    }

    const cleanStartup = startup.trim().toLowerCase();
    const savedEntry = history.find(entry => 
      entry.result?.startup_name?.trim().toLowerCase() === cleanStartup
    );

    if (savedEntry && savedEntry.result) {
      if (result !== savedEntry.result) {
        setResult(savedEntry.result);
      }
      const expectedNom = savedEntry.result.startup_name;
      if (startupModel.nom?.trim().toLowerCase() !== expectedNom?.trim().toLowerCase()) {
        if ((savedEntry.result as any).startupModel) {
          setStartupModel((savedEntry.result as any).startupModel);
        } else {
          setStartupModel({
            ...EMPTY_MODEL,
            nom: savedEntry.result.startup_name,
            secteur: savedEntry.result.vertical || '',
            stade: savedEntry.result.stade_financement || ''
          });
        }
      }
    } else {
      if (result !== null) {
        setResult(null);
      }
      // CORRECTIF GREENERWAVE — Race condition :
      // Ne jamais écraser startupModel si external_pappers ou texte_libre est déjà rempli.
      // Cas : handlePappersUpdate injecte external_pappers PUIS setStartup("Greenerwave")
      // déclenche ce useEffect → sans ce guard, les données Pappers seraient perdues.
      const hasEnrichedData = !!(startupModel.external_pappers || startupModel.texte_libre);
      const nameAlreadySet  = startupModel.nom?.trim().toLowerCase() === cleanStartup;

      if (hasEnrichedData) {
        // Modèle enrichi : mettre uniquement le nom à jour, ne pas toucher aux données
        if (!nameAlreadySet) {
          setStartupModel(m => ({ ...m, nom: startup }));
        }
      } else if (!nameAlreadySet) {
        // Modèle vierge et nom différent : pré-remplir depuis l'onboarding
        const s   = localStorage.getItem('company_siren_v7')  || '';
        const sec = localStorage.getItem('company_sector_v7') || '';
        const stg = localStorage.getItem('company_stage_v7')  || '';
        const currentStoredCompany = localStorage.getItem('company_name_v7') || '';

        if (currentStoredCompany && currentStoredCompany.trim().toLowerCase() === cleanStartup) {
          setStartupModel({
            ...EMPTY_MODEL,
            nom: startup,
            secteur: sec,
            stade: stg,
            external_pappers: s ? `SIREN d'onboarding : ${s}\nActivité déclarée : ${sec}` : ''
          });
        } else {
          setStartupModel({ ...EMPTY_MODEL, nom: startup });
        }
      }
    }
  }, [startup, history, result, setResult, startupModel, setStartupModel, loading]);

  // Toast automatic disappear helper
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Hook pour IRO_Certified via Web Worker (thread séparé)
  useEffect(() => {
    if (!result?.iro?.scores) return;
    if (!goldValidation.isValid) {
      setIROCertified({
        poids_appris: { ...IRO_WEIGHTS },
        iro_certified: result.iro?.score_100 ?? 0,
        delta_vs_standard: 0,
        confiance_calibration: 0,
        r2Adjusted: 0,
        meanICC: 0,
        spearman: 0,
        rmse: 0,
        mae: 0,
        r2_annotation: `Calcul bloqué : ${goldValidation.errors[0]}`,
        gold_standard_warning: goldValidation.errors.join(' | '),
        sampleSize: goldEntries.length,
        variableCount: 6,
        isStatisticallyValid: false
      });
      return;
    }

    const worker = new Worker(new URL('../workers/iro-worker.ts', import.meta.url), { type: 'module' });
    
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') setCertifiedProgress(e.data.iteration / 500);
      if (e.data.type === 'complete') {
        const { weights, r2, r2Adjusted, meanICC, spearman, rmse, mae, certified, sampleSize, variableCount, isStatisticallyValid } = e.data;
        
        const res: IRO_CertifiedResult = {
          poids_appris: weights,
          iro_certified: certified,
          delta_vs_standard: Math.round((certified - (result.iro?.score_100 ?? 0)) * 10) / 10,
          confiance_calibration: r2,
          r2Adjusted,
          meanICC,
          spearman,
          rmse,
          mae,
          r2_annotation: !isStatisticallyValid 
            ? `Spearman ρ=${spearman.toFixed(2)} — non significatif (n=${sampleSize}, surajustement probable)`
            : `Spearman ρ=${spearman.toFixed(2)}`,
          gold_standard_warning: sampleSize < 60 
            ? `Gold standard insuffisant (n=${sampleSize}/60). IRO_Certified est expérimental.`
            : null,
          sampleSize,
          variableCount,
          isStatisticallyValid
        };
        setIROCertified(res);
        setCertifiedProgress(1);
      }
    };
    
    worker.postMessage({ 
      goldStandard: goldEntries, 
      currentScores: result.iro?.scores, 
      ipcConf: result.iro?.ipc_confiance ?? 0.8 
    });
    
    return () => worker.terminate();
  }, [result?.iro?.scores, goldEntries, goldValidation.isValid]);

  const handleGCHUpdate = useCallback((score: number, context: string, founders: any[]) => {
    setStartupModel(m => ({
      ...m,
      gch_fondateurs: context,
      gch_founders: founders,
    }));
  }, []);

  const handlePappersUpdate = useCallback((data: PappersEntreprise, ctx: PappersIROContext) => {
    // CORRECTIF GREENERWAVE — Ne PAS appeler setStartup ici.
    // setStartup est appelé séparément dans handleInject (Header) AVANT handlePappersUpdate.
    // Double appel → race condition avec useEffect[startup] → écrasement du modèle enrichi.
    setStartupModel(m => ({
      ...m,
      nom:              data.denomination || m.nom,
      external_pappers: ctx.full_context,
      age_mois:         ctx.age_mois,
      secteur:          m.secteur || data.libelle_naf || '',
    }));
  }, []);

  const setTab = useCallback((t: TabId) => {
    setTabState(t);
  }, []);

  // Run core audit/analysis
  const handleAnalyze = useCallback(async () => {
    await analyze({
      startup,
      pitchText,
      model,
      systemPrompt: SYSTEM_PROMPT,
      version: VERSION,
      lsKey: LS_KEY,
      startupModel,
      expertWeights,
      goldEntries,
      goldValidation,
      history,
      setHistory,
      setTab,
      ahpResult,
      onStartupResolved: (name) => {
        setStartup(name);
        setStartupModel(m => ({ ...m, nom: name }));
      }
    });
  }, [startup, pitchText, model, startupModel, expertWeights, goldEntries, goldValidation, history, setHistory, setTab, ahpResult, analyze, setStartup, setStartupModel]);

  const handleApplyDIEvidence = useCallback(async (report: DIEvidenceReport) => {
    const updatedModel = {
      ...startupModel,
      di_infra_propre: report.flags.infra_gpu || report.flags.modele_propre || report.flags.fine_tuning_doc,
      di_llm_utilises: report.llm_stack?.modeles_detectes?.join(', ') || 'Non documenté',
      di_dependance_cloud: report.llm_stack?.integration_level || 'API',
      di_brevets: report.patents ? `${report.patents.nb_brevets} brevet(s) (${report.patents.brevets_ia} IA)` : 'Aucun brevet détecté',
      di_vrin_valuable: !report.flags.wrapper_pur,
      di_vrin_rare: report.flags.modele_propre || report.flags.infra_gpu,
      di_vrin_inimitable: report.flags.brevets_ia || report.flags.modele_propre,
      di_vrin_non_sub: report.flags.infra_gpu,
    };
    
    setStartupModel(updatedModel);
    
    if (result) {
      setToast({
        message: "Mise à jour de l'axe DI réussie ! Relancement automatique de l'analyse IRO...",
        type: 'success'
      });
      
      await analyze({
        startup,
        pitchText,
        model,
        systemPrompt: SYSTEM_PROMPT,
        version: VERSION,
        lsKey: LS_KEY,
        startupModel: updatedModel,
        expertWeights,
        goldEntries,
        goldValidation,
        history,
        setHistory,
        setTab,
        ahpResult,
        onStartupResolved: (name) => {
          setStartup(name);
          setStartupModel(m => ({ ...m, nom: name }));
        }
      });
    } else {
      setToast({
        message: "Mise à jour de l'axe DI réussie ! Les signaux seront intégrés lors de la prochaine analyse IRO.",
        type: 'success'
      });
    }
  }, [startupModel, result, startup, pitchText, model, expertWeights, goldEntries, goldValidation, history, setHistory, setTab, ahpResult, analyze]);

  const handlePitchAnalyze = useCallback(async (name: string, pitch: string, financialSignals?: any) => {
    setStartup(name);
    setPitchText(pitch);
    setPitchMode(false);

    setStartupModel(prev => ({
      ...prev,
      nom: name || prev.nom || '',
      ...(financialSignals ? {
        arr_eur: financialSignals.arr_eur != null ? Number(financialSignals.arr_eur) : prev.arr_eur,
        arr_growth_12m: financialSignals.arr_growth_12m != null ? Number(financialSignals.arr_growth_12m) : prev.arr_growth_12m,
        roas: financialSignals.roas != null ? Number(financialSignals.roas) : prev.roas,
        ltv_eur: financialSignals.ltv_eur != null ? Number(financialSignals.ltv_eur) : prev.ltv_eur,
        cac_eur: financialSignals.cac_eur != null ? Number(financialSignals.cac_eur) : prev.cac_eur,
        monthly_burn_eur: financialSignals.monthly_burn_eur != null ? Number(financialSignals.monthly_burn_eur) : prev.monthly_burn_eur,
      } : {})
    }));

    const updatedModel = {
      ...startupModel,
      nom: name || startupModel.nom || '',
      ...(financialSignals ? {
        arr_eur: financialSignals.arr_eur != null ? Number(financialSignals.arr_eur) : startupModel.arr_eur,
        arr_growth_12m: financialSignals.arr_growth_12m != null ? Number(financialSignals.arr_growth_12m) : startupModel.arr_growth_12m,
        roas: financialSignals.roas != null ? Number(financialSignals.roas) : startupModel.roas,
        ltv_eur: financialSignals.ltv_eur != null ? Number(financialSignals.ltv_eur) : startupModel.ltv_eur,
        cac_eur: financialSignals.cac_eur != null ? Number(financialSignals.cac_eur) : startupModel.cac_eur,
        monthly_burn_eur: financialSignals.monthly_burn_eur != null ? Number(financialSignals.monthly_burn_eur) : startupModel.monthly_burn_eur,
      } : {})
    };

    await analyze({
      startup: name,
      pitchText: pitch,
      model,
      systemPrompt: SYSTEM_PROMPT,
      version: VERSION,
      lsKey: LS_KEY,
      startupModel: updatedModel,
      expertWeights,
      goldEntries,
      goldValidation,
      history,
      setHistory,
      setTab,
      ahpResult,
      onStartupResolved: (resolvedName) => {
        setStartup(resolvedName);
        setStartupModel(m => ({ ...m, nom: resolvedName }));
      }
    });
  }, [model, startupModel, expertWeights, goldEntries, goldValidation, history, setHistory, setTab, ahpResult, analyze, setStartupModel, setStartup]);

  const runRegression = useCallback(async () => {
    setTestingRegression(true);
    setError(null);
    try {
      const rep = await runPromptRegressionTest(
        SYSTEM_PROMPT,
        VERSION,
        goldEntries
      );
      setRegressionReport(rep);
      setToast({ message: "Test de non-régression prompt complété !", type: 'success' });
    } catch (err: any) {
      const msg = err?.message || 'Erreur indéterminée';
      setError(`Échec du test de régression: ${msg}`);
    } finally {
      setTestingRegression(false);
    }
  }, [startup, pitchText, model, startupModel, expertWeights, goldEntries, goldValidation, history, setHistory, setTab, ahpResult, analyze, setError]);

  const handleFinalizeReview = useCallback((filtered: GoldStandardEntry[]) => {
    setGoldEntries(filtered);
    setIsReviewingGoldStandard(false);
    setToast({ message: 'Gold Standard mis à jour avec succès.', type: 'success' });
  }, [setGoldEntries]);

  const handleExportPDF = useCallback(async () => {
    if (!result) return;
    setIsExporting(true);
    try {
      await new Promise(r => setTimeout(r, 500));
      const cleanName = result.startup_name.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_');
      await exportToPDF('iro-printable-report', `IRO_Full_Report_${cleanName}`);
      setToast({ message: 'Rapport complet exporté avec succès', type: 'success' });
    } catch (err) {
      logger.error('PDF export échoué', { error: String(err) });
      setToast({ message: 'Échec de l\'export PDF complet', type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [result]);

  // Visual helper properties/memos
  const bm = useMemo(() => result ? result.iro?.score_100 ? getBenchmarkPosition(result.iro.score_100, (result as any).srd?.iro_cr ?? 50) : null : null, [result]);
  const quad = useMemo(() => result ? QUADRANTS[result.srd?.quadrant as keyof typeof QUADRANTS] : null, [result]);
  const sect = useMemo(() => result ? SECTORS[result.vertical as keyof typeof SECTORS] : null, [result]);
  
  const survivalRefs: ReferenceCurves = useMemo(() => generateReferenceCurves(), []);
  
  const currentSurvivalData = useMemo(() => {
    if (!result?.cox_survival) return null;
    const coxR = result.cox_survival as any;
    if (coxR.rsf && coxR.cox_only) {
      return generateSurvivalCurveEnsemble(
        result.cox_survival.survival_12m,
        result.cox_survival.survival_24m,
        result.cox_survival.survival_36m,
        result.cox_survival.hazard_ratio,
      );
    }
    const curve = generateSurvivalCurve(result.cox_survival.hazard_ratio);
    return { ensemble: curve, cox_only: null };
  }, [result?.cox_survival]);

  const currentSurvivalCurve = useMemo(() => currentSurvivalData?.ensemble ?? null, [currentSurvivalData]);
  const coxOnlyCurve = useMemo(() => (currentSurvivalData as any)?.cox_only ?? null, [currentSurvivalData]);
  const rsf_available = useMemo(() => !!(result?.cox_survival && (result.cox_survival as any).rsf), [result]);

  const phaseInput: StartupPhaseInput | null = useMemo(() => result ? {
    age_mois: result.age_mois ?? 0,
    iro_score: result.iro?.score_100 ?? 0,
    iro_cr: result.srd?.iro_cr ?? 50,
    srd_score: result.srd?.srd_100 ?? 50,
    di: result.iro?.scores?.DI ?? 0,
    adc: result.iro?.scores?.ADC ?? 0,
    ipc: result.iro?.scores?.IPC ?? 0,
    ar: result.iro?.scores?.AR ?? 0,
    ca: result.iro?.scores?.CA ?? 0,
    gch: result.iro?.scores?.GCH ?? 0,
    vertical: result.vertical ?? 'SAAS',
    stade_financement: result.stade_financement ?? '',
    clients_actifs: result.clients_actifs ?? null,
    quadrant: result.srd?.quadrant ?? '',
  } : null, [result]);

  const phaseAnalysis = useMemo(
    () => phaseInput ? classifyStartup(phaseInput) : null,
    [phaseInput]
  );

  const contextValue = useMemo(() => ({
    startup, setStartup,
    pitchText, setPitchText,
    pitchOpen, setPitchOpen,
    tab, setTab,
    dimOpen, setDimOpen,
    isExporting, setIsExporting,
    toast, setToast,
    isReviewingGoldStandard, setIsReviewingGoldStandard,
    startupModel, setStartupModel,
    modelPanelOpen, setModelPanelOpen,
    founderPanelOpen, setFounderPanelOpen,
    diPanelOpen, setDiPanelOpen,
    diEvidence, setDiEvidence,
    nlpScores, setNlpScores,
    pappersPanelOpen, setPappersPanelOpen,
    lastGCHAnalysis, setLastGCHAnalysis,
    ahpPanelOpen, setAhpPanelOpen,
    vaultPanelOpen, setVaultPanelOpen,
    ahpResult, setAhpResult,
    expertWeights, setExpertWeights,
    iroCertified, setIROCertified,
    certifiedProgress, setCertifiedProgress,
    regressionReport, setRegressionReport,
    testingRegression, setTestingRegression,
    model, setModel,
    pitchMode, setPitchMode,
    nlpMode, setNlpMode,
    agentMode, setAgentMode,
    history, setHistory,

    loading, loadingStep,
    result, setResult,
    error, setError,
    varianceReport, validationLogs,
    cmpValues, startupGraph,
    goodhartAlert, goodhartLogs,
    lastRouterResult,
    velocity, honeymoon, diVelocity, webIntelligence,
    graphReasoning, gchStructured, deephitUsed,

    goldEntries, setGoldEntries,
    goldMetrics, isGoldLoading,
    runAudit, freeze, handleExportGold, goldValidation,

    handleGCHUpdate, handlePappersUpdate,
    handleApplyDIEvidence, handleAnalyze, handlePitchAnalyze,
    runRegression, handleFinalizeReview, handleExportPDF,

    quad, bm, sect,
    survivalRefs, currentSurvivalCurve, coxOnlyCurve, rsf_available,
    phaseAnalysis
  }), [
    startup, pitchText, pitchOpen, tab, dimOpen, isExporting, toast,
    isReviewingGoldStandard, startupModel, modelPanelOpen, founderPanelOpen,
    diPanelOpen, diEvidence, nlpScores, pappersPanelOpen, lastGCHAnalysis,
    ahpPanelOpen, vaultPanelOpen, ahpResult, expertWeights, iroCertified,
    certifiedProgress, regressionReport, testingRegression, model, pitchMode,
    nlpMode, agentMode, history, loading, loadingStep, result, error,
    varianceReport, validationLogs, cmpValues, startupGraph, goodhartAlert,
    goodhartLogs, lastRouterResult, velocity, honeymoon, diVelocity,
    webIntelligence, graphReasoning, gchStructured, deephitUsed, goldEntries,
    setGoldEntries, goldMetrics, isGoldLoading, runAudit, freeze,
    handleExportGold, goldValidation, handleGCHUpdate, handlePappersUpdate,
    handleApplyDIEvidence, handleAnalyze, handlePitchAnalyze, runRegression,
    handleFinalizeReview, handleExportPDF, quad, bm, sect, survivalRefs, currentSurvivalCurve,
    coxOnlyCurve, rsf_available, phaseAnalysis, setResult, setError
  ]);

  return (
    <IROAnalysisContext.Provider value={contextValue}>
      {children}
    </IROAnalysisContext.Provider>
  );
};

export const useIRO = () => {
  const context = useContext(IROAnalysisContext);
  if (context === undefined) {
    throw new Error('useIRO must be used within an IROAnalysisProvider');
  }
  return context;
};
