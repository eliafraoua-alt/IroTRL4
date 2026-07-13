/**
 * src/collectors/pipeline-n1000.ts
 * IROSTRENGTH v7.0.0 — Pipeline cohorte n=1000
 *
 * Extension de pipeline-n500.ts (70 startups → 1000 startups)
 */

import { orchestratePipeline, EnrichedStartupData } from './pipeline-orchestrator';
import { callLLMWithRouter } from '../utils/llm-router';
import { logger } from '../utils/logger';
import type { GoldStandardEntry, ModelVersion } from '../types/iro';

// ══════════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════

export interface N1000Config {
  batchSize:    number;      // startups par lot (défaut 20 — adapté au rate limit Gemini Flash)
  dryRun:       boolean;     // si true, ne persiste pas
  maxStartups:  number;      // plafond total (défaut 1000)
  sources:      N1000Source[];
  onProgress?:  (done: number, total: number, name: string) => void;
  onError?:     (name: string, error: string) => void;
}

export type N1000Source =
  | 'bpi'
  | 'france_digitale'
  | 'stationf'
  | 'pappers_naf'
  | 'crunchbase_fr'
  | 'eic'           // NOUVEAU — European Innovation Council
  | 'maddyness'     // NOUVEAU — levées FR 2019–2024
  | 'dealroom_fr'   // NOUVEAU — Dealroom via Gemini Search
  | 'bodacc_events'; // NOUVEAU — startups avec outcome event=1 connu via BODACC

export interface N1000Entry {
  name:             string;
  siren?:           string;
  crunchbase_slug?: string;
  linkedin_url?:    string;
  github_org?:      string;
  website_url?:     string;
  source:           N1000Source;
  vertical_hint:    string;
  country?:         'FR' | 'DE' | 'NL' | 'SE' | 'BE' | 'ES' | 'IT' | 'UK' | 'EU';
  // Pour BODACC : outcome pré-connu → évite annotation manuelle
  known_outcome?:   { event: 0 | 1; t_event_mois: number; source_outcome: string };
}

export interface AutoIROScore1000 {
  DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number;
  LU: number;              // NOUVEAU vs n500
  lu_type?: 'interne' | 'externe' | 'hybride';
  lu_data_gap?: boolean;   // REV9 : LU≥3 ET ADC≤1
  lu_ipc_anchor?: boolean; // REV10 : LU≥3 ET IPC≥3
  sce_estimate:    number;
  confidence:      'high' | 'medium' | 'low';
  needs_review:    boolean;
  auto_sources:    string[];
  justification?:  string;
}

export interface N1000Result {
  entry:        N1000Entry;
  enriched:     EnrichedStartupData;
  auto_iro:     AutoIROScore1000;
  gs_candidate: Partial<GoldStandardEntry>;
  collected_at: string;
  bodacc_check?: BodaccResult; // NOUVEAU
  error?:       string;
}

// ── BODACC types ──────────────────────────────────────────────────────────────
export interface BodaccResult {
  has_liquidation:    boolean;
  has_cessation:      boolean;
  has_redressement:   boolean;
  date_event?:        string;   // ISO date de l'événement BODACC
  t_event_mois?:      number;   // mois depuis fondation
  libelle?:           string;   // libellé BODACC brut
  siren?:             string;
  confidence:         'high' | 'low'; // high si trouvé via API, low si Gemini fallback
}

// Import dynamic data list after types are defined
import { STARTUP_UNIVERSE_N1000 } from './universe-n1000';

export { STARTUP_UNIVERSE_N1000 };

// ══════════════════════════════════════════════════════════════════════════════
// BODACC COLLECTOR — outcomes event=1 automatiques
// ══════════════════════════════════════════════════════════════════════════

export class BodaccCollector {
  private readonly BASE = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';

  async check(startupName: string, siren?: string): Promise<BodaccResult> {
    if (siren) {
      const result = await this._searchBySiren(siren);
      if (result) return result;
    }

    const resultByName = await this._searchByName(startupName);
    if (resultByName) return resultByName;

    return await this._fallbackGemini(startupName);
  }

  private async _searchBySiren(siren: string): Promise<BodaccResult | null> {
    try {
      const url = `${this.BASE}?where=registre%3D%22${siren}%22&limit=5&order_by=dateparution+DESC`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return null;
      const data = await resp.json();
      return this._parseResults(data.listings ?? data.results ?? [], 'high');
    } catch {
      return null;
    }
  }

