import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { getPrompt } from '../prompts/registry';
// [FIX 2026-07-08] Import du moteur canonique unique — voir note en tête de computeIRO() ci-dessous.
import { calcIRO, calcInteractionBonus, interpIRO } from '../utils/iro-engine';
import { recordLLMCall, estimateCostUSD } from '../utils/llm-metrics';
import { collectGreySources, formatGreySourcesContext } from '../collectors/grey-sources';
import { collectPressIntelligence, formatPressIntelligenceContext } from '../collectors/press-intelligence';

/**
 * batch_iro.ts — Logic port of batch_gemini_iro.py
 * IRO Strength v5 — Antigravity Intelligence Platform
 *
 * B1 : Prompts chargés depuis src/prompts/registry.ts
 * B3 : Tokens + coût enregistrés via llm-metrics.ts
 */

const MODEL_NAME = 'gemini-3-flash-preview';
const TEMPERATURE = 0.1;
const MAX_TOKENS = 2048;

// B1 : Chargement depuis le registry centralisé
const IRO_PROMPT     = getPrompt('iro-scoring');
const SYSTEM_PROMPT  = IRO_PROMPT.systemInstruction;
const PROMPT_VERSION = `${IRO_PROMPT.id}@${IRO_PROMPT.version}`;
console.log(`[Batch IRO] Prompt registry : ${PROMPT_VERSION}`);

const USER_PROMPT_TEMPLATE = `BLOC 1 — CONTEXTE STARTUP
Startup : {name}
Secteur : {sector}
Description : {description}
Informations additionnelles : {context}
Sources à consulter : {sources}

BLOC 2 — DONNÉES SOURCES GRISES (vérifiées indépendamment du deck)
RÈGLE : priorité sur les déclarations du deck en cas de contradiction.
Si FLAG BLOQUANT (liquidation_judiciaire) détecté → score=0, statut=BLOCKED.
{grey_context}

BLOC 2 BIS — REVUE DE PRESSE EXHAUSTIVE (pipeline NLP indépendant du deck)
RÈGLE : en cas de contradiction pitch/presse signalée MAJEURE ou BLOQUANTE, la
priorité va à la presse ; documenter l'écart dans manques_information.
{press_context}

BLOC 3 — SCORING DIMENSIONNEL (3 passes REV)
Effectue 3 passes successives indépendantes.
Passe 1 : scoring initial depuis les informations fournies.
Passe 2 : vérification des contradictions et biais possibles.
Passe 3 : consolidation avec niveaux de confiance finaux.
Retourne uniquement le résultat consolidé de la passe 3.

BLOC 3 — DÉTECTION PATTERNS GOODHART
Vérifie les 6 patterns :
1. ADC=4 et IPC≤1 → données sans usage client
2. AR≥3 et DI=0 → conformité sans infrastructure
3. GCH=4 et CA≤1 → équipe star sans agilité
4. IPC≥3 et ADC≤1 → intégration sans actif data
5. Toutes dimensions ≥3 → profil trop homogène
6. DI=4 et ADC≤1 → infrastructure sans données

BLOC 4 — FORMAT DE SORTIE JSON STRICT
{
  "startup": "{name}",
  "analyse_date": "{date}",
  "modele": "gemini-3-flash-preview",
  "passe": 3,
  "dimensions": {
    "DI":  {"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"},
    "ADC": {"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"},
    "IPC": {"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"},
    "AR":  {"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"},
    "CA":  {"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"},
    "GCH": {"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"}
  },
  "goodhart_patterns": [],
  "sources_utilisees": [],
  "manques_information": [],
  "note_evaluateur": "<observation clé sur le profil>"
}`;

interface CohorteStartup {
  name: string;
  sector: string;
  description: string;
  status: string;
  siren?: string;
  website?: string;
}

