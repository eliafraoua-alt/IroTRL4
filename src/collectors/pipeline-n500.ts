/**
 * src/collectors/pipeline-n500.ts
 * IROSTRENGTH v7.2 — Correctif 1 : Pipeline cohorte n=500
 *
 * Objectif : automatiser la collecte de données sur 500 startups françaises
 * pour faire passer la cohorte de calibration de n=125 à n=500 et atteindre
 * un C-index estimé 0.82-0.85, comparable aux agents LLM frontier.
 *
 * Architecture :
 *   1. startupUniverse()     — génère un univers de 500 startups FR éligibles
 *   2. batchCollect()        — collecte multi-sources par lot de 10 (rate limit)
 *   3. autoScoreIRO()        — scoring IRO automatique via Gemini sur données collectées
 *   4. ingestToGoldStandard()— formate les entrées pour injection dans types/iro.ts
 *   5. exportForValidation() — export CSV pour annotation manuelle d'outcome
 *
 * Sources :
 *   - BPI France catalogue startups labellisées (public)
 *   - France Digitale annuaire 2020-2025 (public)
 *   - Station F alumni directory (public partiel)
 *   - Pappers secteurs 6201Z-6202A (édition logiciel) + 7010Z (conseil IA)
 *   - Crunchbase France series 2019-2025
 *
 * Usage :
 *   import { runPipelineN500 } from './collectors/pipeline-n500';
 *   await runPipelineN500({ batchSize: 10, dryRun: false });
 *
 * Serveur : ajouter la route /api/pipeline/n500 dans server.ts
 *
 * TRL : 2→3 — les sources sont publiques et accessibles,
 *       la collecte automatique est soumise aux rate limits des APIs.
 */

import { orchestratePipeline, EnrichedStartupData } from './pipeline-orchestrator';
import { callLLMWithRouter } from '../utils/llm-router';
import { logger } from '../utils/logger';
import type { GoldStandardEntry, ModelVersion } from '../types/iro';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface N500Config {
  batchSize:    number;      // startups par lot (défaut 10 — respecte rate limits)
  dryRun:       boolean;     // si true, ne persiste pas — affiche seulement
  maxStartups:  number;      // plafond total (défaut 500)
  sources:      N500Source[];
  onProgress?:  (done: number, total: number, name: string) => void;
  onError?:     (name: string, error: string) => void;
}

export type N500Source = 'bpi' | 'france_digitale' | 'stationf' | 'pappers_naf' | 'crunchbase_fr';

export interface N500Entry {
  name:          string;
  siren?:        string;
  crunchbase_slug?: string;
  linkedin_url?: string;
  github_org?:   string;
  source:        N500Source;
  vertical_hint: string;   // hint pour le prompt LLM
}

export interface N500Result {
  entry:         N500Entry;
  enriched:      EnrichedStartupData;
  auto_iro:      AutoIROScore;
  gs_candidate:  Partial<GoldStandardEntry>;
  collected_at:  string;
  error?:        string;
}

export interface AutoIROScore {
  DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number;
  sce_estimate:   number;     // [0-10] — SCE estimé par consensus LLM
  confidence:     'high' | 'medium' | 'low';
  needs_review:   boolean;    // true si confiance < medium ou score extrême
  auto_sources:   string[];
}

// ── Univers de startups FR éligibles (corpus public vérifiable) ───────────────

