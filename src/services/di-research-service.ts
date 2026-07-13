/**
 * di-research-service.ts — IRO v7.0
 * Service de recherche web structurée pour la consolidation de l'axe DI
 *
 * Stratégie multi-sources :
 *   1. GitHub API → stars, commits, contributors, topics, description
 *   2. Gemini Grounding Search → stack LLM, brevets, infra (espacenet, INPI, news)
 *   3. Builtwith / Stackshare signals (via Gemini search)
 *   4. Agregation → DIEvidence avec score recommandé et niveau de confiance
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GitHubSignals {
  org: string | null;
  stars: number;
  repos: number;
  commits_30j: number;
  contributors: number;
  topics: string[];
  description: string;
  has_ml_repos: boolean;
  has_fine_tuning: boolean;
  has_own_model: boolean;
  last_commit_days_ago: number;
  source_url: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PatentSignals {
  nb_brevets: number;
  brevets_ia: number;
  depots_recents: string[]; // dates ISO
  offices: string[]; // 'EPO', 'INPI', 'USPTO'
  titres_representatifs: string[];
  source_urls: string[];
}

export interface LLMStackSignals {
  modeles_detectes: string[];         // ['GPT-4', 'Claude', 'Gemini', 'LLaMA', ...]
  integration_level: 'API' | 'Fine-tuned' | 'Self-hosted' | 'Hybrid' | 'Unknown';
  frameworks_ia: string[];            // ['LangChain', 'LlamaIndex', 'Transformers', ...]
  infra_propre: boolean;
  gpu_cluster: boolean;
  rag_custom: boolean;
  fine_tuning_doc: boolean;
  open_source_model: boolean;
  sources: string[];
  raw_evidence: string;
}

export interface DIEvidenceReport {
  startup_name: string;
  timestamp: string;
  github: GitHubSignals | null;
  patents: PatentSignals | null;
  llm_stack: LLMStackSignals | null;
  di_score_recommande: number;
  di_confiance: 'haute' | 'moyenne' | 'faible';
  di_justification_enrichie: string;
  sources_verifiees: string[];
  flags: {
    wrapper_pur: boolean;
    fine_tuning_doc: boolean;
    modele_propre: boolean;
    brevets_ia: boolean;
    infra_gpu: boolean;
    rag_custom: boolean;
  };
  research_quality: number; // 0-100
  loading_steps: string[];
}

// ── GitHub Signals ─────────────────────────────────────────────────────────────

const ML_KEYWORDS = [
  'llm', 'fine-tuning', 'finetune', 'rag', 'embedding', 'transformer',
  'langchain', 'llamaindex', 'huggingface', 'pytorch', 'tensorflow',
  'vllm', 'ollama', 'openai', 'anthropic', 'mistral', 'lora', 'qlora',
  'inference', 'model', 'training', 'dataset', 'vector-db', 'chromadb',
  'pinecone', 'weaviate', 'neural', 'nlp', 'ai', 'machine-learning',
];

const FINE_TUNING_KEYWORDS = [
  'fine-tun', 'finetune', 'lora', 'qlora', 'peft', 'sft',
  'instruction-tuning', 'finetuned', 'adapter', 'dpo', 'rlhf',
];

const OWN_MODEL_KEYWORDS = [
  'our-model', 'proprietary', 'foundation-model', 'pretrain', 'pretraining',
  'llm-training', 'from-scratch', 'base-model', 'custom-llm',
];

async function fetchGitHubSignals(orgName: string): Promise<GitHubSignals | null> {
  if (!orgName) return null;

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'IRO-Strength-v7',
  };

  try {
    // 1. Repos list
    const reposRes = await fetch(
      `https://api.github.com/orgs/${orgName}/repos?per_page=100&sort=updated`,
      { headers }
    );

    if (!reposRes.ok) {
      // Try as user if org fails
      const userRes = await fetch(
        `https://api.github.com/users/${orgName}/repos?per_page=100&sort=updated`,
        { headers }
      );
      if (!userRes.ok) return null;
    }

    const repos: any[] = await (reposRes.ok ? reposRes : await fetch(
      `https://api.github.com/users/${orgName}/repos?per_page=100&sort=updated`,
      { headers }
    )).json();

    if (!Array.isArray(repos) || repos.length === 0) return null;

    // Aggregate signals
    const totalStars = repos.reduce((s: number, r: any) => s + (r.stargazers_count ?? 0), 0);
    const allTopics = repos.flatMap((r: any) => r.topics ?? []);
    const allDescriptions = repos.map((r: any) => r.description ?? '').join(' ').toLowerCase();
    const allNames = repos.map((r: any) => r.name?.toLowerCase() ?? '').join(' ');
    const combined = allTopics.join(' ') + ' ' + allDescriptions + ' ' + allNames;

    const has_ml_repos = ML_KEYWORDS.some(kw => combined.includes(kw));
    const has_fine_tuning = FINE_TUNING_KEYWORDS.some(kw => combined.includes(kw));
    const has_own_model = OWN_MODEL_KEYWORDS.some(kw => combined.includes(kw));

    // Last commit estimate
    const latestPush = repos.reduce((latest: string, r: any) => {
      if (!r.pushed_at) return latest;
      return r.pushed_at > latest ? r.pushed_at : latest;
    }, '2020-01-01');
    const lastCommitDaysAgo = Math.floor(
      (Date.now() - new Date(latestPush).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Commits 30j — on estime via recent events
    let commits30j = 0;
    try {
      const eventsRes = await fetch(
        `https://api.github.com/orgs/${orgName}/events?per_page=100`,
        { headers }
      );
      if (eventsRes.ok) {
        const events: any[] = await eventsRes.json();
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        commits30j = events.filter(
          (e: any) => e.type === 'PushEvent' && new Date(e.created_at).getTime() > cutoff
        ).reduce((n: number, e: any) => n + (e.payload?.commits?.length ?? 1), 0);
      }
    } catch {}

    // Contributors (top repo)
    let contributors = 0;
    const topRepo = repos.sort((a: any, b: any) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))[0];
    if (topRepo) {
      try {
        const contribRes = await fetch(
          `https://api.github.com/repos/${orgName}/${topRepo.name}/contributors?per_page=30`,
          { headers }
        );
        if (contribRes.ok) {
          const contribs: any[] = await contribRes.json();
          contributors = Array.isArray(contribs) ? contribs.length : 0;
        }
      } catch {}
    }

    return {
      org: orgName,
      stars: totalStars,
      repos: repos.length,
      commits_30j: commits30j,
      contributors,
      topics: [...new Set(allTopics)].slice(0, 20),
      description: repos[0]?.description ?? '',
      has_ml_repos,
      has_fine_tuning,
      has_own_model,
      last_commit_days_ago: lastCommitDaysAgo,
      source_url: `https://github.com/${orgName}`,
      confidence: totalStars > 100 ? 'high' : totalStars > 10 ? 'medium' : 'low',
    };
  } catch {
    return null;
  }
}

// ── LLM Stack Signals via Gemini Grounding ─────────────────────────────────────

async function fetchLLMStackSignals(
  startupName: string,
  modelId: string = 'gemini-3.5-flash'
): Promise<LLMStackSignals | null> {
  const prompt = `Recherche globale, multilingue et approfondie (moteur de recherche Grounding) sur la startup ou l'entreprise "${startupName}" pour identifier sa stack technologique de modèles d'IA, son architecture de données et son autonomie d'infrastructure (Axe DI - Dépendance Infrastructure).

Tu dois chercher et analyser TOUTES les sources d'information fiables disponibles en anglais et en français à l'échelle internationale :

1. PRESSE TECHNOLOGIQUE & ÉCONOMIQUE INTERNATIONALE (Française & Américaine) :
   - Presse américaine / mondiale : TechCrunch, VentureBeat, Wired, Forbes US, Bloomberg, Business Insider, Techmeme, Hugging Face blogs, The Batch (DeepLearning.AI), etc.
   - Presse française / européenne : Les Échos, Maddyness, L'Usine Nouvelle, L'Usine Digitale, La Tribune, Sifted, Le Monde Informatique, BFM Business, etc.
   - Objectifs de recherche : Identifier les annonces de partenariats cloud ou GPU, les annonces de levée de fonds axées sur l'infrastructure physique ou d'entraînement, ou les choix explicites d'intégrer des modèles ouverts (Mistral, Llama) ou fermés (GPT-4, Claude).

2. DONNÉES INSTITUTIONNELLES & DE PROPRIÉTÉ INTELLECTUELLE :
   - Offices de brevets : INPI (Institut National de la Propriété Industrielle), USPTO (US Patent and Trademark Office), EPO (Office Européen des Brevets), WIPO (OMPI).
   - Financements étatiques ou académiques : Soutiens Bpifrance (ex: lauréat i-Nov, i-Lab, aides Deeptech), initiatives souveraines "France 2030", financements de la NSF (National Science Foundation) ou DARPA aux USA, aides et partenariats avec le CNRS, l'INRIA ou d'autres grands laboratoires publics.
   - Registres d'entreprises (Pappers, Infogreffe, SEC filings).

3. SITES D'INGÉNIERIE, DE RECHERCHE & GITHUB :
   - Repositories de code : GitHub (analyses de packages d'entraînement), Hugging Face Hub (modèles déposés publiques, datasets, métriques d'évaluation).
   - Sites académiques et de recherche de pointe : publications arXiv, Papers With Code, HAL, confirmant des innovations neuronales ou architecturales uniques signées par l'équipe fondatrice de "${startupName}".

4. OFFRES D'EMPLOI & STACKS TECHS :
   - Offres d'emploi récentes pour des profils IA hautement qualifiés (MLOps, CUDA optimization, LLM fine-tuning, AI Researcher).
   - Signalement de stacks via StackShare ou BuiltWith.

QUESTION CONFIGURATION DU SCORE DI (0 À 4) :
- Est-ce un simple wrapper qui appelle une API externe sans aucune personnalisation (DI = 0-1) ?
- Dispose-t-il d'un RAG custom avancé / base vectorielle propre (DI = 1) ?
- Utilise-t-il du fine-tuning documenté sur ses propres données d'entraînement (DI = 2) ?
- Adapte-t-il et héberge-t-il de gros modèles ouverts sur son infrastructure Cloud (DI = 2.5 - 3) ?
- Entraîne-t-il son propre modèle fondateur à partir de zéro (pre-training "from scratch") (DI = 3.5 - 4) ?
- Exploite-t-il des brevets IA déposés ou un cluster GPU propriétaire d'entraînement massif (DI = 4) ?

Réponds UNIQUEMENT par un objet JSON valide, sans balises XML ou blocs de code markdown :
{
  "modeles_detectes": ["liste élargie de tous les modèles d'IA détectés. ex: GPT-4, LLaMA, Claude 3, Mistral, modèle propriétaire"],
  "integration_level": "API|Fine-tuned|Self-hosted|Hybrid|Unknown",
  "frameworks_ia": ["les frameworks détectés, ex: LangChain, LlamaIndex, Transformers, PyTorch, vLLM, TensorRT, etc."],
  "infra_propre": false,
  "gpu_cluster": false,
  "rag_custom": false,
  "fine_tuning_doc": false,
  "open_source_model": false,
  "di_recommande": 1,
  "sources": ["liste d'au moins 3 à 5 URLs réelles de presse FR/US, INPI, USPTO ou Github consultées"],
  "raw_evidence": "Synthèse structurée et factuelle des indices d'innovation collectés, détaillant les sources de presse, les publications de recherche et les éventuels dossiers de brevets français et américains trouvés."
}`;

  try {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        modelId,
        tools: [{ googleSearch: {} }], // Grounding
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.response ?? data.text ?? '';

    // Clean & parse JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      modeles_detectes: parsed.modeles_detectes ?? [],
      integration_level: parsed.integration_level ?? 'Unknown',
      frameworks_ia: parsed.frameworks_ia ?? [],
      infra_propre: parsed.infra_propre ?? false,
      gpu_cluster: parsed.gpu_cluster ?? false,
      rag_custom: parsed.rag_custom ?? false,
      fine_tuning_doc: parsed.fine_tuning_doc ?? false,
      open_source_model: parsed.open_source_model ?? false,
      sources: parsed.sources ?? [],
      raw_evidence: parsed.raw_evidence ?? '',
    };
  } catch {
    return null;
  }
}

// ── Patent Signals via Gemini Grounding ─────────────────────────────────────────

async function fetchPatentSignals(startupName: string): Promise<PatentSignals | null> {
  const prompt = `Recherche exhaustive et rigoureuse des brevets d'invention déposés par l'entité juridique "${startupName}" ou ses fondateurs d'un point de vue technologique ou algorithmique global.

Explore et croise scrupuleusement les registres des offices de propriété intellectuelle français, américains et internationaux :
1. NATIONAL FRANÇAIS : INPI (Institut National de la Propriété Industrielle) via bases.inpi.fr / brevets français déposés.
2. AMÉRICAINS : USPTO (United States Patent and Trademark Office) / patents.google.com.
3. EUROPÉENS & MONDIAUX : Espacenet (Office Européen des Brevets / EPO), PatentScope (WIPO).

Tu dois chercher et compter tous les brevets réels portant sur l'intelligence artificielle, le traitement automatique du langage (NLP), le traitement d'images, de données financières de paye/comptabilité, de la cybersécurité ou de l'analyse prédictive.

Réponds UNIQUEMENT par un objet JSON valide, sans balises XML ni blocs de code markdown :
{
  "nb_brevets": 0,
  "brevets_ia": 0,
  "depots_recents": ["liste élargie d'années de dépôt ou de dates ISO précises"],
  "offices": ["les offices de brevets consultés et confirmés, ex: INPI, USPTO, EPO, WIPO"],
  "titres_representatifs": ["liste de titres ou de descriptions sommaires des inventions détectées"],
  "source_urls": ["URLs réelles et concrètes de patents.google.com ou déclarations officielles d'enregistrement de propriété industrielle"]
}
Si aucun brevet ou dépôt n'est trouvé, renvoie nb_brevets=0 et "brevets_ia": 0. Ne crée pas de faux brevets.`;

  try {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        tools: [{ googleSearch: {} }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.response ?? data.text ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// ── Score DI from evidence ─────────────────────────────────────────────────────

function computeDIFromEvidence(
  llm: LLMStackSignals | null,
  github: GitHubSignals | null,
  patents: PatentSignals | null
): { score: number; confiance: 'haute' | 'moyenne' | 'faible'; justification: string } {
  let score = 0;
  const evidence: string[] = [];

  if (!llm) {
    return { score: 0, confiance: 'faible', justification: 'Stack LLM non identifiable — données insuffisantes.' };
  }

  // Base score from integration level
  const levelScores: Record<string, number> = {
    'API': 0,
    'Hybrid': 1,
    'Fine-tuned': 2,
    'Self-hosted': 3,
    'Unknown': 0,
  };
  score = levelScores[llm.integration_level] ?? 0;

  if (llm.integration_level === 'API') {
    evidence.push('Stack API pure détectée — dépendance externe forte.');
  }

  // Bonuses
  if (llm.rag_custom) {
    score = Math.max(score, 1);
    evidence.push('RAG custom documenté → différenciation partielle.');
  }
  if (llm.fine_tuning_doc) {
    score = Math.max(score, 2);
    evidence.push('Fine-tuning documenté sur données sectorielles.');
  }
  if (llm.infra_propre) {
    score = Math.max(score, 2);
    evidence.push('Infrastructure propre confirmée.');
  }
  if (llm.gpu_cluster) {
    score = Math.max(score, 3);
    evidence.push('Cluster GPU propriétaire détecté → DI≥3.');
  }
  if (llm.open_source_model) {
    score = Math.max(score, 2);
    evidence.push('Modèle open-source adapté (LLaMA/Mistral) détecté.');
  }

  // GitHub signals
  if (github) {
    if (github.has_own_model) {
      score = Math.max(score, 3);
      evidence.push('Repos GitHub signalent un modèle propriétaire.');
    }
    if (github.has_fine_tuning && score < 2) {
      score = 2;
      evidence.push('Fine-tuning détecté dans les repos GitHub.');
    }
    if (github.has_ml_repos && github.stars > 500) {
      evidence.push(`Activité ML significative sur GitHub (${github.stars} stars).`);
    }
    if (github.commits_30j > 50) {
      evidence.push(`Activité de développement soutenue : ${github.commits_30j} commits/30j.`);
    }
  }

  // Patents
  if (patents) {
    if (patents.brevets_ia > 0) {
      score = Math.max(score, 3);
      evidence.push(`${patents.brevets_ia} brevet(s) IA déposé(s) → moat IP.`);
    } else if (patents.nb_brevets > 0) {
      evidence.push(`${patents.nb_brevets} brevet(s) détecté(s) (non spécifiquement IA).`);
    }
  }

  // Clamp
  score = Math.min(4, Math.max(0, score));

  // Confidence
  const sourceCount = (llm.sources?.length ?? 0) + (patents?.source_urls?.length ?? 0) + (github ? 1 : 0);
  const confiance: 'haute' | 'moyenne' | 'faible' =
    sourceCount >= 3 ? 'haute' : sourceCount >= 1 ? 'moyenne' : 'faible';

  return {
    score,
    confiance,
    justification: evidence.length > 0
      ? evidence.join(' ')
      : `Niveau d'intégration ${llm.integration_level} — score DI=${score} selon grille IRO V7.`,
  };
}

// ── Compute research quality ───────────────────────────────────────────────────

function computeResearchQuality(
  github: GitHubSignals | null,
  llm: LLMStackSignals | null,
  patents: PatentSignals | null
): number {
  let quality = 0;
  if (github && github.confidence === 'high') quality += 40;
  else if (github && github.confidence === 'medium') quality += 20;
  else if (github) quality += 10;

  if (llm && llm.sources?.length >= 2) quality += 40;
  else if (llm) quality += 20;

  if (patents !== null) quality += 20;

  return Math.min(100, quality);
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function runDIResearch(
  startupName: string,
  githubOrg: string | null = null,
  modelId?: string,
  onStep?: (step: string) => void
): Promise<DIEvidenceReport> {
  const steps: string[] = [];
  const log = (s: string) => { steps.push(s); onStep?.(s); };

  log('🔍 Initialisation de la recherche DI multi-sources...');

  // Parallel fetch where possible
  log('📦 Collecte GitHub — repos, topics, commits...');
  const githubOrg2 = githubOrg ?? startupName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const github = await fetchGitHubSignals(githubOrg2);
  if (github) log(`✅ GitHub — ${github.repos} repos · ${github.stars} stars · ML repos: ${github.has_ml_repos}`);
  else log('⚠️ GitHub non trouvé (org invalide ou privée)');

  log('🤖 Analyse stack LLM via Gemini Grounding Search...');
  const llm = await fetchLLMStackSignals(startupName, modelId);
  if (llm) log(`✅ Stack LLM — ${llm.integration_level} · ${llm.modeles_detectes.join(', ') || 'modèles non spécifiés'}`);
  else log('⚠️ Stack LLM non identifiable depuis les sources publiques');

  log('📋 Recherche brevets — espacenet.epo.org / INPI / patents.google.com...');
  const patents = await fetchPatentSignals(startupName);
  if (patents) log(`✅ Brevets — ${patents.nb_brevets} total · ${patents.brevets_ia} IA`);
  else log('⚠️ Données brevets non collectées');

  log('⚙️ Calcul du score DI consolidé...');
  const { score, confiance, justification } = computeDIFromEvidence(llm, github, patents);

  const allSources = [
    ...(github ? [github.source_url] : []),
    ...(llm?.sources ?? []),
    ...(patents?.source_urls ?? []),
  ].filter(Boolean);

  log(`✅ Score DI recommandé : ${score}/4 (confiance ${confiance})`);

  return {
    startup_name: startupName,
    timestamp: new Date().toISOString(),
    github,
    patents,
    llm_stack: llm,
    di_score_recommande: score,
    di_confiance: confiance,
    di_justification_enrichie: justification + (llm?.raw_evidence ? ' ' + llm.raw_evidence : ''),
    sources_verifiees: [...new Set(allSources)],
    flags: {
      wrapper_pur: llm?.integration_level === 'API' && !llm.rag_custom,
      fine_tuning_doc: llm?.fine_tuning_doc ?? false,
      modele_propre: llm?.open_source_model ?? github?.has_own_model ?? false,
      brevets_ia: (patents?.brevets_ia ?? 0) > 0,
      infra_gpu: llm?.gpu_cluster ?? false,
      rag_custom: llm?.rag_custom ?? false,
    },
    research_quality: computeResearchQuality(github, llm, patents),
    loading_steps: steps,
  };
}
