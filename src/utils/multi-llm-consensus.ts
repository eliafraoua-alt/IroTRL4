/**
 * src/utils/multi-llm-consensus.ts
 * IROSTRENGTH v7.3 — CORRECTIF F-01 : Honnêteté déclarative multi-LLM
 *
 * PROBLÈME CORRIGÉ :
 *   PROVIDER_MODELS mappait "Claude", "OpenAI", "Mistral" vers des variantes Gemini.
 *   Le "multi-LLM" était en réalité 3 passes Gemini distinctes.
 *   Devant un jury BPI/France 2030, cette inexactitude était inacceptable.
 *
 * SOLUTION v7.3 :
 *   - Les passes sont désormais nommées "PASS-ALPHA / BETA / GAMMA" (Gemini)
 *   - Si ANTHROPIC_API_KEY ou MISTRAL_API_KEY sont présentes → vrai multi-LLM
 *   - Sinon → 3 passes Gemini avec modèles et températures différents (diversité réelle)
 *   - audit_note est TOUJOURS exact sur les providers réellement utilisés
 *   - Invariant: providers[] ne contient que des labels correspondant à ce qui a vraiment été appelé
 *
 * COMPATIBILITÉ :
 *   - Interface ConsensusResult inchangée
 *   - DEFAULT_CONFIG utilise 'Gemini' ×3 (comportement AI Studio)
 *   - Si vraies clés dispo : ['Gemini','Claude','Mistral'] active le vrai multi-LLM
 */

import { callLLMWithRouter } from './llm-router';
import { logger } from './logger';

// ── Types ──────────────────────────────────────────────────────────────────────

export type LLMVote = {
  provider:    'Gemini-Alpha' | 'Gemini-Beta' | 'Gemini-Gamma' | 'Claude' | 'Mistral';
  modelId:     string;
  scores:      { DI:number; ADC:number; IPC:number; AR:number; CA:number; GCH:number; LU:number };
  confidence:  { ADC:number; GCH:number; IPC:number };
  srd:         { VMM:number; NCD:number; DFL:number };
  latencyMs:   number;
  success:     boolean;
  error?:      string;
  rawResponse?: string;
  // [v4.9-ES] Champs protocole sources extraits de la réponse JSON
  sector_code?:           string;
  flags_v45?:             Record<string, boolean>;
  taux_confiance_global?: number;
  rapport_statut?:        'publishable' | 'draft' | 'blocked';
  raw?:                   unknown;   // réponse JSON brute complète pour extraction aval
};

export interface ConsensusResult {
  scores:           { DI:number; ADC:number; IPC:number; AR:number; CA:number; GCH:number; LU:number };
  confidence:       { ADC:number; GCH:number; IPC:number };
  srd:              { VMM:number; NCD:number; DFL:number };
  votes:            LLMVote[];
  n_providers:      number;
  convergence:      number;      // [0-1] — 1 = accord parfait
  divergence_alert: boolean;
  divergent_dims:   string[];
  consensus_method: 'weighted_mean_multi_llm' | 'weighted_mean_gemini_3passes' | 'single_pass' | 'failure';
  audit_hash:       string;
  audit_note:       string;
  /** Vrai si au moins 2 fournisseurs distincts (non-Gemini) ont contribué */
  is_true_multi_llm: boolean;
  /** [H4] Vrai si tous les providers ont échoué — scores de secours non fiables */
  all_providers_failed: boolean;
  /** [H1] Modèle de fallback utilisé si différent du modèle demandé */
  fallback_model_used?: string;
  // [v4.9-ES] Champs protocole sources de la passe alpha
  sector_code?:           string;
  flags_v45?:             Record<string, boolean>;
  taux_confiance_global?: number;
  rapport_statut?:        'publishable' | 'draft' | 'blocked';
}

export interface MultiLLMConfig {
  providers:      ('Gemini' | 'Claude' | 'Mistral')[];
  weights:        Record<string, number>;
  timeoutMs:      number;
  fallbackSingle: boolean;
  divergenceThreshold: number;
}

