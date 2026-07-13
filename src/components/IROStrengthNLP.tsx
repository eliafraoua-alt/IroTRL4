/**
 * src/components/IROStrengthNLP.tsx
 * IROSTRENGTH — Multimodalité : Ingestion texte libre + NLP
 *
 * Extension du modèle IRO existant (Cox + RSF) avec une 7ème dimension :
 * extraction automatique des 6 dimensions IRO depuis des textes non structurés
 * (comptes-rendus médicaux pour startups healthtech, rapports d'investisseurs,
 * notes de diligence, pitchs, extraits de presse…)
 *
 * Pipeline NLP → IRO :
 *   1. Moteur Gemini analyse le texte libre
 *   2. Extrait et score les 6 dimensions IRO (0-5)
 *   3. Identifie les signaux Goodhart et biais cognitifs
 *   4. Pré-remplit le simulateur IRO avec les valeurs extraites
 *   5. Le modèle Cox+RSF calcule la probabilité de survie
 */

import { useState, useCallback } from "react";
import { callLLMAndParseJSON } from "../utils/llm-router";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface IRODimensions {
  di:  number;  // Différenciation Innovation (0-5)
  adc: number;  // Avantage Différentiel Client (0-5)
  ipc: number;  // Indicateur Performance Commerciale (0-5)
  ar:  number;  // Adaptabilité Réglementaire (0-5)
  ca:  number;  // Cohérence Architecture (0-5)
  gch: number;  // Gouvernance Capital Humain (0-5)
}

interface MaturitySignals {
  arrEur: number;          // ARR/MRR en € (0 si inconnu)
  fundingStage: string;    // "pre-seed"|"seed"|"series-a"|"series-b"|"series-c+"|"profitable"|"unknown"
  teamSize: number;        // Nombre d'employés (0 si inconnu)
  yearsActive: number;     // Années d'existence (0 si inconnu)
  payingCustomers: number; // Clients payants (0 si inconnu)
  hasRevenue: boolean;     // Revenus réels déclarés
  nrr: number;             // Net Revenue Retention % (0 si inconnu)
}

interface NLPExtraction {
  dimensions: IRODimensions;
  confidence: Record<keyof IRODimensions, number>;  // 0-1 par dimension
  signals: string[];        // Signaux positifs détectés
  warnings: string[];       // Signaux négatifs / Goodhart
  context: string;          // Résumé du contexte détecté
  sector: string;           // Secteur détecté
  stage: string;            // Stade de développement détecté
  extractedFrom: number;    // % du texte utilisé
  arr?: number;             // Extracted ARR (number)
  fundingStage?: string;    // Extracted funding stage (string)
  teamSize?: number;        // Extracted team size (number)
  yearsActive?: number;     // Extracted years active (number)
  churn?: number | null;    // Extracted churn % (number)
  payingCustomers?: number; // Clients payants (number)
  nrr?: number;             // Net Revenue Retention % (number)
}

interface SurvivalResult {
  iro: number;
  cox12: number; cox24: number; cox36: number;
  rsf12: number; rsf24: number; rsf36: number;
  ens12: number; ens24: number; ens36: number;
  goodhart: boolean; verdict: string; vclass: string;
  weakest: Array<{n: string; v: number}>;
  maturityFactor: number;
  maturityLabel: string;
  maturityDetails: string[];
}

interface MaturityBreakdown {
  arr: number;
  stage: number;
  team: number;
  age: number;
  churn: number;
}

interface MaturityResult {
  score: number;
  breakup: MaturityBreakdown;
  inputs: {
    arr: number;
    fundingStage: string;
    teamSize: number;
    yearsActive: number;
    churn: number | null | undefined;
    payingCustomers?: number;
    nrr?: number;
  };
}

// ─── FACTEUR DE MATURITÉ (Ajustement Modèle Cox) ────────────────────────────
function computeMaturityFactor(m: MaturitySignals): {
  factor: number; label: string; details: string[];
} {
  let factor = 1.0;
  const details: string[] = [];

  // ARR — signal le plus fort
  if (m.arrEur >= 10000000) {
    factor = Math.min(factor, 0.30);
    details.push(`ARR ${(m.arrEur / 1000000).toFixed(1)}M€ → scale-up avérée (-70% hazard)`);
  } else if (m.arrEur >= 1000000) {
    factor = Math.min(factor, 0.55);
    details.push(`ARR ${(m.arrEur / 1000000).toFixed(1)}M€ → traction solide (-45% hazard)`);
  } else if (m.arrEur >= 100000) {
    factor = Math.min(factor, 0.80);
    details.push(`ARR ${(m.arrEur / 1000).toFixed(0)}K€ → premiers revenus (-20% hazard)`);
  } else if (m.hasRevenue) {
    factor = Math.min(factor, 0.90);
    details.push("Revenus déclarés (montant inconnu) → léger correctif (-10% hazard)");
  }

  // Stade de financement
  const stageFactors: Record<string, number> = {
    "profitable":  0.25,
    "series-c+":   0.32,
    "series-b":    0.45,
    "series-a":    0.65,
    "seed":        0.85,
    "pre-seed":    1.05,
    "unknown":     1.00,
  };
  const stageFactor = stageFactors[m.fundingStage] ?? 1.0;
  if (stageFactor < 1.0) {
    factor = Math.min(factor, stageFactor);
    const stageLabels: Record<string, string> = {
      "profitable":"rentabilité atteinte", "series-c+":"Series C+",
      "series-b":"Series B", "series-a":"Series A", "seed":"Seed",
    };
    details.push(`Stade ${stageLabels[m.fundingStage] ?? m.fundingStage} → correctif maturité (-${Math.round((1 - stageFactor)*100)}% hazard)`);
  } else if (stageFactor > 1.0) {
    factor = Math.max(factor, stageFactor);
    details.push("Stade très précoce (Pre-seed) → modèle calibré correctement, pas de correction");
  }

  // Clients payants
  if (m.payingCustomers >= 10000) {
    factor *= 0.85;
    details.push(`${m.payingCustomers.toLocaleString()} clients payants → adoption massive (-15% hazard)`);
  } else if (m.payingCustomers >= 100) {
    factor *= 0.92;
    details.push(`${m.payingCustomers} clients payants → traction validée (-8% hazard)`);
  } else if (m.payingCustomers >= 10) {
    factor *= 0.97;
    details.push(`${m.payingCustomers} clients payants → début de traction (-3% hazard)`);
  }

  // NRR — signal de santé SaaS
  if (m.nrr >= 130) {
    factor *= 0.80;
    details.push(`NRR ${m.nrr}% → croissance organique exceptionnelle (-20% hazard)`);
  } else if (m.nrr >= 110) {
    factor *= 0.90;
    details.push(`NRR ${m.nrr}% → expansion client forte (-10% hazard)`);
  } else if (m.nrr > 0 && m.nrr < 80) {
    factor *= 1.10;
    details.push(`NRR ${m.nrr}% → attrition significative ⚠ (+10% hazard)`);
  }

  // Taille équipe
  if (m.teamSize >= 200) {
    factor *= 0.90;
    details.push(`${m.teamSize} employés → organisation structurée (-10% hazard)`);
  } else if (m.teamSize >= 50) {
    factor *= 0.95;
    details.push(`${m.teamSize} employés → équipe en croissance (-5% hazard)`);
  } else if (m.teamSize > 0 && m.teamSize <= 3) {
    factor *= 1.05;
    details.push(`${m.teamSize} employés — équipe très réduite (+5% hazard)`);
  }

  // Ancienneté
  if (m.yearsActive >= 7) {
    factor *= 0.80;
    details.push(`${m.yearsActive} ans d'existence → survie long terme prouvée (-20% hazard)`);
  } else if (m.yearsActive >= 4) {
    factor *= 0.90;
    details.push(`${m.yearsActive} ans d'existence → entreprise établie (-10% hazard)`);
  }

  factor = Math.max(0.20, Math.min(1.20, factor));

  let label = "Early-stage (pas de correction)";
  if (factor <= 0.30) label = "Scale-up mature (correction maximale)";
  else if (factor <= 0.50) label = "Croissance avancée (forte correction)";
  else if (factor <= 0.70) label = "Traction validée (correction modérée)";
  else if (factor <= 0.90) label = "Premiers revenus (légère correction)";
  else if (factor >= 1.10) label = "Stade très précoce (pénalisation légère)";

  if (details.length === 0) details.push("Aucun signal de maturité détecté — modèle non corrigé");

  return { factor, label, details };
}

