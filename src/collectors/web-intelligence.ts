/**
 * src/collectors/web-intelligence.ts
 * IROSTRENGTH v7.4 — Collecte web multi-sources pour enrichissement IRO
 *
 * Architecture : 10 fonctions query en Promise.allSettled (parallèle)
 *
 *  Fonctions existantes (v7.3) :
 *   1. queryPresseTech()      — TechCrunch, VentureBeat, Sifted, Maddyness, JDN, French Tech
 *   2. queryFinancement()     — Crunchbase, Dealroom, CBInsights, AngelList, Wellfound, Station F
 *                              + data.economie.gouv.fr, AMF Open Data
 *   3. queryStackTech()       — GitHub, HuggingFace, offres emploi ML
 *   4. queryClients()         — Site officiel, ProductHunt, G2
 *   5. queryEquipe()          — LinkedIn, Wellfound, AngelList
 *   6. queryReglementaire()   — CNIL, ACPR, ANSSI, AI Act EU
 *
 *  Nouvelles fonctions (v7.4) :
 *   7. queryEntreprises()     — annuaire-entreprises.data.gouv.fr, INPI Data, Pappers,
 *                              Infogreffe, OpenCorporates, SIRENE (INSEE)
 *   8. queryBrevets()         — Espacenet (OEB), Google Patents, PATENTSCOPE (OMPI),
 *                              DATA INPI Brevets, Lens.org
 *   9. queryScientifique()    — OpenAlex, HAL, Semantic Scholar, Google Scholar,
 *                              ORCID, arXiv/bioRxiv
 *  10. queryOpenData()        — data.gouv.fr, Eurostat, World Bank Open Data
 *
 * Quota AI Studio : 10 appels parallèles + 3 passes queryMultiLLM = 13/min (seuil 15 ✓)
 *
 * RÈGLE ANTI-HALLUCINATION GLOBALE :
 *   Chaque fonction injecte explicitement : "Si non trouvé dans ces sources → null.
 *   NE PAS INVENTER de données." Le LLM doit retourner null sur les champs non vérifiés.
 */

import { callLLMWithRouter } from '../utils/llm-router';
import { logger } from '../utils/logger';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WebIntelligence {
  // Financement & business
  funding_stage?:       string;
  funding_total?:       string;
  last_round_date?:     string;
  investors?:           string[];
  valuation?:           string;
  arr_estimate?:        string;
  nrr_estimate?:        string;

  // Produit & technologie
  llm_stack?:           string;
  di_signal?:           string;
  github_activity?:     string;
  open_source?:         string;

  // Clients & marché
  named_clients?:       string;
  case_studies?:        string;
  market_position?:     string;

  // Équipe & gouvernance
  founders?:            string;
  team_size?:           string;
  recent_hires?:        string;

  // Réglementaire
  certifications?:      string;
  regulatory_news?:     string;

  // Presse récente (< 18 mois)
  press_highlights?:    string;
  press_sentiment?:     'positif' | 'neutre' | 'négatif' | 'mixte';

  // Signaux STAR v7.3
  french_tech_label?:   string;
  stationf_resident?:   string;
  cbinsights_ranking?:  string;
  producthunt_signal?:  string;
  open_positions?:      string;
  key_hires?:           string;

  // Données entreprises officielles (v7.4)
  siren_verified?:      string;   // SIREN vérifié via SIRENE/Pappers/Infogreffe
  dirigeants_officiels?: string;  // Dirigeants du registre officiel
  capital_officiel?:    string;   // Capital social du Kbis/Infogreffe
  statut_juridique?:    string;   // SAS, SA, SARL…
  opencorporates_id?:   string;   // Identifiant international OpenCorporates
  amf_registered?:      string;   // Enregistrement AMF si applicable

  // Brevets & PI (v7.4)
  brevets_count?:       string;   // Nombre total brevets déposés (toutes bases)
  brevets_actifs?:      string;   // Brevets actifs / en vigueur
  brevets_cles?:        string;   // 1-2 brevets stratégiques les plus récents
  brevets_ia_count?:    string;   // Brevets IA spécifiquement (CPC G06N)
  lens_coverage?:       string;   // Couverture géographique des brevets (via Lens.org)

  // Publications scientifiques (v7.4)
  publications_count?:  string;   // Nombre de publications (OpenAlex/HAL/Semantic Scholar)
  publications_cles?:   string;   // 1-2 publications phares avec citations
  arxiv_activity?:      string;   // Dépôts arXiv/bioRxiv récents (< 24 mois)
  orcid_founders?:      string;   // Profils ORCID des fondateurs chercheurs
  h_index?:             string;   // H-index des fondateurs si public

  // Open Data contextuel (v7.4)
  secteur_stats?:       string;   // Stats sectorielles Eurostat / Banque Mondiale
  marche_taille?:       string;   // Taille du marché adressable (data publique)
  datagouv_datasets?:   string;   // Datasets data.gouv.fr liés à l'activité

  // Méta
  sources_queried:      string[];
  confidence:           'high' | 'medium' | 'low';
  fetched_at:           string;
  query_count:          number;
}

