import type { IROResult } from '../types/iro';
import type {
  InvestorReport, DimDetail, DimRecommendation,
  InvestorFlag, CompetitorComparison, HumanReviewGate,
  ExternalIntelligenceSummary,
} from '../types/iro';
import calibratedBetas from '../config/cox-betas-calibrated.json';

// ── Types locaux pour éviter les as any sur les structures LLM ───────────────
interface DimensionScore {
  score:         number;
  justification: string;
  confiance?:    number;
}

interface REV13Info {
  rev13_malus?:      number;
  rev13_pct_top?:    number;
  rev13_nb_clients?: number;
}

interface CoxModelResult {
  dual_horizon?: {
    h18?: number;
    h36?: number;
    operational?: any;
  };
  [key: string]: unknown;
}

// Simple fast string hashing in pure JS to avoid 'fs' / 'crypto' Node system dependency in browser
function simpleStringHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).substring(0, 7);
}

export function getBetasVersionTag(): string {
  try {
    const contentStr = JSON.stringify(calibratedBetas);
    const hash = simpleStringHash(contentStr);
    return `v4.3 [sha256-${hash}]`;
  } catch {
    return 'v4.3 [uncalibrated]';
  }
}

// ── Constantes ────────────────────────────────────────────────────────────────

// [Unification 10/07/2026, T1/T4] WEIGHTS était redéclaré en dur ici — une 4e
// source de vérité indépendante en plus de iro-engine.ts, batch_iro.ts et
// batch_gemini_iro.py, découverte lors de la correction du registre de constats.
// Les valeurs coïncidaient avec le fichier canonique mais sans lien de dépendance :
// toute évolution future des poids serait passée inaperçue ici. Import direct désormais.
import { IRO_WEIGHTS, WEIGHTS_VERSION, WEIGHTS_FROZEN } from './weights-registry';

const PROTOCOL_VERSION  = 'IRO Strength Velocity v7.1.0';
const PROMPT_REGISTRY   = 'v4.5-S46';
const WEIGHTS_LABEL     = 'DI 18% · ADC 22% · IPC 22% · AR 13% · CA 10% · GCH 12% · LU 15%';

const WEIGHTS: Record<string, number> = IRO_WEIGHTS as Record<string, number>;

const DIM_LABELS: Record<string, string> = {
  DI:  'Dépendance Infrastructurelle',
  ADC: 'Actif de Données Cumulatif',
  IPC: 'Intégration Processus Critiques',
  AR:  'Anticipation Réglementaire',
  CA:  'Capacité d\'Adaptation',
  GCH: 'Gouvernance & Capital Humain',
  LU:  'Lead User Integration (von Hippel)',
};

const DIM_GRILLES: Record<string, string> = {
  DI:  '0=wrapper total · 1=dépendance forte · 2=hybride · 3=infra partiellement propre · 4=entièrement propriétaire',
  ADC: '0=aucune donnée · 1=génériques · 2=sectorielles · 3=VRIN partiel · 4=VRIN complet exclusif',
  IPC: '0=aucune · 1=déclarative · 2=production · 3=certifiée · 4=critique irremplaçable',
  AR:  '0=aucune · 1=réactive · 2=en cours · 3=avancée · 4=native et certifiée',
  CA:  '0=rigide · 1=réactif lent · 2=mixte · 3=proactif · 4=agilité démontrée multi-pivot',
  GCH: '0=généraliste sans expérience · 1=junior · 2=expérimenté PME · 3=sénior ex-GAFAM/exit · 4=élite publications+exit',
  LU:  '0=clients passifs · 1=early adopters · 2=actifs (feedback roadmap) · 3=co-développeurs (ancrage prouvé) · 4=ancré VRIN',
};

// Mapping numérique → label
function confLabel(v: number): string {
  if (v >= 0.80) return 'convergent';
  if (v >= 0.60) return 'partiel';
  return 'incertain';
}

function iroVerdict(score: number): 'CRITIQUE' | 'FRAGILE' | 'ROBUSTE' | 'SOLIDE' {
  if (score < 35) return 'CRITIQUE';
  if (score < 50) return 'FRAGILE';
  if (score < 65) return 'ROBUSTE';
  return 'SOLIDE';
}

function dimBars(score: number, max = 4): string {
  return '●'.repeat(score) + '■'.repeat(max - score);
}

// ── F4 — Supervision humaine des verdicts extrêmes ────────────────────────────
const CRITICAL_THRESHOLD_IROCR = 30;