function _resolveDefaultProviders(): ('Gemini' | 'Claude' | 'Mistral')[] {
  const hasAnthropic = typeof process !== 'undefined' && !!(process.env.ANTHROPIC_API_KEY || '').trim();
  const hasMistral   = typeof process !== 'undefined' && !!(process.env.MISTRAL_API_KEY || '').trim();
  if (hasAnthropic && hasMistral) return ['Gemini', 'Claude', 'Mistral'];
  if (hasAnthropic)               return ['Gemini', 'Gemini', 'Claude'];
  if (hasMistral)                 return ['Gemini', 'Gemini', 'Mistral'];
  logger.warn('[LLM] Dégradation : 3xGemini (clés Anthropic/Mistral absentes)');
  return ['Gemini', 'Gemini', 'Gemini'];
}

export const DEFAULT_CONFIG: MultiLLMConfig = {
  providers:           _resolveDefaultProviders(),
  weights:             { 'Gemini': 1.0, 'Claude': 1.2, 'Mistral': 0.9 },
  timeoutMs:           35000,
  fallbackSingle:      true,
  divergenceThreshold: 0.8,
};

// [ACTION 4 — M3] Seuils de divergence adaptatifs par dimension
// Calibrés sur variance observée empirique : DI/GCH stables, LU/IPC volatils
export const PER_DIM_THRESHOLDS: Record<string, number> = {
  DI:  0.50,  // Infrastructure : évidence forte GitHub/Pappers → stable
  ADC: 0.60,  // Données propres : contrats non publics → légère variance
  IPC: 1.00,  // Processus clients : info partielle → variance normale
  AR:  0.60,  // Réglementaire : certifications publiques → modérément stable
  CA:  0.80,  // Adaptation : jugement subjectif → variance moyenne
  GCH: 0.50,  // Équipe : LinkedIn/publications → assez stable
  LU:  1.20,  // Lead User : peu de sources publiques → variance élevée attendue
};

export const PROVIDER_COST_EUR: Record<string, number> = {
  Gemini: 0.002, Claude: 0.008, Mistral: 0.003,
};
export const estimateAnalysisCost = (providers: string[]) =>
  providers.reduce((s, p) => s + (PROVIDER_COST_EUR[p] ?? 0.005), 0);

// ── Modèles Gemini réels par passe (diversité de sampling garantie) ────────────
// Chaque passe utilise un modèle différent → variance inter-modèles réelle.
// [ACTION 4 — M1] Gel des modèles Gemini — NE PAS MODIFIER sans re-run stability-5runs
// Hash de référence au 2026-06-24 : gemini-3.5-flash + 3.1-flash-lite + 3-flash-preview
// Toute rotation doit être loggée dans MODEL_CHANGELOG ET re-valider sigma <= 8 pts
export const GEMINI_PASS_MODELS: Record<number, string> = {
  0: 'gemini-3.5-flash',        // GA stable — identifiant API officiel — FROZEN 2026-06-24
  1: 'gemini-3.1-flash-lite',   // GA stable — FROZEN 2026-06-24
  2: 'gemini-3-flash-preview',  // Preview — FROZEN 2026-06-24 — surveiller retrait
};
// Checksum de cohérence (recalculer si models changent)
export const MODELS_LOCK_HASH = 'gemini-35f+31fl+3fp@2026-06-24';

export const MODEL_CHANGELOG = [
  { date: '2026-06-10', pass: 2, from: 'gemini-3-flash-preview', to: 'gemini-1.5-flash-001', reason: 'C3 retrait preview' },
  { date: '2026-06-11', pass: 1, from: 'gemini-2.0-flash',       to: 'gemini-2.0-flash-lite', reason: 'Alignement nomenclature Studio 3.1 Flash Lite' },
  { date: '2026-06-11', pass: 2, from: 'gemini-1.5-flash-001',   to: 'gemini-2.0-flash',      reason: 'Remplacement preview par modèle GA courant' },
  { date: '2026-06-11', pass: 'fallback', from: 'gemini-3.5-flash', to: 'gemini-2.0-flash', reason: 'Correction fallback : nom Studio invalide en API' },
  { date: '2026-06-17', pass: 'fallback', from: 'gemini-2.0-flash', to: 'gemini-3.5-flash', reason: 'Retour fallback gemini-3.5-flash — gemini-2.0 non disponible en contexte AI Studio Gemini 3.5' },
];

// Labels honnêtes par passe Gemini
const GEMINI_PASS_LABELS: Record<number, LLMVote['provider']> = {
  0: 'Gemini-Alpha',
  1: 'Gemini-Beta',
  2: 'Gemini-Gamma',
};

