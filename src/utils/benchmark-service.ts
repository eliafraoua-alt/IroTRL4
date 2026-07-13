/**
 * src/utils/benchmark-service.ts — Service de benchmarking IRO
 * IRO Strength v5 — Antigravity Intelligence Platform
 *
 * Intègre les 3 niveaux de référence :
 *   1. Benchmarks mondiaux (présentation slide 10 : Palantir, Wiz, Gong...)
 *   2. Cohorte française (200+ startups actives + échecs)
 *   3. Groupe Scoring Rétrospectif (document de liste : groupes 1-2-3)
 */

import { normalCDF } from './iro-engine';
import { COHORTE_FRANCE, getMoyenneActive, getMoyenneFailed } from '../data/cohorte-france';

import { WorldBenchmark, BenchmarkResult } from '../types/iro';

// ── Benchmarks mondiaux ───────────────────────────────────────────────────

export const WORLD_BENCHMARKS: WorldBenchmark[] = [
  // Leaders mondiaux (groupe 3 + calibration)
  { name:'Palantir',   country:'USA', flag:'🇺🇸', DI:4, ADC:4, IPC:4, AR:4, CA:3, iro:95, valuation:'250B$+', signal:'Intégration gouvernements + données souveraines — moat institutionnel',     group:'leader' },
  { name:'Wiz',        country:'ISR', flag:'🇮🇱', DI:4, ADC:4, IPC:4, AR:4, CA:3, iro:93, valuation:'32B$',   signal:'Cloud security VRIN — switching cost maximal entreprise',                    group:'leader' },
  { name:'Gong',       country:'ISR', flag:'🇮🇱', DI:3, ADC:4, IPC:4, AR:3, CA:3, iro:90, valuation:'7,2B$',  signal:'Données conversations commerciales exclusives — flywheel fort',               group:'leader' },
  { name:'Glean',      country:'USA', flag:'🇺🇸', DI:3, ADC:4, IPC:3, AR:3, CA:3, iro:88, valuation:'7,2B$',  signal:'Knowledge graph entreprise — VRIN multi-source',                             group:'leader' },
  { name:'Mistral AI', country:'FRA', flag:'🇫🇷', DI:4, ADC:3, IPC:3, AR:4, CA:3, iro:85, valuation:'11,7B€', signal:'Modèles propres + AI Act natif + souveraineté française',                    group:'leader' },
  { name:'Cursor',     country:'USA', flag:'🇺🇸', DI:3, ADC:3, IPC:3, AR:3, CA:3, iro:82, valuation:'9,9B$',  signal:'IDE intégration profonde développeurs — switching cost fort',                 group:'leader' },
  { name:'Dataiku',    country:'FRA', flag:'🇫🇷', DI:3, ADC:3, IPC:3, AR:3, CA:2, iro:80, valuation:'3,7B$',  signal:'Plateforme ML certifiée enterprise — intégrations critiques',                 group:'leader' },
  { name:'Doctrine',   country:'FRA', flag:'🇫🇷', DI:2, ADC:4, IPC:3, AR:3, CA:2, iro:78, valuation:'leader FR', signal:'Données jurisprudence accumulées depuis 2017 — VRIN temporel',            group:'leader' },
  // Succès documentés groupe 3 (liste scoring rétrospectif)
  { name:'Cardiologs', country:'FRA', flag:'🇫🇷', DI:3, ADC:4, IPC:4, AR:4, CA:3, iro:91.3, valuation:'Acquis Philips', signal:'ECG IA + certifications CE — intégration hôpitaux profonde',      group:'success' },
  { name:'Owkin',      country:'FRA', flag:'🇫🇷', DI:3, ADC:4, IPC:3, AR:4, CA:3, iro:85, valuation:'250M€ levés', signal:'FL biomédicale — données hôpitaux VRIN',                              group:'success' },
  { name:'Giskard',    country:'FRA', flag:'🇫🇷', DI:2, ADC:2, IPC:2, AR:3, CA:3, iro:57.5, valuation:'Croissance', signal:'QA LLM + AI Act by design — AR exceptionnel',                         group:'success' },
  { name:'Zelros',     country:'FRA', flag:'🇫🇷', DI:2, ADC:3, IPC:3, AR:3, CA:2, iro:66.2, valuation:'Grands comptes', signal:'IPC assurance profond — clients CA, Groupama',                     group:'success' },
  { name:'Poolside',   country:'FRA', flag:'🇺🇸', DI:3, ADC:1, IPC:1, AR:2, CA:3, iro:46.2, valuation:'500M$ levés', signal:'ADC code propriétaire prometteur — IPC à construire',                 group:'success' },
  // Cas ambigus groupe 2
  { name:'Stability AI',country:'GBR',flag:'🇬🇧', DI:3, ADC:2, IPC:1, AR:1, CA:1, iro:48, valuation:'REVENDU', signal:'DI forte, ADC insuffisant malgré notoriété',                                group:'pivot' },
  { name:'LightOn',    country:'FRA', flag:'🇫🇷', DI:3, ADC:2, IPC:2, AR:3, CA:2, iro:58.7, valuation:'Pivot', signal:'Pivot on-premise 2024 — CA positif (adoption MCP)',                         group:'pivot' },
  { name:'Dust',       country:'FRA', flag:'🇫🇷', DI:1, ADC:2, IPC:2, AR:2, CA:3, iro:53.8, valuation:'Pivot B2B', signal:'IPC en construction — ADC dépendant données clients',                    group:'pivot' },
  // Échecs documentés groupe 1
  { name:'Humane AI Pin',country:'USA',flag:'🇺🇸', DI:1, ADC:0, IPC:0, AR:1, CA:1, iro:18, valuation:'FERMÉ 230M$', signal:'DI critique, ADC nul, IPC inexistant — commoditisation immédiate',    group:'failure' },
  { name:'Builder.ai', country:'GBR', flag:'🇬🇧', DI:1, ADC:1, IPC:1, AR:0, CA:1, iro:22, valuation:'FAILLITE 1,2Md$', signal:'IPC faible, AR absent, modèle non défendable',                    group:'failure' },
  { name:'Jasper AI',  country:'USA', flag:'🇺🇸', DI:0, ADC:0, IPC:0, AR:1, CA:1, iro:15, valuation:'-80% valeur', signal:'ADC nul, DI totale OpenAI — wrapper substitué',                         group:'failure' },
  { name:'Inflection AI',country:'USA',flag:'🇺🇸', DI:2, ADC:2, IPC:1, AR:1, CA:1, iro:35, valuation:'Absorbé MS', signal:'CA faible, IPC non construit — acquisition défensive',                   group:'failure' },
];

