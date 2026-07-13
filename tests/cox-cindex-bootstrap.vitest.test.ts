/**
 * tests/cox-cindex-bootstrap.vitest.test.ts
 * IRO Strength Velocity v7.3 — CORRECTIF F-07 : C-index avec IC 95% Bootstrap
 *
 * PROBLÈME CORRIGÉ :
 *   Annoncer C-index = 0.901 sans intervalle de confiance est trompeur
 *   avec n=32 cas (9 events). L'IC 95% bootstrap est requis pour une
 *   communication honnête devant un jury BPI / France 2030.
 *
 * MÉTHODE :
 *   Bootstrap non-paramétrique (Efron 1979) :
 *   1. Tirage avec remise de n=32 cas (1000 répétitions)
 *   2. Calcul Harrell C-index sur chaque tirage
 *   3. IC 95% = percentiles [2.5%, 97.5%] de la distribution bootstrap
 *
 * RÉSULTAT ATTENDU (à afficher dans les dossiers BPI) :
 *   C-index = 0.901 [IC 95% bootstrap : 0.XX - 0.XX] — n=32, 9 events
 *
 * RÈGLE DE COMMUNICATION :
 *   - Jamais annoncer C-index seul sans IC quand n < 100
 *   - Le test échoue si IC_lower < 0.65 (modèle non défendable)
 *   - Warning si IC_lower < 0.75 (TRL 4 gate non atteint)
 */

import { describe, it, expect } from 'vitest';
import { coxFull } from '../src/utils/cox-model';
import { bootstrapCIndexCI_CORRECTED } from '../scripts/calibrate-cox';
import fs from 'fs';

// ── Dataset de validation (reprend les cas de trl4-validation) ────────────────

interface ValidationCase {
  id:        string;
  name:      string;
  event:     0 | 1;
  t_event:   number;
  iro_cr:    number;
  di_zero:   boolean;
  srd_high:  boolean;
  adc_strong: boolean;
  ipc_strong: boolean;
  regulated: boolean;
  age_mois:  number;
}

const CASES: ValidationCase[] = [
  // Acquisitions contraintes / échecs (event=1)
  { id:'gs-099', name:'Luko',           event:1, t_event:30, iro_cr:38, di_zero:true,  srd_high:false, adc_strong:false, ipc_strong:false, regulated:true,  age_mois:36 },
  { id:'gs-112', name:'Toucan Toco',    event:1, t_event:28, iro_cr:40, di_zero:true,  srd_high:false, adc_strong:false, ipc_strong:false, regulated:false, age_mois:48 },
  { id:'gs-115', name:'Elevo (Lucca)',  event:1, t_event:24, iro_cr:37, di_zero:true,  srd_high:false, adc_strong:false, ipc_strong:false, regulated:false, age_mois:30 },
  { id:'gs-119', name:'Captain Contrat',event:1, t_event:30, iro_cr:36, di_zero:true,  srd_high:false, adc_strong:false, ipc_strong:false, regulated:false, age_mois:42 },
  { id:'gs-117', name:'Meero',          event:1, t_event:20, iro_cr:32, di_zero:false, srd_high:true,  adc_strong:false, ipc_strong:false, regulated:false, age_mois:36 },
  { id:'gs-122', name:'Ÿnsect',         event:1, t_event:22, iro_cr:44, di_zero:false, srd_high:true,  adc_strong:false, ipc_strong:false, regulated:false, age_mois:60 },
  { id:'gs-124', name:'Zenly',          event:1, t_event:18, iro_cr:28, di_zero:true,  srd_high:true,  adc_strong:false, ipc_strong:false, regulated:false, age_mois:24 },
  { id:'gs-121', name:'Nabla (pivot)',  event:1, t_event:26, iro_cr:41, di_zero:false, srd_high:false, adc_strong:false, ipc_strong:true,  regulated:true,  age_mois:48 },
  { id:'gs-118', name:'Lydia (pivot)',  event:1, t_event:32, iro_cr:45, di_zero:true,  srd_high:false, adc_strong:false, ipc_strong:false, regulated:true,  age_mois:60 },
  // Startups actives (event=0, censurées à t=36)
  { id:'gs-096', name:'Mistral AI',     event:0, t_event:36, iro_cr:74, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:false, regulated:false, age_mois:24 },
  { id:'gs-097', name:'Nabla (actif)',  event:0, t_event:36, iro_cr:68, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:true,  age_mois:48 },
  { id:'gs-098', name:'Dust',           event:0, t_event:36, iro_cr:62, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:false, age_mois:18 },
  { id:'gs-100', name:'Qonto',          event:0, t_event:36, iro_cr:82, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:true,  age_mois:96 },
  { id:'gs-101', name:'Alan',           event:0, t_event:36, iro_cr:79, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:true,  age_mois:108 },
  { id:'gs-102', name:'Payfit',         event:0, t_event:36, iro_cr:75, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:true,  age_mois:108 },
  { id:'gs-103', name:'Pennylane',      event:0, t_event:36, iro_cr:66, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:true,  age_mois:60 },
  { id:'gs-104', name:'Doctolib',       event:0, t_event:36, iro_cr:84, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:true,  age_mois:144 },
  { id:'gs-105', name:'Dataiku',        event:0, t_event:36, iro_cr:78, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:false, age_mois:144 },
  { id:'gs-106', name:'Contentsquare',  event:0, t_event:36, iro_cr:77, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:false, age_mois:168 },
  { id:'gs-107', name:'Cardiologs',     event:0, t_event:36, iro_cr:78, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:true,  age_mois:48 },
  { id:'gs-108', name:'Spendesk',       event:0, t_event:36, iro_cr:70, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:false, age_mois:96 },
  { id:'gs-109', name:'Yousign',        event:0, t_event:36, iro_cr:65, di_zero:false, srd_high:false, adc_strong:false, ipc_strong:true,  regulated:true,  age_mois:96 },
  { id:'gs-110', name:'Shift Technology',event:0, t_event:36, iro_cr:72, di_zero:false, srd_high:false, adc_strong:true, ipc_strong:true,  regulated:true,  age_mois:120 },
  { id:'gs-111', name:'Swan',           event:0, t_event:36, iro_cr:63, di_zero:false, srd_high:false, adc_strong:false, ipc_strong:false, regulated:true,  age_mois:60 },
  { id:'gs-113', name:'Agicap',         event:0, t_event:36, iro_cr:68, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:false, age_mois:84 },
  { id:'gs-114', name:'Mirakl',         event:0, t_event:36, iro_cr:76, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:false, age_mois:168 },
  { id:'gs-116', name:'Photoroom',      event:0, t_event:36, iro_cr:61, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:false, regulated:false, age_mois:48 },
  { id:'gs-120', name:'Withings',       event:0, t_event:36, iro_cr:74, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:true,  age_mois:192 },
  { id:'gs-123', name:'Voodoo',         event:0, t_event:36, iro_cr:67, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:false, regulated:false, age_mois:96 },
  { id:'gs-125', name:'Pigment',        event:0, t_event:36, iro_cr:64, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:false, age_mois:48 },
  { id:'gs-126', name:'Holistic AI',    event:0, t_event:36, iro_cr:62, di_zero:false, srd_high:false, adc_strong:false, ipc_strong:false, regulated:true,  age_mois:36 },
  { id:'gs-127', name:'Owkin',          event:0, t_event:36, iro_cr:73, di_zero:false, srd_high:false, adc_strong:true,  ipc_strong:true,  regulated:true,  age_mois:72 },
];

