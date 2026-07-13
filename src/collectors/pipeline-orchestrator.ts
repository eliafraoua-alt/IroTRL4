/**
 * src/collectors/pipeline-orchestrator.ts
 * IRO Strength v7.5 — Orchestrateur multi-sources + sources grises
 *
 * Combines Crunchbase + LinkedIn + INPI + GitHub + Sources Grises → IROResult enrichi
 */

import { fetchCrunchbase, mapCrunchbaseToIRO, CrunchbaseCompany } from './crunchbase';
import { fetchLinkedInViaGemini, mapLinkedInToGCH, LinkedInCompanyData } from './linkedin';
import { fetchINPI, mapINPIToIRO, INPIData } from './inpi';
import {
  collectGreySources,
  formatGreySourcesContext,
  GreySourcesResult,
} from './grey-sources';
import {
  collectPressIntelligence,
  formatPressIntelligenceContext,
  PressIntelligenceResult,
} from './press-intelligence';

export interface EnrichedStartupData {
  name:             string;
  crunchbase?:      CrunchbaseCompany  | null;
  linkedin?:        LinkedInCompanyData | null;
  inpi?:            INPIData           | null;
  github_data?:     Record<string, unknown> | null;
  /** Sources grises (v7.5) : marchés publics, infra stack, BPI, offres emploi, réseaux gris. */
  grey_sources?:    GreySourcesResult  | null;
  /** Contexte formaté prêt à injecter dans le prompt LLM. */
  grey_context?:    string;
  /** Presse Intelligence (v8.0) : revue de presse exhaustive + pipeline NLP multi-passes. */
  press_intelligence?: PressIntelligenceResult | null;
  /** Contexte presse formaté prêt à injecter dans le prompt LLM. */
  press_context?:      string;
  computed_age_mois:      number;
  computed_employee_count: number | null;
  computed_funding_stage:  string;
  iro_hints: {
    di_hint:  number;   // signal DI [0-4] : stack + Malt + CIR + offres emploi
    adc_hint: number;   // signal ADC depuis LinkedIn/INPI
    ipc_hint: number;   // signal IPC : marchés publics DECP + Crunchbase
    ar_hint:  number;   // signal AR : marchés publics + headers sécurité + INPI
    ca_hint:  number;   // signal CA : BPI + recrutement commercial + web archive
    gch_hint: number;   // signal GCH : Glassdoor + offres emploi + LinkedIn
    lu_hint:  number;   // signal LU : clauses co-dev marchés publics
  };
  data_confidence: 'high' | 'medium' | 'low';
  sources_used:    string[];
}

