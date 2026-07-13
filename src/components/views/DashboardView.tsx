import React from 'react';
import { useIRO, AXES_CONFIG } from '../../contexts/IROAnalysisContext';
import { TRL_DESCRIPTIONS } from '../../types/iro';
import { motion } from 'motion/react';
import { AlertTriangle, Check, Cpu, ExternalLink, Shield, Sparkles, ClipboardList, PenTool, Database, Play, RotateCcw } from 'lucide-react';
import ErrorBoundary from '../ErrorBoundary';
import ScoreCard from '../ScoreCard';
import SurvivalChart, { ICMethodBadge } from '../SurvivalChart';
import StartupPhasePanel from '../StartupPhasePanel';
import { scoreColor, srdColor } from '../../utils/iro-engine';
import { compareWithCoxModel, LU_MODEL_METADATA } from '../../utils/lu-threshold-model';

const ProviderBadge: React.FC<{ provider: string; fallback: boolean }> = ({ provider, fallback }) => (
  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all ${
    fallback 
      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' 
      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
  }`}>
    {fallback ? <AlertTriangle size={10} /> : <Check size={10} />}
    {fallback ? 'Fallback' : 'Primary'}: {provider}
  </span>
);

/**
 * CORRECTIF F-05 — ConsensusQualityBanner
 *
 * Affiche un bandeau d'alerte visible quand :
 *   - n_providers < 2 : score basé sur un seul LLM (fiabilité réduite)
 *   - consensus_method === 'failure' : tous les providers ont échoué
 *   - divergence_alert : désaccord fort inter-passes (σ > seuil)
 *
 * Ce composant est le garde-fou UI contre les scores à source unique
 * qui atteindraient l'utilisateur sans consentement explicite.
 */
const ConsensusQualityBanner: React.FC<{ consensusReport: any }> = ({ consensusReport }) => {
  if (!consensusReport) return null;

  const { n_providers, consensus_method, divergence_alert, divergent_dims, convergence, is_true_multi_llm } = consensusReport;

  // Cas critique : aucun provider n'a répondu correctement
  if (consensus_method === 'failure' || n_providers === 0) {
    return (
      <div className="flex items-start gap-2 mt-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
        <AlertTriangle size={13} className="text-red-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Score non fiable</p>
          <p className="text-[9px] text-red-300/80 mt-0.5">
            Aucun provider LLM n'a pu générer un résultat valide. Les scores affichés sont des valeurs de secours neutres — <strong>ne pas utiliser pour une décision.</strong>
          </p>
        </div>
      </div>
    );
  }

  // Cas alerte : une seule passe a réussi
  if (n_providers === 1) {
    return (
      <div className="flex items-start gap-2 mt-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Source unique</p>
          <p className="text-[9px] text-amber-300/80 mt-0.5">
            Score basé sur <strong>1 seule passe LLM</strong> (2 passes ont échoué). La fiabilité est réduite — vérifiez la connexion API et relancez l'analyse.
          </p>
        </div>
      </div>
    );
  }

  // Cas divergence : désaccord inter-passes fort
  if (divergence_alert && divergent_dims?.length > 0) {
    return (
      <div className="flex items-start gap-2 mt-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Désaccord inter-passes</p>
          <p className="text-[9px] text-amber-300/80 mt-0.5">
            Variance élevée sur : <strong>{divergent_dims.join(', ')}</strong>. Convergence : {Math.round((convergence ?? 0) * 100)}%. Enrichissez la description pour stabiliser le scoring.
          </p>
        </div>
      </div>
    );
  }

  // Cas nominal : afficher la méthode utilisée (transparence)
  const methodLabel = is_true_multi_llm
    ? `Consensus multi-LLM · Convergence ${Math.round((convergence ?? 0) * 100)}%`
    : `3 passes Gemini · Convergence ${Math.round((convergence ?? 0) * 100)}%`;

  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      <Check size={10} className="text-emerald-400" />
      <span className="text-[9px] text-slate-500">{methodLabel}</span>
    </div>
  );
};

export const RadarChart: React.FC<{ scores: Record<string, number>; comparison?: Record<string, number>; size?: number }> = ({ scores, comparison, size = 190 }) => {
  const cx = size / 2, cy = size / 2, r = size / 2 - 28;
  const angles = [90, 30, -30, -90, -150, 150];
  const keys = ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'];

  const pt = (val: number, i: number) => {
    const a = (angles[i] * Math.PI) / 180;
    return [cx + r * (val / 4) * Math.cos(a), cy - r * (val / 4) * Math.sin(a)];
  };

  const poly = keys.map((k, i) => pt(scores[k] ?? 0, i).join(',')).join(' ');
  const polyComp = comparison ? keys.map((k, i) => pt(comparison[k] ?? 0, i).join(',')).join(' ') : null;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[1, 2, 3, 4].map(ring => (
        <polygon key={`ring-${ring}`}
          points={angles.map((a, i) => {
            const rad = a * Math.PI / 180;
            return `${cx + r * (ring / 4) * Math.cos(rad)},${cy - r * (ring / 4) * Math.sin(rad)}`;
          }).join(' ')}
          fill="none" stroke="#1e293b" strokeWidth="1" />
      ))}
      {angles.map((a, i) => {
        const rad = a * Math.PI / 180;
        return <line key={`axis-${i}`} x1={cx} y1={cy} x2={cx + r * Math.cos(rad)} y2={cy - r * Math.sin(rad)} stroke="#1e293b" strokeWidth="1" />;
      })}
      
      {polyComp && (
        <polygon points={polyComp} fill="rgba(148, 163, 184, 0.05)" stroke="#475569" strokeWidth="1" strokeDasharray="4 2" strokeLinejoin="round" />
      )}

      <polygon points={poly} fill="rgba(129,140,248,0.18)" stroke="#818cf8" strokeWidth="2" strokeLinejoin="round" />
      
      {AXES_CONFIG.map((ax, i) => {
        const [x, y] = pt(scores[ax.key] ?? 0, i);
        return <circle key={`point-${ax.key}`} cx={x} cy={y} r="4" fill={ax.color} />;
      })}
      
      {AXES_CONFIG.map((ax, i) => {
        const rad = (angles[i] * Math.PI) / 180;
        const lx = cx + (r + 20) * Math.cos(rad);
        const ly = cy - (r + 20) * Math.sin(rad);
        return (
          <text key={`label-${ax.key}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
            fontSize="10" fontWeight="805" fill={ax.color} fontFamily="monospace">
            {ax.short}
          </text>
        );
      })}
    </svg>
  );
};