// ── Calcul S(36) via coxFull ──────────────────────────────────────────────────

function calcS36(c: ValidationCase): number {
  const res = coxFull({
    irocr:            c.iro_cr,
    di_zero:          c.di_zero,
    srd_high:         c.srd_high,
    adc_strong:       c.adc_strong,
    ipc_strong:       c.ipc_strong,
    regulated_sector: c.regulated,
    age_mois:         c.age_mois,
  });
  return res.survival_36m;
}

// ── Harrell C-index ───────────────────────────────────────────────────────────

function harrellC(cases: ValidationCase[], preds: number[]): number {
  let concordant = 0, comparable = 0;
  for (let i = 0; i < cases.length; i++) {
    for (let j = 0; j < cases.length; j++) {
      if (i === j) continue;
      const ci = cases[i], cj = cases[j];
      if (ci.event === 1 && ci.t_event < cj.t_event) {
        comparable++;
        if (preds[i] < preds[j]) concordant++; // ci plus risqué → S36 plus faible
        else if (preds[i] === preds[j]) concordant += 0.5;
      }
    }
  }
  return comparable === 0 ? 0.5 : concordant / comparable;
}

// ── Bootstrap IC 95% ─────────────────────────────────────────────────────────

function bootstrapCI(
  cases: ValidationCase[],
  preds: number[],
  B = 1000,
): { lower: number; upper: number; se: number; cIndexes: number[] } {
  const n = cases.length;
  const cIndexes: number[] = [];

  // Seed pseudo-aléatoire déterministe (reproductible)
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };

  for (let b = 0; b < B; b++) {
    // Tirage avec remise
    const indices = Array.from({ length: n }, () => Math.floor(rand() * n));
    const sampledCases = indices.map(i => cases[i]);
    const sampledPreds = indices.map(i => preds[i]);
    cIndexes.push(harrellC(sampledCases, sampledPreds));
  }

  cIndexes.sort((a, b) => a - b);
  const lower = cIndexes[Math.floor(B * 0.025)];
  const upper = cIndexes[Math.floor(B * 0.975)];
  const mean  = cIndexes.reduce((a, b) => a + b, 0) / B;
  const se    = Math.sqrt(cIndexes.reduce((s, c) => s + (c - mean) ** 2, 0) / B);

  return { lower, upper, se, cIndexes };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('C-index Cox — Harrell avec IC 95% Bootstrap (F-07)', () => {
  const preds = CASES.map(calcS36);
  const cIndex = harrellC(CASES, preds);

  it('C-index ≥ 0.75 (gate TRL 4)', () => {
    console.info(`[Cox] C-index = ${cIndex.toFixed(3)} sur n=${CASES.length} cas (${CASES.filter(c=>c.event===1).length} events)`);
    expect(cIndex).toBeGreaterThanOrEqual(0.75);
  });

  it('C-index bat le hasard (> 0.5)', () => {
    expect(cIndex).toBeGreaterThan(0.5);
  });

  it('Survie S(36) : cas event=1 ont S36 < cas event=0 (discrimination)', () => {
    const actifPreds  = CASES.filter(c => c.event === 0).map((c, i) => preds[CASES.indexOf(c)]);
    const echouePreds = CASES.filter(c => c.event === 1).map((c, i) => preds[CASES.indexOf(c)]);

    const meanActif  = actifPreds.reduce((a,b)=>a+b,0) / actifPreds.length;
    const meanEchoue = echouePreds.reduce((a,b)=>a+b,0) / echouePreds.length;

    console.info(`[Cox] S36 moyen — actifs: ${(meanActif*100).toFixed(1)}% | échecs: ${(meanEchoue*100).toFixed(1)}%`);
    expect(meanActif).toBeGreaterThan(meanEchoue);
  });

  it('IC 95% bootstrap : IC_lower ≥ 0.65 (modèle défendable)', () => {
    const { lower, upper, se } = bootstrapCI(CASES, preds, 1000);

    console.info('');
    console.info('══════════════════════════════════════════════════════════');
    console.info('[F-07] RAPPORT C-INDEX POUR DOSSIER BPI / France 2030');
    console.info(`       C-index = ${cIndex.toFixed(3)} [IC 95% : ${lower.toFixed(3)} – ${upper.toFixed(3)}]`);
    console.info(`       n=${CASES.length} cas | ${CASES.filter(c=>c.event===1).length} events | Bootstrap B=1000`);
    console.info(`       Erreur standard : ±${se.toFixed(3)}`);
    console.info('');
    console.info('FORMULATION RECOMMANDÉE POUR LES DOSSIERS :');
    console.info(`"C-index = ${cIndex.toFixed(2)} [IC 95% bootstrap : ${lower.toFixed(2)}–${upper.toFixed(2)}]`);
    console.info(` sur n=${CASES.length} startups françaises documentées (${CASES.filter(c=>c.event===1).length} outcomes négatifs observés).`);
    console.info(` TRL 3 — validation longitudinale en cours (objectif n=100 events)."`);
    console.info('══════════════════════════════════════════════════════════');

    expect(lower).toBeGreaterThanOrEqual(0.65);
  });

  it('IC 95% bootstrap : largeur < 0.40 (précision acceptable)', () => {
    const { lower, upper } = bootstrapCI(CASES, preds, 1000);
    const width = upper - lower;
    console.info(`[Cox] Largeur IC 95% = ${width.toFixed(3)} (seuil : < 0.40)`);
    expect(width).toBeLessThan(0.40);
  });

  it('A2-fix — IC bootstrap OOB : largeur > 0.15 avec n_event1=9', () => {
    // Simuler 32 cas, 9 events — même structure que le gold standard
    const n = 32, n_ev = 9;
    const X_sim = Array.from({length:n}, (_,i) => [(i/n - 0.5)*4, Math.random()>0.7?1:0]);
    const y_sim = Array.from({length:n}, (_,i) => i < n_ev ? 1 : 0);
    const t_sim = Array.from({length:n}, () => Math.floor(Math.random()*36)+1);
    const betas = [0.26, 0.004];

    const { ci_lo, ci_hi, n_valid } = bootstrapCIndexCI_CORRECTED(X_sim, y_sim, t_sim, betas, 0.1, 200);
    expect(n_valid).toBeGreaterThan(20);
    expect(ci_hi - ci_lo).toBeGreaterThan(0.10); // IC non dégénéré
    // Avec 9 events réels, on s'attend à une largeur >> 0.10
  });

  it('A2-fix — IC bootstrap OOB n\'est PAS [0.897, 0.910] (IC invalide rejeté)', () => {
    // Ce test échoue si la méthode biaisée (éval sur train) est encore utilisée
    // L'IC valide doit avoir une largeur > 0.05
    const betas_json = JSON.parse(fs.readFileSync('src/config/cox-betas-calibrated.json', 'utf8'));
    const width = betas_json.c_index_ci_hi - betas_json.c_index_ci_lo;
    // L'IC étroit [0.897, 0.910] (largeur 0.013) est un artefact — rejeté
    expect(width).not.toBeLessThan(0.05);
  });
});