// ── Requête Gemini avec Google Search Grounding ────────────────────────────────

const GOOGLE_SEARCH_TOOL = [{ googleSearch: {} }];

async function geminiWebQuery(prompt: string, timeoutMs = 20000): Promise<string> {
  const { response } = await callLLMWithRouter(
    prompt,
    'Tu es un analyste factuel. Réponds en JSON strict uniquement. ' +
    'Ne fabrique aucune donnée. Si une information est introuvable dans les sources indiquées, ' +
    'retourne null pour ce champ. Ne jamais inventer.',
    { timeoutMs, modelId: 'gemini-3-flash-preview', tools: GOOGLE_SEARCH_TOOL }
  );
  return response;
}

// ── Helper — extraction JSON défensive ────────────────────────────────────────

function extractJSON(raw: string): Record<string, any> | null {
  try {
    const m = raw.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FONCTIONS EXISTANTES (enrichies)
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. Presse mondiale & FR ────────────────────────────────────────────────────

async function queryPresseTech(name: string): Promise<Partial<WebIntelligence> | null> {
  try {
    const raw = await geminiWebQuery(
      `Recherche dans la presse tech mondiale et française les informations les plus récentes (< 18 mois) sur la startup ou entreprise "${name}".

Sources à interroger OBLIGATOIREMENT (dans cet ordre de priorité) :
— Presse mondiale IA/tech : TechCrunch (techcrunch.com), VentureBeat (venturebeat.com), Wired, MIT Technology Review, Financial Times Tech
— Presse EU startups      : Sifted (sifted.eu), The Information
— Presse FR               : Les Echos (lesechos.fr), L'Usine Digitale (usine-digitale.fr), Maddyness (maddyness.com), Frenchweb (frenchweb.fr), Journal du Net (journaldunet.com), BFM Business
— Écosystème FR           : La French Tech (lafrenchtech.com) — labels, classements, programmes

RÈGLE ANTI-HALLUCINATION : Si une information n'est pas trouvée dans ces sources, écrire null. NE PAS INVENTER de chiffres, dates ou citations.

Retourne UNIQUEMENT ce JSON :
{
  "press_highlights": "2-3 faits saillants des 18 derniers mois séparés par ' | ' (avec source entre parenthèses : ex 'Levée 10M€ (TechCrunch 2024-03)'), ou null",
  "press_sentiment": "positif|neutre|négatif|mixte",
  "arr_estimate": "montant ARR si mentionné en presse (ex: '150M€'), sinon null",
  "nrr_estimate": "NRR si mentionné, sinon null",
  "market_position": "position marché, concurrents directs mentionnés, ou null",
  "french_tech_label": "label French Tech obtenu (ex: 'Next40 2024', 'French Tech 120') ou null",
  "sources_found": ["url1", "url2"]
}
Si aucune info récente trouvée dans ces sources, tous les champs = null.`
    );
    const p = extractJSON(raw);
    if (!p) return {};
    return {
      press_highlights:  p.press_highlights  ?? undefined,
      press_sentiment:   p.press_sentiment   ?? 'neutre',
      arr_estimate:      p.arr_estimate      ?? undefined,
      nrr_estimate:      p.nrr_estimate      ?? undefined,
      market_position:   p.market_position   ?? undefined,
      french_tech_label: p.french_tech_label ?? undefined,
    };
  } catch (e) {
    logger.warn('[WebIntel] queryPresseTech échoué', { startup: name, error: String(e) });
    return null;
  }
}

// ── 2. Financement & investisseurs ─────────────────────────────────────────────

async function queryFinancement(name: string): Promise<Partial<WebIntelligence> | null> {
  try {
    const raw = await geminiWebQuery(
      `Recherche les données de financement et de positionnement marché de "${name}".

Sources à interroger :
— Données investissement : Crunchbase (crunchbase.com), Dealroom (dealroom.co), CBInsights (cbinsights.com), PitchBook (données publiques uniquement)
— Recrutement & levées  : AngelList (angellist.com), Wellfound (wellfound.com)
— Données financières FR : data.economie.gouv.fr — marchés publics, subventions, aides BPI
— AMF Open Data          : data.amf-france.org — si société cotée ou acteurs financiers régulés
— Écosystème parisien   : Station F (stationf.co) — vérifier si la startup est résidente ou lauréate
— Presse financière     : Les Echos, Financial Times, BFM Business

RÈGLE ANTI-HALLUCINATION : Ne retourner que des données publiquement vérifiables dans ces sources. Si une donnée n'est pas trouvée, écrire null. NE PAS INVENTER de montants ou dates.

Retourne UNIQUEMENT ce JSON :
{
  "funding_stage": "seed|series-a|series-b|series-c|series-d+|profitable|pre-ipo|unknown",
  "funding_total": "montant total levé (ex: '250M€') ou null",
  "last_round_date": "date dernier tour (ex: '2024-03') ou null",
  "investors": ["nom investisseur 1", "nom investisseur 2"],
  "valuation": "valorisation si publique (ex: '1.2Md€') ou null",
  "stationf_resident": "true si résidente/lauréate Station F, sinon null",
  "cbinsights_ranking": "classement CBInsights si mentionné (ex: 'AI 100 2024'), sinon null",
  "amf_registered": "description si enregistrement AMF trouvé, sinon null",
  "bpi_aide": "aide BPI ou subvention publique trouvée sur data.economie.gouv.fr, sinon null"
}`
    );
    const p = extractJSON(raw);
    if (!p) return {};
    return {
      funding_stage:      p.funding_stage      ?? undefined,
      funding_total:      p.funding_total      ?? undefined,
      last_round_date:    p.last_round_date    ?? undefined,
      investors:          Array.isArray(p.investors) ? p.investors.slice(0, 8) : undefined,
      valuation:          p.valuation          ?? undefined,
      stationf_resident:  p.stationf_resident  ?? undefined,
      cbinsights_ranking: p.cbinsights_ranking ?? undefined,
      amf_registered:     p.amf_registered     ?? undefined,
    };
  } catch (e) {
    logger.warn('[WebIntel] queryFinancement échoué', { startup: name, error: String(e) });
    return null;
  }
}

// ── 3. Stack technique & GitHub ────────────────────────────────────────────────

async function queryStackTech(name: string): Promise<Partial<WebIntelligence> | null> {
  try {
    const raw = await geminiWebQuery(
      `Recherche la stack technique LLM de la startup "${name}".
Sources : site officiel (page technology/blog), GitHub org, offres d'emploi LinkedIn, documentation produit.

RÈGLES CRITIQUES :
- Ne pas inventer de modèles. Si non mentionné explicitement, écrire "Non documenté".
- "Powered by OpenAI" → di_signal = "API wrapper"
- "Fine-tuned on our data" ou offres "fine-tuning ML engineer" → di_signal = "fine-tuning"
- "Our own model" / "proprietary AI" / cluster GPU → di_signal = "modèle propre"
- Multimodal RAG custom sur données sectorielles → di_signal = "RAG custom"

Retourne UNIQUEMENT ce JSON :
{
  "llm_stack": "liste des LLMs/frameworks utilisés ou 'Non documenté'",
  "di_signal": "API wrapper|RAG custom|fine-tuning|modèle propre|Non documenté",
  "github_activity": "stars:N, commits/mois:N, langage principal, ou 'Non trouvé'",
  "open_source": "description si modèle/dataset open source, sinon null",
  "recent_hires": "signaux recrutement LLM/AI des 12 derniers mois ou null"
}`
    );
    const p = extractJSON(raw);
    if (!p) return {};
    return {
      llm_stack:       p.llm_stack       ?? undefined,
      di_signal:       p.di_signal       ?? undefined,
      github_activity: p.github_activity ?? undefined,
      open_source:     p.open_source     ?? undefined,
      recent_hires:    p.recent_hires    ?? undefined,
    };
  } catch (e) {
    logger.warn('[WebIntel] queryStackTech échoué', { startup: name, error: String(e) });
    return null;
  }
}

// ── 4. Clients & cas d'usage ───────────────────────────────────────────────────

async function queryClients(name: string): Promise<Partial<WebIntelligence> | null> {
  try {
    const raw = await geminiWebQuery(
      `Recherche les clients, utilisateurs et cas d'usage publics de "${name}".

Sources à interroger :
— Site officiel : page customers, references, case studies, témoignages
— ProductHunt (producthunt.com) : upvotes, commentaires, date de lancement, tagline
— G2 (g2.com) : nombre de reviews B2B, note, profil des utilisateurs
— Presse tech : TechCrunch, Maddyness, communiqués de presse
— LinkedIn : témoignages clients, annonces de partenariats

RÈGLE ANTI-HALLUCINATION : Ne citer que des clients nommés dans les sources ci-dessus. 'Non documenté' si aucun client public trouvé.

Retourne UNIQUEMENT ce JSON :
{
  "named_clients": "liste des clients nommés séparés par virgules, ou 'Non documenté'",
  "case_studies": "résumé en 1-2 phrases des cas clients publics les plus significatifs, ou null",
  "producthunt_signal": "upvotes ProductHunt + date de lancement si trouvé (ex: '1200 upvotes — lancé 2023-09'), sinon null"
}`
    );
    const p = extractJSON(raw);
    if (!p) return {};
    return {
      named_clients:      p.named_clients      ?? undefined,
      case_studies:       p.case_studies       ?? undefined,
      producthunt_signal: p.producthunt_signal ?? undefined,
    };
  } catch (e) {
    logger.warn('[WebIntel] queryClients échoué', { startup: name, error: String(e) });
    return null;
  }
}

// ── 5. Équipe & gouvernance ────────────────────────────────────────────────────

async function queryEquipe(name: string): Promise<Partial<WebIntelligence> | null> {
  try {
    const raw = await geminiWebQuery(
      `Recherche les informations sur l'équipe fondatrice, la gouvernance et le recrutement de "${name}".

Sources à interroger :
— Profils fondateurs  : LinkedIn (linkedin.com), site officiel (page team/about)
— Recrutement actif   : AngelList (angellist.com), Wellfound (wellfound.com) — postes ouverts, taille équipe
— Données entreprise  : Crunchbase (crunchbase.com), presse tech
— Écosystème parisien : Station F (stationf.co)

RÈGLE ANTI-HALLUCINATION : Ne mentionner que des personnes trouvées dans ces sources. Si le fondateur n'est pas documenté publiquement, écrire 'Non documenté'.

Retourne UNIQUEMENT ce JSON :
{
  "founders": "Prénom Nom (parcours clé ex: ex-Google Brain), Prénom Nom (parcours clé) — ou 'Non documenté'",
  "team_size": "nombre d'employés actuel estimé (LinkedIn headcount ou Wellfound) ou 'Non documenté'",
  "open_positions": "nombre de postes ouverts sur Wellfound/AngelList si trouvé, sinon null",
  "key_hires": "recrutements C-level ou ML récents (< 12 mois) si trouvés, sinon null"
}`
    );
    const p = extractJSON(raw);
    if (!p) return {};
    return {
      founders:       p.founders       ?? undefined,
      team_size:      p.team_size      ?? undefined,
      open_positions: p.open_positions ?? undefined,
      key_hires:      p.key_hires      ?? undefined,
    };
  } catch (e) {
    logger.warn('[WebIntel] queryEquipe échoué', { startup: name, error: String(e) });
    return null;
  }
}

// ── 6. Réglementaire ──────────────────────────────────────────────────────────

async function queryReglementaire(name: string): Promise<Partial<WebIntelligence> | null> {
  try {
    const raw = await geminiWebQuery(
      `Recherche les certifications, agréments et actualités réglementaires de la startup "${name}".
Sources : ACPR (banque-france.fr), CNIL (cnil.fr), ANSSI, HDS (esante.gouv.fr), CE marquage, FDA, registre AI Act EU.

Retourne UNIQUEMENT ce JSON :
{
  "certifications": "liste des certifications/agréments obtenus (ex: 'HDS 2023, ACPR PSP, CE IIa'), ou null",
  "regulatory_news": "actualité réglementaire récente significative en 1 phrase, ou null"
}`
    );
    const p = extractJSON(raw);
    if (!p) return {};
    return {
      certifications:  p.certifications  ?? undefined,
      regulatory_news: p.regulatory_news ?? undefined,
    };
  } catch (e) {
    logger.warn('[WebIntel] queryReglementaire échoué', { startup: name, error: String(e) });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOUVELLES FONCTIONS v7.4
// ═══════════════════════════════════════════════════════════════════════════════

// ── 7. Données entreprises officielles ────────────────────────────────────────

async function queryEntreprises(name: string): Promise<Partial<WebIntelligence> | null> {
  try {
    const raw = await geminiWebQuery(
      `Recherche les données officielles sur l'entreprise "${name}" dans les registres publics français et internationaux.

Sources à interroger OBLIGATOIREMENT :
— Annuaire des entreprises (annuaire-entreprises.data.gouv.fr) : SIREN, statut, dirigeants, adresse
— INPI Data (data.inpi.fr) : dépôts de marques, identité légale
— Pappers (pappers.fr) : Kbis, bilans, dirigeants, historique
— Infogreffe (infogreffe.fr) : extrait Kbis, capital social, dirigeants officiels
— Base SIRENE INSEE (api.insee.fr / sirene.fr) : activité principale (NAF), effectifs officiels
— OpenCorporates (opencorporates.com) : identifiant international, filiales, liens capitalistiques

RÈGLE ANTI-HALLUCINATION : Ne retourner que des données extraites de ces registres officiels.
Si l'entreprise n'est pas trouvée dans ces sources, retourner null. NE PAS INVENTER de SIREN, capital ou dirigeants.

Retourne UNIQUEMENT ce JSON :
{
  "siren_verified": "SIREN à 9 chiffres si trouvé dans SIRENE/Pappers/Infogreffe, sinon null",
  "dirigeants_officiels": "Prénom Nom (fonction) séparés par virgule, source Kbis/Infogreffe, sinon null",
  "capital_officiel": "capital social en euros (ex: '50 000 €'), sinon null",
  "statut_juridique": "forme juridique (SAS, SA, SARL, SE...), sinon null",
  "opencorporates_id": "identifiant OpenCorporates si trouvé (ex: 'fr/952147072'), sinon null"
}`
    );
    const p = extractJSON(raw);
    if (!p) return {};
    return {
      siren_verified:      p.siren_verified      ?? undefined,
      dirigeants_officiels: p.dirigeants_officiels ?? undefined,
      capital_officiel:    p.capital_officiel    ?? undefined,
      statut_juridique:    p.statut_juridique    ?? undefined,
      opencorporates_id:   p.opencorporates_id   ?? undefined,
    };
  } catch (e) {
    logger.warn('[WebIntel] queryEntreprises échoué', { startup: name, error: String(e) });
    return null;
  }
}

// ── 8. Brevets & propriété intellectuelle ─────────────────────────────────────

async function queryBrevets(name: string): Promise<Partial<WebIntelligence> | null> {
  try {
    const raw = await geminiWebQuery(
      `Recherche l'activité brevets et propriété intellectuelle de "${name}".

Sources à interroger OBLIGATOIREMENT :
— Espacenet (espacenet.com / epo.org) : brevets déposés à l'OEB, statut, revendications
— Google Patents (patents.google.com) : brevets mondiaux, citations, famille de brevets
— PATENTSCOPE OMPI (patentscope.wipo.int) : dépôts PCT internationaux
— DATA INPI Brevets (data.inpi.fr) : brevets français (INPI), marques, designs
— Lens.org (lens.org) : couverture géographique, citations scientifiques croisées

RÈGLE ANTI-HALLUCINATION : Ne citer que des brevets trouvés dans ces bases. Retourner null si aucun brevet trouvé.
Si le nombre n'est pas précis, donner une fourchette. NE PAS INVENTER de numéros de brevets.

Retourne UNIQUEMENT ce JSON :
{
  "brevets_count": "nombre total de brevets déposés (toutes bases) ou fourchette (ex: '8-12'), ou null si non trouvé",
  "brevets_actifs": "nombre de brevets actifs/en vigueur, ou null",
  "brevets_cles": "titre et date du ou des 1-2 brevets les plus récents ou stratégiques, ou null",
  "brevets_ia_count": "nombre de brevets classifiés IA (CPC G06N, G06F40) ou hardware spécialisé, ou null",
  "lens_coverage": "couvertures géographiques principales (FR, EP, US, PCT...) selon Lens.org, ou null"
}`
    );
    const p = extractJSON(raw);
    if (!p) return {};
    return {
      brevets_count:   p.brevets_count   ?? undefined,
      brevets_actifs:  p.brevets_actifs  ?? undefined,
      brevets_cles:    p.brevets_cles    ?? undefined,
      brevets_ia_count: p.brevets_ia_count ?? undefined,
      lens_coverage:   p.lens_coverage   ?? undefined,
    };
  } catch (e) {
    logger.warn('[WebIntel] queryBrevets échoué', { startup: name, error: String(e) });
    return null;
  }
}

// ── 9. Publications scientifiques & profils chercheurs ────────────────────────

async function queryScientifique(name: string): Promise<Partial<WebIntelligence> | null> {
  try {
    const raw = await geminiWebQuery(
      `Recherche l'activité de recherche scientifique et les profils académiques associés à "${name}" et ses fondateurs.

Sources à interroger OBLIGATOIREMENT :
— OpenAlex (openalex.org) : publications indexées, citations, affiliation institutionnelle
— HAL (hal.science) : publications françaises en open access, thèses, prépublications
— Semantic Scholar (semanticscholar.org) : graphe de citations, topics de recherche
— Google Scholar (scholar.google.com) : profils chercheurs, H-index, citations
— ORCID (orcid.org) : profils ORCID des fondateurs (lien identité–publications)
— arXiv (arxiv.org) / bioRxiv (biorxiv.org) : prépublications récentes (< 24 mois)

RÈGLE ANTI-HALLUCINATION : Ne citer que des publications et profils trouvés dans ces bases.
Retourner null si aucune activité scientifique trouvée. NE PAS INVENTER de titres d'articles ou de H-index.

Retourne UNIQUEMENT ce JSON :
{
  "publications_count": "nombre approximatif de publications indexées (ex: '23 publications sur OpenAlex'), ou null",
  "publications_cles": "titre abrégé + année + nombre de citations des 1-2 publications majeures, ou null",
  "arxiv_activity": "nombre de dépôts arXiv/bioRxiv récents (< 24 mois) et domaine(s) (ex: '4 dépôts NLP/LLM 2024'), ou null",
  "orcid_founders": "profils ORCID trouvés pour les fondateurs (ex: 'Jean Dupont ORCID 0000-0001-xxxx'), ou null",
  "h_index": "H-index du fondateur principal si public sur Google Scholar (ex: 'Arthur Mensch H-index: 22'), ou null"
}`
    );
    const p = extractJSON(raw);
    if (!p) return {};
    return {
      publications_count: p.publications_count ?? undefined,
      publications_cles:  p.publications_cles  ?? undefined,
      arxiv_activity:     p.arxiv_activity     ?? undefined,
      orcid_founders:     p.orcid_founders     ?? undefined,
      h_index:            p.h_index            ?? undefined,
    };
  } catch (e) {
    logger.warn('[WebIntel] queryScientifique échoué', { startup: name, error: String(e) });
    return null;
  }
}

// ── 10. Open Data contextuel (marché, secteur) ────────────────────────────────

async function queryOpenData(name: string): Promise<Partial<WebIntelligence> | null> {
  try {
    const raw = await geminiWebQuery(
      `Recherche des données de contexte marché et sectoriel pour évaluer l'environnement de "${name}".

Sources à interroger :
— data.gouv.fr : datasets publics français liés à l'activité de l'entreprise (ex: données santé pour une healthtech)
— Eurostat (ec.europa.eu/eurostat) : statistiques sectorielles européennes (taille marché, croissance, emploi)
— World Bank Open Data (data.worldbank.org) : indicateurs macroéconomiques si pertinent (marchés émergents)

RÈGLE ANTI-HALLUCINATION : Ne retourner que des statistiques issues de ces sources officielles.
Si aucune donnée contextuelle pertinente n'est trouvée, retourner null pour chaque champ.
NE PAS INVENTER de tailles de marché.

Retourne UNIQUEMENT ce JSON :
{
  "secteur_stats": "statistiques sectorielles Eurostat ou World Bank pertinentes (ex: 'Marché IA industrielle EU: 12Md€ CAGR 28% (Eurostat 2024)'), ou null",
  "marche_taille": "taille du marché adressable issue d'une source officielle open data, ou null",
  "datagouv_datasets": "datasets data.gouv.fr liés à l'activité (ex: 'Base SNDS pour healthtech'), ou null"
}`
    );
    const p = extractJSON(raw);
    if (!p) return {};
    return {
      secteur_stats:    p.secteur_stats    ?? undefined,
      marche_taille:    p.marche_taille    ?? undefined,
      datagouv_datasets: p.datagouv_datasets ?? undefined,
    };
  } catch (e) {
    logger.warn('[WebIntel] queryOpenData échoué', { startup: name, error: String(e) });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATEUR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lance 10 requêtes web en parallèle (Promise.allSettled — non bloquant).
 * Quota AI Studio : 10 appels + 3 passes queryMultiLLM = 13/min (seuil 15 ✓).
 * Si une requête échoue → résultat partiel, pas d'échec global.
 */
export async function fetchWebIntelligence(name: string): Promise<WebIntelligence> {
  const t0 = Date.now();

  const [
    presse, financement, stack, clients, equipe, reglementaire,
    entreprises, brevets, scientifique, opendata
  ] = await Promise.allSettled([
    queryPresseTech(name),
    queryFinancement(name),
    queryStackTech(name),
    queryClients(name),
    queryEquipe(name),
    queryReglementaire(name),
    // Nouvelles fonctions v7.4
    queryEntreprises(name),
    queryBrevets(name),
    queryScientifique(name),
    queryOpenData(name),
  ]);

  const merge = (r: PromiseSettledResult<Partial<WebIntelligence> | null>) =>
    (r.status === 'fulfilled' && r.value) ? r.value : {};

  const merged: Partial<WebIntelligence> = {
    ...merge(presse),
    ...merge(financement),
    ...merge(stack),
    ...merge(clients),
    ...merge(equipe),
    ...merge(reglementaire),
    ...merge(entreprises),
    ...merge(brevets),
    ...merge(scientifique),
    ...merge(opendata),
  };

  const nonNullFields = Object.values(merged).filter(v =>
    v !== undefined && v !== null && v !== 'Non documenté' && v !== 'Non trouvé'
  ).length;

  const confidence: WebIntelligence['confidence'] =
    nonNullFields >= 10 ? 'high' : nonNullFields >= 5 ? 'medium' : 'low';

  const result: WebIntelligence = {
    ...merged,
    sources_queried: [
      // Presse
      'techcrunch', 'venturebeat', 'sifted', 'maddyness', 'frenchweb', 'journaldunet', 'lafrenchtech',
      // Financement
      'crunchbase', 'dealroom', 'cbinsights', 'angellist', 'wellfound', 'stationf',
      'data.economie.gouv.fr', 'amf-france.org',
      // Produit
      'producthunt', 'g2',
      // Technique
      'github', 'linkedin',
      // Entreprises officielles
      'annuaire-entreprises.data.gouv.fr', 'data.inpi.fr', 'pappers.fr',
      'infogreffe.fr', 'opencorporates.com', 'api.insee.fr',
      // Brevets & PI
      'espacenet.com', 'patents.google.com', 'patentscope.wipo.int', 'lens.org',
      // Publications scientifiques
      'openalex.org', 'hal.science', 'semanticscholar.org',
      'scholar.google.com', 'orcid.org', 'arxiv.org',
      // Open Data
      'data.gouv.fr', 'eurostat', 'data.worldbank.org',
      // Réglementaire
      'cnil.fr', 'acpr', 'anssi',
    ],
    confidence,
    fetched_at: new Date().toISOString(),
    query_count: 10,
  };

  logger.info('[WebIntel] Collecte terminée', {
    startup: name,
    fields: nonNullFields,
    confidence,
    query_count: 10,
    ms: Date.now() - t0,
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTEUR CONTEXTE LLM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convertit WebIntelligence en bloc de texte pour sharedContext LLM.
 * Chaque ligne est étiquetée avec son signal IRO (DI, ADC, IPC, AR, CA, GCH).
 * Principe : ne formatter que les champs non-null → pas de lignes "null" dans le prompt.
 */
export function formatWebIntelligenceContext(wi: WebIntelligence): string {
  if (wi.confidence === 'low' && !wi.press_highlights && !wi.funding_stage
    && !wi.brevets_count && !wi.publications_count && !wi.siren_verified) {
    return '';
  }

  const lines: string[] = [
    '── DONNÉES WEB COLLECTÉES EN TEMPS RÉEL ─────────────────────────',
    `(${wi.query_count || 6} sources interrogées | Confiance globale : ${wi.confidence} | ${new Date(wi.fetched_at).toLocaleDateString('fr-FR')})`,
  ];

  // ── Identité officielle (registres) → fiabilité SIREN, dirigeants ──────────
  if (wi.siren_verified)       lines.push(`SIREN VÉRIFIÉ (Infogreffe/SIRENE) : ${wi.siren_verified}`);
  if (wi.statut_juridique)     lines.push(`FORME JURIDIQUE : ${wi.statut_juridique}`);
  if (wi.capital_officiel)     lines.push(`CAPITAL SOCIAL (Kbis) : ${wi.capital_officiel}`);
  if (wi.dirigeants_officiels) lines.push(`DIRIGEANTS OFFICIELS (Kbis) : ${wi.dirigeants_officiels} → GCH calibrage officiel`);
  if (wi.opencorporates_id)    lines.push(`OPENCORPORATES : ${wi.opencorporates_id} → liens capitalistiques`);

  // ── Financement → maturité, IPC, CA ────────────────────────────────────────
  if (wi.funding_stage)        lines.push(`FINANCEMENT : ${wi.funding_stage}${wi.funding_total ? ` — ${wi.funding_total} levés` : ''}${wi.last_round_date ? ` (dernier tour : ${wi.last_round_date})` : ''}`);
  if (wi.investors?.length)    lines.push(`INVESTISSEURS : ${wi.investors.join(', ')}`);
  if (wi.valuation)            lines.push(`VALORISATION : ${wi.valuation}`);
  if (wi.arr_estimate)         lines.push(`ARR ESTIMÉ (presse) : ${wi.arr_estimate} → signal IPC fort si > 10M€`);
  if (wi.nrr_estimate)         lines.push(`NRR (presse) : ${wi.nrr_estimate} → signal ADC si > 110%`);
  if (wi.amf_registered)       lines.push(`ENREGISTREMENT AMF : ${wi.amf_registered} → AR ≥ 3`);

  // ── Brevets & PI → signal DI ────────────────────────────────────────────────
  if (wi.brevets_count)        lines.push(`BREVETS DÉPOSÉS (Espacenet/INPI/Google Patents) : ${wi.brevets_count} → DI signal fort`);
  if (wi.brevets_actifs)       lines.push(`BREVETS ACTIFS : ${wi.brevets_actifs}`);
  if (wi.brevets_ia_count)     lines.push(`BREVETS IA/HW (CPC G06N) : ${wi.brevets_ia_count} → DI ≥ 3 si > 0`);
  if (wi.brevets_cles)         lines.push(`BREVETS CLÉS : ${wi.brevets_cles}`);
  if (wi.lens_coverage)        lines.push(`COUVERTURE GÉOGRAPHIQUE BREVETS (Lens.org) : ${wi.lens_coverage}`);

  // ── Publications scientifiques → signal DI + GCH ────────────────────────────
  if (wi.publications_count)   lines.push(`PUBLICATIONS SCIENTIFIQUES (OpenAlex/HAL) : ${wi.publications_count} → DI + GCH signal académique`);
  if (wi.publications_cles)    lines.push(`PUBLICATIONS CLÉS : ${wi.publications_cles}`);
  if (wi.arxiv_activity)       lines.push(`ARXIV/BIORXIV : ${wi.arxiv_activity} → signal R&D actif`);
  if (wi.h_index)              lines.push(`H-INDEX FONDATEUR (Google Scholar) : ${wi.h_index} → GCH track record académique`);
  if (wi.orcid_founders)       lines.push(`ORCID FONDATEURS : ${wi.orcid_founders}`);

  // ── Stack tech → signal DI ──────────────────────────────────────────────────
  if (wi.di_signal)            lines.push(`STACK IA — SIGNAL DI : ${wi.di_signal} → ${
    wi.di_signal === 'modèle propre' ? 'DI ≥ 3' :
    wi.di_signal === 'fine-tuning'   ? 'DI = 2' :
    wi.di_signal === 'RAG custom'    ? 'DI = 1-2' :
    wi.di_signal === 'API wrapper'   ? 'DI = 0-1' : 'DI = 1 (défaut)'
  }`);
  if (wi.llm_stack)            lines.push(`LLM UTILISÉS : ${wi.llm_stack}`);
  if (wi.github_activity)      lines.push(`GITHUB : ${wi.github_activity}`);
  if (wi.open_source)          lines.push(`OPEN SOURCE : ${wi.open_source}`);

  // ── Clients → signal IPC + ADC ──────────────────────────────────────────────
  if (wi.named_clients)        lines.push(`CLIENTS NOMMÉS : ${wi.named_clients} → IPC confiance ≥ 0.8`);
  if (wi.case_studies)         lines.push(`CAS CLIENTS : ${wi.case_studies}`);
  if (wi.producthunt_signal)   lines.push(`PRODUCTHUNT : ${wi.producthunt_signal} → signal IPC traction publique`);

  // ── Équipe → signal GCH ─────────────────────────────────────────────────────
  if (wi.founders)             lines.push(`FONDATEURS : ${wi.founders} → GCH calibrage`);
  if (wi.team_size)            lines.push(`TAILLE ÉQUIPE : ${wi.team_size}`);
  if (wi.recent_hires)         lines.push(`RECRUTEMENT RÉCENT : ${wi.recent_hires}`);
  if (wi.open_positions)       lines.push(`POSTES OUVERTS (Wellfound/AngelList) : ${wi.open_positions} → signal croissance GCH`);
  if (wi.key_hires)            lines.push(`RECRUTEMENTS CLÉS : ${wi.key_hires} → signal GCH`);

  // ── Réglementaire → signal AR ───────────────────────────────────────────────
  if (wi.certifications)       lines.push(`CERTIFICATIONS/AGRÉMENTS : ${wi.certifications} → AR ≥ 3 si agrément officiel`);
  if (wi.regulatory_news)      lines.push(`ACTUALITÉ RÉGLEMENTAIRE : ${wi.regulatory_news}`);

  // ── Presse & marché ─────────────────────────────────────────────────────────
  if (wi.press_highlights)     lines.push(`PRESSE RÉCENTE : ${wi.press_highlights}`);
  if (wi.market_position)      lines.push(`POSITION MARCHÉ : ${wi.market_position}`);
  if (wi.secteur_stats)        lines.push(`STATS SECTORIELLES (Eurostat/World Bank) : ${wi.secteur_stats}`);
  if (wi.marche_taille)        lines.push(`TAILLE MARCHÉ (open data) : ${wi.marche_taille}`);
  if (wi.datagouv_datasets)    lines.push(`DATASETS DATA.GOUV.FR : ${wi.datagouv_datasets}`);

  // ── Signaux STAR ────────────────────────────────────────────────────────────
  if (wi.french_tech_label)    lines.push(`LABEL FRENCH TECH : ${wi.french_tech_label} → signal GCH + CA`);
  if (wi.cbinsights_ranking)   lines.push(`CBINSIGHTS : ${wi.cbinsights_ranking} → signal marché fort`);
  if (wi.stationf_resident)    lines.push(`STATION F : résidente/lauréate → signal écosystème`);

  lines.push('──────────────────────────────────────────────────────────────────');
  return lines.join('\n');
}
