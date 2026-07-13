/**
 * StartupPhasePanel.tsx — IRO v7.0
 *
 * Détecte d'abord le TYPE d'entité (Startup / Scale-up / Groupe établi / Coté),
 * puis adapte toute la logique : phase, financement, métriques de référence.
 *
 * Correction critique v7.1 :
 *   - Grand groupe (age > 120m) ou Public/Coté → mode "Transformation IA"
 *   - Les grandes entreprises ne lèvent pas des fonds VC — elles font du M&A,
 *     de la dette, des augmentations de capital, ou des programmes de ventures
 *   - Tableau de bord adapté selon l'entité : KPIs, risques, recommandations
 */

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sprout, Flame, Crown, Building2, AlertTriangle,
  ChevronDown, ChevronUp, CheckCircle2, XCircle,
  Landmark, ArrowRight, TrendingUp, Shield, Zap,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StartupPhaseInput {
  age_mois: number;
  iro_score: number;
  iro_cr: number;
  srd_score: number;
  di: number;   // 0-4
  adc: number;
  ipc: number;
  ar: number;
  ca: number;
  gch: number;
  vertical: string;
  stade_financement: string;
  clients_actifs: number | null;
  quadrant: string;
}

// ── Catégories d'entité ────────────────────────────────────────────────────────

export type EntityCategory =
  | 'startup_early'      // < 24m
  | 'startup_growth'     // 24-60m, non coté
  | 'scaleup'            // 60-120m, non coté
  | 'established'        // > 120m, non coté (PME/ETI mature)
  | 'listed'             // coté en bourse (Euronext, NYSE, etc.)
  | 'corporate'          // grand groupe (> 300m ou "Public")
  | 'public_institution' // institution publique / banque centrale

const ENTITY_LABELS: Record<EntityCategory, { label: string; emoji: string; color: string; desc: string }> = {
  startup_early:      { label: 'Startup Early',    emoji: '🌱', color: '#00c896', desc: 'Phase de validation et construction produit' },
  startup_growth:     { label: 'Startup Growth',   emoji: '🚀', color: '#f97316', desc: 'Croissance accélérée, mise à l\'échelle' },
  scaleup:            { label: 'Scale-up',          emoji: '⚡', color: '#4d9fff', desc: 'Organisation structurée, expansion continue' },
  established:        { label: 'PME/ETI Mature',   emoji: '🏗️', color: '#a78bfa', desc: 'Entreprise établie, croissance stable' },
  listed:             { label: 'Société Cotée',     emoji: '📈', color: '#fbbf24', desc: 'Entité publique cotée sur un marché réglementé' },
  corporate:          { label: 'Grand Groupe',      emoji: '🏛️', color: '#c47efd', desc: 'Entreprise de taille institutionnelle' },
  public_institution: { label: 'Institution',      emoji: '🏦', color: '#60a5fa', desc: 'Institution publique ou réglementée' },
};

// ── Phases (uniquement pour startups & scale-ups) ────────────────────────────

interface Phase {
  id: 'demarrage' | 'croissance' | 'maturite';
  label: string;
  icon: React.ReactNode;
  color: string;
  ageRange: [number, number];
  iroRange: [number, number];
  description: string;
}

const PHASES: Phase[] = [
  {
    id: 'demarrage', label: 'Démarrage', icon: <Sprout size={14} />,
    color: '#00c896', ageRange: [0, 24], iroRange: [0, 55],
    description: 'Validation produit, construction équipe, premières traction clients.',
  },
  {
    id: 'croissance', label: 'Croissance', icon: <Flame size={14} />,
    color: '#f97316', ageRange: [12, 60], iroRange: [45, 75],
    description: 'Accélération commerciale, mise à l\'échelle, structuration des processus.',
  },
  {
    id: 'maturite', label: 'Maturité', icon: <Crown size={14} />,
    color: '#c47efd', ageRange: [48, 999], iroRange: [60, 100],
    description: 'Position ancrée, profitabilité en vue, préparation à la sortie.',
  },
];

// ── Substades ─────────────────────────────────────────────────────────────────

interface Substade {
  id: string; label: string; phase: Phase['id']; icon: string;
  ageMin: number; ageMax: number; iroMin: number; iroMax: number;
  description: string; risques: string[]; leviers: string[];
}

const SUBSTADES: Substade[] = [
  {
    id: 'ideation', label: 'Idéation / Bootstrapping', phase: 'demarrage', icon: '🌱',
    ageMin: 0, ageMax: 6, iroMin: 0, iroMax: 40,
    description: 'L\'équipe fondatrice valide la problématique. MVP en construction.',
    risques: ['Manque de validation marché', 'Équipe incomplète', 'Cash burn rapide'],
    leviers: ['Interviews clients', 'MVP frugal', 'Réseau fondateurs'],
  },
  {
    id: 'mvp', label: 'MVP / Premiers clients', phase: 'demarrage', icon: '🔬',
    ageMin: 4, ageMax: 14, iroMin: 25, iroMax: 55,
    description: 'Premiers clients bêta, itérations produit rapides. ARR < 300k€.',
    risques: ['Churn élevé', 'Proposition de valeur floue', 'IPC faible'],
    leviers: ['Customer Success', 'Pricing testing', 'Référencement secteur'],
  },
  {
    id: 'pmf', label: 'Product-Market Fit', phase: 'croissance', icon: '🎯',
    ageMin: 10, ageMax: 24, iroMin: 42, iroMax: 68,
    description: 'NPS positif, rétention prouvée, répétabilité commerciale. ARR 300k€–2M€.',
    risques: ['Passage à l\'échelle prématuré', 'Concentration client', 'Recrutement raté'],
    leviers: ['Playbook sales', 'Partenariats distributeurs', 'Content marketing'],
  },
  {
    id: 'acceleration', label: 'Accélération', phase: 'croissance', icon: '🚀',
    ageMin: 18, ageMax: 60, iroMin: 55, iroMax: 78,
    description: 'Croissance >2×/an, expansion géographique ou sectorielle. ARR 2M€–20M€.',
    risques: ['Complexité organisationnelle', 'Culture diluée', 'Margin pressure'],
    leviers: ['Expansion EU/US', 'Verticaux adjacents', 'Acquisitions tactiques'],
  },
  {
    id: 'consolidation', label: 'Consolidation', phase: 'maturite', icon: '🏗️',
    ageMin: 48, ageMax: 120, iroMin: 65, iroMax: 85,
    description: 'Position leader. Profitabilité opérationnelle. ARR 20M€–100M€.',
    risques: ['Disrupteurs IA', 'Bureaucratisation', 'Attrition senior'],
    leviers: ['M&A défensifs', 'Intégration verticale', 'Programme enterprise'],
  },
  {
    id: 'leadership', label: 'Leadership / Pre-IPO', phase: 'maturite', icon: '🎯',
    ageMin: 72, ageMax: 999, iroMin: 72, iroMax: 100,
    description: 'Leader de marché, moat VRIN documenté, sortie en préparation.',
    risques: ['Pression actionnaires', 'Régulation accrue', 'Innovation de rupture'],
    leviers: ['Gouvernance institutionnelle', 'ESG/reporting', 'Due diligence IPO'],
  },
];

