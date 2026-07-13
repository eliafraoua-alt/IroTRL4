/**
 * src/components/IROAgentMode.tsx
 * IROSTRENGTH — Agent Mode v1.0
 *
 * Entrée  : nom d'une startup (texte libre)
 * Sortie  : rapport IRO complet avec sources en < 90 secondes
 * Zéro saisie manuelle des 6 dimensions.
 *
 * Pipeline 5 étapes :
 *   1. DISCOVER  — résolution nom → SIREN hint, GitHub org, secteur
 *   2. COLLECT   — Pappers + GitHub (/api/github-search) + Gemini knowledge (parallèle)
 *   3. INFER     — Gemini 3 infère les 6 dimensions IRO + signaux maturité depuis données collectées
 *   4. SCORE     — calcIRO + calcSRD + coxFull (Cox+RSF) + computeMaturityFactor
 *   5. REPORT    — synthèse exécutive + recommandations + red flags auditables
 *
 * Intégration :
 *   - Réutilise callLLMWithRouter (proxy /api/llm — aucune clé client)
 *   - Réutilise fetchPappersComplete + mapPappersToIROContext (proxy /api/pappers)
 *   - Réutilise calcIRO, calcSRD, calcIROcr, calcInteractionBonus depuis iro-engine
 *   - Réutilise coxFull depuis cox-model (ensemble Cox+RSF)
 *   - Réutilise computeMaturityFactor logic (inline pour indépendance)
 *   - Types IROResult-compatibles pour branchement futur avec useIROAnalysis
 */

import { useState, useCallback, useRef } from 'react';
import { callLLMWithRouter } from '../utils/llm-router';
import { GEMINI_PASS_MODELS } from '../utils/multi-llm-consensus';

const AGENT_MODEL = GEMINI_PASS_MODELS[2]; // Gamma — source unique de vérité
import {
  fetchPappersComplete,
  mapPappersToIROContext,
  mapPappersToFinancialData,
  type PappersEntreprise,
} from '../collectors/pappers';
import {
  calcIRO,
  calcSRD,
  calcIROcr,
  calcInteractionBonus,
  applyModelRules,
} from '../utils/iro-engine';
import { coxFull } from '../utils/cox-model';
import type { GitHubData } from '../types/iro';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type AgentStep =
  | 'idle' | 'discovering' | 'collecting'
  | 'inferring' | 'scoring' | 'reporting' | 'done' | 'error';

interface StepLog {
  step:    AgentStep;
  label:   string;
  detail:  string;
  ts:      number;  // Date.now()
  sources?: string[];
}

interface CollectedData {
  // Pappers/INSEE
  siren?:         string;
  denomination?:  string;
  age_mois?:      number;
  effectifs?:     number;
  naf?:           string;
  ville?:         string;
  statut?:        string;
  capital_eur?:   number;
  ar_signal?:     number;   // bonus AR de mapPappersToIROContext
  cessation?:     boolean;
  // GitHub
  github_org?:    string;
  stars?:         number;
  last_commit?:   string;
  tech_stack?:    string[];
  llm_deps?:      string[];
  di_signal?:     string;   // 'none'|'wrapper'|'rag_custom'|'finetuned'|'proprietary'
  commits_year?:  number;
  // Gemini knowledge
  arr_eur?:       number;
  nrr?:           number;
  paying_customers?: number;
  funding_stage?: string;
  has_revenue?:   boolean;
  press_summary?: string;
  // Méta
  sources_used: string[];
  confidence:   'high' | 'medium' | 'low';
}

interface InferredDimensions {
  DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number;
  confidence:     Record<'DI'|'ADC'|'IPC'|'AR'|'CA'|'GCH', number>;
  justifications: Record<'DI'|'ADC'|'IPC'|'AR'|'CA'|'GCH', string>;
  srd_vmm: number;  // [0-4] Volatilité Marché
  srd_ncd: number;  // [0-4] Niveau Concurrence Directe
  srd_dfl: number;  // [0-4] Dépendance Fournisseur LLM
  sector:   string;
  vertical: 'HLTH'|'FINT'|'LEGT'|'INDU'|'SAAS'|'DFLT';
  goodhart: boolean;
  reasoning: string;
}

interface MaturitySignals {
  arrEur:          number;
  fundingStage:    string;
  teamSize:        number;
  yearsActive:     number;
  payingCustomers: number;
  hasRevenue:      boolean;
  nrr:             number;
}

interface MaturityResult {
  factor: number;
  label:  string;
  details: string[];
}

interface SurvivalBundle {
  iro100:         number;
  iro100_final:   number;   // avec bonus interaction
  srd100:         number;
  iroCR:          number;
  cox_s12:        number;
  cox_s24:        number;
  cox_s36:        number;
  ens_s12:        number;   // ensemble Cox+RSF
  ens_s24:        number;
  ens_s36:        number;
  hazard_ratio:   number;
  risk_profile:   'faible'|'modéré'|'élevé'|'critique';
  maturity:       MaturityResult;
  beta_contributions: Record<string, number>;
  rsf_available:  boolean;
}

export interface AgentReport {
  startup_name:      string;
  generated_at:      string;
  duration_ms:       number;
  collected:         CollectedData;
  inferred:          InferredDimensions;
  maturity_signals:  MaturitySignals;
  survival:          SurvivalBundle;
  executive_summary: string;
  recommendations:   string[];
  red_flags:         string[];
  quality_note:      string;
  audit_trail:       StepLog[];
}

// ─── ÉTAPE 1 : DISCOVER ───────────────────────────────────────────────────────

async function stepDiscover(name: string): Promise<{
  cleanName:  string;
  sirenHint?: string;
  githubOrg?: string;
  pressQuery: string;
}> {
  const { response } = await callLLMWithRouter(
    `Pour la startup française ou européenne "${name}", donne en JSON strict :
{
  "clean_name": "nom officiel exact",
  "siren_hint": "SIREN 9 chiffres si connu, sinon null",
  "github_org": "slug organisation GitHub probable, sinon null",
  "press_query": "3-4 mots clés pour recherche presse"
}
JSON uniquement. Sois factuel. Si tu n'es pas certain d'un champ, mets null.`,
    'Tu es un assistant factuel de recherche d\'entreprises. Réponds uniquement en JSON valide sans markdown.',
    { timeoutMs: 12000, modelId: AGENT_MODEL }
  ).catch(() => ({ response: '{}' }));

  try {
    const raw = response.replace(/```json|```/g, '').trim();
    const m = raw.match(/\{[\s\S]*\}/);
    const p = m ? JSON.parse(m[0]) : {};
    return {
      cleanName:  typeof p.clean_name === 'string' && p.clean_name ? p.clean_name : name,
      sirenHint:  typeof p.siren_hint === 'string' && /^\d{9}$/.test(p.siren_hint) ? p.siren_hint : undefined,
      githubOrg:  typeof p.github_org === 'string' && p.github_org ? p.github_org : undefined,
      pressQuery: typeof p.press_query === 'string' && p.press_query ? p.press_query : name,
    };
  } catch {
    return { cleanName: name, pressQuery: name };
  }
}

// ─── ÉTAPE 2 : COLLECT ────────────────────────────────────────────────────────

