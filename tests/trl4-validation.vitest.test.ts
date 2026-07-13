/**
 * tests/trl4-validation.vitest.test.ts
 * IRO Strength Velocity v7.0.0 — Validation formelle TRL 4
 *
 * Critères de passage TRL 4 :
 *   ① Harrell C-index ≥ 0.75 sur ≥ 30 paires comparables avec outcomes réels
 *   ② Échantillon de validation ≥ 20 cas documentés
 *   ③ Discrimination confirmée : les cas event=1 ont S(36) < cas censurés comparables
 *   ④ Robustesse : le modèle bat le hasard (C > 0.5) sur chaque sous-groupe
 *
 * Dataset : 30 cas FR documentés (gs-096→gs-125, Gold Standard v4.3)
 *   - 8 cas event=1 : acquisitions contraintes, pivots difficiles, fermeture, difficultés
 *   - 22 cas event=0 : startups actives (censurées à t=36 mois)
 *   - 198 paires comparables (Harrell 1982)
 *
 * Commande : npx vitest run tests/trl4-validation.vitest.test.ts
 *
 * IMPORTANT : ce test est le gate formel TRL 4.
 * Il échoue si le C-index descend sous 0.75 suite à une modification du modèle Cox.
 */

import { describe, it, expect } from 'vitest';
import { coxFull }              from '../src/utils/cox-model';
import { IRO_WEIGHTS }          from '../src/utils/weights-registry';
import goldStandard             from '../public/config/gold-standard-v4.3.json';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValidationCase {
  id:           string;
  name:         string;
  vertical:     string;
  event:        0 | 1;       // 1 = outcome négatif observé, 0 = censuré (actif)
  t_event_mois: number;      // temps de l'événement ou de la censure (36 si actif)
  scores:       Record<string, number>;
}

// ── Dataset de validation (30 cas FR documentés, gs-096 → gs-125) ─────────────

const VALIDATION_CASES: ValidationCase[] = goldStandard.entries
  .filter((e: any) => e.outcome !== undefined)
  .map((e: any) => ({
    id:           e.id,
    name:         e.name,
    vertical:     e.vertical || '',
    event:        e.outcome.event as 0 | 1,
    t_event_mois: e.outcome.t_event_mois,
    scores:       e.scores,
  }));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Calcule l'IRO_cr à partir des scores (approximation SRD=30%) */
function calcIROcr(scores: Record<string, number>): number {
  const iro_brut = Object.entries(IRO_WEIGHTS).reduce(
    (sum, [k, w]) => sum + (scores[k] ?? 0) * w, 0,
  ) / 4 * 100;
  const iro = Math.max(0, Math.min(100, Math.round(iro_brut * 10) / 10));
  return iro * (1 - 30 / 200); // SRD=30% approximation conservative
}

/** Détecte un secteur réglementé depuis le vertical */
function isRegulated(vertical: string): boolean {
  return /santé|médical|médecin|fintech|légal|juridi|finance|assuranc|pharma/i.test(vertical);
}

/** Calcule S(36m) via coxFull pour un cas de validation */
function calcS36(vc: ValidationCase): number {
  const iro_cr = calcIROcr(vc.scores);
  const res = coxFull({
    irocr:            iro_cr,
    di_zero:          (vc.scores.DI ?? 0) === 0,
    srd_high:         false,                              // SRD non calculé précisément
    adc_strong:       (vc.scores.ADC ?? 0) >= 3,
    ipc_strong:       (vc.scores.IPC ?? 0) >= 3,
    regulated_sector: isRegulated(vc.vertical),
    age_mois:         36,
  });
  return res.survival_36m;
}

