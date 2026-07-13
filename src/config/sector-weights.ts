// src/config/sector-weights.ts
// ── IRO v4.8 — Poids sectoriels calibrés ──────────────────────────────────────
// Source : optimisation par grille sur cohorte n=87, juin 2026.
// Seule la Santé dispose d'un gain AUC robuste (+0.054) justifiant des poids
// différenciés. Les autres secteurs atteignent déjà AUC=1.0 ou n<6.
//
// Règle d'application : calcIRO() utilise ces poids si sectorCode est fourni
// ET que le secteur dispose d'un vecteur calibré. Sinon : poids base v4.6.
//
// AVERTISSEMENT : poids optimisés in-sample. Gain out-of-sample estimé ~50%
// du gain observé. Re-calibration requise à n≥30 par secteur.

export type SectorCode =
  | 'HLTH'   // Santé / Medtech / BioIA
  | 'LLM'    // Modèles de langage / IA générative
  | 'COMM'   // Commerce / E-commerce / Marketplace
  | 'FINT'   // Finance / Assurance / Fintech
  | 'CYBR'   // Cybersécurité
  | 'INDU'   // Industrie / IoT / Hardware
  | 'RH'     // RH / Recrutement / People Analytics
  | 'LEGT'   // LegalTech / GovTech
  | 'EDTC'   // EdTech / Formation
  | 'LOGI'   // Logistique / Supply Chain
  | 'DEFAULT';

export interface SectorWeightProfile {
  code:        SectorCode;
  label:       string;
  weights:     Record<string, number>;   // somme = 1.0
  auc_base:    number;                   // AUC avec poids base v4.6
  auc_opt:     number;                   // AUC avec ces poids
  n:           number;                   // taille de la cohorte de calibration
  status:      'calibrated' | 'indicative' | 'base';
  // 'calibrated'  : n≥12, gain AUC robuste, poids différenciés appliqués
  // 'indicative'  : n 6-11, gain mesuré mais fragile — poids appliqués avec note
  // 'base'        : n<6 ou AUC déjà =1.0 — poids base v4.6 utilisés
  notes:       string;
}

// ── Poids base v4.6 (référence) ──────────────────────────────────────────────
export const BASE_WEIGHTS: Record<string, number> = {
  DI: 0.18, ADC: 0.22, IPC: 0.22,
  AR: 0.13, CA:  0.10, GCH: 0.12, LU: 0.15,
};

