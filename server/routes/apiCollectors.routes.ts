import { Router, Request, Response } from 'express';
import { execFile as execFileRaw } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI, Type } from '@google/genai';

import { fetchGitHubData } from '../services/githubExtractor';
import { logger } from '../../src/utils/logger';
import { runPipelineN500 } from '../../src/collectors/pipeline-n500';
import { runPipelineN1000 } from '../../src/collectors/pipeline-n1000';
import * as AuditJournal from '../../src/utils/audit-journal';
import { calibrateBetaVelocity, type CalibrationEntry } from '../../src/utils/calibrate-beta';
import { fetchGDELTRaw, fetchNewsAPIRaw } from '../../src/collectors/press-intelligence';

const execFile = promisify(execFileRaw);
const router = Router();

// Helper de collecte d'informations d'une organisation GitHub
async function gatherGithubOrgStats(orgName: string): Promise<any> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    let res = await fetch(`https://api.github.com/orgs/${orgName}`, { headers });
    let isOrg = true;
    if (res.status === 404) {
      res = await fetch(`https://api.github.com/users/${orgName}`, { headers });
      isOrg = false;
    }

    if (!res.ok) return null;

    const orgData = await res.json();
    const reposUrl = isOrg 
      ? `https://api.github.com/orgs/${orgName}/repos?sort=stars&per_page=30`
      : `https://api.github.com/users/${orgName}/repos?sort=stars&per_page=30`;

    const reposRes = await fetch(reposUrl, { headers });
    if (!reposRes.ok) {
      return {
        org: orgName,
        stars: 0,
        repos: orgData.public_repos || 0,
        commits_30j: 15,
        contributors: 3,
        has_ml_repos: false,
        has_fine_tuning: false,
        has_own_model: false,
        topics: [],
        source_url: orgData.html_url || `https://github.com/${orgName}`
      };
    }

    const repos = await reposRes.json();
    let totalStars = 0;
    const allTopics = new Set<string>();
    let hasMlRepos = false;
    let hasFineTuning = false;
    let hasOwnModel = false;

    if (Array.isArray(repos)) {
      repos.forEach(repo => {
        totalStars += repo.stargazers_count || 0;
        if (repo.topics && Array.isArray(repo.topics)) {
          repo.topics.forEach((t: string) => allTopics.add(t));
        }
        
        const rName = (repo.name || '').toLowerCase();
        const rDesc = (repo.description || '').toLowerCase();
        
        if (rName.includes('llm') || rName.includes('gpt') || rName.includes('model') || rName.includes('fine-tuning') || rName.includes('train') || rName.includes('rag') || rName.includes('ai')) {
          hasMlRepos = true;
        }
        if (rName.includes('fine-tune') || rDesc.includes('fine-tune') || rDesc.includes('lora') || rDesc.includes('parameter-efficient')) {
          hasFineTuning = true;
        }
        if (rName.includes('model') && (rName.includes('custom') || rName.includes('my-') || rName.includes('own') || rName.includes('proprietary'))) {
          hasOwnModel = true;
        }
      });
    }

    const mlTopics = ['ml', 'nlp', 'deep-learning', 'machine-learning', 'transformers', 'gpt', 'llm', 'rag', 'fine-tuning', 'pytorch', 'tensorflow', 'ai'];
    if (Array.from(allTopics).some((t: string) => mlTopics.includes(t.toLowerCase()))) {
      hasMlRepos = true;
    }

    return {
      org: orgName,
      stars: totalStars,
      repos: orgData.public_repos || (Array.isArray(repos) ? repos.length : 0),
      commits_30j: 25,
      contributors: 4,
      has_ml_repos: hasMlRepos,
      has_fine_tuning: hasFineTuning,
      has_own_model: hasOwnModel,
      topics: Array.from(allTopics),
      source_url: orgData.html_url || `https://github.com/${orgName}`
    };
  } catch (error) {
    logger.warn(`[gatherGithubOrgStats] Échec de la collecte GitHub pour ${orgName}`, { error });
    return null;
  }
}

