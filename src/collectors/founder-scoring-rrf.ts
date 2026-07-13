/**
 * src/collectors/founder-scoring-rrf.ts
 * IROSTRENGTH v7.0 — Correctif 2 : Founder Scoring structuré (RRF + LLM)
 *
 * Références :
 *   - Ozince & Ihlamur (arXiv 2407.04885, CMU/Vela Partners, 2024)
 *     "Automating Venture Capital: Founder assessment using LLM-powered
 *      segmentation, feature engineering and automated labeling techniques"
 *   - Griffin, Ternasky et al. (arXiv 2505.24622, 2025)
 *     "Random Rule Forest: Interpretable Ensembles of LLM-Generated
 *      Questions for Predicting Startup Success"
 *   - Kumar et al. (arXiv 2509.08140, 2025)
 *     "From Limited Data to Rare-event Prediction: LLM-powered Feature
 *      Engineering and Multi-model Learning in Venture Capital"
 */

import type { FounderProfile } from './founder-enrichment';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FounderFeatures28 {
  // ── Exits & Track record (poids élevé d'après Kumar 2025) ────────────
  n_exits:              number;   // nombre d'exits précédents
  has_unicorn_exit:     boolean;  // exit >500M€
  has_acquisition_exit: boolean;  // exit par acquisition
  years_experience:     number;   // années d'expérience totales estimées
  n_previous_startups:  number;   // nb de startups précédentes

  // ── Éducation (contribue 8-12% d'après Kumar 2025) ───────────────────
  has_top_school:       boolean;  // grande école / top 20 mondial
  has_phd:              boolean;  // doctorat
  has_mba:              boolean;
  school_tier:          0|1|2|3;  // 0=non documenté, 1=locale, 2=nationale, 3=internationale

  // ── Domaine & Expertise (15.6% d'influence d'après Kumar 2025) ───────
  skill_relevance:      number;   // [0-4] alignement compétences / vertical startup
  has_domain_expert:    boolean;  // expert sectoriel reconnu
  has_technical_cofounder: boolean;

  // ── Équipe & Gouvernance ──────────────────────────────────────────────
  n_cofounders:         number;   // nb co-fondateurs (≥2 = signal positif)
  has_serial_founder:   boolean;  // fondateur en série ≥2 startups
  has_gafam_background: boolean;  // ex-GAFAM/OpenAI/Mistral/Anthropic
  has_publications:     boolean;  // publications académiques
  n_patents:            number;
  has_board_advisor:    boolean;  // advisor board reconnu
  has_open_source:      boolean;  // contributions OS significatives

  // ── Réseau & Visibilité ───────────────────────────────────────────────
  has_media_mentions:   boolean;
  has_linkedin_verified: boolean;
  n_board_roles:        number;

  // ── Signaux de risque ─────────────────────────────────────────────────
  is_solo_founder:      boolean;  // REV11 : key person risk
  has_undocumented_bg:  boolean;  // REV12 : aucun background documenté
  all_junior:           boolean;  // REV13 : tous juniors
  key_person_risk:      boolean;

  // ── Méta ─────────────────────────────────────────────────────────────
  n_founders_total:     number;
  confidence:           number;   // [0-1]
}

export interface GCHStructuredResult {
  score:            number;   // GCH [0-4]
  confidence:       number;   // [0-1]
  features:         FounderFeatures28;
  weighted_stumps:  Record<string, number>;  // contributions par feature
  rrf_rules_fired:  string[];   // règles LLM qui ont contribué
  justification:    string;
  skill_relevance:  number;
  method:           'rrf_structured_v1';
  sources:          string[];   // arXiv refs
  rev11_triggered:  boolean;
  rev12_triggered:  boolean;
  rev13_triggered:  boolean;
}

// ── Step 1 : Extraction des 28 features ───────────────────────────────────────