/**
 * Calcule le positionnement d'une startup dans tous les benchmarks.
 */
export function getBenchmarkPosition(iro: number, irocr: number): BenchmarkResult {
  const actives = COHORTE_FRANCE.filter(s => s.status === 'active');
  const failed = COHORTE_FRANCE.filter(s => s.status === 'failed');
  const meanActive = getMoyenneActive();
  const meanFailed = getMoyenneFailed();

  // Rang monde
  const worldSorted = [...WORLD_BENCHMARKS].sort((a, b) => b.iro - a.iro);
  const rang_monde = worldSorted.filter(w => w.iro > iro).length + 1;

  // Rang France (actives seulement)
  const frSorted = [...actives].sort((a, b) => b.iro_total - a.iro_total);
  const rang_france = frSorted.filter(r => r.iro_total > iro).length + 1;
  const centile_france = Math.round((1 - rang_france / actives.length) * 100);

  // Zone de positionnement
  let zone: BenchmarkResult['zone'];
  if (centile_france >= 75) zone = 'leader';
  else if (centile_france >= 50) zone = 'challenger';
  else if (centile_france >= 25) zone = 'suiveur';
  else zone = 'retardataire';

  // Startups similaires
  const similaires_actives = actives
    .filter(s => Math.abs(s.iro_total - iro) < 8)
    .slice(0, 5);
  const similaires_failed = failed
    .filter(s => Math.abs(s.iro_total - iro) < 8)
    .slice(0, 3);

  // Seuil de franchissement
  const levels = [
    { name: 'Sortir de la zone critique', threshold: 45, actions: ['Acquérir données propriétaires (ADC)', 'Construire switching cost (IPC)'] },
    { name: 'Atteindre la médiane actives (64.7)', threshold: 65, actions: ['Certification réglementaire (AR)', 'Intégration client profonde (IPC)'] },
    { name: 'Atteindre la zone solide (75)', threshold: 75, actions: ['Infrastructure propriétaire (DI)', 'Données VRIN (ADC ≥ 3)'] },
    { name: 'Rejoindre les leaders mondiaux (88)', threshold: 88, actions: ['DI propriétaire + ADC exclusif', 'IPC certifié secteur régulé'] },
  ];
  const nextLevel = levels.find(l => l.threshold > iro) ?? levels[levels.length - 1];

  return {
    rang_monde,
    rang_france,
    centile_france,
    zone,
    iro_vs_mean_actives: Math.round((iro - meanActive) * 10) / 10,
    iro_vs_mean_failed: Math.round((iro - meanFailed) * 10) / 10,
    similaires_actives,
    similaires_failed,
    seuil_franchissement: {
      next_level: nextLevel.name,
      pts_manquants: Math.max(0, Math.round(nextLevel.threshold - iro)),
      actions_cles: nextLevel.actions,
    },
  };
}

/**
 * Filtre les benchmarks mondiaux par groupe.
 */
export function getWorldByGroup(group: WorldBenchmark['group']): WorldBenchmark[] {
  return WORLD_BENCHMARKS.filter(w => w.group === group).sort((a, b) => b.iro - a.iro);
}

/**
 * Distribution sectorielle de la cohorte française.
 */
export function getSectorDistribution(): Record<string, { actives: number; failed: number; mean_iro: number }> {
  const sectors: Record<string, { actives: number[]; failed: number[] }> = {};

  COHORTE_FRANCE.forEach(s => {
    const key = s.sector.split(' IA')[0].split(' ')[0];
    if (!sectors[key]) sectors[key] = { actives: [], failed: [] };
    if (s.status === 'active') sectors[key].actives.push(s.iro_total);
    else sectors[key].failed.push(s.iro_total);
  });

  return Object.fromEntries(
    Object.entries(sectors)
      .filter(([, v]) => v.actives.length + v.failed.length >= 2)
      .map(([k, v]) => {
        const all = [...v.actives, ...v.failed];
        return [k, {
          actives: v.actives.length,
          failed: v.failed.length,
          mean_iro: Math.round(all.reduce((s, x) => s + x, 0) / all.length * 10) / 10,
        }];
      })
  );
}