// ── Tours de financement Startup ──────────────────────────────────────────────

interface FinancingRound {
  stade: string; label: string; fourchette: string; icon: string; color: string;
  investors: string[];
  conditions: { minIRO: number; minDI: number; minGCH: number; minAge: number; maxAge: number };
  use_of_funds: string[];
  valuation_multiple: Record<string, string>;
}

const FINANCING_ROUNDS: FinancingRound[] = [
  {
    stade: 'pre_seed', label: 'Pré-amorçage', fourchette: '< 150 k€', icon: '🌱', color: '#00c896',
    investors: ['Business Angels', 'FFF', 'Bpifrance i-Lab', 'Incubateurs publics'],
    conditions: { minIRO: 0, minDI: 0, minGCH: 1, minAge: 0, maxAge: 8 },
    use_of_funds: ['MVP fonctionnel', 'Co-fondateur technique', 'Premiers tests marché'],
    valuation_multiple: { HLTH: 'Pre-revenue', FINT: 'Pre-revenue', SAAS: 'Pre-revenue', INDU: 'Pre-revenue', LEGT: 'Pre-revenue' },
  },
  {
    stade: 'seed', label: 'Seed', fourchette: '150 k€ — 1 M€', icon: '🌿', color: '#4ade80',
    investors: ['Business Angels', 'Kima Ventures', 'Founders Future', 'Bpifrance Émergence', 'XAnge'],
    conditions: { minIRO: 30, minDI: 1, minGCH: 2, minAge: 3, maxAge: 20 },
    use_of_funds: ['Équipe produit core', 'Premières acquisitions clients', 'Validation IPC'],
    valuation_multiple: { HLTH: '1-3× ARR', FINT: '2-4× ARR', SAAS: '3-5× ARR', INDU: '1-2× ARR', LEGT: '2-3× ARR' },
  },
  {
    stade: 'serie_a', label: 'Série A', fourchette: '1 M€ — 8 M€', icon: '🚀', color: '#f97316',
    investors: ['Partech', 'Elaia', 'Alven', 'BPI Large Venture', 'Newfund'],
    conditions: { minIRO: 50, minDI: 2, minGCH: 2, minAge: 12, maxAge: 36 },
    use_of_funds: ['Mise à l\'échelle commerciale', 'Recrutement C-level', 'Expansion EU'],
    valuation_multiple: { HLTH: '5-8× ARR', FINT: '4-7× ARR', SAAS: '6-10× ARR', INDU: '3-5× ARR', LEGT: '4-6× ARR' },
  },
  {
    stade: 'serie_b', label: 'Série B', fourchette: '5 M€ — 25 M€', icon: '⚡', color: '#4d9fff',
    investors: ['Balderton', 'Accel', 'Index Ventures', 'Idinvest', 'Ardian Growth'],
    conditions: { minIRO: 61, minDI: 2, minGCH: 3, minAge: 24, maxAge: 60 },
    use_of_funds: ['Expansion internationale', 'M&A tactiques', 'R&D IA structurée'],
    valuation_multiple: { HLTH: '8-15× ARR', FINT: '7-12× ARR', SAAS: '10-20× ARR', INDU: '4-8× ARR', LEGT: '6-10× ARR' },
  },
  {
    stade: 'serie_c_plus', label: 'Série C+', fourchette: '20 M€ — 100 M€', icon: '🏛️', color: '#c47efd',
    investors: ['SoftBank', 'Tiger Global', 'General Atlantic', 'BPI Lac1', 'CVC'],
    conditions: { minIRO: 70, minDI: 3, minGCH: 3, minAge: 42, maxAge: 96 },
    use_of_funds: ['Leadership marché', 'Acquisitions structurantes', 'Préparation pré-IPO'],
    valuation_multiple: { HLTH: '12-25× ARR', FINT: '10-18× ARR', SAAS: '15-30× ARR', INDU: '6-12× ARR', LEGT: '8-15× ARR' },
  },
  {
    stade: 'pre_ipo', label: 'Pre-IPO / M&A', fourchette: '> 50 M€', icon: '👑', color: '#fbbf24',
    investors: ['Goldman Sachs', 'JPMorgan Growth', 'Eurazeo', 'Hg Capital', 'Acquéreurs stratégiques'],
    conditions: { minIRO: 75, minDI: 3, minGCH: 4, minAge: 60, maxAge: 999 },
    use_of_funds: ['Gouvernance IPO', 'Due diligence acheteur', 'Structure capitalistique'],
    valuation_multiple: { HLTH: '20-40× ARR', FINT: '15-25× ARR', SAAS: '20-40× ARR', INDU: '8-15× ARR', LEGT: '12-20× ARR' },
  },
];

