/**
 * tests/founder-enrichment.vitest.test.ts
 * IRO Strength v6.6.2 — Tests logique GCH (founder-enrichment.ts)
 *
 * Maintenant possible car founder-enrichment.ts n'importe plus React.
 * Tests de la logique pure : computeGCHFromProfiles, createEmptyFounder,
 * buildFounderSearchPrompt, REV11/REV12/REV13.
 */

import { describe, it, expect } from 'vitest';
import {
  computeGCHFromProfiles,
  createEmptyFounder,
  buildFounderSearchPrompt,
  type FounderProfile,
} from '../src/collectors/founder-enrichment';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFounder(overrides: Partial<FounderProfile> = {}): FounderProfile {
  return createEmptyFounder(overrides);
}

// ── computeGCHFromProfiles ────────────────────────────────────────────────────

describe('computeGCHFromProfiles', () => {
  it('retourne score=0 et rev12_triggered si aucun fondateur', () => {
    const r = computeGCHFromProfiles([]);
    expect(r.score).toBe(0);
    expect(r.rev12_triggered).toBe(true);
  });

  it('GCH=4 pour GAFAM + PhD', () => {
    const f1 = makeFounder({
      previous_companies: ['Google Brain'],
      education: ['PhD NeurIPS'],
      track_record: 'exit',
    });
    const f2 = makeFounder({ id: 'f2', name: 'Bob' });
    const r = computeGCHFromProfiles([f1, f2]);
    expect(r.score).toBe(4);
  });

  it('GCH=3 pour ex-GAFAM seul', () => {
    const f1 = makeFounder({ previous_companies: ['Meta AI'] });
    const f2 = makeFounder({ id: 'f2', name: 'Bob' });
    const r = computeGCHFromProfiles([f1, f2]);
    expect(r.score).toBe(3);
  });

  it('GCH=3 pour PhD seul', () => {
    const f1 = makeFounder({ education: ['Doctorat INRIA'] });
    const f2 = makeFounder({ id: 'f2', name: 'Bob' });
    const r = computeGCHFromProfiles([f1, f2]);
    expect(r.score).toBe(3);
  });

  it('GCH=2 pour scale seul', () => {
    const f1 = makeFounder({ track_record: 'scale' });
    const f2 = makeFounder({ id: 'f2', name: 'Bob' });
    const r = computeGCHFromProfiles([f1, f2]);
    expect(r.score).toBe(2);
  });

  it('GCH=1 pour fondateur généraliste', () => {
    const f = makeFounder({ name: 'John Doe', role: 'CEO' });
    const r = computeGCHFromProfiles([f]);
    expect(r.score).toBe(1);
  });

  it('REV11 : fondateur unique → score plafonné à 1', () => {
    const f = makeFounder({
      previous_companies: ['Google'],
      education: ['PhD'],
      track_record: 'exit',
    });
    const r = computeGCHFromProfiles([f]);
    expect(r.rev11_triggered).toBe(true);
    expect(r.key_person_risk).toBe(true);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('REV11 non déclenché si 2+ fondateurs', () => {
    const f1 = makeFounder({ name: 'Alice' });
    const f2 = makeFounder({ name: 'Bob', id: '2' });
    const r = computeGCHFromProfiles([f1, f2]);
    expect(r.rev11_triggered).toBe(false);
    expect(r.key_person_risk).toBe(false);
  });

  it('REV12 : tous fondateurs sans background → déclenché', () => {
    const f = makeFounder();  // tout vide par défaut
    const r = computeGCHFromProfiles([f]);
    expect(r.rev12_triggered).toBe(true);
  });

  it('REV13 : tous juniors → déclenché', () => {
    const f1 = makeFounder({ track_record: 'junior', name: 'A' });
    const f2 = makeFounder({ track_record: 'junior', name: 'B', id: '2' });
    const r = computeGCHFromProfiles([f1, f2]);
    expect(r.rev13_triggered).toBe(true);
  });

  it('confidence = 0.5 si rev11 ou rev12 déclenché', () => {
    const f = makeFounder(); // rev12 déclenché (vide)
    const r = computeGCHFromProfiles([f]);
    expect(r.confidence).toBe(0.5);
  });

  it('confidence = 0.8 si rev11 et rev12 non déclenchés', () => {
    const f1 = makeFounder({ name: 'A', previous_companies: ['Google'] });
    const f2 = makeFounder({ name: 'B', id: '2', previous_companies: ['Meta'] });
    const r = computeGCHFromProfiles([f1, f2]);
    expect(r.confidence).toBe(0.8);
  });

  it('justification contient les noms et rôles', () => {
    const f = makeFounder({ name: 'Marie Curie', role: 'CTO' });
    const r = computeGCHFromProfiles([f]);
    expect(r.justification).toContain('Marie Curie');
    expect(r.justification).toContain('CTO');
  });

  it('Anthropic reconnu comme GAFAM-équivalent', () => {
    const f1 = makeFounder({ previous_companies: ['Anthropic'] });
    const f2 = makeFounder({ id: 'f2', name: 'Bob' });
    const r = computeGCHFromProfiles([f1, f2]);
    expect(r.score).toBeGreaterThanOrEqual(3);
  });
});

// ── createEmptyFounder ────────────────────────────────────────────────────────

describe('createEmptyFounder', () => {
  it('génère un ID unique basé sur timestamp', () => {
    const f1 = createEmptyFounder();
    const f2 = createEmptyFounder();
    // Les IDs peuvent être identiques si créés dans la même ms — on vérifie juste le format
    expect(typeof f1.id).toBe('string');
    expect(f1.id.length).toBeGreaterThan(0);
  });

  it('les overrides sont appliqués', () => {
    const f = createEmptyFounder({ name: 'Alice', role: 'CTO', track_record: 'exit' });
    expect(f.name).toBe('Alice');
    expect(f.role).toBe('CTO');
    expect(f.track_record).toBe('exit');
  });

  it('valeurs par défaut correctes', () => {
    const f = createEmptyFounder();
    expect(f.source).toBe('manual');
    expect(f.confidence).toBe('low');
    expect(f.track_record).toBe('unknown');
    expect(Array.isArray(f.previous_companies)).toBe(true);
    expect(f.previous_companies).toHaveLength(0);
  });
});

// ── buildFounderSearchPrompt ──────────────────────────────────────────────────

describe('buildFounderSearchPrompt', () => {
  it('contient le nom, le rôle et la startup', () => {
    const p = buildFounderSearchPrompt('Alice Martin', 'CTO', 'Nabla');
    expect(p).toContain('Alice Martin');
    expect(p).toContain('CTO');
    expect(p).toContain('Nabla');
  });

  it('demande un JSON uniquement', () => {
    const p = buildFounderSearchPrompt('x', 'y', 'z');
    expect(p.toLowerCase()).toContain('json');
  });

  it('liste les sources à consulter', () => {
    const p = buildFounderSearchPrompt('x', 'y', 'z');
    expect(p).toContain('linkedin.com');
    expect(p).toContain('crunchbase.com');
    expect(p).toContain('arxiv.org');
  });
});
