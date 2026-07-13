/**
 * src/utils/recours-registry.ts
 * Recours Registry for IRO Strength Velocity
 * Handles recourse submissions for contested scores SLA 30 days.
 */

import fs from 'fs';
import { logger } from './logger';
import path from 'path';

export interface ContestationEntry {
  id:              string;
  startup_id:      string;
  submission_date: string;
  score_contested: { iro: number; iro_cr: number; quadrant: string };
  reason:          string;
  evidence_urls:   string[];
  status:          'pending' | 'under_review' | 'resolved_upheld' | 'resolved_modified';
  reviewer:        string | null;
  review_date:     string | null;
  outcome_note:    string | null;
  sla_due_date:    string;   // submission_date + 30 jours
}

export function createContestation(
  startupId: string,
  score: { iro: number; iro_cr: number; quadrant: string },
  reason: string,
  evidenceUrls: string[] = [],
): ContestationEntry {
  const now = new Date();
  const sla = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  return {
    id:              `CONTEST-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${startupId.slice(-4).toUpperCase()}`,
    startup_id:      startupId,
    submission_date: now.toISOString(),
    score_contested: score,
    reason,
    evidence_urls:   evidenceUrls,
    status:          'pending',
    reviewer:        null,
    review_date:     null,
    outcome_note:    null,
    sla_due_date:    sla.toISOString(),
  };
}

// Expose dans l'API — route à créer : POST /api/contest
export const CONTESTATION_ENDPOINT_SPEC = {
  method:  'POST',
  path:    '/api/contest',
  body:    '{ startup_id, reason, evidence_urls? }',
  returns: 'ContestationEntry',
  sla:     '30 jours calendaires pour résolution',
};

// ── Persistence ───────────────────────────────────────────────────────────
const storePath = path.join(process.cwd(), 'data', 'iro-recours.json');

function ensureDirExists() {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Charge le registre depuis le JSON, déduplique par ID (garde le plus récent).
 */
export function loadRecours(): ContestationEntry[] {
  try {
    ensureDirExists();
    if (!fs.existsSync(storePath)) return [];
    const raw: ContestationEntry[] = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    // Déduplication : Map par ID, last-write-wins (ordre de l'array)
    const map = new Map<string, ContestationEntry>();
    for (const entry of raw) {
      map.set(entry.id, entry);
    }
    return Array.from(map.values()).sort(
      (a, b) => a.submission_date.localeCompare(b.submission_date)
    );
  } catch (err) {
    logger.error('Error loading recours:', { error: String(err) });
    return [];
  }
}

/**
 * Sauvegarde le registre en écrasant le fichier — pas d'append.
 * Déduplique avant écriture.
 */
export function saveRecours(entries: ContestationEntry[]): void {
  try {
    ensureDirExists();
    // Déduplication défensive
    const map = new Map<string, ContestationEntry>();
    for (const e of entries) map.set(e.id, e);
    const deduped = Array.from(map.values()).sort(
      (a, b) => a.submission_date.localeCompare(b.submission_date)
    );

    fs.writeFileSync(storePath, JSON.stringify(deduped, null, 2), 'utf8');
  } catch (err) {
    logger.error('Error saving recours:', { error: String(err) });
  }
}

/**
 * Ajoute une contestation (sans dupliquer si l'ID existe déjà).
 */
export function addContestation(entry: ContestationEntry): void {
  const existing = loadRecours();
  // Remplacer si l'ID existe, sinon ajouter
  const idx = existing.findIndex(e => e.id === entry.id);
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }
  saveRecours(existing);
}

/**
 * Alias compatibilité ascendante pour charger les contestations.
 */
export function loadContestations(): ContestationEntry[] {
  return loadRecours();
}

/**
 * Alias compatibilité ascendante pour sauvegarder une contestation.
 */
export function saveContestation(entry: ContestationEntry): void {
  addContestation(entry);
}

/**
 * Met à jour le statut d'une contestation existante.
 * Gère de manière polymorphique l'ancienne et la nouvelle signature de fonction.
 */
export function updateContestationStatus(
  id: string,
  statusOrUpdate: ContestationEntry['status'] | Partial<Pick<ContestationEntry, 'status' | 'reviewer' | 'review_date' | 'outcome_note'>>,
  reviewer?: string,
  outcomeNote?: string,
): ContestationEntry | null {
  try {
    const entries = loadRecours();
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) return null;

    if (typeof statusOrUpdate === 'string') {
      // Ancienne signature
      entries[idx] = {
        ...entries[idx],
        status: statusOrUpdate,
        reviewer: reviewer ?? null,
        review_date: new Date().toISOString(),
        outcome_note: outcomeNote ?? null,
      };
    } else {
      // Nouvelle signature (objet d'update partiel)
      entries[idx] = {
        ...entries[idx],
        ...statusOrUpdate,
      };
    }

    saveRecours(entries);
    return entries[idx];
  } catch (err) {
    logger.error('Error updating contestation status:', { error: String(err) });
    return null;
  }
}

/**
 * SCRIPT DE NETTOYAGE IMMÉDIAT — exécuter une fois pour corriger data/iro-recours.json
 */
export function cleanRecoursJson(): void {
  const entries = loadRecours(); // loadRecours déduplique automatiquement
  saveRecours(entries);
  logger.info(`✅ iro-recours.json nettoyé : ${entries.length} entrées uniques conservées`);
}