// ── Mécanismes de financement pour entités établies ───────────────────────────

interface CorporateFinancing {
  id: string; label: string; icon: string; color: string;
  description: string;
  instruments: string[];
  montants: string;
  use_cases: string[];
  conditions_favorables: string[];
}

const CORPORATE_FINANCING: CorporateFinancing[] = [
  {
    id: 'augmentation_capital', label: 'Augmentation de Capital', icon: '📊', color: '#4d9fff',
    description: 'Émission de nouvelles actions pour lever des fonds propres auprès des actionnaires existants ou de nouveaux investisseurs.',
    instruments: ['Droit préférentiel de souscription (DPS)', 'Augmentation réservée', 'ABSA / OCEANE'],
    montants: '100 M€ — plusieurs Md€',
    use_cases: ['Renforcement bilan', 'Financement d\'acquisitions', 'Désendettement'],
    conditions_favorables: ['Cours boursier > valeur comptable', 'Confiance des marchés', 'Projet d\'acquisition identifié'],
  },
  {
    id: 'dette_senior', label: 'Dette Senior / Obligataire', icon: '🏦', color: '#00c896',
    description: 'Émission d\'obligations ou crédit syndiqué auprès d\'investisseurs institutionnels ou de banques.',
    instruments: ['Obligations à taux fixe', 'Crédit syndiqué', 'MTN (Medium Term Notes)', 'Eurobonds'],
    montants: '50 M€ — plusieurs Md€',
    use_cases: ['Refinancement dette existante', 'Financement CAPEX IA', 'Acquisition ciblée'],
    conditions_favorables: ['Investment Grade (BBB+ ou mieux)', 'Free cash-flow positif', 'Taux directeurs stabilisés'],
  },
  {
    id: 'corporate_venture', label: 'Corporate Venture / CVC', icon: '🔬', color: '#f97316',
    description: 'Prise de participation dans des startups IA pour accéder à l\'innovation sans l\'intégrer directement.',
    instruments: ['Fonds CVC interne', 'Co-investissement avec VC', 'Programmes d\'accélération', 'Joint-ventures technologiques'],
    montants: '1 M€ — 50 M€ par ligne',
    use_cases: ['Accès technologique IA', 'Scouting innovation', 'Option d\'acquisition future'],
    conditions_favorables: ['IRO DI faible (nécessité d\'externalisation)', 'Pression SRD élevée', 'Board favorable à l\'open innovation'],
  },
  {
    id: 'ma_strategique', label: 'M&A Stratégique IA', icon: '🎯', color: '#c47efd',
    description: 'Acquisition ciblée de startups ou acteurs IA pour accélérer la transformation digitale.',
    instruments: ['Acquisition 100%', 'Prise de participation majoritaire', 'Asset deal', 'Earn-out IA'],
    montants: '10 M€ — plusieurs Md€',
    use_cases: ['Acquérir un DI élevé', 'Intégrer un ADC exclusif', 'Éliminer un concurrent'],
    conditions_favorables: ['IRO DI ≤ 2 (urgence)', 'SRD NCD élevé', 'Cible identifiée à valorisation raisonnable'],
  },
  {
    id: 'partenariat_hyperscaler', label: 'Partenariat Hyperscaler', icon: '☁️', color: '#818cf8',
    description: 'Alliance stratégique avec Microsoft, Google, AWS ou Mistral pour accéder à l\'infrastructure IA sans capex.',
    instruments: ['Accord commercial pluriannuel', 'Co-développement', 'Investissement croisé', 'Revenue sharing'],
    montants: 'Valeur contractuelle : 100 M€+',
    use_cases: ['Migration cloud IA', 'Accès GPU sans investissement', 'Co-branding technologique'],
    conditions_favorables: ['DI actuel faible (API pure)', 'Urgence SRD VMM élevé', 'Capacité de négociation (taille)'],
  },
];

// ── Détection d'entité ─────────────────────────────────────────────────────────

function detectEntityCategory(input: StartupPhaseInput): EntityCategory {
  const { age_mois, stade_financement } = input;
  const stade = (stade_financement ?? '').toLowerCase();

  // ── GARDE ABSOLU : âge > 120 mois (10 ans) = jamais Startup ──────────────
  // Quelle que soit la valeur de stade_financement, une entité de 10+ ans
  // ne peut pas être en phase de financement VC early-stage.
  if (age_mois > 120) {
    // Affiner selon les signaux disponibles
    const isListedSignal = /euronext|nyse|nasdaq|cac\s*40|bourse|coté|listed|public|ipo|cotée?/i.test(stade);
    const isBankSignal   = /banque|bank|assur|insurance|crédit|financ|établissement/i.test(stade);
    const isCorpSignal   = /groupe|holding|conglomérat|corporate|enterprise|pme|eti/i.test(stade);
    if (age_mois > 300 || isBankSignal) return 'corporate';
    if (isListedSignal) return 'listed';
    if (isCorpSignal)   return 'established';
    if (age_mois > 240) return 'corporate';   // > 20 ans → corporate par défaut
    return 'established';
  }

  // Institutions publiques (banques centrales, administrations)
  const isPublicInstitution = /banque\s+de\s+france|bce|banque\s+centrale|fed\s|gouvernement|ministry|état\s|ministère/i.test(stade);
  if (isPublicInstitution) return 'public_institution';

  // Entités cotées
  const isListed = /euronext|nyse|nasdaq|cac\s*40|bourse|coté|listed|public|ipo\s*réalisé|cotée?\s*(en\s+)?bourse/i.test(stade)
    || stade === 'public';
  if (isListed) return 'listed';

  // Grands groupes / banques par stade déclaratif
  const isCorporate = /banque|bank|assur|insurance|gouvernement|public institution|state|établissement|groupe|holding|conglomérat|grand\s+groupe|large\s+enterprise/i.test(stade);
  if (isCorporate) return 'corporate';

  // Classification par âge pour entités < 120m
  if (age_mois > 60)  return 'scaleup';
  if (age_mois > 24)  return 'startup_growth';
  return 'startup_early';
}