const COHORTE_TRL4: CohorteStartup[] = [
  // Actives — secteurs diversifiés
  { name: 'Coreweave', sector: 'Cloud GPU IA', description: 'Infrastructure GPU cloud pour entraînement LLMs', status: 'active' },
  { name: 'Cohere', sector: 'LLM enterprise', description: 'Modèles de langage déployables on-premise enterprise', status: 'active' },
  { name: 'Scale AI', sector: 'Data labeling IA', description: 'Annotation données ML à grande échelle', status: 'active' },
  { name: 'Qdrant', sector: 'Vector database IA', description: 'Base de données vectorielle pour RAG', status: 'active' },
  { name: 'Replit', sector: 'IDE IA code', description: 'Environnement développement avec IA intégrée', status: 'active' },
  { name: 'Runway ML', sector: 'IA vidéo générative', description: 'Génération et édition vidéo par IA', status: 'active' },
  { name: 'Perplexity AI', sector: 'Moteur recherche IA', description: 'Recherche conversationnelle avec citations', status: 'active' },
  { name: 'LangChain', sector: 'Framework LLM', description: 'Orchestration agents et pipelines LLM', status: 'active' },
  { name: 'Modjo', sector: 'IA conversation sales', description: 'Analyse appels commerciaux et coaching', status: 'active' },
  { name: 'Slite', sector: 'Base de connaissance IA', description: 'Documentation d\'entreprise avec recherche IA', status: 'active' },
  // Échecs documentés
  { name: 'Adept AI', sector: 'Agent IA autonome', description: 'Agent IA pour tâches bureau — pivot 2024', status: 'failed' },
  { name: 'Embra', sector: 'Assistant IA Mac', description: 'Assistant IA natif macOS — fermé 2024', status: 'failed' },
  { name: 'Mem.ai', sector: 'Mémoire IA personnelle', description: 'Prise de notes IA — difficultés 2024', status: 'failed' },
  { name: 'Typeface', sector: 'IA contenu marketing', description: 'Génération contenu brand — pivot 2024', status: 'failed' },
  { name: 'Synthesis', sector: 'IA éducation enfants', description: 'Tutor IA mathématiques — restructuré 2024', status: 'failed' },
  { name: 'Harvey AI precursor', sector: 'LegalTech IA générique', description: 'LLM juridique sans données propriétaires — substituté', status: 'failed' },
  { name: 'Fixie.ai', sector: 'Agent IA web', description: 'Agents conversationnels web — shutdown 2024', status: 'failed' },
  { name: 'Inflection Pi v1', sector: 'LLM B2C empathique', description: 'Chatbot empathique — absorbé Microsoft 2024', status: 'failed' },
  { name: 'Stability AI Audio', sector: 'IA audio générative', description: 'Division audio Stability — cédée 2024', status: 'failed' },
  { name: 'Magic.dev', sector: 'IA code complet', description: 'Agent coding 1M tokens context — pivot B2B', status: 'failed' },
];

interface DimensionEntry {
  score: number;
  confiance: number;
  justification: string;
}

interface IROComputed {
  iro_100: number;
  srd_proxy: number;
  iro_cr: number;
  level: string;
}

interface IROAnalysis {
  startup: string;
  analyse_date: string;
  modele: string;
  passe: number;
  dimensions: {
    DI: DimensionEntry;
    ADC: DimensionEntry;
    IPC: DimensionEntry;
    AR: DimensionEntry;
    CA: DimensionEntry;
    GCH: DimensionEntry;
    // [FIX 2026-07-08] LU était déjà demandé et retourné par le prompt LLM
    // (voir src/prompts/registry.ts, bloc "LU (15%)") mais jamais déclaré ni
    // consommé ici — la dimension était silencieusement ignorée du scoring.
    LU: DimensionEntry;
  };
  goodhart_patterns: string[];
  sources_utilisees: string[];
  manques_information: string[];
  note_evaluateur: string;
  iro_computed?: IROComputed;
  status_ground_truth?: string;
}

/**
 * [FIX 2026-07-08] Modèle unifié avec iro-engine.ts.
 *
 * AVANT : cette fonction réimplémentait localement une version simplifiée du
 * calcul IRO — 6 dimensions seulement (LU absent de l'objet `scores`, alors
 * que le prompt LLM la demande et la retourne déjà), sans bonus d'interaction
 * DI×ADC/IPC×GCH, sans les règles REV12/REV13, et avec une normalisation
 * différente (brut/4 sans diviser par la somme des poids). Le résultat
 * divergeait silencieusement du moteur "officiel" utilisé par l'application
 * interactive (src/utils/iro-engine.ts), et la dimension lead user n'était
 * jamais prise en compte dans les scores générés par ce script de batch —
 * bien qu'elle représente 15% du poids théorique du modèle.
 *
 * APRÈS : délègue le calcul du score à calcIRO() + calcInteractionBonus(),
 * les mêmes fonctions que celles utilisées par l'application interactive,
 * en y incluant explicitement LU. La classification textuelle utilise
 * désormais interpIRO() (seuils officiels : 80/65/46, cf. SEUIL_VIABILITE
 * dans iro-engine.ts) au lieu des seuils ad hoc précédents (90/75/50/25),
 * qui ne correspondaient à aucune source documentée.
 *
 * srd_proxy et iro_cr restent calculés localement (proxy de confiance simple
 * DI/ADC/IPC/GCH) : ils ne font pas partie du problème signalé (absence de
 * LU) et le modèle SRD complet d'iro-engine.ts (VMM/NCD/DFL) repose sur des
 * entrées que ce pipeline de batch ne collecte pas actuellement.
 */