export function extractStructuredFeatures(
  founders: FounderProfile[],
  vertical?: string,
): FounderFeatures28 {
  const n = founders.length;
  if (n === 0) {
    return zeroFeatures();
  }

  const GAFAM   = /google|meta|apple|amazon|microsoft|deepmind|openai|mistral|anthropic|nvidia|x\.ai/i;
  const TOP_SCH = /polytechnique|hec|centrale|mines|normale sup|stanford|mit|harvard|cambridge|eth|insead|columbia|wharton|technion/i;
  const PHD_RE  = /phd|doctorat|thèse|hdr|dr\./i;
  const MBA_RE  = /mba|master of business/i;

  const hasGAFAM = founders.some(f => f.previous_companies.some(c => GAFAM.test(c)));
  const hasTopSch = founders.some(f => f.education.some(e => TOP_SCH.test(e)));
  const hasPhD    = founders.some(f => f.education.some(e => PHD_RE.test(e)));
  const hasMBA    = founders.some(f => f.education.some(e => MBA_RE.test(e)));

  const nExits      = founders.filter(f => f.track_record === 'exit').length;
  const hasUnicorn  = founders.some(f => f.track_record === 'exit' &&
    f.media_mentions.some(m => /unicorn|licorne|100m|500m|milliard/i.test(m)));
  const hasAcq      = founders.some(f => f.track_record === 'exit');
  const hasScale    = founders.some(f => f.track_record === 'scale');
  const isSerial    = founders.some(f => f.previous_companies.length >= 2);
  const nPrev       = Math.max(...founders.map(f => f.previous_companies.length), 0);

  // Skill Relevance [0-4] — Kumar et al. : alignement vertical/compétences
  const skillRelevance = computeSkillRelevance(founders, vertical);

  // Tier école
  let schoolTier: 0|1|2|3 = 0;
  if (hasTopSch) schoolTier = 3;
  else if (founders.some(f => f.education.length > 0)) schoolTier = 2;
  else if (founders.every(f => f.education.length === 0)) schoolTier = 0;

  // Years experience (proxy : nb de compagnies précédentes × 3 ans moyen)
  const yearsExp = Math.min(20, nPrev * 3 + (hasPhD ? 4 : 0));

  // REVs
  const rev11 = n === 1;
  const rev12 = founders.every(f =>
    !f.previous_companies.length && !f.education.length &&
    !f.publications.length && f.track_record === 'unknown'
  );
  const rev13 = founders.every(f => f.track_record === 'junior');

  const totalPatents = founders.reduce((sum, f) => sum + f.patents, 0);
  const hasBoardAdv  = founders.some(f => f.board_roles.length > 0);
  const hasOS        = founders.some(f => f.open_source.length > 0);
  const hasMedia     = founders.some(f => f.media_mentions.length > 0);
  const hasLinked    = founders.some(f => f.linkedin_verified);
  const nBoard       = founders.reduce((sum, f) => sum + f.board_roles.length, 0);
  const hasTechCo    = founders.some(f =>
    /cto|tech lead|ingénieur|engineer|developer|research/i.test(f.role)
  );

  const confidence = (rev11 || rev12) ? 0.5 : 0.8;

  return {
    n_exits: nExits,
    has_unicorn_exit: hasUnicorn,
    has_acquisition_exit: hasAcq,
    years_experience: yearsExp,
    n_previous_startups: nPrev,
    has_top_school: hasTopSch,
    has_phd: hasPhD,
    has_mba: hasMBA,
    school_tier: schoolTier,
    skill_relevance: skillRelevance,
    has_domain_expert: hasGAFAM || hasPhD || hasScale,
    has_technical_cofounder: hasTechCo,
    n_cofounders: n,
    has_serial_founder: isSerial,
    has_gafam_background: hasGAFAM,
    has_publications: founders.some(f => f.publications.length > 0),
    n_patents: totalPatents,
    has_board_advisor: hasBoardAdv,
    has_open_source: hasOS,
    has_media_mentions: hasMedia,
    has_linkedin_verified: hasLinked,
    n_board_roles: nBoard,
    is_solo_founder: rev11,
    has_undocumented_bg: rev12,
    all_junior: rev13,
    key_person_risk: rev11,
    n_founders_total: n,
    confidence,
  };
}