async function stepCollect(
  name: string,
  discovered: Awaited<ReturnType<typeof stepDiscover>>
): Promise<CollectedData> {
  const sources: string[] = [];
  const result: CollectedData = { sources_used: [], confidence: 'low' };

  const [pappersSettled, githubSettled, pressSettled] = await Promise.allSettled([

    // ── Pappers via fetchPappersComplete (proxy /api/pappers/search) ──────
    fetchPappersComplete(discovered.sirenHint ?? name),

    // ── GitHub via proxy /api/github-search ───────────────────────────────
    fetch(`/api/github-search/${encodeURIComponent(discovered.githubOrg ?? name)}`)
      .then(r => r.ok ? r.json() as Promise<GitHubData & { found: boolean }> : null)
      .catch(() => null),

    // ── Gemini knowledge : données marché non structurées ─────────────────
    callLLMWithRouter(
      `Donne en JSON des informations factuelles publiques sur la startup "${name}" (France/Europe) :
{
  "arr_eur": null,
  "funding_stage": "pre-seed|seed|series-a|series-b|series-c+|profitable|unknown",
  "paying_customers": null,
  "nrr": null,
  "has_revenue": false,
  "press_summary": "résumé en 1-2 phrases des faits saillants récents"
}
Mets null si tu n'as pas l'information. Ne spécule pas. JSON uniquement.`,
      'Tu es un analyste factuel. Ne fabrique pas de données. Réponds uniquement en JSON valide.',
      { timeoutMs: 18000, modelId: AGENT_MODEL }
    ).catch(() => ({ response: '{}' })),
  ]);

  // ── Pappers ──────────────────────────────────────────────────────────────
  if (pappersSettled.status === 'fulfilled' && pappersSettled.value) {
    const p: PappersEntreprise = pappersSettled.value;
    const ctx = mapPappersToIROContext(p);
    result.siren         = p.siren;
    result.denomination  = p.denomination;
    result.age_mois      = p.age_mois ?? undefined;
    result.effectifs     = p.effectifs ?? undefined;
    result.naf           = p.libelle_naf ?? undefined;
    result.ville         = p.ville ?? undefined;
    result.statut        = p.statut;
    result.capital_eur   = p.capital_social_eur ?? undefined;
    result.ar_signal     = ctx.ar_signal_bonus;
    result.cessation     = ctx.cessation_alert || ctx.redressement_alert;
    sources.push('pappers');
  }

  // ── GitHub ───────────────────────────────────────────────────────────────
  if (githubSettled.status === 'fulfilled' && githubSettled.value) {
    const g = githubSettled.value;
    if (g.found !== false) {
      result.github_org   = g.owner;
      result.stars        = g.stars;
      result.last_commit  = g.last_commit_date;
      result.tech_stack   = g.tech_stack ?? [];
      result.llm_deps     = g.llm_dependencies ?? [];
      result.di_signal    = g.di_signal;
      result.commits_year = g.total_commits_year;
      sources.push('github');
    }
  }

  // ── Gemini knowledge ─────────────────────────────────────────────────────
  if (pressSettled.status === 'fulfilled') {
    try {
      const raw = pressSettled.value.response.replace(/```json|```/g, '').trim();
      const m = raw.match(/\{[\s\S]*\}/);
      const p = m ? JSON.parse(m[0]) : {};
      if (typeof p.arr_eur === 'number')          result.arr_eur          = p.arr_eur;
      if (typeof p.funding_stage === 'string')    result.funding_stage    = p.funding_stage;
      if (typeof p.paying_customers === 'number') result.paying_customers = p.paying_customers;
      if (typeof p.nrr === 'number')              result.nrr              = p.nrr;
      if (typeof p.has_revenue === 'boolean')     result.has_revenue      = p.has_revenue;
      if (typeof p.press_summary === 'string')    result.press_summary    = p.press_summary;
      if (Object.values(p).some(v => v !== null && v !== false && v !== 'unknown')) {
        sources.push('gemini-knowledge');
      }
    } catch { /* non bloquant */ }
  }

  result.sources_used = sources;
  result.confidence   =
    sources.filter(s => ['pappers','github'].includes(s)).length >= 2 ? 'high'
    : sources.filter(s => ['pappers','github'].includes(s)).length === 1 ? 'medium'
    : 'low';

  return result;
}

// ─── ÉTAPE 3 : INFER ──────────────────────────────────────────────────────────

