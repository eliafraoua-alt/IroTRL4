/**
 * src/schemas/llm-response.ts — Validation des réponses LLM
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CORRECTION R3 (Audit v4.3)                                 ║
 * ║  Schémas de validation pour toutes les réponses JSON LLM.   ║
 * ║  Remplace extractJSON() brut par safeParse avec erreur       ║
 * ║  explicite et valeurs par défaut sûres.                     ║
 * ║                                                             ║
 * ║  NOTE : ce fichier n'importe PAS zod pour éviter une        ║
 * ║  dépendance externe supplémentaire. Il implémente une        ║
 * ║  validation structurelle légère et typée manuellement.      ║
 * ║  Migrer vers zod si le projet grossit.                      ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ── Type helpers ──────────────────────────────────────────────────────────────

export type ValidationResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string; raw: unknown };

type VR<T> = ValidationResult<T>;

function ok<T>(data: T): VR<T> {
  return { success: true, data };
}

function fail<T>(error: string, raw: unknown): VR<T> {
  return { success: false, error, raw };
}

// ── Schéma : scores dimensionnels IRO ────────────────────────────────────────

export interface DimensionScoresRaw {
  DI: number; ADC: number; IPC: number;
  AR: number; CA: number;  GCH: number;
  /** LU (15%) — Lead User Integration (von Hippel). Optionnel : absent si LLM tourne en v4.4. */
  LU?: number;
  /** REV13 — fraction du CA du top client [0-1]. Ex: 0.47 pour Saint-Gobain a 47%. */
  _pct_top_client?: number;
  /** REV13 — nombre total de clients actifs. */
  _nb_clients?:     number;
}

const DIMS_REQUIRED = ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'] as const;
const DIMS_OPTIONAL = ['LU'] as const;
const DIMS = [...DIMS_REQUIRED, ...DIMS_OPTIONAL] as const;

export function parseDimensionScores(raw: unknown): VR<DimensionScoresRaw> {
  if (typeof raw !== 'object' || raw === null) {
    return fail('Réponse non-objet', raw);
  }
  const obj = raw as Record<string, unknown>;
  const result: Partial<DimensionScoresRaw> = {};

  // Dimensions obligatoires
  for (const dim of DIMS_REQUIRED) {
    const val = obj[dim];
    const num = typeof val === 'number' ? val : typeof val === 'string' ? parseFloat(val) : NaN;
    if (isNaN(num)) return fail(`Dimension obligatoire "${dim}" manquante (valeur : ${JSON.stringify(val)})`, raw);
    if (num < 0 || num > 4) return fail(`Dimension "${dim}" hors plage [0-4] (valeur : ${num})`, raw);
    result[dim] = Math.round(num) as 0 | 1 | 2 | 3 | 4;
  }
  // Dimensions optionnelles — ignorees si absentes (retrocompatibilite LLM v4.4)
  for (const dim of DIMS_OPTIONAL) {
    const val = obj[dim];
    if (val === undefined || val === null) continue;
    const num = typeof val === 'number' ? val : typeof val === 'string' ? parseFloat(val) : NaN;
    if (!isNaN(num) && num >= 0 && num <= 4) result[dim] = Math.round(num) as 0 | 1 | 2 | 3 | 4;
  }

  // Champs protocole sources v4.5 (optionnels — ignorés si absents)
  // Parsing minimal : vérification de type, pas de transformation
  return ok(result as DimensionScoresRaw);
}

// ── Schéma : réponse batch IRO complète ──────────────────────────────────────

export interface BatchIRODimensionEntry {
  score: number;
  confiance: 0.2 | 0.5 | 0.8 | 1.0;
  justification: string;
}

export interface BatchIROResponse {
  startup: string;
  analyse_date: string;
  dimensions: Record<typeof DIMS[number], BatchIRODimensionEntry>;
  goodhart_patterns: string[];
  sources_utilisees: string[];
  manques_information: string[];
  note_evaluateur: string;
}

const VALID_CONFIDENCE = [0.2, 0.5, 0.8, 1.0];

