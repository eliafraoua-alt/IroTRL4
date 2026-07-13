import { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { mapToGeminiModel } from '../../src/utils/llm-router';
import { logger } from '../../src/utils/logger';
import { recordLLMCall, estimateCostUSD } from '../../src/utils/llm-metrics';

export async function getLLMStatus(req: Request, res: Response) {
  res.json({ 
    status: 'ok', 
    gemini: !!process.env.GEMINI_API_KEY,
    version: process.env.npm_package_version ?? '7.0.0',
    sdk: '@google/genai'
  });
}

export async function callLLM(req: Request, res: Response) {
  const { prompt, system, modelId, tools } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ error: 'Le champ prompt est obligatoire.' });
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey.length < 5) {
    return res.status(401).json({ 
      error: 'Configuration Requise', 
      message: 'La clé GEMINI_API_KEY est manquante dans les "Secrets" du projet. 1. Allez dans "Settings" (en haut à droite). 2. Ajoutez un secret nommé GEMINI_API_KEY. 3. Collez votre clé obtenue sur https://aistudio.google.com/apikey' 
    });
  }

  const t0 = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const mappedModelId = mapToGeminiModel(modelId);
    const config = {
      model: mappedModelId,
      contents: prompt,
      config: {
        systemInstruction: system || undefined,
        temperature: 0.1,
        maxOutputTokens: 4096,
        ...(tools && tools.length > 0 ? { tools: tools as any } : {}),
      },
    };

    const callWithRetry = async (retryCount = 0, currentModel = mappedModelId): Promise<any> => {
      try {
        config.model = currentModel;
        return await ai.models.generateContent(config);
      } catch (err: any) {
        const errMsg = String(err);
        const isRateLimit = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota') || errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('temporary') || errMsg.includes('high demand') || errMsg.includes('overloaded') || errMsg.includes('Service Unavailable');
        
        // If we hit a rate limit/quota error, try model rotation to ensure high availability
        if (isRateLimit) {
          if (currentModel.includes('pro') || currentModel.includes('imagen') || currentModel.includes('veo') || currentModel.includes('lyria')) {
            const fallbackModel = 'gemini-3.5-flash';
            logger.warn(`[/api/llm] Graceful downgrade: active quota limit on ${currentModel}. Switching to high-availability ${fallbackModel}.`);
            return callWithRetry(retryCount, fallbackModel);
          } else if (currentModel === 'gemini-3.5-flash' && retryCount < 3) {
            const fallbackModel = 'gemini-3-flash-preview';
            logger.warn(`[/api/llm] Active quota limit on ${currentModel}. Switching to alternative high-availability ${fallbackModel}.`);
            return callWithRetry(retryCount + 1, fallbackModel);
          } else if (currentModel === 'gemini-3-flash-preview' && retryCount < 3) {
            const fallbackModel = 'gemini-3.1-flash-lite';
            logger.warn(`[/api/llm] Active quota limit on ${currentModel}. Switching to alternative high-availability gemini-3.1-flash-lite.`);
            return callWithRetry(retryCount + 1, 'gemini-3.1-flash-lite');
          }
        }

        if (isRateLimit && retryCount < 3) {
          const wait = Math.pow(2, retryCount) * 2000;
          logger.warn(`[/api/llm] Rate limit on ${currentModel} — retry ${retryCount + 1}/3 dans ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          return callWithRetry(retryCount + 1, currentModel);
        }
        throw err;
      }
    };

    const response = await callWithRetry();
    const text = response.text;
    if (!text) throw new Error('Réponse Gemini vide');

    // B3 : extraction des tokens depuis usageMetadata
    const usage = response.usageMetadata as any;
    const promptTokens  = usage?.promptTokenCount     ?? 0;
    const outputTokens  = usage?.candidatesTokenCount ?? 0;
    const finalModelId  = config.model;
    const latencyMs     = Date.now() - t0;
    const costUSD       = estimateCostUSD(finalModelId, promptTokens, outputTokens);

    recordLLMCall({
      provider:      'Gemini',
      modelId:       finalModelId,
      latencyMs,
      success:       true,
      promptTokens,
      outputTokens,
      costUSD,
      timestamp:     Date.now(),
    });

    return res.json({
      text,
      provider:      'Gemini',
      modelId:       finalModelId,
      latencyMs,
      // B3 : métriques renvoyées au client pour affichage optionnel
      _llmops: {
        promptTokens,
        outputTokens,
        totalTokens: promptTokens + outputTokens,
        estimatedCostUSD: Math.round(costUSD * 100000) / 100000,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    
    // B3 : enregistrement de l'échec pour les métriques
    recordLLMCall({
      provider:  'Gemini',
      modelId:   mapToGeminiModel(req.body?.modelId),
      latencyMs: Date.now() - t0,
      success:   false,
      timestamp: Date.now(),
    });

    // Detection 401/403
    const isAuthError = msg.includes('401') || msg.includes('403') || msg.includes('API_KEY_INVALID');
    const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('temporary') || msg.includes('high demand') || msg.includes('overloaded') || msg.includes('Service Unavailable');

    if (isRateLimit && process.env.NODE_ENV !== 'test') {
      logger.warn(`[/api/llm] Congestion de quota détectée (Gemini Direct). Activation du fallback haute disponibilité — Économie de quota / Résilience actif.`);
    } else {
      logger.error('[/api/llm] Erreur Gemini Direct', { error: msg });
    }
    
    // CORRECTIF AUDIT SEC-04 (intégrité) : le fallback simulé ne doit JAMAIS être
    // silencieusement substitué à une vraie réponse LLM dans un système de scoring
    // qualifié "haut risque" (AI Act). Il n'est désormais activé que sur opt-in
    // explicite via ALLOW_MOCK_FALLBACK=true (démo / développement uniquement).
    const mockFallbackEnabled = process.env.ALLOW_MOCK_FALLBACK === 'true';
    if (mockFallbackEnabled && process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'production') {
      try {
        const fallback = getDynamicMockLLMResponse(prompt || '', system || '');
        return res.json({
          text: fallback.text,
          provider: 'MOCK (données simulées — non exploitables)',
          modelId: fallback.modelId,
          latencyMs: Date.now() - t0,
          fallbackTriggered: true,
          isSimulated: true,
          suggestion: 'ATTENTION : réponse simulée (ALLOW_MOCK_FALLBACK=true). Ne pas utiliser pour un scoring réel.'
        });
      } catch (fallbackErr) {
        logger.error('[/api/llm] Échec de la génération du fallback haute disponibilité', { error: String(fallbackErr) });
      }
    }

    // Changer 502/503 en 429/400 pour éviter l'interception HTML par les passerelles Cloud Run/Nginx
    const statusCode = isAuthError ? 401 : (isRateLimit ? 429 : 400);

    return res.status(statusCode).json({ 
      error: isRateLimit ? 'Limite de quota dépassée (429)' : 'Erreur Gemini', 
      message: msg,
      suggestion: isAuthError 
        ? 'Régénérez votre clé API dans les paramètres AI Studio.' 
        : (isRateLimit ? 'Veuillez patienter quelques instants ou utiliser un autre modèle/clé.' : undefined)
    });
  }
}

// ── Générateur de Fallbacks Structurés Haute Visibilité ────────────────────────

function getDynamicMockLLMResponse(prompt: string, system: string): { text: string; provider: string; modelId: string } {
  const normalized = (prompt + ' ' + system).toLowerCase();

  // On extrait le nom de startup potentiel du prompt
  const companyMatch = prompt.match(/["'«]([^"'»]+)["'»]/) || prompt.match(/(?:startup|company|entreprise|société)\s+([a-zA-Z0-9_\-]+)/i);
  const companyName = companyMatch ? companyMatch[1] : "SaaS-Tech AI";

  // 1. Match FinancialData
  if (normalized.includes('funding_total_eur') || normalized.includes('llm_stack') || normalized.includes('valuation_eur')) {
    const mockData = {
      funding_total_eur: 8500000,
      funding_stage: "Series A",
      founded_year: 2022,
      investors: ["Kima Ventures", "Xavier Niel", "Bpifrance", "Eurazeo", "Alven"],
      last_round_date: "2024-11-20",
      valuation_eur: 32000000,
      statut_juridique: "SAS",
      source_confidence: "high",
      employee_count: 36,
      employee_growth: "+45% YoY",
      talent_density_proxy: "high",
      hiring_news: [
        `Recrutement tech actif par ${companyName} pour des postes de Senior ML, RAG Architect, Full-Stack Node/React.`
      ],
      llm_stack: {
        models: ["Claude-3.5-Sonnet", "GPT-4o", "Llama-3-70b-Instruct"],
        frameworks: ["LangChain", "LlamaIndex", "Pydantic"],
        integration_level: "Hybrid",
        evidence: `Mention officielle de l'implémentation de modèles avancés sur les pages offres/LinkedIn et la documentation produit de ${companyName}.`,
        confidence: "high"
      }
    };
    return {
      text: JSON.stringify(mockData, null, 2),
      provider: "Gemini (Fallback HA)",
      modelId: "gemini-3.5-flash-mock"
    };
  }

  // 2. Match NLPExtraction
  if (normalized.includes('extractedfrom') || normalized.includes('nlpextraction') || (normalized.includes('dimensions') && (normalized.includes('signals') || normalized.includes('warnings')))) {
    const mockData = {
      dimensions: {
        di: 3,
        adc: 4,
        ipc: 3,
        ar: 3,
        ca: 4,
        gch: 4
      },
      confidence: {
        di: 0.9,
        adc: 0.85,
        ipc: 0.8,
        ar: 0.85,
        ca: 0.9,
        gch: 0.8
      },
      signals: [
        `Excellente différenciation technologique via RAG optimisé et modèles open-source hébergés par ${companyName}.`,
        "Preuve de traction commerciale avec d'excellents retours d'intégration de grands comptes.",
        "Architecture robuste modulaire facilitant l'intégration continue et la sécurité."
      ],
      warnings: [
        "Forte dépendance initiale envers les talents techniques fondateurs.",
        "Coûts opérationnels potentiellement volatils lors du scaling de l'infrastructure RAG."
      ],
      context: `Analyse cognitive de la structure d'entreprise, technique et organisationnelle de ${companyName} basée sur les éléments fournis.`,
      sector: "SaaS B2B & Solutions d'Intelligence Artificielle",
      stage: "Série A / Expansion",
      extractedFrom: 95,
      arr: 1450000,
      fundingStage: "series-a",
      teamSize: 28,
      yearsActive: 2,
      churn: 4.2,
      payingCustomers: 85,
      nrr: 114
    };
    return {
      text: JSON.stringify(mockData, null, 2),
      provider: "Gemini (Fallback HA)",
      modelId: "gemini-3.5-flash-mock"
    };
  }

  // 3. Match LinkedInCompanyData
  if (normalized.includes('employee_growth_pct') || normalized.includes('tech_job_titles') || normalized.includes('llm_signals')) {
    const mockData = {
      name: companyName,
      employee_count: 52,
      employee_growth_pct: 18.5,
      tech_job_titles: ["Senior ML Engineer", "Tech Lead Frontend React", "Lead DevOps Cloud Architect"],
      llm_signals: ["RAG architecture", "Fine-tuning", "LlamaIndex", "Vector Databases", "Prompt Ops"],
      founders: ["Jean Dupont (CEO)", "Marie Durand (CTO)"],
      founder_backgrounds: ["PhD ML DeepMind", "Ex-VP Engineering Scalatech", "Publications NeurIPS/ICML"],
      source: "gemini_search",
      confidence: "high"
    };
    return {
      text: JSON.stringify(mockData, null, 2),
      provider: "Gemini (Fallback HA)",
      modelId: "gemini-3.5-flash-mock"
    };
  }

  // 4. Match CrunchbaseCompany
  if (normalized.includes('crunchbasecompany') || normalized.includes('funding_total_usd') || normalized.includes('employee_range')) {
    const mockData = {
      slug: companyName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      name: companyName,
      founded_year: 2022,
      funding_total_usd: 9500000,
      funding_stage: "series_a",
      last_funding_date: "2024-11-20",
      investors: ["Kima Ventures", "Xavier Niel", "Bpifrance", "Eurazeo", "Alven"],
      employee_range: "11-50",
      description: `Plateforme technologique souveraine d'intelligence artificielle développée par ${companyName}.`,
      categories: ["Artificial Intelligence", "SaaS", "Software", "Information Technology"],
      website: `https://${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
      location_country: "France",
      location_city: "Paris",
      valuation_usd: 35000000,
      age_mois_computed: 32,
      source: "gemini_search",
      confidence: "medium"
    };
    return {
      text: JSON.stringify(mockData, null, 2),
      provider: "Gemini (Fallback HA)",
      modelId: "gemini-3.5-flash-mock"
    };
  }

  // 5. Match FounderProfile
  if (normalized.includes('founderprofile') || normalized.includes('gch_contribution') || normalized.includes('track_record')) {
    const mockData = {
      id: "fp-1",
      name: companyName.includes("ceo") || companyName.includes("cto") ? "Arnaud Legrande" : companyName,
      role: "Fondateur & CTO",
      linkedin_url: "https://linkedin.com/in/expert-cto",
      linkedin_verified: true,
      previous_companies: ["Google", "DeepMind", "Mistral AI"],
      education: ["PhD Machine Learning - ENS Paris-Saclay", "MSc Computer Science - Telecom Paris"],
      publications: ["NeurIPS 2023 - Scaling laws for fine-tuned small LLMs", "ICML 2024 - Efficient vector space reasoning"],
      patents: 2,
      track_record: "scale",
      board_roles: ["Conseiller IA - Comité Technologique de France"],
      open_source: ["Contributeur majeur LangChain / LlamaIndex", "Auteur d'une bibliothèque vectorielle à 2k étoiles"],
      media_mentions: ["Interview TechCrunch : les architectures d'agentic AI de rupture"],
      gch_contribution: 4.8,
      enriched_at: new Date().toISOString(),
      source: "gemini",
      confidence: "high"
    };
    return {
      text: JSON.stringify(mockData, null, 2),
      provider: "Gemini (Fallback HA)",
      modelId: "gemini-3.5-flash-mock"
    };
  }

  // 6. Match General Scores & SRD
  if (normalized.includes('scores') && normalized.includes('srd')) {
    const mockData = {
      scores: {
        DI: 3,
        ADC: 4,
        IPC: 3,
        AR: 4,
        CA: 3,
        GCH: 4
      },
      srd: {
        VMM: 3,
        NCD: 2,
        DFL: 3
      },
      goodhart_patterns: [],
      verdict: {
        viabilite: "viable",
        financement: "fort"
      }
    };
    return {
      text: JSON.stringify(mockData, null, 2),
      provider: "Gemini (Fallback HA)",
      modelId: "gemini-3.5-flash-mock"
    };
  }

  // 7. Extraction générique dynamique depuis un bloc JSON dans le prompt
  const matchesJsonStr = prompt.match(/\{[\s\S]*?\}/);
  if (matchesJsonStr) {
    try {
      const template = JSON.parse(matchesJsonStr[0]);
      const populateObj = (obj: any): any => {
        const res: any = {};
        for (const k of Object.keys(obj)) {
          const val = obj[k];
          if (Array.isArray(val)) {
            res[k] = ["Donnée simulée A", "Donnée simulée B"];
          } else if (typeof val === 'object' && val !== null) {
            res[k] = populateObj(val);
          } else if (typeof val === 'number') {
            res[k] = 3.5;
          } else if (typeof val === 'boolean') {
            res[k] = true;
          } else {
            res[k] = `Donnée extraite pour ${companyName}`;
          }
        }
        return res;
      };

      const mockData = populateObj(template);
      return {
        text: JSON.stringify(mockData, null, 2),
        provider: "Gemini (Fallback HA)",
        modelId: "gemini-3.5-flash-mock"
      };
    } catch (err) {
      // Ignorer
    }
  }

  // 8. Fallback textuel standard
  const mockText = `Analyse stratégique de ${companyName} :
1. Différenciation de l'innovation (SCORE: 3/5) : La startup montre une bonne maîtrise de l'intégration de modèles d'IA pré-entraînés avec un pipeline de traitement de données local de qualité.
2. Avantage Différentiel Client (SCORE: 4/5) : Gains opérationnels mesurables déjà observés dans les retours clients et la documentation d'intégration.
3. Indicateur de Performance Commerciale (SCORE: 3/5) : Une dynamique positive de contractualisation se dessine sur les segments clés B2B.
4. Adaptabilité Réglementaire (SCORE: 4/5) : Intégration exemplaire de la protection de la donnée (conformité RGPD) et préparation adéquate à l'AI Act de l'Union Européenne.
5. Cohérence d'Architecture (SCORE: 3/5) : Interfaces structurées de manière modulaire facilitant l'intégration continue.
6. Gouvernance & Capital Humain (SCORE: 4/5) : Profils de fondateurs équilibrés possédant d'excellents track-records et des formations de pointe.`;

  return {
    text: mockText,
    provider: "Gemini (Fallback HA)",
    modelId: "gemini-3.5-flash-mock"
  };
}

export async function extractPdf(req: Request, res: Response) {
  const { fileBase64, mimeType, fileName } = req.body || {};

  if (!fileBase64) {
    return res.status(400).json({ error: 'Le paramètre fileBase64 est requis.' });
  }

  // CORRECTIF AUDIT SEC-09 : validation du type MIME (liste blanche) et de la
  // taille avant transmission au LLM — évite l'envoi de contenus arbitraires.
  const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
  const effectiveMime = mimeType || 'application/pdf';
  if (!ALLOWED_MIME.includes(effectiveMime)) {
    return res.status(400).json({ error: `Type de fichier non supporté : ${effectiveMime}. Types acceptés : PDF, PNG, JPEG, WEBP.` });
  }
  // ~7,5 Mo décodés (base64 = +33%) — cohérent avec la limite body 10 Mo
  if (typeof fileBase64 !== 'string' || fileBase64.length > 10_000_000) {
    return res.status(413).json({ error: 'Fichier trop volumineux (limite : ~7,5 Mo).' });
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey.length < 5) {
    return res.status(401).json({ 
      error: 'Configuration Requise', 
      message: 'La clé GEMINI_API_KEY est manquante dans les "Secrets" du projet.' 
    });
  }

  const prompt = `Tu reçois un document (pitch deck, business plan ou dossier de financement).

Extrais et structure son contenu en texte brut pour l'analyse IROSTRENGTH.

INSTRUCTIONS :
1. Extrais TOUT le contenu textuel significatif (slides, pages, sections).
2. Préserve la structure logique : titres de slides, sections, chiffres clés.
3. Identifie le nom de la startup analysée.
4. Inclus : nom de l'entreprise, description produit, équipe, marché, technologie, chiffres financiers (ARR, CAC, LTV, ROAS si présents), levée de fonds, valorisation.
5. Format de sortie : texte structuré avec séparateurs de sections (===).

Retourne UNIQUEMENT ce JSON :
{
  "startup_name": "Nom exact de la startup ou null",
  "extracted_text": "Contenu textuel structuré complet...",
  "financial_signals": {
    "arr_eur": null,
    "arr_growth_12m": null,
    "roas": null,
    "ltv_eur": null,
    "cac_eur": null,
    "valuation_premoney_eur": null,
    "raise_amount_eur": null
  }
}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: effectiveMime,
            data: fileBase64
          }
        },
        prompt
      ],
      config: {
        responseMimeType: 'application/json'
      }
    });

    const text = response.text;
    if (!text) throw new Error('Extraction vide ou non supportée par le modèle');

    // Parse output to ensure safety
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    }

    return res.json(parsed);

  } catch (err: any) {
    logger.error('[PDF] Erreur lors de l\'extraction par Gemini', { error: String(err) });
    return res.status(500).json({ 
      error: 'Erreur d\'extraction', 
      message: err.message || String(err)
    });
  }
}

// CORRECTIF AUDIT SEC-05 : échappement HTML de toute donnée externe (utilisateur ou LLM)
// injectée dans le document Word généré, pour prévenir l'injection HTML/XSS stockée.
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Assainit récursivement les champs textuels d'un objet rapport avant interpolation HTML.
function sanitizeReportForHtml<T>(input: T): T {
  if (typeof input === 'string') return escapeHtml(input) as unknown as T;
  if (Array.isArray(input)) return input.map(sanitizeReportForHtml) as unknown as T;
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = sanitizeReportForHtml(v);
    }
    return out as unknown as T;
  }
  return input;
}

export async function generateWord(req: Request, res: Response) {
  const { report: rawReport } = req.body || {};
  if (!rawReport) {
    return res.status(400).json({ error: 'Rapport manquant dans le corps de la requête.' });
  }
  const report = sanitizeReportForHtml(rawReport);

  const name = report.startup_name || 'Startup';
  const filename = `Rapport_Investisseur_IRO_${name.replace(/[^a-zA-Z0-9]/g, '_')}.doc`;

  // Construction d'un document HTML que MS Word ouvrira parfaitement en mode page
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${name} - Rapport d'Analyse IRO</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
</w:WordDocument>
</xml>
<![endif]-->
<style>
  body {
    font-family: 'Calibri', 'Arial', sans-serif;
    line-height: 1.5;
    color: #1e293b;
    margin: 24px;
  }
  h1 {
    color: #1e3a8a;
    font-size: 26pt;
    margin-bottom: 6pt;
    font-family: 'Georgia', serif;
  }
  h2 {
    color: #0f172a;
    font-size: 18pt;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 4px;
    margin-top: 24pt;
    margin-bottom: 12pt;
    font-family: 'Georgia', serif;
  }
  h3 {
    color: #1e40af;
    font-size: 14pt;
    margin-top: 16pt;
    margin-bottom: 8pt;
  }
  .meta-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  .meta-table td {
    padding: 6px 10px;
    font-size: 10pt;
    border: 1px solid #e2e8f0;
  }
  .meta-label {
    font-weight: bold;
    background-color: #f8fafc;
    width: 25%;
  }
  .verdict-box {
    background-color: #f0fdf4;
    border-left: 6px solid #16a34a;
    padding: 12px;
    margin: 16px 0;
  }
  .verdict-box.critique, .verdict-box.critique_level {
    background-color: #fef2f2;
    border-left-color: #dc2626;
  }
  .verdict-box.fragile {
    background-color: #fffbeb;
    border-left-color: #d97706;
  }
  .verdict-box.robuste {
    background-color: #eff6ff;
    border-left-color: #2563eb;
  }
  .score-badge {
    font-size: 18pt;
    font-weight: bold;
    color: #1e3a8a;
  }
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
  }
  table.data-table th, table.data-table td {
    border: 1px solid #cbd5e1;
    padding: 8px 10px;
    font-size: 10pt;
    text-align: left;
  }
  table.data-table th {
    background-color: #f1f5f9;
    font-weight: bold;
  }
  .dim-card {
    border: 1px solid #e2e8f0;
    padding: 14px;
    margin-bottom: 14px;
    background-color: #fff;
  }
  .flag-item {
    margin-bottom: 10px;
    padding: 8px 12px;
    border-left: 4px solid #94a3b8;
    background-color: #f8fafc;
  }
  .flag-item.risk-critique { border-left-color: #dc2626; background-color: #fef2f2; }
  .flag-item.risk-modére { border-left-color: #f97316; background-color: #fff7ed; }
  .flag-item.signal-positif { border-left-color: #16a34a; background-color: #f0fdf4; }
  .bullet-list {
    margin: 8px 0;
    padding-left: 20px;
  }
  .bullet-item {
    margin-bottom: 4px;
    font-size: 10pt;
  }
</style>
</head>
<body>
  <h1>${name} — Rapport IRO Officiel</h1>
  <p style="font-size: 9pt; color: #64748b; margin-top: -6px;">Généré le ${new Date(report.generated_at).toLocaleDateString('fr-FR')} | Confidentiel | Conforme au protocole ${report.protocol_version}</p>
  
  <table class="meta-table">
    <tr>
      <td class="meta-label">Secteur</td>
      <td>${report.secteur}</td>
      <td class="meta-label">Marché cible</td>
      <td>${report.marche}</td>
    </tr>
    <tr>
      <td class="meta-label">Verticale</td>
      <td>${report.vertical || 'SAAS'}</td>
      <td class="meta-label">Protocole utilisé</td>
      <td>${report.protocol_version} (Prompt Registry ${report.prompt_registry})</td>
    </tr>
  </table>

  <h2>1. Synthèse Executive & Score Global</h2>
  
  <div class="verdict-box ${String(report.iro_verdict).toLowerCase()}">
    <span>Score Global IRO: </span> <span class="score-badge">${report.iro_score} / 100</span><br/>
    <strong>Verdict de robustesse: ${report.iro_verdict}</strong>
    ${report.floor_di_activated ? '<p style="color: #dc2626; font-weight: bold; margin: 4px 0 0 0;">⚠️ Floor DI=0 activé (limite supérieure à 40 pts).</p>' : ''}
    ${report.ancrage_warning ? '<p style="color: #d97706; font-weight: bold; margin: 4px 0 0 0;">⚠️ Diagnostic anomalie d\'ancrage détectée.</p>' : ''}
  </div>

  <h3>Le mot de l'investisseur</h3>
  <blockquote style="margin: 8px 0; padding: 10px 15px; border-left: 4px solid #1e3a8a; background: #f8fafc; font-style: italic;">
    ${report.verdict_investisseur || 'Aucune synthèse disponible.'}
  </blockquote>

  <table style="width: 100%; border-collapse: collapse; margin-top: 14px;">
    <tr style="vertical-align: top;">
      <td style="width: 50%; padding-right: 10px; border: none;">
        <h4 style="color: #16a34a; margin-top: 0;">Forces Clés</h4>
        <ul class="bullet-list">
          ${(report.forces || []).map((f: string) => `<li class="bullet-item">${f}</li>`).join('')}
        </ul>
      </td>
      <td style="width: 50%; padding-left: 10px; border: none;">
        <h4 style="color: #dc2626; margin-top: 0;">Risques Principaux</h4>
        <ul class="bullet-list">
          ${(report.risques || []).map((r: string) => `<li class="bullet-item">${r}</li>`).join('')}
        </ul>
      </td>
    </tr>
  </table>

  <h2>2. Détail par Dimension IRO (Poids Officiels)</h2>
  <table class="data-table">
    <thead>
      <tr>
        <th>Dimension</th>
        <th>Coefficient</th>
        <th>Score /4</th>
        <th>Niveau de Confiance</th>
        <th>Qualificatif Clé</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(report.dimensions || {}).map(([key, d]: [string, any]) => {
        let coefLabel = '';
        if (key === 'DI') coefLabel = '18%';
        else if (key === 'ADC') coefLabel = '22%';
        else if (key === 'IPC') coefLabel = '22%';
        else if (key === 'AR') coefLabel = '13%';
        else if (key === 'CA') coefLabel = '13%';
        else if (key === 'GCH') coefLabel = '12%';
        
        const dimLabels: Record<string, string> = {
          DI: 'Dépendance Infrastructurelle',
          ADC: 'Actif de Données Cumulatif',
          IPC: 'Intégration Processus Critiques',
          AR: 'Anticipation Réglementaire',
          CA: 'Capacité d\'Adaptation',
          GCH: 'Gouvernance & Capital Humain'
        };

        return `<tr>
          <td><strong>${key}</strong> - ${dimLabels[key] || key}</td>
          <td>${coefLabel}</td>
          <td style="font-weight: bold; background-color: #f8fafc; text-align: center;">${d.score} / 4</td>
          <td>${d.confidence_label} (${Math.round(d.confidence * 100)}%)</td>
          <td>${d.qualificatif}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>

  <h3>Analyses détaillées</h3>
  ${Object.entries(report.dimensions || {}).map(([key, d]: [string, any]) => {
    const dimLabels: Record<string, string> = {
      DI: 'Dépendance Infrastructurelle',
      ADC: 'Actif de Données Cumulatif',
      IPC: 'Intégration Processus Critiques',
      AR: 'Anticipation Réglementaire',
      CA: 'Capacité d\'Adaptation',
      GCH: 'Gouvernance & Capital Humain'
    };

    return `<div class="dim-card">
      <h4 style="color: #1e3a8a; margin: 0 0 6px 0;">■ ${key} — ${dimLabels[key] || key} · Score ${d.score}/4</h4>
      <p style="margin: 4px 0; font-size: 9.5pt;"><strong>Justification :</strong> ${d.justification}</p>
      ${d.missing_data && d.missing_data.length > 0 ? `<p style="margin: 4px 0; font-size: 9pt; color: #dc2626;"><strong>Données manquantes identifiées :</strong> ${d.missing_data.join(' · ')}</p>` : ''}
      ${d.integration_level ? `<p style="margin: 2px 0; font-size: 8.5pt; font-style: italic; color: #3b82f6;">[IPC REV3] Niveau d'intégration : ${d.integration_level}</p>` : ''}
      ${d.pivot_type ? `<p style="margin: 2px 0; font-size: 8.5pt; font-style: italic; color: #3b82f6;">[CA REV2] Type de pivot / Agilité : ${d.pivot_type}</p>` : ''}
    </div>`;
  }).join('')}

  <h2>3. Flags de Vigilance & Alertes Investisseur</h2>
  <div style="margin-top: 10px;">
    ${(report.investor_flags || []).map((f: any) => {
      const typeClass = f.type === 'risk' ? `risk-${f.severity || 'modéré'}` : 'signal-positif';
      return `<div class="flag-item ${typeClass}">
        <strong>[${String(f.type).toUpperCase()}] ${f.titre}</strong>
        <p style="margin: 4px 0 0 0; font-size: 9.5pt;">${f.detail}</p>
      </div>`;
    }).join('')}
    ${(!report.investor_flags || report.investor_flags.length === 0) ? '<p>Aucun flag activé.</p>' : ''}
  </div>

  <h2>4. Recommandations Stratégiques par Horizon</h2>
  <div style="margin-top: 10px;">
    ${(report.recommendations || []).map((r: any) => `
      <div style="border-left: 3px solid #1e40af; padding-left: 12px; margin-bottom: 14px;">
        <h4 style="color: #1e40af; margin: 0 0 4px 0;">→ ${r.dim} → Target Score ${r.target_score} (${r.horizon_label})</h4>
        <strong style="font-size: 10pt;">${r.titre}</strong>
        <ul style="margin: 4px 0; padding-left: 20px;">
          ${(r.actions || []).map((action: string) => `<li style="font-size: 9.5pt; margin-bottom: 2px;">${action}</li>`).join('')}
        </ul>
      </div>
    `).join('')}
    ${(!report.recommendations || report.recommendations.length === 0) ? '<p>Aucune recommandation stratégique activée.</p>' : ''}
  </div>

  ${report.survival_36m != null ? `
  <h2>5. Modèle de Survie & Viabilité Financière</h2>
  <p style="font-size: 10pt;">Analyse prédictive basée sur le modèle Cox-PH structurel multi-facteurs.</p>
  <table class="data-table" style="width: 70%;">
    <thead>
      <tr>
        <th>Horizon prévisionnel</th>
        <th>Probabilité de viabilité</th>
        <th>Intervalle de confiance (IC 95%)</th>
      </tr>
    </thead>
    <tbody>
      ${report.survival_18m != null ? `
        <tr>
          <td>18 Mois (FSF Opérationnel)</td>
          <td style="font-weight: bold; color: #16a34a;">${report.survival_18m}%</td>
          <td>Score FSF : ${report.fsf_score != null ? report.fsf_score.toFixed(1) : '—'}/4 (${report.fsf_label || '—'})</td>
        </tr>
      ` : ''}
      <tr>
        <td>36 Mois (Cox Structurel)</td>
        <td style="font-weight: bold; color: #1e3a8a;">${report.survival_36m}%</td>
        <td>[${report.survival_36m_lo ?? '—'}% ; ${report.survival_36m_hi ?? '—'}%]</td>
      </tr>
    </tbody>
  </table>
  <p style="font-size: 9pt; color: #64748b; font-style: italic;">
    Profil de risque global calculé : <strong>${String(report.risk_profile || 'non disponible').toUpperCase()}</strong>.<br/>
    ⚠️ Estimations directionnelles basées sur le modèle de Cox structuré.
  </p>
  ` : ''}

  <h2>6. Clause de Non-Responsabilité</h2>
  <p style="font-size: 8.5pt; color: #64748b; font-style: italic; text-align: justify;">
    Ce rapport de diligence technique est automatisé selon la méthodologie d'analyse IRO Strength Velocity (protocole ${report.protocol_version}) et ne constitue pas une offre d'achat ou d'investissement. L'évaluation repose sur les éléments d'informations fournis par l'entreprise ou d'enrichissement de données publiques d'audit, sans audit comptable ou financier certifié.
  </p>
</body>
</html>`;

  const base64 = Buffer.from(html, 'utf-8').toString('base64');
  return res.json({
    base64,
    filename
  });
}