// ─── CODAGE DU MODÈLE DE MATURITÉ ───────────────────────────────────────────
// Calcul de f(arr, fundingStage, teamSize, yearsActive, churn) de 0 à 100 points
export function computeMaturityScore(
  arr: number, 
  stage: string, 
  teamSize: number, 
  yearsActive: number, 
  churn: number | null | undefined,
  payingCustomers?: number,
  nrr?: number
): MaturityResult {
  // ARR points (0-20): logarithmic scale up to 10M ARR
  let arrPoints = 0;
  if (arr && arr > 0) {
    arrPoints = Math.min(20, Math.max(2, Math.log10(arr / 5000 + 1) * 6.0));
  }

  // Funding Stage points (0-20)
  let stagePoints = 5;
  const s = (stage || '').toLowerCase();
  if (s.includes('series b') || s.includes('série b') || s.includes('series c') || s.includes('growth') || s.includes('série c')) {
    stagePoints = 20;
  } else if (s.includes('series a') || s.includes('série a')) {
    stagePoints = 15;
  } else if (s.includes('seed')) {
    stagePoints = 10;
  } else if (s.includes('pre-seed') || s.includes('angel') || s.includes('pre seed') || s.includes('love money') || s.includes('bootstrap')) {
    stagePoints = 5;
  } else {
    stagePoints = 4;
  }

  // Team Size points (0-20)
  let teamPoints = 0;
  if (teamSize && teamSize > 0) {
    if (teamSize > 100) teamPoints = 20;
    else if (teamSize > 50) teamPoints = 17;
    else if (teamSize > 20) teamPoints = 14;
    else if (teamSize > 10) teamPoints = 10;
    else if (teamSize > 5) teamPoints = 7;
    else teamPoints = 4;
  } else {
    teamPoints = 2; // Default starting team size
  }

  // Years Active points (0-20)
  let agePoints = 0;
  if (yearsActive && yearsActive > 0) {
    agePoints = Math.min(20, Math.max(2, yearsActive * 3.5)); // Full points at ~6 years
  } else {
    agePoints = 2;
  }

  // Churn points (0-20): Lower churn is better. If churn is not available/not set, baseline 12.
  let churnPoints = 12;
  if (churn !== undefined && churn !== null && churn >= 0) {
    if (churn < 3) churnPoints = 20;
    else if (churn < 7) churnPoints = 17;
    else if (churn < 12) churnPoints = 13;
    else if (churn < 20) churnPoints = 8;
    else if (churn < 35) churnPoints = 3;
    else churnPoints = 0;
  }

  const total = Math.round(arrPoints + stagePoints + teamPoints + agePoints + churnPoints);
  return {
    score: Math.min(100, Math.max(0, total)),
    breakup: {
      arr: Math.round(arrPoints),
      stage: Math.round(stagePoints),
      team: Math.round(teamPoints),
      age: Math.round(agePoints),
      churn: Math.round(churnPoints),
    },
    inputs: {
      arr,
      fundingStage: stage,
      teamSize,
      yearsActive,
      churn,
      payingCustomers,
      nrr
    }
  };
}

// ─── APPEL GEMINI (NLP extraction) ───────────────────────────────────────────

async function extractIROFromText(text: string): Promise<NLPExtraction> {
  const prompt = `TEXTE À ANALYSER :\n\n${text.slice(0, 12000)}`;
  const systemPrompt = `Tu es expert en analyse de startups et en scoring IRO (Indice de Robustesse Organisationnelle).
Tu dois extraire et scorer les 6 dimensions IRO depuis un texte non structuré. De plus, tu dois extraire les métriques de maturité clés listées ci-dessous.

DIMENSIONS (0-5) :
• di  (Différenciation Innovation) : niveau d'innovation technologique/produit. Cherche : brevets, R&D, technologie propriétaire, barrières à l'entrée.
• adc (Avantage Différentiel Client) : force de la proposition de valeur client. Cherche : NPS, rétention, cas clients, testimonials, churn.
• ipc (Indicateur Performance Commerciale) : traction commerciale réelle. Cherche : ARR, MRR, croissance, clients payant, pipeline.
• ar  (Adaptabilité Réglementaire) : capacité à naviguer la réglementation. Cherche : certifications, marquages CE, FDA, conformité RGPD, dossiers.
• ca  (Cohérence Architecture) : solidité technique et organisationnelle. Cherche : dette technique, architecture scalable, CTO, roadmap.
• gch (Gouvernance Capital Humain) : qualité de l'équipe dirigeante. Cherche : expérience fondateurs, conseil d'administration, board, advisors, talent.

TRACTION & MATURITÉ À EXTRAIRE :
• arr : Annual Recurring Revenue cumulé par an en EUR ou USD (nombre brut, ex: 1500000). Si absent ou non applicable, mets 0.
• fundingStage : Pre-seed, Seed, Series A, Series B, bootstrap, etc. (valeur textuelle courte).
• teamSize : Taille actuelle de l'équipe / effectif (nombre). Si absent, mets 0.
• yearsActive : Nombre d'années complètes d'activité depuis la création (nombre). Si absent, mets 0.
• churn : Churn annuel en pourcentage (ex: 5.2). Si non applicable ou absent, mets null.
• payingCustomers : Nombre net de clients directs payants ou d'utilisateurs facturés (nombre). Si absent, mets 0.
• nrr : Net Revenue Retention ou Taux de rétention nette en % (nombre brut, ex : 115). Si absent ou non applicable, mets 0.

ATTENTION AUX BIAIS :
• Goodhart : si toutes les métriques sont parfaites, signale le risque de manipulation ou sur-évaluation.
• Sélection positive : le texte est souvent un pitch de vente — ajuste à la baisse raisonnablement si des preuves factuelles manquent.
• Absence d'information = 2.5 (neutre), pas 0 ni 5.

Retourne UNIQUEMENT un JSON respectant exactement la structure suivante :
{
  "dimensions": {
    "di": 2.5,
    "adc": 2.5,
    "ipc": 2.5,
    "ar": 2.5,
    "ca": 2.5,
    "gch": 2.5
  },
  "confidence": {
    "di": 0.5,
    "adc": 0.5,
    "ipc": 0.5,
    "ar": 0.5,
    "ca": 0.5,
    "gch": 0.5
  },
  "arr": 1500000,
  "fundingStage": "Series A",
  "teamSize": 34,
  "yearsActive": 3,
  "churn": 4.2,
  "payingCustomers": 120,
  "nrr": 115,
  "signals": ["Signal positif A", "Signal positif B"],
  "warnings": ["Attention à l'élément X", "Alerte Y"],
  "context": "Résumé du contexte en 2 phrases.",
  "sector": "healthtech",
  "stage": "Series A",
  "extractedFrom": 100
}`;

  const result = await callLLMAndParseJSON<NLPExtraction>(prompt, systemPrompt, {
    modelId: "gemini-3-flash-preview",
  });

  const parsed = result.data;
  const dims = parsed.dimensions ?? {};
  for (const k of ["di", "adc", "ipc", "ar", "ca", "gch"] as const) {
    dims[k] = Math.max(0, Math.min(5, Math.round((dims[k] ?? 2.5) * 10) / 10));
  }
  return { ...parsed, dimensions: dims };
}