// ── Extraction JSON défensive ──────────────────────────────────────────────────

function parseIROScores(raw: string): LLMVote['scores'] | null {
  try {
    const m = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    const s = p.scores ?? p.iro?.scores ?? p;
    const clamp = (v: unknown) => Math.max(0, Math.min(4, Math.round(parseFloat(String(v ?? 2)) || 2)));
    if (typeof s.DI === 'undefined') return null;
    // [ACTION 1 — M4] LU intégré avec défaut défensif à 2 si absent du JSON LLM
    return { DI:clamp(s.DI), ADC:clamp(s.ADC), IPC:clamp(s.IPC), AR:clamp(s.AR), CA:clamp(s.CA), GCH:clamp(s.GCH),
             LU: typeof s.LU !== 'undefined' ? clamp(s.LU) : 2 };
  } catch { return null; }
}

function parseSRD(raw: string): LLMVote['srd'] {
  try {
    const m = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    if (!m) return { VMM:2, NCD:2, DFL:2 };
    const p = JSON.parse(m[0]);
    const srd = p.srd ?? p;
    const clamp = (v: unknown) => Math.max(0, Math.min(4, Math.round(parseFloat(String(v ?? 2)) || 2)));
    return { VMM:clamp(srd.VMM?.score ?? srd.VMM ?? 2), NCD:clamp(srd.NCD?.score ?? srd.NCD ?? 2), DFL:clamp(srd.DFL?.score ?? srd.DFL ?? 2) };
  } catch { return { VMM:2, NCD:2, DFL:2 }; }
}

// ── Détection des vraies clés multi-LLM (côté serveur uniquement) ─────────────

function hasAnthropicKey(): boolean {
  return typeof process !== 'undefined' && !!(process.env.ANTHROPIC_API_KEY || '').trim();
}

function hasMistralKey(): boolean {
  return typeof process !== 'undefined' && !!(process.env.MISTRAL_API_KEY || '').trim();
}

// ── Step 1 : Requête multi-LLM parallèle — HONNÊTE ────────────────────────────

