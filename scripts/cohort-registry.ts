import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Registre de cohorte prospective.
 * À créer dans scripts/cohort-registry.ts
 * À appeler dès qu'un dossier pilote est noté.
 */
export interface ProspectiveCohortEntry {
  startup_id:        string;
  scoring_date:      string;       // ISO — date de gel des poids
  iro_score:         number;
  iro_cr_score:      number;
  betas_version:     string;       // hash du fichier cox-betas-calibrated.json
  weights_version:   string;       // version iro-weights-v4.3.json
  horizon_mois:      36;           // horizon de suivi fixé à 36 mois
  followup_due_date: string;       // scoring_date + 36 mois
  outcome_observed:  null | { event: 0 | 1; t_event_mois: number; observation_date: string };
  pilot_client:      string;       // ex : 'Tudigo'
  osf_registration_url?: string;   // URL OSF une fois pré-enregistré
}

export function computeFileHash(filePath: string): string {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    const content = fs.readFileSync(fullPath);
    return 'sha256-' + crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return 'sha256-uncalibrated-fallback';
  }
}

export function createProspectiveCohortEntry(
  startupId: string,
  iroScore: number,
  iroCrScore: number,
  pilotClient: string,
  betasPath = 'src/config/cox-betas-calibrated.json',
): ProspectiveCohortEntry {
  const scoringDate = new Date().toISOString().split('T')[0];
  const secIn36Months = 36 * 30 * 24 * 3600 * 1000;
  const followupDate = new Date(Date.now() + secIn36Months).toISOString().split('T')[0];

  const betasHash = computeFileHash(betasPath);

  return {
    startup_id:        startupId,
    scoring_date:      scoringDate,
    iro_score:         iroScore,
    iro_cr_score:      iroCrScore,
    betas_version:     betasHash,
    weights_version:   'v4.3',
    horizon_mois:      36,
    followup_due_date: followupDate,
    outcome_observed:  null,
    pilot_client:      pilotClient,
  };
}

/**
 * Enregistre de manière persistante l'entrée prospective dans le registre JSON de la cohorte prospective.
 */
export function registerProspectiveEntry(entry: ProspectiveCohortEntry, registryRelativePath = 'public/config/prospective-cohort.json'): void {
  const registryPath = path.join(process.cwd(), registryRelativePath);
  const dirPath = path.dirname(registryPath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  let cohort: ProspectiveCohortEntry[] = [];
  if (fs.existsSync(registryPath)) {
    try {
      cohort = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    } catch {
      cohort = [];
    }
  }

  const existingIndex = cohort.findIndex(e => e.startup_id === entry.startup_id);
  if (existingIndex >= 0) {
    cohort[existingIndex] = entry;
  } else {
    cohort.push(entry);
  }

  fs.writeFileSync(registryPath, JSON.stringify(cohort, null, 2), 'utf8');
  console.log(`✅ Dossier prospective enregistré sous startup_id: ${entry.startup_id} (${entry.pilot_client})`);
}
