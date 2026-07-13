import { Router, Request, Response, NextFunction } from 'express';
import llmRouter from './apiLLM.routes';
import pappersRouter from './apiPappers.routes';
import collectorsRouter from './apiCollectors.routes';

import { getMetrics, getPrometheusMetrics } from '../../src/utils/llm-metrics';
import * as AuditJournal from '../../src/utils/audit-journal';
import { db } from '../db';
import { logger } from '../../src/utils/logger';
import { listPrompts, REGISTRY_VERSION } from '../../src/prompts/registry';
import { createContestation, saveContestation } from '../../src/utils/recours-registry';
import { getQuadrant } from '../../src/utils/iro-engine';

import { apiKeyAuth } from '../middleware/apiKeyAuth';

const router = Router();

// CORRECTIF AUDIT SEC-06 : l'authentification par clé API (si INTERNAL_API_KEY est
// définie) couvre désormais TOUTES les routes sensibles — journal d'audit, base
// startups, pipelines de collecte, contestations — et non plus seulement /llm.
// /health et /metrics restent publics (sondes de supervision).
/**
 * MODE DÉMO PUBLIQUE (PUBLIC_DEMO=true) — protection de la clé LLM.
 *
 * Sur un déploiement exposé à Internet (Hugging Face Space, démo publique), le
 * front appelle /api/llm sans clé d'API. Sans garde-fou, n'importe quel visiteur
 * peut consommer le quota Gemini — aux frais du propriétaire.
 *
 * PUBLIC_DEMO=true neutralise les routes qui consomment le LLM ou des API
 * payantes, tout en laissant l'application consultable : cohorte de validation,
 * métriques, journal d'audit, scores déjà calculés restent accessibles.
 * C'est ce qu'un évaluateur (Bpifrance, investisseur) a besoin de voir.
 */
const COSTLY_PREFIXES = ['/llm', '/pappers'];

router.use((req, res, next) => {
  const publicPaths = ['/health', '/metrics', '/metrics/llm'];
  if (publicPaths.includes(req.path)) return next();

  if (process.env.PUBLIC_DEMO === 'true' && COSTLY_PREFIXES.some(p => req.path.startsWith(p))) {
    return res.status(503).json({
      error: 'Mode démonstration publique',
      message: "Le scoring assisté par LLM est désactivé sur cette instance publique afin de " +
               "protéger les quotas du fournisseur. Les résultats déjà calculés, la cohorte de " +
               "validation (n=442) et le journal d'audit restent consultables.",
      reproduire: 'npx tsx scripts/validate-cohorte-n442.ts → AUC 0.930 [IC 0.870–0.970]',
      contact: "Pour une démonstration complète avec scoring en direct, demander un accès dédié.",
    });
  }

  return apiKeyAuth(req, res, next);
});

// Modular Sub-routers
router.use('/llm', llmRouter);
router.use('/pappers', pappersRouter);
router.use('/', collectorsRouter);

// ── API Health ──────────────────────────────────────────────────────────
router.get('/health', (_req: Request, res: Response) => {
  const providers = {
    gemini: !!process.env.GEMINI_API_KEY,
  };
  const health = {
    status: providers.gemini ? 'ok' : 'degraded',
    version: process.env.VITE_APP_VERSION ?? process.env.npm_package_version ?? '7.0.0',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    providers,
    // B1 : visibilité du prompt registry
    promptRegistry: {
      version:  REGISTRY_VERSION,
      prompts:  listPrompts(),
    },
  };
  // CORRECTIF AUDIT PROD-02 — Sonde de vitalité et mode démo.
  // /api/health renvoyait 503 dès que la clé Gemini était absente. Or les
  // plateformes d'hébergement (Hugging Face, Cloud Run, Fly…) utilisent cette
  // route pour décider si le conteneur est vivant : un 503 permanent le fait
  // redémarrer en boucle, puis marquer en échec.
  //
  // En mode démonstration publique (PUBLIC_DEMO=true), l'absence de clé LLM est
  // le comportement ATTENDU, pas une panne : le service répond 200 et signale
  // simplement que le scoring en direct est désactivé.
  const demoMode = process.env.PUBLIC_DEMO === 'true';
  const healthy = demoMode || providers.gemini;
  return res.status(healthy ? 200 : 503).json({
    ...health,
    mode: demoMode ? 'demo_public' : 'full',
    llm_scoring: demoMode ? 'désactivé (démo publique)' : (providers.gemini ? 'actif' : 'clé manquante'),
  });
});