async function stepInfer(
  name: string,
  collected: CollectedData
): Promise<{ dims: InferredDimensions; maturity: MaturitySignals }> {

  const ctx = [
    `STARTUP : ${name}`,
    collected.denomination  ? `NOM OFFICIEL : ${collected.denomination}` : '',
    collected.siren         ? `SIREN : ${collected.siren}` : '',
    collected.age_mois      ? `ÂGE : ${collected.age_mois} mois (${(collected.age_mois/12).toFixed(1)} ans)` : '',
    collected.effectifs     ? `EFFECTIFS : ${collected.effectifs}` : '',
    collected.naf           ? `SECTEUR NAF : ${collected.naf}` : '',
    collected.statut        ? `STATUT : ${collected.statut}` : '',
    collected.capital_eur   ? `CAPITAL : ${collected.capital_eur.toLocaleString('fr')}€` : '',
    collected.cessation     ? '⚠ ALERTE CESSATION/REDRESSEMENT détectée Pappers' : '',
    collected.di_signal     ? `SIGNAL GITHUB DI : ${collected.di_signal}` : '',
    collected.llm_deps?.length ? `DÉPENDANCES LLM : ${collected.llm_deps.join(', ')}` : '',
    collected.tech_stack?.length ? `STACK TECH : ${collected.tech_stack.slice(0,8).join(', ')}` : '',
    collected.stars         ? `GITHUB STARS : ${collected.stars}` : '',
    collected.commits_year  ? `COMMITS/AN : ${collected.commits_year}` : '',
    collected.funding_stage ? `STADE FINANCEMENT : ${collected.funding_stage}` : '',
    collected.arr_eur       ? `ARR ESTIMÉ : ${(collected.arr_eur/1e6).toFixed(2)}M€` : '',
    collected.nrr           ? `NRR : ${collected.nrr}%` : '',
    collected.paying_customers ? `CLIENTS PAYANTS : ${collected.paying_customers}` : '',
    collected.press_summary ? `PRESSE : ${collected.press_summary}` : '',
    `SOURCES : ${collected.sources_used.join(', ')} (confiance : ${collected.confidence})`,
  ].filter(Boolean).join('\n');

  const SYSTEM = `Tu es un analyste expert en évaluation de startups IA françaises (modèle IRO v4.5-S46, cohorte n=130).
Ton rôle : scorer les 6 dimensions IRO et les 3 variables SRD depuis des données collectées automatiquement.

DIMENSIONS IRO [0-4] :
• DI  — Différenciation Innovation : propriété intellectuelle, R&D propre, barrières IP. DI=0 si pure API wrapper (signal GitHub "wrapper").
• ADC — Avantage Différentiel Client : rétention, switching cost, données propriétaires, NPS.
• IPC — Indicateur Performance Commerciale : ARR réel, croissance, clients payants contractuels.
• AR  — Adaptabilité Réglementaire : certifications, conformité, barrière réglementaire = bonus AR.
• CA  — Cohérence Architecture : scalabilité, debt tech faible, CTO solide, stack moderne.
• GCH — Gouvernance Capital Humain : expérience fondateurs, board, advisors, rétention clés.

VARIABLES SRD [0-4] (Risque Dynamique de Survie) :
• VMM — Volatilité Marché (4 = marché très volatile, 0 = stable)
• NCD — Niveau Concurrence Directe (4 = guerre des prix, 0 = quasi-monopole)
• DFL — Dépendance Fournisseur LLM (4 = 100% dépendant OpenAI/Gemini, 0 = modèle propre)

RÈGLES CRITIQUES :
- Absence d'info → 2 (neutre) pour IRO, 2 (neutre) pour SRD. Jamais 0 ni 4 par défaut.
- di_signal "wrapper" ou "none" → DI ≤ 1 obligatoire. "finetuned" → DI ≥ 3. "proprietary" → DI = 4.
- ARR > 10M€ → IPC ≥ 3. NRR > 110% → ADC ≥ 3. Alerte cessation → AR = 0, CA ≤ 1.
- Goodhart : toutes les dimensions ≥ 3.5 → goodhart = true.
- Vertical : HLTH=healthtech, FINT=fintech, LEGT=legaltech, INDU=industrie/hardware, SAAS=SaaS généraliste, DFLT=autre.
Réponds UNIQUEMENT en JSON valide. Zéro texte autour.`;

  const PROMPT = `${ctx}

Analyse et score. JSON attendu (tous les champs obligatoires) :
{
  "DI": 2, "ADC": 2, "IPC": 2, "AR": 2, "CA": 2, "GCH": 2,
  "srd_vmm": 2, "srd_ncd": 2, "srd_dfl": 2,
  "confidence": {"DI":0.7,"ADC":0.6,"IPC":0.8,"AR":0.5,"CA":0.6,"GCH":0.5},
  "justifications": {
    "DI":"1 phrase factuelle",
    "ADC":"1 phrase factuelle",
    "IPC":"1 phrase factuelle",
    "AR":"1 phrase factuelle",
    "CA":"1 phrase factuelle",
    "GCH":"1 phrase factuelle"
  },
  "maturity": {
    "arrEur": 0,
    "fundingStage": "unknown",
    "teamSize": 0,
    "yearsActive": 0,
    "payingCustomers": 0,
    "hasRevenue": false,
    "nrr": 0
  },
  "sector": "SaaS B2B",
  "vertical": "SAAS",
  "goodhart": false,
  "reasoning": "Synthèse raisonnement 2-3 phrases"
}`;

  const { response } = await callLLMWithRouter(PROMPT, SYSTEM, {
    timeoutMs: 35000,
    modelId: AGENT_MODEL,
  });

  const raw = response.replace(/```json|```/g, '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Inférence IRO : JSON invalide retourné par Gemini');
  const p = JSON.parse(jsonMatch[0]);

  const clampIRO = (v: unknown) => Math.max(0, Math.min(4, Math.round(parseFloat(String(v ?? 2)) || 2)));
  const clampConf = (v: unknown) => Math.max(0, Math.min(1, parseFloat(String(v ?? 0.5)) || 0.5));
  const dims: InferredDimensions = {
    DI:  clampIRO(p.DI),
    ADC: clampIRO(p.ADC),
    IPC: clampIRO(p.IPC),
    AR:  clampIRO(p.AR),
    CA:  clampIRO(p.CA),
    GCH: clampIRO(p.GCH),
    confidence: {
      DI:  clampConf(p.confidence?.DI),
      ADC: clampConf(p.confidence?.ADC),
      IPC: clampConf(p.confidence?.IPC),
      AR:  clampConf(p.confidence?.AR),
      CA:  clampConf(p.confidence?.CA),
      GCH: clampConf(p.confidence?.GCH),
    },
    justifications: {
      DI:  String(p.justifications?.DI  || 'Non documenté.'),
      ADC: String(p.justifications?.ADC || 'Non documenté.'),
      IPC: String(p.justifications?.IPC || 'Non documenté.'),
      AR:  String(p.justifications?.AR  || 'Non documenté.'),
      CA:  String(p.justifications?.CA  || 'Non documenté.'),
      GCH: String(p.justifications?.GCH || 'Non documenté.'),
    },
    srd_vmm:  clampIRO(p.srd_vmm),
    srd_ncd:  clampIRO(p.srd_ncd),
    srd_dfl:  clampIRO(p.srd_dfl),
    sector:   String(p.sector || 'Non identifié'),
    vertical: (['HLTH','FINT','LEGT','INDU','SAAS','DFLT'] as const).includes(p.vertical) ? p.vertical : 'DFLT',
    goodhart: p.goodhart === true,
    reasoning: String(p.reasoning || ''),
  };

  // Scénario par défaut pour m
  const pMaturity = p.maturity || {};
  const maturity: MaturitySignals = {
    arrEur:          collected.arr_eur          ?? (typeof pMaturity.arrEur === 'number' ? pMaturity.arrEur : 0),
    fundingStage:    collected.funding_stage    ?? (typeof pMaturity.fundingStage === 'string' ? pMaturity.fundingStage : 'unknown'),
    teamSize:        collected.effectifs        ?? (typeof pMaturity.teamSize === 'number' ? pMaturity.teamSize : 0),
    yearsActive:     collected.age_mois != null ? Math.round(collected.age_mois / 12) : (typeof pMaturity.yearsActive === 'number' ? pMaturity.yearsActive : 0),
    payingCustomers: collected.paying_customers ?? (typeof pMaturity.payingCustomers === 'number' ? pMaturity.payingCustomers : 0),
    hasRevenue:      (collected.has_revenue || (collected.arr_eur ?? 0) > 0) ? true : (pMaturity.hasRevenue === true),
    nrr:             collected.nrr              ?? (typeof pMaturity.nrr === 'number' ? pMaturity.nrr : 0),
  };

  return { dims, maturity };
}

// ─── FACTEUR DE MATURITÉ (logique identique à IROSTRENGTH_NLP.tsx) ────────────

function computeMaturityFactor(m: MaturitySignals): MaturityResult {
  let factor = 1.0;
  const details: string[] = [];

  if      (m.arrEur >= 10_000_000) { factor = Math.min(factor, 0.30); details.push(`ARR ${(m.arrEur/1e6).toFixed(1)}M€ → scale-up (-70% hazard)`); }
  else if (m.arrEur >= 1_000_000)  { factor = Math.min(factor, 0.55); details.push(`ARR ${(m.arrEur/1e6).toFixed(1)}M€ → traction (-45% hazard)`); }
  else if (m.arrEur >= 100_000)    { factor = Math.min(factor, 0.80); details.push(`ARR ${(m.arrEur/1e3).toFixed(0)}K€ → premiers revenus`); }
  else if (m.hasRevenue)           { factor = Math.min(factor, 0.90); details.push('Revenus déclarés → -10% hazard'); }

  const SF: Record<string,number> = { profitable:0.25,'series-c+':0.32,'series-b':0.45,'series-a':0.65,seed:0.85,'pre-seed':1.05 };
  const sf = SF[m.fundingStage] ?? 1.0;
  if (sf < 1.0)      { factor = Math.min(factor, sf); details.push(`Stade ${m.fundingStage}`); }
  else if (sf > 1.0) { factor = Math.max(factor, sf); }

  if (m.payingCustomers >= 10000) { factor *= 0.85; details.push(`${m.payingCustomers.toLocaleString('fr')} clients payants`); }
  else if (m.payingCustomers >= 100) { factor *= 0.93; }

  if      (m.nrr >= 130) { factor *= 0.80; details.push(`NRR ${m.nrr}% exceptionnel`); }
  else if (m.nrr >= 110) { factor *= 0.90; details.push(`NRR ${m.nrr}% fort`); }
  else if (m.nrr > 0 && m.nrr < 80) { factor *= 1.10; details.push(`NRR ${m.nrr}% — churn ⚠`); }

  if (m.teamSize >= 200) { factor *= 0.90; details.push(`${m.teamSize} employés`); }
  if      (m.yearsActive >= 8) { factor *= 0.80; details.push(`${m.yearsActive} ans d'existence`); }
  else if (m.yearsActive >= 4) { factor *= 0.90; }

  factor = Math.max(0.20, Math.min(1.20, factor));
  if (details.length === 0) details.push('Aucun signal de maturité — pas de correction');

  let label = 'Early-stage (neutre)';
  if      (factor <= 0.30) label = 'Scale-up mature (correction max)';
  else if (factor <= 0.50) label = 'Croissance avancée (forte correction)';
  else if (factor <= 0.70) label = 'Traction validée (correction modérée)';
  else if (factor <= 0.90) label = 'Premiers revenus (légère correction)';
  else if (factor >= 1.10) label = 'Très précoce (majoration hazard)';

  return { factor, label, details };
}