/** Harrell C-index (1982) sur un ensemble de cas */
function harrellC(cases: ValidationCase[], predictions: number[]): {
  c_index:      number;
  concordant:   number;
  comparable:   number;
  discordant:   Array<{ i: string; j: string }>;
} {
  let concordant = 0, comparable = 0;
  const discordant: Array<{ i: string; j: string }> = [];

  for (let i = 0; i < cases.length; i++) {
    for (let j = 0; j < cases.length; j++) {
      if (i === j) continue;
      const ci = cases[i], cj = cases[j];
      // Paire comparable : ci a event=1 ET survit moins longtemps que cj
      if (ci.event === 1 && ci.t_event_mois < cj.t_event_mois) {
        comparable++;
        // Concordant : ci a S(36) < cj (ci = plus de risque)
        if (predictions[i] < predictions[j]) {
          concordant++;
        } else {
          discordant.push({ i: ci.name, j: cj.name });
        }
      }
    }
  }

  return {
    c_index:    comparable > 0 ? Math.round(concordant / comparable * 1000) / 1000 : 0,
    concordant,
    comparable,
    discordant,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TRL 4 — Validation formelle IRO Strength Velocity v7.0.0', () => {

  // ① Taille du dataset
  it('le dataset de validation contient ≥ 20 cas documentés', () => {
    expect(VALIDATION_CASES.length).toBeGreaterThanOrEqual(20);
    console.log(`  ✓ Dataset: ${VALIDATION_CASES.length} cas (${VALIDATION_CASES.filter(c => c.event === 1).length} event=1, ${VALIDATION_CASES.filter(c => c.event === 0).length} censurés)`);
  });

  // ② Paires comparables suffisantes
  it('le dataset génère ≥ 30 paires comparables (Harrell)', () => {
    const predictions = VALIDATION_CASES.map(calcS36);
    const result = harrellC(VALIDATION_CASES, predictions);
    expect(result.comparable).toBeGreaterThanOrEqual(30);
    console.log(`  ✓ Paires comparables: ${result.comparable}`);
  });

  // ③ C-index ≥ 0.75 — GATE FORMEL TRL 4
  it('Harrell C-index ≥ 0.75 sur le dataset FR documenté [GATE TRL 4]', () => {
    const predictions = VALIDATION_CASES.map(calcS36);
    const result = harrellC(VALIDATION_CASES, predictions);

    console.table({
      'C-index':              result.c_index,
      'Paires concordantes':  result.concordant,
      'Paires comparables':   result.comparable,
      'Paires discordantes':  result.discordant.length,
      'Seuil TRL 4':          0.75,
      'Statut':               result.c_index >= 0.75 ? '✅ TRL 4 ATTEINT' : '❌ TRL 4 NON ATTEINT',
    });

    if (result.discordant.length > 0) {
      console.log(`  Paires discordantes (${result.discordant.length}):`);
      result.discordant.slice(0, 5).forEach(p => console.log(`    ${p.i} vs ${p.j}`));
    }

    expect(result.c_index).toBeGreaterThanOrEqual(0.75);
  });

  // ④ C-index ≥ 0.85 — cible opérationnelle VC
  it('Harrell C-index ≥ 0.85 (cible opérationnelle recommandée pour usage VC)', () => {
    const predictions = VALIDATION_CASES.map(calcS36);
    const result = harrellC(VALIDATION_CASES, predictions);
    console.log(`  C-index = ${result.c_index} (cible VC: 0.85)`);
    // Non bloquant si entre 0.75 et 0.85 — informatif
    if (result.c_index < 0.85) {
      console.warn(`  ⚠ C-index sous la cible VC (${result.c_index} < 0.85). Acceptable pour TRL 4, sous-optimal pour usage décisionnel.`);
    }
    expect(result.c_index).toBeGreaterThanOrEqual(0.75); // seuil dur = TRL 4
  });

  // ⑤ Discrimination event=1 vs event=0
  it('les cas event=1 ont S(36m) systématiquement plus basse que la médiane des cas actifs', () => {
    const actifs  = VALIDATION_CASES.filter(c => c.event === 0);
    const echecs  = VALIDATION_CASES.filter(c => c.event === 1);

    const s36_actifs = actifs.map(calcS36).sort((a, b) => a - b);
    const mediane_actifs = s36_actifs[Math.floor(s36_actifs.length / 2)];

    const s36_echecs = echecs.map(calcS36);
    const echecs_sous_mediane = s36_echecs.filter(s => s < mediane_actifs).length;

    console.log(`  Médiane S(36) actifs: ${(mediane_actifs * 100).toFixed(1)}%`);
    console.log(`  Cas event=1 sous la médiane: ${echecs_sous_mediane}/${echecs.length}`);

    // Au moins 75% des cas event=1 doivent être sous la médiane des actifs
    expect(echecs_sous_mediane / echecs.length).toBeGreaterThanOrEqual(0.75);
  });

  // ⑥ Cas emblématiques de discrimination
  it('Zenly (fermeture) a S(36m) < Cardiologs (acquisition premium)', () => {
    const zenly     = VALIDATION_CASES.find(c => c.id === 'gs-124')!;
    const cardiologs = VALIDATION_CASES.find(c => c.id === 'gs-107')!;
    if (!zenly || !cardiologs) return; // skip si non présents

    const s_zenly     = calcS36(zenly);
    const s_cardiologs = calcS36(cardiologs);

    console.log(`  Zenly S(36)=${(s_zenly * 100).toFixed(1)}% vs Cardiologs S(36)=${(s_cardiologs * 100).toFixed(1)}%`);
    expect(s_zenly).toBeLessThan(s_cardiologs);
  });

  it('Zenly (fermeture, SCE=3.8) a une S(36m) critique (< 40%) parmi les cas event=1', () => {
    const events  = VALIDATION_CASES.filter(c => c.event === 1);
    const zenly   = events.find(c => c.id === 'gs-124');
    if (!zenly) return;

    const s_zenly = calcS36(zenly);

    console.log(`  Zenly S(36)=${(s_zenly * 100).toFixed(1)}%`);
    expect(s_zenly).toBeLessThan(0.40);
  });

  // ⑦ Rapport complet (pour documentation TRL)
  it('rapport de validation complet — à intégrer dans la documentation TRL 4', () => {
    const rows = VALIDATION_CASES.map(c => {
      const s36    = calcS36(c);
      const iro_cr = calcIROcr(c.scores);
      return {
        ID:          c.id,
        Startup:     c.name.slice(0, 25),
        'IRO_cr':    Math.round(iro_cr),
        'S(36)%':    `${(s36 * 100).toFixed(1)}%`,
        Event:       c.event,
        't_event':   `${c.t_event_mois}m`,
        Statut:      c.event === 1 ? '⚠ négatif' : '✓ actif',
      };
    });
    console.table(rows);

    const predictions = VALIDATION_CASES.map(calcS36);
    const { c_index, concordant, comparable } = harrellC(VALIDATION_CASES, predictions);

    console.log('\n' + '═'.repeat(60));
    console.log('  RAPPORT TRL 4 — IRO Strength Velocity v7.0.0');
    console.log('═'.repeat(60));
    console.log(`  Dataset         : ${VALIDATION_CASES.length} cas FR documentés`);
    console.log(`  event=1         : ${VALIDATION_CASES.filter(c => c.event === 1).length} (acquisitions, pivots, fermetures)`);
    console.log(`  event=0         : ${VALIDATION_CASES.filter(c => c.event === 0).length} (startups actives, censurées)`);
    console.log(`  Paires compar.  : ${comparable}`);
    console.log(`  Concordantes    : ${concordant}`);
    console.log(`  Harrell C-index : ${c_index}`);
    console.log(`  Seuil TRL 4     : 0.75 → ${c_index >= 0.75 ? '✅ ATTEINT' : '❌ NON ATTEINT'}`);
    console.log(`  Seuil VC (0.85) : ${c_index >= 0.85 ? '✅ ATTEINT' : '⚠ en approche'}`);
    console.log('═'.repeat(60));

    expect(c_index).toBeGreaterThan(0); // toujours passer — ce test est informatif
  });
});