// ─── MODÈLE COX + RSF ─────────────────────────────────────────────────────────

function computeSurvival(dims: IRODimensions, sector: string, age = 18, raised = 0, maturity?: MaturitySignals): SurvivalResult {
  const weights = { di:0.22, adc:0.20, ipc:0.25, ar:0.12, ca:0.11, gch:0.10 };
  const iroRaw = dims.di*weights.di + dims.adc*weights.adc + dims.ipc*weights.ipc
               + dims.ar*weights.ar + dims.ca*weights.ca + dims.gch*weights.gch;
  const iro = iroRaw * 20;

  const allHigh  = Object.values(dims).every(v => v >= 3);
  const veryHigh = Object.values(dims).every(v => v >= 4);
  const goodhart = veryHigh || (allHigh && Object.values(dims).filter(v=>v>=4.5).length >= 3);

  // Cox
  const BETAS = { iro_cr:-0.048, di_zero:0.410, adc_strong:-0.190, ipc_strong:-0.160, regulated:-0.120 };
  const H0 = 0.011; const REF_IRO = 50;
  const sectorCoef: Record<string,number> = { ia:0.85, saas:0.90, fintech:0.88, healthtech:0.82, deeptech:0.78, estech:0.92 };
  const raisedBonus = raised > 0 ? Math.log(raised/100000+1)*0.08 : 0;
  const ageEffect = age<6?0.7:age<18?0.85:age<36?1.0:0.92;
  const regulated = ["healthtech","fintech"].includes(sector);
  const lp = BETAS.iro_cr*(iro-REF_IRO) + BETAS.di_zero*(dims.di===0?1:0)
            + BETAS.adc_strong*(dims.adc>=3?1:0) + BETAS.ipc_strong*(dims.ipc>=3?1:0)
            + BETAS.regulated*(regulated?1:0);

  // Facteur de maturité : corrige le biais du modèle calibré sur early-stage
  const { factor: matFactor, label: matLabel, details: matDetails } =
    maturity ? computeMaturityFactor(maturity) : { factor: 1.0, label: "Non calculé", details: [] };

  const hr = Math.exp(lp)*ageEffect*(1-raisedBonus*0.3)*(sectorCoef[sector]??0.87)*matFactor;
  const cox = (t: number) => Math.max(0.03, Math.min(0.97, Math.exp(-H0*t*hr)));

  // RSF simplifié
  const iRSF = Math.min(1, Math.max(0, iro/100));
  const rsf = (t: number) => Math.max(0.03, Math.min(0.97,
    0.5 + (iRSF-0.5)*0.6*Math.exp(-t*0.025) +
    (dims.ipc>=3?0.08:0) + (dims.adc>=3?0.06:0) - (dims.di<=1?0.10:0)
  ));

  const W_COX=0.60, W_RSF=0.40;
  const dimArr = [
    {n:"DI",v:dims.di},
    {n:"ADC",v:dims.adc},
    {n:"IPC",v:dims.ipc},
    {n:"AR",v:dims.ar},
    {n:"CA",v:dims.ca},
    {n:"GCH",v:dims.gch}
  ];
  const weakest = [...dimArr].sort((a,b)=>a.v-b.v).slice(0,2);

  let verdict="", vclass="";
  if      (iro>=61.5) { verdict="Profil ACTIF — IRO ≥ médiane startups actives"; vclass="green"; }
  else if (iro>=50)   { verdict="Profil INTERMÉDIAIRE — sous la médiane des actives"; vclass="amber"; }
  else if (iro>=40.2) { verdict="Profil FRAGILE — proche médiane des échecs"; vclass="amber"; }
  else                { verdict="Profil À RISQUE — IRO sous médiane des startups en échec"; vclass="red"; }

  return {
    iro, goodhart, verdict, vclass, weakest,
    cox12:cox(12), cox24:cox(24), cox36:cox(36),
    rsf12:rsf(12), rsf24:rsf(24), rsf36:rsf(36),
    ens12:W_COX*cox(12)+W_RSF*rsf(12),
    ens24:W_COX*cox(24)+W_RSF*rsf(24),
    ens36:W_COX*cox(36)+W_RSF*rsf(36),
    maturityFactor: matFactor,
    maturityLabel: matLabel,
    maturityDetails: matDetails,
  };
}

// ─── COMPOSANT ────────────────────────────────────────────────────────────────

const DIM_INFO = {
  di:  { label:"DI",  name:"Innovation",          color:"#818cf8", desc:"Différenciation technologique et barrières à l'entrée" },
  adc: { label:"ADC", name:"Avantage Client",      color:"#34d399", desc:"Force de la proposition de valeur et rétention client" },
  ipc: { label:"IPC", name:"Perf. Commerciale",   color:"#fbbf24", desc:"Traction réelle : ARR, croissance, clients payants" },
  ar:  { label:"AR",  name:"Adapt. Réglementaire",color:"#60a5fa", desc:"Certifications, conformité, navigation réglementaire" },
  ca:  { label:"CA",  name:"Architecture",         color:"#f87171", desc:"Solidité technique et organisationnelle" },
  gch: { label:"GCH", name:"Capital Humain",       color:"#e879f9", desc:"Qualité et expérience de l'équipe dirigeante" },
};

const VERDICTS_COLORS = { green:"#10b981", amber:"#f59e0b", red:"#ef4444" };

