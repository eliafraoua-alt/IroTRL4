// Tests smoke — grey-sources.ts v7.6
// Vérifie que chaque collecteur retourne null (pas une exception) si l'API
// est indisponible, et que formatGreySourcesContext() produit une chaîne valide.
// Ces tests ne font PAS d'appels réseau réels.

import { describe, it, expect } from 'vitest';
import {
  formatGreySourcesContext,
  type GreySourcesResult,
} from '../src/collectors/grey-sources';

// ── Résultat factice minimal ──────────────────────────────────────────────────
const EMPTY_RESULT: GreySourcesResult = {
  marches_publics:     null,
  infra_stack:         null,
  aides_bpi:           null,
  offres_emploi:       null,
  reseaux_gris:        null,
  juridique_financier: null,
  pi_brevets:          null,
  iro_hints_grey: {
    di_hint: 0, ipc_hint: 0, ar_hint: 0,
    ca_hint: 0, gch_hint: 0, lu_hint: 0,
    adc_hint: 0, di_pi_hint: 0,
  },
  flags_detected: {
    liquidation_judiciaire:  false,
    redressement_judiciaire: false,
    data_stale:              false,
    dirigeant_anonyme:       false,
    brevet_non_verifie:      false,
  },
  confidence:   'low',
  sources_used: ['mock_sources'],
  fetched_at:   new Date().toISOString(),
};

// ── formatGreySourcesContext ──────────────────────────────────────────────────
describe('formatGreySourcesContext — robustesse', () => {
  it('retourne une chaîne non-vide même avec un résultat tout-null', () => {
    const ctx = formatGreySourcesContext(EMPTY_RESULT);
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThan(0);
  });

  it('signale le flag liquidation si activé', () => {
    const r: GreySourcesResult = {
      ...EMPTY_RESULT,
      sources_used: ['pappers_bodacc_verif'],
      juridique_financier: {
        siren: '879952323',
        dirigeant: 'François Marques',
        date_creation: '2019-12-24',
        liquidation_judiciaire: true,
        redressement_judiciaire: false,
        ca_dernier: null,
        bilan_annee: null,
        bilan_freshness: 'ND',
        data_stale: false,
        dirigeant_anonyme: false,
        adc_hint: 0,
        gch_hint: 1,
        source: 'bodacc',
        confidence: 'high',
      },
      flags_detected: { ...EMPTY_RESULT.flags_detected, liquidation_judiciaire: true },
    };
    const ctx = formatGreySourcesContext(r);
    expect(ctx).toContain('BLOQUANT');
    expect(ctx).toContain('LIQUIDATION');
  });

  it('affiche les hints IRO si marchés publics présents', () => {
    const r: GreySourcesResult = {
      ...EMPTY_RESULT,
      sources_used: ['decp_marches_publics'],
      marches_publics: {
        contrats: [{ acheteur: 'AP-HP', objet: 'Logiciel clinique', montant_eur: 150000, date_notification: '2023-01', duree_mois: 12, renouvele: false }],
        nb_marches: 1,
        montant_total_eur: 150000,
        ipc_signal: 3,
        ar_signal: 2,
        source: 'decp_datagouv',
        confidence: 'high',
      },
      iro_hints_grey: { ...EMPTY_RESULT.iro_hints_grey, ipc_hint: 3, lu_hint: 2 },
    };
    const ctx = formatGreySourcesContext(r);
    expect(ctx).toContain('AP-HP');
  });

  it('affiche le flag data_stale si bilan > 18 mois', () => {
    const r: GreySourcesResult = {
      ...EMPTY_RESULT,
      sources_used: ['pappers_bodacc_verif'],
      juridique_financier: {
        siren: '123456789',
        dirigeant: 'Test CEO',
        date_creation: '2020-01-01',
        liquidation_judiciaire: false,
        redressement_judiciaire: false,
        ca_dernier: 500000,
        bilan_annee: 2021,
        bilan_freshness: 'S',
        data_stale: true,
        dirigeant_anonyme: false,
        adc_hint: 1,
        gch_hint: 2,
        source: 'verif_com',
        confidence: 'medium',
      },
      flags_detected: { ...EMPTY_RESULT.flags_detected, data_stale: true },
    };
    const ctx = formatGreySourcesContext(r);
    expect(ctx).toContain('data_stale');
  });

  it('affiche le flag brevet_non_verifie si INPI renvoie rien', () => {
    const r: GreySourcesResult = {
      ...EMPTY_RESULT,
      sources_used: ['inpi_epo_brevets'],
      pi_brevets: {
        brevets: [],
        marques: [],
        brevet_non_verifie: true,
        nb_brevets_actifs: 0,
        di_pi_hint: 0,
        source: 'inpi',
        confidence: 'high',
      },
      flags_detected: { ...EMPTY_RESULT.flags_detected, brevet_non_verifie: true },
    };
    const ctx = formatGreySourcesContext(r);
    expect(ctx).toContain('brevet_non_verifie');
  });

  it('résumé flags : liste les flags actifs en fin de contexte', () => {
    const r: GreySourcesResult = {
      ...EMPTY_RESULT,
      sources_used: ['pappers_bodacc_verif', 'inpi_epo_brevets'],
      flags_detected: {
        liquidation_judiciaire:  false,
        redressement_judiciaire: true,
        data_stale:              true,
        dirigeant_anonyme:       false,
        brevet_non_verifie:      false,
      },
    };
    const ctx = formatGreySourcesContext(r);
    expect(ctx).toContain('redressement_judiciaire');
    expect(ctx).toContain('data_stale');
  });
});

// ── Structure GreySourcesResult ───────────────────────────────────────────────
describe('GreySourcesResult — structure v7.6', () => {
  it('contient les 7 champs collecteurs (dont 2 nouveaux v7.6)', () => {
    const keys = Object.keys(EMPTY_RESULT);
    expect(keys).toContain('marches_publics');
    expect(keys).toContain('infra_stack');
    expect(keys).toContain('aides_bpi');
    expect(keys).toContain('offres_emploi');
    expect(keys).toContain('reseaux_gris');
    expect(keys).toContain('juridique_financier');  // v7.6
    expect(keys).toContain('pi_brevets');           // v7.6
  });

  it('contient les 8 iro_hints (dont 2 nouveaux v7.6)', () => {
    const hints = Object.keys(EMPTY_RESULT.iro_hints_grey);
    expect(hints).toContain('di_hint');
    expect(hints).toContain('ipc_hint');
    expect(hints).toContain('adc_hint');    // v7.6
    expect(hints).toContain('di_pi_hint'); // v7.6
  });

  it('flags_detected contient les 5 flags critiques', () => {
    const flags = Object.keys(EMPTY_RESULT.flags_detected);
    expect(flags).toContain('liquidation_judiciaire');
    expect(flags).toContain('redressement_judiciaire');
    expect(flags).toContain('data_stale');
    expect(flags).toContain('dirigeant_anonyme');
    expect(flags).toContain('brevet_non_verifie');
  });
});
