// ── IRO v4.5 — Protocole Sources & Anti-Hallucination ─────────────────────────
// Types pour les flags, niveaux de confiance, fraîcheur et grille de sourcing.
// Issu des 3 défaillances cohorte IRO-2026-Q2 :
//   Type A — hallucination de source (AFD/Quadratic)
//   Type B — sous-investigation sources grises (HIoTee SIREN non interrogé)
//   Type C — données stales non signalées (HIoTee CA 2019 traité comme CA 2024)

// ── Niveau de confiance épistémique V/I/NT/C ─────────────────────────────────
// Chaque assertion factuelle dans un rapport IRO reçoit ce statut.
export type TrustCode = 'V' | 'I' | 'NT' | 'C';
//   V  — Vérifié  : source directe, URL ou référence BODACC/Pappers identifiée.
//   I  — Inféré   : plausible, cohérent, mais sans preuve directe. −0.5/5 + flag.
//   NT — Non trouvé : recherche effectuée, rien trouvé. 1/5 par défaut + flag.
//   C  — Classifié : confidentiel (défense, OSST), CP officiel confirmant l'existence.

// ── Indice de fraîcheur des données ──────────────────────────────────────────
export type FreshnessCode = 'F' | 'M' | 'S' | 'ND';
//   F  — Frais     : vérifié < 6 mois. Score nominal.
//   M  — Moyen     : 6-18 mois. Note 'à re-vérifier'.
//   S  — Stale     : > 18 mois. Décote −0.5/5 + flag data_stale=true.
//   ND — Non daté  : source sans date. Traité comme Stale.

// ── Entrée de source avec niveau de confiance et fraîcheur ───────────────────
export interface SourceEntry {
  dim:        string;          // dimension concernée (DI, ADC, IPC, AR, CA, GCH, LU)
  source:     string;          // nom de la source (ex: "Pappers marchés publics")
  url?:       string;          // URL ou référence documentaire
  date_verif?: string;         // JJ/MM/AAAA
  trust_code: TrustCode;       // V / I / NT / C
  freshness:  FreshnessCode;   // F / M / S / ND
  assertion?: string;          // texte de l'assertion sourcée
}

// ── Tableau de fraîcheur par dimension (§5.1 du protocole) ───────────────────
export type FreshnessTable = Record<string, {
  source_principale: string;
  date_verif:        string;
  freshness:         FreshnessCode;
  decote_applied:    boolean;
}>;

// ── Flags IRO v4.5 — référentiel complet (§10 du protocole) ──────────────────
export interface IROFlagsV45 {
  // Statut juridique — BLOQUANT (étape 2 séquence investigation)
  liquidation_judiciaire:   boolean;   // BODACC jugement liquidation → −10 pts
  redressement_judiciaire:  boolean;   // BODACC jugement redressement → −5 pts

  // PI & technologie
  brevet_non_verifie:       boolean;   // INPI/EPO : d'eclaré mais non trouvé → DI ≤ 3/5
  claims_non_audites:       boolean;   // métriques auto-déclarées sans audit → ADC −0.5

  // Données financières
  data_stale:               boolean;   // bilan > 18 mois (fraîcheur 🔴) → ADC −0.5

  // Dirigeant / équipe
  dirigeant_anonyme:        boolean;   // fondateur non identifiable → GCH ≤ 2/5
  activite_parallele:       boolean;   // activité tierce non documentée → GCH −0.5

  // Clients / contrats
  contrat_retire:           boolean;   // contrat cité retiré post-vérification → IPC −1
  operateur_certifie:       boolean;   // IoT/Sat sans opérateur certifié → IPC ≤ 2/5

  // Gouvernance
  conseil_disparu:          boolean;   // CS/board initial parti sans remplacement

  // Sourcing
  lu_data_gap:              boolean;   // LU ≥ 3 ET ADC ≤ 2 (REV11)
  source_I_majeure:         boolean;   // assertion inférée sur dimension critique → dim −0.5

  // Liste des flags activés (pour affichage page de garde)
  active_flags: string[];
}

// ── Taux de confiance global (§4.2 du protocole) ─────────────────────────────
export interface ConfidenceRate {
  count_V:   number;    // assertions Vérifiées
  count_I:   number;    // assertions Inférées
  count_NT:  number;    // assertions Non Trouvées
  count_C:   number;    // assertions Classifiées
  rate:      number;    // (V+C)/(V+I+NT+C) × 100
  label:     'high' | 'moderate' | 'low' | 'critical';
  //   ≥ 85% → high      : rapport publiable
  //   70-85% → moderate : publiable avec mentions I
  //   50-70% → low      : draft — investiguer les I
  //   < 50%  → critical : non publiable
  publishable: boolean;
}

// ── Grille de sourcing obligatoire par dimension (§3 du protocole) ────────────
// Plafonds si source ★ manquante
export const SOURCING_CAPS: Record<string, number> = {
  DI:  3,   // plafond si INPI/site officiel manquants
  ADC: 2,   // plafond si Verif.com/bilan non daté
  IPC: 3,   // plafond si Pappers marchés manquant
  AR:  2,   // plafond si INPI marques/BODACC cert. manquants
  CA:  2,   // plafond si < 2 pivots documentés tiers
  GCH: 2,   // plafond si dirigeant anonyme
  LU:  2,   // plafond si co-construction non documentée
};

// Sources obligatoires (★) par dimension
export const SOURCING_REQUIRED: Record<string, string[]> = {
  DI:  ['INPI (brevets/marques)', 'Site officiel produit'],
  ADC: ['Verif.com ou Manageo (CA + bilan)', 'Date du dernier bilan'],
  IPC: ['Pappers (marchés publics)', 'TED Europa'],
  AR:  ['INPI (marques déposées)', 'BODACC (certifications)', 'Site label officiel'],
  CA:  ['2 pivots documentés dans sources tierces'],
  GCH: ['Pappers (dirigeant + SIREN)', 'LinkedIn fondateur'],
  LU:  ['Communiqué co-signé partenaire', 'LinkedIn partenaire confirmant'],
};