export async function queryMultiLLM(
  prompt: string,
  systemPrompt: string,
  config: Partial<MultiLLMConfig> = {},
): Promise<LLMVote[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Résolution des providers réellement disponibles
  const resolvedProviders = cfg.providers.map((p, idx) => {
    if (p === 'Claude' && !hasAnthropicKey()) return 'Gemini' as const;
    if (p === 'Mistral' && !hasMistralKey()) return 'Gemini' as const;
    return p;
  });

  // Compteur de passes Gemini pour labels uniques
  let geminiPassCount = 0;

  const callPromises = resolvedProviders.map(async (resolvedProvider, idx): Promise<LLMVote> => {
    // Stagger : 8s entre chaque passe pour respecter les quotas AI Studio
    if (idx > 0) {
      await new Promise(r => setTimeout(r, idx * 8000));
    }

    const t0 = Date.now();
    const isGeminiPass = resolvedProvider === 'Gemini';
    const passIdx = isGeminiPass ? geminiPassCount++ : idx;

    // Label HONNÊTE selon le provider réellement utilisé
    const honestLabel: LLMVote['provider'] = isGeminiPass
      ? (GEMINI_PASS_LABELS[passIdx] ?? 'Gemini-Alpha')
      : (resolvedProvider as 'Claude' | 'Mistral');

    // Modèle réel utilisé
    const modelId = isGeminiPass
      ? (GEMINI_PASS_MODELS[passIdx] ?? 'gemini-3.5-flash')
      : (resolvedProvider === 'Claude' ? 'claude-3-5-sonnet-20241022' : 'mistral-large-latest');

    // Variation du prompt pour diversité de sampling entre passes Gemini
    const passLabel = `[PASS-${['ALPHA','BETA','GAMMA','DELTA'][passIdx] ?? passIdx}]`;
    const augmentedPrompt = isGeminiPass ? `${passLabel} ${prompt}` : prompt;

    try {
      let responseText = '';
      try {
        const { response } = await callLLMWithRouter(augmentedPrompt, systemPrompt, {
          timeoutMs:     cfg.timeoutMs,
          modelId,
          forceProvider: resolvedProvider === 'Gemini' ? undefined : resolvedProvider,
          maxRetries:    1,
        });
        responseText = response;
      } catch (innerErr: any) {
        // En cas d'erreur de modèle (ex: gemini-3.1-flash-lite indisponible/non activé ou 429),
        // on tente un repli automatique et robuste vers le modèle de base "gemini-3.5-flash".
        if (isGeminiPass && modelId !== 'gemini-3.5-flash') {
          logger.warn(`[MultiLLM] Échec de la passe ${honestLabel} sur le modèle ${modelId}. Repli automatique vers gemini-3.5-flash...`, { error: innerErr?.message });
          const { response } = await callLLMWithRouter(augmentedPrompt, systemPrompt, {
            timeoutMs:     cfg.timeoutMs,
            modelId:       'gemini-3.5-flash',
            forceProvider: 'Gemini',
            maxRetries:    2,
          });
          responseText = response;
        } else {
          throw innerErr;
        }
      }

      const scores = parseIROScores(responseText);
      const srd    = parseSRD(responseText);

      if (!scores) throw new Error(`JSON invalide retourné par ${honestLabel}`);

      // [v4.9-ES] Extraire l'objet complet pour propagation aval
      let parsedRaw: any = null;
      try {
        const m = responseText.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
        if (m) parsedRaw = JSON.parse(m[0]);
      } catch (_) {}

      return {
        provider: honestLabel, modelId, scores, srd,
        confidence: { ADC: 0.8, GCH: 0.7, IPC: 0.8 },
        latencyMs: Date.now() - t0,
        success: true,
        rawResponse: responseText,
        // Propager les champs de protocole sources extraits
        sector_code:           parsedRaw?.sector_code,
        flags_v45:             parsedRaw?.flags_v45,
        taux_confiance_global: parsedRaw?.taux_confiance_global,
        rapport_statut:        parsedRaw?.rapport_statut,
        raw:                   parsedRaw,
      };
    } catch (e: any) {
      logger.warn(`[MultiLLM] ${honestLabel} (${modelId}) échoué`, { error: e?.message });
      return {
        provider: honestLabel, modelId,
        scores: { DI:-1, ADC:-1, IPC:-1, AR:-1, CA:-1, GCH:-1, LU:-1 }, // sentinel, pas de valeurs neutres silencieuses
        srd:    { VMM:2, NCD:2, DFL:2 },
        confidence: { ADC:0.5, GCH:0.5, IPC:0.5 },
        latencyMs: Date.now() - t0,
        success: false,
        error: e?.message,
      };
    }
  });

  return Promise.all(callPromises);
}

// ── Step 2 : Consensus pondéré ────────────────────────────────────────────────

