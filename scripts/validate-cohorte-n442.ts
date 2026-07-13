import { COHORTE_VALIDATION } from '../src/data/cohorte-validation-n442';

// Simple seedable pseudo-random generator
function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function computeAUC(data: { score: number, event: boolean }[]): number {
  const positives = data.filter(x => x.event);
  const negatives = data.filter(x => !x.event);
  if (positives.length === 0 || negatives.length === 0) return 0;
  
  let count = 0;
  for (const pos of positives) {
    for (const neg of negatives) {
      if (pos.score < neg.score) {
        count += 1.0;
      } else if (pos.score === neg.score) {
        count += 0.5;
      }
    }
  }
  return count / (positives.length * negatives.length);
}

function run() {
  console.log('=== RAPPORT DE VALIDATION DE LA COHORTE N=442 ===');
  
  // Périmètre vérifié : exclure NON_AUDITE et scores nuls
  const verified = COHORTE_VALIDATION.filter(e => e.audit !== 'NON_AUDITE' && e.iro != null);
  console.log(`Périmètre d'analyse (vérifié) : n = ${verified.length}`);
  
  const defaillances = verified.filter(e => e.status === 'failed').length;
  const acquisitions = verified.filter(e => e.status === 'acquired').length;
  const actives = verified.filter(e => e.status === 'active').length;
  
  console.log(`- Actives : ${actives}`);
  console.log(`- Acquisitions : ${acquisitions}`);
  console.log(`- Défaillances : ${defaillances}`);
  
  // AUC Événement Correct
  const aucCorrect = computeAUC(verified.map(e => ({
    score: e.iro ?? 0,
    event: e.status === 'failed'
  })));
  
  // AUC Événement Erroné (Confondre défaillance et acquisition)
  const aucErrone = computeAUC(verified.map(e => ({
    score: e.iro ?? 0,
    event: e.status === 'failed' || e.status === 'acquired'
  })));
  
  console.log(`\nAUC Événement Correct (Défaillance strict) : ${aucCorrect.toFixed(3)}`);
  console.log(`AUC Événement Erroné (Défaillance + Acquisition) : ${aucErrone.toFixed(3)}`);
  console.log(`Perte de signal due à la confusion des issues : ${(aucCorrect - aucErrone).toFixed(3)}`);
  
  // Bootstrap pour intervalle de confiance
  const seed = 20260712;
  const bootstrapN = 2000;
  const rng = mulberry32(seed);
  const bootstrapAUCs: number[] = [];
  
  for (let b = 0; b < bootstrapN; b++) {
    const sample: { score: number, event: boolean }[] = [];
    for (let i = 0; i < verified.length; i++) {
      const idx = Math.floor(rng() * verified.length);
      sample.push({
        score: verified[idx].iro ?? 0,
        event: verified[idx].status === 'failed'
      });
    }
    bootstrapAUCs.push(computeAUC(sample));
  }
  
  bootstrapAUCs.sort((a, b) => a - b);
  const ciLow = bootstrapAUCs[Math.floor(bootstrapN * 0.025)];
  const ciHigh = bootstrapAUCs[Math.floor(bootstrapN * 0.975)];
  
  console.log(`Bootstrap CI 95% [${ciLow.toFixed(3)} - ${ciHigh.toFixed(3)}]`);
  
  // Analyse des seuils
  console.log('\n--- ANALYSE DES SEUILS DE VIABILITÉ ---');
  const seuils = [38, 46, 50];
  for (const threshold of seuils) {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    
    for (const e of verified) {
      const predictedRisk = (e.iro ?? 0) < threshold;
      const actualFailure = e.status === 'failed';
      
      if (predictedRisk && actualFailure) tp++;
      else if (predictedRisk && !actualFailure) fp++;
      else if (!predictedRisk && !actualFailure) tn++;
      else if (!predictedRisk && actualFailure) fn++;
    }
    
    const sensibilite = tp / (tp + fn);
    const specificite = tn / (tn + fp);
    const precision = tp / (tp + fp || 1);
    const f1 = (2 * precision * sensibilite) / (precision + sensibilite || 1);
    
    console.log(`Seuil ${threshold} :`);
    console.log(`  TP: ${tp}, FP: ${fp}, TN: ${tn}, FN: ${fn}`);
    console.log(`  Sensibilité: ${sensibilite.toFixed(3)}`);
    console.log(`  Spécificité: ${specificite.toFixed(3)}`);
    console.log(`  Précision  : ${precision.toFixed(3)}`);
    console.log(`  F1-Score   : ${f1.toFixed(3)}`);
  }
  
  // Analyse par zones de score
  console.log('\n--- DISTRIBUTION PAR ZONES ---');
  const zones = [
    { label: 'Risque élevé', min: 0, max: 45 },
    { label: 'Vigilance', min: 46, max: 64 },
    { label: 'Solide', min: 65, max: 79 },
    { label: 'Excellent', min: 80, max: 100 }
  ];
  
  for (const zone of zones) {
    const zoneEntries = verified.filter(e => (e.iro ?? 0) >= zone.min && (e.iro ?? 0) <= zone.max);
    const zoneDefaillances = zoneEntries.filter(e => e.status === 'failed').length;
    const rate = zoneDefaillances / (zoneEntries.length || 1);
    console.log(`${zone.label} (${zone.min}-${zone.max}) : n = ${zoneEntries.length}, défaillances = ${zoneDefaillances}, taux = ${(rate * 100).toFixed(1)}%`);
  }
}

run();
