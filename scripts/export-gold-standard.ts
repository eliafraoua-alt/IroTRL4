/**
 * scripts/export-gold-standard.ts
 * IRO Strength Velocity v7.0.0 — Synchronisation Gold Standard
 *
 * Exporte le GOLD_STANDARD de src/types/iro.ts vers public/config/gold-standard-v4.3.json
 * À exécuter après toute modification du Gold Standard dans iro.ts.
 *
 * Usage : npx tsx scripts/export-gold-standard.ts
 */

import fs   from 'fs';
import path from 'path';
import { GOLD_STANDARD } from '../src/types/iro.js';

const OUT_PATH = path.join(process.cwd(), 'public/config/gold-standard-v4.3.json');

/**
 * OUTCOMES_MAP — périmètre élargi (gs-096 à gs-125, n=30 entrées annotées)
 * Source : revue Delphi équipe IRO Strength, annotée le 2026-05-31
 * Critère event=1 : cessation d'activité, pivot stratégique majeur, ou liquidation
 *   dans les 36 mois suivant la date de scoring.
 * event=0 : survie confirmée à t_event_mois (activité vérifiée Pappers/LinkedIn)
 *
 * ATTENTION : Ce périmètre (30 cas) est DISTINCT du périmètre de calibration Cox
 *   utilisé dans scripts/calibrate-cox.ts (32 cas avec outcome) car calibrate-cox.ts
 *   charge le fichier exporté depuis ce script et filtre ceux ayant e.outcome défini.
 *   Les 2 cas supplémentaires (n=32 vs n=30) proviennent d'entrées GS antérieures
 *   à gs-096 avec outcomes documentés hors de cette map.
 *   → Résoudre : unifier la source unique dans ce fichier.
 */
const OUTCOMES_MAP: Record<string, { event: number; t_event_mois: number }> = {
  'gs-096': { event: 0, t_event_mois: 36 },
  'gs-097': { event: 0, t_event_mois: 36 },
  'gs-098': { event: 1, t_event_mois: 24 },
  'gs-099': { event: 1, t_event_mois: 30 },
  'gs-100': { event: 0, t_event_mois: 36 },
  'gs-101': { event: 0, t_event_mois: 36 },
  'gs-102': { event: 0, t_event_mois: 36 },
  'gs-103': { event: 0, t_event_mois: 30 },
  'gs-104': { event: 0, t_event_mois: 36 },
  'gs-105': { event: 0, t_event_mois: 36 },
  'gs-106': { event: 0, t_event_mois: 36 },
  'gs-107': { event: 0, t_event_mois: 36 },
  'gs-108': { event: 0, t_event_mois: 36 },
  'gs-109': { event: 0, t_event_mois: 36 },
  'gs-110': { event: 0, t_event_mois: 36 },
  'gs-111': { event: 0, t_event_mois: 36 },
  'gs-112': { event: 1, t_event_mois: 28 },
  'gs-113': { event: 0, t_event_mois: 36 },
  'gs-114': { event: 0, t_event_mois: 36 },
  'gs-115': { event: 1, t_event_mois: 24 },
  'gs-116': { event: 0, t_event_mois: 36 },
  'gs-117': { event: 1, t_event_mois: 20 },
  'gs-118': { event: 0, t_event_mois: 30 },
  'gs-119': { event: 1, t_event_mois: 30 },
  'gs-120': { event: 0, t_event_mois: 36 },
  'gs-121': { event: 0, t_event_mois: 36 },
  'gs-122': { event: 1, t_event_mois: 22 },
  'gs-123': { event: 0, t_event_mois: 36 },
  'gs-124': { event: 1, t_event_mois: 18 },
  'gs-125': { event: 0, t_event_mois: 36 }
};

// Enrichir le GOLD_STANDARD avec les outcomes
const enrichedEntries = GOLD_STANDARD.map(entry => {
  const outcome = OUTCOMES_MAP[entry.id];
  if (outcome) {
    return { ...entry, outcome };
  }
  return entry;
});

// Statistiques
const withOutcome = enrichedEntries.filter((e: any) => e.outcome !== undefined);
const event1      = withOutcome.filter((e: any) => e.outcome?.event === 1);

export const GOLD_STANDARD_DATASHEET = {
  datasheet_version:   '1.0',
  format:              'Gebru et al. (2021) — Datasheets for Datasets',
  motivation: {
    purpose:           'Calibration et validation du modèle de survie Cox IRO Strength Velocity',
    creators:          'Équipe IRO Strength — annotation Delphi interne',
    funding:           'Autofinancement',
  },
  composition: {
    instances:         125,
    instance_type:     'Dossier de startup française analysé par scoring IRO',
    labels:            'event (0/1), t_event_mois (censure à 36 mois)',
    missing_info:      '74 entrées sans outcome (non encore suivies à 36 mois)',
    confidentiality:   'Données anonymisées — identifiants gs-XXX sans nom réel',
  },
  collection: {
    method:            'Scoring rétrospectif par panel Delphi (biais connu — voir A4)',
    timeframe:         '2023–2026',
    ethical_review:    'Pas de données personnelles directes — scoring de personnes morales',
  },
  preprocessing: {
    normalization:     'IRO-CR = IRO × (1 - 30/200)',
    filtering:         'Exclusion dossiers incomplets (< 4 dimensions renseignées)',
    splits:            'Pas de split train/test — LOO-CV utilisé pour validation',
  },
  uses: {
    suitable:          'Calibration modèle Cox, benchmarking IRO, recherche interne',
    unsuitable:        'Décisions automatiques sans supervision humaine, scoring en temps réel sans recalibration',
    rights:            'Usage interne IRO Strength — partage externe soumis à accord',
  },
  mapping_fsf: {
    label_TRL:         'Niveaux TRL 2 à 9',
  },
  maintenance: {
    maintainer:        'Équipe IRO Strength Velocity',
    contact:           'contact@irostrength.ai',
    update_policy:     'Recalibration déclenchée automatiquement dès n += 10 cas avec outcome (voir A8)',
    trajectory_n500:   'Objectif n=500 à 36 mois — 2 cohortes cohortes pilotes actives',
  },
};

const output = {
  version:           '4.3',
  frozen:            true,
  date:              '2026-05-31',
  n:                 enrichedEntries.length,
  n_with_outcome:    withOutcome.length,
  n_event1:          event1.length,              // calculé dynamiquement
  n_event1_ids:      event1.map((e: any) => e.id),  // IDs traçables
  n_event1_source:   'OUTCOMES_MAP dans scripts/export-gold-standard.ts',
  n_event1_perimeter: `gs-096 à gs-${Math.max(...withOutcome.map((e: any) => parseInt(e.id.split('-')[1]) || 0))}`,
  description:       'Gold Standard IRO v4.3 — synchronisé depuis src/types/iro.ts',
  datasheet:         GOLD_STANDARD_DATASHEET,
  entries:           enrichedEntries,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('✅ Gold Standard exporté:');
console.log(`   Fichier   : ${OUT_PATH}`);
console.log(`   Entrées   : ${GOLD_STANDARD.length}`);
console.log(`   Outcomes  : ${withOutcome.length}`);
console.log(`   event=1   : ${event1.length}`);
console.log('   À commiter dans git après toute modification de GOLD_STANDARD dans iro.ts');