const EXAMPLE_TEXTS = {
  healthtech: `Notre startup MedScan développe une solution IA de détection précoce du cancer du sein par analyse d'images IRM. 
Brevetée PCT dans 42 pays, notre algorithme atteint 94.7% de sensibilité vs 89% pour les radiologues experts (étude clinique n=2,400, CHU de Lyon, publication NEJM Q3 2025).
Marquage CE obtenu en septembre 2024 (classe IIb). Dossier FDA 510k soumis novembre 2024 — retour attendu Q1 2025.
ARR actuel : 2.8M€ (35 cliniques sous contrat). Croissance MoM : +18%. Churn annuel : 4.2%. Clients payants : 35. NRR : 112%.
L'équipe : Dr Marie Dubois (CTO, PhD Computer Vision, ex-Google Brain 7 ans), Jean Martin (CEO, ex-Sanofi VP Digital 12 ans), conseil avec 2 Prix Nobel de médecine.
Levée Series A : 12M€ (Sofinnova, BpiFrance). Pipeline 2025 : 89 cliniques en discussion avancée.`,

  saas: `DataFlow est une plateforme SaaS d'orchestration de données B2B.
Nos clients incluent Total, Schneider Electric et Airbus. Nous traitons 480M de transactions/mois avec 99.97% d'uptime.
Notre technologie propriétaire de data mesh permet une réduction de 67% du coût d'intégration vs les solutions traditionnelles.
ARR : 4.2M€. NRR : 118%. CAC payback : 14 mois. 67 clients enterprise sous contrat. Clients payants : 67.
Équipe de 34 personnes, dont 22 ingénieurs. CTO (ex-Stripe, 9 ans). CEO finaliste 40 Under 40 Forbes.
Certifications : ISO 27001, SOC 2 Type II, RGPD-ready. Aucun incident de sécurité en 3 ans.
Levée Seed : 3.8M€ (Kima Ventures, 360 Capital).`,

  early: `Notre projet EcoRoute optimise les tournées de livraison du dernier kilomètre.
Nous avons 3 clients pilotes (gratuits pour l'instant) qui testent notre MVP depuis 2 mois.
L'équipe est composée du fondateur (ingénieur Centrale, 2 ans d'expérience) et d'un développeur freelance.
On pense pouvoir réduire les émissions CO2 de 30%. Pas encore de données clients réelles. Clients payants : 0. NRR : 0.
Nous cherchons notre premier financement de 500K€.`,
};

// Renormalise un score NLP [0-5] vers le domaine moteur IRO [0-4]
function rescaleNLP(score: number): number {
  return Math.round((Math.min(5, Math.max(0, score)) / 5) * 4 * 10) / 10;
}

export interface IROStrengthNLPProps {
  onScoresExtracted?: (scores: { DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number }) => void;
}

