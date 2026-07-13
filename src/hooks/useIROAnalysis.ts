/**
 * src/hooks/useIROAnalysis.ts
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CORRECTIF ARCH-02 (Audit OPRO v2.0 — Avril 2026)          ║
 * ║  Extraction de la fonction analyze() depuis App.tsx         ║
 * ║  God Component réduit de ~400 lignes                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Responsabilité unique : orchestration de l'analyse IRO.
 * - Collecte données externes (GitHub, financier)
 * - 3 passes LLM parallèles (REV20)
 * - Calculs IRO, SRD, CMP, interaction, Cox
 * - Détection Goodharting
 * - Persistance historique
 */

import { useState, useCallback } from 'react';
import { fetchFinancialData } from '../services/financialService';
import { fetchPappersComplete, mapPappersToFinancialData, mapPappersToIROContext, type PappersEntreprise } from '../collectors/pappers';
import { fetchWebIntelligence, formatWebIntelligenceContext, type WebIntelligence } from '../collectors/web-intelligence';
import { collectPressIntelligence, type PressIntelligenceResult } from '../collectors/press-intelligence';
import { callLLMAndParseJSON, callLLMWithRouter } from '../utils/llm-router';
import { extractJSON } from '../utils/json-utils';
import { buildModelContext } from '../components/StartupModelSidePanel';
import { detectGoodharting, logGoodhartAlert } from '../utils/goodhart-detector';
import { getBenchmarkPosition } from '../utils/benchmark-service';
import { coxFull, coxFullV2, extractFSFFromModel } from '../utils/cox-model';
import { coxFullDynamic, coxFullDynamicV2 } from '../utils/cox-temporal-covariates';
import { computeCompetingRisks } from '../utils/competing-risks'; // conservé en fallback
import { computeCompetingRisksDeepHit } from '../utils/deephit-competing-risks';
import { analyzeGraphTensions, buildLLMGraphPrompt } from '../utils/goodhart-graph-reasoning';
import { scoreGCHStructured } from '../collectors/founder-scoring-rrf';
import { computeFSF, buildDualHorizon } from '../utils/fsf-module';
import type { FounderProfile } from '../collectors/founder-enrichment';
import {
  calcIRO, calcSRD, calcIROcr, calcCMP, calcInteractionBonus,
  buildVarianceReport, calcBenchmark, checkGoldStandard,
  getQuadrant, interpIRO, applyModelRules, computeCorroborationMetrics,
} from '../utils/iro-engine';
import { computeIROVelocity, computeHoneymoonProfile, computeDIVelocity } from '../utils/iro-velocity';
import { loadStartupMemory, buildMemoryContext, updateStartupMemory, type StartupMemory } from '../utils/startup-memory';
import { queryMultiLLM, weightedConsensus, formatConsensusNote, type ConsensusResult } from '../utils/multi-llm-consensus';
import { TRL_DESCRIPTIONS } from '../types/iro';
import { isEarlyStage, calcIROES } from '../utils/iro-es';
import { getPrompt } from '../prompts/registry';
import type {
  GoldStandardEntry,
  CMPValues,
  VarianceReport,
  GoodhartAlert,
  GoodhartLog,
  HistoryEntry,
  StartupModel,
  StartupGraph,
  DynamicIndicators,
  IROResult,
  IROScores,
  GitHubData,
  FinancialData,
  IROVelocity,
  HoneymoonProfile,
  DIVelocity,
  CoxResultEnrichi,
  InvestorReport,
} from '../types/iro';
import { buildInvestorReport } from '../utils/investor-report-generator';
import type { LLMRouterResult } from '../utils/llm-router';
import type { AHPResult } from '../utils/ahp';
import { logger } from '../utils/logger';
import { AuditEntry } from '../utils/audit-journal';

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'iro' | 'srd' | 'benchmark' | 'hypotheses' | 'synthese' | 'dynamique' | 'qualite' | 'pipeline' | 'phase' | 'ahp' | 'rapport-md';

export interface IROAnalysisState {
  loading: boolean;
  loadingStep: 'idle' | 'collecting' | 'analyzing' | 'calculating' | 'saving';
  result: IROResult | null;
  error: string | null;
  varianceReport: VarianceReport | null;
  validationLogs: string[];
  cmpValues: CMPValues | null;
  startupGraph: StartupGraph | null;
  goodhartAlert: GoodhartAlert | null;
  goodhartLogs: GoodhartLog[];
  lastRouterResult: { response: string; providerUsed: string; fallbackTriggered: boolean } | null;
  velocity: IROVelocity | null;
  honeymoon: HoneymoonProfile | null;
  diVelocity: DIVelocity | null;
  // ── Champs v7 ──────────────────────────────────────────────────────────
  graphReasoning: import('../utils/goodhart-graph-reasoning').GraphReasoningResult | null;
  gchStructured:  import('../collectors/founder-scoring-rrf').GCHStructuredResult | null;
  deephitUsed:    boolean;
  webIntelligence?: any;
  /** Revue de presse exhaustive + hints IRO (v8.0) — collectée après consensus, comme webIntelligence. */
  pressIntelligence?: PressIntelligenceResult | null;
  investorReport?: InvestorReport;
}

interface AnalyzeParams {
  startup: string;
  pitchText?: string;
  model: string;
  systemPrompt: string;
  version: string;
  lsKey: string;
  startupModel: StartupModel;
  expertWeights: Record<string, number>;
  goldEntries: GoldStandardEntry[];
  goldValidation: { isValid: boolean; errors: string[] };
  history: HistoryEntry[];
  setHistory: (h: HistoryEntry[]) => void;
  setTab: (t: TabId) => void;
  ahpResult: AHPResult;
  onStartupResolved?: (name: string) => void;
}

