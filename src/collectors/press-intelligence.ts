/**
 * src/collectors/press-intelligence.ts
 * IRO Strength v8.0 — Module Presse Intelligence (lecture exhaustive + NLP multi-passes)
 *
 * Objectif : remplacer la revue de presse superficielle de queryPresseTech()
 * (web-intelligence.ts — 1 appel LLM, 2-3 "faits saillants") par un vrai pipeline
 * d'extraction presse exhaustive, testable, et intégré au scoring IRO comme
 * les sources grises (grey-sources.ts).
 *
 * Pipeline (4 phases) :
 *
 *  PHASE A — Découverte multi-source (parallèle, Promise.allSettled) :
 *    1. fetchGDELTRaw()      — GDELT DOC 2.0 API (gratuit, sans clé, couverture mondiale)
 *    2. fetchNewsAPIRaw()    — NewsAPI.org (clé optionnelle NEWSAPI_KEY, complément FR/EN)
 *    3. fetchGeminiPressDiscovery() — Gemini + Google Search grounding, prompt
 *       explicitement "exhaustif" (15-40 articles visés, pas 2-3 highlights)
 *
 *  PHASE B — Dédoublonnage : dedupeArticles() fusionne par URL ou par
 *    (titre normalisé + domaine) — logique pure, testable sans réseau.
 *
 *  PHASE C — Annotation NLP par lots (LLM, sans grounding — analyse du texte déjà
 *    collecté) : annotateArticlesBatch() extrait par article : sentiment, thèmes,
 *    entités (personnes/organisations/montants/technologies), fait marquant,
 *    crédibilité de la source. Lots de BATCH_SIZE pour maîtriser le quota
 *    (cf. commentaire llm-router.ts sur le seuil 15 req/min AI Studio).
 *
 *  PHASE D — Synthèse (logique pure, déterministe, testable) :
 *    buildTimeline(), computeSentimentDistribution(), computeIROHintsFromPress(),
 *    detectPressFlags() — et, si un pitch fondateur est fourni,
 *    detectPressContradictions() (1 appel LLM comparant faits de presse vs pitch).
 *
 * Architecture de sécurité (cf. .env.example) :
 *   Côté serveur (scripts batch, pipeline-orchestrator) : appels directs GDELT/NewsAPI.
 *   Côté client (hook React) : proxy Express /api/press/search/:name — la clé
 *   NEWSAPI_KEY ne transite JAMAIS vers le bundle JavaScript (même pattern que
 *   fetchPappersData() dans crunchbase.ts).
 *
 * Mapping IRO :
 *   partenariats/clients cités en presse → IPC · brevets/tech propriétaire → DI
 *   certifications/conformité citées     → AR  · pivots/résilience documentés → CA
 *   recrutements clés, profils fondateurs → GCH · montants/traction chiffrés  → ADC
 */

import { callLLMAndParseJSON } from '../utils/llm-router';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Article brut tel que retourné par une source de découverte, avant annotation NLP. */
export interface RawPressArticle {
  title:      string;
  url:        string;
  domain:     string;
  /** Date ISO (AAAA-MM-JJ) si connue, sinon null. */
  date:       string | null;
  snippet:    string | null;
  source_api: 'gdelt' | 'newsapi' | 'gemini_search';
  language:   string | null;
}

/** Article annoté par le pipeline NLP (phase C). */
export interface PressArticleAnnotation {
  title:   string;
  url:     string;
  domain:  string;
  date:    string | null;
  sentiment: 'positif' | 'neutre' | 'négatif' | 'mixte';
  /** Jusqu'à 3 thèmes (ex: "levée de fonds", "partenariat", "recrutement"). */
  themes:  string[];
  entites: {
    personnes:     string[];
    organisations: string[];
    montants:      string[];
    technologies:  string[];
  };
  /** 1 phrase factuelle résumant l'article, ou null si non exploitable. */
  fait_marquant: string | null;
  credibilite_source: 'haute' | 'moyenne' | 'faible';
  /** URL de l'article dont celui-ci est un doublon détecté tardivement, sinon null. */
  doublon_de: string | null;
}

/** Événement chronologique construit depuis les articles annotés (logique pure). */
export interface PressTimelineEvent {
  /** Période au format AAAA-MM. */
  periode:   string;
  evenement: string;
  sources:   string[];
  type: 'financement' | 'produit' | 'partenariat' | 'recrutement' | 'reglementaire' | 'crise' | 'autre';
}

