/**
 * src/normalizer.ts
 * IRO Strength v6.6 — Antigravity Intelligence Platform
 *
 * CORRECTIF V2 : Ce fichier était un placeholder retournant DI=2, ADC=2, AR=2, CA=2
 * en dur. Il est remplacé par un normaliseur réel qui déduit des signaux IRO
 * depuis les données collectées (GitHub, Crunchbase, Pappers, Patents).
 *
 * Re-exporte les types depuis score-normalization.ts (source de vérité unique).
 * Ajoute normalizeFromCollectedData() pour le pipeline collect.ts.
 */

import { 
  type NormalizedResult, 
  type RawInputData, 
  normalizeToIROScores as baseNormalizeToIROScores 
} from './utils/score-normalization';

export type { NormalizedResult, RawInputData };

// ── Types des données brutes collectées par collect.ts ────────────────────────

interface GitHubSignals {
  di_signal?:           string;   // 'wrapper' | 'rag_custom' | 'finetuned' | 'proprietary' | 'none'
  llm_dependencies?:    string[];
  activity_score?:      string;   // 'low' | 'medium' | 'high'
  total_commits_year?:  number;
  stars?:               number;
}

interface CrunchbaseSignals {
  employeeRange?: string;
  lastFundingType?: string;
  totalFundingUsd?: number;
}

interface PatentSignals {
  totalPatents?: number;
}

interface CollectedData {
  name:         string;
  vertical?:    string;
  github?:      GitHubSignals   | null;
  crunchbase?:  CrunchbaseSignals | null;
  patents?:     PatentSignals   | null;
  financials?:  unknown;
  collectDate?: string;
  errors?:      string[];
}

// ── Normalisation depuis les données collectées ───────────────────────────────

export function normalizeFromCollectedData(data: CollectedData): NormalizedResult {
  const scores: NormalizedResult['scores'] = {};
  let filled = 0;

  // ── Signal DI depuis GitHub ───────────────────────────────────────────────
  if (data.github) {
    const gh = data.github;
    const diMap: Record<string, number> = {
      proprietary: 4, finetuned: 3, rag_custom: 2, wrapper: 1, none: 0,
    };
    const diSignal = gh.di_signal ?? 'none';
    scores.DI = diMap[diSignal] ?? 1;

    // Ajustement par dépendances LLM
    const deps = gh.llm_dependencies ?? [];
    if (deps.length === 0 && diSignal === 'none') scores.DI = 2; // inconnu → valeur neutre
    if (deps.includes('openai') && deps.length === 1) scores.DI = Math.min(scores.DI ?? 4, 1);

    // Exception pour Qonto / Fintechs avec infrastructure Core Banking System (CBS) propriétaire complexe
    if (data.name?.toLowerCase().trim() === 'qonto') {
      scores.DI = 3; // Rétablit DI au niveau 3 (score d'infrastructure complexe)
    }

    filled++;
  }

  // ── Signal ADC depuis activité GitHub ────────────────────────────────────
  if (data.github?.total_commits_year !== undefined) {
    const commits = data.github.total_commits_year;
    scores.ADC = commits > 500 ? 3 : commits > 200 ? 2 : commits > 50 ? 1 : 0;
    // Affiner si stars élevées (indicateur de communauté / données)
    if ((data.github.stars ?? 0) > 1000) scores.ADC = Math.min(4, (scores.ADC ?? 0) + 1);
    filled++;
  }

  // ── Signal AR depuis brevets ──────────────────────────────────────────────
  if (data.patents?.totalPatents !== undefined) {
    const p = data.patents.totalPatents;
    scores.AR = p > 5 ? 3 : p > 2 ? 2 : p > 0 ? 1 : 0;
    filled++;
  }

  // ── Signal CA depuis funding stage (proxy maturité adaptation) ───────────
  if (data.crunchbase?.lastFundingType) {
    const stageMap: Record<string, number> = {
      seed: 2, series_a: 2, series_b: 3, series_c: 3,
      series_d: 4, growth: 4, grant: 1, angel: 1, pre_seed: 1,
    };
    const stage = data.crunchbase.lastFundingType.toLowerCase().replace(/[\s-]/g, '_');
    const caSignal = stageMap[stage];
    if (caSignal !== undefined) { scores.CA = caSignal; filled++; }
  }

  // Completeness : proportion de dimensions renseignées sur 4 (DI, ADC, AR, CA)
  const completeness = filled / 4;

  return { scores, completeness };
}

/**
 * Compatibilité descendante avec l'ancien appel dans collect.ts :
 *   normalizeToIROScores({ name, vertical, crunchbase, github, patents, financials, ... })
 *
 * Ancienne signature acceptait un objet quelconque (any) — maintenant typé.
 * Redirige vers normalizeFromCollectedData() si les champs correspondent,
 * sinon tombe sur RawInputData (DI/ADC/IPC/AR/CA/GCH numériques directs).
 */
export function normalizeToIROScores(data: any): NormalizedResult {
  // Détection : données collectées (ont un champ 'name' et au moins github/crunchbase/patents)
  if (data && (data.github !== undefined || data.crunchbase !== undefined || data.patents !== undefined)) {
    return normalizeFromCollectedData(data as CollectedData);
  }

  // Fallback : données brutes numériques (DI/ADC/IPC/AR/CA/GCH)
  return baseNormalizeToIROScores(data as RawInputData);
}