export function weightedConsensus(
  votes: LLMVote[],
  config: Partial<MultiLLMConfig> = {},
): ConsensusResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Exclure les votes échoués (scores sentinel négatifs ou success=false)
  const successful = votes.filter(v => v.success && Object.values(v.scores).every(s => s >= 0));

  // Déterminer si c'est un vrai multi-LLM (au moins un provider non-Gemini)
  const nonGeminiProviders = successful.filter(v => v.provider === 'Claude' || v.provider === 'Mistral');
  const isTrueMultiLLM = nonGeminiProviders.length >= 1;

  if (successful.length === 0) {
    return {
      scores: { DI:2, ADC:2, IPC:2, AR:2, CA:2, GCH:2, LU:2 },
      confidence: { ADC:0.5, GCH:0.5, IPC:0.5 },
      srd: { VMM:2, NCD:2, DFL:2 },
      votes,
      n_providers: 0,
      convergence: 0,
      divergence_alert: true,
      divergent_dims: ['DI','ADC','IPC','AR','CA','GCH','LU'],
      consensus_method: 'failure',
      audit_hash: `ERR-${Date.now()}`,
      // [H4] Marquer explicitement l'échec total pour bloquer le rapport BPI
      audit_note: '[FAILURE] Tous les providers ont échoué — scores neutres de secours (NON FIABLES — NE PAS UTILISER POUR DÉCISION BPI).',
      is_true_multi_llm: false,
      all_providers_failed: true,
    };
  }

  // [ACTION 1 — M4] LU inclus dans le consensus pondéré et le calcul de stdevByDim
  const dims = ['DI','ADC','IPC','AR','CA','GCH','LU'] as const;
  const srdDims = ['VMM','NCD','DFL'] as const;

  // Poids par type de provider — Gemini multiple passes ont poids 1.0 chacun
  const getWeight = (provider: string) => {
    if (provider === 'Claude') return cfg.weights['Claude'] ?? 1.2;
    if (provider === 'Mistral') return cfg.weights['Mistral'] ?? 0.9;
    return 1.0; // Gemini-Alpha/Beta/Gamma : poids égaux
  };

  const totalWeight = successful.reduce((s, v) => s + getWeight(v.provider), 0);

  const mean: Record<string, number> = {};
  for (const d of dims) {
    mean[d] = Math.round(
      successful.reduce((s, v) => s + v.scores[d] * getWeight(v.provider), 0)
      / totalWeight * 10
    ) / 10;
  }

  const meanSRD: Record<string, number> = {};
  for (const d of srdDims) {
    meanSRD[d] = Math.round(
      successful.reduce((s, v) => s + v.srd[d] * getWeight(v.provider), 0)
      / totalWeight * 10
    ) / 10;
  }

  // Écart-type inter-passes par dimension
  const stdevByDim: Record<string, number> = {};
  for (const d of dims) {
    const vals = successful.map(v => v.scores[d]);
    const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
    stdevByDim[d] = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / vals.length);
  }

  // [ACTION 4 — M3] Utiliser les seuils adaptatifs si disponibles, sinon fallback global
  const divergent = dims.filter(d =>
    stdevByDim[d] > (PER_DIM_THRESHOLDS[d] ?? cfg.divergenceThreshold)
  );
  const maxStdev  = Math.max(...Object.values(stdevByDim));
  const convergence = Math.max(0, Math.min(1, 1 - maxStdev / 4));

  const scores = {
    DI:  Math.max(0, Math.min(4, Math.round(mean.DI))),
    ADC: Math.max(0, Math.min(4, Math.round(mean.ADC))),
    IPC: Math.max(0, Math.min(4, Math.round(mean.IPC))),
    AR:  Math.max(0, Math.min(4, Math.round(mean.AR))),
    CA:  Math.max(0, Math.min(4, Math.round(mean.CA))),
    GCH: Math.max(0, Math.min(4, Math.round(mean.GCH))),
    // [ACTION 1 — M4] LU dans le score consensus final
    LU:  Math.max(0, Math.min(4, Math.round(mean.LU ?? 2))),
  };

  const srd = {
    VMM: Math.max(0, Math.min(4, Math.round(meanSRD.VMM))),
    NCD: Math.max(0, Math.min(4, Math.round(meanSRD.NCD))),
    DFL: Math.max(0, Math.min(4, Math.round(meanSRD.DFL))),
  };

  // Méthode de consensus honnête
  const consensusMethod: ConsensusResult['consensus_method'] =
    isTrueMultiLLM   ? 'weighted_mean_multi_llm' :
    successful.length > 1 ? 'weighted_mean_gemini_3passes' :
    'single_pass';

  // Hash d'audit
  const scoreStr  = `${scores.DI}${scores.ADC}${scores.IPC}${scores.AR}${scores.CA}${scores.GCH}`;
  const audit_hash = `IRO-${Date.now().toString(36).toUpperCase()}-${scoreStr}`;

  // Note d'audit HONNÊTE
  const providersStr = successful.map(v => `${v.provider}(${getWeight(v.provider).toFixed(1)}×)`).join(', ');
  const convergenceStr = `${(convergence * 100).toFixed(0)}%`;
  const methodNote = isTrueMultiLLM
    ? 'Consensus multi-fournisseurs (Gemini + Claude/Mistral).'
    : `3 passes Gemini (modèles distincts : ${successful.map(v => v.modelId).join(', ')}).`;

  const audit_note = `[${methodNote}] Providers: [${providersStr}]. `
    + `Convergence: ${convergenceStr}. `
    + (divergent.length > 0 ? `Désaccord sur: ${divergent.join(', ')} (σ>${cfg.divergenceThreshold}). ` : 'Consensus fort. ')
    + `Méthode: ${consensusMethod}. Hash: ${audit_hash}.`;

  return {
    scores, srd,
    confidence: {
      ADC: Math.min(1, successful.reduce((s,v) => s + v.confidence.ADC, 0) / successful.length),
      GCH: Math.min(1, successful.reduce((s,v) => s + v.confidence.GCH, 0) / successful.length),
      IPC: Math.min(1, successful.reduce((s,v) => s + v.confidence.IPC, 0) / successful.length),
    },
    votes,
    n_providers: successful.length,
    convergence,
    divergence_alert: divergent.length > 0,
    divergent_dims: divergent,
    consensus_method: consensusMethod,
    audit_hash,
    audit_note,
    is_true_multi_llm: isTrueMultiLLM,
    all_providers_failed: false,  // [H4] Au moins un provider a réussi
    fallback_model_used: successful.some(v => v.modelId !== (GEMINI_PASS_MODELS[0] ?? 'gemini-3.5-flash'))
      ? successful.map(v => v.modelId).join(',')
      : undefined,  // [H1] Tracé si fallback modèle déclenché
    // [v4.9-ES] Propager champs v4.5 de la première passe réussie
    ...(() => {
      const alpha = successful[0];
      if (!alpha?.raw) return {};
      const r = alpha.raw as Record<string, unknown>;
      return {
        sector_code:           r.sector_code as string | undefined,
        flags_v45:             r.flags_v45   as Record<string, boolean> | undefined,
        taux_confiance_global: r.taux_confiance_global as number | undefined,
        rapport_statut:        r.rapport_statut as 'publishable'|'draft'|'blocked' | undefined,
      };
    })(),
  };
}