// ── Profils sectoriels ────────────────────────────────────────────────────────
export const SECTOR_PROFILES: Record<SectorCode, SectorWeightProfile> = {

  HLTH: {
    code: 'HLTH', label: 'Santé / Medtech / BioIA',
    weights: {
      DI: 0.128, ADC: 0.170, IPC: 0.298,
      AR: 0.074, CA:  0.043, GCH: 0.064, LU: 0.223,
    },
    auc_base: 0.7462, auc_opt: 0.8000, n: 18,
    status: 'calibrated',
    notes: [
      'IPC (+7.6 pts) : intégration dans les processus cliniques quotidiens (DME, PACS, LIS).',
      'LU (+7.3 pts) : hôpitaux et centres de recherche co-développeurs — le vrai moat santé.',
      'AR (−5.6 pts) : réglementation médicale est un plancher commun, pas un différenciateur.',
      'DI (−5.2 pts) : IP clinique moins discriminante que l\'ancrage opérationnel.',
      'Limite : AUC plafonnée à 0.80 — Nanobiotix et Bioserenity ont des profils',
      'structurellement identiques à des actives. Défaillances extra-IRO (burn rate clinique).',
    ].join(' '),
  },

  LLM: {
    code: 'LLM', label: 'LLM / IA générative',
    weights: { ...BASE_WEIGHTS },
    auc_base: 0.9219, auc_opt: 0.9219, n: 16,
    status: 'base',
    notes: 'DI=0 prédit l\'échec dans 100% des cas LLM — signal déjà parfait. Aucun ajustement de poids n\'améliore l\'AUC.',
  },

  COMM: {
    code: 'COMM', label: 'Commerce / E-commerce / Marketplace',
    weights: { ...BASE_WEIGHTS },
    auc_base: 1.0000, auc_opt: 1.0000, n: 16,
    status: 'base',
    notes: 'AUC=1.0 avec poids base. Poids sectoriels sans bénéfice mesurable.',
  },

  FINT: {
    code: 'FINT', label: 'Finance / Assurance / Fintech',
    weights: { ...BASE_WEIGHTS },
    auc_base: 1.0000, auc_opt: 1.0000, n: 9,
    status: 'base',
    notes: 'AUC=1.0 avec poids base. n=9 insuffisant pour calibration différenciée.',
  },

  CYBR: {
    code: 'CYBR', label: 'Cybersécurité',
    weights: { ...BASE_WEIGHTS },
    auc_base: 0.5000, auc_opt: 0.5000, n: 4,
    status: 'base',
    notes: '0 échec dans la cohorte — AUC non calculable. Poids base appliqués.',
  },

  INDU: {
    code: 'INDU', label: 'Industrie / IoT / Hardware',
    weights: { ...BASE_WEIGHTS },
    auc_base: 1.0000, auc_opt: 1.0000, n: 6,
    status: 'base',
    notes: 'AUC=1.0 avec poids base. 1 seul échec (Sigfox) — calibration impossible.',
  },

  RH: {
    code: 'RH', label: 'RH / Recrutement / People Analytics',
    weights: { ...BASE_WEIGHTS },
    auc_base: 1.0000, auc_opt: 1.0000, n: 4,
    status: 'base',
    notes: 'n=4 — non significatif. Poids base appliqués.',
  },

  LEGT: {
    code: 'LEGT', label: 'LegalTech / GovTech',
    weights: { ...BASE_WEIGHTS },
    auc_base: 1.0000, auc_opt: 1.0000, n: 3,
    status: 'base',
    notes: 'n=3 — non significatif. Poids base appliqués.',
  },

  EDTC: {
    code: 'EDTC', label: 'EdTech / Formation',
    weights: { ...BASE_WEIGHTS },
    auc_base: 1.0000, auc_opt: 1.0000, n: 3,
    status: 'base',
    notes: 'n=3 — non significatif. Poids base appliqués.',
  },

  LOGI: {
    code: 'LOGI', label: 'Logistique / Supply Chain',
    weights: { ...BASE_WEIGHTS },
    auc_base: 1.0000, auc_opt: 1.0000, n: 3,
    status: 'base',
    notes: 'n=3 — non significatif. Poids base appliqués.',
  },

  DEFAULT: {
    code: 'DEFAULT', label: 'Secteur non renseigné',
    weights: { ...BASE_WEIGHTS },
    auc_base: 0.9210, auc_opt: 0.9210, n: 87,
    status: 'base',
    notes: 'Poids base v4.6 — secteur non identifié.',
  },
};

// ── API publique ──────────────────────────────────────────────────────────────

/** Résout le SectorCode depuis un libellé libre (déclaré dans le deck). */
export function resolveSectorCode(label: string): SectorCode {
  const l = label ? label.toLowerCase() : '';
  if (/sant|med|bio|health|clinic|pharma|hospit/.test(l)) return 'HLTH';
  if (/llm|génér|generat|gpt|mistral|language model|langage|langues/.test(l))  return 'LLM';
  if (/comm|e-comm|marketpl|retail|ecomm/.test(l))             return 'COMM';
  if (/finan|insuran|assur|banqu|fintech|credit/.test(l))      return 'FINT';
  if (/cyber|sécu|secur|soc|siem|threat/.test(l))              return 'CYBR';
  if (/indus|iot|hardware|robot|manufactur|usine/.test(l))     return 'INDU';
  if (/\brh\b|recruit|talent|people|paie|hrtech/.test(l))      return 'RH';
  if (/legal|legaltech|jur|gov|public/.test(l))                return 'LEGT';
  if (/edtech|formation|learn|éducation|education/.test(l))    return 'EDTC';
  if (/logis|supply|transport|fleet|freight/.test(l))          return 'LOGI';
  return 'DEFAULT';
}

/** Retourne le vecteur de poids à utiliser pour un secteur donné. */
export function getSectorWeights(code: SectorCode): Record<string, number> {
  return SECTOR_PROFILES[code]?.weights ?? BASE_WEIGHTS;
}

/** Retourne le profil complet (pour les rapports et logs). */
export function getSectorProfile(code: SectorCode): SectorWeightProfile {
  return SECTOR_PROFILES[code] ?? SECTOR_PROFILES['DEFAULT'];
}

/** Vérifie que les poids d'un profil somment bien à 1.0 ou 1.12 (± 0.005). */
export function validateWeights(w: Record<string, number>): boolean {
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1.0) < 0.005 || Math.abs(sum - 1.12) < 0.005;
}