// ─── ÉTAPE 4 : SCORE ──────────────────────────────────────────────────────────

function stepScore(
  dims: InferredDimensions,
  maturity: MaturitySignals,
  trl?: import('../types/iro').TRLScore,
  expertWeights?: Record<string, number>,
  collected?: CollectedData,
): SurvivalBundle {
  // ── applyModelRules — alignement sur useIROAnalysis ───────────────────────
  // FIX : appliquer les mêmes règles de correction (TRL, VRIN, DI-signal)
  // que la vue d'ensemble avant de calculer le score final.
  const rawScores = { DI: dims.DI, ADC: dims.ADC, IPC: dims.IPC, AR: dims.AR, CA: dims.CA, GCH: dims.GCH };
  const fakeModel = {
    nom: collected?.denomination || '',
    trl_niveau: trl ? String(trl.niveau) : undefined,
  };
  const githubData = collected ? {
    di_signal: collected.di_signal as any,
    di_signal_reason: '',
    stars: collected.stars ?? 0,
    total_commits_year: collected.commits_year ?? 0,
    last_commit_date: collected.last_commit ?? '',
    tech_stack: collected.tech_stack ?? [],
    llm_dependencies: collected.llm_deps ?? [],
  } : undefined;
  const { adjusted: scores, logs: ruleLogs } = applyModelRules(rawScores, fakeModel as any, githubData as any, undefined);
  if (ruleLogs.length > 0) console.debug('[AgentMode] applyModelRules:', ruleLogs);
  const iro100 = calcIRO(scores, dims.confidence.IPC, trl, dims.confidence.ADC, dims.confidence.GCH, expertWeights);
  const interaction = calcInteractionBonus(scores);
  const iro100_final = Math.max(0, Math.min(100, Math.round((iro100 + interaction.bonus_total) * 10) / 10));

  // ── calcSRD (moteur réel) ─────────────────────────────────────────────────
  const srdResult = calcSRD(dims.srd_vmm, dims.srd_ncd, dims.srd_dfl, dims.DI);
  const srd100 = srdResult.srd;
  const iroCR = calcIROcr(iro100_final, srd100);

  // ── Facteur maturité ──────────────────────────────────────────────────────
  const mat = computeMaturityFactor(maturity);

  // ── coxFull (modèle réel Cox+RSF patché) ──────────────────────────────────
  const coxResult = coxFull({
    irocr:            iroCR,
    di_zero:          dims.DI === 0,
    srd_high:         srd100 > 60,
    adc_strong:       dims.ADC >= 3,
    ipc_strong:       dims.IPC >= 3,
    regulated_sector: ['HLTH','FINT'].includes(dims.vertical),
  });

  // Application du facteur maturité sur le HR — même logique que IROSTRENGTH_NLP
  const hrAdj = coxResult.hazard_ratio * mat.factor;
  const H0 = 0.011;
  const surv = (t: number) => Math.max(0.01, Math.min(0.99, Math.pow(Math.exp(-H0 * t), hrAdj)));

  // Les champs cox retournés par coxFull sont déjà l'ensemble Cox+RSF (patché)
  const rsf = (coxResult as any).rsf;
  const cox_only = (coxResult as any).cox_only;

  const ens_s12 = surv(12);
  const ens_s24 = surv(24);
  const ens_s36 = surv(36);

  const risk_profile: SurvivalBundle['risk_profile'] =
    ens_s36 >= 0.70 ? 'faible' : ens_s36 >= 0.50 ? 'modéré' : ens_s36 >= 0.30 ? 'élevé' : 'critique';

  return {
    iro100:          Math.round(iro100 * 10) / 10,
    iro100_final,
    srd100,
    iroCR:           Math.round(iroCR * 10) / 10,
    cox_s12:         Math.round((cox_only?.s12 ?? coxResult.survival_12m) * 1000) / 10,
    cox_s24:         Math.round((cox_only?.s24 ?? coxResult.survival_24m) * 1000) / 10,
    cox_s36:         Math.round((cox_only?.s36 ?? coxResult.survival_36m) * 1000) / 10,
    ens_s12:         Math.round(ens_s12 * 1000) / 10,
    ens_s24:         Math.round(ens_s24 * 1000) / 10,
    ens_s36:         Math.round(ens_s36 * 1000) / 10,
    hazard_ratio:    Math.round(hrAdj * 1000) / 1000,
    risk_profile,
    maturity:        mat,
    beta_contributions: coxResult.beta_contributions,
    rsf_available:   !!rsf,
  };
}

// ─── ÉTAPE 5 : REPORT ─────────────────────────────────────────────────────────

async function stepReport(
  name: string,
  dims: InferredDimensions,
  survival: SurvivalBundle,
  collected: CollectedData,
): Promise<{ summary: string; recommendations: string[]; red_flags: string[]; quality_note: string }> {

  const weakDims = Object.entries({ DI:dims.DI,ADC:dims.ADC,IPC:dims.IPC,AR:dims.AR,CA:dims.CA,GCH:dims.GCH })
    .sort((a,b) => a[1]-b[1]).slice(0,2).map(([k,v])=>`${k}=${v}`).join(', ');

  const { response } = await callLLMWithRouter(
    `Tu es un analyste senior en capital-risque spécialisé startups IA françaises.
Génère un rapport sur "${name}" en JSON :
{
  "executive_summary": "3-4 phrases factuelle incluant IRO ${survival.iro100_final}/100, survie 36m ${survival.ens_s36}%, profil ${survival.risk_profile}, facteur maturité ×${survival.maturity.factor.toFixed(2)} (${survival.maturity.label})",
  "recommendations": ["action 1", "action 2", "action 3"],
  "red_flags": ${dims.goodhart || collected.cessation ? '["flag 1"]' : '[]'},
  "data_quality_note": "note sur qualité données : sources ${collected.sources_used.join(', ')}, confiance ${collected.confidence}"
}

Contexte score :
- IRO brut : ${survival.iro100}/100 | IRO final : ${survival.iro100_final}/100 | IRO corrigé SRD : ${survival.iroCR}/100
- SRD : ${survival.srd100}/100 | HR ajusté : ${survival.hazard_ratio}
- Survie 36m ensemble : ${survival.ens_s36}% | Cox seul : ${survival.cox_s36}%
- Dimensions faibles : ${weakDims}${dims.goodhart ? ' | GOODHART RISK' : ''}${collected.cessation ? ' | ALERTE CESSATION' : ''}
- Maturité : ${survival.maturity.details.join('; ')}

JSON uniquement.`,
    'Tu es un analyste capital-risque. Réponds en JSON valide strict.',
    { timeoutMs: 20000, modelId: AGENT_MODEL }
  ).catch(() => ({ response: '{}' }));

  try {
    const raw = response.replace(/```json|```/g, '').trim();
    const m = raw.match(/\{[\s\S]*\}/);
    const p = m ? JSON.parse(m[0]) : {};
    return {
      summary:          String(p.executive_summary || `${name} — IRO ${survival.iro100_final}/100, survie 36m ${survival.ens_s36}%.`),
      recommendations:  Array.isArray(p.recommendations) ? p.recommendations.slice(0,4) : [],
      red_flags:        Array.isArray(p.red_flags) ? p.red_flags.slice(0,4) : [],
      quality_note:     String(p.data_quality_note || `${collected.sources_used.join(', ')}, confiance ${collected.confidence}.`),
    };
  } catch {
    return {
      summary: `${name} — IRO ${survival.iro100_final}/100, survie 36m ${survival.ens_s36}%. Profil : ${survival.risk_profile}.`,
      recommendations: ['Enrichir les données manuellement pour affiner le scoring.'],
      red_flags: dims.goodhart ? ['Profil Goodhart : vérifier les données sources.'] : [],
      quality_note: `${collected.sources_used.length} source(s), confiance ${collected.confidence}.`,
    };
  }
}