// ── Calcul du taux de confiance global ────────────────────────────────────────
export function computeConfidenceRate(sources: SourceEntry[]): ConfidenceRate {
  const count_V  = sources.filter(s => s.trust_code === 'V').length;
  const count_I  = sources.filter(s => s.trust_code === 'I').length;
  const count_NT = sources.filter(s => s.trust_code === 'NT').length;
  const count_C  = sources.filter(s => s.trust_code === 'C').length;
  const total = count_V + count_I + count_NT + count_C;
  const rate  = total > 0 ? Math.round((count_V + count_C) / total * 100) : 0;
  const label: ConfidenceRate['label'] =
    rate >= 85 ? 'high'     :
    rate >= 70 ? 'moderate' :
    rate >= 50 ? 'low'      : 'critical';
  return { count_V, count_I, count_NT, count_C, rate, label, publishable: rate >= 70 };
}

// ── Calcul des malus flags v4.5 sur le score IRO ─────────────────────────────
// À appeler APRÈS les REV1/REV12/REV13 dans calcIRO()
export function applyFlagPenalties(
  s:           number,
  flags:       Partial<IROFlagsV45>,
  scores:      Record<string, number>,
): { score: number; penalties: string[] } {
  const penalties: string[] = [];
  let adjusted = s;

  // Statut juridique — CRITIQUE
  if (flags.liquidation_judiciaire) {
    adjusted = Math.round((adjusted - 10.0) * 10) / 10;
    penalties.push('liquidation_judiciaire → −10 pts');
  }
  if (flags.redressement_judiciaire) {
    adjusted = Math.round((adjusted - 5.0) * 10) / 10;
    penalties.push('redressement_judiciaire → −5 pts');
  }

  // Données stales — ADC
  if (flags.data_stale) {
    adjusted = Math.round((adjusted - 0.5 / 5 * 100 * 0.22) * 10) / 10; // équiv −0.5/5 × poids ADC 22%
    penalties.push('data_stale → −2.2 pts equiv. (ADC −0.5/5 × 22%)');
  }

  // Contrat retiré — IPC critique
  if (flags.contrat_retire) {
    adjusted = Math.round((adjusted - 1 / 5 * 100 * 0.22) * 10) / 10;   // −1/5 × poids IPC 22%
    penalties.push('contrat_retire → −4.4 pts equiv. (IPC −1/5 × 22%)');
  }

  // Source inférée majeure
  if (flags.source_I_majeure) {
    adjusted = Math.round((adjusted - 0.5 / 5 * 100 * 0.18) * 10) / 10; // dimension la plus pénalisante
    penalties.push('source_I_majeure → −1.8 pts equiv.');
  }

  return { score: Math.max(0, adjusted), penalties };
}

// ── Plafonnement des scores dimensionnels selon les flags ─────────────────────
export function applyDimensionCaps(
  scores:  Record<string, number>,
  flags:   Partial<IROFlagsV45>,
): Record<string, number> {
  const capped = { ...scores };
  if (flags.brevet_non_verifie  && capped.DI  > 3) capped.DI  = 3;
  if (flags.dirigeant_anonyme   && capped.GCH > 2) capped.GCH = 2;
  if (flags.operateur_certifie  && capped.IPC > 2) capped.IPC = 2;
  if (flags.lu_data_gap         && capped.LU  > 3) capped.LU  = 3;
  return capped;
}

// ── Séquence d'investigation imposée (§6 du protocole) ───────────────────────
// 9 étapes obligatoires avant tout scoring. L'étape 2 (BODACC) est BLOQUANTE.
export const INVESTIGATION_SEQUENCE = [
  { step: 1, name: 'SIREN + identité',       sources: ['Pappers.fr', 'SIRENE data.gouv.fr', 'Verif.com'],                 output: 'SIREN confirmé + dirigeant + date création' },
  { step: 2, name: 'Statut juridique',        sources: ['BODACC (36 mois)', 'Pappers historique', 'Infogreffe'],           output: 'BLOQUANT — flag liquidation/redressement activé ou non' },
  { step: 3, name: 'Données financières',     sources: ['Verif.com', 'Manageo', 'Societe.com', 'BODACC comptes'],         output: 'CA + résultat + date bilan + indice fraîcheur' },
  { step: 4, name: 'Profil dirigeant',        sources: ['Pappers', 'LinkedIn', 'RocketReach'],                             output: 'Nom + formation + parcours + flags' },
  { step: 5, name: 'PI et brevets',           sources: ['INPI data.inpi.fr', 'EPO Espacenet', 'INPI marques'],             output: 'Brevets documentés ou flag brevet_non_verifie=true' },
  { step: 6, name: 'Marchés publics',         sources: ['Pappers marchés', 'TED Europa', 'BOAMP', 'Data.gouv'],            output: 'Marchés V confirmés / NT documentés' },
  { step: 7, name: 'Partenaires et clients',  sources: ['LinkedIn partenaires', 'Communiqués co-signés', 'Presse'],         output: 'Partenariats V / I / NT classifiés' },
  { step: 8, name: 'Sources primaires',       sources: ['Site officiel', 'CP', 'LinkedIn startup'],                        output: 'Récit officiel — à croiser avec étapes 1-7' },
  { step: 9, name: 'Scoring IRO',             sources: ['Grille A + niveaux B + fraîcheur C'],                              output: 'Score + taux de confiance global + flags activés' },
] as const;