// ── Analyse transformation IA (pour entités établies) ─────────────────────────

interface TransformationAnalysis {
  urgence: 'critique' | 'élevée' | 'modérée' | 'faible';
  urgenceColor: string;
  di_gap: string;
  financement_recommande: CorporateFinancing;
  financement_alternatif: CorporateFinancing;
  actions_prioritaires: string[];
  horizon_mois: number;
  iro_cible_18m: number;
}

function analyzeTransformation(input: StartupPhaseInput): TransformationAnalysis {
  const { iro_score, srd_score, di, adc, ipc } = input;
  const srdHigh = srd_score > 55;
  const diLow = di <= 1;
  const urgenceScore = (srdHigh ? 2 : 0) + (diLow ? 2 : 0) + (iro_score < 55 ? 1 : 0);

  let urgence: TransformationAnalysis['urgence'];
  let urgenceColor: string;
  if (urgenceScore >= 4) { urgence = 'critique'; urgenceColor = '#ef4444'; }
  else if (urgenceScore >= 3) { urgence = 'élevée'; urgenceColor = '#f97316'; }
  else if (urgenceScore >= 2) { urgence = 'modérée'; urgenceColor = '#fbbf24'; }
  else { urgence = 'faible'; urgenceColor = '#00c896'; }

  const di_gap = di <= 0 ? 'Wrapper API pur — dépendance totale' :
                 di === 1 ? 'Abstraction légère — RAG/embeddings custom' :
                 di === 2 ? 'Fine-tuning partiel — bonne base' :
                 di === 3 ? 'Infra significative — switching cost réel' :
                 'Infra VRIN — autonomie totale';

  // Financement recommandé selon profil
  let financement_recommande: CorporateFinancing;
  let financement_alternatif: CorporateFinancing;

  if (diLow && srdHigh) {
    financement_recommande = CORPORATE_FINANCING.find(f => f.id === 'ma_strategique')!;
    financement_alternatif = CORPORATE_FINANCING.find(f => f.id === 'corporate_venture')!;
  } else if (diLow) {
    financement_recommande = CORPORATE_FINANCING.find(f => f.id === 'partenariat_hyperscaler')!;
    financement_alternatif = CORPORATE_FINANCING.find(f => f.id === 'corporate_venture')!;
  } else if (srdHigh) {
    financement_recommande = CORPORATE_FINANCING.find(f => f.id === 'ma_strategique')!;
    financement_alternatif = CORPORATE_FINANCING.find(f => f.id === 'dette_senior')!;
  } else {
    financement_recommande = CORPORATE_FINANCING.find(f => f.id === 'dette_senior')!;
    financement_alternatif = CORPORATE_FINANCING.find(f => f.id === 'augmentation_capital')!;
  }

  const actions: string[] = [];
  if (diLow) actions.push('Accélérer le programme IA interne (DI ≤ 1 = exposition maximale)');
  if (srdHigh) actions.push('Réduire SRD en sécurisant des actifs de données exclusifs (ADC)');
  if (ipc < 2) actions.push('Approfondir l\'intégration IA dans les processus critiques métier');
  if (adc < 2) actions.push('Constituer un patrimoine de données propriétaires irréproductibles');
  if (actions.length === 0) actions.push('Maintenir l\'avantage IRO par l\'innovation continue et la gouvernance');

  return {
    urgence,
    urgenceColor,
    di_gap,
    financement_recommande,
    financement_alternatif,
    actions_prioritaires: actions,
    horizon_mois: 18,
    iro_cible_18m: Math.min(100, Math.round(iro_score + (4 - di) * 3 + (4 - adc) * 2)),
  };
}

// ── Engine principal ───────────────────────────────────────────────────────────