// ─── HOOK AGENT ───────────────────────────────────────────────────────────────

export function useIROAgent() {
  const [step,     setStep]   = useState<AgentStep>('idle');
  const [logs,     setLogs]   = useState<StepLog[]>([]);
  const [report,   setReport] = useState<AgentReport | null>(null);
  const [error,    setError]  = useState<string | null>(null);
  const abortRef = useRef<boolean>(false);

  const log = useCallback((info: StepLog) => {
    setLogs(prev => [...prev, info]);
    setStep(info.step);
  }, []);

  const run = useCallback(async (
    startup: string,
    trl?: import('../types/iro').TRLScore,
    expertWeights?: Record<string, number>,
  ) => {
    if (!startup.trim()) return;
    abortRef.current = false;
    setStep('idle'); setLogs([]); setReport(null); setError(null);
    const t0 = Date.now();
    const trail: StepLog[] = [];

    const push = (info: Omit<StepLog, 'ts'>) => {
      const full = { ...info, ts: Date.now() };
      trail.push(full);
      log(full);
      return full;
    };

    try {
      // 1. DISCOVER
      push({ step:'discovering', label:'Identification', detail:`Résolution de "${startup}"…` });
      const discovered = await stepDiscover(startup);
      push({ step:'discovering', label:'Nom résolu',
        detail: `→ ${discovered.cleanName}${discovered.githubOrg ? ` · GitHub: ${discovered.githubOrg}` : ''}${discovered.sirenHint ? ` · SIREN: ${discovered.sirenHint}` : ''}`,
      });
      if (abortRef.current) return;

      // 2. COLLECT
      push({ step:'collecting', label:'Collecte multi-sources', detail:'Pappers + GitHub + Gemini en parallèle…' });
      const collected = await stepCollect(discovered.cleanName, discovered);
      push({ step:'collecting', label:`${collected.sources_used.length} source(s) collectée(s)`,
        detail: collected.sources_used.join(' · ') || 'Aucune source primaire',
        sources: collected.sources_used,
      });
      if (abortRef.current) return;

      // 3. INFER
      push({ step:'inferring', label:'Inférence IRO par Gemini 3', detail:'Analyse des 6 dimensions + SRD depuis les données…' });
      const { dims, maturity } = await stepInfer(discovered.cleanName, collected);
      push({ step:'inferring', label:'Dimensions inférées',
        detail: `DI=${dims.DI} ADC=${dims.ADC} IPC=${dims.IPC} AR=${dims.AR} CA=${dims.CA} GCH=${dims.GCH}${dims.goodhart?' ⚠ GOODHART':''}`,
      });
      if (abortRef.current) return;

      // 4. SCORE
      push({ step:'scoring', label:'Cox + RSF + maturité', detail:'Calcul probabilités de survie…' });
      // FIX : passer trl, expertWeights ET collected pour appliquer applyModelRules
      const survival = stepScore(dims, maturity, trl, expertWeights, collected);
      push({ step:'scoring', label:'Score calculé',
        detail: `IRO ${survival.iro100_final}/100 · IRO_cr ${survival.iroCR} · Survie 36m: ${survival.ens_s36}% · ×${survival.maturity.factor.toFixed(2)}`,
      });
      if (abortRef.current) return;

      // 5. REPORT
      push({ step:'reporting', label:'Génération rapport', detail:'Synthèse exécutive + recommandations…' });
      const { summary, recommendations, red_flags, quality_note } =
        await stepReport(discovered.cleanName, dims, survival, collected);

      const finalReport: AgentReport = {
        startup_name:      discovered.cleanName,
        generated_at:      new Date().toISOString(),
        duration_ms:       Date.now() - t0,
        collected,
        inferred:          dims,
        maturity_signals:  maturity,
        survival,
        executive_summary: summary,
        recommendations,
        red_flags,
        quality_note,
        audit_trail:       trail,
      };

      push({ step:'done', label:'Terminé', detail:`Rapport généré en ${Math.round((Date.now()-t0)/1000)}s` });
      setReport(finalReport);
      setStep('done');

    } catch (e: any) {
      const msg = e?.message ?? 'Erreur inconnue';
      push({ step:'error', label:'Erreur', detail: msg });
      setError(msg);
      setStep('error');
    }
  }, [log]);

  const cancel = useCallback(() => {
    abortRef.current = true;
    setStep('idle'); setLogs([]); setError(null);
  }, []);

  return { step, logs, report, error, run, cancel };
}

// ─── CONSTANTES UI ────────────────────────────────────────────────────────────

const DIM_META = {
  DI:  { label: 'Différenciation\nInnovation',   color: '#6366f1', desc: 'Propriété intellectuelle & barrières IP' },
  ADC: { label: 'Avantage\nDiffér. Client',      color: '#10b981', desc: 'Rétention, switching cost, données propres' },
  IPC: { label: 'Perf.\nCommerciale',            color: '#f59e0b', desc: 'ARR réel, croissance, clients payants' },
  AR:  { label: 'Adapt.\nRéglementaire',         color: '#3b82f6', desc: 'Certifications, conformité, barrière légale' },
  CA:  { label: 'Cohérence\nArchitecture',       color: '#ef4444', desc: 'Dette tech, scalabilité, CTO solide' },
  GCH: { label: 'Gouvernance\nCap. Humain',      color: '#a855f7', desc: 'Fondateurs, board, rétention équipe' },
} as const;

const RISK_PALETTE = {
  faible:   { bg: '#052e16', border: '#16a34a', text: '#4ade80', badge: '#16a34a' },
  modéré:   { bg: '#1c1002', border: '#d97706', text: '#fbbf24', badge: '#d97706' },
  élevé:    { bg: '#1c0a02', border: '#ea580c', text: '#fb923c', badge: '#ea580c' },
  critique: { bg: '#1c0202', border: '#dc2626', text: '#f87171', badge: '#dc2626' },
};

const STEP_ICON: Record<AgentStep, string> = {
  idle:'○', discovering:'◎', collecting:'◉', inferring:'◈',
  scoring:'◆', reporting:'◇', done:'●', error:'✕',
};

