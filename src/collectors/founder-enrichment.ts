/**
 * src/collectors/founder-enrichment.ts
 * IRO Strength v6.6.2 — CORRECTIF SEC-02 + ARCH-01
 *
 * PROBLÈME SEC-02 : callGeminiSearch() appelait directement
 *   generativelanguage.googleapis.com avec la clé depuis window/VITE_*
 *   → clé visible dans les DevTools → vulnérabilité critique.
 *
 * PROBLÈME ARCH-01 : import React dans un collector métier
 *   → couplage UI/données → non testable en Node.js → non réutilisable.
 *
 * SOLUTION :
 *   - Ce fichier = logique métier PURE (types, calculs, enrichissement).
 *     Zéro import React. Testable en Node.js.
 *   - L'appel LLM passe par callLLMAndParseJSON du router
 *     (lui-même proxifié via Express /api/llm côté serveur).
 *   - Les hooks React sont dans founder-enrichment-ui.ts (fichier séparé).
 */

import { scoreGCHStructured } from './founder-scoring-rrf';

// ── Types publics ─────────────────────────────────────────────────────────────

export interface FounderProfile {
  id:                  string;
  name:                string;
  role:                string;
  linkedin_url:        string;
  linkedin_verified:   boolean;
  previous_companies:  string[];
  education:           string[];
  publications:        string[];
  patents:             number;
  track_record:        'exit' | 'scale' | 'junior' | 'unknown';
  board_roles:         string[];
  open_source:         string[];
  media_mentions:      string[];
  gch_contribution:    number;
  enriched_at:         string | null;
  source:              'manual' | 'gemini' | 'proxycurl';
  confidence:          'high' | 'medium' | 'low';
  raw_gemini_response?: string;
}

export interface GCHAnalysis {
  score:                  number;
  confidence:             number;
  rev11_triggered:        boolean;   // Fondateur unique → plafond GCH=1
  rev12_triggered:        boolean;   // Aucun background documenté
  rev13_triggered:        boolean;   // Tous juniors
  key_person_risk:        boolean;
  justification:          string;
  gch_fondateurs_context: string;
  structured?:            any;       // Résultats de la Random Rule Forest (arXiv:2505.24622)
}

// ── Calcul GCH depuis les profils (logique pure, testable) ────────────────────

export function computeGCHFromProfiles(founders: FounderProfile[], vertical?: string): GCHAnalysis {
  if (!founders.length) {
    return {
      score: 0, confidence: 0.5,
      rev11_triggered: false, rev12_triggered: true, rev13_triggered: false,
      key_person_risk: false, justification: 'Aucun fondateur documenté',
      gch_fondateurs_context: '',
    };
  }

  const rrf = scoreGCHStructured(founders, vertical);

  return {
    score: rrf.score,
    confidence: rrf.confidence,
    rev11_triggered: rrf.rev11_triggered,
    rev12_triggered: rrf.rev12_triggered,
    rev13_triggered: rrf.rev13_triggered,
    key_person_risk: rrf.features.key_person_risk,
    justification: rrf.justification,
    gch_fondateurs_context: founders
      .map(f => `${f.name}: ${f.previous_companies.join(', ') || 'Non documenté'}`)
      .join('\n'),
    structured: rrf,
  };
}

// ── Prompt builder (logique pure) ─────────────────────────────────────────────

export function buildFounderSearchPrompt(
  name: string,
  role: string,
  startupName: string,
): string {
  return `Recherche les informations professionnelles de "${name}", ${role} chez ${startupName}.

SOURCES À CONSULTER :
1. linkedin.com/in/ — profil public du fondateur
2. scholar.google.com ou arxiv.org — publications scientifiques
3. crunchbase.com/person/ — participations à d'autres startups, exits
4. github.com — contributions open source
5. Presse tech : techcrunch.com, lesechos.fr, latribune.fr

Retourne UNIQUEMENT ce JSON (aucun texte avant ou après) :
{
  "found": true,
  "linkedin_url": "",
  "linkedin_verified": false,
  "previous_companies": [],
  "education": [],
  "publications": [],
  "patents": 0,
  "track_record": "unknown",
  "board_roles": [],
  "open_source": [],
  "media_mentions": [],
  "confidence": "low"
}`;
}

// ── Enrichissement via proxy LLM (passe par /api/llm côté serveur) ────────────

export async function enrichFounderProfile(
  founder: FounderProfile,
  startupName: string,
): Promise<FounderProfile> {
  try {
    // Import dynamique pour éviter le chargement du router côté worker/test
    // Note: Dans AI Studio BUILD, les imports dynamiques fonctionnent bien.
    const { callLLMAndParseJSON } = await import('../utils/llm-router');

    const prompt = buildFounderSearchPrompt(founder.name, founder.role, startupName);
    const result = await callLLMAndParseJSON<Partial<FounderProfile>>(
      prompt,
      'Tu es un analyste startup spécialisé dans l\'évaluation des équipes fondatrices. Retourne uniquement du JSON valide.',
      { timeoutMs: 20_000, tools: [{ googleSearch: {} }] }
    );

    if (!result?.data) return founder;

    return {
      ...founder,
      ...result.data,
      id:          founder.id,        // ne jamais écraser l'ID
      source:      'gemini',
      confidence:  result.data.confidence ?? 'medium',
      enriched_at: new Date().toISOString(),
    } as FounderProfile;
  } catch (err) {
    console.error('[FounderEnrichment] Enrichment failed', err);
    return founder;
  }
}

// ── Factory pour créer un fondateur vide ──────────────────────────────────────

export function createEmptyFounder(overrides: Partial<FounderProfile> = {}): FounderProfile {
  return {
    id:                 Date.now().toString() + Math.random().toString(36).substring(2, 9),
    name:               '',
    role:               '',
    linkedin_url:       '',
    linkedin_verified:  false,
    previous_companies: [],
    education:          [],
    publications:       [],
    patents:            0,
    track_record:       'unknown',
    board_roles:        [],
    open_source:        [],
    media_mentions:     [],
    gch_contribution:   0,
    enriched_at:        null,
    source:             'manual',
    confidence:         'low',
    ...overrides,
  };
}