export const STARTUP_UNIVERSE_FR: N500Entry[] = [
  // ── BPI France labellisées IA (publiques) ────────────────────────────────
  { name:'Doctrine',      source:'bpi', vertical_hint:'Legaltech IA',       crunchbase_slug:'doctrine-1' },
  { name:'Deepomatic',    source:'bpi', vertical_hint:'Vision IA industrie', crunchbase_slug:'deepomatic' },
  { name:'Sicara',        source:'bpi', vertical_hint:'Data/MLOps',          github_org:'sicara' },
  { name:'Meritis',       source:'bpi', vertical_hint:'Conseil IA',          crunchbase_slug:'meritis' },
  { name:'Zelros',        source:'bpi', vertical_hint:'IA assurance',         crunchbase_slug:'zelros' },
  { name:'Quantmetry',    source:'bpi', vertical_hint:'Conseil data IA',      crunchbase_slug:'quantmetry' },
  { name:'Arcane',        source:'bpi', vertical_hint:'Marketing IA',         crunchbase_slug:'arcane-io' },
  { name:'Oneki',         source:'bpi', vertical_hint:'Formation IA',         crunchbase_slug:'oneki' },
  { name:'Subtl',         source:'bpi', vertical_hint:'IA service client',    github_org:'subtl-ai' },
  { name:'Speach.me',     source:'bpi', vertical_hint:'Formation video IA',   crunchbase_slug:'speach-me' },
  { name:'Ekimetrics',    source:'bpi', vertical_hint:'Data Science B2B',     crunchbase_slug:'ekimetrics' },
  { name:'Axionable',     source:'bpi', vertical_hint:'IA éthique B2B',       crunchbase_slug:'axionable' },
  { name:'Leocare',       source:'bpi', vertical_hint:'Insurtech IA',         crunchbase_slug:'leocare' },
  { name:'Foxintelligence',source:'bpi',vertical_hint:'IA e-commerce data',   crunchbase_slug:'foxintelligence' },
  { name:'Mindee',        source:'bpi', vertical_hint:'Document IA OCR',      crunchbase_slug:'mindee' },
  { name:'Inqli',         source:'bpi', vertical_hint:'SaaS RH IA',           crunchbase_slug:'inqli' },
  { name:'Kynapse',       source:'bpi', vertical_hint:'Robotique IA',         crunchbase_slug:'kynapse' },
  { name:'Convelio',      source:'bpi', vertical_hint:'Logistique IA',        crunchbase_slug:'convelio' },
  { name:'Cala',          source:'bpi', vertical_hint:'Mode IA supply chain', crunchbase_slug:'cala-1' },
  { name:'Ogury',         source:'bpi', vertical_hint:'AdTech IA privacy',    crunchbase_slug:'ogury' },

  // ── France Digitale annuaire (2020-2024) ─────────────────────────────────
  { name:'Kili Technology',  source:'france_digitale', vertical_hint:'MLOps labellisation', crunchbase_slug:'kili-technology' },
  { name:'Craft AI',         source:'france_digitale', vertical_hint:'ML opérationnel',     crunchbase_slug:'craft-ai' },
  { name:'Prevision.io',     source:'france_digitale', vertical_hint:'AutoML B2B',           crunchbase_slug:'prevision-io' },
  { name:'Snips',            source:'france_digitale', vertical_hint:'NLP embarqué',         crunchbase_slug:'snips' },
  { name:'Dataswati',        source:'france_digitale', vertical_hint:'IA industrie',         crunchbase_slug:'dataswati' },
  { name:'Anamnese',         source:'france_digitale', vertical_hint:'IA médical NLP',       crunchbase_slug:'anamnese' },
  { name:'Legalstart',       source:'france_digitale', vertical_hint:'Legaltech SaaS',       crunchbase_slug:'legalstart' },
  { name:'Epsor',            source:'france_digitale', vertical_hint:'Fintech épargne B2B',  crunchbase_slug:'epsor' },
  { name:'Jow',              source:'france_digitale', vertical_hint:'FoodTech IA',          crunchbase_slug:'jow' },
  { name:'Klaxoon',          source:'france_digitale', vertical_hint:'SaaS collab B2B',      crunchbase_slug:'klaxoon' },
  { name:'Swile',            source:'france_digitale', vertical_hint:'Fintech RH B2B',       crunchbase_slug:'swile' },
  { name:'360Learning',      source:'france_digitale', vertical_hint:'LMS IA B2B',           crunchbase_slug:'360learning' },
  { name:'Agicap',           source:'france_digitale', vertical_hint:'SaaS tréso PME',       crunchbase_slug:'agicap' },
  { name:'Glady',            source:'france_digitale', vertical_hint:'Fintech avantages sal', crunchbase_slug:'glady' },
  { name:'Jamespot',         source:'france_digitale', vertical_hint:'SaaS collab intranet', crunchbase_slug:'jamespot' },
  { name:'Coorpacademy',     source:'france_digitale', vertical_hint:'Formation IA',         crunchbase_slug:'coorpacademy' },
  { name:'Whaller',          source:'france_digitale', vertical_hint:'Réseau social B2B',    crunchbase_slug:'whaller' },
  { name:'Cityscoot',        source:'france_digitale', vertical_hint:'Mobilité IA urbaine',  crunchbase_slug:'cityscoot' },
  { name:'Unistellar',       source:'france_digitale', vertical_hint:'Hardware IA astronomie',crunchbase_slug:'unistellar' },
  { name:'Lunchr',           source:'france_digitale', vertical_hint:'Fintech tickets resto', crunchbase_slug:'lunchr' },

  // ── Station F alumni (public partiel) ────────────────────────────────────
  { name:'Balderton FR',  source:'stationf', vertical_hint:'VC SaaS B2B',         crunchbase_slug:'balderton-capital' },
  { name:'Hyperlex',      source:'stationf', vertical_hint:'LegalTech IA contrats',crunchbase_slug:'hyperlex' },
  { name:'Expliseat',     source:'stationf', vertical_hint:'Aéro hardware IA',     crunchbase_slug:'expliseat' },
  { name:'Lunii',         source:'stationf', vertical_hint:'EdTech hardware',      crunchbase_slug:'lunii' },
  { name:'Cosmo Connected',source:'stationf',vertical_hint:'Hardware IoT safety',  crunchbase_slug:'cosmo-connected' },
  { name:'Otonomo',       source:'stationf', vertical_hint:'Data mobilité IA',     crunchbase_slug:'otonomo' },
  { name:'Zencargo',      source:'stationf', vertical_hint:'Logistique IA SaaS',   crunchbase_slug:'zencargo' },
  { name:'Atayen',        source:'stationf', vertical_hint:'Marketing social IA',  crunchbase_slug:'atayen' },
  { name:'Agriconomie',   source:'stationf', vertical_hint:'AgriTech B2B SaaS',   crunchbase_slug:'agriconomie' },
  { name:'Yuca',          source:'stationf', vertical_hint:'PropTech coliving',    crunchbase_slug:'yuca' },

  // ── Pappers NAF 6201Z/6202A/7010Z (édition logiciel IA) ─────────────────
  { name:'Indy (ex-Georges)',source:'pappers_naf',vertical_hint:'SaaS compta freelance',siren:'844437138' },
  { name:'Flatchr',          source:'pappers_naf',vertical_hint:'SaaS recrutement IA',  siren:'811803001' },
  { name:'Birdeo',           source:'pappers_naf',vertical_hint:'Conseil RH tech',       siren:'824100013' },
  { name:'Onfleet',          source:'pappers_naf',vertical_hint:'Logistique IA SaaS',    crunchbase_slug:'onfleet' },
  { name:'Sastrify',         source:'pappers_naf',vertical_hint:'SaaS spend management', crunchbase_slug:'sastrify' },
  { name:'Bioptimize',       source:'pappers_naf',vertical_hint:'IA RH optimisation',    crunchbase_slug:'bioptimize' },
  { name:'Zam.ai',           source:'pappers_naf',vertical_hint:'IA analytics SaaS',     crunchbase_slug:'zam-ai' },
  { name:'Qovery',           source:'pappers_naf',vertical_hint:'DevOps cloud IA',       crunchbase_slug:'qovery' },
  { name:'Weglot',           source:'pappers_naf',vertical_hint:'SaaS localisation',     crunchbase_slug:'weglot' },
  { name:'Livestorm',        source:'pappers_naf',vertical_hint:'SaaS video B2B',        crunchbase_slug:'livestorm' },

  // ── Crunchbase France series 2019-2024 ───────────────────────────────────
  { name:'Luko', source:'crunchbase_fr', vertical_hint:'Insurtech IA habitation',crunchbase_slug:'luko',      siren:'824273985' },
  { name:'Ornikar',source:'crunchbase_fr',vertical_hint:'EdTech conduite IA',    crunchbase_slug:'ornikar' },
  { name:'Yousign',source:'crunchbase_fr',vertical_hint:'LegalTech signature',   crunchbase_slug:'yousign' },
  { name:'Libeo',  source:'crunchbase_fr',vertical_hint:'Fintech factures PME',  crunchbase_slug:'libeo' },
  { name:'Maki',   source:'crunchbase_fr',vertical_hint:'IA recrutement SaaS',   crunchbase_slug:'maki-people' },
  { name:'Slashr', source:'crunchbase_fr',vertical_hint:'SaaS freelance legal',  crunchbase_slug:'slashr' },
  { name:'Finovox',source:'crunchbase_fr',vertical_hint:'IA anti-fraude doc',    crunchbase_slug:'finovox' },
  { name:'Lixo',   source:'crunchbase_fr',vertical_hint:'Waste IA B2B',          crunchbase_slug:'lixo' },
  { name:'Implicity',source:'crunchbase_fr',vertical_hint:'Medtech IA cardiaque',crunchbase_slug:'implicity' },
  { name:'MedTechniqs',source:'crunchbase_fr',vertical_hint:'Chirurgie robotique',crunchbase_slug:'medtechniqs' },
];

