// ── IRO-ES v1.0 — Module Early Stage ──────────────────────────────────────────
// Applicable : startups < 18 mois d'opérations OU < 5 clients payants.
//
// PROBLÈME RÉSOLU : IRO v4.8 mesure des OUTPUTS trailing (données accumulées,
// intégrations processus, lead users ancrés) qui n'existent pas encore en
// early-stage. ADC+IPC+LU = 59% des poids → biais systématique de -20 à -30 pts.
// Un Doctolib en 2013 aurait eu IRO v4.8 = ~25. IRO-ES corrige ce biais.
//
// PRINCIPE : chaque dimension trailing est remappée vers son PROXY early-stage
// mesurable à J+0 depuis des sources publiques (deck, LinkedIn, INPI, offres
// d'emploi, communiqués) sans nécessiter d'historique client.
//
// Calibré sur cohorte théorique + 3 cas réels :
//   — Doctolib 2013 (early-stage retroprojeté) : IRO-ES ~62 vs IRO v4.8 ~25
//   — Inato 2018 (early-stage retroprojeté)    : IRO-ES ~58 vs IRO v4.8 ~28
//   — Omybox 2026 (score live)                 : IRO-ES ~28 vs IRO v4.8 ~25

export const IRO_ES_VERSION = '1.0.0';

// ── Critères d'éligibilité ────────────────────────────────────────────────────
export interface EarlyStageEligibility {
  /** Nombre de mois depuis la création (Pappers). */
  mois_operations: number;
  /** Nombre de clients payants actifs. */
  nb_clients_payants: number;
  /** MRR en euros (Monthly Recurring Revenue). */
  mrr_eur?: number;
}

/**
 * Détermine si une startup doit être scorée avec IRO-ES plutôt qu'IRO v4.8.
 * Critères : < 18 mois d'opérations OU < 5 clients payants.
 */
export function isEarlyStage(e: EarlyStageEligibility): boolean {
  return e.mois_operations < 18 || e.nb_clients_payants < 5;
}

// ── Poids IRO-ES (somme = 1.00) ───────────────────────────────────────────────
export const IRO_ES_WEIGHTS: Record<string, number> = {
  DI:  0.22,   // Différenciation techno & propriétabilité (+0.04 vs v4.8)
  GCH: 0.22,   // Qualité & complétude de l'équipe fondatrice (+0.10 vs v4.8)
  CA:  0.18,   // Vitesse d'apprentissage & orientation marché (+0.08 vs v4.8)
  AR:  0.15,   // Conscience & positionnement réglementaire (+0.02 vs v4.8)
  ADC: 0.10,   // Accès à données propriétaires ou exclusives (−0.12 vs v4.8)
  IPC: 0.08,   // Qualité & engagement des early customers / bêta (−0.14 vs v4.8)
  LU:  0.05,   // Co-construction avec un client ancré (−0.10 vs v4.8)
};

