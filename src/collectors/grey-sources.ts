/**
 * src/collectors/grey-sources.ts
 * IRO Strength v7.5 — Collecteurs Sources Grises
 *
 * 5 nouveaux modules de collecte de données semi-publiques légales :
 *
 *  1. queryMarchesPublics()   — data.gouv.fr/DECP (marchés publics signés)
 *  2. queryInfraStack()       — BuiltWith + Shodan + WHOIS/DNS
 *  3. queryAidesBPI()         — BPI France / data.economie.gouv.fr / CIR
 *  4. queryOffresEmploi()     — France Travail API + WTTJ
 *  5. queryReseauxGris()      — Glassdoor + Malt + archive.org
 *
 * Chacun suit le même pattern que web-intelligence.ts :
 *   - geminiWebQuery() avec Google Search Grounding
 *   - RÈGLE ANTI-HALLUCINATION explicite dans chaque prompt
 *   - Promise.allSettled() → non-bloquant
 *   - Retourne null si aucune donnée trouvée
 *
 * Architecture de sécurité :
 *   - Aucune clé API côté client
 *   - Les API directes (France Travail, BuiltWith) passent par /api/* proxy
 *   - Les requêtes Gemini Search utilisent callLLMWithRouter()
 *
 * Mapping IRO :
 *   marchés publics → IPC (ancrage vérifié), LU (clauses co-dev), AR (conformité)
 *   infra stack     → DI (AWS vs propre), AR (HTTPS/CSP)
 *   aides BPI/CIR   → DI (R&D propre déclaré), CA (ressources adaptation)
 *   offres emploi   → DI (signal futur), GCH (niveau requis), CA (recrutement)
 *   réseaux gris    → GCH (Glassdoor), DI (Malt sous-traitance), CA (web archive)
 */

import { callLLMWithRouter } from '../utils/llm-router';
import { logger } from '../utils/logger';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Signal extrait des marchés publics DECP. */
export interface MarchePublicSignal {
  /** Contrats publics trouvés (titulaire, acheteur, montant, date). */
  contrats: Array<{
    acheteur:   string;   // ex: "Ministère des Armées"
    objet:      string;   // ex: "Solution ATS recrutement"
    montant_eur: number | null;
    date_notification: string | null;
    duree_mois: number | null;
    renouvele:  boolean;  // contrat renouvelé au moins une fois
  }>;
  /** Montant total des contrats publics (€). */
  montant_total_eur: number;
  /** Nombre de marchés distincts. */
  nb_marches: number;
  /** Signal IPC [0-4] : ancrage institutionnel mesuré. */
  ipc_signal: number;
  /** Signal AR [0-4] : conformité vérifiée par acheteur public. */
  ar_signal: number;
  source: 'decp_datagouv' | 'boamp' | 'gemini_search';
  confidence: 'high' | 'medium' | 'low';
}

/** Signal extrait de l'analyse de la stack d'infrastructure. */
export interface InfraStackSignal {
  /** Hébergeur détecté (AWS, GCP, Azure, OVH, infra propre…). */
  hebergeur: string | null;
  /** Frameworks frontend (React, Vue, Webflow, WordPress…). */
  frontend_stack: string | null;
  /** Signal DI brut depuis BuiltWith/Shodan. */
  di_raw_signal: 'modele_propre' | 'fine_tuning' | 'api_wrapper' | 'indetermine';
  /** HTTPS actif. */
  https: boolean;
  /** Headers sécurité (HSTS, CSP, X-Frame-Options). */
  security_headers: 'bon' | 'partiel' | 'absent' | 'indetermine';
  /** Date de création du domaine (WHOIS). */
  domain_age_mois: number | null;
  /** Technos identifiées (liste). */
  technologies: string[];
  /** Signal DI [0-4] calculé depuis la stack. */
  di_signal: number;
  /** Signal AR [0-4] depuis les headers de sécurité. */
  ar_signal: number;
  source: 'builtwith' | 'shodan' | 'gemini_search';
  confidence: 'high' | 'medium' | 'low';
}

/** Signal extrait des aides publiques et du CIR. */
export interface AidesBPISignal {
  /** Aides BPI reçues. */
  aides_bpi: Array<{
    programme: string;   // ex: "French Tech Emergence", "Deeptech"
    montant_eur: number | null;
    annee: number | null;
  }>;
  /** CIR/CII déclaré (indicateur fort de R&D propre). */
  cir_declare: boolean;
  /** Montant CIR estimé (€). */
  cir_montant_eur: number | null;
  /** PGE encore actif (risque financier). */
  pge_actif: boolean;
  /** Signal DI [0-4] : CIR + BPI Deeptech → R&D propre. */
  di_signal: number;
  /** Signal CA [0-4] : subventions = ressources pour adaptation. */
  ca_signal: number;
  source: 'bpi_datagouv' | 'data_economie' | 'gemini_search';
  confidence: 'high' | 'medium' | 'low';
}

/** Signal extrait des offres d'emploi actives. */
export interface OffresEmploiSignal {
  /** Postes ouverts actuellement. */
  postes: Array<{
    titre:       string;   // ex: "ML Engineer - Fine-tuning"
    technologies: string[]; // ex: ["PyTorch", "LLaMA", "CUDA"]
    niveau:      'junior' | 'senior' | 'lead' | 'direction' | 'indetermine';
    type:        'tech' | 'commercial' | 'support' | 'direction' | 'autre';
  }>;
  /** Signal DI futur : cherche des profils ML/infra propre ? */
  di_futur_signal: number;
  /** Signal GCH : niveau exigé (ex-GAFAM ou PME) ? */
  gch_signal: number;
  /** Signal CA : recrutement commercial actif ? */
  ca_signal: number;
  /** Présence d'un poste CTO ou tech lead. */
  recherche_cto: boolean;
  source: 'france_travail' | 'wttj' | 'linkedin_jobs' | 'gemini_search';
  confidence: 'high' | 'medium' | 'low';
}

/** Signal extrait des réseaux gris (Glassdoor, Malt, archive.org). */
export interface ReseauxGrisSignal {
  /** Note Glassdoor (1-5). */
  glassdoor_score: number | null;
  /** Nb avis Glassdoor. */
  glassdoor_nb_avis: number | null;
  /** Thèmes récurrents dans les avis Glassdoor. */
  glassdoor_themes: string[];
  /** Prestataires Malt identifiés (confirme sous-traitance). */
  malt_prestataires: string[];
  /** Tech sous-traitée identifiée via Malt. */
  malt_tech_sous_traitee: boolean;
  /** Date de la première version du site (archive.org). */
  web_archive_premiere_version: string | null;
  /** Pivots visibles dans l'historique web. */
  web_archive_pivots: string[];
  /** Signal GCH [0-4] depuis Glassdoor. */
  gch_signal: number;
  /** Signal DI [0-4] depuis Malt (sous-traitance = DI réduit). */
  di_signal: number;
  /** Signal CA [0-4] depuis l'historique web (pivots documentés). */
  ca_signal: number;
  source: 'glassdoor' | 'malt' | 'web_archive' | 'gemini_search';
  confidence: 'high' | 'medium' | 'low';
}