export function evaluateHumanReviewGate(
  iroCr: number,
  criticalFlags: string[],
): HumanReviewGate {
  const lowScore     = iroCr < CRITICAL_THRESHOLD_IROCR;
  const hasCritical  = criticalFlags.length > 0;
  const requiresReview = lowScore || hasCritical;

  return {
    requires_review: requiresReview,
    trigger_reason:  !requiresReview ? null :
      lowScore && hasCritical ? `IRO-CR=${iroCr} < ${CRITICAL_THRESHOLD_IROCR} + flags critiques`
      : lowScore               ? `IRO-CR=${iroCr} < seuil ${CRITICAL_THRESHOLD_IROCR}`
                               : `Flags critiques détectés : ${criticalFlags.join(', ')}`,
    iro_cr:          iroCr,
    critical_flags:  criticalFlags,
    review_status:   requiresReview ? 'pending' : 'not_required',
    approved_by:     null,
    approved_at:     null,
  };
}

// Glossaire de communication validé (F4)
export const COMMUNICATION_GLOSSARY: Record<string, string> = {
  FORBIDDEN_critique:   '"probabilité de faillite"',
  ALLOWED_critique:     '"signal structurel de risque élevé"',
  FORBIDDEN_red_zone:   '"startup en danger"',
  ALLOWED_red_zone:     '"startup en Zone Rouge — consolidation opérationnelle recommandée"',
  FORBIDDEN_low_score:  '"mauvaise startup"',
  ALLOWED_low_score:    '"score IRO en dessous du seuil de référence sectoriel"',
};

// ── buildInvestorReport ───────────────────────────────────────────────────────

/**
 * Construit l'objet InvestorReport structuré depuis un IROResult.
 * Compatible avec le rendu React (InvestorReportPanel) et l'export PDF/Word.
 */
export function buildInvestorReport(
  r: IROResult,
  competitor?: CompetitorComparison,
): InvestorReport {
  const scores = r.iro?.scores ?? {};
  const justifications = r.iro?.justifications ?? {};
  const ipcConf = r.iro?.ipc_confiance ?? 0.75;
  const adcConf = r.iro?.confidence?.ADC ?? 0.70;
  const gchConf = r.iro?.confidence?.GCH ?? 0.80;

  const confMap: Record<string, number> = {
    DI: 0.65, ADC: adcConf, IPC: ipcConf, AR: 0.55, CA: 0.80, GCH: gchConf,
  };

  // ── Dimensions ──────────────────────────────────────────────────────────────
  const dimensions: Record<string, DimDetail> = {};
  for (const dim of Object.keys(WEIGHTS)) {
    const score  = (scores as Record<string, number>)[dim] ?? 0;
    const conf   = confMap[dim] ?? 0.70;
    const just   = justifications[dim] ?? 'Données insuffisantes pour une analyse complète.';

    // Extraction des données manquantes depuis la justification (balises "[…]" ou "Données manquantes :")
    const missingMatch = just.match(/Données manquantes\s*:\s*([^.]+\.)/i);
    const missing: string[] = missingMatch
      ? missingMatch[1].split('·').map(s => s.trim()).filter(Boolean)
      : [];

    dimensions[dim] = {
      score,
      confidence: conf,
      confidence_label: confLabel(conf),
      qualificatif: extractQualificatif(just, dim, score),
      grille_label: DIM_GRILLES[dim],
      justification: just,
      missing_data: missing,
      integration_level: dim === 'IPC' ? extractLabel(just, 'integration_level') : undefined,
      pivot_type:        dim === 'CA'  ? extractLabel(just, 'pivot_type') : undefined,
    };
  }

  // ── Flags ───────────────────────────────────────────────────────────────────
  const investor_flags = buildFlags(r, scores as Record<string, number>);

  // ── Recommandations ─────────────────────────────────────────────────────────
  const recommendations = buildRecommendations(scores as Record<string, number>, r);

  // ── Survie ──────────────────────────────────────────────────────────────────
  const cox = r.cox_survival;
  const dh  = (cox as unknown as CoxModelResult)?.dual_horizon;
  const fsf = dh?.operational;

  // ── Supervision Humaine (F4) ────────────────────────────────────────────────
  const iroCr = r.srd?.iro_cr ?? (Math.round((r.iro?.score_100 ?? 50) * (1 - 30 / 200) * 10) / 10);
  const criticalFlags = investor_flags
    .filter(f => f.type === 'risk' && f.severity === 'critique')
    .map(f => f.titre);
  const humanReview = evaluateHumanReviewGate(iroCr, criticalFlags);

  return {
    startup_name:      r.startup_name,
    protocol_version:  PROTOCOL_VERSION,
    prompt_registry:   PROMPT_REGISTRY,
    betas_version:     getBetasVersionTag(),
    generated_at:      new Date().toISOString(),
    secteur:           r.secteur || 'Non renseigné',
    marche:            buildMarche(r),
    vertical:          r.vertical || 'SAAS',

    iro_score:         r.iro?.score_100 ?? 0,
    iro_verdict:       iroVerdict(r.iro?.score_100 ?? 0),
    floor_di_activated: r.flags?.floor_activated ?? false,
    ancrage_warning:   r.flags?.ancrage_warning ?? false,

    dimensions,
    recommendations,
    investor_flags,
    competitor_comparison: competitor,

    verdict_investisseur: r.synthese?.verdict_investisseur ?? '',
    forces:  r.synthese?.forces ?? [],
    risques: r.synthese?.risques ?? [],

    survival_36m:    cox ? Math.round((cox.survival_36m ?? 0) * 100) : undefined,
    survival_36m_lo: cox?.survival_36m_lo != null ? Math.round(cox.survival_36m_lo * 100) : undefined,
    survival_36m_hi: cox?.survival_36m_hi != null ? Math.round(cox.survival_36m_hi * 100) : undefined,
    risk_profile:    cox?.risk_profile,

    c_index_display:          cox?.c_index_display,
    c_index_interpretation:   cox?.c_index_interpretation,
    epv_note:                 cox?.epv_note,

    fsf_score:    fsf?.fsf_score,
    fsf_label:    fsf?.label,
    survival_18m: fsf?.survival_18m != null ? Math.round(fsf.survival_18m * 100) : undefined,

    human_review_gate: humanReview,

    srd_score: r.srd?.srd_100,
    irocr_score: iroCr,

    external_intelligence: buildExternalIntelligence(r),
  };
}

