import { callLLMWithRouter } from './llm-router';
import { logger } from './logger';
import { extractJSON } from './json-utils';
import { GOLD_STANDARD } from '../types/iro';
import type { GoldStandardEntry } from '../types/iro';

export interface RegressionCase {
  startupName: string;
  vertical: string;
  expectedIRO: { min: number; max: number };
  expectedDimensions?: Partial<Record<'DI'|'ADC'|'IPC'|'AR'|'CA'|'GCH', {
    min: number; max: number
  }>>;
  // Description courte de la startup — évite un appel web réel
  syntheticContext: string;
}

// Suite basée sur les 10 startups Delphi
export const REGRESSION_SUITE: RegressionCase[] = GOLD_STANDARD.map(g => ({
  startupName: g.name,
  vertical: g.vertical,
  expectedIRO: { 
    min: Math.max(0, g.sce.final - 5), 
    max: Math.min(100, g.sce.final + 5) 
  },
  syntheticContext: `Startup ${g.vertical}, analysée dans le gold standard v4.3. 
    Source: Delphi. Scores cibles: DI=${g.scores.DI}, ADC=${g.scores.ADC}, IPC=${g.scores.IPC}, AR=${g.scores.AR}, CA=${g.scores.CA}, GCH=${g.scores.GCH}.`
}));

export interface RegressionResult {
  case: RegressionCase;
  actualIRO: number;
  passed: boolean;
  drift: number;             // écart par rapport au centre de la plage attendue
  error?: string;
}

export interface RegressionReport {
  passRate: number;
  passed: number;
  failed: number;
  results: RegressionResult[];
  deploymentAllowed: boolean;  // passRate >= 0.80
  promptVersion: string;
  testedAt: string;
}

export async function runPromptRegressionTest(
  prompt: string,
  promptVersion: string,
  customEntries?: GoldStandardEntry[]
): Promise<RegressionReport> {
  logger.info(`[REGRESSION] Starting test for prompt v${promptVersion}`);
  
  const suite = customEntries ? customEntries.map(g => ({
    startupName: g.name,
    vertical: g.vertical,
    expectedIRO: { 
      min: Math.max(0, g.sce.final - 5), 
      max: Math.min(100, g.sce.final + 5) 
    },
    syntheticContext: `Startup ${g.vertical}, analysée dans le gold standard v4.3. 
      Source: Delphi. Scores cibles: DI=${g.scores.DI}, ADC=${g.scores.ADC}, IPC=${g.scores.IPC}, AR=${g.scores.AR}, CA=${g.scores.CA}, GCH=${g.scores.GCH}.`
  })) : REGRESSION_SUITE;

  const results = await Promise.all(
    suite.map(async (testCase) => {
      try {
        const response = await callLLMWithRouter(
          `Analyze the following startup context using the provided prompt.\n\nCONTEXT:\n${testCase.syntheticContext}\n\nPROMPT:\n${prompt}\n\nReturn ONLY the JSON result with "iro" score (score_100).`,
          "Tu es un expert en audit de startups IA."
        );
        
        const parsed = extractJSON(response.response);
        // On cherche score_100 ou iro
        const actualIRO = parsed.iro?.score_100 ?? parsed.score_100 ?? parsed.iro ?? 0;
        
        const passed =
          actualIRO >= testCase.expectedIRO.min &&
          actualIRO <= testCase.expectedIRO.max;

        const center = (testCase.expectedIRO.min + testCase.expectedIRO.max) / 2;

        return {
          case: testCase,
          actualIRO,
          passed,
          drift: Math.round((actualIRO - center) * 10) / 10
        };
      } catch (e: any) {
        logger.error(`[REGRESSION] Failed for ${testCase.startupName}:`, e);
        return {
          case: testCase,
          actualIRO: 0,
          passed: false,
          drift: 0,
          error: e.message
        };
      }
    })
  );

  const passedCount = results.filter(r => r.passed).length;
  const passRate = passedCount / results.length;

  return {
    passRate,
    passed: passedCount,
    failed: results.length - passedCount,
    results,
    deploymentAllowed: passRate >= 0.80,
    promptVersion,
    testedAt: new Date().toISOString()
  };
}