/** Résultat agrégé de toutes les sources grises. */
/** Signal extrait du statut juridique et des données financières. */
export interface JuridiqueFinancierSignal {
  siren:                    string | null;
  dirigeant:                string | null;
  date_creation:            string | null;
  liquidation_judiciaire:   boolean;
  redressement_judiciaire:  boolean;
  ca_dernier:               number | null;
  bilan_annee:              number | null;
  bilan_freshness:          'F' | 'M' | 'S' | 'ND';
  data_stale:               boolean;
  dirigeant_anonyme:        boolean;
  adc_hint:                 number;
  gch_hint:                 number;
  source:                   'pappers' | 'sirene' | 'bodacc' | 'verif_com' | 'gemini_search';
  confidence:               'high' | 'medium' | 'low';
}

/** Signal extrait des brevets et marques (INPI / EPO). */
export interface PIBrevetsSignal {
  brevets:            Array<{ numero: string; titre: string; date: string; statut: string }>;
  marques:            Array<{ numero: string; libelle: string; date: string }>;
  brevet_non_verifie: boolean;
  nb_brevets_actifs:  number;
  di_pi_hint:         number;
  source:             'inpi' | 'epo' | 'gemini_search';
  confidence:         'high' | 'medium' | 'low';
}

export interface GreySourcesResult {
  marches_publics:      MarchePublicSignal       | null;
  infra_stack:          InfraStackSignal          | null;
  aides_bpi:            AidesBPISignal            | null;
  offres_emploi:        OffresEmploiSignal        | null;
  reseaux_gris:         ReseauxGrisSignal         | null;
  juridique_financier:  JuridiqueFinancierSignal  | null;  // [v7.6] Pappers/SIRENE/BODACC
  pi_brevets:           PIBrevetsSignal           | null;  // [v7.6] INPI/EPO
  /** IRO hints agrégés depuis toutes les sources grises. */
  iro_hints_grey: {
    di_hint:     number;   // BuiltWith + Malt + CIR + offres emploi + INPI/EPO [v7.6]
    ipc_hint:    number;   // Marchés publics DECP
    ar_hint:     number;   // Marchés publics + headers sécurité
    ca_hint:     number;   // BPI + offres commerciales + web archive
    gch_hint:    number;   // Glassdoor + offres emploi + profil dirigeant [v7.6]
    lu_hint:     number;   // Marchés publics (clauses co-dev)
    adc_hint:    number;   // CA Verif.com + résultat financier [v7.6]
    di_pi_hint:  number;   // INPI/EPO brevets actifs [v7.6]
  };
  /** Flags v4.5 levés par les sources grises [v7.6]. */
  flags_detected: {
    liquidation_judiciaire:  boolean;
    redressement_judiciaire: boolean;
    data_stale:              boolean;
    dirigeant_anonyme:       boolean;
    brevet_non_verifie:      boolean;
  };
  /** Niveau de confiance global. */
  confidence: 'high' | 'medium' | 'low';
  /** Sources effectivement exploitées. */
  sources_used: string[];
  /** Timestamp de la collecte. */
  fetched_at: string;
}

// ── Helper : requête Gemini avec Google Search Grounding ───────────────────────

const GOOGLE_SEARCH_TOOL = [{ googleSearch: {} }];

async function geminiGrey(prompt: string, timeoutMs = 25000): Promise<string> {
  const { response } = await callLLMWithRouter(
    prompt,
    'Tu es un analyste factuel specialise en intelligence economique legale. ' +
    'Reponds en JSON strict uniquement. ' +
    'Ne fabrique aucune donnee. Si une information est introuvable dans les sources indiquees, ' +
    'retourne null pour ce champ. Ne jamais inventer de montants, dates ou noms.',
    { timeoutMs, modelId: 'gemini-3-flash-preview', tools: GOOGLE_SEARCH_TOOL }
  );
  return response;
}

