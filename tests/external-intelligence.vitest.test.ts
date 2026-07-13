/**
 * tests/external-intelligence.vitest.test.ts
 * IRO Strength — Tests de la section "Intelligence externe" du rapport investisseur.
 *
 * Contexte (12/07/2026) : src/collectors/web-intelligence.ts et
 * src/collectors/founder-enrichment.ts collectent déjà de la presse, des profils
 * fondateurs, des marchés publics, etc. (recherche Gemini + Google Search
 * Grounding), et ces données sont affichées dans WebIntelligencePanel.tsx /
 * FounderProfilePanel.tsx — mais elles n'atteignaient jamais le rapport
 * investisseur généré (investor-report-generator.ts ne les lisait pas), le même
 * type de défaut que le bug LU corrigé le 10/07/2026 dans batch_iro.ts.
 *
 * Ces tests verrouillent le branchement : buildExternalIntelligence() (interne,
 * testée via buildInvestorReport) doit extraire ces données quand elles sont
 * présentes, et generateInvestorMarkdown() doit les restituer en Section 7,
 * sans jamais fabriquer de données absentes (principe anti-hallucination du
 * reste du pipeline de collecte).
 */

import { describe, it, expect } from 'vitest';
import { buildInvestorReport, generateInvestorMarkdown } from '../src/utils/investor-report-generator';
import type { IROResult } from '../src/types/iro';

function makeBaseResult(overrides: Partial<any> = {}): IROResult {
  return {
    startup_name: 'TestCo',
    secteur: 'Santé',
    vertical: 'HLTH',
    iro: {
      scores: { DI: 3, ADC: 3, IPC: 2, AR: 2, CA: 2, GCH: 2 },
      justifications: {},
      score_100: 55,
      ipc_confiance: 0.8,
    },
    flags: {},
    synthese: { forces: [], risques: [], verdict_investisseur: '' },
    sources_utilisees: [],
    hypotheses: {},
    benchmark: {},
    ...overrides,
  } as unknown as IROResult;
}

describe('Intelligence externe — extraction (buildExternalIntelligence via buildInvestorReport)', () => {
  it('retourne undefined quand ni webIntelligence ni gch_structured ne sont fournis', () => {
    const report = buildInvestorReport(makeBaseResult());
    expect(report.external_intelligence).toBeUndefined();
  });

  it('extrait la presse depuis webIntelligence quand présente', () => {
    const result = makeBaseResult({
      webIntelligence: {
        press_highlights: 'Levée de 2M€ mentionnée dans Maddyness.',
        press_sentiment: 'positif',
        sources_queried: ['Maddyness', 'Les Echos'],
        confidence: 'medium',
        fetched_at: '2026-07-01T00:00:00Z',
      },
    });
    const report = buildInvestorReport(result);
    expect(report.external_intelligence?.presse?.highlights).toContain('Maddyness');
    expect(report.external_intelligence?.presse?.sentiment).toBe('positif');
    expect(report.external_intelligence?.presse?.sources_queried).toEqual(['Maddyness', 'Les Echos']);
  });

  it('extrait le contexte fondateurs depuis gch_structured quand présent', () => {
    const result = makeBaseResult({
      gch_structured: {
        gch_fondateurs_context: 'Jean Dupont: Ex-Google',
        features: { key_person_risk: true },
        rev11_triggered: true,
        rev12_triggered: false,
      },
    });
    const report = buildInvestorReport(result);
    expect(report.external_intelligence?.fondateurs?.contexte).toBe('Jean Dupont: Ex-Google');
    expect(report.external_intelligence?.fondateurs?.key_person_risk).toBe(true);
    expect(report.external_intelligence?.fondateurs?.rev11_triggered).toBe(true);
  });

  it("ne fabrique aucune donnée absente (respecte le principe anti-hallucination)", () => {
    const result = makeBaseResult({
      webIntelligence: { press_highlights: null, sources_queried: [], confidence: 'low', fetched_at: null },
    });
    const report = buildInvestorReport(result);
    expect(report.external_intelligence?.presse?.highlights).toBeNull();
    expect(report.external_intelligence?.marches_publics).toBeNull();
  });
});

describe('Intelligence externe — rendu Markdown (generateInvestorMarkdown)', () => {
  it("n'affiche pas la Section 7 quand aucune intelligence externe n'est disponible", () => {
    const report = buildInvestorReport(makeBaseResult());
    const md = generateInvestorMarkdown(report, makeBaseResult());
    expect(md).not.toContain('## 7. Intelligence externe');
  });

  it('affiche la Section 7 avec la presse et les fondateurs quand disponibles', () => {
    const result = makeBaseResult({
      webIntelligence: {
        press_highlights: 'Partenariat annoncé avec une grande banque.',
        press_sentiment: 'positif',
        sources_queried: ['TechCrunch'],
        confidence: 'high',
        fetched_at: '2026-07-01T00:00:00Z',
      },
      gch_structured: {
        gch_fondateurs_context: 'Marie Martin: Ex-BCG',
        features: { key_person_risk: false },
        rev11_triggered: false,
        rev12_triggered: false,
      },
    });
    const report = buildInvestorReport(result);
    const md = generateInvestorMarkdown(report, result);
    expect(md).toContain('## 7. Intelligence externe — presse et parties prenantes');
    expect(md).toContain('Partenariat annoncé avec une grande banque.');
    expect(md).toContain('Marie Martin: Ex-BCG');
    expect(md).toContain('Tonalité générale :** positif');
  });

  it('signale le risque de dépendance à une personne clé quand détecté', () => {
    const result = makeBaseResult({
      gch_structured: {
        gch_fondateurs_context: 'Fondateur unique.',
        features: { key_person_risk: true },
        rev11_triggered: true,
        rev12_triggered: false,
      },
    });
    const report = buildInvestorReport(result);
    const md = generateInvestorMarkdown(report, result);
    expect(md).toContain('Risque de dépendance à une personne clé identifié');
    expect(md).toContain('règle REV11');
  });

  it('affiche un message neutre si la presse a été interrogée sans résultat, plutôt que rien', () => {
    const result = makeBaseResult({
      webIntelligence: {
        press_highlights: null,
        sources_queried: ['Maddyness', 'TechCrunch'],
        confidence: 'low',
        fetched_at: '2026-07-01T00:00:00Z',
      },
    });
    const report = buildInvestorReport(result);
    const md = generateInvestorMarkdown(report, result);
    expect(md).toContain('Aucune couverture de presse significative trouvée');
  });
});