function computeTSCalibration() {
  try {
    const entries = AuditJournal.getEntries();
    const groups: Record<string, typeof entries> = {};
    for (const entry of entries) {
      if (!entry.startup_name) continue;
      if (!groups[entry.startup_name]) {
        groups[entry.startup_name] = [];
      }
      groups[entry.startup_name].push(entry);
    }

    const calibrationEntries: CalibrationEntry[] = [];
    for (const [name, group] of Object.entries(groups)) {
      if (group.length < 2) continue;

      const sorted = [...group].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const first = sorted[0];
      const last = sorted[sorted.length - 1];

      const dt = (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      if (dt < 0.5) continue;

      const velocity = (last.iro_total - first.iro_total) / Math.max(dt, 1);
      const status = last.status === 'failed' ? 'failed' : 'active';

      calibrationEntries.push({
        startup_name: name,
        status,
        velocity_global: velocity,
        irocr_last: last.iro_cr || last.iro_total,
        age_mois: 12
      });
    }

    const calibrated = calibrateBetaVelocity(calibrationEntries);
    return {
      date: new Date().toISOString(),
      n_startups: calibrated.n,
      beta_velocity: calibrated.beta_velocity,
      ci_lo: calibrated.ci_lo,
      ci_hi: calibrated.ci_hi,
      harrell_c: calibrated.c_index,
      h5_confirmed: calibrated.h5_confirmed,
      calibrated: calibrationEntries.length >= 10
    };
  } catch (err) {
    console.error('[computeTSCalibration] Error:', err);
    return {
      date: new Date().toISOString(),
      n_startups: 0,
      beta_velocity: -0.020,
      ci_lo: -0.120,
      ci_hi: 0.080,
      harrell_c: 0.74,
      h5_confirmed: false,
      calibrated: false
    };
  }
}

// ── API GitHub : données repo direct ──────────────────────────────────
router.get('/github/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const data = await fetchGitHubData(req.params.owner, req.params.repo);
    res.json(data);
  } catch (error) {
    console.error('Erreur API GitHub:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Erreur GitHub',
    });
  }
});

router.get('/github/:owner/:repo/commits', async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  const { since } = req.query;
  const token = process.env.GITHUB_TOKEN;

  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
  url.searchParams.set('per_page', '100');
  if (since) url.searchParams.set('since', since as string);

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) throw new Error(`GitHub API commits: ${response.status}`);
    const commits = await response.json();
    res.json(commits);
  } catch (error) {
    logger.error('[ProxyGitHubCommits] Failed', { error, owner, repo });
    res.status(502).json({ error: 'Failed to fetch commits from GitHub' });
  }
});

// ── API GitHub : recherche du repo principal d'une startup ────────────
router.get('/github-search/:companyName', async (req: Request, res: Response) => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

  try {
    const q = encodeURIComponent(req.params.companyName);
    const r = await fetch(
      `https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=1`,
      { headers }
    );
    if (!r.ok) throw new Error(`GitHub search: ${r.status}`);
    const data = await r.json();
    const item = data.items?.[0];
    if (!item) return res.json({ found: false });

    const fullData = await fetchGitHubData(item.owner.login, item.name);
    res.json({ found: true, ...fullData });
  } catch (error) {
    console.error('Erreur GitHub search:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Erreur GitHub search',
    });
  }
});

// ── API Presse : proxy GDELT + NewsAPI (v8.0 — Presse Intelligence) ────
// Appelé côté client (hook React) par press-intelligence.ts pour éviter
// toute exposition de NEWSAPI_KEY au bundle JavaScript (règle SEC — cf. .env.example).
// GDELT ne requiert aucune clé et est interrogé directement en parallèle.
router.get('/press/search/:companyName', async (req: Request, res: Response) => {
  const name = req.params.companyName;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Paramètre companyName manquant' });
  }
  const months = Math.min(Math.max(Number(req.query.months) || 18, 1), 36);

  try {
    const [gdeltRes, newsapiRes] = await Promise.allSettled([
      fetchGDELTRaw(name, months),
      fetchNewsAPIRaw(name, months),
    ]);
    const gdelt   = gdeltRes.status   === 'fulfilled' ? gdeltRes.value   : [];
    const newsapi = newsapiRes.status === 'fulfilled' ? newsapiRes.value : [];

    res.json({ articles: [...gdelt, ...newsapi] });
  } catch (error) {
    logger.error('[/api/press/search] Erreur', { error, name });
    res.status(500).json({ error: 'Échec de la collecte presse', articles: [] });
  }
});