// ── API Metrics ─────────────────────────────────────────────────────────
router.get('/metrics', (req, res) => {
  if (req.headers.accept?.includes('text/plain') || req.query.format === 'prometheus') {
    res.set('Content-Type', 'text/plain');
    return res.send(getPrometheusMetrics());
  }
  return res.json(getMetrics());
});

router.get('/metrics/llm', (req, res) => {
  return res.json(getMetrics());
});

// ── API Audit Journal ──────────────────────────────────────────────────
router.post('/audit', (req, res) => {
  try {
    const id = AuditJournal.addEntry(req.body);
    res.json({ success: true, id });
  } catch (error) {
    console.error('Erreur API Audit POST:', error);
    res.status(500).json({ error: 'Erreur lors de l\'ajout au journal' });
  }
});

router.get('/audit', (req, res) => {
  try {
    const filters = {
      status: req.query.status as any,
      evaluator: req.query.evaluator as string,
      min_iro: req.query.min_iro ? Number(req.query.min_iro) : undefined,
      max_iro: req.query.max_iro ? Number(req.query.max_iro) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      startup: req.query.startup as string,
    };
    res.json(AuditJournal.getEntries(filters));
  } catch (error) {
    console.error('Erreur API Audit GET:', error);
    res.status(500).json({ error: 'Erreur lors de la lecture du journal' });
  }
});

router.get('/startups/:name/memory', (req, res) => {
  try {
    const entries = AuditJournal.getEntries({ limit: 50, startup: req.params.name })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    res.json({ entries, n: entries.length });
  } catch (err) {
    console.error('Erreur API startups memory:', err);
    res.status(500).json({ error: 'Erreur mémoire' });
  }
});

router.get('/audit/stats', (req, res) => {
  try {
    res.json(AuditJournal.getStats());
  } catch (error) {
    console.error('Erreur API Audit Stats:', error);
    res.status(500).json({ error: 'Erreur lors du calcul des stats' });
  }
});

router.get('/audit/csv', (req, res) => {
  try {
    const csv = AuditJournal.exportCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=iro-audit-journal.csv');
    res.send(csv);
  } catch (error) {
    console.error('Erreur API Audit CSV:', error);
    res.status(500).json({ error: 'Erreur lors de l\'export CSV' });
  }
});

// GET /api/audit/verify — démonstration live pour le jury
router.get('/audit/verify', (_req, res) => {
  try {
    const result = AuditJournal.verifyChainIntegrity();
    res.json(result);
  } catch (err) {
    console.error('Erreur API /audit/verify:', err);
    res.status(500).json({ error: 'Vérification impossible', detail: String(err) });
  }
});

// ── API Database : Liste des startups ─────────────────────────────────
router.get('/startups', (req, res) => {
  try {
    const startups = db.prepare('SELECT * FROM startups ORDER BY created_at DESC').all();
    res.json(startups);
  } catch (error) {
    console.error('Erreur API Startups:', error);
    res.status(500).json({ error: 'Erreur Database' });
  }
});

// ── F3 — Processus de recours de score ────────────────────────────────
router.post('/contest', (req, res) => {
  try {
    const { startup_id, reason, evidence_urls } = req.body;
    if (!startup_id || !reason) {
      return res.status(400).json({ error: 'startup_id et reason sont requis.' });
    }

    // Recherche d'un score d'audit pour cette startup afin de pré-remplir l'évaluation contestée
    const matchingEntries = AuditJournal.getEntries({ startup: startup_id });
    let iro = 50.0;
    let iro_cr = 42.5;
    let srd = 30.0;

    if (matchingEntries && matchingEntries.length > 0) {
      const entry = matchingEntries[0];
      iro = entry.iro_total;
      iro_cr = entry.iro_cr ?? (entry.iro_total * 0.85);
      srd = entry.srd ?? 30.0;
    }

    const quadrant = getQuadrant(iro, srd);

    const contestation = createContestation(
      startup_id,
      { iro, iro_cr, quadrant },
      reason,
      evidence_urls || []
    );

    saveContestation(contestation);

    logger.info(`[F3-Recours] Nouvelle contestation enregistrée pour la startup ${startup_id} (ID: ${contestation.id})`);

    return res.status(201).json(contestation);
  } catch (error: any) {
    console.error('Erreur POST /api/contest:', error);
    return res.status(500).json({ error: 'Erreur lors du traitement de la contestation.', details: error?.message });
  }
});

export default router;