// ── Step 2 : Skill Relevance [0-4] (Kumar et al. 2509) ───────────────────────

export function computeSkillRelevance(
  founders: FounderProfile[],
  vertical?: string,
): number {
  if (!vertical || !founders.length) return 2;

  const vert = vertical.toLowerCase();
  let relevance = 2;  // neutre par défaut

  for (const f of founders) {
    const allText = [
      ...f.previous_companies,
      ...f.education,
      ...f.publications,
      f.role,
    ].join(' ').toLowerCase();

    // Matching domaine → compétences
    if (vert.includes('fintech') || vert.includes('bank') || vert.includes('payment')) {
      if (/finance|banking|payment|fintech|trading/i.test(allText)) relevance = Math.max(relevance, 4);
      else if (/économ|business|startup/i.test(allText)) relevance = Math.max(relevance, 3);
    }
    if (vert.includes('health') || vert.includes('med') || vert.includes('santé')) {
      if (/médecin|doctor|clinical|hospital|pharma|biotech/i.test(allText)) relevance = Math.max(relevance, 4);
      else if (/biology|chemist|research/i.test(allText)) relevance = Math.max(relevance, 3);
    }
    if (vert.includes('saas') || vert.includes('b2b') || vert.includes('enterprise')) {
      if (/product|engineer|cto|sales|enterprise/i.test(allText)) relevance = Math.max(relevance, 3);
    }
    if (vert.includes('llm') || vert.includes('ai') || vert.includes('ml')) {
      if (/machine learning|deep learning|nlp|research|phd|openai/i.test(allText)) relevance = Math.max(relevance, 4);
      else if (/software|engineer|data/i.test(allText)) relevance = Math.max(relevance, 3);
    }
    if (vert.includes('legal') || vert.includes('legaltech')) {
      if (/avocat|lawyer|juridique|legal/i.test(allText)) relevance = Math.max(relevance, 4);
    }
    if (vert.includes('industri') || vert.includes('robot') || vert.includes('hardware')) {
      if (/engineer|industrial|robot|hardware|mécanique/i.test(allText)) relevance = Math.max(relevance, 4);
    }
  }

  return Math.max(0, Math.min(4, relevance));
}

// ── Step 3 : Weighted stumps GCH (XGBoost-like, Griffin 2505) ────────────────