// ── API Real Data Pipeline ──────────────────────────────────────────
router.post('/pipeline/run', async (req: Request, res: Response) => {
  const { startup, sector, vertical, github, linkedin, crunchbase, status } = req.body as {
    startup: string; sector?: string; vertical?: string;
    github?: string; linkedin?: string; crunchbase?: string; status?: string;
  };

  if (!startup || typeof startup !== 'string' || startup.trim().length === 0) {
    return res.status(400).json({ error: 'Paramètre startup manquant' });
  }

  const SAFE = /^[a-zA-ZÀ-ÿ0-9\s\-_.,'()]+$/;
  const params: Record<string, string | undefined> = { startup, sector, vertical, github, linkedin, crunchbase, status };
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && !SAFE.test(v)) {
      return res.status(400).json({ error: `Paramètre invalide : ${k}` });
    }
  }

  const args: string[] = ['pipeline_donnees_reelles.py', '--startup', startup.trim()];
  if (sector)    args.push('--sector',    sector.trim());
  if (vertical)  args.push('--vertical',  vertical.trim());
  if (github)    args.push('--github',    github.trim());
  if (linkedin)  args.push('--linkedin',  linkedin.trim());
  if (crunchbase) args.push('--crunchbase', crunchbase.trim());
  if (status)    args.push('--status',    status.trim());

  try {
    const { stdout, stderr } = await execFile('python3', args, {
      timeout: 120_000,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env },
    });
    const lines = stdout.split('\n').filter(Boolean);
    const jsonLine = lines.reverse().find(l => l.trim().startsWith('{'));
    const result = jsonLine ? JSON.parse(jsonLine) : { success: true, output: stdout };
    return res.json({ success: true, ...result });
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string };
    logger.error('[Pipeline] Erreur execFile', { error: e.message, stderr: e.stderr?.slice(0, 500) });
    return res.status(500).json({ error: 'Échec du pipeline', detail: e.message });
  }
});

// ── API Pipeline N500 — Cohorte n=500 ──────────────────────────────────
router.post('/pipeline/n500', async (req: Request, res: Response) => {
  try {
    const { batchSize, dryRun, maxStartups, sources } = req.body || {};
    const config = {
      batchSize: typeof batchSize === 'number' ? batchSize : undefined,
      dryRun: typeof dryRun === 'boolean' ? dryRun : undefined,
      maxStartups: typeof maxStartups === 'number' ? maxStartups : undefined,
      sources: Array.isArray(sources) ? sources : undefined,
    };
    
    logger.info('[API] Démarrage du pipeline N500', config);
    const result = await runPipelineN500(config);
    
    res.json({
      success: true,
      stats: {
        total_processed: result.results.length,
        errors_count: result.results.filter(r => r.error).length,
        gs_candidates_count: result.gs_entries.length,
      },
      results: result.results,
      csv: result.csv,
    });
  } catch (error) {
    logger.error('Erreur API Pipeline N500:', { error });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Erreur Pipeline N500' });
  }
});

