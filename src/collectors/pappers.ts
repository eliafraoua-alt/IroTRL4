/**
 * src/collectors/pappers.ts
 * IRO Strength v6.6.2 — CORRECTIF SEC-03
 *
 * PROBLÈME : resolveEnv() lisait VITE_PAPPERS_API_KEY via import.meta.env
 *   → clé injectée dans le bundle client par vite.config.ts → visible DevTools.
 *
 * SOLUTION : les appels Pappers/INPI/Bodacc/INSEE passent par
 *   le proxy Express /api/pappers (server.ts).
 *   Ce collector ne fait plus d'appel fetch direct avec une clé API.
 *   Il expose uniquement les types, le hook React, et les fonctions de mapping.
 *
 * Les clés PAPPERS_API_KEY, INPI_API_KEY, INSEE_API_KEY restent
 * exclusivement dans process.env côté server.ts.
 */

import { useState, useCallback } from 'react';
import type { FinancialData } from '../types/iro';

// ══════════════════════════════════════════════════════════════════
// TYPES (inchangés)
// ══════════════════════════════════════════════════════════════════

export interface PappersEntreprise {
  siret:                string;
  siren:                string;
  denomination:         string;
  date_creation:        string | null;
  age_mois:             number | null;
  statut:               'active' | 'cessée' | 'en_redressement' | 'inconnue';
  capital_social_eur:   number | null;
  chiffre_affaires:     number | null;
  resultat_net:         number | null;
  effectifs:            number | null;
  tranche_effectif:     string | null;
  activite_naf:         string | null;
  libelle_naf:          string | null;
  forme_juridique:      string | null;
  ville:                string | null;
  departement:          string | null;
  region:               string | null;
  dirigeants:           { nom: string; prenom: string; qualite: string; date_debut: string | null }[];
  brevets_count:        number;
  brevets_ia:           number;
  bodacc_events:        { date: string; type: string; description: string }[];
  alerte_cessation:     boolean;
  alerte_redressement:  boolean;
  source:               'pappers' | 'insee_fallback';
  confidence:           'high' | 'medium' | 'low';
  fetched_at:           string;
}

export interface PappersIROContext {
  age_mois:             number;
  team_size_small:      boolean;
  single_founder_proxy: boolean;
  ar_signal_bonus:      number;
  cessation_alert:      boolean;
  redressement_alert:   boolean;
  full_context:         string;
}

// ══════════════════════════════════════════════════════════════════
// FETCH — PASSE PAR LE PROXY EXPRESS /api/pappers (SEC-03 fix)
// ══════════════════════════════════════════════════════════════════

/**
 * Appelle le proxy Express /api/pappers/search
 * Le serveur gère l'authentification Pappers avec PAPPERS_API_KEY (server-side).
 * Aucune clé ne transite vers le client.
 */
export async function fetchPappersComplete(
  nameOrSiren: string,
  opts: { timeout?: number } = {},
): Promise<PappersEntreprise | null> {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), opts.timeout ?? 12_000);

  try {
    const res = await fetch('/api/pappers/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: nameOrSiren }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Pappers proxy ${res.status}: ${(err as { error?: string }).error ?? res.statusText}`);
    }

    return (await res.json()) as PappersEntreprise;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    throw err;
  } finally {
    clearTimeout(timerId);
  }
}

// ══════════════════════════════════════════════════════════════════
// MAPPERS (inchangés — logique pure, pas de fetch)
// ══════════════════════════════════════════════════════════════════

export function mapPappersToFinancialData(e: PappersEntreprise): Partial<FinancialData> {
  return {
    funding_total_eur:    null,
    funding_stage:        null,
    founded_year:         e.date_creation ? parseInt(e.date_creation.slice(0, 4)) : null,
    investors:            [],
    last_round_date:      null,
    valuation_eur:        null,
    statut_juridique:     e.forme_juridique ?? null,
    source_confidence:    e.confidence,
    employee_count:       e.effectifs,
    employee_growth:      null,
    talent_density_proxy: e.tranche_effectif ?? null,
    hiring_news:          [],
    llm_stack:            null,
  };
}

export function mapPappersToIROContext(e: PappersEntreprise): PappersIROContext {
  const nbDirigeants = e.dirigeants?.length ?? 0;

  // Signal AR : brevets IA sont un signal d'anticipation réglementaire
  const ar_signal_bonus = Math.min(2, e.brevets_ia);

  const fullLines: string[] = [
    `Dénomination : ${e.denomination}`,
    `SIREN : ${e.siren}`,
    e.siret ? `SIRET siège : ${e.siret}` : '',
    `Statut : ${e.statut}`,
    `Création : ${e.date_creation ?? 'Inconnue'} (${e.age_mois ?? '?'} mois)`,
    `Effectifs : ${e.effectifs != null ? e.effectifs : 'Inconnu'} (tranche : ${e.tranche_effectif ?? '?'})`,
    `Capital : ${e.capital_social_eur != null ? e.capital_social_eur.toLocaleString('fr-FR') + ' €' : 'Inconnu'}`,
    e.chiffre_affaires != null ? `CA : ${e.chiffre_affaires.toLocaleString('fr-FR')} €` : '',
    e.resultat_net     != null ? `Résultat net : ${e.resultat_net.toLocaleString('fr-FR')} €` : '',
    `Ville : ${e.ville ?? 'Inconnue'}${e.departement ? ' (' + e.departement + ')' : ''}${e.region ? ' — ' + e.region : ''}`,
    `NAF : ${e.activite_naf ? e.activite_naf + ' — ' : ''}${e.libelle_naf ?? 'Inconnu'}`,
    `Forme juridique : ${e.forme_juridique ?? 'Inconnue'}`,
    `Dirigeants (${nbDirigeants}) : ${e.dirigeants.map(d => `${d.prenom ? d.prenom + ' ' : ''}${d.nom} (${d.qualite})`).join(', ') || 'Non renseignés'}`,
    `Brevets totaux : ${e.brevets_count} dont IA/RF/HW : ${e.brevets_ia}`,
    e.bodacc_events.length
      ? `Bodacc : ${e.bodacc_events.map(b => `${b.date} — ${b.type}`).join(' | ')}`
      : 'Bodacc : Aucun événement',
    e.alerte_cessation    ? 'ALERTE : Cessation détectée' : '',
    e.alerte_redressement ? 'ALERTE : Redressement détecté' : '',
  ].filter(Boolean);

  return {
    age_mois:             e.age_mois ?? 24,
    team_size_small:      (e.effectifs ?? 0) < 10,
    single_founder_proxy: nbDirigeants === 1,
    ar_signal_bonus,
    cessation_alert:      e.alerte_cessation,
    redressement_alert:   e.alerte_redressement,
    full_context:         fullLines.join('\n'),
  };
}

// ══════════════════════════════════════════════════════════════════
// HOOK REACT
// ══════════════════════════════════════════════════════════════════

export function usePappers() {
  const [data,       setData]       = useState<PappersEntreprise | null>(null);
  const [iroContext, setIroContext]  = useState<PappersIROContext | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const fetch = useCallback(async (nameOrSiren: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPappersComplete(nameOrSiren);
      if (result) {
        setData(result);
        setIroContext(mapPappersToIROContext(result));
      } else {
        setError('Aucun résultat Pappers pour cette recherche.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur Pappers inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setIroContext(null);
    setError(null);
  }, []);

  return { data, iroContext, loading, error, fetch, reset };
}