function computeIRO(dims: IROAnalysis['dimensions']): IROComputed {
  const scores: Record<string, number> = {
    DI:  dims.DI.score,
    ADC: dims.ADC.score,
    IPC: dims.IPC.score,
    AR:  dims.AR.score,
    CA:  dims.CA.score,
    GCH: dims.GCH.score,
    LU:  dims.LU.score,
  };

  const ipcConf = dims.IPC.confiance;
  const adcConf = dims.ADC.confiance;
  const gchConf = dims.GCH.confiance;

  // Même appel que iro-engine.ts::computeIRO() : calcIRO (poids + REV1/12/13)
  // puis ajout du bonus d'interaction DI×ADC / IPC×GCH.
  const iroBrut = calcIRO(scores, ipcConf, undefined, adcConf, gchConf);
  const interaction = calcInteractionBonus(scores);
  const iro = Math.max(0, Math.min(100, Math.round((iroBrut + interaction.bonus_total) * 10) / 10));

  // Proxy de confiance local (inchangé) — voir note ci-dessus.
  const mean_conf = (ipcConf + adcConf + gchConf) / 3;
  const srd_est = parseFloat(((1 - mean_conf) * 60).toFixed(1));
  const irocr = parseFloat((iro * (1 - srd_est / 200)).toFixed(1));

  // Classification alignée sur le moteur canonique (seuils officiels 80/65/46).
  const level = interpIRO(iro);

  return { iro_100: iro, srd_proxy: srd_est, iro_cr: irocr, level };
}

export async function runBatch() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('ERREUR : GEMINI_API_KEY manquante.'));
    process.exit(1);
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  const outputDir = path.join(process.cwd(), 'data', 'annotations');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(chalk.bold.blue('\n🚀 Démarrage Batch IRO Pipeline (TS v1.0)\n'));

  const results: IROAnalysis[] = [];

  for (const startup of COHORTE_TRL4) {
    const filename = `${startup.name.toLowerCase().replace(/ /g, '_')}.json`;
    const outPath = path.join(outputDir, filename);

    if (fs.existsSync(outPath)) {
      console.log(chalk.gray(`SKIP : ${startup.name}`));
      results.push(JSON.parse(fs.readFileSync(outPath, 'utf8')));
      continue;
    }

    try {
      console.log(chalk.cyan(`Scoring : ${startup.name}...`));

      // [v7.6] Collecte des sources grises
      // [v8.0] Collecte presse (Presse Intelligence) — en parallèle, non-bloquante
      let greyCtx = '';
      let pressCtx = '';
      try {
        const [greyResult, pressResult] = await Promise.allSettled([
          collectGreySources(startup.name, {
            sirenOrSiret: startup.siren,
            websiteUrl:   startup.website,
          }),
          collectPressIntelligence(startup.name, {
            pitchText: startup.description,
          }),
        ]);
        greyCtx  = greyResult.status  === 'fulfilled' && greyResult.value  ? formatGreySourcesContext(greyResult.value)   : '';
        pressCtx = pressResult.status === 'fulfilled' && pressResult.value ? formatPressIntelligenceContext(pressResult.value) : '';
      } catch {
        greyCtx = '';
        pressCtx = '';
      }
      
      const prompt = USER_PROMPT_TEMPLATE
        .replace(/{name}/g, startup.name)
        .replace('{sector}', startup.sector)
        .replace('{description}', startup.description)
        .replace('{context}', 'Aucune information supplémentaire.')
        .replace('{sources}', 'site web, Crunchbase, LinkedIn, presse tech')
        .replace('{grey_context}', greyCtx || 'Sources grises non disponibles pour cette analyse.')
        .replace('{press_context}', pressCtx || 'Revue de presse non disponible pour cette analyse.')
        .replace('{date}', new Date().toISOString().split('T')[0]);

      const t0 = Date.now();

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: TEMPERATURE,
          maxOutputTokens: MAX_TOKENS,
          responseMimeType: 'application/json',
        }
      });

      if (!response.text) throw new Error('Réponse vide de Gemini');

      const usage = response.usageMetadata as any;
      const promptTokens  = usage?.promptTokenCount     ?? 0;
      const outputTokens  = usage?.candidatesTokenCount ?? 0;
      const costUSD       = estimateCostUSD(MODEL_NAME, promptTokens, outputTokens);
      const latencyMs     = Date.now() - t0;

      recordLLMCall({
        provider:      'Gemini',
        modelId:       MODEL_NAME,
        latencyMs,
        success:       true,
        promptTokens,
        outputTokens,
        costUSD,
        timestamp:     Date.now(),
        promptId:      'iro-scoring',
      });

      const analysis: IROAnalysis = JSON.parse(response.text);
      analysis.iro_computed = computeIRO(analysis.dimensions);
      analysis.status_ground_truth = startup.status;

      fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2));
      console.log(chalk.green(`✓ ${startup.name} — IRO=${analysis.iro_computed.iro_100} [${analysis.iro_computed.level}] (Coût: $${costUSD.toFixed(5)}, Latence: ${latencyMs}ms)`));
      results.push(analysis);

      // Rate limit safety
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`✗ Erreur pour ${startup.name} :`), msg);
      recordLLMCall({
        provider:  'Gemini',
        modelId:   MODEL_NAME,
        latencyMs: 0,
        success:   false,
        timestamp: Date.now(),
        promptId:  'iro-scoring',
      });
    }
  }

  generateReporting(results, outputDir);
}