function classifyStartup(input: StartupPhaseInput) {
  const entityCategory = detectEntityCategory(input);
  const entityInfo = ENTITY_LABELS[entityCategory];
  const isEstablished = ['established', 'listed', 'corporate', 'public_institution'].includes(entityCategory);

  if (isEstablished) {
    // Mode Transformation IA — pas de rounds VC
    const transformation = analyzeTransformation(input);
    return {
      entityCategory,
      entityInfo,
      isEstablished: true as const,
      transformation,
      // Champs startup mis à null pour compatibilité
      phase: null,
      substade: null,
      type: { id: entityCategory, label: entityInfo.label, emoji: entityInfo.emoji, color: entityInfo.color, conditions: () => true, description: entityInfo.desc },
      recommendedRound: null,
      nextRound: null,
      blockers: [],
      maturityScore: Math.round(Math.min(input.iro_score, 100)),
      currentRoundIndex: -1,
      eligibleRoundsCount: 0,
    };
  }

  // Mode Startup / Scale-up
  const { age_mois, iro_score } = input;

  // Phase
  const phaseScores = PHASES.map(p => ({
    phase: p,
    score: (age_mois >= p.ageRange[0] && age_mois <= p.ageRange[1] ? 0.6 : 0)
         + (iro_score >= p.iroRange[0] && iro_score <= p.iroRange[1] ? 0.4 : 0),
  }));
  const bestPhase = phaseScores.sort((a, b) => b.score - a.score)[0].phase;

  // Substade
  const substadeScores = SUBSTADES.filter(s => s.phase === bestPhase.id).map(s => ({
    substade: s,
    score: (age_mois >= s.ageMin && age_mois <= s.ageMax ? 1 : 0)
         + (iro_score >= s.iroMin && iro_score <= s.iroMax ? 1 : 0),
  }));
  const bestSubstade = substadeScores.sort((a, b) => b.score - a.score)[0]?.substade ?? SUBSTADES[0];

  // Type
  const TYPE_MAP = [
    { id: 'fragile',       label: 'Profil Fragile',   emoji: '⚠️', color: '#ef4444', cond: (i: StartupPhaseInput) => i.iro_score < 45 || i.srd_score > 60 },
    { id: 'pionnier',      label: 'Pionnier',          emoji: '🔭', color: '#00c896', cond: (i: StartupPhaseInput) => bestPhase.id === 'demarrage' && i.di >= 2 },
    { id: 'challenger',    label: 'Challenger',        emoji: '⚡', color: '#f97316', cond: (i: StartupPhaseInput) => bestPhase.id === 'croissance' && i.ipc >= 2 && i.iro_score >= 50 },
    { id: 'scale_up',      label: 'Scale-up',          emoji: '🚀', color: '#4d9fff', cond: (i: StartupPhaseInput) => bestPhase.id === 'croissance' && i.iro_score >= 62 && i.ipc >= 3 },
    { id: 'consolide',     label: 'Consolidé',         emoji: '🏛️', color: '#c47efd', cond: (i: StartupPhaseInput) => bestPhase.id === 'maturite' && i.adc >= 3 && i.iro_score >= 68 },
    { id: 'institutionnel',label: 'Institutionnel',    emoji: '👑', color: '#fbbf24', cond: (i: StartupPhaseInput) => bestPhase.id === 'maturite' && i.gch >= 3 && i.iro_score >= 75 },
  ];
  const matchedType = TYPE_MAP.find(t => t.cond(input)) ?? TYPE_MAP[0];
  const typeObj = { ...matchedType, conditions: matchedType.cond, description: '' };

  // Tours éligibles
  const eligibleRounds = FINANCING_ROUNDS.filter(r => {
    const c = r.conditions;
    return age_mois >= c.minAge && age_mois <= c.maxAge
        && iro_score >= c.minIRO && input.di >= c.minDI && input.gch >= c.minGCH;
  });
  
  // Si aucun tour n'est pleinement éligible d'après les scores réunis,
  // on sélectionne un tour de table basé sur l'âge de l'entreprise
  // afin de ne pas retomber systématiquement sur du "Pré-amorçage" par défaut.
  // Cela permet de calculer des blockers réalistes par rapport au stade d'âge de l'entité.
  let recommendedRound = eligibleRounds[eligibleRounds.length - 1];
  if (!recommendedRound) {
    const ageRounds = FINANCING_ROUNDS.filter(r => age_mois >= r.conditions.minAge && age_mois <= r.conditions.maxAge);
    if (ageRounds.length > 0) {
      recommendedRound = ageRounds[ageRounds.length - 1];
    } else {
      recommendedRound = FINANCING_ROUNDS[FINANCING_ROUNDS.length - 1]; // Pre-IPO
    }
  }

  const nextRound = FINANCING_ROUNDS[FINANCING_ROUNDS.indexOf(recommendedRound) + 1] ?? null;

  const blockers: { dim: string; val: string; req: number; label: string }[] = [];
  const rc = recommendedRound.conditions;
  if (iro_score < rc.minIRO) blockers.push({ dim: 'IRO', val: iro_score.toFixed(0), req: rc.minIRO, label: 'Score IRO insuffisant' });
  if (input.di < rc.minDI)   blockers.push({ dim: 'DI',  val: input.di.toString(),  req: rc.minDI,  label: 'Infra LLM trop dépendante' });
  if (input.gch < rc.minGCH) blockers.push({ dim: 'GCH', val: input.gch.toString(), req: rc.minGCH, label: 'Capital humain insuffisant' });

  const maturityScore = Math.round(
    (Math.min(age_mois / 60, 1) * 25) + (Math.min(iro_score / 100, 1) * 35) +
    (Math.min(input.adc / 4, 1) * 20) + (Math.min(input.gch / 4, 1) * 20)
  );

  return {
    entityCategory,
    entityInfo,
    isEstablished: false as const,
    transformation: null,
    phase: bestPhase,
    substade: bestSubstade,
    type: typeObj,
    recommendedRound,
    nextRound,
    blockers,
    maturityScore,
    currentRoundIndex: FINANCING_ROUNDS.indexOf(recommendedRound),
    eligibleRoundsCount: eligibleRounds.length,
  };
}

// ── Micro-components ──────────────────────────────────────────────────────────

function Bar({ label, val, max, color, unit }: { label: string; val: number; max: number; color: string; unit: string }) {
  const pct = Math.min(100, (val / Math.max(max, 1)) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-slate-500 w-32 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
          className="h-full rounded-full" style={{ background: color }} />
      </div>
      <span className="text-[10px] font-mono font-bold w-12 text-right" style={{ color }}>
        {typeof val === 'number' ? val.toFixed(val < 10 ? 1 : 0) : val}{unit}
      </span>
    </div>
  );
}

function PhaseNode({ phase, active, past }: { phase: Phase; active: boolean; past: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
      <motion.div animate={{ scale: active ? 1 : 0.85 }} className="relative">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm border-2 transition-all"
          style={{
            background: active ? phase.color + '22' : past ? 'rgba(255,255,255,0.04)' : 'transparent',
            borderColor: active ? phase.color : past ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.07)',
            boxShadow: active ? `0 0 14px ${phase.color}40` : 'none',
          }}>
          {past ? <span className="text-slate-400 text-[10px]">✓</span> : phase.icon}
        </div>
        {active && (
          <motion.div animate={{ scale: [1, 1.35, 1] }} transition={{ repeat: Infinity, duration: 2 }}
            className="absolute inset-0 rounded-full border" style={{ borderColor: phase.color + '35' }} />
        )}
      </motion.div>
      <span className="text-[9px] font-black uppercase tracking-widest text-center leading-tight"
        style={{ color: active ? phase.color : past ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)' }}>
        {phase.label}
      </span>
    </div>
  );
}

