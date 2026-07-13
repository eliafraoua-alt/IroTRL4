import type { GoldStandardEntry, ModelVersion } from '../types/iro';
import { computeR2, calcIRO } from './iro-engine';

export interface ValidationResult {
  isValid: boolean;
  heterogeneous: boolean;
  v42Entries: GoldStandardEntry[];
  v43Entries: GoldStandardEntry[];
  missingGCH: string[];        // noms des startups à renoter
  errors: string[];
}

export function validateGoldStandard(
  entries: GoldStandardEntry[]
): ValidationResult {
  const v42 = entries.filter(e => e.modelVersion === '4.2' && !e.migrated);
  const v43 = entries.filter(e => e.modelVersion === '4.3' || e.modelVersion === '4.4-LU' || e.migrated);
  const missingGCH = entries
    .filter(e => e.scores.GCH === undefined)
    .map(e => e.name);

  const heterogeneous = v42.length > 0 && v43.length > 0;
  const errors: string[] = [];

  if (heterogeneous) {
    errors.push(
      `⚠️ Gold standard hétérogène : ${v42.length} entrée(s) v4.2 non migrée(s) ` +
      `mélangée(s) avec ${v43.length} entrée(s) v4.3. ` +
      `Le calcul R² est bloqué jusqu'à migration complète.`
    );
  }

  if (missingGCH.length > 0) {
    errors.push(`GCH manquant pour : ${missingGCH.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    heterogeneous,
    v42Entries: v42,
    v43Entries: v43,
    missingGCH,
    errors
  };
}

/**
 * Bloquer R² si hétérogène
 */
export function calcR2Safe(
  entries: GoldStandardEntry[]
): { r2: number; valid: boolean } | { blocked: true; reason: string } {
  const validation = validateGoldStandard(entries);
  if (!validation.isValid) {
    return { blocked: true, reason: validation.errors.join(' — ') };
  }
  
  // Calcul normal uniquement si tout est v4.3 (ou migré)
  const actuals = entries.map(e => e.sce.final);
  const predicteds = entries.map(e => {
    // On utilise calcIRO avec les scores de l'entrée
    // Note: calcIRO attend (scores, ipcConf, trl, adcConf, gchConf)
    // Ici on simplifie pour le gold standard
    return calcIRO(
      e.scores as any, 
      0.8, // ipcConf par défaut pour le gold standard
      undefined,
      1.0, // adcConf
      1.0  // gchConf
    );
  });

  return { r2: computeR2(actuals, predicteds), valid: true };
}