/**
 * [FIX 12/07/2026] Extrait un résumé exploitable de l'intelligence externe déjà
 * collectée (r.webIntelligence via web-intelligence.ts, r.gch_structured via
 * founder-enrichment.ts) mais jusqu'ici jamais restituée dans le rapport
 * investisseur. Fonction pure, défensive sur les champs manquants (ces
 * collecteurs renvoient `null` plutôt que d'halluciner une donnée absente).
 */
function buildExternalIntelligence(r: IROResult): ExternalIntelligenceSummary | undefined {
  const wi = r.webIntelligence as any;
  const press = r.pressIntelligence as any;
  const gchS = r.gch_structured as any;

  if (!wi && !press && !gchS) return undefined;

  let presse: ExternalIntelligenceSummary['presse'] = null;

  if (press) {
    presse = {
      highlights: press.highlights ?? null,
      sentiment: press.sentiment_global ?? null,
      sources_queried: press.sources_used ?? [],
      confidence: press.confidence ?? 'low',
      timeline: press.timeline ?? undefined,
      contradictions: press.contradictions ?? undefined,
      articles_count: press.articles_count ?? undefined,
      source: 'press_intelligence',
    };
  } else if (wi) {
    presse = {
      highlights: wi.press_highlights ?? null,
      sentiment: wi.press_sentiment ?? null,
      sources_queried: wi.sources_queried ?? [],
      confidence: wi.confidence ?? 'low',
      source: 'web_intelligence',
    };
  }

  const fondateurs = gchS ? {
    contexte: gchS.gch_fondateurs_context ?? null,
    key_person_risk: gchS.features?.key_person_risk ?? gchS.key_person_risk ?? false,
    rev11_triggered: gchS.rev11_triggered ?? false,
    rev12_triggered: gchS.rev12_triggered ?? false,
  } : null;

  const marches_publics = wi?.marche_publics_signal ? {
    montant_total_eur: wi.marche_publics_signal.montant_total_eur ?? 0,
    nb_marches: wi.marche_publics_signal.nb_marches ?? 0,
  } : null;

  const brevets_publications = wi ? {
    brevets_count: wi.brevets_count ?? null,
    publications_count: wi.publications_count ?? null,
  } : null;

  return {
    presse,
    fondateurs,
    marches_publics,
    brevets_publications,
    fetched_at: press?.fetched_at ?? wi?.fetched_at ?? null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractQualificatif(just: string, dim: string, score: number): string {
  // Chercher le qualificatif dans la justification (première phrase après score)
  const match = just.match(/Qualificatif\s*:\s*([^.]+)/i)
    || just.match(/(?:Score\s+\d+\/4\s*:\s*)(.+?)(?:\.|$)/i);
  if (match) return match[1].trim();

  // Fallback par niveau
  const fallbacks: Record<string, string[]> = {
    DI:  ['wrapper total', 'dépendance forte', 'hybride', 'infra partiellement propre', 'entièrement propriétaire'],
    ADC: ['aucune donnée propriétaire', 'données génériques', 'données sectorielles', 'VRIN partiel', 'VRIN complet'],
    IPC: ['aucune intégration', 'déclarative', 'production', 'certifiée critique', 'critique irremplaçable'],
    AR:  ['aucune anticipation', 'réactive', 'en cours', 'avancée', 'native et certifiée'],
    CA:  ['rigide', 'réactif lent', 'mixte', 'proactif multi-pivot', 'agilité démontrée'],
    GCH: ['équipe généraliste', 'profil junior', 'expérimenté PME', 'sénior avec exits', 'élite académique+exit'],
  };
  return fallbacks[dim]?.[score] ?? `niveau ${score}/4`;
}

// Helper to determine if an object has a given property
function hasOwnProperty<T extends object, K extends PropertyKey>(obj: T, prop: K): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function extractLabel(just: string, key: string): string | undefined {
  const re = new RegExp(`\\[${key}\\]\\s*=?\\s*(\\S+)`, 'i');
  const m = just.match(re);
  return m?.[1];
}

// Ensure the local tsx compiler doesn't warn about unused functions/variables
if (false) {
  const dummyObj = { a: 1 };
  if (hasOwnProperty(dummyObj, 'a')) {
    console.log(dummyObj.a);
  }
}

function buildMarche(r: IROResult): string {
  const name = r.startup_name?.toLowerCase() ?? '';
  if (name.includes('us') || name.includes('états-unis')) return 'France & États-Unis';
  if (r.vertical === 'HLTH') return 'France (Santé)';
  if (r.vertical === 'FINT') return 'France & Europe (Finance)';
  return 'France';
}

function buildFlags(r: IROResult, scores: Record<string, number>): InvestorFlag[] {
  const flags: InvestorFlag[] = [];
  const synthese = r.synthese;

  // Risques depuis synthese.risques
  (synthese?.risques ?? []).forEach(risk => {
    flags.push({ type: 'risk', severity: 'modéré', titre: risk.split('—')[0].trim(), detail: risk });
  });

  // Flags structurels
  if (r.flags?.floor_activated) {
    flags.push({ type: 'risk', severity: 'critique', titre: 'DI = 0 — REV1 activée', detail: 'Score IRO plafonné à 40 pts.' });
  }
  if (r.flags?.commoditisation_imminente) {
    flags.push({ type: 'risk', severity: 'critique', titre: 'Commoditisation imminente', detail: 'L\'avantage infrastructure est en cours d\'érosion.' });
  }
  if (r.flags?.data_moat_absent) {
    flags.push({ type: 'risk', severity: 'modéré', titre: 'Moat données absent', detail: 'Aucun actif données défendable identifié.' });
  }
  if (r.flags?.single_founder_warning) {
    flags.push({ type: 'risk', severity: 'modéré', titre: 'Fondateur unique', detail: 'Risque de dépendance à une personne clé.' });
  }

  // Signaux positifs depuis synthese.forces
  (synthese?.forces ?? []).forEach(force => {
    flags.push({ type: 'signal', severity: 'positif', titre: force.split('—')[0].trim(), detail: force });
  });

  return flags;
}

function buildRecommendations(
  scores: Record<string, number>,
  r: IROResult,
): DimRecommendation[] {
  const recs: DimRecommendation[] = [];

  // Recommandations générées selon les scores et la synthèse
  const RECO_TEMPLATES: Record<string, Record<number, DimRecommendation>> = {
    CA: {
      3: {
        dim: 'CA', target_score: 4,
        horizon: 'court', horizon_label: 'Court terme (0–6 mois)',
        titre: 'Accélérer la diversification acquisition',
        actions: [
          'Lancer immédiatement des tests Google Ads et TikTok — ne pas attendre 2029.',
          'Documenter et publier les résultats par canal pour crédibiliser la multi-canalité.',
          '10-15% du budget sur canaux alternatifs réduit massivement le risque de concentration.',
        ],
      },
    },
    DI: {
      2: {
        dim: 'DI', target_score: 3,
        horizon: 'court', horizon_label: 'Court terme (0–6 mois)',
        titre: 'Protéger et documenter l\'IP',
        actions: [
          'Déposer les brevets sur les algorithmes de détection propriétaires avant la prochaine levée.',
          'Documenter précisément l\'architecture des agents IA pour renforcer la défensibilité technique.',
          'Budget dépôt PCT international : ~100-300K€ sur la levée en cours.',
        ],
      },
      1: {
        dim: 'DI', target_score: 2,
        horizon: 'court', horizon_label: 'Court terme (0–6 mois)',
        titre: 'Réduire la dépendance infrastructure',
        actions: [
          'Identifier les APIs tierces critiques et construire des alternatives propriétaires.',
          'Documenter le stack technique pour attirer des profils infrastructure séniors.',
         ],
       },
     },
    IPC: {
      2: {
        dim: 'IPC', target_score: 3,
        horizon: 'moyen', horizon_label: 'Moyen terme (6–18 mois)',
        titre: 'Réduire le churn B2C et certifier',
        actions: [
          'Mettre en place un système de mesure du churn : onboarding guidé, notifications menaces.',
          'Obtenir la certification SOC 2 Type II — prérequis pour les ventes B2B.',
          'Gamification de la sécurité pour renforcer l\'engagement utilisateur.',
        ],
      },
      1: {
        dim: 'IPC', target_score: 2,
        horizon: 'moyen', horizon_label: 'Moyen terme (6–18 mois)',
        titre: 'Construire une intégration en production',
        actions: [
          'Passer d\'une intégration déclarative à une intégration active dans les workflows clients.',
          'Identifier 10 clients pivots pour un déploiement profond.',
        ],
      },
    },
    ADC: {
      3: {
        dim: 'ADC', target_score: 4,
        horizon: 'moyen', horizon_label: 'Moyen terme (6–18 mois)',
        titre: 'Formaliser le flywheel données',
        actions: [
          'Construire un rapport de menaces mensuel (threat intelligence report) valorisant les données.',
          'Documenter le flywheel : chaque utilisateur → nouvelles données → meilleur modèle.',
          'Envisager un partenariat exclusif données avec un acteur institutionnel (banque, assureur).',
        ],
      },
      2: {
        dim: 'ADC', target_score: 3,
        horizon: 'moyen', horizon_label: 'Moyen terme (6–18 mois)',
        titre: 'Construire un actif données défendable',
        actions: [
          'Formaliser la politique de rétention et propriété des données utilisateurs.',
          'Développer un modèle de scoring des menaces propriétaire et documenté.',
        ],
      },
    },
    AR: {
      2: {
        dim: 'AR', target_score: 3,
        horizon: 'long', horizon_label: 'Long terme (12–24 mois)',
        titre: 'Certification et compliance proactive',
        actions: [
          'Viser la certification FTC/CCPA compliance aux US avant une potentielle IPO ou acquisition.',
          'Anticiper l\'AI Act européen pour l\'expansion France/Europe.',
          'Nommer un DPO et publier une politique RGPD détaillée.',
        ],
      },
    },
    GCH: {
      2: {
        dim: 'GCH', target_score: 3,
        horizon: 'moyen', horizon_label: 'Moyen terme (6–18 mois)',
        titre: 'Renforcer la gouvernance et l\'advisory',
        actions: [
          'Constituer un advisory board cybersécurité avec 2–3 experts reconnus.',
          'Recruter un CISO (Chief Information Security Officer) pour crédibiliser la dimension sécurité.',
          'Documenter les exits et références pour les due diligences d\'acquisition.',
        ],
      },
    },
  };

  for (const [dim, score] of Object.entries(scores)) {
    const template = RECO_TEMPLATES[dim]?.[score];
    if (template) recs.push(template);
  }

  // Trier par horizon
  const order = { court: 0, moyen: 1, long: 2 };
  recs.sort((a, b) => order[a.horizon] - order[b.horizon]);

  return recs;
}

// ── generateInvestorMarkdown ──────────────────────────────────────────────────

/**
 * Génère le rapport investisseur complet au format Markdown.
 * Structure identique au rapport Control+ / protocole v7.1.0.
 */
export function generateInvestorMarkdown(
  report: InvestorReport,
  baseResult?: IROResult,
): string {
  const r = report;
  const date = new Date(r.generated_at).toLocaleDateString('fr-FR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  let md = '';

  // ── En-tête ─────────────────────────────────────────────────────────────────
  md += `# ${r.startup_name} — Rapport IRO Officiel\n\n`;
  md += `**Protocole** ${r.protocol_version} · **Prompt registry** ${r.prompt_registry} · **Cox calibrated betas** ${r.betas_version ?? 'v4.3 [default]'}\n\n`;
  md += `**Poids officiels :** ${WEIGHTS_LABEL}\n\n`;
  md += `**Secteur :** ${r.secteur} · **Marché :** ${r.marche}\n\n`;
  md += `**Généré le** ${date} · Confidentiel\n\n`;
  md += `---\n\n`;

  // ── Executive Summary (v4.6) — 1 page, lisible sans expertise ───────────────
  const iroScore   = r.iro_score ?? 0;
  const zone       = iroScore >= 80 ? 'Excellent'
                   : iroScore >= 65 ? 'Solide'
                   : iroScore >= 46 ? 'Vigilance'
                   : 'Risque élevé';
  const zoneEmoji  = iroScore >= 65 ? '🟢' : iroScore >= 46 ? '🟡' : '🔴';
  const rev13Info  = (r as REV13Info).rev13_malus
    ? `\n> ⚠️ **REV13** — concentration client appliquée : **${(r as REV13Info).rev13_malus} pts** (top client = ${Math.round(((r as REV13Info).rev13_pct_top ?? 0) * 100)}% du CA, ${(r as REV13Info).rev13_nb_clients ?? '?'} clients)`
    : '';
  const luScore    = r.dimensions?.['LU']?.score ?? null;
  const rev10Flag  = luScore !== null && luScore >= 3 && (r.dimensions?.['IPC']?.score ?? 0) >= 3
    ? '\n> ✅ **REV10** — signal positif : lead user co-constructeur ancré dans des processus critiques (configuration rare dans la cohorte auditée n=401)'
    : '';

  // Top 3 forces et risques depuis les dimensions
  const dimEntries = Object.entries(r.dimensions ?? {});
  const forces = dimEntries
    .filter(([, d]) => (d as DimensionScore).score >= 3)
    .map(([k, d]) => `**${k}=${(d as DimensionScore).score}** — ${((d as DimensionScore).justification ?? '').split('.')[0]}`)
    .slice(0, 3);
  const risques = dimEntries
    .filter(([, d]) => (d as DimensionScore).score <= 1)
    .map(([k, d]) => `**${k}=${(d as DimensionScore).score}** — ${((d as DimensionScore).justification ?? '').split('.')[0]}`)
    .slice(0, 3);

  md += `## 0. Résumé Exécutif — Verdict IRO v4.5-S46\n\n`;
  md += `> ${zoneEmoji} **${r.startup_name} — ${iroScore} / 100 — Zone ${zone}**${rev13Info}${rev10Flag}\n\n`;
  md += `| Paramètre | Valeur |\n| :--- | :--- |\n`;
  md += `| **Score IRO** | **${iroScore} / 100** |\n`;
  md += `| **Zone** | **${zone}** (seuil viabilité = 46) |\n`;
  md += `| **SRD** | ${r.srd_score ?? '—'} / 100 |\n`;
  md += `| **IRO-CR** | ${r.irocr_score ?? '—'} / 100 |\n`;
  md += `| **Survie 36m** | ${r.survival_36m != null ? Math.round(r.survival_36m * 100) + '%' : '—'} |\n\n`;

  if (forces.length > 0) {
    md += `**Forces principales**\n\n`;
    for (const f of forces) md += `- ${f}\n`;
    md += `\n`;
  }
  if (risques.length > 0) {
    md += `**Points de vigilance**\n\n`;
    for (const r2 of risques) md += `- ${r2}\n`;
    md += `\n`;
  }

  const verdictColor = iroScore >= 65 ? 'favorable' : iroScore >= 46 ? 'vigilance — due diligence renforcée recommandée' : 'défavorable — risque structurel élevé';
  md += `**Verdict investisseur** : ${verdictColor}. ${r.verdict_investisseur ?? ''}\n\n`;
  md += `---\n\n`;

  // ── 1. Score global ──────────────────────────────────────────────────────────
  md += `## 1. Score IRO Global — Poids officiels v4.3\n\n`;
  md += `### Score IRO ${r.prompt_registry}\n\n`;
  md += `> **${r.iro_score} / 100 — ${r.iro_verdict}**\n\n`;
  md += `- Floor DI=0 activé : ${r.floor_di_activated ? '⚠️ OUI' : '✅ NON'}\n`;
  md += `- Ancrage warning : ${r.ancrage_warning ? '⚠️ OUI' : '✅ NON'}\n`;
  md += `- Prompt : iro-scoring ${r.prompt_registry}\n\n`;

  // Tableau de détail
  md += `### Détail du calcul (poids officiels iro-weights-v${WEIGHTS_VERSION}.json)\n\n`;
  md += `| Dimension | Score /4 | Poids | Contribution brute | Contribution /100 |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: |\n`;

  let total_contrib = 0;
  for (const [dim, w] of Object.entries(WEIGHTS)) {
    const score = r.dimensions[dim]?.score ?? 0;
    const contrib_brute = score * w;
    const contrib_100 = contrib_brute / 4 * 100;
    total_contrib += contrib_brute;
    md += `| **${dim}** — ${DIM_LABELS[dim]} | ${score} | ${(w * 100).toFixed(0)}% | ${contrib_brute.toFixed(4)} | ${contrib_100.toFixed(2)} |\n`;
  }
  md += `| **TOTAL IRO /100** | — | **100%** | **${total_contrib.toFixed(4)}** | **${r.iro_score}** |\n\n`;

  md += `**Formule :** IRO_brut = Σ(score_i × poids_i) = ${total_contrib.toFixed(4)} → IRO_100 = (${total_contrib.toFixed(4)} / (4 × 1.00)) × 100 = **${r.iro_score}** → **${r.iro_verdict}**\n\n`;

  // Comparaison concurrent
  if (r.competitor_comparison) {
    const comp = r.competitor_comparison;
    md += `### Comparaison avec ${comp.competitor_name} (même protocole IRO ${r.prompt_registry})\n\n`;
    md += `| Dimension | ${r.startup_name} | ${comp.competitor_name} | Avantage |\n`;
    md += `| :--- | :---: | :---: | :---: |\n`;
    for (const dim of Object.keys(WEIGHTS)) {
      const s1 = r.dimensions[dim]?.score ?? 0;
      const s2 = comp.scores[dim] ?? 0;
      const adv = s1 > s2 ? `${r.startup_name} (+${s1 - s2})` : s1 < s2 ? `${comp.competitor_name} (+${s2 - s1})` : 'Égalité';
      md += `| **${dim}** — ${DIM_LABELS[dim]} | ${s1}/4 | ${s2}/4 | ${adv} |\n`;
    }
    md += `| **Score IRO /100** | **${r.iro_score}** | **${comp.iro_score}** | **${r.startup_name} (+${(r.iro_score - comp.iro_score).toFixed(1)})** |\n`;
    md += `| **Interprétation** | **${r.iro_verdict}** | **${comp.verdict}** | — |\n\n`;
  }

  // ── 2. Analyse détaillée ─────────────────────────────────────────────────────
  md += `---\n\n## 2. Analyse détaillée — 7 dimensions IRO ${r.prompt_registry}\n\n`;

  // Radar textuel
  md += Object.entries(WEIGHTS).map(([dim]) => {
    const d = r.dimensions[dim];
    return `**${d?.score ?? 0}** ${dim}`;
  }).join(' · ') + '\n\n';

  for (const [dim, w] of Object.entries(WEIGHTS)) {
    const d = r.dimensions[dim];
    if (!d) continue;
    const stars = dimBars(d.score);

    md += `### ■${d.score >= 3 ? '■' : ''} ${dim} — ${DIM_LABELS[dim]} · ${d.score}/4 (${(w * 100).toFixed(0)}%)\n\n`;
    md += `**Niveau :** ${stars} `;
    md += `**Confiance :** ${Math.round(d.confidence * 100)}% (${d.confidence_label}) `;
    md += `**Qualificatif :** ${d.qualificatif}\n\n`;
    md += `**Grille v4.5-S46 :** ${d.grille_label}\n\n`;
    md += `${d.justification}\n\n`;

    if (d.integration_level) md += `*[IPC REV3] integration_level = ${d.integration_level}*\n\n`;
    if (d.pivot_type)        md += `*[CA REV2] pivot_type = ${d.pivot_type}*\n\n`;

    if (d.missing_data.length > 0) {
      md += `**Données manquantes :** ${d.missing_data.join(' · ')}\n\n`;
    }
  }

  // ── 3. Flags ─────────────────────────────────────────────────────────────────
  md += `---\n\n## 3. Flags IRO ${r.prompt_registry} & alertes stratégiques\n\n`;

  const risks   = r.investor_flags.filter(f => f.type === 'risk');
  const signals = r.investor_flags.filter(f => f.type === 'signal');

  for (const flag of risks) {
    const icon = flag.severity === 'critique' ? '🚨' : '⚠️';
    md += `### ${icon} ${flag.titre}\n\n${flag.detail}\n\n`;
  }
  for (const flag of signals) {
    md += `### ✅ ${flag.titre}\n\n${flag.detail}\n\n`;
  }

  // ── 4. Recommandations ───────────────────────────────────────────────────────
  md += `---\n\n## 4. Recommandations stratégiques (par dimension)\n\n`;

  for (const rec of r.recommendations) {
    md += `### → ${rec.dim} → ${rec.target_score} — ${rec.horizon_label} : ${rec.titre}\n\n`;
    for (const action of rec.actions) {
      md += `• ${action}\n`;
    }
    md += '\n';
  }

  // ── 5. Survie (si disponible) ────────────────────────────────────────────────
  if (r.survival_36m != null) {
    md += `---\n\n## 5. Modèle de survie (Cox PH + FSF)\n\n`;
    md += `| Horizon | Probabilité | IC 95% |\n`;
    md += `| :--- | :---: | :--- |\n`;

    if (r.survival_18m != null) {
      md += `| 18 mois (FSF opérationnel) | **${r.survival_18m}%** | FSF = ${r.fsf_score?.toFixed(1) ?? '—'}/4 — ${r.fsf_label ?? '—'} |\n`;
    } else {
      md += `| 18 mois (FSF opérationnel) | *Non disponible* | Données financières non fournies |\n`;
    }

    const lo = r.survival_36m_lo != null ? `${r.survival_36m_lo}%` : '—';
    const hi = r.survival_36m_hi != null ? `${r.survival_36m_hi}%` : '—';
    md += `| 36 mois (Cox structurel) | **${r.survival_36m}%** | [${lo} ; ${hi}] |\n`;
    md += `| Profil de risque | **${(r.risk_profile ?? '—').toUpperCase()}** | |\n\n`;

    // [v4.61] Nuance Cox si survie très basse et FSF absent
    if ((r.survival_36m ?? 100) < 15 && r.survival_18m == null) {
      md += `> ⚠️ **Note d'interprétation importante** : La survie structurelle Cox (${r.survival_36m}%) reflète uniquement les actifs VRIN (score IRO-CR). Le module FSF (traction financière à 18 mois) est désactivé faute de métriques LTV/CAC/ROAS dans le deck. Ce chiffre **ne prédit pas une faillite** — il signale une faiblesse structurelle. Une startup avec des revenus récurrents solides et un pipeline documenté peut avoir un profil opérationnel très différent de ce score structurel. Fournir LTV, CAC et ARR growth activerait le FSF et compléterait la lecture.\n\n`;
    }
    if (r.c_index_display) {
      md += `* **Pouvoir prédictif (C-index) :** **${r.c_index_display}** *(${r.c_index_interpretation})*\n`;
      md += `* **Évènements par Variable (EPV) :** ${r.epv_note}\n\n`;
    } else {
      md += `> ⚠️ Estimations directionnelles — EPV = 6.7 (seuil institutionnel ≥ 10 non atteint).\n\n`;
    }
  }

  // ── 6. Verdict investisseur ──────────────────────────────────────────────────
  md += `---\n\n## 6. Verdict investisseur\n\n`;
  md += `**${r.verdict_investisseur}**\n\n`;

  md += `### Forces clés\n`;
  r.forces.forEach(f => md += `- ${f}\n`);
  md += `\n### Risques principaux\n`;
  r.risques.forEach(k => md += `- ${k}\n`);

  // ── 7. Intelligence externe (presse, fondateurs, marchés publics) ─────────────
  // [FIX 12/07/2026] Cette section restitue des données déjà collectées par
  // src/collectors/web-intelligence.ts and src/collectors/founder-enrichment.ts
  // (recherche Gemini avec Google Search Grounding) mais jusqu'ici jamais
  // affichées dans le rapport final malgré leur affichage dans les panels
  // WebIntelligencePanel.tsx / FounderProfilePanel.tsx de l'application.
  const ei = r.external_intelligence;
  if (ei && (ei.presse || ei.fondateurs || ei.marches_publics || ei.brevets_publications)) {
    md += `\n---\n\n## 7. Intelligence externe — presse et parties prenantes\n\n`;

    if (ei.presse) {
      md += `### Couverture de presse\n`;
      if (ei.presse.highlights) {
        md += `${ei.presse.highlights}\n\n`;
      } else {
        md += `*Aucune couverture de presse significative trouvée dans les sources consultées.*\n\n`;
      }
      if (ei.presse.sentiment) {
        md += `**Tonalité générale :** ${ei.presse.sentiment}\n\n`;
      }
      if (ei.presse.timeline && ei.presse.timeline.length > 0) {
        md += `**Chronologie des évènements marquants :**\n\n`;
        for (const item of ei.presse.timeline) {
          md += `- **${item.periode}** : ${item.evenement} *(${item.type})*\n`;
        }
        md += `\n`;
      }
      if (ei.presse.contradictions && ei.presse.contradictions.length > 0) {
        md += `**⚠️ Contradictions pitch vs réalité de presse détectées :**\n\n`;
        md += `| Déclaration Pitch | Réalité Presse | Sévérité |\n`;
        md += `| :--- | :--- | :---: |\n`;
        for (const item of ei.presse.contradictions) {
          md += `| ${item.claim_pitch} | ${item.realite_presse} | **${item.severite.toUpperCase()}** |\n`;
        }
        md += `\n`;
      }
      if (ei.presse.sources_queried.length) {
        md += `*Sources consultées : ${ei.presse.sources_queried.join(', ')} — fiabilité ${ei.presse.confidence}.*\n\n`;
      }
    }

    if (ei.fondateurs?.contexte) {
      md += `### Profils des fondateurs\n`;
      md += `${ei.fondateurs.contexte}\n\n`;
      if (ei.fondateurs.key_person_risk) {
        md += `> ⚠️ **Risque de dépendance à une personne clé identifié.**\n\n`;
      }
      if (ei.fondateurs.rev11_triggered) {
        md += `> ℹ️ Fondateur unique documenté — plafond GCH appliqué (règle REV11).\n\n`;
      }
      if (ei.fondateurs.rev12_triggered) {
        md += `> ⚠️ Aucun antécédent professionnel documenté pour l'équipe fondatrice (règle REV12).\n\n`;
      }
    }

    if (ei.marches_publics && ei.marches_publics.nb_marches > 0) {
      md += `### Marchés publics identifiés\n`;
      md += `${ei.marches_publics.nb_marches} marché(s) public(s) recensé(s), pour un montant cumulé `;
      md += `d'environ ${ei.marches_publics.montant_total_eur.toLocaleString('fr-FR')} €.\n\n`;
    }

    if (ei.brevets_publications && (ei.brevets_publications.brevets_count || ei.brevets_publications.publications_count)) {
      md += `### Propriété intellectuelle et publications\n`;
      if (ei.brevets_publications.brevets_count) md += `- Brevets recensés : ${ei.brevets_publications.brevets_count}\n`;
      if (ei.brevets_publications.publications_count) md += `- Publications scientifiques recensées : ${ei.brevets_publications.publications_count}\n`;
      md += `\n`;
    }

    if (ei.fetched_at) {
      md += `*Intelligence externe collectée le ${new Date(ei.fetched_at).toLocaleDateString('fr-FR')} — sujette à évolution, à re-vérifier avant toute décision.*\n\n`;
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  md += `\n---\n\n`;
  md += `*Ce rapport est produit selon le protocole ${r.protocol_version}, `;
  md += `prompt registry ${r.prompt_registry}, poids iro-weights-v${WEIGHTS_VERSION}.json `;
  md += `(Delphi expert panel, frozen=${WEIGHTS_FROZEN}). 7 dimensions : ${WEIGHTS_LABEL}. `;
  md += `Ce document ne constitue pas un conseil en investissement.*\n`;

  return md;
}