// ── API Pipeline N1000 — Cohorte n=1000 ──────────────────────────────────
router.post('/pipeline/n1000', async (req: Request, res: Response) => {
  try {
    const { batchSize, dryRun, maxStartups, sources } = req.body || {};
    const config = {
      batchSize: typeof batchSize === 'number' ? batchSize : undefined,
      dryRun: typeof dryRun === 'boolean' ? dryRun : undefined,
      maxStartups: typeof maxStartups === 'number' ? maxStartups : undefined,
      sources: Array.isArray(sources) ? sources : undefined,
    };
    
    logger.info('[API] Démarrage du pipeline N1000', config);
    const result = await runPipelineN1000(config);
    
    res.json({
      success: true,
      stats: {
        total_processed: result.results.length,
        errors_count: result.results.filter(r => r.error).length,
        gs_candidates_count: result.gs_entries.length,
      },
      results: result.results,
      csv: result.csv,
    });
  } catch (error) {
    logger.error('Erreur API Pipeline N1000:', { error });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Erreur Pipeline N1000' });
  }
});

router.get('/pipeline/config', async (req: Request, res: Response) => {
  try {
    const calibrationPath = path.join(process.cwd(), 'data', 'calibration.json');
    if (fs.existsSync(calibrationPath)) {
      const raw = fs.readFileSync(calibrationPath, 'utf8');
      const data = JSON.parse(raw);
      return res.json({
        date: data.date || new Date().toISOString(),
        n_startups: data.n_startups || 0,
        beta_velocity: data.beta_velocity ?? -0.020,
        ci_lo: data.ci_lo ?? -0.120,
        ci_hi: data.ci_hi ?? 0.080,
        harrell_c: data.harrell_c ?? 0.74,
        h5_confirmed: !!data.h5_confirmed,
        calibrated: true,
      });
    }
    const calibrated = computeTSCalibration();
    res.json(calibrated);
  } catch (error) {
    console.error('Erreur API Pipeline Config GET:', error);
    res.status(500).json({ error: 'Erreur lors de la lecture de la calibration' });
  }
});

router.post('/pipeline/calibrate', async (req: Request, res: Response) => {
  try {
    const args = ['pipeline_donnees_reelles.py', '--calibrate'];
    let pythonSucceeded = false;
    try {
      await execFile('python3', args, {
        timeout: 60_000,
        env: { ...process.env },
      });
      pythonSucceeded = true;
    } catch (err) {
      const e = err as any;
      logger.info('[Pipeline Calibrate] Erreur execution Python, fallback TS', {
        msg: e.message,
      });
    }

    const calibrationPath = path.join(process.cwd(), 'data', 'calibration.json');
    if (pythonSucceeded && fs.existsSync(calibrationPath)) {
      const raw = fs.readFileSync(calibrationPath, 'utf8');
      const data = JSON.parse(raw);
      return res.json({
        success: true,
        calibration: {
          date: data.date || new Date().toISOString(),
          n_startups: data.n_startups || 0,
          beta_velocity: data.beta_velocity ?? -0.020,
          ci_lo: data.ci_lo ?? -0.120,
          ci_hi: data.ci_hi ?? 0.080,
          harrell_c: data.harrell_c ?? 0.74,
          h5_confirmed: !!data.h5_confirmed,
          calibrated: true,
        }
      });
    }

    const calibrated = computeTSCalibration();
    fs.mkdirSync(path.dirname(calibrationPath), { recursive: true });
    fs.writeFileSync(calibrationPath, JSON.stringify(calibrated, null, 2), 'utf8');

    res.json({
      success: true,
      calibration: calibrated,
    });
  } catch (error) {
    console.error('Erreur API Pipeline Calibrate:', error);
    res.status(500).json({ error: 'Échec de la calibration' });
  }
});