export async function orchestratePipeline(
  startupName: string,
  opts: {
    crunchbaseSlug?:   string;
    linkedinUrl?:      string;
    githubOrg?:        string;
    sirenOrSiret?:     string;
    websiteUrl?:       string;
    useFrenchSources?: boolean;
    useGreySources?:   boolean;  // v7.5 — sources grises (true par défaut pour startups FR)
    usePressIntelligence?: boolean; // v8.0 — revue de presse exhaustive (true par défaut)
    pitchText?:        string;   // v8.0 — active la détection de contradictions presse
  } = {}
): Promise<EnrichedStartupData> {

  const sources: string[] = [];
  let cb: CrunchbaseCompany | null = null;
  let li: LinkedInCompanyData | null = null;
  let inpiData: INPIData | null = null;
  let grey: GreySourcesResult | null = null;
  let press: PressIntelligenceResult | null = null;

  // ── Collecte parallèle — toutes les sources en simultané ─────────────────
  const [cbResult, liResult, inpiResult, greyResult, pressResult] = await Promise.allSettled([
    fetchCrunchbase(opts.crunchbaseSlug ?? startupName, { fallbackGemini: true }),
    fetchLinkedInViaGemini(startupName),
    opts.useFrenchSources !== false
      ? fetchINPI(opts.sirenOrSiret || startupName)
      : Promise.resolve(null),
    opts.useGreySources !== false
      ? collectGreySources(startupName, {
          sirenOrSiret: opts.sirenOrSiret,
          websiteUrl:   opts.websiteUrl,
        })
      : Promise.resolve(null),
    opts.usePressIntelligence !== false
      ? collectPressIntelligence(startupName, { pitchText: opts.pitchText })
      : Promise.resolve(null),
  ]);

  if (cbResult.status   === 'fulfilled' && cbResult.value)   { cb = cbResult.value;   sources.push(cb.source); }
  if (liResult.status   === 'fulfilled' && liResult.value)   { li = liResult.value;   sources.push('linkedin'); }
  if (inpiResult.status === 'fulfilled' && inpiResult.value && 'denomination' in inpiResult.value) {
    inpiData = inpiResult.value as INPIData;
    sources.push('pappers/inpi');
  }
  if (greyResult.status === 'fulfilled' && greyResult.value) {
    grey = greyResult.value;
    sources.push(...grey.sources_used);
  }
  if (pressResult.status === 'fulfilled' && pressResult.value) {
    press = pressResult.value;
    sources.push(...press.sources_used);
  }

  // ── Calcul des hints IRO ─────────────────────────────────────────────────
  const cbMapped   = cb       ? mapCrunchbaseToIRO(cb)   : null;
  const liMapped   = li       ? mapLinkedInToGCH(li)     : null;
  const inpiMapped = inpiData ? mapINPIToIRO(inpiData)   : null;
  const greyHints  = grey?.iro_hints_grey;
  const pressHints = press?.iro_hints_presse;

  // Fusion pondérée des hints multi-sources : base standard (poids 1) + sources
  // grises et presse (poids 0/1/2 selon leur confiance respective).
  const greyWeight  = grey?.confidence  === 'high' ? 2 : grey?.confidence  === 'medium' ? 1 : 0;
  const pressWeight = press?.confidence === 'high' ? 2 : press?.confidence === 'medium' ? 1 : 0;
  const stdWeight   = 1;

  function mergeHint(stdVal: number, greyVal?: number, pressVal?: number): number {
    let sum = stdVal * stdWeight;
    let totalWeight = stdWeight;
    if (greyVal !== undefined && greyWeight > 0)   { sum += greyVal * greyWeight;   totalWeight += greyWeight; }
    if (pressVal !== undefined && pressWeight > 0) { sum += pressVal * pressWeight; totalWeight += pressWeight; }
    return Math.round(sum / totalWeight);
  }

  // Confidence globale
  const highCount = sources.filter(s =>
    ['crunchbase_api', 'pappers/inpi', 'decp_marches_publics', 'bpi_aides'].includes(s)
  ).length;
  const confidence: 'high' | 'medium' | 'low' =
    highCount >= 2 ? 'high' : highCount >= 1 ? 'medium' : 'low';

  // Contexte sources grises + presse pour injection dans le prompt LLM
  const greyContext  = grey  ? formatGreySourcesContext(grey)         : '';
  const pressContext = press ? formatPressIntelligenceContext(press)  : '';

  return {
    name:                    startupName,
    crunchbase:              cb,
    linkedin:                li,
    inpi:                    inpiData,
    grey_sources:            grey,
    grey_context:            greyContext || undefined,
    press_intelligence:      press,
    press_context:           pressContext || undefined,
    computed_age_mois:       inpiMapped?.age_mois ?? cbMapped?.age_mois ?? 24,
    computed_employee_count: liMapped ? (li?.employee_count ?? null) : (cbMapped?.employee_count ?? null),
    computed_funding_stage:  cbMapped?.stade_financement ?? 'Inconnu',
    iro_hints: {
      di_hint:  mergeHint(2, greyHints?.di_hint,  pressHints?.di_hint),
      adc_hint: mergeHint(1, greyHints?.adc_hint, pressHints?.adc_hint), // ADC reste conservateur sans données propriétaires vérifiables
      ipc_hint: mergeHint(1, greyHints?.ipc_hint, pressHints?.ipc_hint),
      ar_hint:  mergeHint(inpiMapped?.ar_signal_bonus ?? 1, greyHints?.ar_hint,  pressHints?.ar_hint),
      ca_hint:  mergeHint(liMapped?.ca_signal ?? 1,         greyHints?.ca_hint,  pressHints?.ca_hint),
      gch_hint: mergeHint(liMapped?.gch_signal ?? 1,        greyHints?.gch_hint, pressHints?.gch_hint),
      lu_hint:  greyHints?.lu_hint ?? 1, // signal LU réservé aux marchés publics (sources grises)
    },
    data_confidence: confidence,
    sources_used:    sources,
  };
}