// ─── COMPOSANT ────────────────────────────────────────────────────────────────

// FIX : props pour aligner le calcul agent sur la vue d'ensemble
interface IROAgentModeProps {
  trl?:          import('../types/iro').TRLScore;
  expertWeights?: Record<string, number>;
}

export default function IROAgentMode({ trl, expertWeights }: IROAgentModeProps = {}) {
  const { step, logs, report, error, run, cancel } = useIROAgent();
  const [input, setInput] = useState('');
  const running = !['idle','done','error'].includes(step);
  const pct = logs.length > 0
    ? ({ idle:0, discovering:15, collecting:35, inferring:60, scoring:78, reporting:90, done:100, error:0 }[step] ?? 0)
    : 0;

  const EXAMPLES = ['Qonto', 'Mistral AI', 'Pennylane', 'Alan', 'Spendesk', 'Payfit'];

  return (
    <div style={{
      minHeight: '100vh',
      background: '#040810',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      color: '#cbd5e1',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <style>{`
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse { 0%,100%{opacity:.7} 50%{opacity:1} }
        .log-entry { animation: fadeIn 0.25s ease both; }
        .run-btn:hover:not(:disabled) { background: #1e3a6e !important; }
        .example-btn:hover { background: #0f172a !important; color: #93c5fd !important; }
        .dim-card { transition: box-shadow .2s; }
        .dim-card:hover { box-shadow: 0 0 0 1px #334155; }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.75rem 1.5rem',
        borderBottom: '1px solid #0f172a',
        background: '#050c18',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem' }}>
            ◈
          </div>
          <div>
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: '#334155' }}>
              IROSTRENGTH · AGENT MODE v1.0
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em' }}>
              Analyse IRO Autonome
            </div>
          </div>
        </div>
        <div style={{ fontSize: '0.58rem', color: '#1e3a5f', textAlign: 'right', lineHeight: 1.8 }}>
          <div>Pappers · GitHub · Gemini 3</div>
          <div>Cox + RSF · n=130 cohorte FR · AUC~0.79</div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', flex: 1, overflow: 'hidden' }}>

        {/* Panneau gauche */}
        <div style={{
          borderRight: '1px solid #0a1120',
          background: '#050c18',
          display: 'flex', flexDirection: 'column',
          padding: '1.25rem',
          gap: '1rem',
          overflow: 'auto',
        }}>
          {/* Input */}
          <div>
            <div style={{ fontSize: '0.58rem', letterSpacing: '0.15em', color: '#1e3a5f', marginBottom: '0.4rem' }}>
              NOM DE LA STARTUP
            </div>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !running && input.trim() && run(input, trl, expertWeights)}
              placeholder="Ex : Qonto, Mistral AI…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#080f1e', border: '1px solid #0f1e35',
                borderRadius: 5, padding: '0.65rem 0.8rem',
                color: '#e2e8f0', fontSize: '0.82rem',
                outline: 'none', fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Exemples */}
          <div>
            <div style={{ fontSize: '0.55rem', color: '#1e3a5f', marginBottom: '0.35rem', letterSpacing: '0.1em' }}>
              EXEMPLES
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {EXAMPLES.map(ex => (
                <button key={ex} className="example-btn" onClick={() => setInput(ex)} style={{
                  background: '#080f1e', border: '1px solid #0f1e35', borderRadius: 4,
                  padding: '0.2rem 0.5rem', fontSize: '0.6rem', color: '#475569',
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
                }}>
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* Bouton */}
          {!running ? (
            <button
              className="run-btn"
              onClick={() => input.trim() && run(input, trl, expertWeights)}
              disabled={!input.trim()}
              style={{
                background: input.trim() ? '#0f2456' : '#080f1e',
                color: input.trim() ? '#60a5fa' : '#1e3a5f',
                border: `1px solid ${input.trim() ? '#1d4ed8' : '#0f1e35'}`,
                borderRadius: 6, padding: '0.75rem',
                fontSize: '0.72rem', fontWeight: 700,
                cursor: input.trim() ? 'pointer' : 'not-allowed',
                letterSpacing: '0.08em', fontFamily: 'inherit',
                transition: 'all .15s',
              }}
            >
              ◈ LANCER L'ANALYSE AUTONOME
            </button>
          ) : (
            <button onClick={cancel} style={{
              background: '#1c0202', border: '1px solid #450a0a', borderRadius: 6, padding: '0.75rem',
              fontSize: '0.72rem', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.08em',
            }}>
              ✕ ANNULER
            </button>
          )}

          {/* Barre progression */}
          {running && (
            <div>
              <div style={{ background: '#0a1120', borderRadius: 2, height: 2, overflow: 'hidden', marginBottom: '0.4rem' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#1d4ed8,#7c3aed)', transition: 'width 0.8s ease', borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: '0.58rem', color: '#1e3a5f', animation: 'pulse 2s infinite' }}>
                {pct}% — {step.toUpperCase()}
              </div>
            </div>
          )}

          {/* Log pipeline */}
          <div style={{ borderTop: '1px solid #0a1120', paddingTop: '0.8rem' }}>
            <div style={{ fontSize: '0.55rem', letterSpacing: '0.12em', color: '#1e3a5f', marginBottom: '0.6rem' }}>
              PIPELINE LOG
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', maxHeight: '40vh', overflowY: 'auto' }}>
              {logs.length === 0 && (
                <div style={{ fontSize: '0.6rem', color: '#0f2456' }}>En attente de lancement…</div>
              )}
              {logs.map((l, i) => (
                <div key={i} className="log-entry" style={{
                  display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
                  padding: '0.3rem 0',
                  borderBottom: '1px solid #050c18',
                  opacity: i === logs.length - 1 ? 1 : 0.45,
                }}>
                  <span style={{ color: l.step === 'done' ? '#10b981' : l.step === 'error' ? '#ef4444' : '#1d4ed8', fontSize: '0.7rem', flexShrink: 0 }}>
                    {STEP_ICON[l.step]}
                  </span>
                  <div>
                    <div style={{ fontSize: '0.62rem', color: '#94a3b8', fontWeight: 600 }}>{l.label}</div>
                    <div style={{ fontSize: '0.55rem', color: '#334155', marginTop: '0.05rem', lineHeight: 1.4 }}>{l.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ background: '#1c0202', border: '1px solid #450a0a', borderRadius: 5, padding: '0.6rem', fontSize: '0.65rem', color: '#fca5a5', lineHeight: 1.5 }}>
              ✕ {error}
            </div>
          )}
        </div>

        {/* Panneau droit — rapport */}
        <div style={{ overflow: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* État idle */}
          {!report && !running && !error && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', opacity: 0.25 }}>
              <div style={{ fontSize: '3rem', lineHeight: 1 }}>◈</div>
              <div style={{ fontSize: '0.75rem', color: '#334155', textAlign: 'center', lineHeight: 2, maxWidth: 380 }}>
                Entrez un nom de startup<br/>
                L'agent collecte Pappers + GitHub + presse<br/>
                Gemini 3 infère les 6 dimensions IRO<br/>
                Cox + RSF calcule la survie avec facteur maturité<br/>
                Rapport auditable en moins de 90 secondes
              </div>
            </div>
          )}

          {/* Loading */}
          {running && !report && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
              <div style={{ fontSize: '2rem', animation: 'pulse 1.5s infinite' }}>◈</div>
              <div style={{ fontSize: '0.72rem', color: '#1d4ed8', letterSpacing: '0.1em' }}>
                {({ discovering:'IDENTIFICATION', collecting:'COLLECTE', inferring:'INFÉRENCE IRO', scoring:'SCORING COX+RSF', reporting:'RAPPORT' }[step as string]) ?? step.toUpperCase()}
              </div>
              <div style={{ fontSize: '0.6rem', color: '#0f2456' }}>
                {logs[logs.length-1]?.detail}
              </div>
            </div>
          )}

          {/* ── RAPPORT ─────────────────────────────────────────────────────── */}
          {report && (() => {
            const { survival, inferred, collected, maturity_signals: mat } = report;
            const rp = RISK_PALETTE[survival.risk_profile];
            return (
              <>
                {/* Header rapport */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontSize: '0.58rem', letterSpacing: '0.15em', color: '#334155' }}>RAPPORT IRO — AGENT MODE</div>
                    <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.4rem', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                      {report.startup_name}
                    </h2>
                    <div style={{ fontSize: '0.6rem', color: '#334155', marginTop: '0.2rem' }}>
                      Généré en {Math.round(report.duration_ms/1000)}s · {new Date(report.generated_at).toLocaleString('fr-FR')}
                    </div>
                  </div>
                  <div style={{
                    background: rp.bg, border: `1px solid ${rp.border}`, borderRadius: 8,
                    padding: '0.6rem 1rem', textAlign: 'center', minWidth: 120,
                  }}>
                    <div style={{ fontSize: '0.55rem', letterSpacing: '0.12em', color: rp.border, marginBottom: '0.2rem' }}>PROFIL DE RISQUE</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: rp.text, textTransform: 'uppercase' }}>{survival.risk_profile}</div>
                  </div>
                </div>

                {/* KPIs principaux */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.6rem' }}>
                  {[
                    { k:'IRO', v:`${survival.iro100_final}`, sub:'/100', c: survival.iro100_final>=61.5?'#10b981':survival.iro100_final>=50?'#f59e0b':'#ef4444' },
                    { k:'IRO_cr', v:`${survival.iroCR}`, sub:'/100', c:'#60a5fa' },
                    { k:'SRD', v:`${survival.srd100}`, sub:'/100', c: survival.srd100<40?'#10b981':survival.srd100<65?'#f59e0b':'#ef4444' },
                    { k:'Survie 36m', v:`${survival.ens_s36}%`, sub:'ensemble', c: rp.text },
                    { k:'Maturité', v:`×${survival.maturity.factor.toFixed(2)}`, sub:survival.maturity.label.split('(')[0].trim().slice(0,18), c:'#a855f7' },
                  ].map(card => (
                    <div key={card.k} style={{ background: '#050c18', border: '1px solid #0a1120', borderRadius: 7, padding: '0.7rem 0.6rem' }}>
                      <div style={{ fontSize: '0.52rem', letterSpacing: '0.1em', color: '#1e3a5f', marginBottom: '0.25rem' }}>{card.k}</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: card.c, lineHeight: 1 }}>{card.v}</div>
                      <div style={{ fontSize: '0.52rem', color: '#334155', marginTop: '0.15rem' }}>{card.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Goodhart + Cessation */}
                {(inferred.goodhart || collected.cessation) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {inferred.goodhart && (
                      <div style={{ background:'#1c1002', border:'1px solid #d9770680', borderLeft:'3px solid #d97706', borderRadius:6, padding:'0.6rem 1rem' }}>
                        <div style={{ fontSize:'0.55rem', letterSpacing:'0.12em', color:'#d97706', marginBottom:'0.2rem' }}>⚠ GOODHART DETECTOR</div>
                        <div style={{ fontSize:'0.7rem', color:'#fbbf24' }}>Toutes les dimensions ≥ 3.5 — profil statistiquement improbable. Vérifier les données.</div>
                      </div>
                    )}
                    {collected.cessation && (
                      <div style={{ background:'#1c0202', border:'1px solid #dc262680', borderLeft:'3px solid #dc2626', borderRadius:6, padding:'0.6rem 1rem' }}>
                        <div style={{ fontSize:'0.55rem', letterSpacing:'0.12em', color:'#dc2626', marginBottom:'0.2rem' }}>✕ ALERTE PAPPERS</div>
                        <div style={{ fontSize:'0.7rem', color:'#f87171' }}>Cessation ou redressement judiciaire détecté dans les données Pappers.</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Synthèse */}
                <div style={{ background:'#050c18', border:'1px solid #0a1120', borderRadius:8, padding:'1rem 1.2rem' }}>
                  <div style={{ fontSize:'0.55rem', letterSpacing:'0.12em', color:'#1e3a5f', marginBottom:'0.6rem' }}>SYNTHÈSE EXÉCUTIVE</div>
                  <div style={{ fontSize:'0.8rem', color:'#94a3b8', lineHeight:1.9 }}>{report.executive_summary}</div>
                </div>

                {/* Dimensions IRO */}
                <div>
                  <div style={{ fontSize:'0.55rem', letterSpacing:'0.12em', color:'#1e3a5f', marginBottom:'0.7rem' }}>
                    6 DIMENSIONS IRO — INFÉRÉES PAR GEMINI 3 DEPUIS DONNÉES COLLECTÉES
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.6rem' }}>
                    {(Object.keys(DIM_META) as (keyof typeof DIM_META)[]).map(dim => {
                      const meta = DIM_META[dim];
                      const val = inferred[dim] as number;
                      const conf = inferred.confidence[dim];
                      return (
                        <div key={dim} className="dim-card" style={{
                          background:'#050c18', border:`1px solid #0a1120`, borderRadius:7, padding:'0.8rem',
                        }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.35rem' }}>
                            <span style={{ fontSize:'0.65rem', fontWeight:700, color:meta.color }}>{dim}</span>
                            <span style={{ fontSize:'1.1rem', fontWeight:700, color: val>=3?'#10b981':val>=2?'#f59e0b':'#ef4444' }}>
                              {val}<span style={{ fontSize:'0.6rem', color:'#334155' }}>/4</span>
                            </span>
                          </div>
                          <div style={{ background:'#040810', borderRadius:2, height:3, overflow:'hidden', marginBottom:'0.4rem' }}>
                            <div style={{ width:`${(val/4)*100}%`, height:'100%', background:meta.color, transition:'width .5s ease', borderRadius:2 }} />
                          </div>
                          <div style={{ fontSize:'0.58rem', color:'#334155', marginBottom:'0.3rem', whiteSpace:'pre-line' }}>{meta.label}</div>
                          <div style={{ fontSize:'0.62rem', color:'#64748b', lineHeight:1.5 }}>{inferred.justifications?.[dim] ?? 'Non documenté.'}</div>
                          <div style={{ fontSize:'0.55rem', color:'#1e3a5f', marginTop:'0.3rem' }}>
                            confiance {Math.round(conf*100)}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Grille infos : survie + données + maturité */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.8rem' }}>
                  {/* Survie */}
                  <div style={{ background:'#050c18', border:'1px solid #0a1120', borderRadius:8, padding:'1rem' }}>
                    <div style={{ fontSize:'0.55rem', letterSpacing:'0.1em', color:'#1e3a5f', marginBottom:'0.7rem' }}>SURVIE ESTIMÉE</div>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.68rem' }}>
                      <thead>
                        <tr>
                          <th style={{ color:'#334155', textAlign:'left', padding:'0.2rem 0', fontWeight:400 }}></th>
                          {['12m','24m','36m'].map(h=><th key={h} style={{ color:'#334155', textAlign:'right', padding:'0.2rem 0', fontWeight:400 }}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { l:'Cox',      s12:survival.cox_s12, s24:survival.cox_s24, s36:survival.cox_s36, c:'#f59e0b' },
                          { l:'Ensemble', s12:survival.ens_s12, s24:survival.ens_s24, s36:survival.ens_s36, c:'#f1f5f9' },
                        ].map(row=>(
                          <tr key={row.l}>
                            <td style={{ padding:'0.3rem 0', color:row.c, fontWeight:row.l==='Ensemble'?700:400 }}>{row.l}</td>
                            {[row.s12,row.s24,row.s36].map((v,i)=>(
                              <td key={i} style={{ textAlign:'right', padding:'0.3rem 0', fontWeight:row.l==='Ensemble'?700:400,
                                color: v>=65?'#10b981':v>=45?'#f59e0b':'#ef4444' }}>
                                {v}%
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr style={{ borderTop:'1px solid #0a1120' }}>
                          <td colSpan={4} style={{ padding:'0.4rem 0 0', fontSize:'0.55rem', color:'#1e3a5f' }}>
                            HR ajusté: {survival.hazard_ratio} · ×{survival.maturity.factor.toFixed(2)} maturité
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Données collectées */}
                  <div style={{ background:'#050c18', border:'1px solid #0a1120', borderRadius:8, padding:'1rem' }}>
                    <div style={{ fontSize:'0.55rem', letterSpacing:'0.1em', color:'#1e3a5f', marginBottom:'0.7rem' }}>
                      DONNÉES — {collected.sources_used.map(s=>s.toUpperCase()).join(' · ') || 'AUCUNE SOURCE'}
                    </div>
                    {[
                      ['SIREN',      collected.siren],
                      ['Statut',     collected.statut],
                      ['Âge',        collected.age_mois ? `${collected.age_mois}m (${(collected.age_mois/12).toFixed(1)}a)` : null],
                      ['Effectifs',  collected.effectifs ? `${collected.effectifs}` : null],
                      ['NAF',        collected.naf],
                      ['ARR',        collected.arr_eur ? `${(collected.arr_eur/1e6).toFixed(2)}M€` : null],
                      ['NRR',        collected.nrr ? `${collected.nrr}%` : null],
                      ['Clients',    collected.paying_customers ? `${collected.paying_customers.toLocaleString('fr')}` : null],
                      ['GitHub',     collected.github_org ? `${collected.github_org} · ${collected.stars ?? 0}★` : null],
                      ['DI signal',  collected.di_signal],
                    ].filter(([,v])=>v).map(([k,v])=>(
                      <div key={k as string} style={{ display:'flex', justifyContent:'space-between', padding:'0.22rem 0', borderBottom:'1px solid #04080f', fontSize:'0.65rem' }}>
                        <span style={{ color:'#334155' }}>{k as string}</span>
                        <span style={{ color:'#64748b' }}>{v as string}</span>
                      </div>
                    ))}
                    <div style={{ fontSize:'0.55rem', color:'#1e3a5f', marginTop:'0.4rem' }}>
                      Confiance : {collected.confidence}
                    </div>
                  </div>

                  {/* Maturité */}
                  <div style={{ background:'#050c18', border:'1px solid #0a1120', borderRadius:8, padding:'1rem' }}>
                    <div style={{ fontSize:'0.55rem', letterSpacing:'0.1em', color:'#1e3a5f', marginBottom:'0.7rem' }}>FACTEUR MATURITÉ</div>
                    <div style={{ fontSize:'1.5rem', fontWeight:700, color:'#a855f7', lineHeight:1, marginBottom:'0.3rem' }}>
                      ×{survival.maturity.factor.toFixed(2)}
                    </div>
                    <div style={{ fontSize:'0.6rem', color:'#7c3aed', marginBottom:'0.7rem', lineHeight:1.4 }}>
                      {survival.maturity.label}
                    </div>
                    {survival.maturity.details.map((d,i)=>(
                      <div key={i} style={{ fontSize:'0.62rem', color:'#4c1d95', padding:'0.2rem 0', borderBottom:'1px solid #04080f', lineHeight:1.4 }}>
                        › {d}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recommandations + Red flags */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.8rem' }}>
                  <div style={{ background:'#050c18', border:'1px solid #0a1120', borderRadius:8, padding:'1rem' }}>
                    <div style={{ fontSize:'0.55rem', letterSpacing:'0.1em', color:'#064e3b', marginBottom:'0.6rem' }}>✓ RECOMMANDATIONS</div>
                    {report.recommendations.length === 0
                      ? <div style={{ fontSize:'0.65rem', color:'#1e3a5f' }}>Aucune recommandation générée.</div>
                      : report.recommendations.map((r,i) => (
                          <div key={i} style={{ fontSize:'0.7rem', color:'#34d399', padding:'0.3rem 0', borderBottom:'1px solid #04080f', lineHeight:1.5 }}>
                            {i+1}. {r}
                          </div>
                        ))
                    }
                  </div>
                  <div style={{ background:'#050c18', border:'1px solid #0a1120', borderRadius:8, padding:'1rem' }}>
                    <div style={{ fontSize:'0.55rem', letterSpacing:'0.1em', color:'#7f1d1d', marginBottom:'0.6rem' }}>⚠ RED FLAGS</div>
                    {report.red_flags.length === 0
                      ? <div style={{ fontSize:'0.65rem', color:'#1e3a5f' }}>Aucun red flag détecté.</div>
                      : report.red_flags.map((r,i) => (
                          <div key={i} style={{ fontSize:'0.7rem', color:'#f87171', padding:'0.3rem 0', borderBottom:'1px solid #04080f', lineHeight:1.5 }}>
                            ⚠ {r}
                          </div>
                        ))
                    }
                  </div>
                </div>

                {/* Beta contributions Cox */}
                <div style={{ background:'#050c18', border:'1px solid #0a1120', borderRadius:8, padding:'1rem' }}>
                  <div style={{ fontSize:'0.55rem', letterSpacing:'0.1em', color:'#1e3a5f', marginBottom:'0.6rem' }}>
                    CONTRIBUTIONS β — COX PROPORTIONAL HAZARDS
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'0.4rem' }}>
                    {Object.entries(survival.beta_contributions).map(([k,v]) => (
                      <div key={k} style={{
                        background:'#040810', border:'1px solid #0a1120', borderRadius:4,
                        padding:'0.25rem 0.6rem', fontSize:'0.62rem',
                        color: (v as number)>0?'#f87171':(v as number)<0?'#34d399':'#475569',
                      }}>
                        {k}: {(v as number)>0?'+':''}{(v as number).toFixed(3)}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer audit */}
                <div style={{ fontSize:'0.55rem', color:'#0f2456', display:'flex', gap:'1.5rem', flexWrap:'wrap', borderTop:'1px solid #0a1120', paddingTop:'0.6rem' }}>
                  <span>⏱ {Math.round(report.duration_ms/1000)}s</span>
                  <span>◈ Cox+RSF ensemble (60/40)</span>
                  <span>📊 AUC empirique ~0.74 Cox · ~0.79 ensemble</span>
                  <span>⚠ TRL 2→3 — validation longitudinale requise n=150-200</span>
                  <span>ℹ {report.quality_note}</span>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