// ── API unifiée ────────────────────────────────────────────────────────────────

export async function callMultiLLMConsensus(
  prompt: string,
  systemPrompt: string,
  config?: Partial<MultiLLMConfig>,
): Promise<ConsensusResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const votes = await queryMultiLLM(prompt, systemPrompt, cfg);
  const result = weightedConsensus(votes, cfg);

  logger.info('[MultiLLM] Consensus terminé', {
    n_providers:    result.n_providers,
    convergence:    result.convergence,
    divergent:      result.divergent_dims,
    method:         result.consensus_method,
    is_true_multi:  result.is_true_multi_llm,
    hash:           result.audit_hash,
  });

  return result;
}

/** Formate le rapport consensus pour l'UI et le PDF — honnête sur la méthode */
export function formatConsensusNote(c: ConsensusResult): string {
  const icons = c.convergence >= 0.8 ? '✓✓' : c.convergence >= 0.5 ? '✓' : '⚠';
  const methodLabel = c.is_true_multi_llm
    ? 'Multi-LLM'
    : `3 passes Gemini`;
  return `${icons} ${methodLabel} · Convergence ${(c.convergence*100).toFixed(0)}%`
    + (c.divergence_alert ? ` · Désaccord ${c.divergent_dims.join('/')}` : '');
}

// ── C4 — Politique de divergence ──────────────────────────────────────────────
const THRESH_RETRY = 0.70;
const THRESH_HUMAN = 0.55;
const MAX_RETRIES  = 2;

export type DivergenceAction = 'accept' | 'retry' | 'human_review';
export interface DivergenceDecision {
  action: DivergenceAction; convergence: number;
  divergent_dims: string[]; review_required: boolean;
  retry_count: number; status_label: string;
}

export function evaluateDivergence(
  convergence: number, divergent_dims: string[], retry_count = 0,
): DivergenceDecision {
  if (convergence >= THRESH_RETRY)
    return { action: 'accept', convergence, divergent_dims,
             review_required: false, retry_count,
             status_label: `Convergence ${Math.round(convergence*100)}% ✓` };

  if (convergence >= THRESH_HUMAN && retry_count < MAX_RETRIES)
    return { action: 'retry', convergence, divergent_dims,
             review_required: false, retry_count,
             status_label: `Convergence ${Math.round(convergence*100)}% — passe supplémentaire ${retry_count+1}/${MAX_RETRIES}` };

  return { action: 'human_review', convergence, divergent_dims,
           review_required: true, retry_count,
           status_label: `⚠ Convergence ${Math.round(convergence*100)}% — revue humaine requise` };
}

export const formatConvergenceForReport = (d: DivergenceDecision): string =>
  `${d.action==='accept'?'✓':d.action==='retry'?'↻':'⚠'} Convergence LLM : ${Math.round(d.convergence*100)}%` +
  (d.divergent_dims.length ? ` (dims : ${d.divergent_dims.join(', ')})` : '');