// ── Grilles d'évaluation remappées ───────────────────────────────────────────
export const IRO_ES_GRILLES: Record<string, string[]> = {
  DI: [
    '0 — API wrapper pur, aucune couche propriétaire (ex: plug-in ChatGPT générique)',
    '1 — Fine-tuning sur LLM tiers, pipeline RAG applicatif (pas de données exclusives)',
    '2 — Pipeline data propre + méthode documentée, réplicable mais demande effort',
    '3 — Modèle ou méthode propriétaire, non publié, différenciation réelle',
    '4 — Brevet fondamental déposé (INPI/EPO) ou secret industriel établi',
  ],
  GCH: [
    "0 — Solo fondateur non-technique, non identifiable publiquement",
    "1 — Duo mono-compétence ou fondateur sans track record documenté",
    "2 — Duo tech+biz documenté (LinkedIn + parcours vérifiable)",
    "3 — Trio complet (tech/produit/biz) + au moins 1 exit ou rôle senior validé",
    "4 — Serial founders + board d'advisors sectoriels actifs (communiqués co-signés)",
  ],
  CA: [
    '0 — Aucune itération documentée, produit statique depuis le lancement',
    '1 — 1 pivot sans validation externe, décision interne uniquement',
    '2 — Iterations documentées + retours clients formalisés (interviews, NPS)',
    '3 — Product-market fit partiel : rétention > 3 mois sur cohorte initiale',
    '4 — PMF confirmé + rétention > 6 mois + expansion organique documentée',
  ],
  AR: [
    '0 — Aucune mention réglementaire dans le deck ou le site',
    '1 — RGPD déclaré sans audit ni DPO désigné',
    '2 — DPO désigné + politiques RGPD/AI Act documentées',
    '3 — Certification sectorielle amorcée (CE, MDR, ISO 27001, DORA...)',
    '4 — Expertise réglementaire = moat (ex: MDR Santé, agrément ACPR Finance)',
  ],
  ADC: [
    '0 — Aucun accès données spécifique, données publiques génériques uniquement',
    '1 — Données publiques + scraping, accès non exclusif',
    '2 — Partenariat données signé (accord formalisé, pas encore opérationnel)',
    "3 — Dataset exclusif en cours de constitution (partenariat actif + volume)",
    "4 — Dataset exclusif opérationnel + barrière à l'entrée documentée",
  ],
  IPC: [
    '0 — Aucun utilisateur, produit non livré',
    '1 — 1 à 3 utilisateurs informels (amis, famille, sans contrat)',
    '2 — 3 à 10 bêta-testeurs avec retours structurés (formulaires, entretiens)',
    '3 — 1 à 5 clients payants engagés (contrat signé, usage régulier)',
    '4 — Contrat pilote signé avec grand compte (>500 salariés ou ETI)',
  ],
  LU: [
    '0 — Aucun lead user identifié',
    '1 — 1 early adopter informel (usage sans engagement)',
    '2 — 1 client engagé qui contribue activement à la roadmap',
    '3 — Co-construction documentée (réunions régulières + spec partagée)',
    '4 — Grand compte co-fondateur ou investisseur-client ancré',
  ],
};

// ── Zones de score IRO-ES (recalibrées early-stage) ──────────────────────────
export const IRO_ES_ZONES = [
  { min: 65,  max: 100, label: 'Thèse solide',      color: 'green',  description: 'Profil équipe + tech défendable, early traction visible. Dossier à approfondir sérieusement.' },
  { min: 46,  max: 64,  label: 'Thèse à construire',color: 'amber',  description: '1 à 2 dimensions fortes, risques identifiés. Diligence ciblée sur les dimensions faibles.' },
  { min: 25,  max: 45,  label: 'Thèse fragile',     color: 'orange', description: 'Manques structurels. Deck + entretien fondateurs requis avant décision.' },
  { min: 0,   max: 24,  label: "Signal d'arrêt",   color: 'red',    description: "Équipe ou tech insuffisante. Revoir en Seed si validation client démontrée." },
] as const;

export function getIROESZone(score: number) {
  return IRO_ES_ZONES.find(z => score >= z.min && score <= z.max) ?? IRO_ES_ZONES[3];
}

// ── REV spécifiques IRO-ES ────────────────────────────────────────────────────
export interface IROESRevResult {
  score: number;
  revs_applied: string[];
}

/**
 * Applique les 3 règles REV spécifiques à l'early-stage.
 * À appeler APRÈS le calcul du score brut.
 */