  private async _searchByName(name: string): Promise<BodaccResult | null> {
    try {
      const encoded = encodeURIComponent(`"${name}"`);
      const url = `${this.BASE}?where=denomination%3D%22${encoded}%22&limit=3&order_by=dateparution+DESC`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return null;
      const data = await resp.json();
      return this._parseResults(data.listings ?? data.results ?? [], 'high');
    } catch {
      return null;
    }
  }

  private _parseResults(records: any[], confidence: 'high' | 'low'): BodaccResult | null {
    if (!records.length) return null;

    const EVENT_KEYWORDS = {
      liquidation:   /liquidation/i,
      redressement:  /redressement/i,
      cessation:     /cessation|radiation/i,
    };

    for (const r of records) {
      const libelle = (r.jugement?.famille ?? r.typeannonce ?? r.libelle ?? r.familleAnnonce ?? '').toLowerCase();
      const hasLiq   = EVENT_KEYWORDS.liquidation.test(libelle);
      const hasRed   = EVENT_KEYWORDS.redressement.test(libelle);
      const hasCess  = EVENT_KEYWORDS.cessation.test(libelle);

      if (hasLiq || hasRed || hasCess) {
        return {
          has_liquidation:   hasLiq,
          has_cessation:     hasCess,
          has_redressement:  hasRed,
          date_event:        r.dateparution ?? r.datePublication ?? undefined,
          libelle:           libelle,
          siren:             r.registre ?? r.siren ?? undefined,
          confidence,
        };
      }
    }
    return null;
  }

  private async _fallbackGemini(name: string): Promise<BodaccResult> {
    const prompt = `Recherche sur bodacc.fr et infogreffe.fr si la startup "${name}" a fait l'objet d'une procédure collective (liquidation judiciaire, redressement judiciaire, cessation d'activité) entre 2019 et 2026.
Réponds UNIQUEMENT en JSON :
{
  "has_liquidation": false,
  "has_cessation": false,
  "has_redressement": false,
  "date_event": null,
  "libelle": null
}
Si tu n'as pas d'information certaine, mets false pour tout.`;

    try {
      const { response } = await callLLMWithRouter(
        prompt,
        'Tu es un analyste juridique. Réponds UNIQUEMENT en JSON valide. RÈGLE ANTI-HALLUCINATION : si tu n\'es pas certain, mets false.',
        { timeoutMs: 15000, modelId: 'gemini-3-flash' }
      ).catch(() => ({ response: '{}' }));

      const m = response.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
      const p = m ? JSON.parse(m[0]) : {};
      return {
        has_liquidation:  Boolean(p.has_liquidation),
        has_cessation:    Boolean(p.has_cessation),
        has_redressement: Boolean(p.has_redressement),
        date_event:       p.date_event ?? undefined,
        libelle:          p.libelle ?? undefined,
        confidence:       'low',
      };
    } catch {
      return { has_liquidation: false, has_cessation: false, has_redressement: false, confidence: 'low' };
    }
  }

