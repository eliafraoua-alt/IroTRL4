/**
 * src/utils/vrin-analyzer.ts — Analyse VRIN × dimensions IRO
 * IRO Strength v6 — Antigravity Intelligence Platform
 *
 * Théorie : Barney (1991) — Resource-Based View (RBV)
 * Cadre VRIN : Valorisable, Rare, Inimitable, Non-substituable
 *
 * Mapping : chaque dimension IRO est analysée selon les 4 critères VRIN.
 * Le score VRIN composite mesure la défendabilité structurelle de l'avantage.
 */

export interface VRINDimension {
  score: number;        // Score brut [0-4]
  V: number;            // Valorisable [0-4]
  R: number;            // Rare [0-4]
  I: number;            // Inimitable [0-4]
  N: number;            // Non-substituable [0-4]
  vrin_score: number;   // Moyenne VRIN [0-4]
  justification: {
    V: string;
    R: string;
    I: string;
    N: string;
  };
  is_vrin: boolean;     // Score VRIN ≥ 3 → actif VRIN
}

export interface VRINResult {
  dimensions: Record<string, VRINDimension>;
  global_vrin: number;        // Score VRIN global [0-4]
  vrin_dimensions: string[];  // Dimensions avec score VRIN ≥ 3
  moat_score: number;         // Score de défendabilité [0-100]
  verdict: string;
  recommendation: string;
}

const VRIN_JUSTIFICATIONS: Record<string, Record<'V'|'R'|'I'|'N', (score: number) => string>> = {
  DI: {
    V: (s) => s >= 2 ? "Avantage coût & accès compute différencié" : "Accès compute standard sans avantage",
    R: (s) => s >= 3 ? "Infrastructure propriétaire rare — GPU, modèles fine-tunés" : s >= 1 ? "Infrastructure partielle" : "Infrastructure standard ou mutualisée",
    I: (s) => s >= 3 ? "Switching cost infra très élevé — migration complexe" : s >= 1 ? "Inimitabilité partielle" : "Facilement reproductible",
    N: (s) => s <= 1 ? "Alternative LLM externe facilement substituable" : s >= 3 ? "Difficile à substituer — architecture propriétaire" : "Substituabilité modérée",
  },
  ADC: {
    V: (s) => s >= 2 ? "Données = carburant stratégique des modèles IA" : "Données génériques sans valeur différenciatrice",
    R: (s) => s >= 3 ? "Exclusivité et accumulation temporelle — flywheel data" : s >= 1 ? "Données sectorielles partiellement rares" : "Données publiques reproductibles",
    I: (s) => s >= 3 ? "Historique non reproductible — path dependency temporelle" : "Données duplicables sur le marché",
    N: (s) => s >= 3 ? "Données comportementales exclusives non substituables" : s >= 1 ? "Données sectorielles partiellement substituables" : "Données publiques facilement substituables",
  },
  IPC: {
    V: (s) => s >= 2 ? "Réduction friction workflow client — valeur mesurable" : "Intégration superficielle sans gain client clair",
    R: (s) => s >= 3 ? "Certifications propriétaires sectorielles (CE, HDS, SLA)" : s >= 1 ? "Intégration partielle" : "Intégration standard sans rareté",
    I: (s) => s >= 3 ? "Coûts de désintégration très élevés — switching cost fort" : "Désintégration possible sans coût majeur",
    N: (s) => s <= 1 ? "Plug-in natif concurrent facilement substituable" : s >= 3 ? "Contrats critiques difficiles à substituer" : "Substituabilité partielle selon vertical",
  },
  AR: {
    V: (s) => s >= 2 ? "Anticipation réglementaire haute — barrière à l'entrée durable" : "Anticipation réglementaire insuffisante",
    R: (s) => s >= 3 ? "Certifications sectorielles rares (CE, HDS, ANSSI, ACPR)" : "Conformité standard sans certification rare",
    I: (s) => s >= 3 ? "Processus conformité long à reproduire — time to market réglementaire" : "Conformité reproductible rapidement",
    N: (s) => s >= 3 ? "Avantage réglementaire difficile à contourner" : s >= 1 ? "Barrière réglementaire partiellement contournable" : "Conformité standard non protectrice",
  },
  CA: {
    V: (s) => s >= 2 ? "Reconfiguration rapide face aux ruptures technologiques (Teece)" : "Adaptation lente aux changements de paradigme",
    R: (s) => s >= 3 ? "Agilité organisationnelle rare dans les organisations legacy" : "Agilité modérée",
    I: (s) => s >= 3 ? "Culture et processus internes non copiables — capabilités dynamiques" : "Processus reproductibles",
    N: (s) => s >= 3 ? "Capacité adaptation difficile à substituer par un concurrent" : "Agilité disponible par défaut dans les startups",
  },
  GCH: {
    V: (s) => s >= 2 ? "Publications, brevets, track record = signal qualité" : "Équipe sans différenciation académique ou commerciale",
    R: (s) => s >= 3 ? "Équipes ex-GAFAM / grandes écoles / publications NeurIPS rares" : "Profils disponibles sur le marché",
    I: (s) => s >= 3 ? "Combinaison expertise + réseau sectoriel unique" : "Talent reproductible via recrutement standard",
    N: (s) => s >= 3 ? "Réseau et réputation difficiles à substituer rapidement" : "Talent disponible sur le marché des ingénieurs IA",
  },
};