const AXES_DETAILS: Record<string, {
  label: string;
  weight: string;
  description: string;
  scale: string[];
}> = {
  DI: {
    label: "Dépendance Infrastructurelle",
    weight: "18%",
    description: "Autonomie et souveraineté vis-à-vis des fournisseurs tiers de modèles d'IA (LLMs) et d'infrastructure de calcul.",
    scale: [
      "Wrapper total / simple proxy API standard d'un acteur tiers",
      "Dépendance forte vis-à-vis d'une API propriétaire exclusive",
      "Modèle hybride avec fine-tuning local ou orchestration multi-modèles",
      "Infrastructure partiellement propre et modèles hébergés sur serveurs dédiés",
      "Infrastructure et modèles entièrement propriétaires ou hébergés sans dépendance"
    ]
  },
  ADC: {
    label: "Actif de Données Cumulatif",
    weight: "22%",
    description: "Volume, unicité et barrière à l'entrée défensive générée par l'accumulation continue de données propriétaires (Flywheel).",
    scale: [
      "Aucune donnée propre / utilisation exclusive de données publiques",
      "Données génériques sans valeur d'exclusivité ou d'entraînement",
      "Données de niche sectorielles non structurées",
      "Actif de données sélectif à valeur VRIN partielle",
      "Actif de données exclusif, hautement structuré et VRIN complet"
    ]
  },
  IPC: {
    label: "Intégration dans les Processus Critiques",
    weight: "22%",
    description: "Niveau de pénétration au cœur des workflows opérationnels critiques de l'utilisateur final stimulant un fort coût de substitution.",
    scale: [
      "Aucune intégration opérationnelle / outil optionnel",
      "Intégration purement déclarative ou collaborative secondaire",
      "Utilisation active en environnement de production secondaire",
      "Workflow certifié, standardisé et interconnecté",
      "Système critique ou de pilotage absolument irremplaçable"
    ]
  },
  AR: {
    label: "Anticipation Réglementaire",
    weight: "13%",
    description: "Niveau de conformité anticipée (ex : AI Act, RGPD, ISO 42001) et détention de certifications sectorielles de haut niveau.",
    scale: [
      "Aucune démarche initiée / risque de non-conformité élevé",
      "Position purement réactive aux évolutions réglementaires obligatoires",
      "Démarche de conformité active et processus en cours",
      "Niveau de préparation avancé avec audits ou architectures adaptées",
      "Conformité native absolue par design et certifications formelles acquises"
    ]
  },
  CA: {
    label: "Capacité d'Adaptation",
    weight: "13%",
    description: "Aptitude de l'organisation à capter les ruptures technologiques (Sensing), s'en saisir (Seizing) et pivoter l'architecture (Reconfiguring).",
    scale: [
      "Structure rigide face aux vagues technologiques et ruptures",
      "Adaptation réactive mais lente avec inertie technique",
      "Architecture mixte facilitant des ajustements réguliers",
      "Anticipation proactive avec tests continus de nouvelles technologies",
      "Agilité démontrée avec capacité de pivot ou redéfinition technologique immédiate"
    ]
  },
  GCH: {
    label: "Gouvernance et Capital Humain",
    weight: "12%",
    description: "Track record de l'équipe fondatrice, séniorité technique (ex-GAFAM, doctorats), brevets industriels et publications académiques IA.",
    scale: [
      "Équipe généraliste sans background ni expertise technique IA",
      "Équipe junior ou avec première expérience IA émergente",
      "Équipe expérimentée dans le domaine technologique cible",
      "Équipe sénior d'experts chevronnés (ex-GAFAM, PhD)",
      "Recherche de pointe mondialement reconnue (publications majeures, brevets ou exits)"
    ]
  }
};

