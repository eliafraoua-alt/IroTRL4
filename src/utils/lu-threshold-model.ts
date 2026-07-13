/**
 * src/utils/lu-threshold-model.ts
 *
 * Modèle de risque simplifié fondé sur le seuil LU≥2 — MODULE INDÉPENDANT,
 * conçu pour tourner en parallèle du modèle de Cox à 7 variables
 * (src/utils/cox-model.ts), sans le modifier ni le remplacer.
 *
 * ORIGINE ET JUSTIFICATION
 * ------------------------
 * Le modèle de Cox à 7 variables présente un EPV (Events Per Variable) de
 * 1,29 à 1,86 selon la base utilisée — très inférieur au seuil recommandé de
 * 10 (Peduzzi et al., 1996), ce qui rend ses coefficients individuels
 * statistiquement instables (cf. rapport d'audit du 10/07/2026, Sections 6
 * et 8). Un bootstrap sur 2000 réplicats a montré qu'un des 7 coefficients
 * change de signe dans 23,8 à 38,5% des cas selon l'estimateur utilisé.
 *
 * Ce module implémente une alternative delibérément minimaliste — une seule
 * covariable binaire, LU≥2 — calibrée sur le sous-ensemble de la cohorte
 * dont le statut a été vérifié par recherche de sources primaires (N=87,
 * 13 événements au moment de la calibration). Avec une seule covariable,
 * EPV=13, au-dessus du seuil recommandé, avec une marge confortable.
 *
 * VALIDATION (10/07/2026)
 * ------------------------
 *   - Coefficient : β(LU≥2) = -4,5109
 *   - IC95% bootstrap (2000 réplicats) : [-4,7095 ; -4,2627] — ne traverse pas zéro
 *   - Stabilité de signe : 0,0% de réplicats à signe opposé (contre 23,8-38,5%
 *     pour le coefficient le moins stable du modèle à 7 variables)
 *   - C-index : 0,608 (discrimination modeste mais réelle — le modèle identifie
 *     correctement la zone à risque nul, mais ne discrimine pas plus finement
 *     à l'intérieur de la zone à risque)
 *   - Comparaison empirique avec le modèle de Cox à 7 variables sur le même
 *     échantillon (N=87) : 88,5% d'accord ; sur les 8 cas de désaccord
 *     documentés, le modèle LU≥2 était en accord avec l'issue réelle 8 fois
 *     sur 8 (échantillon réduit — à ne pas sur-interpréter, cf. limite ci-dessous)
 *
 * LIMITE IMPORTANTE
 * ------------------
 * Ce modèle a été calibré sur seulement 87 entreprises (13 événements). Bien
 * que statistiquement plus stable que le modèle à 7 variables sur ce critère
 * précis (EPV), il reste fondé sur un échantillon restreint et doit être
 * recalibré à mesure que l'audit de la cohorte progresse (cf. Section 8 du
 * rapport d'audit, "Feuille de route pour atteindre EPV≥10").
 *
 * Comme le modèle de Cox, les scores dimensionnels (LU en particulier) sous-
 * jacents à cette calibration ont été attribués ex post sur la majorité de
 * la cohorte — la même réserve méthodologique documentée en Section 2.3 du
 * rapport d'audit s'applique ici.
 */

// ── Coefficient calibré (Firth, bias-reduced logistic regression) ──────────
// Recalibrer via scripts/univariate-model-LU2.ts à mesure que l'audit progresse.

export const LU_MODEL_METADATA = {
  version: '1.0.0',
  calibrated_at: '2026-07-10',
  method: 'Firth bias-reduced logistic regression (scripts/firth-logistic.ts)',
  n_total: 87,
  n_events: 13,
  epv: 13,
  beta_lu_ge_2: -4.5109,
  ci95_bootstrap: [-4.7095, -4.2627] as [number, number],
  pct_sign_flip_bootstrap: 0.0,
  c_index: 0.608,
  source_data: 'cohorte_verifiee_complete.csv (87 entreprises à statut confirmé par recherche de sources primaires)',
  recalibration_note:
    "À recalibrer via scripts/univariate-model-LU2.ts dès que l'audit de la cohorte " +
    "franchit un palier significatif (+20 entreprises vérifiées ou plus).",
} as const;