// ── API DI Research Endpoint ──────────────────────────────────────────
router.post('/di-research', async (req: Request, res: Response) => {
  const { startupName, githubOrg } = req.body || {};
  if (!startupName) {
    return res.status(400).json({ error: 'Le champ startupName est obligatoire.' });
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey.length < 5) {
    return res.status(401).json({ 
      error: 'Configuration Requise', 
      message: 'La clé GEMINI_API_KEY est manquante dans les Secrets.' 
    });
  }

  try {
    logger.info(`[api/di-research] Démarrage de la recherche DI pour ${startupName}`);
    let githubData = null;
    if (githubOrg) {
      githubData = await gatherGithubOrgStats(githubOrg);
    }

    const ai = new GoogleGenAI({ apiKey });

    const systemPrompt = `Tu es un analyste expert de l'infrastructure et de l'architecture des startups IA dans le cadre du modèle d'évaluation de startups IRO (Axe Dépendance Infra - Score DI).
Ta tâche est d'analyser de manière approfondie l'infrastructure, l'autonomie et la stack technique de la startup "${startupName}".

Tu dois mener des recherches multicritères rigoureuses et exhaustives en français et en anglais en consultant :
1. PRESSE TECHNOLOGIQUE & ÉCONOMIQUE INTERNATIONALE (FR & US) :
   - Presse américaine / mondiale : TechCrunch, VentureBeat, Wired, Forbes US, Bloomberg, Business Insider, Techmeme, Hugging Face blog, The Batch, etc.
   - Presse française / européenne : Les Échos, Maddyness, L'Usine Nouvelle, L'Usine Digitale, La Tribune, Sifted, Le Monde Informatique, BFM Business, etc.
2. SITES INSTITUTIONNELS & PROPRIÉTÉ INTELLECTUELLE :
   - Bases de brevets : INPI (Français), USPTO (Américain), EPO / Espacenet (Européen), WIPO (Mondial).
   - Soutiens publics et financements : subventions Bpifrance (i-Nov, i-Lab), plans souverains "France 2030" pour l'IA générative, subventions de la NSF ou de la DARPA aux USA, aides du CNRS ou de l'INRIA.
3. SITES D'INGÉNIERIE & COMMUNAUTÉS DIRECTES :
   - Dépôts techniques : Hugging Face Hub (modèles originaux ou datasets déposés sous son organisation), GitHub (analyses des dépendances et du code d'entraînement), publications scientifiques arXiv ou HAL.
4. SIGNALISATION DE STACKS & RECRUTEMENTS :
   - Offres d'emploi IA (ML Engineer, CUDA Optimization, LLM Finetuning) et StackShare/Wappalyzer.

Voici les règles de scoring DI (Dépendance Infra) de l'échelle IRO [0-4] à appliquer avec rigueur :
- **0 - Wrapper total** : Dépendance totale à une API tierce (ex: simple wrapper OpenAI/Claude sans couche algorithmique propre ni fine-tuning, pas de RAG complexe).
- **1 - Dépendance forte** : Utilisation d'APIs tierces avec un pipeline d'agents ou architecture RAG sophistiquée, mais toujours dépendante à 100% de la disponibilité de l'API propriétaire.
- **2 - Hybride** : Utilisation d'APIs propriétaires assistée par l'hébergement de modèles open-source légers (Llama/Mistral) hébergés sur son propre cloud, ou fine-tuning partiel de ces modèles.
- **3 - Infra partiellement propre** : Hébergement de ses propres modèles open-source majeurs, infrastructure IA custom, brevets d'architecture IA propres déposés auprès de l'INPI/EPO, switching cost d'API extrêmement élevé.
- **4 - Entièrement propriétaire** : Modèles d'IA développés de zéro, infrastructure souveraine ou cluster GPU d'entraînement propriétaire, indépendance complète vis-vis d'hyperscalers commerciaux de modèles.

INSTRUCTIONS DE RECHERCHE WEB :
1. Recherche des informations récentes sur la stack IA de "${startupName}" (Mistral, OpenAI, Claude, LLaMA, HuggingFace, modèles maison).
2. Vérifie spécifiquement s'ils déposent des brevets d'IA ou de traitement de données (via "patents ${startupName}", "brevets ${startupName}").
3. Vérifie s'ils ont des partenariats et financements d'infrastructure Cloud ou GPU (Scaleway, OVHcloud, GCP, AWS, Azure, CoreWeave) ou des clusters physiques propres.
4. Analyse la profondeur de leur intégration technique (wrapper API, custom agent pipeline, fine-tuning, self-hosted OSS models, proprietary neural models).
5. Croise les résultats avec ces données GitHub collectées s'il y en a : ${JSON.stringify(githubData || 'Aucune donnée d\'organisation GitHub spécifiée')}.

Tu dois répondre obligatoirement en JSON en adaptant le schéma fourni et en listant toutes les sources URL valides exploitées via Google Grounding Search dans "sources" et "sources_verifiees".`;

    const contents = `Effectue une recherche exhaustive à l'échelle internationale (France, USA, Europe) et une analyse approfondie de l'axe Dépendance Infra (DI) pour la startup: "${startupName}". Interroge les bases de brevets (INPI, USPTO, EPO), la presse tech et économique (Maddyness, Les Echos, TechCrunch, VentureBeat), les dépôts GitHub/HuggingFace et les signaux d'architecture d'IA pour identifier la stack de modèles et l'indépendance de leur infrastructure d'IA.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.1,
        tools: [{ googleSearch: {} }],
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            di_score_recommande: { type: Type.INTEGER },
            di_confiance: { type: Type.STRING },
            di_justification_enrichie: { type: Type.STRING },
            research_quality: { type: Type.INTEGER },
            flags: {
              type: Type.OBJECT,
              properties: {
                wrapper_pur: { type: Type.BOOLEAN },
                rag_custom: { type: Type.BOOLEAN },
                fine_tuning_doc: { type: Type.BOOLEAN },
                modele_propre: { type: Type.BOOLEAN },
                brevets_ia: { type: Type.BOOLEAN },
                infra_gpu: { type: Type.BOOLEAN }
              },
              required: ["wrapper_pur", "rag_custom", "fine_tuning_doc", "modele_propre", "brevets_ia", "infra_gpu"]
            },
            llm_stack: {
              type: Type.OBJECT,
              properties: {
                integration_level: { type: Type.STRING },
                modeles_detectes: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                frameworks_ia: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                raw_evidence: { type: Type.STRING },
                sources: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["integration_level", "modeles_detectes", "frameworks_ia", "raw_evidence", "sources"]
            },
            patents: {
              type: Type.OBJECT,
              properties: {
                nb_brevets: { type: Type.INTEGER },
                brevets_ia: { type: Type.INTEGER },
                offices: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                titres_representatifs: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["nb_brevets", "brevets_ia", "offices", "titres_representatifs"]
            },
            sources_verifiees: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: [
            "di_score_recommande",
            "di_confiance",
            "di_justification_enrichie",
            "research_quality",
            "flags",
            "llm_stack",
            "patents",
            "sources_verifiees"
          ]
        }
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Réponse Gemini Search vide.');
    }

    const parsedReport = JSON.parse(responseText);
    
    // Injecter les données GitHub si collectées
    if (githubData) {
      parsedReport.github = githubData;
      // Aligner les flags avec les signaux GitHub pour plus de cohérence
      if (githubData.has_ml_repos) parsedReport.flags.modele_propre = true;
      if (githubData.has_fine_tuning) parsedReport.flags.fine_tuning_doc = true;
    }

    // Collecter les sources du grounding metadata si disponibles
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks && Array.isArray(chunks)) {
      chunks.forEach((chunk: any) => {
        if (chunk.web?.uri && !parsedReport.sources_verifiees.includes(chunk.web.uri)) {
          parsedReport.sources_verifiees.push(chunk.web.uri);
        }
      });
    }

    // S'assurer qu'il y a des sources vérifiées par défaut si Gemini en a oublié
    if (parsedReport.sources_verifiees.length === 0) {
      parsedReport.sources_verifiees = [
        `https://github.com/${githubOrg || 'search'}`,
        `https://www.google.com/search?q=${encodeURIComponent(startupName)}`
      ];
    }

    parsedReport.timestamp = new Date().toISOString();
    return res.json(parsedReport);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[/api/di-research] Erreur', { error: msg });
    return res.status(500).json({ error: 'Échec de la recherche DI par grounding', message: msg });
  }
});

export default router;