function RoundChip({ round, current, next, vertical }: { round: FinancingRound; current: boolean; next: boolean; vertical: string }) {
  const multiple = round.valuation_multiple[vertical] ?? '—';
  return (
    <div className="relative flex-1 min-w-0 rounded-lg p-2.5 border transition-all text-center"
      style={{
        background: current ? round.color + '15' : next ? round.color + '07' : 'transparent',
        borderColor: current ? round.color + '50' : next ? round.color + '20' : 'rgba(255,255,255,0.05)',
        boxShadow: current ? `0 0 18px ${round.color}18` : 'none',
      }}>
      {current && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-widest"
          style={{ background: round.color, color: '#06080e' }}>Cible</div>
      )}
      <div className="text-base mb-0.5">{round.icon}</div>
      <div className="text-[8px] font-black uppercase tracking-wider" style={{ color: round.color }}>{round.label}</div>
      <div className="text-[7px] text-slate-600 mt-0.5">{round.fourchette}</div>
      {current && <div className="text-[8px] font-mono mt-1" style={{ color: round.color + 'bb' }}>{multiple}</div>}
    </div>
  );
}

// ── Panel Entité Établie ───────────────────────────────────────────────────────

function EstablishedPanel({ input, entityInfo, transformation }: {
  input: StartupPhaseInput;
  entityInfo: typeof ENTITY_LABELS[EntityCategory];
  transformation: TransformationAnalysis;
}) {
  const [showAlt, setShowAlt] = useState(false);
  const [expandActions, setExpandActions] = useState(true);
  const rec = transformation.financement_recommande;
  const alt = transformation.financement_alternatif;

  return (
    <div className="space-y-3">

      {/* Bandeau entité */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border"
        style={{ background: entityInfo.color + '10', borderColor: entityInfo.color + '30' }}>
        <span className="text-2xl">{entityInfo.emoji}</span>
        <div className="flex-1">
          <div className="text-xs font-black uppercase tracking-widest" style={{ color: entityInfo.color }}>
            {entityInfo.label}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">{entityInfo.desc}</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-slate-600 uppercase tracking-widest">Âge</div>
          <div className="font-mono font-black text-slate-400 text-sm">
            {input.age_mois >= 120
              ? `${Math.round(input.age_mois / 12)} ans`
              : `${input.age_mois}m`}
          </div>
        </div>
      </div>

      {/* Avertissement contextuel */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-slate-900 border border-amber-500/20">
        <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Cette entité est analysée en mode <strong className="text-amber-400">Transformation IA</strong>, non en mode Startup.
          Les mécanismes de financement VC (Seed, Série A…) ne s'appliquent pas.
          L'analyse porte sur la stratégie d'investissement IA et les instruments adaptés à son stade.
        </p>
      </div>

      {/* Urgence transformation */}
      <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">
            Urgence Transformation IA
          </div>
          <div className="px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-widest"
            style={{ background: transformation.urgenceColor + '20', color: transformation.urgenceColor }}>
            {transformation.urgence}
          </div>
        </div>
        <div className="space-y-2">
          <Bar label="Score IRO" val={input.iro_score} max={100} color={input.iro_score >= 62 ? '#00c896' : input.iro_score >= 45 ? '#fbbf24' : '#ef4444'} unit="/100" />
          <Bar label="Risque SRD" val={input.srd_score} max={100} color={input.srd_score >= 60 ? '#ef4444' : input.srd_score >= 40 ? '#fbbf24' : '#00c896'} unit="/100" />
          <Bar label="Autonomie DI" val={input.di} max={4} color={input.di >= 3 ? '#00c896' : input.di >= 2 ? '#fbbf24' : '#ef4444'} unit="/4" />
          <Bar label="Actif Données" val={input.adc} max={4} color={input.adc >= 3 ? '#00c896' : '#fbbf24'} unit="/4" />
        </div>
        <div className="mt-3 text-[9px] text-slate-600 italic">
          DI actuel : {transformation.di_gap}
        </div>
      </div>

      {/* Mécanisme de financement recommandé */}
      <div className="bg-slate-900 rounded-xl border overflow-hidden"
        style={{ borderColor: rec.color + '30' }}>
        <div className="p-4 border-b border-slate-800">
          <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-2">
            Mécanisme recommandé
          </div>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">{rec.icon}</span>
            <div>
              <div className="font-black text-base leading-tight" style={{ color: rec.color }}>{rec.label}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{rec.montants}</div>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed mb-3">{rec.description}</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {rec.instruments.map((inst, i) => (
              <span key={i} className="px-2 py-0.5 rounded text-[9px] font-bold"
                style={{ background: rec.color + '12', color: rec.color }}>{inst}</span>
            ))}
          </div>
        </div>
        <div className="p-4">
          <div className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-1.5">Conditions favorables</div>
          <div className="space-y-1">
            {rec.conditions_favorables.map((c, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px] text-slate-400">
                <CheckCircle2 size={9} className="flex-shrink-0 mt-0.5" style={{ color: rec.color }} />
                {c}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mécanisme alternatif */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <button onClick={() => setShowAlt(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
          <div className="flex items-center gap-2">
            <span>{alt.icon}</span>
            <span className="text-[10px] text-slate-400 font-bold">Mécanisme alternatif — {alt.label}</span>
          </div>
          {showAlt ? <ChevronUp size={11} className="text-slate-600" /> : <ChevronDown size={11} className="text-slate-600" />}
        </button>
        <AnimatePresence>
          {showAlt && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-slate-800">
              <div className="p-4">
                <p className="text-[10px] text-slate-400 leading-relaxed mb-2">{alt.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {alt.instruments.map((inst, i) => (
                    <span key={i} className="px-2 py-0.5 rounded text-[9px] font-bold"
                      style={{ background: alt.color + '12', color: alt.color }}>{inst}</span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Actions prioritaires */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <button onClick={() => setExpandActions(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
          <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold flex items-center gap-2">
            <Zap size={10} className="text-amber-400" />
            Actions prioritaires ({transformation.actions_prioritaires.length})
          </span>
          {expandActions ? <ChevronUp size={11} className="text-slate-600" /> : <ChevronDown size={11} className="text-slate-600" />}
        </button>
        <AnimatePresence>
          {expandActions && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-slate-800">
              <div className="p-4 space-y-2">
                {transformation.actions_prioritaires.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px] text-slate-300 bg-slate-800/40 p-2 rounded-lg">
                    <span className="text-amber-400 font-black flex-shrink-0">{i + 1}.</span>
                    {a}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Note méthodologique */}
      <p className="text-[9px] text-slate-700 leading-relaxed px-1">
        Analyse IRO v7.0 · Mode Entité Établie · {input.age_mois >= 120 ? `${Math.round(input.age_mois / 12)} ans d'existence` : `${input.age_mois}m`}
        · Stade déclaré : {input.stade_financement}
      </p>
    </div>
  );
}

// ── Panel Startup ─────────────────────────────────────────────────────────────

function StartupPanel({ input, phase, substade, type, recommendedRound, nextRound, blockers, maturityScore, currentRoundIndex }: {
  input: StartupPhaseInput;
  phase: Phase;
  substade: Substade;
  type: { id: string; label: string; emoji: string; color: string };
  recommendedRound: FinancingRound;
  nextRound: FinancingRound | null;
  blockers: { dim: string; val: string; req: number; label: string }[];
  maturityScore: number;
  currentRoundIndex: number;
}) {
  const [showInvestors, setShowInvestors] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const isReady = blockers.length === 0;
  const rc = recommendedRound.conditions;

  return (
    <div className="space-y-3">

      {/* Phase header */}
      <div className="relative rounded-xl border overflow-hidden" style={{ borderColor: phase.color + '30' }}>
        <div className="absolute inset-0 opacity-50" style={{ background: `linear-gradient(135deg, ${phase.color}0e 0%, transparent 60%)` }} />
        <div className="relative p-4">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span style={{ color: phase.color }}>{phase.icon}</span>
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">Phase de développement</span>
              </div>
              <div className="font-black text-xl leading-none" style={{ color: phase.color }}>
                {substade.icon} {substade.label}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 max-w-xs leading-relaxed">{substade.description}</div>
            </div>
            <div className="flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-lg border"
              style={{ borderColor: type.color + '40', background: type.color + '10' }}>
              <span className="text-xl">{type.emoji}</span>
              <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: type.color }}>{type.label}</span>
            </div>
          </div>
          {/* Timeline phases */}
          <div className="relative flex items-center">
            <div className="absolute top-4.5 left-0 right-0 h-px bg-slate-800 z-0" />
            {PHASES.map(p => (
              <PhaseNode key={p.id} phase={p} active={p.id === phase.id}
                past={PHASES.indexOf(p) < PHASES.indexOf(phase)} />
            ))}
          </div>
        </div>
      </div>

      {/* Financement */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden font-mono">
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1.5 font-mono">
                Financement recommandé · Cohorte FR n=130
              </div>
              <div className="flex items-center gap-2.5 font-sans">
                <span className="text-xl">{recommendedRound.icon}</span>
                <div>
                  <div className="font-black text-lg leading-none" style={{ color: recommendedRound.color }}>
                    {recommendedRound.label}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">{recommendedRound.fourchette}</div>
                </div>
              </div>
            </div>
            {/* Gauge maturité */}
            <div className="text-center">
              <div className="relative w-12 h-12">
                <svg viewBox="0 0 48 48" className="w-12 h-12 -rotate-90">
                  <circle cx="24" cy="24" r="19" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
                  <motion.circle cx="24" cy="24" r="19" fill="none"
                    stroke={isReady ? '#00c896' : recommendedRound.color} strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 19}`}
                    initial={{ strokeDashoffset: 2 * Math.PI * 19 }}
                    animate={{ strokeDashoffset: 2 * Math.PI * 19 * (1 - maturityScore / 100) }}
                    transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-black font-mono" style={{ color: isReady ? '#00c896' : recommendedRound.color }}>{maturityScore}</span>
                </div>
              </div>
              <div className="text-[7px] text-slate-600 mt-0.5">Maturité</div>
            </div>
          </div>

          {/* Éligibilité */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border"
            style={{ background: isReady ? 'rgba(0,200,150,0.05)' : 'rgba(239,68,68,0.04)', borderColor: isReady ? 'rgba(0,200,150,0.2)' : 'rgba(239,68,68,0.18)' }}>
            {isReady ? <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" /> : <XCircle size={12} className="text-red-400 flex-shrink-0" />}
            <span className="text-[10px]" style={{ color: isReady ? '#00c896' : '#ef4444' }}>
              {isReady ? `Profil éligible — conditions remplies pour une ${recommendedRound.label}` : `${blockers.length} condition${blockers.length > 1 ? 's' : ''} non remplie${blockers.length > 1 ? 's' : ''}`}
            </span>
          </div>
        </div>

        {/* Barres conditions */}
        <div className="p-4 space-y-2 border-b border-slate-800">
          <div className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-1.5">Conditions IRO pour ce tour</div>
          {[
            { label: 'Score IRO global', val: input.iro_score, req: rc.minIRO, unit: '/100' },
            { label: 'Infra LLM (DI)',   val: input.di,        req: rc.minDI,  unit: '/4'   },
            { label: 'Capital Humain',   val: input.gch,       req: rc.minGCH, unit: '/4'   },
          ].map(c => {
            const met = c.val >= c.req;
            const pct = Math.min(100, (c.val / Math.max(c.req, 1)) * 100);
            return (
              <div key={c.label} className="flex items-center gap-3">
                <span className="text-[10px] text-slate-500 w-32 flex-shrink-0">{c.label}</span>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8 }} className="h-full rounded-full"
                    style={{ background: met ? '#00c896' : '#ef4444' }} />
                </div>
                <span className="text-[10px] font-mono font-bold w-14 text-right" style={{ color: met ? '#00c896' : '#ef4444' }}>
                  {typeof c.val === 'number' ? (c.val < 10 ? c.val.toFixed(1) : Math.round(c.val)) : c.val}{c.unit}
                  <span className="opacity-40"> / {c.req}</span>
                </span>
              </div>
            );
          })}
        </div>

        {/* Blockers */}
        {blockers.length > 0 && (
          <div className="px-4 py-3 border-b border-slate-800 space-y-1.5">
            <div className="text-[9px] text-red-400 uppercase tracking-widest font-bold">Facteurs bloquants</div>
            {blockers.map(b => (
              <div key={b.dim} className="flex items-center gap-2 text-[10px]">
                <AlertTriangle size={9} className="text-red-400 flex-shrink-0" />
                <span className="text-red-400 font-bold w-8">{b.dim}</span>
                <span className="text-slate-500">{b.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Use of funds */}
        <div className="px-4 py-3 border-b border-slate-800">
          <div className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-2">Use of funds typique</div>
          <div className="flex flex-wrap gap-1.5">
            {recommendedRound.use_of_funds.map((u, i) => (
              <span key={i} className="px-2 py-0.5 rounded text-[9px] font-bold"
                style={{ background: recommendedRound.color + '12', color: recommendedRound.color }}>{u}</span>
            ))}
          </div>
        </div>

        {/* Investisseurs */}
        <button onClick={() => setShowInvestors(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
          <div className="flex items-center gap-2 text-[9px] text-slate-500 uppercase tracking-widest font-bold">
            <Landmark size={9} />
            Investisseurs types ({recommendedRound.investors.length})
          </div>
          {showInvestors ? <ChevronUp size={11} className="text-slate-600" /> : <ChevronDown size={11} className="text-slate-600" />}
        </button>
        <AnimatePresence>
          {showInvestors && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-slate-800">
              <div className="px-4 py-3 flex flex-wrap gap-1.5">
                {recommendedRound.investors.map((inv, i) => (
                  <span key={i} className="px-2 py-0.5 rounded text-[9px] bg-slate-800 text-slate-400 font-bold">{inv}</span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Timeline tours */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 font-mono">
        <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-3">
          Trajectoire financement · Millésime 2026
        </div>
        <div className="flex gap-1">
          {FINANCING_ROUNDS.map((round, i) => (
            <RoundChip key={round.stade} round={round} vertical={input.vertical}
              current={i === currentRoundIndex}
              next={nextRound !== null && i === FINANCING_ROUNDS.indexOf(nextRound)} />
          ))}
        </div>
        {nextRound && (
          <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500 font-sans">
            <ArrowRight size={9} className="flex-shrink-0" style={{ color: nextRound.color }} />
            <span>Prochaine étape : <strong style={{ color: nextRound.color }}>{nextRound.label}</strong> — IRO ≥ {nextRound.conditions.minIRO}, DI ≥ {nextRound.conditions.minDI}, GCH ≥ {nextRound.conditions.minGCH}</span>
          </div>
        )}
      </div>

      {/* Risques & Leviers */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden font-mono">
        <button onClick={() => setShowDetails(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
          <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">
            Risques & Leviers — {substade.label}
          </span>
          {showDetails ? <ChevronUp size={11} className="text-slate-600" /> : <ChevronDown size={11} className="text-slate-600" />}
        </button>
        <AnimatePresence>
          {showDetails && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-slate-800">
              <div className="grid grid-cols-2 gap-0 divide-x divide-slate-800 p-4">
                <div className="pr-4">
                  <div className="text-[9px] text-red-400 uppercase tracking-widest font-bold mb-2">⚠ Risques</div>
                  {substade.risques.map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px] text-slate-400 mb-1.5">
                      <XCircle size={9} className="text-red-400 mt-0.5 flex-shrink-0" />{r}
                    </div>
                  ))}
                </div>
                <div className="pl-4">
                  <div className="text-[9px] text-emerald-400 uppercase tracking-widest font-bold mb-2">✦ Leviers</div>
                  {substade.leviers.map((l, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px] text-slate-400 mb-1.5">
                      <CheckCircle2 size={9} className="text-emerald-400 mt-0.5 flex-shrink-0" />{l}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface StartupPhasePanelProps {
  input: StartupPhaseInput;
}

const StartupPhasePanel: React.FC<StartupPhasePanelProps> = ({ input }) => {
  const analysis = useMemo(() => classifyStartup(input), [input]);

  return (
    <div className="space-y-3">
      {analysis.isEstablished ? (
        <EstablishedPanel
          input={input}
          entityInfo={analysis.entityInfo}
          transformation={analysis.transformation!}
        />
      ) : (
        <StartupPanel
          input={input}
          phase={analysis.phase!}
          substade={analysis.substade!}
          type={analysis.type}
          recommendedRound={analysis.recommendedRound!}
          nextRound={analysis.nextRound}
          blockers={analysis.blockers}
          maturityScore={analysis.maturityScore}
          currentRoundIndex={analysis.currentRoundIndex}
        />
      )}
    </div>
  );
};

export default StartupPhasePanel;
export { classifyStartup, PHASES, SUBSTADES, FINANCING_ROUNDS, CORPORATE_FINANCING };
export type { FinancingRound, CorporateFinancing };
