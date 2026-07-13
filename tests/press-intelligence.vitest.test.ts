// Tests — press-intelligence.ts v8.0
// Couvre la logique PURE et déterministe du pipeline presse (phases B et D) :
// dédoublonnage, timeline, distribution de sentiment, hints IRO, flags, formatteur.
// Les phases A (découverte réseau) et C (annotation LLM) ne sont PAS testées ici
// (dépendantes du réseau / LLM) — même approche que grey-sources.vitest.test.ts.

import { describe, it, expect } from 'vitest';
import {
  dedupeArticles,
  buildTimeline,
  computeSentimentDistribution,
  computeGlobalSentiment,
  computeIROHintsFromPress,
  detectPressFlags,
  formatPressIntelligenceContext,
  type RawPressArticle,
  type PressArticleAnnotation,
  type PressIntelligenceResult,
  type PressContradiction,
} from '../src/collectors/press-intelligence';

// ── Fixtures ────────────────────────────────────────────────────────────────────

function rawArticle(overrides: Partial<RawPressArticle> = {}): RawPressArticle {
  return {
    title: 'Titre par défaut',
    url: 'https://techcrunch.com/2024/01/15/article-defaut',
    domain: 'techcrunch.com',
    date: '2024-01-15',
    snippet: 'Un résumé factuel.',
    source_api: 'gdelt',
    language: null,
    ...overrides,
  };
}

function annotation(overrides: Partial<PressArticleAnnotation> = {}): PressArticleAnnotation {
  return {
    title: 'Titre par défaut',
    url: 'https://techcrunch.com/2024/01/15/article-defaut',
    domain: 'techcrunch.com',
    date: '2024-01-15',
    sentiment: 'neutre',
    themes: [],
    entites: { personnes: [], organisations: [], montants: [], technologies: [] },
    fait_marquant: 'Un fait factuel.',
    credibilite_source: 'haute',
    doublon_de: null,
    ...overrides,
  };
}

const EMPTY_RESULT: PressIntelligenceResult = {
  articles_bruts_count: 0,
  articles_retenus_count: 0,
  articles: [],
  timeline: [],
  contradictions: [],
  sentiment_global: 'neutre',
  sentiment_distribution: { positif: 0, neutre: 0, négatif: 0, mixte: 0 },
  silence_presse: false,
  derniere_mention: null,
  themes_dominants: [],
  iro_hints_presse: { di_hint: 1, ipc_hint: 1, ar_hint: 1, ca_hint: 1, gch_hint: 1, adc_hint: 1 },
  flags_detected: {
    crise_reputationnelle: false,
    contradiction_pitch_presse: false,
    silence_presse_prolonge: false,
    couverture_presse_forte: false,
  },
  sources_used: [],
  confidence: 'low',
  fetched_at: new Date().toISOString(),
};

// ── dedupeArticles ────────────────────────────────────────────────────────────