export function parseBatchIROResponse(raw: unknown): VR<BatchIROResponse> {
  if (typeof raw !== 'object' || raw === null) {
    return fail('Réponse non-objet', raw);
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.startup !== 'string' || !obj.startup) {
    return fail('Champ "startup" manquant ou vide', raw);
  }

  if (typeof obj.analyse_date !== 'string') {
    return fail('Champ "analyse_date" manquant', raw);
  }

  const dims = obj.dimensions;
  if (typeof dims !== 'object' || dims === null) {
    return fail('Champ "dimensions" manquant ou non-objet', raw);
  }

  const parsedDims: Partial<Record<typeof DIMS[number], BatchIRODimensionEntry>> = {};
  for (const dim of DIMS) {
    const entry = (dims as Record<string, unknown>)[dim];
    if (typeof entry !== 'object' || entry === null) {
      return fail(`dimensions.${dim} manquant`, raw);
    }
    const e = entry as Record<string, unknown>;
    const score = typeof e.score === 'number' ? e.score : parseFloat(String(e.score));
    if (isNaN(score) || score < 0 || score > 4) {
      return fail(`dimensions.${dim}.score invalide (${e.score})`, raw);
    }
    const conf = typeof e.confiance === 'number' ? e.confiance : parseFloat(String(e.confiance));
    if (!VALID_CONFIDENCE.includes(conf)) {
      return fail(`dimensions.${dim}.confiance invalide — doit être 0.2|0.5|0.8|1.0 (reçu: ${conf})`, raw);
    }
    if (typeof e.justification !== 'string') {
      return fail(`dimensions.${dim}.justification manquante`, raw);
    }

    parsedDims[dim] = {
      score: Math.round(score) as 0 | 1 | 2 | 3 | 4,
      confiance: conf as 0.2 | 0.5 | 0.8 | 1.0,
      justification: e.justification,
    };
  }

  return ok({
    startup:            obj.startup,
    analyse_date:       obj.analyse_date,
    dimensions:         parsedDims as Record<typeof DIMS[number], BatchIRODimensionEntry>,
    goodhart_patterns:  Array.isArray(obj.goodhart_patterns) ? obj.goodhart_patterns.filter(s => typeof s === 'string') : [],
    sources_utilisees:  Array.isArray(obj.sources_utilisees) ? obj.sources_utilisees.filter(s => typeof s === 'string') : [],
    manques_information: Array.isArray(obj.manques_information) ? obj.manques_information.filter(s => typeof s === 'string') : [],
    note_evaluateur:    typeof obj.note_evaluateur === 'string' ? obj.note_evaluateur : '',
  });
}

// ── Schéma : Verdict structuré ────────────────────────────────────────────────

export interface VerdictDataRaw {
  viabilite: string;
  financement: string;
  horizon_risque_mois: number;
  red_flags?: string[];

  // ── Poids sectoriels v4.8 ───────────────────────────────────────────────────
  sector_label?: string;   // libellé libre déclaré dans le deck (ex: "Santé / Medtech")
  sector_code?:  string;   // code IRO résolu : HLTH | LLM | COMM | FINT | CYBR | INDU | RH | LEGT | EDTC | LOGI | DEFAULT

  // ── Protocole Sources v4.5 ───────────────────────────────────────────────
  // Taux de confiance global (V+C)/(V+I+NT+C) × 100
  taux_confiance_global?: number;
  // Statut du rapport : 'publishable' ≥ 70% | 'draft' 50-70% | 'blocked' < 50%
  rapport_statut?: 'publishable' | 'draft' | 'blocked';
  // Flags v4.5 détectés par le LLM — le moteur applique ensuite les malus
  flags_v45?: {
    liquidation_judiciaire?:  boolean;
    redressement_judiciaire?: boolean;
    brevet_non_verifie?:      boolean;
    data_stale?:              boolean;
    dirigeant_anonyme?:       boolean;
    contrat_retire?:          boolean;
    source_I_majeure?:        boolean;
    activite_parallele?:      boolean;
    operateur_certifie?:      boolean;
    conseil_disparu?:         boolean;
  };
  // Fraîcheur par dimension : { DI: 'F', ADC: 'S', ... }
  freshness_table?: Record<string, 'F' | 'M' | 'S' | 'ND'>;
  // Liste des assertions avec code V/I/NT/C
  assertions_sourcing?: Array<{
    dim:        string;
    assertion:  string;
    trust_code: 'V' | 'I' | 'NT' | 'C';
    source?:    string;
  }>;
  forces_cles?: string[];
  opportunites_cachees?: string[];
}

export function parseVerdictData(raw: unknown): VR<VerdictDataRaw> {
  if (typeof raw !== 'object' || raw === null) {
    return fail('Réponse verdict non-objet', raw);
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.viabilite !== 'string')    return fail('"viabilite" manquant', raw);
  if (typeof obj.financement !== 'string')  return fail('"financement" manquant', raw);

  const horizon = typeof obj.horizon_risque_mois === 'number'
    ? obj.horizon_risque_mois
    : parseInt(String(obj.horizon_risque_mois));
  if (isNaN(horizon) || horizon < 0) return fail('"horizon_risque_mois" invalide', raw);

  return ok({
    viabilite:           obj.viabilite,
    financement:         obj.financement,
    horizon_risque_mois: horizon,
    red_flags:           Array.isArray(obj.red_flags) ? obj.red_flags : [],
    forces_cles:         Array.isArray(obj.forces_cles) ? obj.forces_cles : [],
    opportunites_cachees: Array.isArray(obj.opportunites_cachees) ? obj.opportunites_cachees : [],
  });
}

// ── Utilitaire : parse + validate depuis réponse brute LLM ───────────────────

import { extractJSON } from '../utils/json-utils';

/**
 * Extrait et valide un JSON LLM en une seule opération.
 * Lève une erreur descriptive si la validation échoue.
 */
export function parseLLMResponse<T>(
  rawText: string,
  parser: (raw: unknown) => VR<T>,
  context: string = 'LLM response',
): T {
  let parsed: unknown;
  try {
    parsed = extractJSON(rawText);
  } catch (e) {
    throw new Error(`[${context}] JSON invalide dans la réponse LLM : ${e instanceof Error ? e.message : String(e)}`);
  }

  const result = parser(parsed);
  if (result.success === false) {
    throw new Error(`[${context}] Validation échouée : ${result.error}`);
  }
  return result.data;
}