function generateReporting(results: IROAnalysis[], outputDir: string) {
  const csvPath = path.join(process.cwd(), 'data', 'annotations', 'batch_report.csv');
  const header = [
    'startup', 'status_ground_truth', 'analyse_date',
    'DI', 'DI_conf', 'ADC', 'ADC_conf',
    'IPC', 'IPC_conf', 'AR', 'AR_conf',
    'CA', 'CA_conf', 'GCH', 'GCH_conf',
    'iro_100', 'srd_proxy', 'iro_cr', 'level'
  ].join(',');

  const rows = results.map(r => {
    if (!r || !r.dimensions || !r.iro_computed) return '';
    const d = r.dimensions;
    const c = r.iro_computed;
    return [
      r.startup, r.status_ground_truth, r.analyse_date,
      d.DI.score, d.DI.confiance,
      d.ADC.score, d.ADC.confiance,
      d.IPC.score, d.IPC.confiance,
      d.AR.score, d.AR.confiance,
      d.CA.score, d.CA.confiance,
      d.GCH.score, d.GCH.confiance,
      c.iro_100, c.srd_proxy, c.iro_cr, c.level
    ].join(',');
  }).filter(row => row !== '').join('\n');

  fs.writeFileSync(csvPath, `${header}\n${rows}`);
  console.log(chalk.bold.green(`\n📊 Rapport consolidé généré : ${csvPath}`));
  
  printSummary(results);
}

function printSummary(results: IROAnalysis[]) {
  const valid = results.filter((r): r is Required<Pick<IROAnalysis, 'iro_computed' | 'status_ground_truth'>> & IROAnalysis => 
    r !== null && r.iro_computed !== undefined && r.status_ground_truth !== undefined
  );
  const actives = valid.filter(r => r.status_ground_truth === 'active');
  const failed = valid.filter(r => r.status_ground_truth === 'failed');

  const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  
  const iroAct = actives.map(r => r.iro_computed.iro_100);
  const iroFai = failed.map(r => r.iro_computed.iro_100);
  
  const delta = mean(iroAct) - mean(iroFai);

  console.log('\n' + '═'.repeat(60));
  console.log('  RAPPORT BATCH — IRO Strength v5');
  console.log('═'.repeat(60));
  console.log(`  Actives          : ${actives.length} — IRO moy. = ${mean(iroAct).toFixed(1)}`);
  console.log(`  Échecs           : ${failed.length} — IRO moy. = ${mean(iroFai).toFixed(1)}`);
  console.log(`  Δ séparation     : ${delta.toFixed(1)} pts`);
  console.log('═'.repeat(60));
  
  if (delta >= 15) {
    console.log(chalk.bold.green('  ✓ TRL 4 Atteint : Séparation significative démontrée (>15 pts)'));
  } else {
    console.log(chalk.bold.yellow('  ⚠ TRL 4 non atteint : Séparation insuffisante (<15 pts)'));
  }
}