describe('dedupeArticles', () => {
  it('fusionne deux articles avec URL identique', () => {
    const a = rawArticle({ url: 'https://lesechos.fr/x', date: null });
    const b = rawArticle({ url: 'https://lesechos.fr/x', date: '2024-03-01', source_api: 'gemini_search' });
    const result = dedupeArticles([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2024-03-01'); // enrichi depuis la 2e source
  });

  it('fusionne par titre normalisé + domaine quand pas d\'URL', () => {
    const a = rawArticle({ url: '', title: 'Levée de fonds Série A !', domain: 'maddyness.com' });
    const b = rawArticle({ url: '', title: 'levee de fonds serie a', domain: 'maddyness.com' });
    const result = dedupeArticles([a, b]);
    expect(result).toHaveLength(1);
  });

  it('conserve deux articles distincts sur des domaines différents', () => {
    const a = rawArticle({ url: 'https://techcrunch.com/a' });
    const b = rawArticle({ url: 'https://lesechos.fr/b', domain: 'lesechos.fr' });
    const result = dedupeArticles([a, b]);
    expect(result).toHaveLength(2);
  });

  it('ignore les articles sans titre', () => {
    const a = rawArticle({ title: '' });
    expect(dedupeArticles([a])).toHaveLength(0);
  });
});

// ── buildTimeline ─────────────────────────────────────────────────────────────

describe('buildTimeline', () => {
  it('regroupe les articles par mois (AAAA-MM)', () => {
    const arts = [
      annotation({ date: '2024-01-05', fait_marquant: 'Fait 1' }),
      annotation({ date: '2024-01-20', fait_marquant: 'Fait 2' }),
      annotation({ date: '2024-03-10', fait_marquant: 'Fait 3' }),
    ];
    const tl = buildTimeline(arts);
    const periodes = new Set(tl.map(e => e.periode));
    expect(periodes).toEqual(new Set(['2024-01', '2024-03']));
  });

  it('infère le type "financement" depuis les thèmes', () => {
    const arts = [annotation({ date: '2024-02-01', themes: ['levée de fonds'], fait_marquant: 'A levé 5M€' })];
    const tl = buildTimeline(arts);
    expect(tl[0].type).toBe('financement');
  });

  it('infère le type "crise" depuis les thèmes', () => {
    const arts = [annotation({ date: '2024-02-01', themes: ['licenciement'], fait_marquant: 'Plan social annoncé' })];
    const tl = buildTimeline(arts);
    expect(tl[0].type).toBe('crise');
  });

  it('retourne "autre" si aucun thème ne matche', () => {
    const arts = [annotation({ date: '2024-02-01', themes: ['inconnu'], fait_marquant: 'Fait neutre' })];
    expect(buildTimeline(arts)[0].type).toBe('autre');
  });

  it('ignore les articles sans date ou sans fait marquant', () => {
    const arts = [
      annotation({ date: null, fait_marquant: 'Fait sans date' }),
      annotation({ date: '2024-01-01', fait_marquant: null }),
    ];
    expect(buildTimeline(arts)).toHaveLength(0);
  });

  it('limite à 3 événements par période', () => {
    const arts = Array.from({ length: 5 }, (_, i) =>
      annotation({ date: '2024-01-0' + (i + 1), fait_marquant: `Fait ${i}` })
    );
    const tl = buildTimeline(arts);
    expect(tl.filter(e => e.periode === '2024-01')).toHaveLength(3);
  });
});

// ── computeSentimentDistribution / computeGlobalSentiment ──────────────────────

describe('computeSentimentDistribution & computeGlobalSentiment', () => {
  it('compte correctement chaque catégorie', () => {
    const arts = [
      annotation({ sentiment: 'positif' }),
      annotation({ sentiment: 'positif' }),
      annotation({ sentiment: 'négatif' }),
      annotation({ sentiment: 'neutre' }),
    ];
    const dist = computeSentimentDistribution(arts);
    expect(dist).toEqual({ positif: 2, neutre: 1, négatif: 1, mixte: 0 });
  });

  it('retourne "neutre" si aucun article', () => {
    expect(computeGlobalSentiment({ positif: 0, neutre: 0, négatif: 0, mixte: 0 })).toBe('neutre');
  });

  it('retourne "positif" si majorité positive', () => {
    expect(computeGlobalSentiment({ positif: 6, neutre: 4, négatif: 0, mixte: 0 })).toBe('positif');
  });

  it('retourne "négatif" si forte proportion négative sans contrepoids positif', () => {
    expect(computeGlobalSentiment({ positif: 0, neutre: 2, négatif: 5, mixte: 0 })).toBe('négatif');
  });

  it('retourne "mixte" si négatif et positif significatifs simultanément', () => {
    expect(computeGlobalSentiment({ positif: 3, neutre: 1, négatif: 4, mixte: 0 })).toBe('mixte');
  });
});

// ── computeIROHintsFromPress ────────────────────────────────────────────────────

describe('computeIROHintsFromPress', () => {
  it('retourne des hints neutres (1) si aucun article', () => {
    const hints = computeIROHintsFromPress([], []);
    expect(hints).toEqual({ di_hint: 1, ipc_hint: 1, ar_hint: 1, ca_hint: 1, gch_hint: 1, adc_hint: 1 });
  });

  it('tous les hints restent dans [0,4]', () => {
    const arts = Array.from({ length: 20 }, () =>
      annotation({
        themes: ['levée de fonds', 'partenariat', 'recrutement'],
        fait_marquant: 'brevet propriétaire technologie certification agrément',
        entites: { personnes: ['X'], organisations: [], montants: ['5M€'], technologies: ['IA'] },
      })
    );
    const tl = buildTimeline(arts.map((a, i) => ({ ...a, date: `2024-0${(i % 9) + 1}-01`, fait_marquant: a.fait_marquant })));
    const hints = computeIROHintsFromPress(arts, tl);
    for (const v of Object.values(hints)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(4);
    }
  });

  it('ipc_hint augmente avec le nombre de partenariats en timeline', () => {
    const arts = [annotation()];
    const tlFaible = [{ periode: '2024-01', evenement: 'x', sources: [], type: 'autre' as const }];
    const tlFort = Array.from({ length: 4 }, (_, i) => ({
      periode: `2024-0${i + 1}`, evenement: 'partenariat client', sources: [], type: 'partenariat' as const,
    }));
    const hintsFaible = computeIROHintsFromPress(arts, tlFaible);
    const hintsFort = computeIROHintsFromPress(arts, tlFort);
    expect(hintsFort.ipc_hint).toBeGreaterThan(hintsFaible.ipc_hint);
  });
});

// ── detectPressFlags ────────────────────────────────────────────────────────────

describe('detectPressFlags', () => {
  it('lève crise_reputationnelle si ≥2 événements de crise en timeline', () => {
    const tl = [
      { periode: '2024-01', evenement: 'licenciement', sources: [], type: 'crise' as const },
      { periode: '2024-02', evenement: 'litige client', sources: [], type: 'crise' as const },
    ];
    const dist = { positif: 0, neutre: 2, négatif: 2, mixte: 0 };
    const flags = detectPressFlags([annotation(), annotation()], tl, dist, [], 24);
    expect(flags.crise_reputationnelle).toBe(true);
  });

  it('lève contradiction_pitch_presse si contradiction majeure présente', () => {
    const contradictions: PressContradiction[] = [
      { claim_pitch: '50 clients', realite_presse: 'Aucun client nommé en presse', severite: 'majeure', sources: ['lesechos.fr'] },
    ];
    const dist = { positif: 1, neutre: 1, négatif: 0, mixte: 0 };
    const flags = detectPressFlags([annotation()], [], dist, contradictions, 24);
    expect(flags.contradiction_pitch_presse).toBe(true);
  });

  it('ne lève pas silence_presse_prolonge pour une jeune startup sans presse', () => {
    const dist = { positif: 0, neutre: 0, négatif: 0, mixte: 0 };
    const flags = detectPressFlags([], [], dist, [], 6); // 6 mois d'existence seulement
    expect(flags.silence_presse_prolonge).toBe(false);
  });

  it('lève silence_presse_prolonge si dernière mention > 12 mois pour startup mature', () => {
    const arts = [annotation({ date: '2022-01-01' })];
    const dist = { positif: 1, neutre: 0, négatif: 0, mixte: 0 };
    const flags = detectPressFlags(arts, [], dist, [], 36);
    expect(flags.silence_presse_prolonge).toBe(true);
  });

  it('lève couverture_presse_forte si ≥8 articles dont ≥3 haute crédibilité', () => {
    const arts = [
      ...Array.from({ length: 3 }, () => annotation({ credibilite_source: 'haute' })),
      ...Array.from({ length: 5 }, () => annotation({ credibilite_source: 'moyenne' })),
    ];
    const dist = { positif: 4, neutre: 4, négatif: 0, mixte: 0 };
    const flags = detectPressFlags(arts, [], dist, [], 24);
    expect(flags.couverture_presse_forte).toBe(true);
  });
});

// ── formatPressIntelligenceContext ──────────────────────────────────────────────

describe('formatPressIntelligenceContext', () => {
  it('retourne une chaîne vide si aucun article retenu', () => {
    expect(formatPressIntelligenceContext(EMPTY_RESULT)).toBe('');
  });

  it('produit un contexte non-vide avec articles, timeline et hints', () => {
    const result: PressIntelligenceResult = {
      ...EMPTY_RESULT,
      articles_bruts_count: 12,
      articles_retenus_count: 8,
      articles: [annotation()],
      timeline: [{ periode: '2024-01', evenement: 'Levée de fonds 5M€', sources: ['https://lesechos.fr/x'], type: 'financement' }],
      sentiment_distribution: { positif: 5, neutre: 3, négatif: 0, mixte: 0 },
      sentiment_global: 'positif',
      themes_dominants: ['levée de fonds', 'partenariat'],
      derniere_mention: '2024-03-01',
      sources_used: ['gdelt_doc_api', 'gemini_search_presse'],
      confidence: 'high',
    };
    const ctx = formatPressIntelligenceContext(result);
    expect(ctx).toContain('REVUE DE PRESSE EXHAUSTIVE');
    expect(ctx).toContain('Levée de fonds 5M€');
    expect(ctx).toContain('HINTS IRO PRESSE');
    expect(ctx).toContain('gdelt_doc_api');
  });

  it('affiche les contradictions détectées', () => {
    const result: PressIntelligenceResult = {
      ...EMPTY_RESULT,
      articles_retenus_count: 3,
      contradictions: [
        { claim_pitch: '50 clients entreprise', realite_presse: 'aucun client nommé en presse', severite: 'majeure', sources: ['lesechos.fr'] },
      ],
    };
    const ctx = formatPressIntelligenceContext(result);
    expect(ctx).toContain('CONTRADICTIONS PITCH vs PRESSE');
    expect(ctx).toContain('MAJEURE');
  });

  it('affiche les flags actifs en résumé', () => {
    const result: PressIntelligenceResult = {
      ...EMPTY_RESULT,
      articles_retenus_count: 3,
      flags_detected: { ...EMPTY_RESULT.flags_detected, crise_reputationnelle: true, silence_presse_prolonge: true },
    };
    const ctx = formatPressIntelligenceContext(result);
    expect(ctx).toContain('crise_reputationnelle');
    expect(ctx).toContain('silence_presse_prolonge');
  });
});

// ── Structure PressIntelligenceResult ───────────────────────────────────────────

describe('PressIntelligenceResult — structure', () => {
  it('contient tous les champs attendus', () => {
    const keys = Object.keys(EMPTY_RESULT);
    for (const k of [
      'articles_bruts_count', 'articles_retenus_count', 'articles', 'timeline',
      'contradictions', 'sentiment_global', 'sentiment_distribution', 'silence_presse',
      'derniere_mention', 'themes_dominants', 'iro_hints_presse', 'flags_detected',
      'sources_used', 'confidence', 'fetched_at',
    ]) {
      expect(keys).toContain(k);
    }
  });

  it('iro_hints_presse contains the 6 dimensions', () => {
    const hints = Object.keys(EMPTY_RESULT.iro_hints_presse);
    expect(hints).toEqual(['di_hint', 'ipc_hint', 'ar_hint', 'ca_hint', 'gch_hint', 'adc_hint']);
  });

  it('flags_detected contains the 4 flags press', () => {
    const flags = Object.keys(EMPTY_RESULT.flags_detected);
    expect(flags).toEqual([
      'crise_reputationnelle', 'contradiction_pitch_presse',
      'silence_presse_prolonge', 'couverture_presse_forte',
    ]);
  });
});