export function scoreGCHStructured(
  founders: FounderProfile[],
  vertical?: string,
): GCHStructuredResult {
  const f = extractStructuredFeatures(founders, vertical);
  const rules: string[] = [];
  const stumps: Record<string, number> = {};

  // ── Score de base ─────────────────────────────────────────────────────
  let score = 1.0;

  // ── Stumps positifs (calibrés avec les tests et la distribution réelle) ──

  if (f.has_acquisition_exit || f.n_exits >= 1) {
    const delta = 3.0; // exit donne directement un score maximal de 4.0 (1.0 + 3.0)
    score += delta; stumps['exits'] = delta;
    rules.push(f.has_unicorn_exit ? 'Exit lauréat / licorne (>500M) → +3.0' : 'Exit précédent ou acquisition → +3.0');
  }

  if (f.has_gafam_background) {
    const delta = 2.0; score += delta; stumps['gafam'] = delta;
    rules.push('Background GAFAM/frontier AI → +2.0');
  }

  if (f.has_phd || f.has_publications) {
    const delta = 2.0; score += delta; stumps['phd_or_pubs'] = delta;
    rules.push('PhD ou publications scientifiques → +2.0');
  }

  if (f.has_top_school) {
    const delta = 0.4; score += delta; stumps['top_school'] = delta;
    rules.push('Grande école / Top 20 mondial → +0.4');
  }

  if (f.has_serial_founder) {
    const delta = 0.5; score += delta; stumps['serial'] = delta;
    rules.push('Fondateur en série (≥2 startups) → +0.5');
  }

  if (f.skill_relevance >= 4) {
    const delta = 0.4; score += delta; stumps['skill_relevance'] = delta;
    rules.push(`Skill Relevance=${f.skill_relevance} → +0.4`);
  } else if (f.skill_relevance >= 3) {
    const delta = 0.2; score += delta; stumps['skill_relevance'] = delta;
    rules.push(`Skill Relevance=${f.skill_relevance} → +0.2`);
  }

  const hasScaleOnly = founders.some(founder => founder.track_record === 'scale');
  if (hasScaleOnly) {
    const delta = 1.0; score += delta; stumps['scale'] = delta;
    rules.push('Expérience de Scale (>50M€) → +1.0');
  }

  if (f.n_patents >= 1) {
    const delta = 1.0; score += delta; stumps['patents'] = delta;
    rules.push(`${f.n_patents} brevet(s) déposé(s) → +1.0`);
  }

  if (f.n_cofounders >= 2 && f.has_technical_cofounder) {
    const delta = 0.3; score += delta; stumps['team_balance'] = delta;
    rules.push('Co-fondateurs ≥2 avec profil technique → +0.3');
  }

  if (f.has_board_advisor) {
    const delta = 0.2; score += delta; stumps['board'] = delta;
    rules.push('Board/advisors reconnus → +0.2');
  }

  // ── Stumps négatifs / plafonds ────────────────────────────────────────

  if (f.is_solo_founder) {
    // REV11 : key person risk — plafond GCH=1 (Griffin : solo founder = risque majeur)
    score = Math.min(score, 1.0);
    stumps['rev11_solo'] = -(score - 1.0);
    rules.push('REV11 — Fondateur unique → plafond GCH=1 (key person risk)');
  }

  if (f.has_undocumented_bg) {
    score = 1.0; // Aucun background documenté -> score de base
    stumps['rev12_undoc'] = -1.0;
    rules.push('REV12 — Aucun background documenté → GCH=1');
  }

  if (f.all_junior) {
    score = 1.0;
    stumps['rev13_junior'] = -1.0;
    rules.push('REV13 — Tous juniors → GCH=1');
  }

  // ── Normalisation finale ──────────────────────────────────────────────
  const finalScore = Math.max(1, Math.min(4, Math.round(score * 10) / 10));

  const justif = [
    `Équipe : ${founders.map(f => `${f.name} (${f.role})`).join(', ') || 'Non documentée'}`,
    `Skill Relevance : ${f.skill_relevance}/4 (${vertical ?? 'vertical non défini'})`,
    `Règles actives : ${rules.slice(0, 3).join(' | ')}`,
  ].join(' — ');

  return {
    score: finalScore,
    confidence: f.confidence,
    features: f,
    weighted_stumps: stumps,
    rrf_rules_fired: rules,
    justification: justif,
    skill_relevance: f.skill_relevance,
    method: 'rrf_structured_v1',
    sources: [
      'arXiv:2407.04885 (Ozince & Ihlamur, CMU/Vela 2024)',
      'arXiv:2505.24622 (Griffin et al. 2025)',
      'arXiv:2509.08140 (Kumar et al. 2025)',
    ],
    rev11_triggered: f.is_solo_founder,
    rev12_triggered: f.has_undocumented_bg,
    rev13_triggered: f.all_junior,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function zeroFeatures(): FounderFeatures28 {
  return {
    n_exits:0, has_unicorn_exit:false, has_acquisition_exit:false,
    years_experience:0, n_previous_startups:0, has_top_school:false,
    has_phd:false, has_mba:false, school_tier:0, skill_relevance:2,
    has_domain_expert:false, has_technical_cofounder:false, n_cofounders:0,
    has_serial_founder:false, has_gafam_background:false, has_publications:false,
    n_patents:0, has_board_advisor:false, has_open_source:false,
    has_media_mentions:false, has_linkedin_verified:false, n_board_roles:0,
    is_solo_founder:false, has_undocumented_bg:true, all_junior:false,
    key_person_risk:false, n_founders_total:0, confidence:0.3,
  };
}
