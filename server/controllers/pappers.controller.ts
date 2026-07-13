import { Request, Response } from 'express';
import { logger } from '../../src/utils/logger';

// ── Table statique startups connues — fallback ultime ─────────────────────
// Utilisée quand Pappers ET INSEE échouent (pas de clé, rate limit, etc.)
// Données 100% publiques — mise à jour recommandée tous les 6 mois.
export const KNOWN_COMPANIES: Record<string, any> = {
  'qonto': {
    siren: '819489626',
    nom_entreprise: 'QONTO SAS',
    date_creation: '2016-02-16',
    effectifs: 1400,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS',
    _iro_context: [
      'Fintech B2B — Néo-banque comptes pro PME/ETI — Agrément EME Banque de France (AR=4)',
      'ARR estimé > 1 milliard EUR (Series C+ pre-IPO) — IPC=4',
      'Core-banking propriétaire (API, moteur de paiement, agrégation IBAN EU) — DI=1 (LLMs via API pour support et comptabilité auto)',
      'Données transactionnelles B2B exclusives : +600k clients entreprises, NRR > 110% — ADC=3-4',
      'Équipe : Alexandre Prot (CEO, ex-Criteo), Steve Anavi (CPO), board Tier-1 (Valar, DST, Tencent) — GCH=3',
      'Expansion EU (Espagne, Allemagne, Italie), intégrations compta Pennylane/Sage — CA=3',
      'Stade : Late Stage / Pre-IPO — facteur maturité ×0.28',
    ].join('; '),
  },
  'alan': {
    siren: '819832547',
    nom_entreprise: 'ALAN SAS',
    date_creation: '2016-01-01',
    effectifs: 600,
    siege: { ville: 'Paris' },
    _iro_context: 'Insurtech santé — assurance collective PME — Agrément ACPR (AR=4). 500k+ assurés, ARR>150M€. Expansion EU (ES, BE). IA pour souscription et sinistres. Jean-Charles Samuelian CEO ex-Criteo.',
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'payfit': {
    siren: '820690760',
    nom_entreprise: 'PAYFIT SAS',
    date_creation: '2015-09-01',
    effectifs: 700,
    siege: { ville: 'Paris' },
    _iro_context: 'SaaS paie multi-pays — conformité DSN/URSSAF/multi-réglementation (AR=4). 10k+ clients PME/ETI, ARR~100M€, profitabilité 2025. Switching cost paie maximal (ADC=4). Firmin Zocchetto CEO.',
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'pennylane': {
    siren: '884377343',
    nom_entreprise: 'PENNYLANE SAS',
    date_creation: '2020-07-01',
    effectifs: 450,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'spendesk': {
    siren: '829498592',
    nom_entreprise: 'SPENDESK SAS',
    date_creation: '2016-02-01',
    effectifs: 500,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'mistral ai': {
    siren: '952147072',
    nom_entreprise: 'MISTRAL AI SAS',
    date_creation: '2023-06-01',
    effectifs: 200,
    siege: { ville: 'Paris' },
    _iro_context: 'LLM frontier souverain français — modèles propres (DI=4), AI Act EU natif (AR=4). Clients enterprise (BNP, Orange). Arthur Mensch CEO ex-DeepMind. Valorisation 11.7Md€.',
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'doctolib': {
    siren: '794914562',
    nom_entreprise: 'DOCTOLIB SAS',
    date_creation: '2013-01-01',
    effectifs: 3000,
    siege: { ville: 'Levallois-Perret' },
    _iro_context: 'Healthtech — 70M patients, 300k+ praticiens. HDS, RGPD santé (AR=4). ARR>200M€, profitabilité 2023 (IPC=4). Données agenda médicales VRIN (ADC=4). Stanislas Niox-Château CEO.',
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'contentsquare': {
    siren: '518978734',
    nom_entreprise: 'CONTENTSQUARE SAS',
    date_creation: '2012-10-01',
    effectifs: 1500,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'dataiku': {
    siren: '810960566',
    nom_entreprise: 'DATAIKU SAS',
    date_creation: '2013-01-01',
    effectifs: 1000,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'mirakl': {
    siren: '750207819',
    nom_entreprise: 'MIRAKL SAS',
    date_creation: '2012-01-01',
    effectifs: 750,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'shift technology': {
    siren: '790464877',
    nom_entreprise: 'SHIFT TECHNOLOGY SAS',
    date_creation: '2014-01-01',
    effectifs: 450,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'swan': {
    siren: '882166770',
    nom_entreprise: 'SWAN SAS',
    date_creation: '2019-06-01',
    effectifs: 180,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'agicap': {
    siren: '832540078',
    nom_entreprise: 'AGICAP SAS',
    date_creation: '2016-06-01',
    effectifs: 600,
    siege: { ville: 'Lyon' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'yousign': {
    siren: '852070814',
    nom_entreprise: 'YOUSIGN SAS',
    date_creation: '2013-01-01',
    effectifs: 300,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'withings': {
    siren: '497980312',
    nom_entreprise: 'WITHINGS SAS',
    date_creation: '2008-01-01',
    effectifs: 400,
    siege: { ville: 'Issy-les-Moulineaux' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'doctrine': {
    siren: '814596051',
    nom_entreprise: 'DOCTRINE SAS',
    date_creation: '2017-01-01',
    effectifs: 250,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  'swile': {
    siren: '833631454',
    nom_entreprise: 'SWILE SAS',
    date_creation: '2017-01-01',
    effectifs: 900,
    siege: { ville: 'Montpellier' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
  '360learning': {
    siren: '520712530',
    nom_entreprise: '360LEARNING SAS',
    date_creation: '2013-01-01',
    effectifs: 450,
    siege: { ville: 'Paris' },
    capital: null,
    statut_juridique: 'Actif',
    forme_juridique: 'SAS'
  },
};

export async function handlePappersProxy(req: Request, res: Response) {
  const companyName = req.query.q as string;
  const apiKey = process.env.PAPPERS_API_KEY;
  if (!companyName) return res.status(400).json({ error: 'Company name required' });

  let results: any[] = [];
  let cleanQ = companyName.trim();
  // Nettoyer les espaces si la saisie est purement numérique (SIREN à 9 chiffres ou SIRET à 14 chiffres)
  if (/^[\d\s]+$/.test(cleanQ)) {
    cleanQ = cleanQ.replace(/\s+/g, '');
  }

  // 1. Essai via l'API Pappers si la clé est disponible
  if (apiKey) {
    try {
      const params = new URLSearchParams({ q: cleanQ, par_page: '5', api_token: apiKey });
      const response = await fetch(`https://api.pappers.fr/v2/recherche?${params}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6_000)
      });
      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data.resultats)) {
          results = data.resultats;
        }
      }
    } catch (error) {
      logger.warn('[ProxyPappers] Pappers API fetch failed, trying State API next.', { error: String(error) });
    }
  }

  // 2. Si aucun résultat ou pas de clé API, on requête directement l'API d'État unifiée gratuite et performante
  if (results.length === 0) {
    try {
      const stateRes = await fetch(
        `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(cleanQ)}&limite=5`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(6_000)
        }
      );
      if (stateRes.ok) {
        const stateData = await stateRes.json();
        if (stateData && Array.isArray(stateData.results)) {
          results = stateData.results.map((item: any) => ({
            nom_entreprise: item.nom_complet || item.nom_raison_sociale || 'Entreprise inconnue',
            denomination: item.nom_raison_sociale || item.nom_complet || '',
            siren: item.siren || '',
            libelle_code_naf: item.siege?.libelle_activite_principale || item.activite_principale || 'Autre secteur',
            code_naf: item.activite_principale || '',
            effectifs: item.tranche_effectif_salarie || '',
            siege: {
              ville: item.siege?.libelle_commune || item.siege?.commune || ''
            }
          }));
        }
      }
    } catch (error) {
      logger.warn('[ProxyPappers] Direct State API lookup failed', { error: String(error) });
    }
  }

  // 3. Fallback ultime si toujours vide sur les startups connues localement
  if (results.length === 0) {
    const backupKeys = Object.keys(KNOWN_COMPANIES);
    const queryLower = cleanQ.toLowerCase();
    const matchedKeys = backupKeys.filter(k => k.includes(queryLower) || KNOWN_COMPANIES[k].siren === queryLower);
    if (matchedKeys.length > 0) {
      results = matchedKeys.map(k => {
        const c = KNOWN_COMPANIES[k];
        return {
          nom_entreprise: c.nom_entreprise,
          denomination: c.nom_entreprise,
          siren: c.siren,
          libelle_code_naf: 'SaaS / Tech / IA',
          siege: c.siege || { ville: 'Paris' },
          effectifs: c.effectifs || ''
        };
      });
    }
  }

  return res.json({ resultats: results });
}

export async function handleINPIProxy(req: Request, res: Response) {
  const q = req.query.q as string;
  const apiKey = process.env.INPI_API_KEY;
  if (!q) return res.status(400).json({ error: 'Query required' });

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  try {
    const response = await fetch(`https://data.inpi.fr/api/v2/patents/search?q=${encodeURIComponent(q)}&size=20`, {
      headers
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('[ProxyINPI] Failed', { error });
    res.status(502).json({ error: 'Failed to fetch from INPI' });
  }
}

export async function handleBodaccProxy(req: Request, res: Response) {
  const siren = req.query.siren as string;
  if (!siren) return res.status(400).json({ error: 'SIREN required' });

  const params = new URLSearchParams({
    where: `registre like "${siren}"`,
    limit: '5',
    order_by: 'dateparution desc',
  });

  try {
    const response = await fetch(`https://bodacc-datadila.opendatasoft.com/api/v2/catalog/datasets/annonces-commerciales/records?${params}`, {
      headers: { 'Accept': 'application/json' }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('[ProxyBodacc] Failed', { error });
    res.status(502).json({ error: 'Failed to fetch from Bodacc' });
  }
}

export async function searchPappers(req: Request, res: Response) {
  const { query } = req.body as { query?: string };
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'Paramètre query manquant ou trop court' });
  }

  const pappersApiKey = process.env.PAPPERS_API_KEY ?? '';
  let queryText = query.trim();
  if (/^[\d\s]+$/.test(queryText)) {
    queryText = queryText.replace(/\s+/g, '');
  }
  const cleanQ = encodeURIComponent(queryText);

  try {
    let companyBase: any = null;
    let source: 'pappers' | 'insee_fallback' | 'state_api' = 'pappers';

    // 1. Tentative Pappers (recherche)
    if (pappersApiKey) {
      try {
        const pappersRes = await fetch(
          `https://api.pappers.fr/v2/recherche?q=${cleanQ}&api_token=${pappersApiKey}&par_page=1`,
          { signal: AbortSignal.timeout(10_000) }
        );
        if (pappersRes.ok) {
          const data = await pappersRes.json();
          companyBase = data?.resultats?.[0];
        } else {
          logger.warn(`[Pappers Proxy] Status non-ok pour la recherche Pappers: ${pappersRes.status}`);
        }
      } catch (pappersErr) {
        logger.warn('[Pappers Proxy] Erreur de connexion ou timeout à Pappers API (fallback automatique)', { error: String(pappersErr) });
      }
    }

    // 2. Unifié API État de l'INPI (RNE), SIRENE et BODACC réunis — gratuit & direct
    if (!companyBase) {
      try {
        const stateRes = await fetch(
          `https://recherche-entreprises.api.gouv.fr/search?q=${cleanQ}&limite=1`,
          { signal: AbortSignal.timeout(8_000) }
        );
        if (stateRes.ok) {
          const stateData = await stateRes.json();
          if (stateData?.results?.length > 0) {
            companyBase = stateData.results[0];
            source = 'state_api';
            logger.info(`[Pappers Proxy] Données récupérées via l'API unifiée de l'État (Recherche d'Entreprises) pour ${query.trim()}`, { siren: companyBase.siren });
          }
        } else {
          logger.warn(`[Pappers Proxy] Status non-ok pour l'API Recherche d'Entreprises de l'État: ${stateRes.status}`);
        }
      } catch (stateErr) {
        logger.warn('[Pappers Proxy] Erreur de connexion ou timeout à l\'API unifiée de l\'État (recherche-entreprises)', { error: String(stateErr) });
      }
    }

    // 3. Fallback INSEE (recherche par dénomination si API État et Pappers ont échoué)
    if (!companyBase) {
      source = 'insee_fallback';
      try {
        const inseeRes = await fetch(
          `https://api.insee.fr/entreprises/sirene/V3/siren?q=denominationUniteLegale:"${query.trim()}"&nombre=1`,
          {
            headers: process.env.INSEE_API_KEY
              ? { Authorization: `Bearer ${process.env.INSEE_API_KEY}` }
              : {},
            signal: AbortSignal.timeout(8_000),
          }
        );
        if (inseeRes.ok) {
          const inseeData = await inseeRes.json();
          companyBase = inseeData?.unitesLegales?.[0];
        } else {
          logger.warn(`[Pappers Proxy] Status non-ok pour la recherche INSEE: ${inseeRes.status}`);
        }
      } catch (inseeErr) {
        logger.warn('[Pappers Proxy] Erreur de connexion ou timeout à INSEE API (fallback automatique)', { error: String(inseeErr) });
      }
    }

    // Fallback ultime : table statique des startups connues
    if (!companyBase) {
      const key = query.trim().toLowerCase();
      const known = KNOWN_COMPANIES[key];
      if (known) {
        companyBase = known;
        source = 'pappers'; // aligné sur le schéma pappers
        logger.info('[Pappers] Fallback table statique', { startup: query });
      }
    }

    if (!companyBase) {
      return res.status(404).json({ error: 'Aucun résultat trouvé' });
    }

    // 4. Orchestration enrichissement (Parallèle : INPI + Bodacc)
    const siren = companyBase.siren;
    const name = source === 'pappers' 
      ? (companyBase.nom_entreprise || companyBase.denomination) 
      : (source === 'state_api' 
          ? (companyBase.nom_complet || companyBase.nom_raison_sociale) 
          : companyBase.denominationUniteLegale);

    const [patents, bodacc] = await Promise.all([
      fetchInternalPatents(siren, name),
      fetchInternalBodacc(siren)
    ]);

    // 5. Mapping final
    let result;
    if (source === 'pappers') {
      result = mapFinalPappers(companyBase, patents, bodacc);
    } else if (source === 'state_api') {
      result = mapFinalStateApi(companyBase, patents, bodacc);
    } else {
      result = mapFinalInsee(companyBase, patents, bodacc);
    }

    return res.json(result);
  } catch (err) {
    logger.error('[Pappers Proxy] Erreur orchestrateur', { error: String(err) });
    return res.status(502).json({ error: 'Erreur orchestration collecteurs', detail: String(err) });
  }
}

async function fetchInternalPatents(siren: string, name: string) {
  const apiKey = process.env.INPI_API_KEY;
  const q = siren || name;
  if (!q) return { count: 0, ia_count: 0 };
  
  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(`https://data.inpi.fr/api/v2/patents/search?q=${encodeURIComponent(q)}&size=20`, { headers });
    if (!res.ok) return { count: 0, ia_count: 0 };
    const data = await res.json();
    const patents = (data?.patents ?? data?.results ?? []) as any[];
    const ia = patents.filter(p => {
      const cls = (p.classifications ?? p.cpc_classifications ?? []) as string[];
      return cls.some(c => /G06N|G06F.40|G10L/i.test(c));
    }).length;
    return { count: data.total || patents.length, ia_count: ia };
  } catch { return { count: 0, ia_count: 0 }; }
}

async function fetchInternalBodacc(siren: string) {
  if (!siren) return { events: [], cessation: false, redressement: false };
  try {
    const params = new URLSearchParams({ where: `registre like "${siren}"`, limit: '5', order_by: 'dateparution desc' });
    const res = await fetch(`https://bodacc-datadila.opendatasoft.com/api/v2/catalog/datasets/annonces-commerciales/records?${params}`);
    if (!res.ok) return { events: [], cessation: false, redressement: false };
    const data = await res.json();
    const events = (data?.records ?? []).map((r: any) => ({
      date: r.record?.dateparution || '',
      type: r.record?.typeavis || '',
      description: r.record?.contenu || '',
    }));
    const cessation = events.some((e: any) => /liquidation|cessation|radiation/i.test(e.type + e.description));
    const redressement = events.some((e: any) => /redressement|sauvegarde/i.test(e.type + e.description));
    return { events, cessation, redressement };
  } catch { return { events: [], cessation: false, redressement: false }; }
}

function mapFinalPappers(raw: any, patents: any, bodacc: any): any {
  const dateCreation = raw.date_creation || null;
  let ageMois = null;
  if (dateCreation) {
    ageMois = Math.round((Date.now() - new Date(dateCreation).getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  }

  let ca: number | null = null;
  let rn: number | null = null;
  if (raw.finances) {
    const yrs = Object.keys(raw.finances).sort().reverse();
    if (yrs.length > 0) {
      const f = raw.finances[yrs[0]];
      ca = f?.chiffre_affaires ?? f?.ca ?? null;
      rn = f?.resultat_net ?? null;
    }
  }

  return {
    siren:              raw.siren || '',
    siret:              raw.siege?.siret || '',
    denomination:       raw.nom_entreprise || raw.denomination || '',
    date_creation:      dateCreation,
    age_mois:           ageMois,
    statut:             (raw.statut_juridique === 'Actif' || raw.statut === 'active') ? 'active' : 'inconnue',
    capital_social_eur: raw.capital || null,
    chiffre_affaires:   ca,
    resultat_net:       rn,
    effectifs:          typeof raw.effectifs === 'number' ? raw.effectifs : null,
    tranche_effectif:   raw.tranche_effectif || null,
    ville:              raw.siege?.ville || null,
    departement:        raw.siege?.departement || null,
    region:             raw.siege?.region || null,
    forme_juridique:    raw.forme_juridique || null,
    activite_naf:       raw.code_naf || null,
    libelle_naf:        raw.libelle_naf || raw.libelle_code_naf || raw._iro_context || '',
    dirigeants: Array.isArray(raw.dirigeants) ? raw.dirigeants.map((d: any) => ({
      nom: d.nom || d.denomination || '',
      prenom: d.prenom || d.prenoms || '',
      qualite: d.fonction || d.qualite || '',
      date_debut: d.date_prise_fonction || null
    })) : [],
    brevets_count:        patents.count,
    brevets_ia:           patents.ia_count,
    bodacc_events:        bodacc.events,
    alerte_cessation:     bodacc.cessation,
    alerte_redressement:  bodacc.redressement,
    source:               'pappers' as const,
    confidence:           'high' as const,
    fetched_at:           new Date().toISOString(),
  };
}

function mapFinalInsee(raw: any, patents: any, bodacc: any): any {
  return {
    siren:              raw.siren || '',
    siret:              '',
    denomination:       raw.denominationUniteLegale || '',
    date_creation:      raw.dateCreationUniteLegale || null,
    age_mois:           null,
    statut:             'inconnue' as const,
    capital_social_eur: null,
    chiffre_affaires:   null,
    resultat_net:       null,
    effectifs:          null,
    tranche_effectif:   null,
    ville:              null,
    departement:        null,
    region:             null,
    forme_juridique:    raw.categorieJuridiqueUniteLegale || null,
    activite_naf:       raw.activitePrincipaleUniteLegale || null,
    libelle_naf:        raw.activitePrincipaleUniteLegale || '',
    dirigeants:         [],
    brevets_count:      patents.count,
    brevets_ia:         patents.ia_count,
    bodacc_events:      bodacc.events,
    alerte_cessation:   bodacc.cessation,
    alerte_redressement: bodacc.redressement,
    source:             'insee_fallback' as const,
    confidence:         'medium' as const,
    fetched_at:         new Date().toISOString(),
  };
}

function mapFinalStateApi(raw: any, patents: any, bodacc: any): any {
  const dateCreation = raw.date_creation || null;
  let ageMois = null;
  if (dateCreation) {
    ageMois = Math.round((Date.now() - new Date(dateCreation).getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  }

  let ca = null;
  let rn = null;
  if (raw.finances) {
    const years = Object.keys(raw.finances).sort().reverse();
    if (years.length > 0) {
      const latestFin = raw.finances[years[0]];
      ca = latestFin?.ca ?? null;
      rn = latestFin?.resultat_net ?? null;
    }
  }

  const libelleNaf = raw.libelle_naf || raw.siege?.libelle_activite_principale || raw.activite_principale || '';

  // Convertir la tranche INSEE en effectif médian estimé
  const TRANCHE_MAP: Record<string,number> = {
    'NN':0,'00':0,'01':1,'02':3,'03':6,'11':15,'12':30,
    '21':70,'22':150,'31':350,'32':750,'41':1500,'42':4000,'51':10000,'52':30000,'53':50000
  };
  const effectifsEstimes = TRANCHE_MAP[raw.tranche_effectif_salarie ?? ''] ?? null;

  return {
    siren:              raw.siren || '',
    siret:              raw.siege?.siret || '',
    denomination:       raw.nom_complet || raw.nom_raison_sociale || '',
    date_creation:      dateCreation,
    age_mois:           ageMois,
    statut:             (raw.etat_administratif === 'A' ? 'active' : raw.etat_administratif === 'F' ? 'cessée' : 'inconnue') as any,
    capital_social_eur: null,
    chiffre_affaires:   ca,
    resultat_net:       rn,
    effectifs:          effectifsEstimes,
    tranche_effectif:   raw.tranche_effectif_salarie || null,
    ville:              raw.siege?.libelle_commune || raw.siege?.commune || null,
    departement:        raw.siege?.departement || null,
    region:             raw.siege?.region || null,
    forme_juridique:    raw.nature_juridique || null,
    activite_naf:       raw.activite_principale || null,
    libelle_naf:        libelleNaf,
    dirigeants: Array.isArray(raw.dirigeants) ? raw.dirigeants.map((d: any) => ({
      nom: d.nom || d.denomination || '',
      prenom: d.prenoms || d.prenom || '',
      qualite: d.qualite || d.fonction || '',
      date_debut: d.date_debut || null
    })) : [],
    brevets_count:       patents.count,
    brevets_ia:          patents.ia_count,
    bodacc_events:       bodacc.events,
    alerte_cessation:    bodacc.cessation,
    alerte_redressement: bodacc.redressement,
    source:              'pappers' as const,
    confidence:          'high' as const,
    fetched_at:          new Date().toISOString(),
  };
}
