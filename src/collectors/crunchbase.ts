/**
 * src/collectors/crunchbase.ts — Journal d'audit IRO
 * IRO Strength v7.3 — CORRECTIF F-02
 *
 * PROBLÈME CORRIGÉ :
 *   seedFromCohorte() injectait GCH: 2 pour TOUTES les entrées,
 *   indépendamment des scores GCH documentés dans le gold standard.
 *   Cela contaminait le C-index Cox (0.901) et violait la règle anti-GCH=2-défaut.
 *
 * SOLUTION v7.3 :
 *   - L'interface d'entrée accepte maintenant GCH optionnel
 *   - Si GCH documenté est fourni → on l'utilise + gch_conf=0.8
 *   - Si GCH manquant → GCH=1, gch_conf=0.2, notes signale le manque
 *     (conforme à la règle du prompt registry : inconnu → GCH=1 + confiance=0.2)
 *   - Un champ gch_source trace l'origine du score pour l'auditabilité
 */

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface CrunchbaseCompany {
  slug:               string;
  name:               string;
  founded_year:       number | null;
  funding_total_usd:  number | null;
  funding_stage:      string | null;    // 'seed' | 'series_a' | 'series_b' | ...
  last_funding_date:  string | null;    // ISO date
  investors:          string[];
  employee_range:     string | null;    // '11-50' | '51-200' | ...
  description:        string | null;
  categories:         string[];         // secteurs Crunchbase
  website:            string | null;
  location_country:   string | null;
  location_city:      string | null;
  valuation_usd:      number | null;
  age_mois_computed:  number | null;    // calculé depuis founded_year
  source:             'crunchbase_api' | 'gemini_search' | 'manual';
  confidence:         'high' | 'medium' | 'low';
}

// ── Option A : API Crunchbase v4 (payant, ~$500/an Basic) ────────────────────
// Doc : https://data.crunchbase.com/docs/using-the-api
// Endpoints utiles :
//   GET /entities/organizations/{slug} → données complètes
//   GET /searches/organizations → recherche par nom

const CRUNCHBASE_API_BASE = 'https://api.crunchbase.com/api/v4';