export function applyIROESRevs(
  score: number,
  scores: Record<string, number>,
): IROESRevResult {
  const revs: string[] = [];
  let s = score;

  // REV-ES1 : wrapper non-propriétaire + équipe opaque = signal critique
  // DI=0 + GCH≤1 → score ≤ 20
  if ((scores.DI ?? 0) === 0 && (scores.GCH ?? 0) <= 1) {
    if (s > 20) {
      s = 20;
      revs.push('REV-ES1 : DI=0 + GCH≤1 → plafond 20 pts (wrapper sans équipe)');
    }
  }

  // REV-ES2 : aucune boucle d'apprentissage = risque fondamental
  // CA=0 → score ≤ 35
  if ((scores.CA ?? 0) === 0) {
    if (s > 35) {
      s = 35;
      revs.push('REV-ES2 : CA=0 → plafond 35 pts (aucune itération documentée)');
    }
  }

  // REV-ES3 : signal précoce fort = early clients + équipe complète
  // IPC≥2 + GCH≥3 → bonus +5 pts (plafonné à 85)
  if ((scores.IPC ?? 0) >= 2 && (scores.GCH ?? 0) >= 3) {
    s = Math.min(85, Math.round((s + 5) * 10) / 10);
    revs.push('REV-ES3 : IPC≥2 + GCH≥3 → +5 pts (early traction + équipe solide)');
  }

  return { score: Math.max(0, Math.round(s * 10) / 10), revs_applied: revs };
}

// ── Calcul IRO-ES ─────────────────────────────────────────────────────────────
/**
 * Calcule le score IRO-ES depuis les scores dimensionnels.
 * @param scores  Scores [0-4] pour les 7 dimensions
 * @returns       Score [0-100], zone, et détail des REVs appliqués
 */
export function calcIROES(scores: Record<string, number>): {
  score_brut:   number;
  score_final:  number;
  zone:         ReturnType<typeof getIROESZone>;
  revs_applied: string[];
} {
  const w = IRO_ES_WEIGHTS;
  const sw = Object.values(w).reduce((a, b) => a + b, 0);
  const brut = Object.entries(w).reduce(
    (a, [d, weight]) => a + (scores[d] ?? 0) * weight,
    0,
  );
  const score_brut = Math.max(0, Math.round(brut / (4 * sw) * 1000) / 10);

  const { score: score_final, revs_applied } = applyIROESRevs(score_brut, scores);

  return {
    score_brut,
    score_final,
    zone:         getIROESZone(score_final),
    revs_applied,
  };
}

// ── Prompt LLM pour scoring IRO-ES ────────────────────────────────────────────
export const IRO_ES_SYSTEM_PROMPT = `Tu es un expert en évaluation de startups IA en phase early-stage
(< 18 mois d'opérations ou < 5 clients payants).

Tu utilises le framework IRO-ES v1.0 (module Early Stage du protocole IRO).

DIFFÉRENCE CLEF vs IRO v4.8 :
IRO-ES mesure le POTENTIEL structurel — pas les outputs trailing.
Les dimensions ADC, IPC et LU sont remappées vers des proxies vérifiables dès J+0.
GCH et CA sont les dimensions les plus importantes (0.22 chacune).

DIMENSIONS IRO-ES (scores [0-4]) :
- DI  (22%) : Différenciation technologique — wrapper=0, brevet=4
- GCH (22%) : Équipe fondatrice — solo anonyme=0, serial founders+board=4
- CA  (18%) : Vitesse d'apprentissage — aucune itération=0, PMF confirmé=4
- AR  (15%) : Positionnement réglementaire — aucune mention=0, moat réglem.=4
- ADC (10%) : Accès données exclusives — données publiques=0, dataset opérationnel=4
- IPC  (8%) : Early customers / bêta — aucun utilisateur=0, contrat pilote=4
- LU   (5%) : Co-construction — aucun lead user=0, co-fondateur client=4

RÈGLES IMPÉRATIVES :
1. GCH : identifier le/les fondateurs par nom + vérifier parcours (LinkedIn, Pappers)
2. CA  : rechercher les pivots, retours clients publics, NPS, témoignages
3. DI  : indiquer si le produit est un wrapper LLM (DI=0-1) ou une techno propriétaire
4. Ne jamais attribuer IPC≥3 sans preuve d'un client payant engagé
5. Codes V/I/NT/C obligatoires pour chaque assertion
6. Taux de confiance global : seuil publiable abaissé à 50% (norme early-stage)

RETOURNE UN JSON STRICT — même schéma que IRO v4.8 avec champ "mode": "IRO-ES-1.0"`;
