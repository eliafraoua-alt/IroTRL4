/**
 * GitHub Extractor — Antigravity Intelligence Platform
 * Collecte : stack tech, dépendances LLM, activité commits, date dernier commit
 * GITHUB_TOKEN optionnel — sans token : 60 req/h, avec token : 5000 req/h
 */

import type { GitHubData } from '../../src/types/iro';

// Dépendances LLM connues à détecter dans package.json / requirements.txt
const LLM_DEPS = [
  'openai', '@anthropic-ai/sdk', 'anthropic', '@google/genai', '@google-ai/generativelanguage',
  'langchain', '@langchain/core', 'llamaindex', 'llama-index', 'mistralai',
  'cohere-ai', 'replicate', 'groq-sdk', 'together-ai', 'ai', 'vercel-ai',
  'transformers', 'huggingface_hub', 'litellm',
];

async function ghFetch(url: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { headers });
}

export async function fetchGitHubData(owner: string, repo: string): Promise<GitHubData> {
  const token = process.env.GITHUB_TOKEN; // optionnel

  const base: GitHubData = {
    repo_name: repo, owner,
    activity_score: 'low', tech_stack: [], llm_dependencies: [],
    last_commit_date: 'N/A', stars: 0, total_commits_year: 0,
    is_private_or_missing: false,
    di_signal: 'none', di_signal_reason: '',
    has_custom_model: false, llm_integration_depth: 'Unknown',
  };

  try {
    // ── 1. Info repo (étoiles, visibilité) ─────────────────────────────
    const repoRes = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`, token);
    if (repoRes.status === 404 || repoRes.status === 403) {
      return { ...base, is_private_or_missing: true };
    }
    if (!repoRes.ok) throw new Error(`GitHub API repo: ${repoRes.status}`);
    const repoData = await repoRes.json();
    base.stars = repoData.stargazers_count ?? 0;

    // ── 2. Langages ──────────────────────────────────────────────────
    const langRes = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/languages`, token);
    if (langRes.ok) {
      base.tech_stack = Object.keys(await langRes.json());
    }

    // ── 3. Dernier commit (endpoint fiable) ──────────────────────────
    const commitRes = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, token
    );
    if (commitRes.ok) {
      const commits = await commitRes.json();
      if (Array.isArray(commits) && commits.length > 0) {
        base.last_commit_date = commits[0]?.commit?.author?.date ?? 'N/A';
      }
    }

    // ── 4. Activité commits sur l'année ──────────────────────────────
    const actRes = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/stats/commit_activity`, token
    );
    if (actRes.ok) {
      const activity = await actRes.json();
      if (Array.isArray(activity)) {
        base.total_commits_year = activity.reduce((sum: number, w: { total: number }) => sum + (w.total ?? 0), 0);
      }
    }
    base.activity_score = base.total_commits_year > 500 ? 'high'
                        : base.total_commits_year > 100 ? 'medium' : 'low';

    // ── 5. Détection dépendances LLM dans package.json ────────────────
    const pkgRes = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/package.json`, token
    );
    if (pkgRes.ok) {
      const pkgFile = await pkgRes.json();
      const content = Buffer.from(pkgFile.content, 'base64').toString('utf-8');
      const pkg = JSON.parse(content);
      const allDeps = {
        ...pkg.dependencies ?? {},
        ...pkg.devDependencies ?? {},
        ...pkg.peerDependencies ?? {},
      };
      base.llm_dependencies = LLM_DEPS.filter(d => d in allDeps);
    }

    // ── 6. Fallback : requirements.txt (Python) ───────────────────────
    if (base.llm_dependencies.length === 0) {
      const reqRes = await ghFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/requirements.txt`, token
      );
      if (reqRes.ok) {
        const reqFile = await reqRes.json();
        const content = Buffer.from(reqFile.content, 'base64').toString('utf-8').toLowerCase();
        base.llm_dependencies = LLM_DEPS.filter(d => content.includes(d.toLowerCase()));
      }
    }

    // ── 7. Signal DI — déduction depuis le code ──────────────────────────────────
    base.has_custom_model = false;
    base.di_signal = 'none';
    base.llm_integration_depth = 'Unknown';

    // Chercher des indices de modèle custom ou RAG
    const diIndicators = [
      { path: 'model/', signal: 'proprietary' as const, depth: 'SelfHosted' as const },
      { path: 'models/', signal: 'proprietary' as const, depth: 'SelfHosted' as const },
      { path: 'training/', signal: 'finetuned' as const, depth: 'FineTuned' as const },
      { path: 'fine_tune/', signal: 'finetuned' as const, depth: 'FineTuned' as const },
      { path: 'vector_store/', signal: 'rag_custom' as const, depth: 'RAG' as const },
      { path: 'embeddings/', signal: 'rag_custom' as const, depth: 'RAG' as const },
      { path: 'rag/', signal: 'rag_custom' as const, depth: 'RAG' as const },
    ];

    for (const indicator of diIndicators) {
      const checkRes = await ghFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${indicator.path}`, token
      );
      if (checkRes.ok) {
        base.di_signal = indicator.signal;
        base.llm_integration_depth = indicator.depth;
        base.has_custom_model = indicator.signal === 'proprietary' || indicator.signal === 'finetuned';
        base.di_signal_reason = `Répertoire '${indicator.path}' détecté — indice de ${indicator.depth}`;
        break;
      }
    }

    // Déduction par les dépendances si pas de répertoire trouvé
    if (base.di_signal === 'none' && base.llm_dependencies.length > 0) {
      const hasFineTuning = base.llm_dependencies.some(d =>
        ['transformers', 'peft', 'trl', 'accelerate'].includes(d)
      );
      const hasRAG = base.llm_dependencies.some(d =>
        ['llamaindex', 'llama-index', 'langchain', '@langchain/core'].includes(d)
      );

      if (hasFineTuning) {
        base.di_signal = 'finetuned';
        base.llm_integration_depth = 'FineTuned';
        base.di_signal_reason = `Fine-tuning détecté : ${base.llm_dependencies.filter(d => ['transformers','peft','trl'].includes(d)).join(', ')}`;
      } else if (hasRAG) {
        base.di_signal = 'rag_custom';
        base.llm_integration_depth = 'RAG';
        base.di_signal_reason = `RAG custom détecté : ${base.llm_dependencies.filter(d => ['llamaindex','langchain'].includes(d.toLowerCase())).join(', ')}`;
      } else {
        base.di_signal = 'wrapper';
        base.llm_integration_depth = 'API';
        base.di_signal_reason = `Appel API LLM détecté : ${base.llm_dependencies.join(', ')} — sans indice de fine-tuning`;
      }
    }

    return base;

  } catch (error) {
    console.error(`GitHub extractor error (${owner}/${repo}):`, error);
    return { ...base, is_private_or_missing: true };
  }
}