const DualModelComparisonPanel: React.FC<{ r: any }> = ({ r }) => {
  const startupName = r.startup_name || 'Startup Active';
  const luScore = r.iro?.scores?.LU ?? null;
  const coxHighRisk = r.cox_survival?.risk_profile === 'élevé' || r.cox_survival?.risk_profile === 'critique';
  
  // Call the model utility
  const comparison = compareWithCoxModel(startupName, luScore, coxHighRisk);
  const { lu_result: luResult, agreement, recommandation } = comparison;

  return (
    <ErrorBoundary>
      <div id="dual-model-comparison-card" className="bg-slate-900 rounded-xl p-5 border border-slate-800 shadow-xl">
        <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-indigo-400" />
            <h4 className="text-xs font-black text-indigo-400 tracking-widest uppercase font-mono">
              Supervision Dual-Modèle : Cox (7 Variables) vs LU≥2 (Stable)
            </h4>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            Calibré : {LU_MODEL_METADATA.calibrated_at}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
          {/* Section Gauche : Modèle de Cox */}
          <div className="md:col-span-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800/50 flex flex-col justify-between">
            <div>
              <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-2 font-mono">
                1. Modèle de Cox (7 Variables)
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-400">Profil de Risque :</span>
                {r.cox_survival ? (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                    r.cox_survival.risk_profile === 'critique' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                    r.cox_survival.risk_profile === 'élevé' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                    r.cox_survival.risk_profile === 'modéré' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 
                    'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {r.cox_survival.risk_profile}
                  </span>
                ) : (
                  <span className="text-slate-500 italic text-[11px]">Non calculé</span>
                )}
              </div>
              
              <div className="space-y-2 mt-2">
                <div className="flex justify-between items-center text-[11px] border-b border-slate-900 pb-1.5">
                  <span className="text-slate-400">Survie à 36m :</span>
                  <span className="font-mono font-bold text-slate-200">
                    {r.cox_survival ? `${(r.cox_survival.survival_36m * 100).toFixed(1)}%` : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[11px] border-b border-slate-900 pb-1.5">
                  <span className="text-slate-400">Hazard Ratio :</span>
                  <span className="font-mono font-bold text-slate-200">
                    {r.cox_survival?.hazard_ratio ? r.cox_survival.hazard_ratio.toFixed(2) : '—'}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="mt-4 pt-3 border-t border-slate-900/50 flex flex-col gap-1">
              <span className="text-[8px] text-slate-500 uppercase font-bold font-mono">
                Marge d'erreur statistique
              </span>
              <p className="text-[9px] text-slate-400 leading-normal">
                Faible EPV ({r.cox_survival?.epv?.toFixed(2) || '1.29-1.86'}). Risque élevé d'instabilité des coefficients individuels (jusqu'à 38% de flip de signe).
              </p>
            </div>
          </div>

          {/* Section Milieu : Statut de Concordance & Recommandation */}
          <div className="md:col-span-4 flex flex-col justify-between p-4 rounded-xl border border-slate-800/50 bg-slate-950/20 text-center relative overflow-hidden">
            {/* Background glowing aura based on agreement */}
            <div className={`absolute -top-12 -left-12 w-24 h-24 rounded-full blur-2xl pointer-events-none opacity-20 ${
              luResult.risk_level === 'INDÉTERMINÉ' ? 'bg-slate-500' :
              agreement ? 'bg-emerald-500' : 'bg-red-500'
            }`} />

            <div className="z-10">
              <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-3 font-mono">
                Statut de Concordance
              </div>

              {luResult.risk_level === 'INDÉTERMINÉ' ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-500/10 border border-slate-500/20 text-slate-400 rounded-full text-[10px] font-black uppercase tracking-wider mb-3">
                  Score LU Manquant
                </div>
              ) : agreement ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-black uppercase tracking-wider mb-3">
                  <Check size={12} className="text-emerald-400" />
                  Accord de Modèles
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/15 border border-rose-500/30 text-rose-400 rounded-full text-[10px] font-black uppercase tracking-wider mb-3 animate-pulse">
                  <AlertTriangle size={12} className="text-rose-400" />
                  Divergence Détectée
                </div>
              )}

              <p className="text-[10px] text-slate-300 leading-relaxed font-sans mt-2 italic px-1">
                "{recommandation}"
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/50 text-left z-10">
              <span className="text-[8px] text-slate-500 uppercase font-bold font-mono block mb-1">
                Protocole de révision humaine
              </span>
              <p className="text-[9px] text-slate-400 leading-tight">
                {agreement 
                  ? "Les signaux d'orientation concordent. La validité décisionnelle est optimale." 
                  : "Désaccord détecté : le modèle simple à EPV élevé contredit le modèle de Cox complexe. Vérifier impérativement les évidences qualitatives."}
              </p>
            </div>
          </div>

          {/* Section Droite : Modèle LU>=2 */}
          <div className="md:col-span-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800/50 flex flex-col justify-between">
            <div>
              <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-2 font-mono">
                2. Modèle Simple (LU ≥ 2)
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-400">Niveau de Risque :</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                  luResult.risk_level === 'INDÉTERMINÉ' ? 'bg-slate-800 text-slate-400 border border-slate-700' :
                  luResult.risk_level === 'ÉLEVÉ' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                  'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                }`}>
                  {luResult.risk_level}
                </span>
              </div>

              {/* Graphic Slider comparing LU to actual threshold */}
              <div className="my-4 px-1">
                <div className="flex justify-between text-[8px] text-slate-500 font-mono mb-1">
                  <span>LU = 0</span>
                  <span className="text-red-400 font-bold">Seuil (2.0)</span>
                  <span>LU = 4</span>
                </div>
                
                <div className="h-2 bg-slate-900 rounded-full relative border border-slate-800">
                  {/* Seuil marker line */}
                  <div className="absolute top-0 bottom-0 left-[50%] w-0.5 bg-red-400/80 z-10" />
                  
                  {/* Colored progress bar up to current score */}
                  {!Number.isNaN(luResult.lu_score) && (
                    <div 
                      className={`h-full rounded-full transition-all ${
                        luResult.seuil_franchi ? 'bg-emerald-500/40' : 'bg-red-500/40'
                      }`}
                      style={{ width: `${(luResult.lu_score / 4) * 100}%` }}
                    />
                  )}
                  
                  {/* Actual LU Score Dot pointer */}
                  {!Number.isNaN(luResult.lu_score) && (
                    <div 
                      className="absolute -top-1 w-3.5 h-3.5 rounded-full bg-slate-200 border-2 shadow-md transition-all cursor-pointer flex items-center justify-center text-[7px] font-black text-slate-950"
                      style={{ 
                        left: `calc(${(luResult.lu_score / 4) * 100}% - 7px)`,
                        borderColor: luResult.seuil_franchi ? '#10b981' : '#f43f5e'
                      }}
                      title={`Score LU Actuel : ${luResult.lu_score}`}
                    >
                      {luResult.lu_score}
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center text-[9px] text-slate-400 mt-2">
                  <span>Statut : {luResult.seuil_franchi ? "✓ Seuil Franchi (LU≥2)" : "✗ Sous le Seuil"}</span>
                  <span className="font-mono">LP : {Number.isNaN(luResult.linear_predictor) ? '—' : luResult.linear_predictor.toFixed(4)}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-900/50 flex flex-col gap-1">
              <span className="text-[8px] text-slate-500 uppercase font-bold font-mono">
                Stabilité statistique validée
              </span>
              <p className="text-[9px] text-slate-400 leading-normal">
                Haut EPV ({luResult.epv_du_modele}). Bootstrap (2000 passes) : 0.0% de changement de signe. Robustesse garantie par design minimaliste.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
};

export const DashboardView: React.FC = () => {
  const {
    result: r,
    lastRouterResult,
    dimOpen,
    setDimOpen,
    quad,
    bm,
    currentSurvivalCurve,
    coxOnlyCurve,
    rsf_available,
    survivalRefs,
    phaseAnalysis,
    setTab,
    diEvidence,
    setDiPanelOpen,
    startup,
    loading,
    loadingStep,
    handleAnalyze,
    setPitchMode,
    setModelPanelOpen,
    setVaultPanelOpen,
    setAgentMode,
    error
  } = useIRO();

  if (!r) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 backdrop-blur-md shadow-2xl relative overflow-hidden"
        >
          {/* Background decoration lines */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

          {error && (
            <div className="mb-6 bg-rose-950/40 border border-rose-500/30 text-rose-300 rounded-xl p-5 text-left text-xs space-y-2 relative overflow-hidden animate-in fade-in duration-200">
              <div className="absolute top-0 left-0 bottom-0 w-1 bg-rose-500" />
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-rose-400 shrink-0 w-4 h-4 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="font-extrabold text-slate-100 uppercase tracking-widest text-[10px]">
                    Échec de l'Analyse IRO
                  </div>
                  <p className="leading-relaxed font-mono">
                    {error}
                  </p>
                  <p className="text-slate-500 text-[10px] mt-2 italic">
                    Veuillez vérifier que la variable d'environnement GEMINI_API_KEY est bien configurée dans les Réglages/Secrets du projet.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="text-center max-w-2xl mx-auto mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-[10px] font-black uppercase tracking-widest mb-4">
              <Sparkles size={12} className="animate-pulse" />
              Moteur d'Audit IRO Multi-Modulaire v7.0
            </div>
            
            <h2 className="text-2xl font-black text-slate-100 uppercase tracking-tight leading-tight">
              Analyse de robustesse longitudinale
            </h2>
            <p className="text-slate-400 mt-2 text-sm leading-relaxed">
              Pour initier l'audit normatif multi-critères, le scoring IRO (6 Axes) et le profilage SRD de <strong className="text-indigo-400 font-extrabold">{startup}</strong>, veuillez sélectionner l'une des voies d'entrée ci-dessous :
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Option 1: Diagnostic Direct Gemini / Local */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-5 hover:border-slate-700/80 hover:bg-slate-950 transition-all flex flex-col justify-between group">
              <div>
                <div className="text-indigo-500 mb-3 bg-indigo-500/10 w-9 h-9 rounded-lg flex items-center justify-center font-bold">
                  <Play size={16} />
                </div>
                <h3 className="font-extrabold text-sm text-slate-200 group-hover:text-indigo-400 transition-colors">
                  🚀 Générer l'audit direct IRO
                </h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Déclencher l'évaluation normative instantanée de l'entité active via les agents d'intelligence Gemini. Analyse probabiliste préliminaire de l'environnement concurrentiel.
                </p>
              </div>
              <button
                disabled={loading}
                onClick={handleAnalyze}
                className="mt-4 w-full cursor-pointer bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-550 hover:to-indigo-450 text-white font-extrabold text-[11px] uppercase tracking-wider py-2 rounded-lg transition-all text-center flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Calcul en cours ({loadingStep})...</span>
                  </>
                ) : (
                  <>
                    <span>Démarrer l'audit direct</span>
                  </>
                )}
              </button>
            </div>

            {/* Option 2: Pitch Mode & Multimodality */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-5 hover:border-slate-700/80 hover:bg-slate-950 transition-all flex flex-col justify-between group">
              <div>
                <div className="text-yellow-500 mb-3 bg-yellow-500/10 w-9 h-9 rounded-lg flex items-center justify-center font-bold">
                  <PenTool size={16} />
                </div>
                <h3 className="font-extrabold text-sm text-slate-200 group-hover:text-yellow-400 transition-colors">
                  📝 Mode Pitch & Deck
                </h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Collez un résumé, un pitch-deck textuel ou une transcription de démo. Le processeur d'extraction NLP se chargera d'isoler les signaux faibles pour alimenter la prise de décision.
                </p>
              </div>
              <button
                onClick={() => setPitchMode(true)}
                className="mt-4 w-full cursor-pointer bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white font-extrabold text-[11px] uppercase tracking-wider py-2 rounded-lg transition-all text-center"
              >
                Activer le Pitch Mode
              </button>
            </div>

            {/* Option 3: Modèle Structurel de Fonctionnement */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-5 hover:border-slate-700/80 hover:bg-slate-950 transition-all flex flex-col justify-between group">
              <div>
                <div className="text-emerald-500 mb-3 bg-emerald-500/10 w-9 h-9 rounded-lg flex items-center justify-center font-bold">
                  <ClipboardList size={16} />
                </div>
                <h3 className="font-extrabold text-sm text-slate-200 group-hover:text-emerald-400 transition-colors">
                  📋 Modèle de fonctionnement (Axe par Axe)
                </h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Renseignez précisément les infrastructures de calcul, brevets, volume et exclusivité data, nature des contrats clients, certifications réglementaires (AI Act / RGPD) et structure GCH.
                </p>
              </div>
              <button
                onClick={() => setModelPanelOpen(true)}
                className="mt-4 w-full cursor-pointer bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white font-extrabold text-[11px] uppercase tracking-wider py-2 rounded-lg transition-all text-center"
              >
                Remplir fiche structurelle
              </button>
            </div>

            {/* Option 4: IRO Vault (Historique / Diagnostics enregistrés) */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-5 hover:border-slate-700/80 hover:bg-slate-950 transition-all flex flex-col justify-between group">
              <div>
                <div className="text-purple-500 mb-3 bg-purple-500/10 w-9 h-9 rounded-lg flex items-center justify-center font-bold">
                  <Database size={16} />
                </div>
                <h3 className="font-extrabold text-sm text-slate-200 group-hover:text-purple-400 transition-colors">
                  🗄️ Ouvrir le IRO Vault
                </h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Recharger instantanément un audit existant stocké localement ou naviguer dans la base de données rétrospective des audits terminés (Alma Health, Luko, Toucan Toco, etc.).
                </p>
              </div>
              <button
                onClick={() => setVaultPanelOpen(true)}
                className="mt-4 w-full cursor-pointer bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white font-extrabold text-[11px] uppercase tracking-wider py-2 rounded-lg transition-all text-center"
              >
                Consulter le Vault
              </button>
            </div>

          </div>

          <div className="mt-8 pt-6 border-t border-slate-800/80 text-center text-[10px] text-slate-600 flex items-center justify-center gap-1">
            <span>Moteur d'Audit IRO certifié</span>
            <span>·</span>
            <span>Mise à jour Millésime 2026 — Version v7.0.0</span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-5"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Card 1: Radar Dimension and Scoring Metrics */}
        <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
          <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 flex justify-between items-center">
            <span>SCORE IRO v7</span>
            {lastRouterResult && (
              <ProviderBadge 
                provider={lastRouterResult.providerUsed} 
                fallback={lastRouterResult.fallbackTriggered} 
              />
            )}
          </div>
          <div className="flex justify-center mb-3">
            <ErrorBoundary fallback={<div className="h-[190px] flex items-center justify-center text-slate-500 text-[10px]">Erreur Graphe</div>}>
              <RadarChart scores={r.iro?.scores ?? {}} size={190} />
            </ErrorBoundary>
          </div>
          <div className="mt-1">
            <ErrorBoundary>
              <ScoreCard
                score={r.iro?.score_100 ?? 0}
                interpretation={r.iro?.interpretation ?? 'Non disponible'}
                floor_activated={r.flags?.floor_activated ?? false}
                ancrage_warning={r.flags?.ancrage_warning ?? false}
                score_optimiste={Math.min(100, (r.iro?.score_100 ?? 0) + 8)}
                score_pessimiste={Math.max(0, (r.iro?.score_100 ?? 0) - 10)}
                confiance_globale={r.iro?.ipc_confiance ?? 0.7}
              />
              <div className="text-xs text-slate-500 mt-2 text-center">
                {r.secteur} · {r.age_mois}m · {r.stade_financement}
              </div>
              
              <button
                disabled={loading}
                onClick={handleAnalyze}
                title="Relancer tous les audits et recalculer tous les scores IRO/SRD pour cette startup"
                className="mt-3.5 w-full cursor-pointer bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white font-extrabold text-[11px] uppercase tracking-wider py-2 rounded-lg transition-all text-center flex items-center justify-center gap-2"
              >
                <RotateCcw size={12} className={loading ? 'animate-spin' : ''} />
                <span>{loading ? 'Calcul IRO en cours...' : 'Relancer le calcul de l\'audit'}</span>
              </button>
              
              {/* CORRECTIF F-05 : bandeau de qualité consensus */}
              <ConsensusQualityBanner consensusReport={r.consensus_report} />
              
              {phaseAnalysis && (() => {
                const badgeColor = phaseAnalysis.isEstablished 
                  ? phaseAnalysis.entityInfo.color 
                  : (phaseAnalysis.phase?.color ?? '#818cf8');
                const roundLabel = phaseAnalysis.isEstablished
                  ? (phaseAnalysis.transformation?.financement_recommande?.label ?? 'Transformation IA')
                  : (phaseAnalysis.recommendedRound?.label ?? '—');
                const roundIcon = phaseAnalysis.isEstablished
                  ? (phaseAnalysis.transformation?.financement_recommande?.icon ?? '🏦')
                  : (phaseAnalysis.recommendedRound?.icon ?? '');
                const roundColor = phaseAnalysis.isEstablished
                  ? (phaseAnalysis.transformation?.financement_recommande?.color ?? phaseAnalysis.entityInfo.color)
                  : (phaseAnalysis.recommendedRound?.color ?? badgeColor);
                return (
                  <button
                    onClick={() => setTab('phase')}
                    className="mt-2 w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-lg border transition-all hover:opacity-90 cursor-pointer"
                    style={{ background: badgeColor + '12', borderColor: badgeColor + '30' }}
                    title="Voir le détail Phase & Levée"
                  >
                    <span className="text-sm">{phaseAnalysis.type.emoji}</span>
                    <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: badgeColor }}>
                      {phaseAnalysis.type.label}
                    </span>
                    <span className="text-[8px] text-slate-600 mx-1">·</span>
                    <span className="text-[9px] font-bold" style={{ color: roundColor }}>
                      {roundIcon} {roundLabel}
                    </span>
                  </button>
                );
              })()}
            </ErrorBoundary>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800">
            <div className="text-[10px] text-slate-500 font-bold tracking-widest mb-3 uppercase">Détail des 7 Axes IRO</div>
            {AXES_CONFIG.map(ax => {
              const val = r.iro?.scores?.[ax.key as keyof typeof r.iro.scores] ?? 0;
              const open = !!dimOpen[ax.key];
              const details = AXES_DETAILS[ax.key];
              const justificationText = (r.iro?.justifications as any)?.[ax.key] || "Preuve factuelle en cours d'analyse ou déclaratif direct.";

              return (
                 <div key={`overview-ax-${ax.key}`} className="mb-2 border-b border-slate-800/50 last:border-0 pb-2">
                  <div 
                    className="flex items-center gap-2 cursor-pointer hover:bg-slate-800/30 rounded px-1.5 py-1"
                    onClick={() => setDimOpen(prev => ({ ...prev, [ax.key]: !prev[ax.key] }))}
                  >
                    <span className="text-[10px] font-black w-8" style={{ color: ax.color }}>{ax.short}</span>
                    <div className="flex-1 h-1.5 bg-slate-800 rounded">
                      <div className="h-1.5 rounded transition-all" style={{ width: `${(val / 4) * 100}%`, background: ax.color }} />
                    </div>
                    <span className="text-[10px] font-mono font-bold w-6 text-right" style={{ color: ax.color }}>{val}</span>
                    <span className="text-slate-600 text-[10px]">{open ? '▲' : '▼'}</span>
                  </div>

                  {open && details && (
                    <div className="mt-2.5 ml-1.5 p-3 bg-slate-950/80 rounded-lg border border-slate-800/60 text-left text-xs space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
                      <div>
                        <div className="text-[10px] font-black tracking-wider uppercase mb-0.5" style={{ color: ax.color }}>
                          {details.label} <span className="text-slate-500 font-normal">· Poids {details.weight}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-normal">
                          {details.description}
                        </p>
                      </div>

                      {/* Échelle de score */}
                      <div className="border-t border-slate-900 pt-2.5 space-y-1.5">
                        <div className="text-[8px] text-slate-500 uppercase font-black tracking-wider mb-1">Échelle de score IRO v4.5-S46</div>
                        {details.scale.map((desc, idx) => {
                          const isCurrent = idx === Math.round(val);
                          return (
                            <div key={`${ax.key}-scale-${idx}`} className={`flex gap-2 items-start p-1.5 rounded transition-all ${
                              isCurrent 
                                ? 'bg-indigo-950/20 border border-indigo-500/20' 
                                : 'opacity-40 hover:opacity-80'
                            }`}>
                              <div className={`w-4 h-4 rounded text-[9px] font-black flex items-center justify-center shrink-0 ${
                                isCurrent 
                                  ? 'text-white' 
                                  : 'text-slate-500 bg-slate-900/40'
                              }`} style={isCurrent ? { background: ax.color } : undefined}>
                                {idx}
                              </div>
                              <div className="flex-1 text-[9.5px] leading-tight">
                                <span className={isCurrent ? 'font-black text-slate-200' : 'text-slate-400'}>
                                  {desc}
                                </span>
                                {isCurrent && (
                                  <span className="ml-2 inline-block text-[7px] px-1 py-0.2 rounded font-black uppercase text-slate-100 bg-emerald-500/20 text-emerald-400 border border-emerald-500/35">
                                    Niveau Actuel
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Justification de l'analyse */}
                      <div className="border-t border-slate-900 pt-2.5">
                        <div className="text-[8px] text-slate-500 uppercase font-black tracking-wider mb-1">Preuves & Justification de l'Audit</div>
                        <p className="text-[9.5px] text-slate-300 leading-relaxed italic bg-slate-900/30 p-2 rounded border border-slate-900/40">
                          "{justificationText}"
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 2: SRD Calibration and variables */}
        <div className="flex flex-col gap-4">
          <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
            <div className="text-xs text-slate-500 font-bold tracking-widest mb-3">SRD · IRO CORRIGÉ</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="text-center">
                <div className="text-3xl font-black font-mono" style={{ color: srdColor(r.srd.srd_100) }}>
                  {r.srd.srd_100}
                </div>
                <div className="text-xs font-bold mt-1" style={{ color: srdColor(r.srd.srd_100) }}>
                  {r.srd.interpretation}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">SRD</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black font-mono" style={{ color: scoreColor(r.srd.iro_cr) }}>
                  {r.srd.iro_cr}
                </div>
                <div className="text-xs text-slate-500 mt-1">Ajusté Risque</div>
              </div>
            </div>
            {quad && (
              <div className="rounded-lg px-3 py-2 text-center"
                style={{ background: quad.color + '20', borderLeft: `3px solid ${quad.color}` }}>
                <div className="text-sm font-black" style={{ color: quad.color }}>
                  {quad.emoji} {r.srd.quadrant}
                </div>
                <div className="text-xs mt-0.5" style={{ color: quad.color + 'cc' }}>{quad.action}</div>
              </div>
            )}
          </div>

          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 flex-1">
            <div className="text-xs text-slate-500 font-bold tracking-widest mb-3">VARIABLES SRD</div>
            {[
              { key: 'VMM', label: 'Vélocité Marché LLM', color: '#f97316' },
              { key: 'NCD', label: 'Concurrents Directs',  color: '#ef4444' },
              { key: 'DFL', label: 'Dépendance LLM',       color: '#a78bfa' },
            ].map(v => {
              const scoreObj = r.srd[v.key as 'VMM' | 'NCD' | 'DFL'];
              const val = scoreObj.score;
              const open = !!dimOpen[v.key];
              return (
                 <div key={`srd-var-${v.key}`} className="mb-2 border-b border-slate-800/50 last:border-0 pb-1">
                  <div 
                    className="flex items-center gap-2 cursor-pointer hover:bg-slate-800/30 rounded px-1 py-0.5"
                    onClick={() => setDimOpen(prev => ({ ...prev, [v.key]: !prev[v.key] }))}
                  >
                    <span className="text-xs font-bold w-10 text-slate-300" style={{ color: v.color }}>{v.key}</span>
                    <div className="flex-1 h-2 bg-slate-800 rounded">
                      <div className="h-2 rounded transition-all" style={{ width: `${(val / 4) * 100}%`, background: v.color }} />
                    </div>
                    <span className="text-xs font-mono font-bold w-10 text-right text-slate-200" style={{ color: v.color }}>{val}/4</span>
                    <span className="text-slate-600 text-[10px]">{open ? '▲' : '▼'}</span>
                  </div>
                  {open && scoreObj.justification && (
                    <div className="mt-1 px-1">
                      <p className="text-[10px] text-slate-400 leading-tight italic">{scoreObj.justification}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 3: Benchmark and survival curves */}
        <div className="flex flex-col gap-4">
          {bm && (
            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
              <div className="text-xs text-slate-500 font-bold tracking-widest mb-3 uppercase">
                Benchmark {r.vertical}
              </div>
              <div className="grid grid-cols-2 gap-2 mb-1">
                {[
                  { l: 'Percentile', v: `P${bm.pct}`, c: '#60a5fa' },
                  { l: 'Position',   v: bm.pos,      c: '#00c896' },
                  { l: 'IRO Relatif', v: `${bm.rel > 0 ? '+' : ''}${bm.rel}σ`, c: bm.rel >= 0 ? '#00c896' : '#ef4444' },
                  { l: 'IRO Ajusté', v: bm.adj, c: scoreColor(bm.adj) },
                ].map(m => (
                  <div key={`bm-stat-${m.l}`} className="bg-slate-950 rounded-lg p-2 text-center">
                    <div className="text-lg font-black font-mono leading-none mb-1" style={{ color: m.c }}>{m.v}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">{m.l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 flex-1">
            <div className="text-xs text-slate-500 font-bold tracking-widest mb-3 uppercase flex items-center justify-between">
              <span>Probabilité de Survie</span>
              {r.cox_survival && (
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                  r.cox_survival.risk_profile === 'critique' ? 'bg-red-900/45 text-red-400' :
                  r.cox_survival.risk_profile === 'élevé' ? 'bg-orange-900/45 text-orange-400' :
                  r.cox_survival.risk_profile === 'modéré' ? 'bg-amber-900/45 text-amber-400' : 'bg-emerald-900/45 text-emerald-400'
                }`}>
                  {r.cox_survival.risk_profile}
                </span>
              )}
            </div>
            {currentSurvivalCurve && (
              <div className="h-[140px]">
                <SurvivalChart 
                  startupName={r.startup_name}
                  mainCurve={currentSurvivalCurve} 
                  coxOnlyCurve={coxOnlyCurve}
                  rsf_available={rsf_available}
                  references={survivalRefs as any} 
                />
                {r?.cox_survival && (
                  <ICMethodBadge 
                    ci_method={r.cox_survival.ci_method} 
                    ci_note={r.cox_survival.ci_note} 
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <DualModelComparisonPanel r={r} />

      {/* TRL & Functioning model section */}
      {(r.trl || (r.validation_logs && r.validation_logs.length > 0)) && (
        <ErrorBoundary>
          <div className="bg-slate-900 rounded-xl p-5 border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs text-indigo-400 font-bold tracking-widest uppercase flex items-center gap-2">
                <Shield size={14} className="text-indigo-500" />
                Modèle de fonctionnement & TRL
              </div>
              {r.trl && (
                <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 text-[10px] font-black font-mono border border-indigo-500/30">
                  TRL {r.trl.niveau}
                </span>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {r.trl && (
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-2">Maturité Technologique</div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                     <div className="text-xs font-bold text-slate-300 mb-1">{TRL_DESCRIPTIONS[r.trl.niveau]}</div>
                     <p className="text-[10px] text-slate-500 leading-relaxed italic">
                       Niveau de maturité déclaré par l'utilisateur comme base de l'audit.
                     </p>
                  </div>
                </div>
              )}
              
              {r.validation_logs && r.validation_logs.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-2">Règles IRO Appliquées</div>
                  <div className="space-y-1.5">
                    {r.validation_logs.map((log, i) => (
                      <div key={`vlog-app-${i}`} className="flex gap-2 items-start text-[10px] text-slate-400 bg-slate-950/50 p-2 rounded border border-slate-800/50">
                        <div className="w-1 h-1 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />
                        <span>{log}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
              <div className="flex gap-4">
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-500 uppercase font-bold">Vertical</span>
                  <span className="text-[11px] font-mono font-bold text-slate-300">{r.vertical}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-500 uppercase font-bold">Infra Propre</span>
                  <span className={`${r.di_infra_propre ? 'text-emerald-400' : 'text-slate-500'} text-[11px] font-mono font-bold`}>
                    {r.di_infra_propre ? 'OUI' : 'NON'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-500 uppercase font-bold">Conf. IPC</span>
                  <span className="text-[11px] font-mono font-bold text-amber-500">{((r.iro?.ipc_confiance ?? 0.7) * 100)}%</span>
                </div>
              </div>
              <div className="text-[9px] text-slate-600 italic">
                Validation REV29-33 active
              </div>
            </div>
          </div>
        </ErrorBoundary>
      )}

      {/* DI Research Evidence Panel */}
      {diEvidence && (
        <div className="bg-gradient-to-br from-slate-900 to-indigo-950/20 rounded-xl p-5 border border-indigo-500/20 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-indigo-400" />
              <span className="text-xs font-black text-indigo-400 tracking-widest uppercase">
                DI Evidence — Recherche Web Structurée v7.0
              </span>
              <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ml-2 ${
                diEvidence.di_confiance === 'haute' ? 'bg-emerald-500/15 text-emerald-400' :
                diEvidence.di_confiance === 'moyenne' ? 'bg-amber-500/15 text-amber-400' :
                'bg-red-500/15 text-red-400'
              }`}>
                Confiance {diEvidence.di_confiance}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl font-black font-mono text-indigo-400">
                {diEvidence.di_score_recommande}/4
              </div>
              <button
                onClick={() => setDiPanelOpen(true)}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 px-2 py-1 rounded font-bold cursor-pointer transition-colors"
              >
                Relancer
              </button>
            </div>
          </div>

          <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800 mb-4">
            <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-1.5">
              Justification DI enrichie (5 points)
            </div>
            <p className="text-[10px] text-slate-300 leading-relaxed">
              {diEvidence.di_justification_enrichie}
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
            {[
              { label: 'GitHub ML', active: diEvidence.github?.has_ml_repos ?? false, val: diEvidence.github ? `${diEvidence.github.stars} ★` : '—' },
              { label: 'Fine-tuning', active: diEvidence.flags.fine_tuning_doc, val: diEvidence.flags.fine_tuning_doc ? 'Documenté' : 'Non détecté' },
              { label: 'Brevets IA', active: diEvidence.flags.brevets_ia, val: `${diEvidence.patents?.brevets_ia ?? 0} brevet(s)` },
              { label: 'RAG custom', active: diEvidence.flags.rag_custom, val: diEvidence.flags.rag_custom ? 'Oui' : 'Non' },
              { label: 'GPU cluster', active: diEvidence.flags.infra_gpu, val: diEvidence.flags.infra_gpu ? 'Détecté' : 'Non' },
              { label: 'Modèle propre', active: diEvidence.flags.modele_propre, val: diEvidence.flags.modele_propre ? 'Oui' : 'Non' },
            ].map(f => (
              <div key={f.label} className={`rounded-lg p-2 text-center border ${
                f.active
                  ? 'bg-emerald-500/10 border-emerald-500/20'
                  : 'bg-slate-800/40 border-slate-700/50'
              }`}>
                <div className={`text-[10px] font-bold ${f.active ? 'text-emerald-400' : 'text-slate-600'}`}>{f.val}</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider">{f.label}</div>
              </div>
            ))}
          </div>

          {diEvidence.sources_verifiees.length > 0 && (
            <div>
              <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-1.5">
                Sources vérifiées ({diEvidence.sources_verifiees.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {diEvidence.sources_verifiees.map(url => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[9px] rounded font-bold hover:bg-indigo-500/20 transition-colors"
                  >
                    {url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                    <ExternalLink size={8} />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 text-[9px] text-slate-600 italic border-t border-slate-800 pt-2">
            Qualité de recherche : {diEvidence.research_quality}% · {diEvidence.loading_steps.length} étapes · {new Date(diEvidence.timestamp).toLocaleString('fr-FR')}
          </div>
        </div>
      )}

      {!diEvidence && (
        <div className="bg-slate-900/50 rounded-xl p-4 border border-dashed border-indigo-500/20 text-center">
          <Cpu size={20} className="text-indigo-800 mx-auto mb-2" />
          <p className="text-[10px] text-slate-600 italic">
            Cliquez sur <strong className="text-indigo-400">DI Research</strong> dans la barre d'outils pour lancer la recherche web structurée et consolider le score DI avec des preuves factuelles.
          </p>
        </div>
      )}
    </motion.div>
  );
};
export default DashboardView;