/** Contradiction factuelle détectée entre le pitch fondateur et la presse indépendante. */
export interface PressContradiction {
  claim_pitch:     string;
  realite_presse:  string;
  severite:        'mineure' | 'majeure' | 'bloquante';
  sources:         string[];
}

/** Résultat agrégé du pipeline presse — analogue à GreySourcesResult. */
export interface PressIntelligenceResult {
  articles_bruts_count:    number;
  articles_retenus_count:  number;
  articles:                PressArticleAnnotation[];
  timeline:                PressTimelineEvent[];
  contradictions:          PressContradiction[];
  sentiment_global:        'positif' | 'neutre' | 'négatif' | 'mixte';
  sentiment_distribution:  { positif: number; neutre: number; négatif: number; mixte: number };
  silence_presse:          boolean;
  /** Date ISO de la dernière mention presse trouvée, ou null. */
  derniere_mention:        string | null;
  themes_dominants:        string[];
  iro_hints_presse: {
    di_hint:  number;
    ipc_hint: number;
    ar_hint:  number;
    ca_hint:  number;
    gch_hint: number;
    adc_hint: number;
  };
  flags_detected: {
    crise_reputationnelle:      boolean;
    contradiction_pitch_presse: boolean;
    silence_presse_prolonge:    boolean;
    couverture_presse_forte:    boolean;
  };
  sources_used: string[];
  confidence:   'high' | 'medium' | 'low';
  fetched_at:   string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

/** Nombre max d'articles envoyés à l'annotation NLP — maîtrise du quota LLM. */
const MAX_ARTICLES_ANNOTATED = 30;
/** Taille de lot par appel d'annotation (10 articles ≈ 1 appel LLM raisonnable). */
const BATCH_SIZE = 10;

const DOMAINES_HAUTE_CREDIBILITE = new Set([
  'techcrunch.com', 'venturebeat.com', 'wired.com', 'technologyreview.com', 'ft.com',
  'sifted.eu', 'theinformation.com', 'lesechos.fr', 'latribune.fr', 'lemonde.fr',
  'usine-digitale.fr', 'usinenouvelle.com', 'capital.fr', 'bfmtv.com', 'reuters.com',
  'bloomberg.com',
]);
const DOMAINES_MOYENNE_CREDIBILITE = new Set([
  'maddyness.com', 'frenchweb.fr', 'journaldunet.com', 'lafrenchtech.com', 'forbes.fr',
]);

const THEME_TO_TYPE: Record<string, PressTimelineEvent['type']> = {
  'levée de fonds': 'financement', 'financement': 'financement', 'levee de fonds': 'financement',
  'partenariat': 'partenariat', 'client': 'partenariat', 'contrat': 'partenariat',
  'recrutement': 'recrutement', 'embauche': 'recrutement', 'nomination': 'recrutement',
  'produit': 'produit', 'lancement': 'produit', 'fonctionnalité': 'produit',
  'reglementaire': 'reglementaire', 'réglementaire': 'reglementaire', 'conformité': 'reglementaire', 'certification': 'reglementaire',
  'crise': 'crise', 'litige': 'crise', 'licenciement': 'crise', 'scandale': 'crise', 'plainte': 'crise',
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE A — DÉCOUVERTE MULTI-SOURCE
// ═══════════════════════════════════════════════════════════════════════════════

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Convertit une date GDELT "20240115T120000Z" en ISO "2024-01-15". */
function parseGdeltDate(seendate?: string): string | null {
  if (!seendate || seendate.length < 8) return null;
  const y = seendate.slice(0, 4), m = seendate.slice(4, 6), d = seendate.slice(6, 8);
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return null;
  return `${y}-${m}-${d}`;
}

/**
 * GDELT DOC 2.0 API — gratuit, sans clé, couverture mondiale multilingue.
 * https://api.gdeltproject.org/api/v2/doc/doc
 */
export async function fetchGDELTRaw(name: string, sinceMonths = 18): Promise<RawPressArticle[]> {
  const timespan = `${Math.min(Math.max(sinceMonths, 1), 36)}m`;
  const query = encodeURIComponent(`"${name}"`);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=75&format=json&sort=datedesc&timespan=${timespan}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json() as { articles?: any[] };
    if (!Array.isArray(data.articles)) return [];
    return data.articles
      .filter(a => a?.url && a?.title)
      .map(a => ({
        title:      String(a.title),
        url:        String(a.url),
        domain:     a.domain ? String(a.domain) : extractDomain(String(a.url)),
        date:       parseGdeltDate(a.seendate),
        snippet:    null,
        source_api: 'gdelt' as const,
        language:   a.language ? String(a.language) : null,
      }));
  } catch (err) {
    logger.warn('[PressIntel] GDELT indisponible (non bloquant)', { error: String(err) });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * NewsAPI.org — complément presse FR/EN, clé optionnelle NEWSAPI_KEY.
 * Note : le plan gratuit NewsAPI limite l'historique à ~1 mois et interdit
 * l'usage direct navigateur (ToS) — d'où l'appel exclusivement server-side.
 */
export async function fetchNewsAPIRaw(name: string, sinceMonths = 18): Promise<RawPressArticle[]> {
  const apiKey = (process.env.NEWSAPI_KEY || '').trim();
  if (!apiKey) return [];

  const from = new Date();
  from.setMonth(from.getMonth() - Math.min(sinceMonths, 12));

  const params = new URLSearchParams({
    q:        `"${name}"`,
    language: 'fr',
    sortBy:   'publishedAt',
    pageSize: '50',
    from:     from.toISOString().slice(0, 10),
    apiKey,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json() as { articles?: any[] };
    if (!Array.isArray(data.articles)) return [];
    return data.articles
      .filter(a => a?.url && a?.title)
      .map(a => ({
        title:      String(a.title),
        url:        String(a.url),
        domain:     a.source?.name ? String(a.source.name) : extractDomain(String(a.url)),
        date:       a.publishedAt ? String(a.publishedAt).slice(0, 10) : null,
        snippet:    a.description ? String(a.description) : null,
        source_api: 'newsapi' as const,
        language:   'fr',
      }));
  } catch (err) {
    logger.warn('[PressIntel] NewsAPI indisponible (non bloquant)', { error: String(err) });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dual-mode client/serveur — même pattern que fetchPappersData() dans crunchbase.ts.
 * Serveur (scripts batch, tsx) : appels directs GDELT + NewsAPI.
 * Client (navigateur)          : proxy Express /api/press/search — la clé
 * NEWSAPI_KEY ne quitte jamais process.env côté serveur.
 */
async function fetchRawArticlesViaAPIs(name: string, sinceMonths: number): Promise<RawPressArticle[]> {
  const isServer = typeof window === 'undefined' && typeof process !== 'undefined';

  if (isServer) {
    const [gdelt, newsapi] = await Promise.all([
      fetchGDELTRaw(name, sinceMonths),
      fetchNewsAPIRaw(name, sinceMonths),
    ]);
    return [...gdelt, ...newsapi];
  }

  try {
    const res = await fetch(`/api/press/search/${encodeURIComponent(name)}?months=${sinceMonths}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.articles) ? data.articles : [];
  } catch (err) {
    logger.warn('[PressIntel] Proxy /api/press/search indisponible (non bloquant)', { error: String(err) });
    return [];
  }
}

/**
 * Découverte exhaustive via Gemini + Google Search grounding.
 * Contrairement à queryPresseTech() (web-intelligence.ts, 2-3 highlights),
 * ce prompt demande explicitement une LISTE d'articles distincts (15-40 visés)
 * pour compléter la couverture GDELT/NewsAPI (presse FR spécialisée notamment).
 */
export async function fetchGeminiPressDiscovery(name: string): Promise<RawPressArticle[]> {
  try {
    const prompt = `Effectue une revue de presse EXHAUSTIVE (pas un résumé de 2-3 faits) sur l'entreprise "${name}".

Interroge largement, sur les 36 derniers mois si possible :
— Presse tech mondiale : TechCrunch, VentureBeat, Wired, MIT Technology Review, The Information, Sifted
— Presse économique FR : Les Echos, La Tribune, Capital, Le Monde, BFM Business
— Presse tech FR      : Maddyness, Frenchweb, Journal du Net, L'Usine Digitale, L'Usine Nouvelle
— Communiqués officiels, blog de l'entreprise, French Tech

Liste TOUS les articles distincts trouvés (vise 15 à 40 entrées si la couverture presse le permet).
RÈGLE ANTI-HALLUCINATION : n'invente aucun article, aucune URL, aucune date. Si tu ne trouves qu'un
faible nombre d'articles réels, retourne uniquement ceux-là — jamais de remplissage fictif pour
atteindre un quota.

Retourne UNIQUEMENT ce JSON :
{
  "articles": [
    { "title": "titre exact de l'article", "url": "URL réelle si trouvée sinon null", "domain": "nom du média", "date": "AAAA-MM-JJ ou AAAA-MM ou null", "snippet": "1 phrase factuelle résumant l'article" }
  ]
}`;

    const result = await callLLMAndParseJSON<{ articles?: any[] }>(
      prompt,
      'Tu es un veilleur presse rigoureux. Ne fabrique jamais un article, une URL ou une date. JSON strict uniquement.',
      { timeoutMs: 25_000, modelId: 'gemini-3-flash-preview', tools: [{ googleSearch: {} }] }
    );

    const raw = result?.data?.articles;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(a => a && a.title)
      .map(a => ({
        title:      String(a.title),
        url:        a.url ? String(a.url) : '',
        domain:     a.domain ? String(a.domain) : extractDomain(a.url ? String(a.url) : ''),
        date:       a.date ? String(a.date).slice(0, 10) : null,
        snippet:    a.snippet ? String(a.snippet) : null,
        source_api: 'gemini_search' as const,
        language:   null,
      }));
  } catch (err) {
    logger.warn('[PressIntel] Découverte Gemini échouée (non bloquant)', { error: String(err) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE B — DÉDOUBLONNAGE (logique pure, testable sans réseau)
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fusionne les articles bruts issus de plusieurs sources (GDELT/NewsAPI/Gemini).
 * Clé de dédoublonnage : URL exacte si disponible, sinon (titre normalisé + domaine).
 * Enrichit la date si une source la fournit et qu'une autre non.
 */
export function dedupeArticles(articles: RawPressArticle[]): RawPressArticle[] {
  const seen = new Map<string, RawPressArticle>();
  for (const a of articles) {
    if (!a.title) continue;
    const key = a.url && a.url.length > 0
      ? a.url.replace(/\/+$/, '').toLowerCase()
      : `${normalizeTitle(a.title)}::${(a.domain || '').toLowerCase()}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, a);
    } else if (!existing.date && a.date) {
      seen.set(key, { ...existing, date: a.date });
    } else if (!existing.snippet && a.snippet) {
      seen.set(key, { ...existing, snippet: a.snippet });
    }
  }
  return Array.from(seen.values());
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE C — ANNOTATION NLP PAR LOTS
// ═══════════════════════════════════════════════════════════════════════════════

function credibiliteDomaine(domain: string): 'haute' | 'moyenne' | 'faible' {
  const d = (domain || '').toLowerCase().replace(/^www\./, '');
  if (DOMAINES_HAUTE_CREDIBILITE.has(d)) return 'haute';
  if (DOMAINES_MOYENNE_CREDIBILITE.has(d)) return 'moyenne';
  return 'faible';
}

function defaultAnnotation(a: RawPressArticle): PressArticleAnnotation {
  return {
    title: a.title, url: a.url, domain: a.domain, date: a.date,
    sentiment: 'neutre',
    themes: [],
    entites: { personnes: [], organisations: [], montants: [], technologies: [] },
    fait_marquant: a.snippet,
    credibilite_source: credibiliteDomaine(a.domain),
    doublon_de: null,
  };
}

/**
 * Annote un lot d'articles via un unique appel LLM (analyse du texte déjà
 * collecté — pas de grounding Google Search ici, pour économiser le quota).
 * RÈGLE ANTI-HALLUCINATION : extraction strictement bornée au titre/résumé fourni.
 */
export async function annotateArticlesBatch(
  batch: RawPressArticle[],
  startupName: string,
): Promise<PressArticleAnnotation[]> {
  if (batch.length === 0) return [];

  try {
    const articlesJson = batch.map((a, i) => ({
      idx: i, title: a.title, domain: a.domain, date: a.date, snippet: a.snippet,
    }));

    const prompt = `Analyse chacun des ${batch.length} articles de presse suivants concernant l'entreprise "${startupName}".
Pour chaque article, extrait UNIQUEMENT ce qui est explicitement présent dans le titre/résumé fourni —
n'invente rien au-delà, ne complète pas avec des connaissances externes non vérifiées.

ARTICLES :
${JSON.stringify(articlesJson, null, 2)}

Retourne UNIQUEMENT ce JSON (un objet par index d'article, même ordre) :
{
  "annotations": [
    {
      "idx": 0,
      "sentiment": "positif|neutre|négatif|mixte",
      "themes": ["max 3 parmi: levée de fonds, partenariat, recrutement, produit, reglementaire, crise, autre"],
      "entites": { "personnes": [], "organisations": [], "montants": [], "technologies": [] },
      "fait_marquant": "1 phrase factuelle ou null si l'article ne contient pas assez d'info"
    }
  ]
}`;

    const result = await callLLMAndParseJSON<{ annotations?: any[] }>(
      prompt,
      'Tu es un analyste NLP presse. Extraction strictement factuelle depuis le texte fourni. JSON strict uniquement.',
      { timeoutMs: 25_000, modelId: 'gemini-3-flash-preview' }
    );

    const anns = result?.data?.annotations;
    if (!Array.isArray(anns)) return batch.map(defaultAnnotation);

    return batch.map((a, i) => {
      const ann = anns.find(x => x && typeof x.idx === 'number' && x.idx === i) ?? anns[i];
      if (!ann) return defaultAnnotation(a);
      const sentiment = ['positif', 'neutre', 'négatif', 'mixte'].includes(ann.sentiment) ? ann.sentiment : 'neutre';
      return {
        title: a.title, url: a.url, domain: a.domain, date: a.date,
        sentiment,
        themes: Array.isArray(ann.themes) ? ann.themes.slice(0, 3).map(String) : [],
        entites: {
          personnes:     Array.isArray(ann.entites?.personnes)     ? ann.entites.personnes.map(String)     : [],
          organisations: Array.isArray(ann.entites?.organisations) ? ann.entites.organisations.map(String) : [],
          montants:      Array.isArray(ann.entites?.montants)      ? ann.entites.montants.map(String)      : [],
          technologies:  Array.isArray(ann.entites?.technologies)  ? ann.entites.technologies.map(String)  : [],
        },
        fait_marquant: ann.fait_marquant ? String(ann.fait_marquant) : (a.snippet ?? null),
        credibilite_source: credibiliteDomaine(a.domain),
        doublon_de: null,
      };
    });
  } catch (err) {
    logger.warn('[PressIntel] Annotation batch échouée (fallback dégradé)', { error: String(err) });
    return batch.map(defaultAnnotation);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE D — SYNTHÈSE (logique pure, déterministe, testable sans réseau)
// ═══════════════════════════════════════════════════════════════════════════════

function inferEventType(themes: string[]): PressTimelineEvent['type'] {
  for (const t of themes) {
    const key = t.toLowerCase();
    for (const [k, v] of Object.entries(THEME_TO_TYPE)) {
      if (key.includes(k)) return v;
    }
  }
  return 'autre';
}

/** Construit une timeline chronologique (groupée par mois) depuis les articles annotés. */
export function buildTimeline(annotated: PressArticleAnnotation[]): PressTimelineEvent[] {
  const withDate = annotated.filter(a => a.date && a.fait_marquant);
  const byPeriod = new Map<string, PressArticleAnnotation[]>();

  for (const a of withDate) {
    const periode = (a.date as string).slice(0, 7);
    if (!byPeriod.has(periode)) byPeriod.set(periode, []);
    byPeriod.get(periode)!.push(a);
  }

  const timeline: PressTimelineEvent[] = [];
  for (const [periode, arts] of Array.from(byPeriod.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const a of arts.slice(0, 3)) {
      timeline.push({
        periode,
        evenement: a.fait_marquant as string,
        sources: a.url ? [a.url] : [],
        type: inferEventType(a.themes),
      });
    }
  }
  return timeline;
}

export function computeSentimentDistribution(
  annotated: PressArticleAnnotation[]
): PressIntelligenceResult['sentiment_distribution'] {
  const dist = { positif: 0, neutre: 0, négatif: 0, mixte: 0 };
  for (const a of annotated) dist[a.sentiment]++;
  return dist;
}

export function computeGlobalSentiment(
  dist: PressIntelligenceResult['sentiment_distribution']
): PressIntelligenceResult['sentiment_global'] {
  const total = dist.positif + dist.neutre + dist.négatif + dist.mixte;
  if (total === 0) return 'neutre';
  if (dist.négatif / total >= 0.4) return dist.positif / total >= 0.25 ? 'mixte' : 'négatif';
  if (dist.positif / total >= 0.5) return 'positif';
  if (dist.mixte / total >= 0.3) return 'mixte';
  return 'neutre';
}

function clamp04(n: number): number { return Math.max(0, Math.min(4, Math.round(n))); }

/** Mappe les signaux presse agrégés vers les 6 hints IRO — logique pure, testable. */
export function computeIROHintsFromPress(
  annotated: PressArticleAnnotation[],
  timeline: PressTimelineEvent[],
): PressIntelligenceResult['iro_hints_presse'] {
  if (annotated.length === 0) {
    return { di_hint: 1, ipc_hint: 1, ar_hint: 1, ca_hint: 1, gch_hint: 1, adc_hint: 1 };
  }

  const has = (kw: string) => annotated.some(a =>
    a.themes.some(t => t.toLowerCase().includes(kw)) ||
    (a.fait_marquant ?? '').toLowerCase().includes(kw)
  );

  const nbPartenariats   = timeline.filter(t => t.type === 'partenariat').length;
  const nbFinancement    = timeline.filter(t => t.type === 'financement').length;
  const nbReglementaire  = timeline.filter(t => t.type === 'reglementaire').length;
  const nbCrise          = timeline.filter(t => t.type === 'crise').length;
  const nbProduit        = timeline.filter(t => t.type === 'produit').length;

  const di_hint  = clamp04(1 + (has('brevet') || has('propriétaire') || has('modèle maison') ? 2 : 0) + (has('technologie') ? 1 : 0));
  const ipc_hint = clamp04(1 + Math.min(nbPartenariats, 2) + (nbPartenariats >= 3 ? 1 : 0));
  const ar_hint  = clamp04(1 + Math.min(nbReglementaire, 2) + (has('certifi') || has('agrément') ? 1 : 0));
  const ca_hint = clamp04(1 + (nbCrise > 0 && nbFinancement > 0 ? 1 : 0) + (nbProduit >= 2 ? 1 : 0) - (nbCrise >= 2 ? 1 : 0));
  const gch_hint = clamp04(1 + (has('recrutement') || has('embauche') ? 1 : 0) + (annotated.some(a => a.entites.personnes.length > 0) ? 1 : 0));
  const adc_hint = clamp04(1 + (annotated.some(a => a.entites.montants.length > 0) ? 1 : 0) + (nbFinancement >= 2 ? 1 : 0));

  return { di_hint, ipc_hint, ar_hint, ca_hint, gch_hint, adc_hint };
}

function moisDepuisDate(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 999;
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

/** Détecte les flags critiques presse — logique pure, testable. */
export function detectPressFlags(
  annotated: PressArticleAnnotation[],
  timeline: PressTimelineEvent[],
  sentimentDist: PressIntelligenceResult['sentiment_distribution'],
  contradictions: PressContradiction[],
  companyAgeMois?: number,
): PressIntelligenceResult['flags_detected'] {
  const nbCrise = timeline.filter(t => t.type === 'crise').length;
  const dates = annotated.map(a => a.date).filter((d): d is string => !!d).sort();
  const derniereDate = dates.length ? dates[dates.length - 1] : null;
  const moisDepuisDerniere = derniereDate ? moisDepuisDate(derniereDate) : null;

  return {
    crise_reputationnelle: nbCrise >= 2 || (sentimentDist['négatif'] >= 3 && sentimentDist['négatif'] > sentimentDist.positif),
    contradiction_pitch_presse: contradictions.some(c => c.severite === 'majeure' || c.severite === 'bloquante'),
    silence_presse_prolonge: !!(companyAgeMois && companyAgeMois > 24 && (moisDepuisDerniere === null || moisDepuisDerniere > 12)),
    couverture_presse_forte: annotated.length >= 8 && annotated.filter(a => a.credibilite_source === 'haute').length >= 3,
  };
}

/**
 * Compare les faits de presse indépendants au pitch fondateur (1 appel LLM,
 * uniquement si un pitch est fourni). Ne signale que des contradictions
 * factuelles vérifiables (chiffres, dates, statuts, clients) — pas de nuances de ton.
 */
export async function detectPressContradictions(
  annotated: PressArticleAnnotation[],
  pitchText: string,
  startupName: string,
): Promise<PressContradiction[]> {
  if (!pitchText || !pitchText.trim() || annotated.length === 0) return [];

  try {
    const faits = annotated
      .filter(a => a.fait_marquant)
      .slice(0, 40)
      .map(a => `- [${a.date ?? '?'}] (${a.domain}) ${a.fait_marquant}`)
      .join('\n');

    if (!faits) return [];

    const prompt = `Compare le PITCH FONDATEUR ci-dessous aux FAITS DE PRESSE observés indépendamment sur "${startupName}".
Signale UNIQUEMENT les contradictions factuelles claires (chiffres, dates, statuts, clients, partenariats) —
pas les nuances d'interprétation ou de ton marketing.

PITCH FONDATEUR :
${pitchText.slice(0, 4000)}

FAITS DE PRESSE (${annotated.length} articles analysés) :
${faits}

Retourne UNIQUEMENT ce JSON :
{
  "contradictions": [
    { "claim_pitch": "citation ou paraphrase courte de l'affirmation du pitch", "realite_presse": "ce que la presse rapporte à la place", "severite": "mineure|majeure|bloquante", "sources": ["domaine1","domaine2"] }
  ]
}`;

    const result = await callLLMAndParseJSON<{ contradictions?: any[] }>(
      prompt,
      'Tu es un auditeur factuel. Ne signale que des contradictions vérifiables, jamais des suppositions. JSON strict.',
      { timeoutMs: 20_000, modelId: 'gemini-3-flash-preview' }
    );

    const raw = result?.data?.contradictions;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(c => c && c.claim_pitch && c.realite_presse)
      .map(c => ({
        claim_pitch:    String(c.claim_pitch),
        realite_presse: String(c.realite_presse),
        severite:       ['mineure', 'majeure', 'bloquante'].includes(c.severite) ? c.severite : 'mineure',
        sources:        Array.isArray(c.sources) ? c.sources.map(String) : [],
      }));
  } catch (err) {
    logger.warn('[PressIntel] Détection contradictions échouée (non bloquant)', { error: String(err) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATEUR
// ═══════════════════════════════════════════════════════════════════════════════

export interface CollectPressIntelligenceOptions {
  /** Fenêtre de recherche en mois (défaut 18, max 36). */
  sinceMonths?:    number;
  /** Pitch fondateur — si fourni, active la détection de contradictions (1 appel LLM de plus). */
  pitchText?:      string;
  /** Âge de la startup en mois — nécessaire pour détecter le flag silence_presse_prolonge. */
  companyAgeMois?: number;
}

/**
 * Orchestrateur principal du module presse. Suit exactement le pattern de
 * collectGreySources() : Promise.allSettled non-bloquant, retour dégradé
 * plutôt qu'exception, hints IRO calculés, contexte formaté prêt à injecter.
 */
export async function collectPressIntelligence(
  startupName: string,
  opts: CollectPressIntelligenceOptions = {},
): Promise<PressIntelligenceResult> {
  const t0 = Date.now();
  const sinceMonths = opts.sinceMonths ?? 18;

  // ── Phase A : découverte multi-source (parallèle) ─────────────────────────
  const [apiArticlesRes, geminiArticlesRes] = await Promise.allSettled([
    fetchRawArticlesViaAPIs(startupName, sinceMonths),
    fetchGeminiPressDiscovery(startupName),
  ]);
  const apiArticles    = apiArticlesRes.status    === 'fulfilled' ? apiArticlesRes.value    : [];
  const geminiArticles = geminiArticlesRes.status === 'fulfilled' ? geminiArticlesRes.value : [];

  const sourcesUsed: string[] = [];
  if (apiArticles.some(a => a.source_api === 'gdelt'))   sourcesUsed.push('gdelt_doc_api');
  if (apiArticles.some(a => a.source_api === 'newsapi')) sourcesUsed.push('newsapi');
  if (geminiArticles.length)                             sourcesUsed.push('gemini_search_presse');

  const articlesBrutsCount = apiArticles.length + geminiArticles.length;
  const dedup = dedupeArticles([...apiArticles, ...geminiArticles]);

  // ── Phase B/C : annotation NLP par lots (limite MAX_ARTICLES_ANNOTATED) ────
  const toAnnotate = [...dedup]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, MAX_ARTICLES_ANNOTATED);

  const batches: RawPressArticle[][] = [];
  for (let i = 0; i < toAnnotate.length; i += BATCH_SIZE) {
    batches.push(toAnnotate.slice(i, i + BATCH_SIZE));
  }

  const annotatedBatches = await Promise.allSettled(
    batches.map(b => annotateArticlesBatch(b, startupName))
  );
  const annotated: PressArticleAnnotation[] = annotatedBatches
    .flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // ── Phase D : synthèse déterministe ─────────────────────────────────────────
  const timeline        = buildTimeline(annotated);
  const sentimentDist   = computeSentimentDistribution(annotated);
  const sentimentGlobal = computeGlobalSentiment(sentimentDist);
  const hints            = computeIROHintsFromPress(annotated, timeline);

  // ── Phase D bis : contradictions vs pitch (optionnel) ───────────────────────
  const contradictions = opts.pitchText
    ? await detectPressContradictions(annotated, opts.pitchText, startupName)
    : [];

  const flags = detectPressFlags(annotated, timeline, sentimentDist, contradictions, opts.companyAgeMois);
  const derniereMention = annotated.map(a => a.date).filter((d): d is string => !!d).sort().pop() ?? null;

  const themesCount = new Map<string, number>();
  for (const a of annotated) for (const t of a.themes) themesCount.set(t, (themesCount.get(t) ?? 0) + 1);
  const themesDominants = Array.from(themesCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);

  const confidence: PressIntelligenceResult['confidence'] =
    annotated.length >= 8 && sourcesUsed.length >= 2 ? 'high' :
    annotated.length >= 3 ? 'medium' : 'low';

  logger.info('[PressIntel] Collecte terminée', {
    startup:          startupName,
    duration_ms:      Date.now() - t0,
    articles_bruts:   articlesBrutsCount,
    articles_retenus: annotated.length,
    sources_used:     sourcesUsed,
    confidence,
  });

  return {
    articles_bruts_count:   articlesBrutsCount,
    articles_retenus_count: annotated.length,
    articles:               annotated,
    timeline,
    contradictions,
    sentiment_global:       sentimentGlobal,
    sentiment_distribution: sentimentDist,
    silence_presse:         flags.silence_presse_prolonge,
    derniere_mention:       derniereMention,
    themes_dominants:       themesDominants,
    iro_hints_presse:       hints,
    flags_detected:         flags,
    sources_used:           sourcesUsed,
    confidence,
    fetched_at:             new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTEUR CONTEXTE LLM / RAPPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Formate le résultat en bloc de texte prêt à injecter dans un prompt LLM
 * (scoring IRO) ou dans le rapport ("Revue de presse"). Suit le même style
 * que formatGreySourcesContext() (grey-sources.ts).
 */
export function formatPressIntelligenceContext(pi: PressIntelligenceResult): string {
  if (!pi.articles_retenus_count) return '';

  const lines: string[] = [
    '── REVUE DE PRESSE EXHAUSTIVE (pipeline NLP multi-passes) ────────',
    `(${pi.articles_bruts_count} articles bruts collectés → ${pi.articles_retenus_count} retenus après dédoublonnage | Sources : ${pi.sources_used.join(', ') || 'aucune'} | Confiance : ${pi.confidence})`,
    `SENTIMENT GLOBAL : ${pi.sentiment_global} (positif=${pi.sentiment_distribution.positif} · neutre=${pi.sentiment_distribution.neutre} · négatif=${pi.sentiment_distribution['négatif']} · mixte=${pi.sentiment_distribution.mixte})`,
  ];

  if (pi.themes_dominants.length)
    lines.push(`THÈMES DOMINANTS : ${pi.themes_dominants.join(', ')}`);

  if (pi.derniere_mention)
    lines.push(`DERNIÈRE MENTION PRESSE : ${pi.derniere_mention}`);

  if (pi.timeline.length) {
    lines.push('TIMELINE PRESSE (chronologique) :');
    for (const ev of pi.timeline.slice(0, 12)) {
      lines.push(`  [${ev.periode}] (${ev.type}) ${ev.evenement}`);
    }
  }

  if (pi.contradictions.length) {
    lines.push('⚠ CONTRADICTIONS PITCH vs PRESSE :');
    for (const c of pi.contradictions) {
      lines.push(`  → [${c.severite.toUpperCase()}] Pitch : "${c.claim_pitch}" ≠ Presse : "${c.realite_presse}" (${c.sources.join(', ') || 'presse'})`);
    }
  }

  lines.push('── HINTS IRO PRESSE ─────────────────────────────────────────────');
  const h = pi.iro_hints_presse;
  lines.push(`DI=${h.di_hint} · IPC=${h.ipc_hint} · AR=${h.ar_hint} · CA=${h.ca_hint} · GCH=${h.gch_hint} · ADC=${h.adc_hint}`);

  const activeFlags = Object.entries(pi.flags_detected).filter(([, v]) => v).map(([k]) => k);
  if (activeFlags.length)
    lines.push(`⚠ FLAGS PRESSE DÉTECTÉS : ${activeFlags.join(', ')}`);

  lines.push('─────────────────────────────────────────────────────────────────');
  return lines.join('\n');
}