  toOutcome(result: BodaccResult, founded_year?: number): { event: 0 | 1; t_event_mois: number } | null {
    if (!result.has_liquidation && !result.has_redressement && !result.has_cessation) return null;

    let t_event_mois = 36; // défaut conservateur
    if (result.date_event && founded_year) {
      const eventDate   = new Date(result.date_event);
      const foundedDate = new Date(founded_year, 0, 1);
      t_event_mois = Math.max(1, Math.round((eventDate.getTime() - foundedDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
    }
    return { event: 1, t_event_mois };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTO SCORING IRO 7 DIMENSIONS
// ══════════════════════════════════════════════════════════════════════════════

export async function autoScoreIRO1000(
  name: string,
  enriched: EnrichedStartupData,
  vertical_hint: string,
  country: string = 'FR',
): Promise<AutoIROScore1000> {
  const ctx = [
    `STARTUP: ${name}`,
    `PAYS: ${country}`,
    `SECTEUR: ${vertical_hint}`,
    enriched.computed_funding_stage ? `FINANCEMENT: ${enriched.computed_funding_stage}` : '',
    enriched.computed_age_mois      ? `ÂGE: ${enriched.computed_age_mois} mois` : '',
    enriched.computed_employee_count ? `EFFECTIFS: ${enriched.computed_employee_count}` : '',
    `SOURCES: ${enriched.sources_used?.join(', ') || ''} (confiance: ${enriched.data_confidence})`,
    enriched.iro_hints?.di_hint  !== 2 ? `SIGNAL DI: ${enriched.iro_hints?.di_hint}` : '',
    enriched.iro_hints?.ar_hint  !== 1 ? `SIGNAL AR: ${enriched.iro_hints?.ar_hint}` : '',
    enriched.iro_hints?.lu_hint  !== 0 ? `SIGNAL LU: ${enriched.iro_hints?.lu_hint}` : '',
    enriched.grey_context ? `CONTEXTE GRIS:\n${enriched.grey_context.slice(0, 800)}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `${ctx}

Score les 7 dimensions IRO [0-4] pour cette startup et estime le SCE [0-10].
LU (Lead User Integration) mesure le niveau de co-construction avec des clients pilotes :
  0=aucun 1=déclaré 2=actif 3=co-développeur 4=ancré VRIN

Réponds UNIQUEMENT en JSON valide :
{
  "DI":2,"ADC":2,"IPC":2,"AR":2,"CA":2,"GCH":2,"LU":0,
  "lu_type":"externe",
  "lu_data_gap":false,
  "lu_ipc_anchor":false,
  "sce_estimate":5.0,
  "confidence":"medium",
  "needs_review":false,
  "justification_1phrase":"..."
}
Si données insuffisantes : mets 2 pour chaque dim, LU=0, confidence="low".`;

  try {
    const { response } = await callLLMWithRouter(
      prompt,
      'Tu es un analyste capital-risque spécialisé. Réponds UNIQUEMENT en JSON valide. ANTI-HALLUCINATION: base-toi uniquement sur les données fournies.',
      { timeoutMs: 25000, modelId: 'gemini-3-flash' }
    ).catch(() => ({ response: '{}' }));

    const m = response.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    const p = m ? JSON.parse(m[0]) : {};
    const clamp = (v: unknown, max = 4) => Math.max(0, Math.min(max, Math.round(parseFloat(String(v ?? 2)) || 2)));
    const lu = clamp(p.LU ?? 0);
    const adc = clamp(p.ADC ?? 2);
    const ipc = clamp(p.IPC ?? 2);

    return {
      DI:  clamp(p.DI),  ADC: adc, IPC: ipc,
      AR:  clamp(p.AR),  CA:  clamp(p.CA), GCH: clamp(p.GCH),
      LU:  lu,
      lu_type:      ['interne','externe','hybride'].includes(p.lu_type) ? p.lu_type : 'externe',
      lu_data_gap:  lu >= 3 && adc <= 1,   // REV9 automatique
      lu_ipc_anchor: lu >= 3 && ipc >= 3,  // REV10 automatique
      sce_estimate: Math.max(0, Math.min(10, parseFloat(String(p.sce_estimate ?? 5)) || 5)),
      confidence:   ['high','medium','low'].includes(p.confidence) ? p.confidence : 'low',
      needs_review: p.needs_review === true || p.confidence === 'low',
      auto_sources: enriched.sources_used || [],
      justification: String(p.justification_1phrase ?? ''),
    };
  } catch {
    return {
      DI:2, ADC:2, IPC:2, AR:2, CA:2, GCH:2, LU:0,
      lu_type:'externe', lu_data_gap:false, lu_ipc_anchor:false,
      sce_estimate:5, confidence:'low', needs_review:true, auto_sources:[],
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FORMATAGE GOLD STANDARD
// ══════════════════════════════════════════════════════════════════════════════

export function toGoldStandardEntry1000(
  idx:      number,
  entry:    N1000Entry,
  auto:     AutoIROScore1000,
  enriched: EnrichedStartupData,
  bodacc?:  BodaccResult | null,
): Partial<GoldStandardEntry> {
  const gsId = `gs-${(126 + idx).toString().padStart(3, '0')}`;

  let outcome: { event: 0 | 1; t_event_mois: number } | undefined;
  if (entry.known_outcome) {
    outcome = { event: entry.known_outcome.event, t_event_mois: entry.known_outcome.t_event_mois };
  } else if (bodacc) {
    const bodaccOutcome = new BodaccCollector().toOutcome(bodacc);
    if (bodaccOutcome) outcome = bodaccOutcome;
  }

  return {
    id:           gsId as any,
    name:         entry.name,
    vertical:     entry.vertical_hint,
    modelVersion: '4.5' as ModelVersion,
    migrated:     true,
    dateNotation: new Date().toISOString().split('T')[0],
    scores: {
      DI: auto.DI, ADC: auto.ADC, IPC: auto.IPC,
      AR: auto.AR, CA:  auto.CA,  GCH: auto.GCH,
      LU: auto.LU,
      lu_type:       auto.lu_type,
      lu_data_gap:   auto.lu_data_gap,
      lu_ipc_anchor: auto.lu_ipc_anchor,
    },
    sce:    {
      final: auto.sce_estimate,
      icc: auto.confidence === 'high' ? 0.82 : auto.confidence === 'medium' ? 0.72 : 0.55,
    },
    sourcesDocumentees: (enriched.sources_used || []).map(s => `auto:${s}`),
    ...(outcome && { outcome }),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT CSV ANNOTATURS
// ══════════════════════════════════════════════════════════════════════════════

export function exportN1000CSV(results: N1000Result[]): string {
  const headers = [
    'gs_id','name','pays','source','vertical',
    'DI','ADC','IPC','AR','CA','GCH','LU','lu_type',
    'sce_estimate','confidence','needs_review',
    'outcome_auto','outcome_reel','source_outcome','notes'
  ];
  const rows = results.map((r, i) => {
    const knownOutcome = r.entry.known_outcome;
    const bodaccEvent  = r.bodacc_check && (r.bodacc_check.has_liquidation || r.bodacc_check.has_redressement || r.bodacc_check.has_cessation);
    const autoOutcome  = knownOutcome ? knownOutcome.event : (bodaccEvent ? 1 : '');
    return [
      `gs-${(126 + i).toString().padStart(3,'0')}`,
      `"${r.entry.name}"`,
      r.entry.country ?? 'FR',
      r.entry.source,
      `"${r.entry.vertical_hint}"`,
      r.auto_iro.DI, r.auto_iro.ADC, r.auto_iro.IPC,
      r.auto_iro.AR, r.auto_iro.CA,  r.auto_iro.GCH, r.auto_iro.LU,
      r.auto_iro.lu_type ?? 'externe',
      r.auto_iro.sce_estimate,
      r.auto_iro.confidence,
      r.auto_iro.needs_review ? '1' : '0',
      autoOutcome,
      '',
      `"${knownOutcome?.source_outcome ?? r.bodacc_check?.libelle ?? ''}"`,
      `"${r.auto_iro.justification ?? ''}"`,
    ].join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
// PIPELINE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

export async function runPipelineN1000(
  config: Partial<N1000Config> = {}
): Promise<{ results: N1000Result[]; csv: string; gs_entries: Partial<GoldStandardEntry>[] }> {
  const {
    batchSize   = 20,
    dryRun      = true,
    maxStartups = 1000,
    sources     = ['bpi','france_digitale','stationf','pappers_naf','crunchbase_fr','eic','maddyness','dealroom_fr'],
    onProgress,
    onError,
  } = config;

  const bodacc = new BodaccCollector();

  const universe = STARTUP_UNIVERSE_N1000
    .filter(e => sources.includes(e.source))
    .slice(0, maxStartups);

  const results: N1000Result[]                    = [];
  const gs_entries: Partial<GoldStandardEntry>[]  = [];

  logger.info(`[N1000] Démarrage pipeline. ${universe.length} startups à traiter.`, { batchSize, dryRun });
  logger.info(`[N1000] Outcomes pré-connus : ${universe.filter(e => e.known_outcome).length}`);

  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(async (entry, j) => {
        const idx = i + j;
        try {
          // 1. Collecte multi-sources
          const enriched = await orchestratePipeline(entry.name, {
            crunchbaseSlug:   entry.crunchbase_slug,
            linkedinUrl:      entry.linkedin_url,
            githubOrg:        entry.github_org,
            sirenOrSiret:     entry.siren,
            websiteUrl:       entry.website_url,
            useFrenchSources: entry.country === 'FR' || !entry.country,
            useGreySources:   true,
          });

          // 2. BODACC check
          let bodaccResult: BodaccResult | null = null;
          if (!entry.known_outcome && (entry.siren || (entry.country === 'FR' || !entry.country))) {
            bodaccResult = await bodacc.check(entry.name, entry.siren).catch(() => null);
          }

          // 3. Scoring IRO 7D
          const auto_iro = await autoScoreIRO1000(
            entry.name, enriched, entry.vertical_hint, entry.country ?? 'FR'
          );

          // 4. Formatage Gold Standard
          const gs_candidate = toGoldStandardEntry1000(idx, entry, auto_iro, enriched, bodaccResult);

          const result: N1000Result = {
            entry,
            enriched,
            auto_iro,
            gs_candidate,
            bodacc_check: bodaccResult ?? undefined,
            collected_at: new Date().toISOString(),
          };

          onProgress?.(idx + 1, universe.length, entry.name);

          if (!dryRun) {
            try {
              const AuditJournalMod = await import('../utils/audit-journal');
              AuditJournalMod.addEntry({
                timestamp:         result.collected_at,
                startup_name:      entry.name,
                iro_total:         (auto_iro.DI + auto_iro.ADC + auto_iro.IPC + auto_iro.AR + auto_iro.CA + auto_iro.GCH) / 6 * 20,
                iro_cr:            0,
                srd:               0,
                DI: auto_iro.DI, ADC: auto_iro.ADC, IPC: auto_iro.IPC,
                AR: auto_iro.AR, CA:  auto_iro.CA,  GCH: auto_iro.GCH,
                ipc_conf: 0.8, adc_conf: 0.8, gch_conf: 0.8,
                trl:           5,
                evaluator:     'E_AUTO_N1000',
                model_version: 'IRO v4.9-ES',
                source_type:   'import' as const,
                goodhart_patterns: '[]',
                notes: `auto:n1000:${entry.source}:${entry.country ?? 'FR'}:confidence=${auto_iro.confidence}:LU=${auto_iro.LU}`,
                status: 'unknown' as const,
              });
            } catch (e) {
              logger.warn('[N1000] Erreur persistence', { error: String(e) });
            }
          }

          return result;
        } catch (e: any) {
          const msg = e?.message ?? 'Erreur inconnue';
          onError?.(entry.name, msg);
          logger.warn(`[N1000] Erreur ${entry.name}`, { error: msg });
          return {
            entry,
            enriched: null as any,
            auto_iro: { DI:2,ADC:2,IPC:2,AR:2,CA:2,GCH:2,LU:0, lu_type:'externe' as const,
              lu_data_gap:false, lu_ipc_anchor:false, sce_estimate:5,
              confidence:'low' as const, needs_review:true, auto_sources:[] },
            gs_candidate: {},
            collected_at: new Date().toISOString(),
            error: msg,
          } as N1000Result;
        }
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
        if (r.value.gs_candidate && !r.value.error) gs_entries.push(r.value.gs_candidate);
      }
    }

    if (i + batchSize < universe.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if ((i + batchSize) % 100 === 0 || i + batchSize >= universe.length) {
      const done    = Math.min(i + batchSize, universe.length);
      const success = results.filter(r => !r.error).length;
      const events  = results.filter(r => r.gs_candidate?.outcome?.event === 1).length;
      logger.info(`[N1000] Progression: ${done}/${universe.length} — ${success} OK — ${events} event=1 détectés`);
    }
  }

  const csv = exportN1000CSV(results.filter(r => !r.error));
  const knownEvents = results.filter(r => r.gs_candidate?.outcome?.event === 1).length;
  const bodaccEvents = results.filter(r => r.bodacc_check && (r.bodacc_check.has_liquidation || r.bodacc_check.has_redressement)).length;

  logger.info(`[N1000] Terminé.`, {
    total:         universe.length,
    success:       results.filter(r => !r.error).length,
    needs_review:  results.filter(r => r.auto_iro?.needs_review).length,
    known_event1:  knownEvents,
    bodacc_event1: bodaccEvents,
    epv_estimate:  `${knownEvents + bodaccEvents} events / 7 dims = EPV ≈ ${((knownEvents + bodaccEvents) / 7).toFixed(1)}`,
    lu_scored:     results.filter(r => (r.auto_iro?.LU ?? 0) > 0).length,
  });

  return { results, csv, gs_entries };
}

// ── Bloc d'exécution directe CLI ──────────────────────────────────────────────

const isMain = typeof process !== 'undefined' && process.argv && process.argv[1] && (
  process.argv[1].endsWith('pipeline-n1000.ts') || 
  process.argv[1].endsWith('pipeline-n1000')
);

if (isMain) {
  const hasDryArg = process.argv.includes('--dry') || process.argv.slice(2).some(arg => arg.includes('dry'));
  const dryRun = true; // par défaut
  const maxStartups = hasDryArg ? 5 : 1000;
  const batchSize = hasDryArg ? 2 : 20;

  logger.info(`[N1000] Lancement CLI pipeline : dryRun=${dryRun}, maxStartups=${maxStartups}, batchSize=${batchSize}`);
  runPipelineN1000({ batchSize, dryRun, maxStartups })
    .then(res => {
      console.log(`--- RECAPITULATIF PIPELINE N1000 (dryRun: ${dryRun}) ---`);
      console.log(`Traitées: ${res.results.length}`);
      console.log(`Succès: ${res.results.filter(r => !r.error).length}`);
      console.log(`Erreurs: ${res.results.filter(r => r.error).length}`);
      console.log(`Structure CSV:\n${res.csv.slice(0, 500)}...`);
      process.exit(0);
    })
    .catch(err => {
      console.error('[N1000] Erreur fatale durant le lancement en direct:', err);
      process.exit(1);
    });
}