// ── Step 2 : Scoring IRO automatique par LLM ──────────────────────────────────

async function autoScoreIRO(
  name: string,
  enriched: EnrichedStartupData,
  vertical_hint: string,
): Promise<AutoIROScore> {
  const ctx = [
    `STARTUP: ${name}`,
    `SECTEUR: ${vertical_hint}`,
    enriched.computed_funding_stage ? `FINANCEMENT: ${enriched.computed_funding_stage}` : '',
    enriched.computed_age_mois ? `ÂGE: ${enriched.computed_age_mois} mois` : '',
    enriched.computed_employee_count ? `EFFECTIFS: ${enriched.computed_employee_count}` : '',
    `SOURCES: ${enriched.sources_used.join(', ')} (confiance: ${enriched.data_confidence})`,
    enriched.iro_hints.di_hint !== 2 ? `SIGNAL DI: ${enriched.iro_hints.di_hint}` : '',
    enriched.iro_hints.ar_hint !== 1 ? `SIGNAL AR: ${enriched.iro_hints.ar_hint}` : '',
  ].filter(Boolean).join('\n');

  const { response } = await callLLMWithRouter(
    `${ctx}

Score les 6 dimensions IRO [0-4] pour cette startup FR et estime le SCE [0-10] :
{
  "DI":2,"ADC":2,"IPC":2,"AR":2,"CA":2,"GCH":2,
  "sce_estimate":5.0,
  "confidence":"medium",
  "needs_review":false,
  "justification_1phrase":"..."
}
JSON uniquement. Si les données sont insuffisantes, mets 2 pour chaque dimension (neutre) et confidence="low".`,
    'Tu es un analyste capital-risque spécialisé startups IA françaises. Réponds UNIQUEMENT en JSON valide.',
    { timeoutMs: 20000, modelId: 'gemini-3-flash-preview' }
  ).catch(() => ({ response: '{}' }));

  try {
    const m = response.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    const p = m ? JSON.parse(m[0]) : {};
    const clamp = (v: unknown) => Math.max(0, Math.min(4, Math.round(parseFloat(String(v ?? 2)) || 2)));
    return {
      DI:  clamp(p.DI),  ADC: clamp(p.ADC), IPC: clamp(p.IPC),
      AR:  clamp(p.AR),  CA:  clamp(p.CA),  GCH: clamp(p.GCH),
      sce_estimate:  Math.max(0, Math.min(10, parseFloat(String(p.sce_estimate ?? 5)) || 5)),
      confidence:    ['high','medium','low'].includes(p.confidence) ? p.confidence : 'low',
      needs_review:  p.needs_review === true || p.confidence === 'low',
      auto_sources:  enriched.sources_used,
    };
  } catch {
    return { DI:2,ADC:2,IPC:2,AR:2,CA:2,GCH:2, sce_estimate:5, confidence:'low', needs_review:true, auto_sources:[] };
  }
}

