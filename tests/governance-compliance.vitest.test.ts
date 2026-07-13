import { describe, it, expect, vi } from 'vitest';
import { createContestation, loadContestations, saveContestation, updateContestationStatus } from '../src/utils/recours-registry';
import { evaluateHumanReviewGate, COMMUNICATION_GLOSSARY } from '../src/utils/investor-report-generator';
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.join(process.cwd(), 'src');

describe('Gouvernance F3 — Processus de Recours', () => {
  it('F3.1 - createContestation génère un ID prédictif unique et un SLA à 30 jours', () => {
    const startupId = 'startup-xyz';
    const score = { iro: 45, iro_cr: 38, quadrant: 'Embryon Solide' };
    const reason = 'La dépendance infrastructurelle a été surévaluée due à notre migration AWS propre.';
    const evidenceUrls = ['https://evidence.example.com/sys-architecture.pdf'];

    const entry = createContestation(startupId, score, reason, evidenceUrls);

    expect(entry.id).toContain('CONTEST-');
    expect(entry.startup_id).toBe(startupId);
    expect(entry.reason).toBe(reason);
    expect(entry.evidence_urls).toEqual(evidenceUrls);
    expect(entry.status).toBe('pending');
    expect(entry.reviewer).toBeNull();

    // Vérification du SLA de 30 jours
    const subDate = new Date(entry.submission_date);
    const slaDate = new Date(entry.sla_due_date);
    const diffMs = slaDate.getTime() - subDate.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  it('F3.2 - saveContestation et loadContestations gèrent la persistance immuable', () => {
    const startupId = 'gs-096';
    const score = { iro: 52, iro_cr: 44, quadrant: 'Forteresse' };
    const reason = 'Justification de test de persistance.';
    
    const entry = createContestation(startupId, score, reason);
    saveContestation(entry);

    const activeList = loadContestations();
    const found = activeList.find(e => e.id === entry.id);
    expect(found).toBeDefined();
    expect(found?.reason).toBe(reason);
  });

  it('F3.3 - updateContestationStatus modifie correctement l\'état d\'un recours', () => {
    const startupId = 'gs-001';
    const score = { iro: 62, iro_cr: 54, quadrant: 'Forteresse' };
    const entry = createContestation(startupId, score, 'Review de test');
    saveContestation(entry);

    const updated = updateContestationStatus(entry.id, 'resolved_modified', 'Reviewer-1', 'Recours légitime, score réévalué.');
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('resolved_modified');
    expect(updated?.reviewer).toBe('Reviewer-1');
    expect(updated?.outcome_note).toBe('Recours légitime, score réévalué.');
    expect(updated?.review_date).toBeDefined();
  });
});

describe('Gouvernance F4 — Supervision Humaine & Glossaire Communautaire', () => {
  it('F4.1 - evaluateHumanReviewGate lève une alerte si IRO-CR < 30', () => {
    const lowIroCr = 28;
    const flags: string[] = [];

    const gate = evaluateHumanReviewGate(lowIroCr, flags);

    expect(gate.requires_review).toBe(true);
    expect(gate.trigger_reason).toContain('seuil 30');
    expect(gate.review_status).toBe('pending');
  });

  it('F4.2 - evaluateHumanReviewGate lève une alerte en présence de flags critiques', () => {
    const goodIroCr = 42;
    const flags = ['DI = 0 — REV1 activée'];

    const gate = evaluateHumanReviewGate(goodIroCr, flags);

    expect(gate.requires_review).toBe(true);
    expect(gate.trigger_reason).toContain('Flags critiques');
    expect(gate.review_status).toBe('pending');
  });

  it('F4.3 - evaluateHumanReviewGate ne lève pas d\'alerte si scores dans la norme et sans flags', () => {
    const safeIroCr = 55;
    const flags: string[] = [];

    const gate = evaluateHumanReviewGate(safeIroCr, flags);

    expect(gate.requires_review).toBe(false);
    expect(gate.trigger_reason).toBeNull();
    expect(gate.review_status).toBe('not_required');
  });

  it('F4.4 - Le glossaire éthique bannit les termes catastrophistes', () => {
    expect(COMMUNICATION_GLOSSARY.FORBIDDEN_critique).toBe('"probabilité de faillite"');
    expect(COMMUNICATION_GLOSSARY.ALLOWED_critique).toBe('"signal structurel de risque élevé"');
    expect(COMMUNICATION_GLOSSARY.FORBIDDEN_red_zone).toBe('"startup en danger"');
    expect(COMMUNICATION_GLOSSARY.ALLOWED_red_zone).toBe('"startup en Zone Rouge — consolidation opérationnelle recommandée"');
  });

  it('E3 — logger.ts configure redact pino', () => {
    const src = fs.readFileSync(path.join(SRC_ROOT, 'utils/logger.ts'), 'utf8');
    expect(src).toMatch(/redact/);
    expect(src).toMatch(/REDACTED/);
    expect(src).toMatch(/rawResponse|pitchDeck|llmResponse/);
  });

  it('E3 — logger.ts aligne la rétention RGPD', () => {
    const src = fs.readFileSync(path.join(SRC_ROOT, 'utils/logger.ts'), 'utf8');
    expect(src).toMatch(/r[eé]tention|retention|30.jours|RGPD/i);
  });

  it('Recours JSON — pas de doublons d\'IDs', () => {
    const entries = JSON.parse(fs.readFileSync('data/iro-recours.json', 'utf8'));
    const ids = entries.map((e: any) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
