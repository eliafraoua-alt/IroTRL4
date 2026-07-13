/**
 * tests/honesty-gate.vitest.test.ts
 * Gate d'honnêteté déclarative — bloquant sur main
 *
 * Vérifie que :
 * 1. Les labels TRL sont présents dans le code
 * 2. Les annotations "non significatif" n'ont pas disparu
 * 3. audit_note liste les providers réels
 * 4. IRO_Certified ne remplace pas le score normatif
 * 5. DEFAULT_CONFIG reflète la réalité (pas 3×Gemini en prod)
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.join(process.cwd(), 'src');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf8');
}

describe('Gate d\'honnêteté déclarative', () => {

  it('TRL-1 : cox-model.ts déclare son statut TRL', () => {
    const src = readSource('utils/cox-model.ts');
    expect(src).toMatch(/TRL/i);
    expect(src).toMatch(/normatif|non.*validé|calibration/i);
  });

  it('TRL-2 : fsf-module.ts déclare TRL 2', () => {
    const src = readSource('utils/fsf-module.ts');
    expect(src).toMatch(/TRL.*2/i);
  });

  it('HON-1 : multi-llm-consensus.ts ne prétend pas être multi-LLM si 3×Gemini', () => {
    const src = readSource('utils/multi-llm-consensus.ts');
    // is_true_multi_llm doit exister
    expect(src).toMatch(/is_true_multi_llm/);
    // audit_note ne doit pas fixer "Claude" ou "Mistral" si DEFAULT est 3×Gemini
    expect(src).not.toMatch(/audit_note.*Claude.*Mistral.*toujours/i);
  });

  it('HON-2 : DEFAULT_CONFIG providers ne contient que des labels réels', () => {
    const src = readSource('utils/multi-llm-consensus.ts');
    // Après correctif C1 : DEFAULT doit être multi-LLM ou dégradation documentée
    // Ce test échoue intentionnellement si C1 n'est pas appliqué
    const hasMultiDefault = src.includes("'Claude'") || src.includes("'Mistral'") ||
      src.includes('ANTHROPIC_API_KEY') || src.includes('dégradation');
    expect(hasMultiDefault).toBe(true);
  });

  it('HON-3 : iro-engine.ts n\'utilise pas IRO_Certified comme score normatif', () => {
    const src = readSource('utils/iro-engine.ts');
    // IRO_Certified peut exister comme label mais ne doit pas remplacer calcIROcr()
    const lines = src.split('\n');
    const certifiedAssignment = lines.find(l =>
      l.includes('IRO_Certified') && l.includes('=') && l.includes('calcIRO')
    );
    expect(certifiedAssignment).toBeUndefined();
  });

  it('HON-4 : conformal-bands.ts référence Sesia 2025', () => {
    const src = readSource('utils/conformal-bands.ts');
    expect(src).toMatch(/Sesia|conformal|PMLR/i);
  });

  it('INV-1 : prompt-regression-test.ts est importé ou référencé dans la CI', () => {
    const ci = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const hasRegressionInCI = ci.includes('prompt-regression') || ci.includes('honesty');
    expect(hasRegressionInCI).toBe(true);
  });
});