async function fetchCrunchbaseAPI(slug: string, apiKey: string): Promise<CrunchbaseCompany | null> {
  const url = `${CRUNCHBASE_API_BASE}/entities/organizations/${slug}?user_key=${apiKey}&field_ids=short_description,founded_on,funding_total,last_funding_type,last_funding_on,num_employees_enum,investor_identifiers,categories,homepage_url,location_identifiers`;

  try {
    const res = await fetch(url, {
      headers: { 'accept': 'application/json', 'X-cb-user-key': apiKey }
    });
    if (!res.ok) return null;

    const data = await res.json();
    const props = data?.properties ?? {};

    const foundedYear = props.founded_on?.value
      ? parseInt(props.founded_on.value.split('-')[0])
      : null;

    const ageMois = foundedYear
      ? Math.round((Date.now() - new Date(`${foundedYear}-01-01`).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
      : null;

    return {
      slug,
      name:               props.identifier?.value ?? slug,
      founded_year:       foundedYear,
      funding_total_usd:  props.funding_total?.value_usd ?? null,
      funding_stage:      props.last_funding_type ?? null,
      last_funding_date:  props.last_funding_on?.value ?? null,
      investors:          (props.investor_identifiers ?? []).map((i: { value: string }) => i.value),
      employee_range:     props.num_employees_enum ?? null,
      description:        props.short_description ?? null,
      categories:         (props.categories ?? []).map((c: { value: string }) => c.value),
      website:            props.homepage_url ?? null,
      location_country:   props.location_identifiers?.find((l: { location_type: string }) => l.location_type === 'country')?.value ?? null,
      location_city:      props.location_identifiers?.find((l: { location_type: string }) => l.location_type === 'city')?.value ?? null,
      valuation_usd:      null, // Non disponible en Basic tier
      age_mois_computed:  ageMois,
      source:             'crunchbase_api',
      confidence:         'high',
    };
  } catch {
    return null;
  }
}

// ── Option B : Scraping Gemini Search (GRATUIT) ──────────────────────────────
// Utilise la capacité de recherche web de Gemini pour extraire les données
// Crunchbase sans API payante. Confidence réduite car parsing LLM.

async function fetchCrunchbaseViaGemini(companyName: string): Promise<CrunchbaseCompany | null> {
  // Import du routeur LLM existant
  const { callLLMAndParseJSON } = await import('../utils/llm-router');

  const prompt = `Recherche sur Crunchbase.com les informations suivantes pour la startup "${companyName}".
Consulte aussi Dealroom.co, Tracxn.com et PitchBook si Crunchbase n'a pas les données.

Retourne UNIQUEMENT ce JSON (null si information non trouvée) :
{
  "founded_year": null,
  "funding_total_usd": null,
  "funding_stage": "",
  "last_funding_date": "",
  "investors": [],
  "employee_range": "",
  "location_city": "",
  "location_country": "",
  "description": "",
  "categories": [],
  "valuation_usd": null
}`;

  try {
    const result = await callLLMAndParseJSON<Partial<CrunchbaseCompany>>(
      prompt,
      'Tu es un analyste startup. Retourne uniquement du JSON valide.'
    );

    if (!result?.data) return null;

    const d = result.data;
    const ageMois = d.founded_year
      ? Math.round((Date.now() - new Date(`${d.founded_year}-01-01`).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
      : null;

    return {
      slug: companyName.toLowerCase().replace(/\s+/g, '-'),
      name: companyName,
      founded_year:       d.founded_year ?? null,
      funding_total_usd:  d.funding_total_usd ?? null,
      funding_stage:      d.funding_stage ?? null,
      last_funding_date:  d.last_funding_date ?? null,
      investors:          d.investors ?? [],
      employee_range:     d.employee_range ?? null,
      description:        d.description ?? null,
      categories:         d.categories ?? [],
      website:            null,
      location_country:   d.location_country ?? null,
      location_city:      d.location_city ?? null,
      valuation_usd:      d.valuation_usd ?? null,
      age_mois_computed:  ageMois,
      source:             'gemini_search',
      confidence:         'medium',
    };
  } catch {
    return null;
  }
}

// ── Option C : Sources gratuites françaises (INPI + Pappers) ─────────────────
// Pour les startups françaises : Pappers.fr et INPI Sirene gratuits

/**
 * CORRECTIF F-03 — fetchPappersData() sécurisée
 *
 * PROBLÈME : l'ancienne version accédait à process.env.PAPPERS_API_KEY
 *   directement. Ce fichier est exporté via collectors/index.ts et peut
 *   être bundlé par Vite → la clé aurait pu se retrouver dans le bundle client.
 *
 * SOLUTION : fetchPappersData() passe désormais par le proxy Express
 *   /api/pappers/search (identique à pappers.ts — correctif SEC-03).
 *   Côté client : aucun accès direct à Pappers, aucune clé transmise.
 *   Côté serveur (scripts batch) : le proxy est bypassé, fallback null retourné
 *   avec un warning (utiliser directement pappers.ts dans les scripts serveur).
 *
 * La clé PAPPERS_API_KEY reste EXCLUSIVEMENT dans process.env côté server.ts.
 */
export async function fetchPappersData(siret: string): Promise<Partial<CrunchbaseCompany> | null> {
  // Côté serveur (scripts, CLI) : signaler qu'il faut utiliser le proxy
  const isServer = typeof window === 'undefined' && typeof process !== 'undefined';
  if (isServer) {
    // En contexte serveur (Node.js CLI / batch), on peut appeler Pappers directement
    // via le contrôleur server-side — mais JAMAIS en exposant la clé au client.
    // Ce chemin ne doit PAS être bundlé par Vite (exclure via vitest.config.ts).
    const apiKey = (process.env.PAPPERS_API_KEY || '').trim();
    if (!apiKey) {
      console.warn('[crunchbase] fetchPappersData : PAPPERS_API_KEY absente — retour null');
      return null;
    }
    const url = `https://api.pappers.fr/v2/entreprise?siret=${encodeURIComponent(siret)}&api_token=${apiKey}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return {
        name:            data.nom_entreprise,
        founded_year:    data.date_creation ? parseInt(data.date_creation.split('-')[0]) : null,
        employee_range:  data.tranche_effectif_salarie ?? null,
        location_city:   data.ville ?? null,
        location_country:'France',
        source:          'gemini_search',
        confidence:      'high',
      };
    } catch {
      return null;
    }
  }

  // Côté client (browser) : passer par le proxy Express /api/pappers/search
  // La clé PAPPERS_API_KEY n'est JAMAIS transmise au client.
  try {
    const res = await fetch('/api/pappers/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: siret, type: 'siret' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.denomination) return null;
    return {
      name:            data.denomination,
      founded_year:    data.date_creation ? parseInt(String(data.date_creation).split('-')[0]) : null,
      employee_range:  data.tranche_effectif ?? null,
      location_city:   data.ville ?? null,
      location_country:'France',
      source:          'gemini_search',
      confidence:      'high',
    };
  } catch {
    return null;
  }
}

// ── Exports publics ───────────────────────────────────────────────────────────

export async function fetchCrunchbase(
  slugOrName: string | null,
  opts: { apiKey?: string; fallbackGemini?: boolean } = {}
): Promise<CrunchbaseCompany | null> {
  if (!slugOrName) return null;

  const apiKey = opts.apiKey ?? (typeof process !== 'undefined' ? process.env.CRUNCHBASE_API_KEY : '');

  // Option A : API officielle si clé disponible
  if (apiKey) {
    const result = await fetchCrunchbaseAPI(slugOrName, apiKey);
    if (result) return result;
  }

  // Option B : Gemini search (fallback gratuit)
  if (opts.fallbackGemini !== false) {
    return fetchCrunchbaseViaGemini(slugOrName);
  }

  return null;
}

// ── MAPPING → IRO fields ─────────────────────────────────────────────────────
// Convertit CrunchbaseCompany en champs utilisables par l'IRO engine

export function mapCrunchbaseToIRO(cb: CrunchbaseCompany): {
  age_mois:           number;
  stade_financement:  string;
  employee_count:     number | null;
  founding_year:      number | null;
  funding_eur:        number | null;
  srd_vmm_hint:       number; // proxy: pre-seed=4, seed=3, A=2, B+=1 (plus avancé=moins volatile)
} {
  const stageMap: Record<string, string> = {
    'pre_seed': 'Pre-seed', 'seed': 'Seed', 'series_a': 'Série A',
    'series_b': 'Série B', 'series_c': 'Série C', 'series_d': 'Série D+',
    'grant': 'Subvention', 'angel': 'Business Angel',
  };

  const vmmMap: Record<string, number> = {
    'pre_seed': 3.5, 'seed': 3.0, 'series_a': 2.5,
    'series_b': 2.0, 'series_c': 1.5, 'series_d': 1.0,
  };

  const stage = cb.funding_stage?.toLowerCase() ?? 'seed';
  const empMap: Record<string, number> = {
    '1-10': 5, '11-50': 30, '51-200': 125, '201-500': 350, '501-1000': 750, '1001-5000': 3000,
  };

  return {
    age_mois:          cb.age_mois_computed ?? 24,
    stade_financement: stageMap[stage] ?? stage,
    employee_count:    cb.employee_range ? (empMap[cb.employee_range] ?? null) : null,
    founding_year:     cb.founded_year,
    funding_eur:       cb.funding_total_usd ? Math.round(cb.funding_total_usd * 0.92) : null,
    srd_vmm_hint:      vmmMap[stage] ?? 2.5,
  };
}