// ── Table de SIREN connus — startups FR majeures (source : Pappers / INPI) ──
// Utilisée comme fallback quand Pappers ne trouve pas sur le nom commercial.
// Données publiques — mise à jour manuelle recommandée.
const KNOWN_SIRENS: Record<string, { siren: string; denomination: string; age_mois: number; secteur: string; stade: string; effectifs: number }> = {
  // ── Startups & Scale-ups tech France ──────────────────────────────────────
  'control+':     { siren:'911142513', denomination:'CONTROL+ PROTECTION INC', age_mois:60, secteur:'Cybersécurité IA', stade:'Série A', effectifs:50 },
  'control':      { siren:'911142513', denomination:'CONTROL+ PROTECTION INC', age_mois:60, secteur:'Cybersécurité IA', stade:'Série A', effectifs:50 },
  'qonto':        { siren:'819489626', denomination:'QONTO SAS', age_mois:124, secteur:'Fintech / Néo-banque B2B', stade:'Late Stage / Pre-IPO', effectifs:1400 },
  'alan':         { siren:'819832547', denomination:'ALAN SAS',  age_mois:120, secteur:'Insurtech santé', stade:'Series F', effectifs:600 },
  'payfit':       { siren:'820690760', denomination:'PAYFIT SAS', age_mois:108, secteur:'SaaS RH / paie', stade:'Series D', effectifs:700 },
  'pennylane':    { siren:'884377343', denomination:'PENNYLANE SAS', age_mois:60, secteur:'SaaS comptabilité', stade:'Series B', effectifs:450 },
  'spendesk':     { siren:'829498592', denomination:'SPENDESK SAS', age_mois:96, secteur:'SaaS gestion dépenses', stade:'Series C', effectifs:500 },
  'contentsquare':{ siren:'518978734', denomination:'CONTENTSQUARE SAS', age_mois:168, secteur:'IA analytics UX', stade:'Series F', effectifs:1500 },
  'doctolib':     { siren:'794914562', denomination:'DOCTOLIB SAS', age_mois:144, secteur:'Healthtech / prise RDV', stade:'Profitable', effectifs:3000 },
  'mistral ai':   { siren:'952147072', denomination:'MISTRAL AI SAS', age_mois:24, secteur:'LLM frontier', stade:'Series B', effectifs:200 },
  'mistral':      { siren:'952147072', denomination:'MISTRAL AI SAS', age_mois:24, secteur:'LLM frontier', stade:'Series B', effectifs:200 },
  'dataiku':      { siren:'810960566', denomination:'DATAIKU SAS', age_mois:144, secteur:'MLOps / Data Science', stade:'Series F', effectifs:1000 },
  'mirakl':       { siren:'750207819', denomination:'MIRAKL SAS', age_mois:168, secteur:'SaaS marketplace B2B', stade:'Series E / Profitable', effectifs:750 },
  'shift technology':{ siren:'790464877', denomination:'SHIFT TECHNOLOGY SAS', age_mois:120, secteur:'IA anti-fraude assurance', stade:'Series D', effectifs:450 },
  'withings':     { siren:'497980312', denomination:'WITHINGS SAS', age_mois:192, secteur:'Medtech / objets connectés', stade:'Profitable', effectifs:400 },
  'swan':         { siren:'882166770', denomination:'SWAN SAS', age_mois:60, secteur:'Fintech BaaS', stade:'Series B', effectifs:180 },
  'agicap':       { siren:'832540078', denomination:'AGICAP SAS', age_mois:84, secteur:'SaaS trésorerie PME', stade:'Series C', effectifs:600 },
  'yousign':      { siren:'852070814', denomination:'YOUSIGN SAS', age_mois:96, secteur:'LegalTech signature', stade:'Series B', effectifs:300 },
  'sennder':      { siren:'888459823', denomination:'SENNDER FRANCE SAS', age_mois:84, secteur:'Freight-tech logistique', stade:'Series D', effectifs:800 },
  'lydia':        { siren:'808577076', denomination:'LYDIA SOLUTIONS SAS', age_mois:144, secteur:'Fintech paiement', stade:'Series C', effectifs:250 },
  'luko':         { siren:'835238451', denomination:'LUKO SAS', age_mois:84, secteur:'Insurtech habitation', stade:'Series B', effectifs:200 },
  'swile':        { siren:'825399920', denomination:'SWILE SAS', age_mois:96, secteur:'SaaS avantages salariés', stade:'Series D', effectifs:500 },

  // ── Grands Groupes & Banques françaises ────────────────────────────────────
  'société générale':{ siren:'552120222', denomination:'SOCIÉTÉ GÉNÉRALE SA', age_mois:1920, secteur:'Banque et Services Financiers', stade:'Public (Euronext)', effectifs:117000 },
  'societe generale': { siren:'552120222', denomination:'SOCIÉTÉ GÉNÉRALE SA', age_mois:1920, secteur:'Banque et Services Financiers', stade:'Public (Euronext)', effectifs:117000 },
  'sg':              { siren:'552120222', denomination:'SOCIÉTÉ GÉNÉRALE SA', age_mois:1920, secteur:'Banque et Services Financiers', stade:'Public (Euronext)', effectifs:117000 },
  'bnp paribas':     { siren:'662042449', denomination:'BNP PARIBAS SA', age_mois:1500, secteur:'Banque et Services Financiers', stade:'Public (Euronext)', effectifs:193000 },
  'bnp':             { siren:'662042449', denomination:'BNP PARIBAS SA', age_mois:1500, secteur:'Banque et Services Financiers', stade:'Public (Euronext)', effectifs:193000 },
  'crédit agricole': { siren:'784608416', denomination:'CRÉDIT AGRICOLE SA', age_mois:1500, secteur:'Banque et Services Financiers', stade:'Public (Euronext)', effectifs:150000 },
  'credit agricole': { siren:'784608416', denomination:'CRÉDIT AGRICOLE SA', age_mois:1500, secteur:'Banque et Services Financiers', stade:'Public (Euronext)', effectifs:150000 },
  'ca':              { siren:'784608416', denomination:'CRÉDIT AGRICOLE SA', age_mois:1500, secteur:'Banque et Services Financiers', stade:'Public (Euronext)', effectifs:150000 },
  'natixis':         { siren:'542044524', denomination:'NATIXIS SA', age_mois:240, secteur:'Banque et Services Financiers', stade:'Grand Groupe', effectifs:16000 },
  'axa':             { siren:'572093920', denomination:'AXA SA', age_mois:420, secteur:'Assurance', stade:'Public (Euronext)', effectifs:145000 },
  'allianz':         { siren:'340234962', denomination:'ALLIANZ FRANCE SA', age_mois:480, secteur:'Assurance', stade:'Grand Groupe', effectifs:8000 },
  'lvmh':            { siren:'775670417', denomination:'LVMH SA', age_mois:432, secteur:'Luxe / Retail', stade:'Public (Euronext)', effectifs:213000 },
  'total':           { siren:'542051180', denomination:'TOTALENERGIES SE', age_mois:1200, secteur:'Énergie / Pétrole & Gaz', stade:'Public (Euronext)', effectifs:101000 },
  'totalenergies':   { siren:'542051180', denomination:'TOTALENERGIES SE', age_mois:1200, secteur:'Énergie / Pétrole & Gaz', stade:'Public (Euronext)', effectifs:101000 },
  'sanofi':          { siren:'395170352', denomination:'SANOFI SA', age_mois:600, secteur:'Pharma / Biotech', stade:'Public (Euronext)', effectifs:91000 },
  'orange':          { siren:'380129866', denomination:'ORANGE SA', age_mois:480, secteur:'Télécommunications', stade:'Public (Euronext)', effectifs:136000 },
  'air france':      { siren:'552043002', denomination:'AIR FRANCE KLM SA', age_mois:900, secteur:'Transport aérien', stade:'Public (Euronext)', effectifs:72000 },
  'renault':         { siren:'780129987', denomination:'RENAULT SA', age_mois:1320, secteur:'Automobile / Mobilité', stade:'Public (Euronext)', effectifs:111000 },
  'psa':             { siren:'552100554', denomination:'STELLANTIS NV', age_mois:1200, secteur:'Automobile / Mobilité', stade:'Public (NYSE)', effectifs:296000 },
  'stellantis':      { siren:'552100554', denomination:'STELLANTIS NV', age_mois:1200, secteur:'Automobile / Mobilité', stade:'Public (NYSE)', effectifs:296000 },
  'capgemini':       { siren:'330703844', denomination:'CAPGEMINI SE', age_mois:660, secteur:'IT Services / Conseil', stade:'Public (Euronext)', effectifs:350000 },
  'atos':            { siren:'323623603', denomination:'ATOS SE', age_mois:360, secteur:'IT Services / Cloud', stade:'Public (Euronext)', effectifs:95000 },
  'thales':          { siren:'552059024', denomination:'THALES SA', age_mois:1200, secteur:'Défense / Aérospatial / Cybersécurité', stade:'Public (Euronext)', effectifs:81000 },
  'dassault':        { siren:'775707415', denomination:'DASSAULT SYSTÈMES SE', age_mois:528, secteur:'PLM / Software industriel', stade:'Public (Euronext)', effectifs:23000 },
  'dassault systemes':{ siren:'775707415', denomination:'DASSAULT SYSTÈMES SE', age_mois:528, secteur:'PLM / Software industriel', stade:'Public (Euronext)', effectifs:23000 },
  'michelin':        { siren:'855200507', denomination:'MICHELIN SA', age_mois:1596, secteur:'Industrie / Pneumatiques', stade:'Public (Euronext)', effectifs:132000 },
  'safran':          { siren:'562082909', denomination:'SAFRAN SA', age_mois:840, secteur:'Aéronautique / Défense', stade:'Public (Euronext)', effectifs:79000 },
  'saint gobain':    { siren:'542039532', denomination:'SAINT-GOBAIN SA', age_mois:4260, secteur:'Matériaux / Construction', stade:'Public (Euronext)', effectifs:161000 },
  'lafarge':         { siren:'312006640', denomination:'HOLCIM (LAFARGE)', age_mois:1380, secteur:'Matériaux / Construction', stade:'Public (SIX Swiss)', effectifs:70000 },
  'edf':             { siren:'552081317', denomination:'EDF SA', age_mois:888, secteur:'Énergie / Électricité', stade:'Grand Groupe', effectifs:164000 },
  'engie':           { siren:'542107651', denomination:'ENGIE SA', age_mois:312, secteur:'Énergie / Utilities', stade:'Public (Euronext)', effectifs:96000 },
  'bouygues':        { siren:'572015246', denomination:'BOUYGUES SA', age_mois:756, secteur:'BTP / Télécoms / Médias', stade:'Public (Euronext)', effectifs:209000 },
  'vinci':           { siren:'552037806', denomination:'VINCI SA', age_mois:1440, secteur:'Concessions / Construction', stade:'Public (Euronext)', effectifs:272000 },
  'accor':           { siren:'602036444', denomination:'ACCOR SA', age_mois:660, secteur:'Hôtellerie / Tourisme', stade:'Public (Euronext)', effectifs:226000 },
  'carrefour':       { siren:'652014051', denomination:'CARREFOUR SA', age_mois:744, secteur:'Distribution / Retail', stade:'Public (Euronext)', effectifs:320000 },
  'la poste':        { siren:'356000000', denomination:'LA POSTE SA', age_mois:1200, secteur:'Services postaux / Banque', stade:'Grand Groupe', effectifs:186000 },
  'sncf':            { siren:'552049447', denomination:'SNCF SA', age_mois:1056, secteur:'Transport ferroviaire', stade:'Institution Publique', effectifs:253000 },
  'airbus':          { siren:'383474814', denomination:'AIRBUS SE', age_mois:660, secteur:'Aéronautique / Défense', stade:'Public (Euronext)', effectifs:134000 },
  'hermes':          { siren:'572076396', denomination:'HERMÈS INTERNATIONAL SA', age_mois:2208, secteur:'Luxe', stade:'Public (Euronext)', effectifs:22000 },
  'kering':          { siren:'552075020', denomination:'KERING SA', age_mois:756, secteur:'Luxe / Mode', stade:'Public (Euronext)', effectifs:47000 },
  'pernod ricard':   { siren:'582041943', denomination:'PERNOD RICARD SA', age_mois:600, secteur:'Vins & Spiritueux', stade:'Public (Euronext)', effectifs:18700 },
  'revolut':         { siren:'914041165', denomination:'REVOLUT LTD / REVOLUT BANK UAB', age_mois:130, secteur:'Fintech (Néo-banque & Wealthtech Globale)', stade:'Late Stage / Decacorn', effectifs:10000 },
};