function parseJSON(raw: string): Record<string, any> | null {
  try {
    const m = raw.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch { return null; }
}

// ── 1. Marchés publics DECP ────────────────────────────────────────────────────

/**
 * Interroge les Données Essentielles de la Commande Publique (DECP).
 * Source : data.gouv.fr/fr/datasets/decp — gratuit, mis à jour quotidiennement.
 * Contient TOUS les marchés publics > 25 000€ signés par les entités françaises.
 *
 * Signal IRO :
 *   - IPC : montant × durée × renouvellement = ancrage institutionnel mesuré
 *   - LU  : clauses de co-développement parfois visibles dans l'objet du marché
 *   - AR  : acheteur public = conformité vérifiée par l'acheteur (scoring)
 */
export async function queryMarchesPublics(
  startupName: string,
  sirenOrSiret?: string,
): Promise<MarchePublicSignal | null> {
  try {
    const siren_hint = sirenOrSiret ? ` (SIREN/SIRET : ${sirenOrSiret})` : '';
    const raw = await geminiGrey(
      `Recherche tous les marchés publics et contrats publics signés avec la société "${startupName}"${siren_hint}.

SOURCES A INTERROGER OBLIGATOIREMENT :
1. data.gouv.fr/fr/datasets/decp-2024 — Données Essentielles Commande Publique (DECP)
   URL de recherche : https://data.gouv.fr/fr/datasets/decp/ puis cherche le nom ou SIREN
2. boamp.fr — Bulletin Officiel des Annonces des Marchés Publics
3. ted.europa.eu — Tenders Electronic Daily (marchés européens)
4. Recherche web : "${startupName}" site:marches-publics.info OR site:boamp.fr OR "avis d'attribution"

REGLE ANTI-HALLUCINATION : Ne retourner QUE des contrats publics officiellement publiés.
Ne pas inventer de montants. Si aucun marché public trouvé → contrats = [], nb_marches = 0.

Retourne UNIQUEMENT ce JSON :
{
  "contrats": [
    {
      "acheteur": "nom de l'entité publique acheteuse",
      "objet": "objet du marché tel que publié",
      "montant_eur": 38000,
      "date_notification": "2026-01",
      "duree_mois": 12,
      "renouvele": false,
      "source_url": "url de l'avis si trouvé"
    }
  ],
  "nb_marches": 1,
  "montant_total_eur": 38000,
  "co_developpement_clauses": "description si clauses de co-dev détectées, sinon null",
  "certifications_requises": "certifications demandées par l'acheteur public, sinon null"
}`
    );

    const p = parseJSON(raw);
    if (!p) return null;

    const contrats: MarchePublicSignal['contrats'] = [];
    if (Array.isArray(p.contrats)) {
      for (const c of p.contrats) {
        if (typeof c.acheteur === 'string' && c.acheteur) {
          contrats.push({
            acheteur:           c.acheteur,
            objet:              c.objet ?? '',
            montant_eur:        typeof c.montant_eur === 'number' ? c.montant_eur : null,
            date_notification:  c.date_notification ?? null,
            duree_mois:         typeof c.duree_mois === 'number' ? c.duree_mois : null,
            renouvele:          !!c.renouvele,
          });
        }
      }
    }

    const montantTotal = contrats.reduce((s, c) => s + (c.montant_eur ?? 0), 0);
    const nbMarches = contrats.length;

    // Signal IPC depuis les marchés publics
    // Logique : contrat ministère (armée, intérieur) = IPC fort ; contrat collectivité = IPC moyen
    let ipcSignal = 0;
    if (nbMarches >= 3)     ipcSignal = 3;
    else if (nbMarches >= 1) {
      const hasMinistere = contrats.some(c =>
        /minist|armée|défense|intérieur|sncf/i.test(c.acheteur));
      ipcSignal = hasMinistere ? 3 : 2;
    }
    // Renouvellement = ancrage confirmé
    const anyRenouvele = contrats.some(c => c.renouvele);
    if (anyRenouvele && ipcSignal < 3) ipcSignal = Math.min(ipcSignal + 1, 3);

    // Signal AR : acheteur public vérifie la conformité avant signature
    const arSignal = nbMarches > 0 ? 2 : 0;

    return {
      contrats,
      montant_total_eur: montantTotal,
      nb_marches:        nbMarches,
      ipc_signal:        ipcSignal,
      ar_signal:         arSignal,
      source:            'decp_datagouv',
      confidence:        nbMarches > 0 ? 'high' : 'low',
    };

  } catch (e) {
    logger.warn('[GreySources] queryMarchesPublics échoué', { startup: startupName, error: String(e) });
    return null;
  }
}

// ── 2. Infrastructure stack — BuiltWith + Shodan + WHOIS ──────────────────────

/**
 * Analyse la stack d'infrastructure depuis des sources publiques.
 * BuiltWith : technologies frontend/backend du site web
 * Shodan    : ports ouverts, SSL, headers HTTP (via recherche web)
 * WHOIS/DNS : date création domaine, registrar
 *
 * Signal IRO :
 *   - DI : AWS/GCP/Azure = DI réduit ; serveurs propres ou Kubernetes = DI augmenté
 *   - AR : HTTPS + HSTS + CSP = hygiène sécurité mesurable
 */
export async function queryInfraStack(
  startupName: string,
  websiteUrl?: string,
): Promise<InfraStackSignal | null> {
  try {
    const urlHint = websiteUrl ? ` (site web : ${websiteUrl})` : '';
    const raw = await geminiGrey(
      `Analyse la stack technique et l'infrastructure de "${startupName}"${urlHint}.

SOURCES A INTERROGER OBLIGATOIREMENT :
1. builtwith.com — analyse la stack tech du site web (cherche "${startupName} site:builtwith.com")
2. shodan.io — infrastructure réseau (cherche "hostname:${websiteUrl?.replace(/https?:\/\//, '') ?? startupName.toLowerCase().replace(/\s/g, '')}") 
3. sitechecker.pro ou similar — headers HTTP/sécurité
4. Lookup WHOIS : date création domaine (cherche "whois ${websiteUrl ?? startupName}")
5. Offres d'emploi : GitHub Jobs, LinkedIn — signaux infra propre

CRITERES DE SCORING DI :
- "Powered by OpenAI API" ou "uses GPT" → di_raw_signal = "api_wrapper"
- Infrastructure AWS/GCP/Azure standard + LLM API → di_raw_signal = "api_wrapper"
- Mentions "fine-tuning", "RLHF", "custom model" → di_raw_signal = "fine_tuning"
- GPU cluster propre, offres "infrastructure ML", brevets algo → di_raw_signal = "modele_propre"
- Aucune info technique → di_raw_signal = "indetermine"

REGLE ANTI-HALLUCINATION : Ne déduire la stack que depuis des sources vérifiables.
Ne pas inventer de technologies. Si BuiltWith ou Shodan ne donnent rien → null.

Retourne UNIQUEMENT ce JSON :
{
  "hebergeur": "AWS|GCP|Azure|OVH|Scaleway|infra_propre|indetermine",
  "frontend_stack": "React|Vue|Webflow|WordPress|Next.js|indetermine",
  "di_raw_signal": "modele_propre|fine_tuning|api_wrapper|indetermine",
  "https": true,
  "security_headers": "bon|partiel|absent|indetermine",
  "domain_age_mois": null,
  "technologies": ["React", "AWS", "Stripe"],
  "llm_detected": "GPT-4|Claude|Gemini|Mistral|custom|aucun|indetermine",
  "open_ai_mention": false,
  "kubernetes_or_gpu": false
}`
    );

    const p = parseJSON(raw);
    if (!p) return null;

    // Calcul signal DI depuis le raw signal
    const diRaw = p.di_raw_signal ?? 'indetermine';
    const diMap: Record<string, number> = {
      'modele_propre': 3,
      'fine_tuning':   2,
      'api_wrapper':   1,
      'indetermine':   1,
    };
    let diSignal = diMap[diRaw] ?? 1;
    // Bonus si Kubernetes ou GPU cluster détecté
    if (p.kubernetes_or_gpu) diSignal = Math.min(diSignal + 1, 4);

    // Signal AR depuis les headers de sécurité
    const arMap: Record<string, number> = { 'bon': 2, 'partiel': 1, 'absent': 0, 'indetermine': 1 };
    const arSignal = arMap[p.security_headers ?? 'indetermine'] ?? 1;

    return {
      hebergeur:        p.hebergeur       ?? null,
      frontend_stack:   p.frontend_stack  ?? null,
      di_raw_signal:    (diRaw as InfraStackSignal['di_raw_signal']),
      https:            !!p.https,
      security_headers: (p.security_headers ?? 'indetermine') as InfraStackSignal['security_headers'],
      domain_age_mois:  typeof p.domain_age_mois === 'number' ? p.domain_age_mois : null,
      technologies:     Array.isArray(p.technologies) ? p.technologies.slice(0, 10) : [],
      di_signal:        diSignal,
      ar_signal:        arSignal,
      source:           'gemini_search',
      confidence:       diRaw !== 'indetermine' ? 'medium' : 'low',
    };

  } catch (e) {
    logger.warn('[GreySources] queryInfraStack échoué', { startup: startupName, error: String(e) });
    return null;
  }
}

// ── 3. Aides publiques BPI & CIR ──────────────────────────────────────────────

/**
 * Recherche les aides BPI France, subventions publiques et CIR déclarés.
 * Source : data.economie.gouv.fr, annuaire-entreprises.data.gouv.fr, BPI France.
 *
 * Le CIR (Crédit Impôt Recherche) est un signal fort de R&D propre :
 * une startup qui déclare du CIR a forcément des ingénieurs qui font de la R&D.
 *
 * Signal IRO :
 *   - DI : CIR + BPI Deeptech → R&D propriétaire déclaré à l'administration
 *   - CA : subventions = ressources pour pivoter / s'adapter
 */
export async function queryAidesBPI(
  startupName: string,
  sirenOrSiret?: string,
): Promise<AidesBPISignal | null> {
  try {
    const sirenHint = sirenOrSiret ? ` SIREN/SIRET : ${sirenOrSiret}` : '';
    const raw = await geminiGrey(
      `Recherche les aides publiques et subventions reçues par "${startupName}"${sirenHint}.

SOURCES A INTERROGER OBLIGATOIREMENT :
1. data.economie.gouv.fr/aides-entreprises — base officielle des aides publiques
2. bpifrance.fr — programmes d'aide BPI (French Tech Emergence, Deeptech, i-Lab...)
3. annuaire-entreprises.data.gouv.fr — données officielles entreprise
4. impots.gouv.fr données publiques — CIR déclaré (parfois mentionné dans rapports annuels)
5. Recherche web : "${startupName}" (CIR OR "crédit impôt recherche" OR "BPI" OR "Deeptech" OR "i-Lab")

REGLE ANTI-HALLUCINATION : Ne mentionner QUE des aides officiellement attribuées et publiées.
Le CIR is déclaré à l'administration fiscale — ne l'affirmer que si mention publique trouvée.

Retourne UNIQUEMENT ce JSON :
{
  "aides_bpi": [
    {
      "programme": "nom du programme (ex: French Tech Emergence)",
      "montant_eur": null,
      "annee": 2024
    }
  ],
  "cir_declare": false,
  "cir_montant_eur": null,
  "cir_source": "source de l'information CIR ou null",
  "pge_actif": false,
  "pge_montant_eur": null,
  "autres_subventions": "description autres subventions publiques trouvées ou null",
  "french_tech_label": "label reçu ou null"
}`
    );

    const p = parseJSON(raw);
    if (!p) return null;

    const aides: AidesBPISignal['aides_bpi'] = [];
    if (Array.isArray(p.aides_bpi)) {
      for (const a of p.aides_bpi) {
        if (typeof a.programme === 'string' && a.programme) {
          aides.push({
            programme:   a.programme,
            montant_eur: typeof a.montant_eur === 'number' ? a.montant_eur : null,
            annee:       typeof a.annee === 'number' ? a.annee : null,
          });
        }
      }
    }

    const cirDeclare = !!p.cir_declare;
    const hasDeeptech = aides.some(a => /deeptech|i-lab|emergence/i.test(a.programme));

    // Signal DI : CIR ou BPI Deeptech = R&D propre déclaré officiellement
    let diSignal = 0;
    if (cirDeclare && hasDeeptech) diSignal = 3;
    else if (cirDeclare)           diSignal = 2;
    else if (hasDeeptech)          diSignal = 2;
    else if (aides.length > 0)     diSignal = 1;

    // Signal CA : avoir des ressources BPI = capacité d'adaptation financée
    const caSignal = aides.length >= 2 ? 2 : aides.length === 1 ? 1 : 0;

    return {
      aides_bpi:       aides,
      cir_declare:     cirDeclare,
      cir_montant_eur: typeof p.cir_montant_eur === 'number' ? p.cir_montant_eur : null,
      pge_actif:       !!p.pge_actif,
      di_signal:       diSignal,
      ca_signal:       caSignal,
      source:          'gemini_search',
      confidence:      aides.length > 0 || cirDeclare ? 'medium' : 'low',
    };

  } catch (e) {
    logger.warn('[GreySources] queryAidesBPI échoué', { startup: startupName, error: String(e) });
    return null;
  }
}

// ── 4. Offres d'emploi actives ─────────────────────────────────────────────────

/**
 * Analyse les offres d'emploi actives de la startup.
 * France Travail API (gratuit), Welcome to the Jungle, LinkedIn Jobs.
 *
 * Les offres d'emploi sont le signal le plus honnête sur DI et GCH :
 * une startup qui cherche "CTO / ML Engineer fine-tuning LLaMA" en juin 2026
 * a un DI qui va monter dans 6-12 mois.
 *
 * Signal IRO :
 *   - DI futur : cherche des profils ML/infra propre ?
 *   - GCH : niveau requis (ex-GAFAM ou PME) ? Publications demandées ?
 *   - CA : recrutement commercial = seizing actif
 */
export async function queryOffresEmploi(
  startupName: string,
  websiteUrl?: string,
): Promise<OffresEmploiSignal | null> {
  try {
    const raw = await geminiGrey(
      `Recherche toutes les offres d'emploi actuellement ouvertes pour "${startupName}".

SOURCES A INTERROGER OBLIGATOIREMENT :
1. francetravail.fr (ex Pôle Emploi) — cherche "${startupName}" dans les offres
2. welcometothejungle.com — cherche "${startupName}"
3. linkedin.com/jobs — cherche "${startupName}"
4. lever.co, greenhouse.io, workable.com — ATS publics souvent indexés
5. Site carrières de la startup${websiteUrl ? ` (${websiteUrl}/jobs ou ${websiteUrl}/careers)` : ''}

ANALYSE ATTENDUE :
- Identifier le NIVEAU réel requis : "ex-GAFAM" ou "2 ans d'expérience PME" → signal GCH
- Identifier les TECHNOLOGIES demandées : PyTorch, fine-tuning, CUDA, GPU → signal DI fort
- Identifier si un CTO/Lead Tech est recherché → recherche_cto = true
- Identifier les profils commerciaux (AE, SDR, CS) → signal CA

REGLE ANTI-HALLUCINATION : N'inventez pas d'offres. Si aucune offre trouvée → postes = [].

Retourne UNIQUEMENT ce JSON :
{
  "postes": [
    {
      "titre": "ML Engineer - Fine-tuning LLM",
      "technologies": ["PyTorch", "LLaMA", "CUDA"],
      "niveau": "senior",
      "type": "tech"
    }
  ],
  "recherche_cto": false,
  "niveau_exige_global": "junior|senior|gafam_ou_phd|mixte|indetermine",
  "signal_tech_proprietaire": "true si offres ML/GPU/fine-tuning détectées, false sinon",
  "signal_commercial_actif": "true si recrutement commercial/vente actif, false sinon",
  "nb_postes_total": 0
}`
    );

    const p = parseJSON(raw);
    if (!p) return null;

    const postes: OffresEmploiSignal['postes'] = [];
    if (Array.isArray(p.postes)) {
      for (const pos of p.postes) {
        if (typeof pos.titre === 'string' && pos.titre) {
          postes.push({
            titre:        pos.titre,
            technologies: Array.isArray(pos.technologies) ? pos.technologies.slice(0, 8) : [],
            niveau:       (['junior','senior','lead','direction'].includes(pos.niveau) ? pos.niveau : 'indetermine') as OffresEmploiSignal['postes'][0]['niveau'],
            type:         (['tech','commercial','support','direction'].includes(pos.type) ? pos.type : 'autre') as OffresEmploiSignal['postes'][0]['type'],
          });
        }
      }
    }

    // Signal DI futur
    const hasTechPropre = !!p.signal_tech_proprietaire ||
      postes.some(pos => pos.technologies.some(t => /pytorch|cuda|fine.tun|llama|mistral|gpu|rlhf/i.test(t)));
    const diFutur = hasTechPropre ? 2 : 1;

    // Signal GCH depuis le niveau exigé
    const niveauMap: Record<string, number> = {
      'gafam_ou_phd': 3,
      'senior':       2,
      'mixte':        2,
      'junior':       1,
      'indetermine':  1,
    };
    const gchSignal = niveauMap[p.niveau_exige_global ?? 'indetermine'] ?? 1;

    // Signal CA depuis le recrutement commercial
    const caSignal = p.signal_commercial_actif ? 2 : 1;

    return {
      postes,
      di_futur_signal:  diFutur,
      gch_signal:       gchSignal,
      ca_signal:        caSignal,
      recherche_cto:    !!p.recherche_cto,
      source:           'gemini_search',
      confidence:       postes.length > 0 ? 'medium' : 'low',
    };

  } catch (e) {
    logger.warn('[GreySources] queryOffresEmploi échoué', { startup: startupName, error: String(e) });
    return null;
  }
}

// ── 5. Réseaux gris — Glassdoor, Malt, Web Archive ────────────────────────────

/**
 * Collecte les signaux des réseaux semi-publics.
 * Glassdoor : avis employés (culture, GCH signal)
 * Malt       : prestataires freelance (confirme sous-traitance tech)
 * archive.org : historique web (pivots documentés = CA signal)
 *
 * Signal IRO :
 *   - GCH : Glassdoor score < 3 = instabilité managériale
 *   - DI  : prestataires Malt tech = sous-traitance confirmée = DI réduit
 *   - CA  : pivots dans archive.org = capacité d'adaptation historique
 */
export async function queryReseauxGris(
  startupName: string,
  websiteUrl?: string,
): Promise<ReseauxGrisSignal | null> {
  try {
    const urlShort = websiteUrl?.replace(/https?:\/\//, '') ?? '';
    const raw = await geminiGrey(
      `Recherche les signaux de sources semi-publiques pour "${startupName}"${urlShort ? ` (${urlShort})` : ''}.

SOURCES A INTERROGER :

A. GLASSDOOR (glassdoor.fr et glassdoor.com) :
   Cherche "${startupName} Glassdoor" — note globale, nb avis, thèmes récurrents
   (management, work-life balance, culture, rémunération, perspectives)

B. MALT (malt.fr) :
   Cherche les missions et prestataires freelance ayant travaillé pour "${startupName}"
   → Permet de détecter si la tech is externalisée à des freelances
   → Cherche : "malt.fr" "${startupName}" mission
   
C. WEB ARCHIVE (web.archive.org) :
   Cherche la première capture du site${urlShort ? ` ${urlShort}` : ''} sur archive.org
   → Date de création effective vs SIREN
   → Changements de positionnement visibles (pivot)
   → Ancienne vs nouvelle homepage = signal pivot CA

REGLE ANTI-HALLUCINATION : Ne rapporter que des données publiquement visibles.
Ne pas inventer de notes ou d'avis. Si Glassdoor n'a pas d'avis → glassdoor_score = null.

Retourne UNIQUEMENT ce JSON :
{
  "glassdoor_score": null,
  "glassdoor_nb_avis": null,
  "glassdoor_themes": [],
  "glassdoor_url": null,
  "malt_prestataires": [],
  "malt_tech_sous_traitee": false,
  "malt_description": "description des missions trouvées sur Malt ou null",
  "web_archive_premiere_version": null,
  "web_archive_pivots": [],
  "web_archive_evolution": "description de l'évolution du site depuis la création ou null"
}`
    );

    const p = parseJSON(raw);
    if (!p) return null;

    const glassdoorScore: number | null = typeof p.glassdoor_score === 'number'
      ? Math.max(1, Math.min(5, p.glassdoor_score)) : null;
    const maltTechST = !!p.malt_tech_sous_traitee;
    const pivots = Array.isArray(p.web_archive_pivots) ? p.web_archive_pivots.slice(0, 5) : [];

    // Signal GCH depuis Glassdoor
    let gchSignal = 1; // neutre si pas de données
    if (glassdoorScore !== null) {
      if (glassdoorScore >= 4.5) gchSignal = 4;
      else if (glassdoorScore >= 4.0) gchSignal = 3;
      else if (glassdoorScore >= 3.0) gchSignal = 2;
      else gchSignal = 1; // < 3 = signal instabilité
    }

    // Signal DI depuis Malt : sous-traitance tech = DI réduit
    const diSignal = maltTechST ? 1 : 2; // 2 = neutre (pas de preuve d'infra propre)

    // Signal CA depuis web archive : pivots documentés
    const caSignal = pivots.length >= 2 ? 3 : pivots.length === 1 ? 2 : 1;

    return {
      glassdoor_score:     glassdoorScore,
      glassdoor_nb_avis:   typeof p.glassdoor_nb_avis === 'number' ? p.glassdoor_nb_avis : null,
      glassdoor_themes:    Array.isArray(p.glassdoor_themes) ? p.glassdoor_themes.slice(0, 6) : [],
      malt_prestataires:   Array.isArray(p.malt_prestataires) ? p.malt_prestataires.slice(0, 8) : [],
      malt_tech_sous_traitee: maltTechST,
      web_archive_premiere_version: p.web_archive_premiere_version ?? null,
      web_archive_pivots:  pivots,
      gch_signal:          gchSignal,
      di_signal:           diSignal,
      ca_signal:           caSignal,
      source:              'gemini_search',
      confidence:          glassdoorScore !== null || maltTechST ? 'medium' : 'low',
    };

  } catch (e) {
    logger.warn('[GreySources] queryReseauxGris échoué', { startup: startupName, error: String(e) });
    return null;
  }
}

// ── 6. Statut juridique & financier — Pappers / SIRENE / BODACC / Verif.com ──

/**
 * Interroge Pappers, SIRENE, BODACC et Verif.com pour le statut juridique
 * et les données financières. Étapes 1, 2, 3 de la séquence d'investigation v4.5.
 * ÉTAPE 2 (BODACC) est BLOQUANTE : flag liquidation → rapport bloqué.
 */
export async function queryJuridiqueFinancier(
  startupName: string,
  siren?: string,
): Promise<JuridiqueFinancierSignal | null> {
  try {
    const sources = [
      `1. pappers.fr — cherche "${startupName}"${siren ? ` ou SIREN ${siren}` : ''} → dirigeant, date création, forme juridique`,
      `2. annuaire-entreprises.data.gouv.fr — SIREN officiel + données SIRENE`,
      `3. bodacc.fr — cherche "${startupName}"${siren ? ` SIREN ${siren}` : ''} DANS LES 36 DERNIERS MOIS — jugements liquidation ET redressement`,
      `4. verif.com ou manageo.fr — CA + résultat + date du dernier bilan disponible`,
      `5. societe.com — données financières complémentaires`,
    ].join('\n');

    const prompt = `Tu es un expert en recherche d'informations juridiques et financières sur les entreprises françaises.

STARTUP : "${startupName}"${siren ? ` (SIREN : ${siren})` : ''}

SOURCES À INTERROGER DANS L'ORDRE :
${sources}

REGLE ANTI-HALLUCINATION : Ne rapporter QUE des informations trouvées dans les sources ci-dessus.
Si une information est absente, indiquer null. Ne jamais inventer un SIREN, un CA ou un dirigeant.
ÉTAPE BODACC CRITIQUE : Chercher explicitement les mots "liquidation judiciaire", "redressement judiciaire",
"cessation d'activité" dans les 36 derniers mois. Si absent des résultats BODACC → liquidation_judiciaire: false.

Pour le bilan :
- Freshness F = bilan < 6 mois | M = 6-18 mois | S = > 18 mois | ND = non daté
- data_stale = true si freshness === 'S' || freshness === 'ND'

Retourne UNIQUEMENT ce JSON (sans markdown, sans backticks) :
{
  "siren": "string ou null",
  "dirigeant": "Prénom NOM ou null",
  "date_creation": "YYYY-MM-DD ou null",
  "liquidation_judiciaire": false,
  "redressement_judiciaire": false,
  "ca_dernier": null,
  "bilan_annee": null,
  "bilan_freshness": "ND",
  "data_stale": false,
  "dirigeant_anonyme": false,
  "adc_hint": 1,
  "gch_hint": 1,
  "source": "gemini_search",
  "confidence": "low"
}`;

    // Appel via geminiGrey — même pattern que les autres collecteurs (v7.6)
    // Utilise gemini-3-flash-preview + Google Search Grounding via le router centralisé
    const raw = await geminiGrey(prompt, 35000);
    const text = raw.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');

    const parsed = JSON.parse(text) as JuridiqueFinancierSignal;

    // Recalcul adc_hint depuis ca_dernier
    if (parsed.ca_dernier !== null) {
      if (parsed.ca_dernier >= 5_000_000)      parsed.adc_hint = 3;
      else if (parsed.ca_dernier >= 1_000_000) parsed.adc_hint = 2;
      else if (parsed.ca_dernier >= 100_000)   parsed.adc_hint = 1;
      else                                      parsed.adc_hint = 0;
    }

    // data_stale forcé cohérent
    parsed.data_stale = parsed.bilan_freshness === 'S' || parsed.bilan_freshness === 'ND';

    return parsed;
  } catch {
    return null;
  }
}

// ── 7. PI & Brevets — INPI / EPO Espacenet ────────────────────────────────────

/**
 * Interroge INPI et EPO pour les brevets et marques déposés.
 * Étape 5 de la séquence d'investigation v4.5.
 */
export async function queryPIBrevets(
  startupName: string,
  siren?: string,
): Promise<PIBrevetsSignal | null> {
  try {
    const prompt = `Tu es un expert en propriété intellectuelle et en recherche de brevets.

STARTUP : "${startupName}"${siren ? ` (SIREN : ${siren})` : ''}

SOURCES À INTERROGER :
1. data.inpi.fr — cherche "${startupName}" dans les brevets et marques déposés
2. epo.org/en/searching-for-patents/technical/espacenet — cherche "applicant:${startupName}"
3. bases.inpi.fr/marques — cherche les marques déposées au nom de "${startupName}"
4. Recherche web : "${startupName}" site:data.inpi.fr OR site:epo.org

REGLE ANTI-HALLUCINATION : Ne lister QUE les brevets/marques avec numéro officiel trouvé
dans les sources ci-dessus. Ne jamais inventer un numéro de brevet.
Si aucun brevet trouvé après recherche exhaustive : brevets = [], brevet_non_verifie = true si la startup
prétend avoir des brevets dans son deck, false sinon.

Signal di_pi_hint :
  0 = aucun brevet ni marque
  1 = marque(s) déposée(s) seulement
  2 = 1-2 brevets EP/FR actifs
  3 = portefeuille 3+ brevets actifs
  4 = portefeuille VRIN (brevets fondamentaux, citations élevées, exclusivité)

Retourne UNIQUEMENT ce JSON (sans markdown, sans backticks) :
{
  "brevets": [],
  "marques": [],
  "brevet_non_verifie": false,
  "nb_brevets_actifs": 0,
  "di_pi_hint": 0,
  "source": "gemini_search",
  "confidence": "low"
}`;

    // Appel via geminiGrey — même pattern que les autres collecteurs (v7.6)
    const raw = await geminiGrey(prompt, 35000);
    const text = raw.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');

    return JSON.parse(text) as PIBrevetsSignal;
  } catch {
    return null;
  }
}

// ── Agrégateur principal ───────────────────────────────────────────────────────

/**
 * Lance tous les collecteurs en parallèle et agrège les signaux IRO.
 * Non-bloquant : un échec partiel ne bloque pas les autres sources.
 *
 * Stratégie de fusion (priorité décroissante) :
 *   marchés publics > infra stack > aides BPI > offres emploi > réseaux gris
 *
 * Usage :
 *   const grey = await collectGreySources('ALLinOne', {
 *     sirenOrSiret: '123456789',
 *     websiteUrl:   'https://allinone.ai',
 *   });
 *   // grey.iro_hints_grey.ipc_hint = 3 (marchés publics Armées confirmés)
 */
export async function collectGreySources(
  startupName: string,
  opts: {
    sirenOrSiret?: string;
    websiteUrl?:   string;
  } = {},
): Promise<GreySourcesResult> {

  const t0 = Date.now();

  // Collecte parallèle — tous les collecteurs en simultané
  // [v7.6] 7 collecteurs parallèles (ajout juridique_financier + pi_brevets)
  const [r1, r2, r3, r4, r5, r6, r7] = await Promise.allSettled([
    queryMarchesPublics(startupName, opts.sirenOrSiret),
    queryInfraStack(startupName, opts.websiteUrl),
    queryAidesBPI(startupName, opts.sirenOrSiret),
    queryOffresEmploi(startupName, opts.websiteUrl),
    queryReseauxGris(startupName, opts.websiteUrl),
    queryJuridiqueFinancier(startupName, opts.sirenOrSiret),  // [v7.6] Pappers/BODACC
    queryPIBrevets(startupName, opts.sirenOrSiret),            // [v7.6] INPI/EPO
  ]);

  const mp  = r1.status === 'fulfilled' ? r1.value : null;
  const inf = r2.status === 'fulfilled' ? r2.value : null;
  const bpi = r3.status === 'fulfilled' ? r3.value : null;
  const off = r4.status === 'fulfilled' ? r4.value : null;
  const rg  = r5.status === 'fulfilled' ? r5.value : null;
  const jf  = r6.status === 'fulfilled' ? r6.value : null;   // [v7.6]
  const pi  = r7.status === 'fulfilled' ? r7.value : null;   // [v7.6]

  const sourcesUsed: string[] = [];
  if (mp  && mp.nb_marches > 0)    sourcesUsed.push('decp_marches_publics');
  if (inf && inf.confidence !== 'low') sourcesUsed.push('builtwith_infra');
  if (bpi && (bpi.aides_bpi.length > 0 || bpi.cir_declare)) sourcesUsed.push('bpi_aides');
  if (off && off.postes.length > 0) sourcesUsed.push('france_travail_offres');
  if (rg  && rg.confidence !== 'low') sourcesUsed.push('glassdoor_malt_archive');
  if (jf  && jf.confidence !== 'low') sourcesUsed.push('pappers_bodacc_verif');   // [v7.6]
  if (pi  && pi.confidence !== 'low') sourcesUsed.push('inpi_epo_brevets');        // [v7.6]

  // ── Fusion des signaux IRO (priorité : source la plus fiable) ───────────────

  // DI : infra stack > CIR/BPI > Malt (sous-traitance) > offres emploi futur
  const diHint = Math.round(
    (((inf?.di_signal ?? 1) * 3) +      // poids 3 : signal le plus direct
     ((bpi?.di_signal ?? 0) * 2) +      // poids 2 : CIR = R&D propre officiel
     ((rg?.di_signal  ?? 1) * 2) +      // poids 2 : Malt sous-traitance
     ((off?.di_futur_signal ?? 1) * 1)) // poids 1 : signal futur
    / 8
  );

  // IPC : marchés publics = source la plus fiable
  const ipcHint = mp?.ipc_signal ?? 1;

  // AR : marchés publics (acheteur vérifie) + infra sécurité
  const arHint = Math.round(
    (((mp?.ar_signal  ?? 0) * 2) +
     ((inf?.ar_signal ?? 1) * 1))
    / 3
  );

  // CA : offres commerciales + BPI + web archive pivots
  const caHint = Math.round(
    (((bpi?.ca_signal ?? 1) * 2) +
     ((off?.ca_signal ?? 1) * 2) +
     ((rg?.ca_signal  ?? 1) * 1))
    / 5
  );

  // GCH : Glassdoor + niveau offres emploi
  const gchHint = Math.round(
    (((rg?.gch_signal  ?? 1) * 2) +
     ((off?.gch_signal ?? 1) * 2))
    / 4
  );

  // LU : clauses co-développement dans marchés publics (signal rare et fort)
  const luHint = (mp?.ipc_signal ?? 0) >= 3 ? 2 : 1; // base conservative

  // Confidence globale
  const highSources = sourcesUsed.filter(s => ['decp_marches_publics', 'bpi_aides'].includes(s)).length;
  const confidence: GreySourcesResult['confidence'] =
    highSources >= 2 ? 'high' : highSources >= 1 ? 'medium' : 'low';

  logger.info('[GreySources] Collecte terminée', {
    startup:      startupName,
    duration_ms:  Date.now() - t0,
    sources_used: sourcesUsed,
    confidence,
    iro_hints:    { di: diHint, ipc: ipcHint, ar: arHint, ca: caHint, gch: gchHint, lu: luHint },
  });

  // [v7.6] Fusion hints des nouveaux collecteurs dans les hints existants
  const adcHint    = jf?.adc_hint    ?? 1;
  const diPiHint   = pi?.di_pi_hint  ?? 0;
  const gchJfHint  = jf?.gch_hint    ?? gchHint;

  // Flags détectés automatiquement par les sources grises
  const flagsDetected = {
    liquidation_judiciaire:  jf?.liquidation_judiciaire  ?? false,
    redressement_judiciaire: jf?.redressement_judiciaire ?? false,
    data_stale:              jf?.data_stale              ?? false,
    dirigeant_anonyme:       jf?.dirigeant_anonyme       ?? false,
    brevet_non_verifie:      pi?.brevet_non_verifie      ?? false,
  };

  if (jf)  sourcesUsed.push(jf.source);
  if (pi)  sourcesUsed.push(pi.source);

  return {
    marches_publics:      mp,
    infra_stack:          inf,
    aides_bpi:            bpi,
    offres_emploi:        off,
    reseaux_gris:         rg,
    juridique_financier:  jf,   // [v7.6]
    pi_brevets:           pi,   // [v7.6]
    iro_hints_grey: {
      di_hint:    Math.max(0, Math.min(4, Math.max(diHint, diPiHint))),
      ipc_hint:   Math.max(0, Math.min(4, ipcHint)),
      ar_hint:    Math.max(0, Math.min(4, arHint)),
      ca_hint:    Math.max(0, Math.min(4, caHint)),
      gch_hint:   Math.max(0, Math.min(4, gchJfHint)),
      lu_hint:    Math.max(0, Math.min(4, luHint)),
      adc_hint:   Math.max(0, Math.min(4, adcHint)),    // [v7.6]
      di_pi_hint: Math.max(0, Math.min(4, diPiHint)),   // [v7.6]
    },
    flags_detected: flagsDetected,  // [v7.6]
    confidence,
    sources_used: sourcesUsed,
    fetched_at:   new Date().toISOString(),
  };
}

/**
 * Formate les signaux gris en bloc de texte pour injection dans le prompt LLM.
 * Suit le même format que formatWebIntelligenceContext() dans web-intelligence.ts.
 */
export function formatGreySourcesContext(gs: GreySourcesResult): string {
  if (!gs.sources_used.length) return '';

  const lines: string[] = [
    '── SOURCES GRISES LÉGALES (données semi-publiques) ──────────────',
    `(${gs.sources_used.length} sources exploitées | Confiance : ${gs.confidence})`,
  ];

  // Marchés publics
  if (gs.marches_publics && gs.marches_publics.nb_marches > 0) {
    lines.push(`MARCHÉS PUBLICS DECP (data.gouv.fr) : ${gs.marches_publics.nb_marches} contrat(s) — total ${gs.marches_publics.montant_total_eur.toLocaleString('fr-FR')}€`);
    for (const c of gs.marches_publics.contrats.slice(0, 3)) {
      const montant = c.montant_eur ? `${c.montant_eur.toLocaleString('fr-FR')}€` : 'montant N/A';
      const renouvele = c.renouvele ? ' (RENOUVELÉ)' : '';
      lines.push(`  → ${c.acheteur} : ${c.objet} — ${montant}${renouvele} → IPC signal fort`);
    }
  }

  // Infrastructure
  if (gs.infra_stack && gs.infra_stack.di_raw_signal !== 'indetermine') {
    lines.push(`INFRA STACK (BuiltWith/Shodan) : hébergeur=${gs.infra_stack.hebergeur ?? 'N/A'} | DI signal=${gs.infra_stack.di_raw_signal} → DI=${gs.infra_stack.di_signal}`);
    if (gs.infra_stack.technologies.length)
      lines.push(`  Technologies détectées : ${gs.infra_stack.technologies.join(', ')}`);
    lines.push(`  Sécurité HTTPS/headers : ${gs.infra_stack.security_headers} → AR signal`);
  }

  // Aides BPI
  if (gs.aides_bpi && (gs.aides_bpi.aides_bpi.length > 0 || gs.aides_bpi.cir_declare)) {
    if (gs.aides_bpi.cir_declare)
      lines.push(`CIR DÉCLARÉ (data.economie.gouv.fr) : R&D propre officielle → DI signal fort`);
    for (const a of gs.aides_bpi.aides_bpi.slice(0, 3))
      lines.push(`  BPI ${a.programme}${a.montant_eur ? ` — ${a.montant_eur.toLocaleString('fr-FR')}€` : ''}${a.annee ? ` (${a.annee})` : ''}`);
    if (gs.aides_bpi.pge_actif)
      lines.push(`  PGE encore actif → risque trésorerie à surveiller`);
  }

  // Offres d'emploi
  if (gs.offres_emploi && gs.offres_emploi.postes.length > 0) {
    lines.push(`OFFRES D'EMPLOI ACTIVES (France Travail/WTTJ) : ${gs.offres_emploi.postes.length} poste(s)`);
    if (gs.offres_emploi.recherche_cto)
      lines.push(`  → CTO/Lead Tech recherché : DI va monter dans 6-12 mois`);
    for (const pos of gs.offres_emploi.postes.slice(0, 3)) {
      const tech = pos.technologies.length ? ` [${pos.technologies.slice(0,3).join(', ')}]` : '';
      lines.push(`  → ${pos.titre}${tech} (${pos.niveau}) → signal ${pos.type === 'tech' ? 'DI' : pos.type === 'commercial' ? 'CA' : 'GCH'}`);
    }
  }

  // Réseaux gris
  if (gs.reseaux_gris) {
    if (gs.reseaux_gris.glassdoor_score !== null)
      lines.push(`GLASSDOOR : ${gs.reseaux_gris.glassdoor_score}/5 (${gs.reseaux_gris.glassdoor_nb_avis ?? '?'} avis) → GCH signal${gs.reseaux_gris.glassdoor_score < 3 ? ' ⚠ instabilité' : ''}`);
    if (gs.reseaux_gris.malt_tech_sous_traitee)
      lines.push(`MALT : tech sous-traitée confirmée → DI réduit (prestataires : ${gs.reseaux_gris.malt_prestataires.slice(0,3).join(', ')})`);
    if (gs.reseaux_gris.web_archive_pivots.length)
      lines.push(`WEB ARCHIVE : ${gs.reseaux_gris.web_archive_pivots.length} pivot(s) documenté(s) → CA signal historique`);
  }

  // Hints IRO synthétiques
  lines.push('── HINTS IRO SOURCES GRISES ─────────────────────────────────────');
  const h = gs.iro_hints_grey;
  lines.push(`DI=${h.di_hint} · IPC=${h.ipc_hint} · AR=${h.ar_hint} · CA=${h.ca_hint} · GCH=${h.gch_hint} · LU=${h.lu_hint}`);
  lines.push('─────────────────────────────────────────────────────────────────');

  // [v7.6] Bloc juridique et financier
  if (gs.juridique_financier) {
    const jf = gs.juridique_financier;
    lines.push('\n--- STATUT JURIDIQUE & FINANCIER (Pappers/BODACC/Verif.com) ---');
    if (jf.siren)        lines.push(`SIREN : ${jf.siren}`);
    if (jf.dirigeant)    lines.push(`DIRIGEANT : ${jf.dirigeant}`);
    if (jf.date_creation) lines.push(`DATE CRÉATION : ${jf.date_creation}`);
    if (jf.liquidation_judiciaire)
      lines.push('⛔ FLAG BLOQUANT : LIQUIDATION JUDICIAIRE BODACC — rapport à bloquer');
    if (jf.redressement_judiciaire)
      lines.push('⚠ FLAG : REDRESSEMENT JUDICIAIRE BODACC actif');
    if (jf.ca_dernier !== null)
      lines.push(`CA DÉCLARÉ : ${jf.ca_dernier.toLocaleString('fr-FR')} € (${jf.bilan_annee ?? '?'}) — fraîcheur : ${jf.bilan_freshness}`);
    if (jf.data_stale)
      lines.push('⚠ FLAG data_stale : bilan > 18 mois → décote ADC automatique');
    if (jf.dirigeant_anonyme)
      lines.push('⚠ FLAG dirigeant_anonyme : fondateur non identifiable → GCH ≤ 2/5');
    lines.push(`Confiance : ${jf.confidence} | Source : ${jf.source}`);
  }

  // [v7.6] Bloc PI / Brevets
  if (gs.pi_brevets) {
    const pi = gs.pi_brevets;
    lines.push('\n--- PI & BREVETS (INPI / EPO Espacenet) ---');
    if (pi.nb_brevets_actifs > 0)
      lines.push(`BREVETS ACTIFS : ${pi.nb_brevets_actifs} (signal DI pi_hint=${pi.di_pi_hint}/4)`);
    if (pi.marques.length > 0)
      lines.push(`MARQUES DÉPOSÉES : ${pi.marques.length} (${pi.marques.map(m => m.libelle).join(', ')})`);
    if (pi.brevet_non_verifie)
      lines.push('⚠ FLAG brevet_non_verifie : brevet déclaré dans le deck mais non trouvé INPI/EPO → DI ≤ 3/5');
    if (pi.brevets.length === 0 && !pi.brevet_non_verifie)
      lines.push('NT : aucun brevet trouvé sur INPI/EPO après recherche exhaustive');
    lines.push(`Confiance : ${pi.confidence} | Source : ${pi.source}`);
  }

  // [v7.6] Résumé des flags détectés automatiquement
  if (gs.flags_detected) {
    const f = gs.flags_detected;
    const activeFlags = Object.entries(f)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    if (activeFlags.length > 0)
      lines.push(`\n⚠ FLAGS DÉTECTÉS PAR SOURCES GRISES : ${activeFlags.join(', ')}`);
  }

  return lines.join('\n');
}