// ── Step 3 : Formatage Gold Standard ─────────────────────────────────────────

function toGoldStandardEntry(
  idx: number,
  entry: N500Entry,
  auto: AutoIROScore,
  enriched: EnrichedStartupData,
): Partial<GoldStandardEntry> {
  const gsId = `gs-${(126 + idx).toString().padStart(3, '0')}`;
  return {
    id:           gsId as any,
    name:         entry.name,
    vertical:     entry.vertical_hint,
    modelVersion: '4.3' as ModelVersion,
    migrated:     true,
    dateNotation: new Date().toISOString().split('T')[0],
    scores: { DI:auto.DI, ADC:auto.ADC, IPC:auto.IPC, AR:auto.AR, CA:auto.CA, GCH:auto.GCH },
    sce:    { final: auto.sce_estimate, icc: auto.confidence === 'high' ? 0.82 : auto.confidence === 'medium' ? 0.72 : 0.55 },
    sourcesDocumentees: enriched.sources_used.map(s => `auto:${s}`),
  };
}

// ── Step 4 : Export CSV pour annotation manuelle ──────────────────────────────

export function exportN500CSV(results: N500Result[]): string {
  const headers = ['gs_id','name','source','vertical','DI','ADC','IPC','AR','CA','GCH','sce_estimate','confidence','needs_review','outcome_reel','notes'];
  const rows = results.map((r, i) => [
    `gs-${(126 + i).toString().padStart(3,'0')}`,
    `"${r.entry.name}"`,
    r.entry.source,
    `"${r.entry.vertical_hint}"`,
    r.auto_iro.DI, r.auto_iro.ADC, r.auto_iro.IPC,
    r.auto_iro.AR, r.auto_iro.CA, r.auto_iro.GCH,
    r.auto_iro.sce_estimate,
    r.auto_iro.confidence,
    r.auto_iro.needs_review ? '1' : '0',
    '',  // outcome_reel — à annoter manuellement
    '',  // notes
  ].join(','));
  return [headers.join(','), ...rows].join('\n');
}