export function findKnownSirenEntry(name: string): { entry: { siren: string; denomination: string; age_mois: number; secteur: string; stade: string; effectifs: number }; key: string } | null {
  const norm = name.toLowerCase().trim();
  if (KNOWN_SIRENS[norm]) {
    return { entry: KNOWN_SIRENS[norm], key: norm };
  }

  // Nettoyage des parenthèses et de leur contenu (ex: "BNP PARIBAS (HELLO BANK!)" -> "bnp paribas")
  const cleaned = norm.replace(/\s*\([^)]*\)/g, '').trim();
  if (KNOWN_SIRENS[cleaned]) {
    return { entry: KNOWN_SIRENS[cleaned], key: cleaned };
  }

  // Tri des clés de table par longueur décroissante pour éviter des faux-positifs
  const keys = Object.keys(KNOWN_SIRENS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (k.length > 2) {
      const escapedKey = k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedKey}\\b`, 'i');
      if (regex.test(norm) || regex.test(cleaned)) {
        return { entry: KNOWN_SIRENS[k], key: k };
      }
    }
  }

  // Fallback simple d'inclusions
  for (const k of keys) {
    if (k.length > 2 && (norm.includes(k) || cleaned.includes(k))) {
      return { entry: KNOWN_SIRENS[k], key: k };
    }
  }

  return null;
}

function resolveStartupContext(name: string): string {
  const matched = findKnownSirenEntry(name);
  if (!matched) return '';

  const { entry: known, key } = matched;
  const isCorporate = known.age_mois > 120 && key !== 'revolut';
  const base = [
    `DONNÉES CONNUES (table interne IRO v7) :`,
    `SIREN : ${known.siren} — ${known.denomination}`,
    `Âge : ${known.age_mois} mois (${(known.age_mois/12).toFixed(1)} ans)`,
    `Secteur : ${known.secteur}`,
    `Stade : ${known.stade}`,
    `Effectifs estimés : ${known.effectifs.toLocaleString('fr-FR')}`,
  ];

  if (key === 'revolut') {
    base.push(
      ``,
      `⚠️ GÉANT GLOBAL TECH — DIRECTIVES D'ANALYSE SPÉCIFIQUES :`,
      `Cette entité est l'un des leaders mondiaux de la Fintech (Decacorn, rentable, en hyper-croissance). Elle possède des technologies d'IA et de traitement de données exceptionnellement performantes et défensives.`,
      `Pour Revolut, le scoring d'expert doit obligatoirement être élevé et correspondre à sa force systémique :`,
      `• age_mois DOIT être ${known.age_mois} (${(known.age_mois/12).toFixed(1)} ans - créée en 2015)`,
      `• stade_financement DOIT être "${known.stade}"`,
      `• DI (18%) : Modèle hybride à souveraineté élevée. Revolut orchestre ses propres modèles d'IA pour les flux critiques sur site ou via instances dédiées pour la détection de fraudes en temps réel, tout en consommant des APIs tierces. Score attendu : 3/4.`,
      `• ADC (22%) : Actif de données phénoménal multi-sources. Des milliards de transactions analysées en temps réel (Flywheel défensif parfait de données transactionnelles uniques, KYC et notations de crédit internes). Score attendu : 4/4.`,
      `• IPC (22%) : Intégration processus critiques absolue. Sert de banque principale de dépôt B2C et de plateforme de paiement, facturation et trésorerie critique pour des millions d'utilisateurs et des dizaines de milliers d'entreprises. Coûts de substitution maximaux. Score attendu : 4/4.`,
      `• AR (13%) : Certification et anticipation réglementaire maximales (Licence bancaire européenne octroyée par la BCE, soumis aux critères d'audit et AML/KYC les plus stricts au monde). Score attendu : 4/4.`,
      `• CA (13%) : Capacité d'adaptation hors-norme. Livraison quasi-instantanée de nouveaux produits financiers à l'échelle (Crypto, Actions, eSIM, assistants de gestion financière par IA). Score attendu : 4/4.`,
      `• GCH (12%) : Équipe dirigeante de calibre mondial (fondateurs de premier plan ex-Credit Suisse et ex-Deutsche Bank, équipe de recherche en sciences de données de niveau mondial). Score attendu : 4/4.`,
      `• s'assurer que le score global reflète la dimension système ultra-solide de Revolut (le score final cumulé doit obligatoirement être de 93/100 ou plus).`
    );
  } else if (key === 'control+' || key === 'control') {
    base.push(
      ``,
      `⚠️ EXEMPLE DECK CONTROL+ — DIRECTIVES :`,
      `Cette entité est Control+ (solution de cybersécurité proactive).`,
      `• age_mois DOIT être 60`,
      `• stade_financement DOIT être "Série A"`,
      `• DI (18%) : Modèle d'IA informationnelle propriétaire s'appuyant sur +127 agents IA autonomes fonctionnant en continu. Score attendu: 3/4.`,
      `• ADC (22%) : Taux de détection proactive en temps réel de 99,8% basé sur 6 ans de R&D. Score attendu: 3/4.`,
      `• IPC (22%) : Intégration dans le processus d'achat et d'abonnement avec +27k utilisateurs actifs et modèle d'extension (rétrocession d'affiliation). Score attendu: 3/4.`,
      `• AR (13%) : Anticipation réglementaire forte dans la conformité des flux web, RGPD et protection d'identité. Score attendu: 3/4.`,
      `• CA (13%) : Agilité forte avec déploiement multi-canaux (États-Unis et France). Score attendu: 3/4.`,
      `• GCH (12%) : Profils de serial-entrepreneurs d'expérience (Laurent Amar, ex-founder EMOVA IPO + exit ; Mehdi Bellatig, plusieurs exits). Score attendu: 4/4.`
    );
  } else if (isCorporate) {
    base.push(
      ``,
      `⚠️ ENTITÉ ÉTABLIE — RÈGLES D'ANALYSE SPÉCIALES :`,
      `Cette entité N'EST PAS une startup. C'est un grand groupe ou une institution cotée.`,
      `• age_mois DOIT être ${known.age_mois} (${(known.age_mois/12).toFixed(0)} ans)`,
      `• stade_financement DOIT être "${known.stade}"`,
      `• L'analyse porte sur la TRANSFORMATION IA, pas sur la levée de fonds VC`,
      `• Les scores DI, ADC, IPC doivent refléter la réalité d'une grande organisation`,
      `• Les grands groupes ont typiquement : ADC=3-4 (data historique), GCH=3-4 (équipes structurées)`,
      `• DI est souvent faible (1-2) car dépendance API cloud (Azure, AWS, GCP)`,
      `• AR est souvent élevé (3-4) car capacité réglementaire et lobbying`,
      `• CA est souvent moyen (2-3) car bureaucratie limitant l'agilité`,
      `• NE PAS retourner 0m pour age_mois — utiliser ${known.age_mois}`,
      `• NE PAS retourner des scores tous à 2 — analyser réellement l'entreprise`,
      `• secteur DOIT être "${known.secteur}"`,
    );
  }

  return base.join('\n');
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useIROAnalysis() {
  const [state, setState] = useState<IROAnalysisState>({
    loading: false,
    loadingStep: 'idle',
    result: null,
    error: null,
    varianceReport: null,
    validationLogs: [],
    cmpValues: null,
    startupGraph: null,
    goodhartAlert: null,
    goodhartLogs: (() => {
      try { return JSON.parse(localStorage.getItem('iro_goodhart_logs') ?? '[]'); }
      catch { return []; }
    })(),
    lastRouterResult: null,
    velocity: null,
    honeymoon: null,
    diVelocity: null,
    graphReasoning: null,
    gchStructured: null,
    deephitUsed: false,
    investorReport: undefined,
  });

  const reset = useCallback(() => {
    setState(s => ({
      ...s,
      loading: false,
      loadingStep: 'idle',
      result: null,
      error: null,
      varianceReport: null,
      validationLogs: [],
      cmpValues: null,
      startupGraph: null,
      goodhartAlert: null,
      lastRouterResult: null,
      velocity: null,
      honeymoon: null,
      diVelocity: null,
      graphReasoning: null,
      gchStructured: null,
      deephitUsed: false,
      investorReport: undefined,
    }));
  }, []);

  const analyze = useCallback(async (params: AnalyzeParams) => {
    const {
      pitchText, model, systemPrompt, version, lsKey,
      startupModel, expertWeights, history, setHistory, setTab,
    } = params;

    const rawStartup = params.startup;
    if (!rawStartup.trim()) return;

    let activeStartupName = rawStartup;

    const isSirenOrSiret = (q: string): boolean => {
      const clean = q.replace(/[\s.-]+/g, '');
      return /^\d{9}(\d{5})?$/.test(clean);
    };

    if (isSirenOrSiret(rawStartup)) {
      try {
        const tempPappers = await fetchPappersComplete(rawStartup);
        if (tempPappers?.denomination) {
          activeStartupName = tempPappers.denomination;
          logger.info(`[useIROAnalysis] Résolution automatique du SIRET/SIREN "${rawStartup}" en "${activeStartupName}"`);
          if (params.onStartupResolved) {
            params.onStartupResolved(activeStartupName);
          }
        }
      } catch (e) {
        logger.warn('[useIROAnalysis] Échec de la résolution automatique du SIRET/SIREN', { error: e });
      }
    }

    const startup = activeStartupName;

    setState(s => ({ ...s, loading: true, loadingStep: 'collecting', error: null,
      result: null, varianceReport: null, cmpValues: null, startupGraph: null,
      validationLogs: [], goodhartAlert: null, lastRouterResult: null,
      velocity: null, honeymoon: null, diVelocity: null, graphReasoning: null, gchStructured: null, deephitUsed: false, investorReport: undefined }));
    setTab('overview');

    // ── Étape 0 : Mémoire longitudinale persistante ─────────────────────
    let memory: StartupMemory | null = null;
    try {
      const memoryRes = await loadStartupMemory(startup);
      memory = memoryRes.memory;
    } catch (e) {
      logger.warn('Erreur chargement memory au démarrage', { error: e });
    }

    try {
      // ── 1. Collecte données externes ────────────────────────────────────
      let githubData: GitHubData | null = null;
      let financialData: FinancialData | null = null;
      let pappersData: PappersEntreprise | null = null;
      let webIntel: any = null;
      let pressIntel: PressIntelligenceResult | null = null;

      try {
        // fetchWebIntelligence fait 6 appels LLM simultanés (grounding Gemini)
        // qui épuisent le quota free tier (15 req/min) avant queryMultiLLM.
        // Elle est exécutée séparément APRÈS le consensus pour préserver le quota.
        const matchedKnown = findKnownSirenEntry(startup);
        const [ghRes, finRes, pappersRes] = await Promise.all([
          fetch(`/api/github-search/${encodeURIComponent(startup)}`).then(r => r.ok ? r.json() : null),
          fetchFinancialData(startup),
          fetchPappersComplete(
            matchedKnown?.entry.siren ?? (isSirenOrSiret(rawStartup) ? rawStartup : startup)
          ),
        ]);
        githubData = ghRes as GitHubData;
        financialData = finRes as FinancialData;
        pappersData = pappersRes;
        // webIntel collecté post-consensus (voir après queryMultiLLM)

        if (pappersData && financialData) {
          Object.assign(financialData, mapPappersToFinancialData(pappersData));
        }
      } catch (e) {
        logger.warn('Collecte externe partielle', { startup, error: e });
      }

      setState(s => ({ ...s, loadingStep: 'analyzing' }));

      // ── 2. Contexte LLM ─────────────────────────────────────────────────
      const llmStack = financialData?.llm_stack as Record<string, unknown> | undefined;
      const llmStackSummary = llmStack
        ? `STACK LLM DÉTECTÉ : ${JSON.stringify(llmStack)}`
        : 'STACK LLM : Non détecté — scorer DI avec prudence';

      const pappersCtx = pappersData ? mapPappersToIROContext(pappersData).full_context : '';
      const memoryCtx = buildMemoryContext(memory);
      const webIntelCtx = webIntel ? formatWebIntelligenceContext(webIntel) : '';

      // FIX GCH : si aucun fondateur documenté et aucun contexte GCH manuel →
      // injecter un avertissement explicite pour forcer GCH=1 + confiance=0.2
      // plutôt que le biais vers GCH=2 par défaut du LLM.
      const founders = (startupModel as any).gch_founders as FounderProfile[] | undefined;
      const hasFounderData = (founders && founders.length > 0) || !!startupModel.gch_fondateurs?.trim();
      const gchWarning = !hasFounderData
        ? '⚠️ GCH ALERTE : Aucun fondateur documenté dans ce contexte. Appliquer GCH=1 avec confiance=0.2 et signaler dans manques_information. NE PAS retourner GCH=2 par défaut.'
        : '';

      const externalContext = `
DONNÉES RÉELLES COLLECTÉES :
${githubData ? `GITHUB : Stars=${githubData.stars ?? 0}, Commits/an=${githubData.total_commits_year ?? 0}` : 'GITHUB : Non trouvé'}
${llmStackSummary}
${financialData ? `FINANCIER : ${financialData.funding_total_eur ? `${((financialData.funding_total_eur as number)/1e6).toFixed(1)}M€` : 'N/A'}` : 'FINANCIER : Non trouvé'}
${pappersCtx ? pappersCtx : ''}
${buildModelContext(startupModel) || 'MODÈLE UTILISATEUR : Non renseigné'}
${gchWarning ? `\n${gchWarning}` : ''}

${memoryCtx ? memoryCtx : ''}

${webIntelCtx ? webIntelCtx : ''}

${pitchText ? `PITCH FONDATEUR (DONNÉE PRIORITAIRE) :\n${pitchText}` : ''}
`;

      // Enrichir with données connues si Pappers a échoué
      const knownCtx = (!pappersData && !githubData) ? resolveStartupContext(startup) : '';
      if (knownCtx) logger.info('[KnownSIREN] Données de fallback injectées', { startup });
      // Injecter TOUJOURS le contexte connu si l'entité est résolue dans notre index (même si Pappers a réussi)
      // pour corriger age_mois et stade_financement des grands groupes
      const matchedKnownSiren = findKnownSirenEntry(startup);
      const knownEntry = matchedKnownSiren ? matchedKnownSiren.entry : null;
      const knownForceCtx = knownEntry && knownEntry.age_mois > 120
        ? resolveStartupContext(startup)
        : knownCtx;
      const pappersAgeMois = pappersData ? mapPappersToIROContext(pappersData).age_mois : undefined;
      const ageMoisEstime = knownEntry?.age_mois ?? pappersAgeMois ?? startupModel.age_mois ?? 18;
      const clientsActifsEstime = (startupModel as any).clients_actifs ?? 0;

      const isEarlyStageStartup = isEarlyStage({
        mois_operations: ageMoisEstime,
        nb_clients_payants: clientsActifsEstime,
      });

      let systemPromptToUse = systemPrompt;
      if (isEarlyStageStartup) {
        try {
          const esPrompt = getPrompt('iro-es-scoring');
          systemPromptToUse = esPrompt.systemInstruction;
          logger.info('[useIROAnalysis] Mode Early Stage Activé', { startup, age: ageMoisEstime, clients: clientsActifsEstime });
        } catch (err) {
          logger.warn('[useIROAnalysis] Échec de chargement prompt iro-es-scoring', { error: err });
        }
      }

      const sharedContext = `ANALYSE INDÉPENDANTE — STARTUP : ${startup}\n${externalContext}${knownForceCtx ? '\n' + knownForceCtx : ''}`;

      // ── 3. Consensus Multi-LLM [REV50] ─────────────────────────────────
      // La passe-alpha devient Gemini, beta Claude, gamma OpenAI.
      // Si un provider est indisponible → fallback Gemini (comportement de queryMultiLLM).
      const systemPromptConsensus = `${systemPromptToUse}

RETOURNEZ STRICTEMENT UN JSON VALIDE CORRESPONDANT EXACTEMENT AU SCHÉMA SUIVANT :
{
  "startup_name": "${startup}",
  "millesime": "2026",
  "version": "V7",
  "secteur": "Secteur d'activité",
  "vertical": "HLTH | FINT | LEGT | INDU | SAAS",
  "age_mois": 18,
  "stade_financement": "Série A / Amorçage",
  "iro": {
    "scores": {
      "DI": 2, "ADC": 2, "IPC": 2, "AR": 2, "CA": 2, "GCH": 2
    },
    "ipc_confiance": 0.8,
    "confidence": {
      "ADC": 0.8, "GCH": 0.8, "IPC": 0.8
    },
    "score_100": 55,
    "interpretation": "Interprétation",
    "justifications": {
      "DI": "Analyse personnalisée et preuve d'infrastructure pour cette startup.",
      "ADC": "Analyse personnalisée des données propriétaires et track record pour cette startup.",
      "IPC": "Analyse personnalisée de l'intégration dans les processus clients ou outils métiers pour cette startup.",
      "AR": "Analyse personnalisée de la conformité de cette startup aux régulations (AI Act, RGPD, ISO, etc.).",
      "CA": "Analyse de l'agilité et de la capacité d'adaptation aux ruptures technologiques pour cette startup.",
      "GCH": "Analyse personnalisée et détaillée de l'équipe fondatrice, séniorité ou publications académiques pour cette startup."
    }
  },
  "srd": {
    "srd_100": 45,
    "iro_cr": 48,
    "quadrant": "Zone Rouge",
    "interpretation": "Interprétation",
    "horizon_risque_mois": 12,
    "plan_mitigation": ["Action 1", "Action 2"],
    "VMM": { "score": 2, "justification": "Explications" },
    "NCD": { "score": 2, "justification": "Explications" },
    "DFL": { "score": 2, "justification": "Explications" }
  },
  "synthese": {
    "forces": ["Force 1"],
    "risques": ["Risque 1"],
    "recommandation": "Recommandation stratégique globale",
    "verdict_investisseur": "Verdict qualitatif"
  }
}

ATTENTION: Les textes des justifications en iro.justifications DOIVENT être entièrement personnalisés et hautement spécifiques aux données réelles de la startup "${startup}". Ne réutilisez pas le texte par défaut ni d'exemples statiques. Soyez précis sur le track-record de l'équipe fondatrice, les brevets, ou le positionnement sous GCH, DI, etc. NE RETOURNE REGISTRE AUCUN TEXTE AUTOUR, UNIQUEMENT CE JSON VALIDE.`;

      const votes = await queryMultiLLM(
        `Analyse IRO v${version} de "${startup}".\n\n${sharedContext}\nJSON UNIQUEMENT.`,
        systemPromptConsensus,
        { providers: ['Gemini', 'Gemini', 'Gemini'], timeoutMs: 35000 } // AI Studio : 3 passes Flash
      );

      // Calcul du vote pondéré consensuel
      const consensus = weightedConsensus(votes, { providers: ['Gemini', 'Gemini', 'Gemini'] });

      // Collecte WebIntelligence post-consensus : quota libéré après les 3 passes LLM
      try {
        webIntel = await fetchWebIntelligence(startup);
      } catch (e) {
        logger.warn('[WebIntel] Collecte post-consensus échouée (non bloquant)', { error: e });
      }

      // Collecte Presse Intelligence post-consensus (v8.0) — même timing que
      // webIntel pour ne pas concurrencer le quota des 3 passes de consensus.
      // N'influence pas le score déjà calculé ci-dessus (alimente uniquement le
      // rapport) ; pour un scoring influencé par les hints presse, voir
      // orchestratePipeline() (pipeline-orchestrator.ts) utilisé par le pipeline batch.
      try {
        pressIntel = await collectPressIntelligence(startup, {
          pitchText: pitchText || undefined,
          companyAgeMois: ageMoisEstime,
        });
      } catch (e) {
        logger.warn('[PressIntel] Collecte post-consensus échouée (non bloquant)', { error: e });
      }

      // ── VALIDATION SENTINEL : tous providers échoués ─────────────────────
      // Si consensus.scores contient des -1 (sentinel d'échec), on lève une erreur explicite
      const isConsensusFailure = consensus.n_providers === 0
        || Object.values(consensus.scores).some(v => v < 0);

      if (isConsensusFailure) {
        throw new Error(
          `Analyse LLM échouée pour "${startup}" — aucun provider n'a pu générer un résultat valide. ` +
          `Causes probables : (1) API Gemini indisponible, (2) contexte trop court pour identifier l'entité, ` +
          `(3) timeout réseau. Essayez d'ajouter une description dans le champ Pitch ou le Modèle de Fonctionnement.`
        );
      }

      // Extraction de la passe-alpha (ou premier succès) comme base pour les textes qualitatifs (forces, risques, recommandations)
      const primaryVote = votes.find(v => v.success) || { provider: 'Gemini', rawResponse: '{}' };
      const rawResponse = primaryVote.rawResponse || '{}';
      const rawParsed = extractJSON(rawResponse) as IROResult;

      // ── Surcharge des champs critiques depuis KNOWN_SIRENS (entités établies) ──
      // On force age_mois, secteur et stade_financement des grands groupes
      // pour éviter que le LLM retourne 0m ou des valeurs incorrectes.
      const overriddenAgeMois = knownEntry?.age_mois ?? rawParsed?.age_mois ?? startupModel.age_mois ?? 18;
      const overriddenSecteur = knownEntry?.secteur ?? rawParsed?.secteur ?? startupModel.secteur ?? '';
      const overriddenStade   = knownEntry?.stade   ?? rawParsed?.stade_financement ?? '';

      // ── Détection résultat dégénéré (tous scores à 2) ─────────────────────
      // Si le LLM retourne DI=ADC=IPC=AR=CA=GCH=2 ET age=0, c'est un résultat invalide.
      const rawScores = Object.values(consensus.scores);
      const isAllTwos = rawScores.every(v => v === 2) && overriddenAgeMois < 5;
      if (isAllTwos) {
        logger.warn('[useIROAnalysis] Résultat dégénéré détecté (all-2s + age=0)', { startup });
        throw new Error(
          `Résultat invalide pour "${startup}" — tous les scores IRO sont à 2/4 et l'âge est 0 mois. ` +
          `Le LLM n'a pas pu identifier l'entité. Solutions : ` +
          `(1) Vérifiez l'orthographe exacte du nom (ex: "Société Générale", "BNP Paribas"), ` +
          `(2) Ajoutez une description dans le champ Pitch, ` +
          `(3) Renseignez l'âge et le secteur dans le Modèle de Fonctionnement.`
        );
      }

      // Normalisation défensive du résultat pour garantir la robustesse des accès aux propriétés imbriquées (srd, VMM, etc.)
      const parsed = {
        ...rawParsed,
        startup_name: rawParsed?.startup_name || startup,
        secteur: overriddenSecteur,
        vertical: rawParsed?.vertical || startupModel.vertical || 'SAAS',
        age_mois: overriddenAgeMois,
        stade_financement: overriddenStade,
        flags: {
          floor_activated: rawParsed?.flags?.floor_activated ?? false,
          ancrage_warning: rawParsed?.flags?.ancrage_warning ?? false,
          commoditisation_imminente: rawParsed?.flags?.commoditisation_imminente ?? false,
          double_lock_in: rawParsed?.flags?.double_lock_in ?? false,
          data_moat_absent: rawParsed?.flags?.data_moat_absent ?? false,
        },
        sources_utilisees: rawParsed?.sources_utilisees || [],
        iro: {
          ...rawParsed?.iro,
          ipc_confiance: rawParsed?.iro?.ipc_confiance ?? 0.8,
          scores: consensus.scores, // Intégration directe du consensus
          confidence: consensus.confidence, // Confiance apprise par consensus
          score_100: rawParsed?.iro?.score_100 ?? 50,
          interpretation: rawParsed?.iro?.interpretation ?? '',
          justifications: {
            DI: rawParsed?.iro?.justifications?.DI || (rawParsed as any)?.justifications?.DI || (rawParsed as any)?.dimensions?.DI?.justification || `Analyse DI pour ${startup}: dépendance d'infrastructure évaluée d'après le pitch ou stack technique.`,
            ADC: rawParsed?.iro?.justifications?.ADC || (rawParsed as any)?.justifications?.ADC || (rawParsed as any)?.dimensions?.ADC?.justification || `Analyse ADC pour ${startup}: actif de données propriétaire et effet de volant d'apprentissage évalués d'après les éléments partagés.`,
            IPC: rawParsed?.iro?.justifications?.IPC || (rawParsed as any)?.justifications?.IPC || (rawParsed as any)?.dimensions?.IPC?.justification || `Analyse IPC pour ${startup}: profondeur d'intégration aux workflows critiques et outils internes.`,
            AR: rawParsed?.iro?.justifications?.AR || (rawParsed as any)?.justifications?.AR || (rawParsed as any)?.dimensions?.AR?.justification || `Analyse AR pour ${startup}: niveau d'anticipation réglementaire et conformité GDPR/AI Act.`,
            CA: rawParsed?.iro?.justifications?.CA || (rawParsed as any)?.justifications?.CA || (rawParsed as any)?.dimensions?.CA?.justification || `Analyse CA pour ${startup}: capacité d'adaptation de l'architecture et niveau d'agilité face aux ruptures.`,
            GCH: rawParsed?.iro?.justifications?.GCH || (rawParsed as any)?.justifications?.GCH || (rawParsed as any)?.dimensions?.GCH?.justification || `Analyse GCH pour ${startup}: track record de l'équipe fondatrice, séniorité et publications scientifiques.`,
            LU: rawParsed?.iro?.justifications?.LU || (rawParsed as any)?.justifications?.LU || (rawParsed as any)?.dimensions?.LU?.justification || `Analyse LU pour ${startup}: intégration des lead users (von Hippel) et co-construction de valeur.`
          }
        },
        srd: {
          ...rawParsed?.srd,
          srd_100: rawParsed?.srd?.srd_100 ?? 50,
          iro_cr: rawParsed?.srd?.iro_cr ?? 50,
          quadrant: rawParsed?.srd?.quadrant || 'Défensif',
          interpretation: rawParsed?.srd?.interpretation || '',
          horizon_risque_mois: rawParsed?.srd?.horizon_risque_mois ?? 12,
          plan_mitigation: rawParsed?.srd?.plan_mitigation || [],
          VMM: {
            score: consensus.srd?.VMM ?? rawParsed?.srd?.VMM?.score ?? 2,
            justification: rawParsed?.srd?.VMM?.justification || "Default fallback",
          },
          NCD: {
            score: consensus.srd?.NCD ?? rawParsed?.srd?.NCD?.score ?? 2,
            justification: rawParsed?.srd?.NCD?.justification || "Default fallback",
          },
          DFL: {
            score: consensus.srd?.DFL ?? rawParsed?.srd?.DFL?.score ?? 2,
            justification: rawParsed?.srd?.DFL?.justification || "Default fallback",
          },
        },
        synthese: {
          forces: Array.isArray(rawParsed?.synthese?.forces) ? rawParsed.synthese.forces : [],
          risques: Array.isArray(rawParsed?.synthese?.risques) ? rawParsed.synthese.risques : [],
          recommandation: rawParsed?.synthese?.recommandation || "Non renseignée",
          verdict_investisseur: rawParsed?.synthese?.verdict_investisseur || "Non déterminé",
        },
      } as unknown as IROResult;

      setState(s => ({
        ...s,
        lastRouterResult: { response: rawResponse, providerUsed: primaryVote.provider, fallbackTriggered: false },
      }));

      // ── 4. Consensus & validation modèle ────────────────────────────────
      const ipcConf = startupModel.ipc_confiance
        ? parseFloat(startupModel.ipc_confiance as string) : (parsed.iro.ipc_confiance ?? 0.8);
      const adcConf = startupModel.adc_confiance
        ? parseFloat(startupModel.adc_confiance as string) : (parsed.iro.confidence?.ADC ?? 1.0);
      const gchConf = startupModel.gch_confiance
        ? parseFloat(startupModel.gch_confiance as string) : (parsed.iro.confidence?.GCH ?? 1.0);

      const trl = startupModel.trl_niveau ? {
        niveau: parseInt(startupModel.trl_niveau as string),
        description: TRL_DESCRIPTIONS[parseInt(startupModel.trl_niveau as string)],
        source: 'utilisateur' as const,
      } : undefined;

      // Consolidation des passes validées pour le rapport de variance
      const scorePasses: Array<Record<string, number>> = [];
      votes.forEach(v => {
        if (v.success && v.scores) {
          scorePasses.push(v.scores);
        }
      });
      if (scorePasses.length === 0 && parsed.iro?.scores) {
        scorePasses.push(parsed.iro.scores);
      }

      // Garanties scores minimaux pour les calculs suivants
      const safeScores = consensus.scores || parsed.iro?.scores || { DI: 0, ADC: 0, IPC: 0, AR: 0, CA: 0, GCH: 0 };
      const rulesResult = applyModelRules(safeScores, { ...startupModel, nom: startupModel.nom || startup }, githubData || undefined, financialData || undefined);
      const { logs: validationLogs } = rulesResult;
      const finalScores = (rulesResult.adjusted || safeScores) as IROScores;

      if (validationLogs.length > 0) logger.info('Règles de validation appliquées', { logs: validationLogs });

      // ── 5. Calculs IRO ───────────────────────────────────────────────────
      let iro100 = 0;
      let iroESResult = undefined;
      let flagsV45Detected: any = undefined;
      let sectorCodeDetected: any = 'DEFAULT';

      if (isEarlyStageStartup) {
        const esCalcs = calcIROES(finalScores);
        iro100 = esCalcs.score_final;
        iroESResult = {
          is_early_stage: true,
          score_brut: esCalcs.score_brut,
          score_final: esCalcs.score_final,
          zone: esCalcs.zone,
          revs_applied: esCalcs.revs_applied,
        };
      } else {
        // [v4.9-ES] Extraire sector_code et flags_v45 depuis rawParsed (LLMResponse)
        const parsedAny = rawParsed as any;
        sectorCodeDetected = parsedAny?.sector_code ?? 'DEFAULT';
        const flagsV45Raw         = parsedAny?.flags_v45;
        const tauxConfianceGlobal = parsedAny?.taux_confiance_global ?? 100;

        // FLAG BLOQUANT : liquidation judiciaire détectée → rapport bloqué
        if (flagsV45Raw?.liquidation_judiciaire === true) {
          logger.warn('[useIROAnalysis] FLAG BLOQUANT : liquidation_judiciaire détectée — scoring bloqué');
          throw new Error('BLOQUÉ — Liquidation judiciaire détectée dans les sources grises. Aucun score ne peut être produit (protocole IRO v4.5, étape 2 BODACC).');
        }
        // Statut DRAFT si taux de confiance < 70%
        const rapportStatut: 'publishable' | 'draft' | 'blocked' =
          tauxConfianceGlobal >= 70 ? 'publishable'
          : tauxConfianceGlobal >= 50 ? 'draft'
          : 'blocked';
        flagsV45Detected = flagsV45Raw;

        iro100 = calcIRO(finalScores, ipcConf, trl, adcConf, gchConf, expertWeights, flagsV45Detected, sectorCodeDetected as any);
      }
      const alert = detectGoodharting(finalScores);

      // ── Graph Reasoning v7 — 15 arcs de tension, C(6,2) ─────────────────
      // arXiv:2512.23489 — Gaining Paths (2025)
      // Détecte les tensions structurelles non capturées par les patterns binaires.
      // Non-bloquant : si le module échoue, on continue sans graph reasoning.
      let graphResult: import('../utils/goodhart-graph-reasoning').GraphReasoningResult | null = null;
      try {
        graphResult = analyzeGraphTensions(finalScores as any);
      } catch (_e) {
        logger.warn('Graph reasoning échoué — non bloquant', { startup, error: _e });
      }

      const srdResult = calcSRD(
        parsed.srd?.VMM?.score ?? 2, parsed.srd?.NCD?.score ?? 2, parsed.srd?.DFL?.score ?? 2, finalScores.DI ?? 0,
      );
      const srd100 = srdResult.srd;
      const iroCR = calcIROcr(iro100, srd100);
      const interaction = isEarlyStageStartup ? { bonus_total: 0, actions_reussies: [] } : calcInteractionBonus(finalScores);
      const iro100final = Math.max(0, Math.min(100, Math.round((iro100 + interaction.bonus_total) * 10) / 10));

      const bPos = getBenchmarkPosition(iro100final, iroCR);
      const gold = checkGoldStandard(parsed.startup_name, iro100final);
      const passScoresForVariance = isEarlyStageStartup
        ? scorePasses.map(sp => calcIROES(sp as IROScores).score_final)
        : scorePasses.map(sp => calcIRO(sp as IROScores, ipcConf, trl, adcConf, gchConf, expertWeights, flagsV45Detected, sectorCodeDetected as any));

      const vReport = buildVarianceReport(
        scorePasses,
        passScoresForVariance,
        (parsed.sources_utilisees ?? []).length,
        (parsed.sources_utilisees ?? []).length >= 3,
      );
      const cmp = calcCMP(finalScores, ipcConf, adcConf, gchConf);

      const vertical = parsed.vertical || startupModel.vertical || 'DFLT';

      // ── RRF Founder Scoring v7 — 28 features structurées ─────────────────
      // Ozince & Ihlamur arXiv:2407, Griffin arXiv:2505, Kumar arXiv:2509
      // Calcule GCH structuré depuis les profils fondateurs si disponibles.
      // Remplace le GCH purement qualitatif si founders présents.
      let gchStructured: import('../collectors/founder-scoring-rrf').GCHStructuredResult | null = null;
      try {
        const founders = (startupModel as any).gch_founders as FounderProfile[] | undefined;
        if (founders && founders.length > 0) {
          gchStructured = scoreGCHStructured(founders, vertical);
          // Remplacement GCH si confiance RRF > confiance LLM
          if (gchStructured.confidence >= (gchConf ?? 0.5)) {
            finalScores.GCH = Math.round(gchStructured.score);
            logger.info('GCH remplacé par RRF founder scoring', {
              startup,
              gch_rrf: gchStructured.score,
              gch_llm: safeScores.GCH,
              rules: gchStructured.rrf_rules_fired.slice(0, 3),
            });
          }
        }
      } catch (_e) {
        logger.warn('RRF founder scoring échoué — GCH LLM conservé', { startup, error: _e });
      }

      // ── Dynamique temporelle (H5 + Honeymoon) ────────────────────────────
      // Fetch entire history for this startup for velocity
      const allEntriesRes = await fetch('/api/audit');
      const allEntries: AuditEntry[] = await allEntriesRes.json();
      
      // Convert current scoring to an AuditEntry format (mimic)
      const currentAsAudit: Record<string, any> = {
        timestamp: new Date().toISOString(),
        startup_name: startup,
        iro_total: iro100final,
        iro_cr: iroCR,
        ...finalScores
      };

      const startupEntries = [
        ...allEntries.filter(e => e.startup_name.toLowerCase() === startup.toLowerCase()),
        currentAsAudit as AuditEntry
      ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const velocity = computeIROVelocity(startupEntries);
      const currentPappersAgeMois = pappersData ? mapPappersToIROContext(pappersData).age_mois : undefined;
      const ageMois = parsed.age_mois ?? currentPappersAgeMois ?? startupModel.age_mois ?? 0;
      const honeymoon = computeHoneymoonProfile(ageMois, vertical);
      const diVelocity = computeDIVelocity(finalScores.DI ?? 0, parsed.srd?.VMM?.score ?? 2);

      const fsfInput = parsed.fsf || extractFSFFromModel(startupModel as any, parsed as any) || (startupModel as any).fsf;

      const coxRes = coxFullDynamicV2({
        irocr: iroCR,
        iro_final: iro100final,
        iro_cr_display: iroCR,
        di_zero: finalScores.DI === 0,
        srd_high: srd100 >= 60,
        adc_strong: (finalScores.ADC ?? 0) >= 3,
        ipc_strong: (finalScores.IPC ?? 0) >= 3,
        regulated_sector: ['HLTH', 'FINT', 'INDU'].includes(vertical),
        age_mois: ageMois,
        vertical: vertical,
        velocity_pts_per_month: velocity?.velocity_global ?? undefined,
        fsf: fsfInput,
      }, startupEntries);

      const crInput = {
        irocr: iroCR,
        di_zero: finalScores.DI === 0,
        adc_strong: (finalScores.ADC ?? 0) >= 3,
        ipc_strong: (finalScores.IPC ?? 0) >= 3,
        ca_strong: (finalScores.CA ?? 0) >= 3,
        age_mois: ageMois,
        velocity_global: velocity?.velocity_global ?? undefined,
      };

      // ── DeepHit (v7) — PMF gaussienne, sans hypothèse Fine-Gray ──────────
      // Remplace computeCompetingRisks (Fine-Gray) — Lee et al. AAAI 2018.
      // Fallback sur Fine-Gray si DeepHit échoue (non-bloquant).
      let competingRisks;
      try {
        competingRisks = computeCompetingRisksDeepHit(crInput);
      } catch (_e) {
        logger.warn('DeepHit échoué — fallback Fine-Gray', { startup, error: _e });
        competingRisks = computeCompetingRisks(crInput);
      }

      // ── 6. Graphe relationnel ────────────────────────────────────────────
      const graph: StartupGraph = {
        nodes: (parsed.sources_utilisees ?? []).slice(0, 8).map(url => ({
          type: url.includes('linkedin') ? 'fondateur' as const
            : url.includes('github') ? 'concurrent' as const
            : url.includes('crunchbase') ? 'investisseur' as const : 'startup' as const,
          name: url.replace(/https?:\/\//, '').split('/')[0],
          signal: 'neutre' as const,
          detail: url,
        })),
        signal_global: (finalScores.DI === 0 || (srd100 >= 65 && (finalScores.IPC ?? 0) <= 1))
          ? 'défavorable' : iro100 >= 65 ? 'favorable' : 'neutre',
        nb_relations_verifiees: (parsed.sources_utilisees ?? []).length,
      };

      // ── 7. Assemblage du résultat final ──────────────────────────────────
      const flags = {
        ...(parsed.flags || {}),
        floor_activated: finalScores.DI === 0,
        ancrage_warning: (finalScores.IPC ?? 0) <= 1 && (finalScores.ADC ?? 0) >= 3,
        commoditisation_imminente: srd100 >= 65 && (finalScores.IPC ?? 0) <= 1,
        double_lock_in: (parsed.srd?.DFL?.score ?? 2) >= 3 && finalScores.DI === 0,
        data_moat_absent: (parsed.srd?.VMM?.score ?? 2) === 4 && (finalScores.ADC ?? 0) <= 1,
        lu_data_gap: (finalScores.LU ?? 0) >= 3 && (finalScores.ADC ?? 0) <= 1,
        lu_ipc_anchor: (finalScores.LU ?? 0) >= 3 && (finalScores.IPC ?? 0) >= 3,
        lu_type: (parsed.flags as any)?.lu_type || (rawParsed as any)?.lu_type || 'hybride',
      };

      const final: IROResult & { iro_es?: any } = {
        ...parsed,
        iro: { ...parsed.iro, scores: finalScores, score_100: iro100final, interpretation: interpIRO(iro100final) },
        srd: { ...parsed.srd, srd_100: srd100, iro_cr: iroCR, quadrant: getQuadrant(iro100final, srd100), srd_result: srdResult },
        flags: flags as IROResult['flags'],
        benchmark_pos: bPos,
        cox_survival: coxRes,
        competing_risks: competingRisks,
        temporal: { honeymoon, velocity, diVelocity },
        fsf: coxRes.fsf,
        dual_horizon: coxRes.dual_horizon,
        // ── Champs v7 ────────────────────────────────────────────────────────
        graph_reasoning: graphResult ?? undefined,
        graph_tensions: graphResult?.tensions ?? undefined,
        gch_structured: gchStructured ?? undefined,
        consensus_report: consensus,
        iro_es: iroESResult,
        // [FIX 12/07/2026 — correction] webIntelligence était déjà collecté à ce
        // stade (voir fetchWebIntelligence() plus haut, post-consensus) mais
        // jamais rattaché à `final` avant l'appel à buildInvestorReport(final)
        // ci-dessous : la Section 7 "Intelligence externe" du rapport ne
        // recevait donc jamais de données presse en pratique, malgré un
        // typage et un rendu Markdown corrects. Même correctif appliqué à
        // pressIntelligence (v8.0) pour éviter la même régression dès sa
        // première intégration.
        webIntelligence:   webIntel,
        pressIntelligence: pressIntel,
      };

      // ── Rapport investisseur natif (Correctif B4) ─────────────────────────
      let investorReport: InvestorReport | undefined;
      try {
        investorReport = buildInvestorReport(final);
        final.investorReport = investorReport;
      } catch (err) {
        console.warn('[B4] buildInvestorReport failed:', err);
      }

      // ── Taux de corroboration (Correctif D1) ─────────────────
      if (vReport && investorReport) {
        try {
          const activeSources: Record<string, boolean> = {
            github: !!githubData,
            financial: !!financialData,
            pappers: !!pappersData || !!findKnownSirenEntry(startup) || !!(startupModel as any)?.siren,
          };
          const dimDetails = Object.values(investorReport.dimensions);
          const corroboration = computeCorroborationMetrics(dimDetails, activeSources);
          vReport.corroboration = corroboration;
        } catch (_err) {
          console.warn('[D1] computeCorroborationMetrics failed:', _err);
        }
      }

      // ── 8. Historique & audit ────────────────────────────────────────────
      const newAuditEntry: Omit<AuditEntry, 'id'> = {
        timestamp: currentAsAudit.timestamp,
        startup_name: startup,
        iro_total: final.iro.score_100,
        iro_cr: final.srd.iro_cr,
        srd: final.srd.srd_100,
        ...final.iro.scores,
        DI: final.iro.scores.DI,
        ADC: final.iro.scores.ADC,
        IPC: final.iro.scores.IPC,
        AR: final.iro.scores.AR,
        CA: final.iro.scores.CA,
        GCH: final.iro.scores.GCH,
        ipc_conf: ipcConf,
        adc_conf: adcConf,
        gch_conf: gchConf,
        trl: trl?.niveau ?? 5,
        evaluator: 'E1',
        model_version: `IRO v${version}`,
        source_type: 'gemini_pipeline',
        goodhart_patterns: JSON.stringify(alert.patterns),
        notes: final.iro.interpretation,
        status: 'unknown',
        gold_standard_ref: gold?.id,
      };

      // Audit journal
      const auditResponse = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAuditEntry),
      });
      
      const auditResData = await auditResponse.json();
      
      const prevEntry = history.find(h => h.startup.toLowerCase() === startup.toLowerCase());
      let dynamics: DynamicIndicators | undefined;
      if (velocity) {
        dynamics = {
          ivr: velocity.velocity_global,
          icd: velocity.confidence === 'high' ? 0.9 : 0.6,
          iro_proj_18m: velocity.snapshots[velocity.snapshots.length-1].iro_total + (velocity.velocity_global * 12),
          progression_desequilibree: velocity.trend === 'volatile',
          regression_confirmed: velocity.velocity_global < 0
        };
      } else if (prevEntry) {
        dynamics = calcBenchmark(prevEntry.result.iro.score_100, parsed.vertical as any) as unknown as DynamicIndicators;
      }

      // [FIX] ID garanti unique même si le serveur SQLite redémarre (collision sur lastInsertRowid=1)
      const uniqueId = `h-${auditResData.id || 'x'}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

      const entry: HistoryEntry = {
        id: uniqueId,
        startup,
        result: final as unknown as HistoryEntry['result'],
        date: new Date().toLocaleString('fr-FR'),
        dynamics: dynamics as HistoryEntry['dynamics'],
        gold,
      };
      const newHistory = [entry, ...history.filter(h => h.startup.toLowerCase() !== startup.toLowerCase()).slice(0, 19)];
      setHistory(newHistory);

      try { localStorage.setItem(lsKey, JSON.stringify(newHistory)); }
      catch (e) { logger.warn('localStorage indisponible', { error: e }); }

      // ── 9. Mise à jour state ─────────────────────────────────────────────
      const newGoodhartLogs = alert.triggered
        ? logGoodhartAlert(startup, alert, state.goodhartLogs)
        : state.goodhartLogs;

      try { localStorage.setItem('iro_goodhart_logs', JSON.stringify(newGoodhartLogs)); }
      catch { /* silencieux */ }

      setState(s => ({
        ...s,
        loading: false,
        loadingStep: 'idle',
        result: final as unknown as IROResult,
        varianceReport: vReport as unknown as VarianceReport,
        cmpValues: cmp as unknown as CMPValues,
        startupGraph: graph,
        goodhartAlert: alert,
        goodhartLogs: newGoodhartLogs,
        validationLogs,
        velocity,
        honeymoon,
        diVelocity,
        // ── Champs v7 ──────────────────────────────────────────────────────
        graphReasoning: graphResult,
        gchStructured,
        deephitUsed: true,
        webIntelligence: webIntel,
        pressIntelligence: pressIntel,
        investorReport,
        error: null,
      }));

      // ── Étape 8b : Mise à jour de la mémoire persistante ────────────────
      try {
        await updateStartupMemory(
          startup,
          final.iro.scores,
          final.iro.score_100,
          final.srd.iro_cr,
          final.iro.interpretation
        );
      } catch (me) {
        logger.warn('Erreur mise à jour de la mémoire persistante', { error: me });
      }

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      logger.error('Analyse IRO échouée', { startup, error: msg });
      setState(s => ({ ...s, loading: false, loadingStep: 'idle', error: msg }));
    }
  }, [state.goodhartLogs]);

  const setResult = useCallback((r: IROResult | null) => {
    setState(s => ({ ...s, result: r }));
  }, []);

  const setError = useCallback((e: string | null) => {
    setState(s => ({ ...s, error: e }));
  }, []);

  return { ...state, analyze, reset, setResult, setError };
}