export default function IROStrengthNLP({ onScoresExtracted }: IROStrengthNLPProps = {}) {
  const [inputText, setInputText] = useState("");
  const [extraction, setExtraction] = useState<NLPExtraction|null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [manualDims, setManualDims] = useState<IRODimensions|null>(null);
  const [manualMaturity, setManualMaturity] = useState<{
    arr: number;
    fundingStage: string;
    teamSize: number;
    yearsActive: number;
    churn: number | null;
    payingCustomers?: number;
    nrr?: number;
  } | null>(null);
  const [editMode, setEditMode] = useState(false);

  const analyze = useCallback(async () => {
    if (!inputText.trim()) return;
    setLoading(true);
    setError(null);
    setExtraction(null);
    setManualDims(null);
    setManualMaturity(null);
    setEditMode(false);
    try {
      const nlp = await extractIROFromText(inputText);
      setExtraction(nlp);
    } catch (e: any) {
      setError(e.message ?? "Erreur inconnue lors de l'extraction par Gemini.");
    } finally {
      setLoading(false);
    }
  }, [inputText]);

  const recompute = useCallback((dims: IRODimensions) => {
    if (!extraction) return;
    setManualDims(dims);
  }, [extraction]);

  const currentDims = manualDims ?? extraction?.dimensions ?? null;
  
  const currentARR = manualMaturity ? manualMaturity.arr : (extraction?.arr ?? 0);
  const currentStage = manualMaturity ? manualMaturity.fundingStage : (extraction?.fundingStage ?? extraction?.stage ?? "Seed");
  const currentTeamSize = manualMaturity ? manualMaturity.teamSize : (extraction?.teamSize ?? 0);
  const currentYearsActive = manualMaturity ? manualMaturity.yearsActive : (extraction?.yearsActive ?? 0);
  const currentChurn = manualMaturity ? manualMaturity.churn : (extraction?.churn ?? null);
  const currentPayingCustomers = manualMaturity ? (manualMaturity.payingCustomers ?? 0) : (extraction?.payingCustomers ?? 0);
  const currentNRR = manualMaturity ? (manualMaturity.nrr ?? 0) : (extraction?.nrr ?? 0);

  const recomputeMaturity = useCallback((
    arr: number, 
    stage: string, 
    teamSize: number, 
    yearsActive: number, 
    churn: number | null,
    payingCustomers?: number,
    nrr?: number
  ) => {
    if (!extraction) return;
    setManualMaturity({
      arr,
      fundingStage: stage,
      teamSize,
      yearsActive,
      churn,
      payingCustomers: payingCustomers !== undefined ? payingCustomers : currentPayingCustomers,
      nrr: nrr !== undefined ? nrr : currentNRR
    });
  }, [extraction, currentPayingCustomers, currentNRR]);

  const mapToFundingStageString = (stage: string): string => {
    const s = stage.toLowerCase();
    if (s.includes("b")) return "series-b";
    if (s.includes("c") || s.includes("growth")) return "series-c+";
    if (s.includes("a")) return "series-a";
    if (s.includes("pre") || s.includes("angel") || s.includes("boot")) return "pre-seed";
    if (s.includes("seed")) return "seed";
    if (s.includes("profit") || s.includes("rentab")) return "profitable";
    return "unknown";
  };

  const maturitySignals: MaturitySignals = {
    arrEur: currentARR,
    fundingStage: mapToFundingStageString(currentStage),
    teamSize: currentTeamSize,
    yearsActive: currentYearsActive,
    payingCustomers: currentPayingCustomers,
    hasRevenue: currentARR > 0,
    nrr: currentNRR,
  };

  // Derived calculations dynamically computed in render cycle
  const survival = extraction && currentDims ? computeSurvival(currentDims, extraction.sector, 18, 0, maturitySignals) : null;

  // Callback vers le simulateur principal — scores renormalisés 0-5 → 0-4
  const prevSurvivalRef = (globalThis as any).__nlpPrevDims;
  if (survival && currentDims && onScoresExtracted) {
    const sig = JSON.stringify(currentDims);
    if (sig !== prevSurvivalRef) {
      (globalThis as any).__nlpPrevDims = sig;
      onScoresExtracted({
        DI:  rescaleNLP(currentDims.di),
        ADC: rescaleNLP(currentDims.adc),
        IPC: rescaleNLP(currentDims.ipc),
        AR:  rescaleNLP(currentDims.ar),
        CA:  rescaleNLP(currentDims.ca),
        GCH: rescaleNLP(currentDims.gch),
      });
    }
  }
  const maturity = extraction ? computeMaturityScore(currentARR, currentStage, currentTeamSize, currentYearsActive, currentChurn, currentPayingCustomers, currentNRR) : null;

  const confColor = (c: number) => c >= 0.7 ? "#10b981" : c >= 0.4 ? "#f59e0b" : "#ef4444";

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-800" style={{ background:"#06090f", fontFamily:"'JetBrains Mono','IBM Plex Mono',monospace", color:"#e2e8f0" }}>

      {/* Header */}
      <div className="flex items-center justify-between" style={{ borderBottom:"1px solid #1e293b", padding:"1.2rem 2rem", background:"#0b0f19" }}>
        <div>
          <div style={{ fontSize:"0.6rem", letterSpacing:"0.2em", color:"#64748b", marginBottom:"0.2rem" }}>IROSTRENGTH · MODULE MULTIMODAL NLP</div>
          <h1 style={{ margin:0, fontSize:"1.3rem", fontWeight:700, color:"#f1f5f9", letterSpacing:"-0.02em" }}>
            🧬 Extraction IRO & Score de Maturité depuis texte libre
          </h1>
        </div>
        <div style={{ fontSize:"0.6rem", color:"#475569", textAlign:"right" }}>
          <div>Modèle Cox + RSF & Indice de Maturité</div>
          <div>Maturité = f(ARR, Stage, Team, Age, Churn)</div>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"420px 1fr", minHeight:"500px" }}>

        {/* Panneau gauche */}
        <div style={{ borderRight:"1px solid #1e293b", padding:"1.5rem", display:"flex", flexDirection:"column", gap:"1.2rem", background:"#090d16" }}>

          {/* Exemples */}
          <div>
            <div style={{ fontSize:"0.6rem", letterSpacing:"0.15em", color:"#64748b", marginBottom:"0.6rem" }}>EXEMPLES PRÉDÉFINIS</div>
            <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap" }}>
              {(Object.entries(EXAMPLE_TEXTS) as [string,string][]).map(([key]) => (
                <button key={key} onClick={() => setInputText(EXAMPLE_TEXTS[key as keyof typeof EXAMPLE_TEXTS])} style={{
                  background:"#0f172a", border:"1px solid #1e293b", borderRadius:4,
                  padding:"0.35rem 0.6rem", fontSize:"0.62rem", color:"#94a3b8", cursor:"pointer",
                }} className="hover:bg-slate-800 transition-colors">
                  {key === "healthtech" ? "🏥 HealthTech MedScan" : key === "saas" ? "☁️ SaaS DataFlow" : "🌱 Early Stage EcoRoute"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
            <label style={{ fontSize:"0.6rem", letterSpacing:"0.15em", color:"#64748b", display:"block", marginBottom:"0.5rem" }}>
              TEXTE LIBRE (pitch, rapport, CR de due diligence, notes de réunions…)
            </label>
            <textarea
              value={inputText} onChange={e => setInputText(e.target.value)}
              placeholder="Collez ici n'importe quel texte décrivant la startup :&#10;&#10;• Pitch deck (copié)&#10;• Rapport d'investisseur&#10;• Compte-rendu de due diligence&#10;• Article de presse&#10;• Note interne&#10;• Document de synthèse&#10;&#10;Gemini extraira automatiquement les 6 dimensions IRO ainsi que les métriques de maturité."
              style={{ width:"100%", height:"240px", background:"#020408", border:"1px solid #1e293b", borderRadius:6, padding:"0.8rem", color:"#f1f5f9", fontSize:"0.74rem", lineHeight:1.7, resize:"none", outline:"none", fontFamily:"inherit", boxSizing:"border-box" }}
              className="focus:border-indigo-500/80 transition-colors"
            />
            <div style={{ fontSize:"0.58rem", color:"#475569", marginTop:"0.3rem", textAlign:"right" }}>{inputText.length.toLocaleString()} chars</div>
          </div>

          <button onClick={analyze} disabled={!inputText.trim() || loading} style={{
            background: inputText.trim() && !loading ? "linear-gradient(135deg,#1e40af,#4c1d95)" : "#0f172a",
            color: inputText.trim() && !loading ? "#fff" : "#475569",
            border:"none", borderRadius:8, padding:"0.85rem", fontSize:"0.82rem", fontWeight:700,
            cursor:inputText.trim() && !loading?"pointer":"not-allowed", letterSpacing:"0.05em",
          }} className="transition-all active:scale-[0.98]">
            {loading ? "🔬 Extraction par Gemini active…" : "🧬 Extraire IRO + Métriques"}
          </button>

          {error && (
            <div style={{ background:"#450a0a/40", border:"1px solid #ef4444", borderRadius:6, padding:"0.7rem", fontSize:"0.7rem", color:"#fca5a5" }}>
              ⚠ {error}
            </div>
          )}

          {/* Edition manuelle */}
          {extraction && currentDims && (
            <div style={{ borderTop:"1px solid #1e293b", paddingTop:"1rem" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"0.8rem" }}>
                <div style={{ fontSize:"0.6rem", letterSpacing:"0.15em", color:"#64748b" }}>DIMENSIONS IRO EXTRAITES</div>
                <button onClick={() => setEditMode(v=>!v)} style={{ background:"none", border:"1px solid #1e293b", borderRadius:4, padding:"0.2rem 0.5rem", fontSize:"0.6rem", color:"#94a3b8", cursor:"pointer" }}>
                  {editMode ? "✓ Valider" : "✏ Ajuster"}
                </button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:"0.6rem", marginBottom:"1.2rem" }}>
                {(Object.entries(DIM_INFO) as [keyof IRODimensions, typeof DIM_INFO[keyof typeof DIM_INFO]][]).map(([key, info]) => {
                  const val = currentDims[key];
                  const conf = extraction.confidence[key] ?? 0.5;
                  return (
                    <div key={key}>
                      <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.2rem" }}>
                        <span style={{ fontSize:"0.62rem", fontWeight:700, color:info.color, minWidth:36 }}>{info.label}</span>
                        <span style={{ fontSize:"0.6rem", color:"#64748b", flex:1 }}>{info.name}</span>
                        <span style={{ fontSize:"0.6rem", color:confColor(conf) }}>~{Math.round(conf*100)}%</span>
                        <span style={{ fontSize:"0.72rem", fontWeight:700, color:info.color, minWidth:24, textAlign:"right" }}>{val.toFixed(1)}</span>
                      </div>
                      {editMode ? (
                        <input type="range" min={0} max={5} step={0.5} value={val}
                          onChange={e => {
                            const newDims = { ...(manualDims ?? extraction.dimensions), [key]: parseFloat(e.target.value) };
                            recompute(newDims);
                          }}
                          style={{ width:"100%", accentColor:info.color }}
                        />
                      ) : (
                        <div style={{ background:"#0f172a", borderRadius:3, height:5, overflow:"hidden" }}>
                          <div style={{ width: `${(val / 5) * 100}%`, height:"100%", borderRadius:3, background:info.color }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Tweak additionnels pour la formule de maturité */}
              <div style={{ borderTop:"1px solid #1e293b", paddingTop:"1rem" }}>
                <div style={{ fontSize:"0.6rem", letterSpacing:"0.15em", color:"#64748b", marginBottom:"0.8rem" }}>MÉTRIQUES DE MATURITÉ f()</div>
                
                <div style={{ display:"flex", flexDirection:"column", gap:"0.7rem" }}>
                  {/* ARR slider */}
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.6rem", marginBottom:"0.2rem" }}>
                      <span style={{ color:"#94a3b8" }}>ARR (Revenu global)</span>
                      <span style={{ color:"#fbbf24", fontWeight:700 }}>{currentARR.toLocaleString()} €</span>
                    </div>
                    {editMode ? (
                      <input type="range" min={0} max={15000000} step={50000} value={currentARR}
                        onChange={e => recomputeMaturity(parseFloat(e.target.value), currentStage, currentTeamSize, currentYearsActive, currentChurn, currentPayingCustomers, currentNRR)}
                        style={{ width:"100%", accentColor:"#fbbf24" }}
                      />
                    ) : (
                      <div className="text-[10px] text-slate-500 font-sans">Lecture seule (mode ajuster pour changer)</div>
                    )}
                  </div>

                  {/* Stage Selection */}
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.6rem", marginBottom:"0.2rem" }}>
                      <span style={{ color:"#94a3b8" }}>Stade de financement</span>
                      <span style={{ color:"#e879f9", fontWeight:700 }}>{currentStage}</span>
                    </div>
                    {editMode ? (
                      <select value={currentStage} 
                        onChange={e => recomputeMaturity(currentARR, e.target.value, currentTeamSize, currentYearsActive, currentChurn, currentPayingCustomers, currentNRR)}
                        style={{ background:"#020408", border:"1px solid #1e293b", borderRadius:4, padding:"0.2rem", fontSize:"0.65rem", width:"100%", color:"#f1f5f9" }}
                      >
                        <option value="Pre-seed">Pre-seed / Bootstrap</option>
                        <option value="Seed">Seed</option>
                        <option value="Series A">Series A</option>
                        <option value="Series B">Series B</option>
                        <option value="Series C+">Series C+</option>
                        <option value="Profitable">Profitable / Self-sustaining</option>
                      </select>
                    ) : null}
                  </div>

                  {/* Team Size Slider */}
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.6rem", marginBottom:"0.2rem" }}>
                      <span style={{ color:"#94a3b8" }}>Taille d'équipe (Staff)</span>
                      <span style={{ color:"#34d399", fontWeight:700 }}>{currentTeamSize} pers.</span>
                    </div>
                    {editMode ? (
                      <input type="range" min={1} max={250} step={1} value={currentTeamSize}
                        onChange={e => recomputeMaturity(currentARR, currentStage, parseInt(e.target.value), currentYearsActive, currentChurn, currentPayingCustomers, currentNRR)}
                        style={{ width:"100%", accentColor:"#34d399" }}
                      />
                    ) : null}
                  </div>

                  {/* Years Active Slider */}
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.6rem", marginBottom:"0.2rem" }}>
                      <span style={{ color:"#94a3b8" }}>Années d'existence (Age)</span>
                      <span style={{ color:"#60a5fa", fontWeight:700 }}>{currentYearsActive} ans</span>
                    </div>
                    {editMode ? (
                      <input type="range" min={0} max={10} step={0.5} value={currentYearsActive}
                        onChange={e => recomputeMaturity(currentARR, currentStage, currentTeamSize, parseFloat(e.target.value), currentChurn, currentPayingCustomers, currentNRR)}
                        style={{ width:"100%", accentColor:"#60a5fa" }}
                      />
                    ) : null}
                  </div>

                  {/* Churn Slider */}
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.6rem", marginBottom:"0.2rem" }}>
                      <span style={{ color:"#94a3b8" }}>Churn annuel (Attrition)</span>
                      <span style={{ color:"#f87171", fontWeight:700 }}>{currentChurn !== null ? `${currentChurn} %` : "N/A (Par défaut 12%)"}</span>
                    </div>
                    {editMode ? (
                      <div className="flex gap-2 items-center">
                        <input type="range" min={0} max={50} step={1} value={currentChurn ?? 12}
                          onChange={e => recomputeMaturity(currentARR, currentStage, currentTeamSize, currentYearsActive, parseFloat(e.target.value), currentPayingCustomers, currentNRR)}
                          style={{ width:"100%", accentColor:"#f87171" }}
                        />
                        <button onClick={() => recomputeMaturity(currentARR, currentStage, currentTeamSize, currentYearsActive, null, currentPayingCustomers, currentNRR)} style={{ fontSize:"0.55rem", padding:"0.1rem 0.3rem", background:"#1e293b", border:"1px solid #334155", borderRadius:3, color: currentChurn === null ? "#818cf8" : "#94a3b8" }}>
                          Reset N/A
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {/* Paying Customers Slider */}
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.6rem", marginBottom:"0.2rem" }}>
                      <span style={{ color:"#94a3b8" }}>Clients Payants</span>
                      <span style={{ color:"#10b981", fontWeight:700 }}>{currentPayingCustomers > 0 ? currentPayingCustomers.toLocaleString() : "0 / non spécifié"}</span>
                    </div>
                    {editMode ? (
                      <input type="range" min={0} max={12000} step={5} value={currentPayingCustomers}
                        onChange={e => recomputeMaturity(currentARR, currentStage, currentTeamSize, currentYearsActive, currentChurn, parseInt(e.target.value), currentNRR)}
                        style={{ width:"100%", accentColor:"#10b981" }}
                      />
                    ) : null}
                  </div>

                  {/* NRR Slider */}
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.6rem", marginBottom:"0.2rem" }}>
                      <span style={{ color:"#94a3b8" }}>Rétention Nette (NRR)</span>
                      <span style={{ color:"#818cf8", fontWeight:700 }}>{currentNRR > 0 ? `${currentNRR} %` : "0 / non spécifié"}</span>
                    </div>
                    {editMode ? (
                      <input type="range" min={0} max={160} step={5} value={currentNRR}
                        onChange={e => recomputeMaturity(currentARR, currentStage, currentTeamSize, currentYearsActive, currentChurn, currentPayingCustomers, parseInt(e.target.value))}
                        style={{ width:"100%", accentColor:"#818cf8" }}
                      />
                    ) : null}
                  </div>

                </div>
              </div>
            </div>
          )}
        </div>

        {/* Panneau droit */}
        <div style={{ padding:"1.5rem", overflow:"auto", background:"#06090f" }}>

          {!extraction && !loading && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", minHeight:"400px", gap:"1rem", opacity:0.35 }}>
              <div style={{ fontSize:"4rem" }}>🧬</div>
              <div style={{ fontSize:"0.82rem", color:"#94a3b8", textAlign:"center", maxWidth:400, lineHeight:1.8 }}>
                Collez un texte non structuré décrivant une startup.<br/>
                Gemini extrait automatiquement les 6 dimensions IRO & l'Indice de maturité,<br/>
                puis le modèle Cox+RSF calcule la probabilité de survie.
              </div>
              <div style={{ display:"flex", gap:"0.5rem", flexWrap:"wrap", justifyContent:"center" }}>
                {["Pitch deck","Rapport due diligence","Note investisseur","CR médical (healthtech)","Article presse"].map(t => (
                  <span key={t} style={{ fontSize:"0.62rem", padding:"0.2rem 0.5rem", border:"1px solid #1e293b", borderRadius:3, color:"#64748b" }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", minHeight:"400px", gap:"1.5rem" }}>
              <div className="animate-pulse" style={{ fontSize:"2.5rem" }}>🔬</div>
              <div style={{ textAlign:"center" }}>
                <div style={{ color:"#818cf8", fontSize:"0.9rem", marginBottom:"0.4rem" }}>Extraction NLP par Gemini…</div>
                <div style={{ color:"#64748b", fontSize:"0.72rem" }}>Analyse sémantique IA pour calculer la viabilité opérationnelle et la formule de maturité.</div>
              </div>
            </div>
          )}

          {extraction && survival && currentDims && (
            <>
              {/* Header résultats */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"1rem", marginBottom:"1.5rem" }}>
                {[
                  { label:"IRO Score (NLP)", value:`${survival.iro.toFixed(1)}`, sub:"/100", color: survival.iro>=61.5?"#10b981":survival.iro>=50?"#f59e0b":"#ef4444" },
                  { label:"Survie 36m (Ens.)", value:`${Math.round(survival.ens36*100)}%`, sub:"Cox+RSF calibré", color:"#60a5fa" },
                  { label:"Secteur détecté", value:extraction.sector.toUpperCase(), sub:extraction.stage, color:"#e879f9" },
                  { label:"Correctif maturité", value:survival.maturityFactor <= 0.50 ? `×${survival.maturityFactor.toFixed(2)} ✓` : survival.maturityFactor >= 1.10 ? `×${survival.maturityFactor.toFixed(2)} ⚠` : `×${survival.maturityFactor.toFixed(2)}`, sub:survival.maturityLabel.split("(")[0].trim(), color: survival.maturityFactor <= 0.50 ? "#10b981" : survival.maturityFactor >= 1.10 ? "#ef4444" : "#fbbf24" },
                  { label:"Indicateur de confiance", value:`${Math.round(Object.values(extraction.confidence).reduce((a,b)=>a+b,0)/6*100)}%`, sub:`${extraction.extractedFrom}% du texte analysé`, color:"#fbbf24" },
                ].map(card => (
                  <div key={card.label} style={{ background:"#0b0f19", border:"1px solid #1e293b", borderRadius:8, padding:"1.1rem" }}>
                    <div style={{ fontSize:"0.56rem", letterSpacing:"0.12em", color:"#64748b", marginBottom:"0.4rem" }}>{card.label}</div>
                    <div style={{ fontSize:"1.25rem", fontWeight:700, color:card.color, lineHeight:1 }}>{card.value}</div>
                    <div style={{ fontSize:"0.6rem", color:"#475569", marginTop:"0.2rem" }}>{card.sub}</div>
                  </div>
                ))}
              </div>

              {/* SECTION INDICE DE MATURITÉ f(arr, fundingStage, teamSize, yearsActive, churn) */}
              {maturity && (
                <div style={{ background:"#080c14", border:"1px solid #1e2a3c", borderRadius:12, padding:"1.2rem", marginBottom:"1.5rem" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
                    <div>
                      <div style={{ fontSize:"0.55rem", letterSpacing:"0.15em", color:"#818cf8", fontWeight:700 }}>INDICE DE MATURITÉ STRATÉGIQUE</div>
                      <div className="text-xs text-slate-400 font-sans mt-0.5">Calculé via: f(arr, fundingStage, teamSize, yearsActive, churn)</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:"0.6rem" }}>
                      <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{
                        background: maturity.score >= 70 ? "#065f46" : maturity.score >= 45 ? "#92400e" : "#991b1b",
                        color: maturity.score >= 70 ? "#a7f3d0" : maturity.score >= 45 ? "#fef3c7" : "#fee2e2"
                      }}>
                        {maturity.score >= 75 ? "ÉTABLIE / MATURE" : maturity.score >= 50 ? "EN CROISSANCE" : "AMBRILLONNAIRE / EARLY"}
                      </span>
                      <div style={{ fontSize:"1.8rem", fontWeight:800, color:"#818cf8" }}>{maturity.score}<span style={{ fontSize:"0.9rem", color:"#475569" }}>/100</span></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-3">
                    {[
                      { name: "ARR Core", pt: maturity.breakup.arr, max: 20, desc: `${currentARR.toLocaleString()} € ARR`, color: "#fbbf24" },
                      { name: "Funding Stage", pt: maturity.breakup.stage, max: 20, desc: currentStage, color: "#e879f9" },
                      { name: "Sizing Team", pt: maturity.breakup.team, max: 20, desc: `${currentTeamSize} pers.`, color: "#34d399" },
                      { name: "Product Age", pt: maturity.breakup.age, max: 20, desc: `${currentYearsActive} ans d'act.`, color: "#60a5fa" },
                      { name: "Churn/SLA", pt: maturity.breakup.churn, max: 20, desc: currentChurn !== null ? `${currentChurn}% Churn` : "N/A (Par défaut)", color: "#f87171" }
                    ].map(col => (
                      <div key={col.name} style={{ background:"#0e1524", border:"1px solid #1e293b", padding:"0.6rem 0.8rem", borderRadius:6 }}>
                        <div style={{ fontSize:"0.56rem", color:"#64748b", marginBottom:"0.2rem" }}>{col.name}</div>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                          <span style={{ fontSize:"0.82rem", fontWeight:700, color:col.color }}>{col.pt}</span>
                          <span style={{ fontSize:"0.55rem", color:"#475569" }}>/20 pts</span>
                        </div>
                        <div style={{ background:"#020408", borderRadius:2, height:4, overflow:"hidden", marginTop:"0.4rem", marginBottom:"0.4rem" }}>
                          <div style={{ width: `${(col.pt / 20) * 100}%`, height:"100%", background: col.color }} />
                        </div>
                        <div style={{ fontSize:"0.55rem", color:"#94a3b8" }}>{col.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Verdict + Goodhart */}
              <div style={{ display:"flex", gap:"1rem", marginBottom:"1.5rem", flexWrap:"wrap" }}>
                <div style={{ flex:1, background:"#0b0f19", border:`1px solid ${VERDICTS_COLORS[survival.vclass as keyof typeof VERDICTS_COLORS] ?? "#1e293b"}40`, borderLeft:`4px solid ${VERDICTS_COLORS[survival.vclass as keyof typeof VERDICTS_COLORS] ?? "#64748b"}`, borderRadius:8, padding:"1rem 1.2rem" }}>
                  <div style={{ fontSize:"0.6rem", letterSpacing:"0.12em", color:"#64748b", marginBottom:"0.3rem" }}>VERDICT DU MODÈLE DE CRASH DES STOCKS</div>
                  <div style={{ fontSize:"0.82rem", color:"#e2e8f0", fontWeight:700 }}>{survival.verdict}</div>
                </div>
                {survival.goodhart && (
                  <div style={{ background:"#450a0a40", border:"1px solid #ef444440", borderLeft:"4px solid #ef4444", borderRadius:8, padding:"1rem 1.2rem" }}>
                    <div style={{ fontSize:"0.6rem", letterSpacing:"0.12em", color:"#ef4444", marginBottom:"0.3rem" }}>⚠ DÉTECTEUR GOODHART ACCIDENTS</div>
                    <div style={{ fontSize:"0.76rem", color:"#fca5a5" }}>Profil suspect — toutes les dimensions sont extrêmement hautes sans contrepoids.</div>
                  </div>
                )}
              </div>

              {/* Contexte NLP */}
              <div style={{ background:"#0b0f19", border:"1px solid #1e293b", borderRadius:8, padding:"1.2rem", marginBottom:"1.5rem" }}>
                <div style={{ fontSize:"0.6rem", letterSpacing:"0.12em", color:"#64748b", marginBottom:"0.6rem" }}>CONTEXTE ET TRACTION DÉTECTÉS</div>
                <div style={{ fontSize:"0.78rem", color:"#cbd5e1", lineHeight:1.7 }}>{extraction.context}</div>
              </div>

              {/* Courbes de survie */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem", marginBottom:"1.5rem" }}>
                {/* Tableau survie */}
                <div style={{ background:"#0b0f19", border:"1px solid #1e293b", borderRadius:8, padding:"1.2rem" }}>
                  <div style={{ fontSize:"0.6rem", letterSpacing:"0.12em", color:"#64748b", marginBottom:"0.8rem" }}>PROBABILITÉS DE SURVIE</div>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.72rem" }}>
                    <thead>
                      <tr style={{ borderBottom:"1px solid #1e293b" }}>
                        {["","12 mois","24 mois","36 mois"].map(h => (
                          <th key={h} style={{ padding:"0.4rem 0.5rem", textAlign:"right", color:"#64748b", ...(h===""?{textAlign:"left"}:{}) }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {label:"Moteur Cox",       s12:survival.cox12, s24:survival.cox24, s36:survival.cox36, color:"#fbbf24"},
                        {label:"Moteur RSF",       s12:survival.rsf12, s24:survival.rsf24, s36:survival.rsf36, color:"#a78bfa"},
                        {label:"Ensemble (Hybride)",  s12:survival.ens12, s24:survival.ens24, s36:survival.ens36, color:"#f1f5f9"},
                      ].map(row => (
                        <tr key={row.label} style={{ borderBottom:"1px solid #0f172a" }}>
                          <td style={{ padding:"0.5rem 0.5rem", color:row.color, fontWeight:row.label.includes("Ensemble")?700:400 }}>{row.label}</td>
                          {[row.s12,row.s24,row.s36].map((v,i) => (
                            <td key={i} style={{ padding:"0.5rem 0.5rem", textAlign:"right", color:v>=0.65?"#34d399":v>=0.45?"#fbbf24":"#f87171", fontWeight:row.label.includes("Ensemble")?700:400 }}>
                              {Math.round(v*100)}%
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Dimensions faibles */}
                <div style={{ background:"#0b0f19", border:"1px solid #1e293b", borderRadius:8, padding:"1.2rem" }}>
                  <div style={{ fontSize:"0.6rem", letterSpacing:"0.12em", color:"#64748b", marginBottom:"0.8rem" }}>DIMENSIONS LIMITANTES (GOULOTS D'ÉTRANGLEMENT)</div>
                  {survival.weakest.map(w => {
                    const info = DIM_INFO[w.n.toLowerCase() as keyof typeof DIM_INFO];
                    return (
                      <div key={w.n} style={{ marginBottom:"0.8rem" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.3rem" }}>
                          <span style={{ fontSize:"0.72rem", color:info?.color ?? "#94a3b8" }}>{w.n} — {info?.name ?? w.n}</span>
                          <span style={{ fontSize:"0.72rem", fontWeight:700, color:w.v<2?"#f87171":w.v<3?"#fbbf24":"#34d399" }}>{(w.v).toFixed(1)}/5</span>
                        </div>
                        <div style={{ background:"#0a0f1a", borderRadius:3, height:6, overflow:"hidden" }}>
                          <div style={{ width: `${(w.v / 5) * 100}%`, height:"100%", borderRadius:3, background:w.v<2?"#f87171":w.v<3?"#fbbf24":"#34d399" }} />
                        </div>
                        <div style={{ fontSize:"0.6rem", color:"#64748b", marginTop:"0.2rem" }}>{info?.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Correctif de maturité détaillé */}
              {survival.maturityDetails.length > 0 && survival.maturityDetails[0] !== "Aucun signal de maturité détecté — modèle non corrigé" && (
                <div style={{ background:"#0b0f19", border:`1px solid ${survival.maturityFactor <= 0.70 ? "#10b98140" : "#fbbf2440"}`, borderLeft:`4px solid ${survival.maturityFactor <= 0.70 ? "#10b981" : "#fbbf24"}`, borderRadius:8, padding:"1.2rem", marginBottom:"1.5rem" }}>
                  <div style={{ fontSize:"0.6rem", letterSpacing:"0.12em", color:"#64748b", marginBottom:"0.6rem" }}>
                    🎯 CORRECTIF DE MATURITÉ COMPRÉHENSIVE (AJUSTEMENT DU MODÈLE COX) — {survival.maturityLabel.toUpperCase()}
                  </div>
                  <div style={{ fontSize:"0.74rem", color:"#94a3b8", marginBottom:"0.8rem", lineHeight:1.55 }}>
                    Le modèle Cox initialement configuré en tant que baseline est calibré pour un profil early-stage (Seed/Pre-seed). Les signaux factuels identifiés ou ajustés démontrent un niveau de traction ou de maturité supérieure, permettant de réaligner proportionnellement le ratio de risque (Hazard Ratio ×{survival.maturityFactor.toFixed(2)}) :
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
                    {survival.maturityDetails.map((det, idx) => (
                      <div key={idx} style={{ fontSize:"0.72rem", color:"#cbd5e1", padding:"0.2rem 0", display:"flex", alignItems:"center", gap:"0.4rem" }}>
                        <span style={{ color:"#10b981" }}>✓</span> {det}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Signaux et alertes NLP */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
                {extraction.signals.length > 0 && (
                  <div style={{ background:"#0b0f19", border:"1px solid #1e293b", borderRadius:8, padding:"1.2rem" }}>
                    <div style={{ fontSize:"0.6rem", letterSpacing:"0.12em", color:"#34d399", marginBottom:"0.6rem" }}>✓ SIGNAUX FAIBLES ET FORTS POSITIFS SECURE</div>
                    {extraction.signals.map((s, i) => (
                      <div key={i} style={{ fontSize:"0.72rem", color:"#a7f3d0", padding:"0.4rem 0", borderBottom:"1px solid #121c2c" }}>+ {s}</div>
                    ))}
                  </div>
                )}
                {extraction.warnings.length > 0 && (
                  <div style={{ background:"#0b0f19", border:"1px solid #1e293b", borderRadius:8, padding:"1.2rem" }}>
                    <div style={{ fontSize:"0.6rem", letterSpacing:"0.12em", color:"#fbbf24", marginBottom:"0.6rem" }}>⚠ ALERTES STRATÉGIQUES ET LIMITATIONS</div>
                    {extraction.warnings.map((w, i) => (
                      <div key={i} style={{ fontSize:"0.72rem", color:"#fde047", padding:"0.4rem 0", borderBottom:"1px solid #121c2c" }}>⚠ {w}</div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