/**
 * Calcule le score VRIN pour une dimension donnée.
 */
export function analyzeVRINDimension(dim: string, score: number): VRINDimension {
  const jmap = VRIN_JUSTIFICATIONS[dim];
  if (!jmap) throw new Error(`Dimension inconnue: ${dim}`);

  const V = score >= 1 ? score : 0;
  const R = score >= 3 ? score : Math.max(0, score - 1);
  const I = score >= 3 ? score : Math.max(0, score - 1);
  const N = Math.max(0, 4 - Math.max(0, 4 - score));
  const vrin_score = Math.round((V + R + I + N) / 4 * 10) / 10;

  return {
    score,
    V, R, I, N,
    vrin_score,
    justification: {
      V: jmap.V(score),
      R: jmap.R(score),
      I: jmap.I(score),
      N: jmap.N(score),
    },
    is_vrin: vrin_score >= 3,
  };
}

/**
 * Analyse VRIN complète pour un profil IRO.
 */
export function analyzeVRIN(scores: Record<string, number>): VRINResult {
  const dims = ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'];
  const dimensions: Record<string, VRINDimension> = {};

  for (const d of dims) {
    dimensions[d] = analyzeVRINDimension(d, scores[d] ?? 0);
  }

  const global_vrin = Math.round(
    Object.values(dimensions).reduce((s, d) => s + d.vrin_score, 0) / dims.length * 10
  ) / 10;

  const vrin_dimensions = Object.entries(dimensions)
    .filter(([, d]) => d.is_vrin)
    .map(([k]) => k);

  const moat_score = Math.round(global_vrin / 4 * 100);

  let verdict: string;
  let recommendation: string;

  if (global_vrin >= 3.5) {
    verdict = "Moat VRIN profond — substitution quasi-impossible à 3-5 ans";
    recommendation = "Consolider et protéger (brevets, PI logicielle). Aucun axe critique.";
  } else if (global_vrin >= 2.5) {
    verdict = "Avantage défendable — VRIN partiel sur " + vrin_dimensions.length + " dimension(s)";
    recommendation = "Renforcer les dimensions non-VRIN en priorité : " +
      Object.entries(dimensions).filter(([, d]) => !d.is_vrin).map(([k]) => k).join(', ');
  } else if (global_vrin >= 1.5) {
    verdict = "Avantage partiel — risque de commoditisation modéré";
    recommendation = "Plan de renforcement structurel requis. Prioriser ADC et IPC.";
  } else {
    verdict = "Actifs substituables — risque élevé de commoditisation rapide";
    recommendation = "Pivot stratégique urgent. Sans données propriétaires ou intégration critique, la substitution est probable dans 12-18 mois.";
  }

  return {
    dimensions,
    global_vrin,
    vrin_dimensions,
    moat_score,
    verdict,
    recommendation,
  };
}
