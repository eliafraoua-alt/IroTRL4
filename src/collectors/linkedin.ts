/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FICHIER 2 — src/collectors/linkedin.ts (NOUVEAU)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * LinkedIn n'offre pas d'API publique pour les startups.
 * 3 approches documentées :
 *   A. LinkedIn Official API (réservé partenaires — inaccessible)
 *   B. Scraping via Gemini Search (RECOMMANDÉ — gratuit)
 *   C. Proxycurl API (payant, $0.01/profil — fiable)
 */

export interface LinkedInCompanyData {
  name:              string;
  employee_count:    number | null;
  employee_growth_pct: number | null;  // % croissance 6 mois
  tech_job_titles:   string[];         // titres des offres tech actives
  llm_signals:       string[];         // mots-clés LLM dans les offres
  founders:          string[];         // noms des fondateurs
  founder_backgrounds: string[];       // ex-GAFAM, publications, etc.
  source:            'proxycurl' | 'gemini_search';
  confidence:        'high' | 'medium' | 'low';
}

// Option B : Gemini Search (gratuit, recommandé pour démarrer)
export async function fetchLinkedInViaGemini(companyName: string): Promise<LinkedInCompanyData | null> {
  const { callLLMAndParseJSON } = await import('../utils/llm-router');

  const prompt = `Recherche sur LinkedIn.com les informations suivantes pour "${companyName}".
Consulte aussi les pages "About", les offres d'emploi LinkedIn, et les profils des fondateurs.

Retourne UNIQUEMENT ce JSON :
{
  "employee_count": null,
  "employee_growth_pct": null,
  "tech_job_titles": [],
  "llm_signals": [],
  "founders": [],
  "founder_backgrounds": []
}

llm_signals = mots-clés LLM dans les offres d'emploi (ex: "fine-tuning", "RLHF", "GPU cluster", "training large models")
founder_backgrounds = ex-emplois notables (ex: "ex-Google Brain", "PhD NeurIPS", "ex-Mistral")`;

  try {
    const result = await callLLMAndParseJSON<Partial<LinkedInCompanyData>>(prompt,
      'Tu es un analyste RH startup IA. JSON uniquement.');
    if (!result?.data) return null;

    return {
      name:                companyName,
      employee_count:      result.data.employee_count ?? null,
      employee_growth_pct: result.data.employee_growth_pct ?? null,
      tech_job_titles:     result.data.tech_job_titles ?? [],
      llm_signals:         result.data.llm_signals ?? [],
      founders:            result.data.founders ?? [],
      founder_backgrounds: result.data.founder_backgrounds ?? [],
      source:              'gemini_search',
      confidence:          'medium',
    };
  } catch {
    return null;
  }
}

// Option C : Proxycurl API (payant mais fiable)
// https://nubela.co/proxycurl/linkedin-company-api
export async function fetchLinkedInProxycurl(linkedinUrl: string): Promise<LinkedInCompanyData | null> {
  const apiKey = typeof process !== 'undefined' ? process.env.PROXYCURL_API_KEY : '';
  if (!apiKey) return null;

  try {
    const res = await fetch(`https://nubela.co/proxycurl/api/linkedin/company?url=${encodeURIComponent(linkedinUrl)}&use_cache=if-present`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!res.ok) return null;
    const data = await res.json();

    return {
      name:                data.name ?? '',
      employee_count:      data.company_size?.[0] ?? null,
      employee_growth_pct: null,
      tech_job_titles:     [],
      llm_signals:         [],
      founders:            (data.affiliated_companies ?? []).map((c: { name: string }) => c.name),
      founder_backgrounds: [],
      source:              'proxycurl',
      confidence:          'high',
    };
  } catch {
    return null;
  }
}

// Mapping LinkedIn → IRO (GCH dimension)
export function mapLinkedInToGCH(li: LinkedInCompanyData): {
  gch_signal:     number;    // [0-4] signal GCH depuis LinkedIn
  ca_signal:      number;    // [0-4] signal CA depuis growth
  team_size_small: boolean;  // < 10 → liability of smallness
  single_founder:  boolean;  // fondateur unique
  justification:  string;
} {
  const hasGAFAM    = li.founder_backgrounds.some(b => /google|meta|apple|amazon|microsoft|deepmind|openai|mistral/i.test(b));
  const hasPhD      = li.founder_backgrounds.some(b => /phd|neurips|icml|iclr|arxiv|publication/i.test(b));
  const hasLLMDepth = li.llm_signals.some(s => /fine.tun|rlhf|training|gpu cluster|from scratch/i.test(s));

  let gch = 1;
  if (hasGAFAM && hasPhD) gch = 4;
  else if (hasGAFAM || hasPhD) gch = 3;
  else if (li.founder_backgrounds.length > 0) gch = 2;

  const growthPct = li.employee_growth_pct ?? 0;
  const ca = growthPct > 50 ? 3 : growthPct > 20 ? 2 : growthPct > 0 ? 1 : 0;

  return {
    gch_signal:      gch,
    ca_signal:       ca,
    team_size_small: (li.employee_count ?? 999) < 10,
    single_founder:  li.founders.length === 1,
    justification:   [
      hasGAFAM ? `Fondateur ex-GAFAM détecté (${li.founder_backgrounds.slice(0,2).join(', ')})` : '',
      hasPhD    ? 'Publication/thèse académique détectée' : '',
      hasLLMDepth ? `Signal LLM profond : ${li.llm_signals.slice(0,2).join(', ')}` : '',
      `Effectifs : ${li.employee_count ?? 'N/A'} (croissance ${growthPct}%)`,
    ].filter(Boolean).join(' · '),
  };
}