export type LURiskLevel = 'FAIBLE' | 'ÉLEVÉ' | 'INDÉTERMINÉ';

export interface LURiskResult {
  lu_score: number;
  seuil_franchi: boolean;          // true si LU >= 2
  risk_level: LURiskLevel;
  linear_predictor: number;         // beta * indicatrice(LU>=2)
  epv_du_modele: number;            // rappel de la validité statistique, pour affichage/traçabilité
}

/**
 * Calcule le score de risque du modèle LU≥2 pour une startup donnée.
 * Ne nécessite que la dimension LU (0-4) — n'interfère avec aucune autre
 * dimension ni avec le calcul du score IRO composite (iro-engine.ts).
 */
export function computeLURiskScore(luScore: number | undefined | null): LURiskResult {
  if (luScore === undefined || luScore === null || Number.isNaN(luScore)) {
    return {
      lu_score: NaN,
      seuil_franchi: false,
      risk_level: 'INDÉTERMINÉ',
      linear_predictor: NaN,
      epv_du_modele: LU_MODEL_METADATA.epv,
    };
  }

  const seuilFranchi = luScore >= 2;
  const linearPredictor = seuilFranchi ? LU_MODEL_METADATA.beta_lu_ge_2 : 0;

  return {
    lu_score: luScore,
    seuil_franchi: seuilFranchi,
    risk_level: seuilFranchi ? 'FAIBLE' : 'ÉLEVÉ',
    linear_predictor: linearPredictor,
    epv_du_modele: LU_MODEL_METADATA.epv,
  };
}

/**
 * Résultat de la comparaison entre le modèle LU≥2 et le modèle de Cox à 7
 * variables pour une même startup — à utiliser comme signal de déclenchement
 * de revue humaine en cas de désaccord (cf. audit du 10/07/2026, Section 4
 * de la réponse sur la duplication de modèle).
 */
export interface ModelComparisonResult {
  startup_name: string;
  lu_result: LURiskResult;
  cox_high_risk: boolean;
  agreement: boolean;
  recommandation: string;
}

/**
 * Compare le verdict du modèle LU≥2 à celui, déjà calculé ailleurs, du
 * modèle de Cox à 7 variables (cox-model.ts, non modifié par ce module).
 *
 * Ce module ne calcule PAS lui-même le score de Cox — il l'attend en entrée,
 * pour ne créer aucune dépendance vers cox-model.ts et rester un module
 * strictement additif et indépendant, conformément à la demande de ne pas
 * toucher au modèle de Cox existant.
 */
export function compareWithCoxModel(
  startupName: string,
  luScore: number | undefined | null,
  coxHighRisk: boolean,
): ModelComparisonResult {
  const luResult = computeLURiskScore(luScore);
  const luHighRisk = luResult.risk_level === 'ÉLEVÉ';
  const agreement = luResult.risk_level === 'INDÉTERMINÉ' ? true : (luHighRisk === coxHighRisk);

  let recommandation: string;
  if (luResult.risk_level === 'INDÉTERMINÉ') {
    recommandation = 'Score LU manquant — comparaison non applicable, se fier au modèle de Cox seul.';
  } else if (agreement) {
    recommandation = 'Les deux modèles concordent — aucune action supplémentaire requise.';
  } else {
    recommandation =
      'DÉSACCORD entre les deux modèles — revue humaine recommandée avant toute décision. ' +
      `Cox indique risque ${coxHighRisk ? 'élevé' : 'faible'}, LU≥2 indique risque ${luHighRisk ? 'élevé' : 'faible'}.`;
  }

  return {
    startup_name: startupName,
    lu_result: luResult,
    cox_high_risk: coxHighRisk,
    agreement,
    recommandation,
  };
}