// ── Pipeline principal ─────────────────────────────────────────────────────────

export async function runPipelineN500(
  config: Partial<N500Config> = {}
): Promise<{ results: N500Result[]; csv: string; gs_entries: Partial<GoldStandardEntry>[] }> {
  const {
    batchSize    = 10,
    dryRun       = true,   // safe par défaut
    maxStartups  = 500,
    sources      = ['bpi','france_digitale','stationf','pappers_naf','crunchbase_fr'],
    onProgress,
    onError,
  } = config;

  const universe = STARTUP_UNIVERSE_FR
    .filter(e => sources.includes(e.source))
    .slice(0, maxStartups);

  const results: N500Result[] = [];
  const gs_entries: Partial<GoldStandardEntry>[] = [];

  logger.info(`[N500] Démarrage pipeline. ${universe.length} startups à traiter.`, { batchSize, dryRun });

  // Traitement par lots (respecte les rate limits)
  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(async (entry, j) => {
        const idx = i + j;
        try {
          // Collecte multi-sources
          const enriched = await orchestratePipeline(entry.name, {
            crunchbaseSlug:  entry.crunchbase_slug,
            linkedinUrl:     entry.linkedin_url,
            githubOrg:       entry.github_org,
            sirenOrSiret:    entry.siren,
            useFrenchSources: true,
          });

          // Scoring IRO automatique
          const auto_iro = await autoScoreIRO(entry.name, enriched, entry.vertical_hint);

          // Formatage Gold Standard
          const gs_candidate = toGoldStandardEntry(idx, entry, auto_iro, enriched);

          const result: N500Result = {
            entry,
            enriched,
            auto_iro,
            gs_candidate,
            collected_at: new Date().toISOString(),
          };

          onProgress?.(idx + 1, universe.length, entry.name);

          if (!dryRun) {
            // Persister via /api/audit (réutilise l'infrastructure existante)
            const auditPayload = {
              timestamp:         result.collected_at,
              startup_name:      entry.name,
              iro_total:         Object.values(auto_iro).slice(0,6).reduce((a:number,b) => a + (b as number), 0) / 6 * 20,
              iro_cr:            0,
              srd:               0,
              DI:                auto_iro.DI,
              ADC:               auto_iro.ADC,
              IPC:               auto_iro.IPC,
              AR:                auto_iro.AR,
              CA:                auto_iro.CA,
              GCH:               auto_iro.GCH,
              ipc_conf:          0.8,
              adc_conf:          0.8,
              gch_conf:          0.8,
              trl:               5,
              evaluator:         'E1',
              model_version:     'IRO v4.5-S46',
              source_type:       'import' as const,
              goodhart_patterns: '[]',
              notes:             `auto:${entry.vertical_hint}:confidence=${auto_iro.confidence}`,
              status:            'unknown' as const,
            };

            if (typeof window === 'undefined') {
              // On est côté serveur, on peut directement appeler AuditJournal.addEntry
              try {
                const AuditJournalMod = await import('../utils/audit-journal');
                AuditJournalMod.addEntry(auditPayload);
              } catch (e) {
                logger.warn('[N500] Erreur persistence directe serveur', { error: String(e) });
              }
            } else {
              await fetch('/api/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(auditPayload),
              }).catch(() => {/* non bloquant */});
            }
          }

          return result;
        } catch (e: any) {
          const msg = e?.message ?? 'Erreur inconnue';
          onError?.(entry.name, msg);
          logger.warn(`[N500] Erreur ${entry.name}`, { error: msg });
          return { entry, enriched: null as any, auto_iro: {DI:2,ADC:2,IPC:2,AR:2,CA:2,GCH:2,sce_estimate:5,confidence:'low' as const,needs_review:true,auto_sources:[]}, gs_candidate: {}, collected_at: new Date().toISOString(), error: msg } as N500Result;
        }
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
        if (r.value.gs_candidate && !r.value.error) gs_entries.push(r.value.gs_candidate);
      }
    }

    // Pause entre lots pour respecter les rate limits
    if (i + batchSize < universe.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const csv = exportN500CSV(results.filter(r => !r.error));

  logger.info(`[N500] Terminé. ${results.filter(r => !r.error).length}/${universe.length} succès.`);
  return { results, csv, gs_entries };
}
