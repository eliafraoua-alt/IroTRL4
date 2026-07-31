import React from 'react';
import { useIRO, GOLD_STANDARD_N } from '../../contexts/IROAnalysisContext';
import { buildIROMetadata } from '../../types/iro';
import { motion } from 'motion/react';
import { Activity, AlertTriangle, Clock, HelpCircle, Shield, TrendingUp, Zap } from 'lucide-react';
import ErrorBoundary from '../ErrorBoundary';
import SurvivalChart, { ICMethodBadge } from '../SurvivalChart';
import CompetingRisksPanel from '../CompetingRisksPanel';
import StartupPhasePanel from '../StartupPhasePanel';

export const SurvivalAnalysisView: React.FC = () => {
  const {
    result: r,
    history,
    rsf_available,
    currentSurvivalCurve,
    coxOnlyCurve,
    survivalRefs,
    velocity,
    honeymoon,
    diVelocity,
    loading,
    loadingStep,
    handleAnalyze,
    startup,
    error
  } = useIRO();

  const currentEntry = r ? history.find(h => h.result?.startup_name === r.startup_name) : null;
  const goldCalib = currentEntry?.gold ?? null;
  const dynamics = currentEntry?.dynamics ?? null;

  const phaseInput = r ? {
    age_mois: r.age_mois ?? 0,
    iro_score: r.iro?.score_100 ?? 0,
    iro_cr: r.srd?.iro_cr ?? 50,
    srd_score: r.srd?.srd_100 ?? 50,
    di: r.iro?.scores?.DI ?? 0,
    adc: r.iro?.scores?.ADC ?? 0,
    ipc: r.iro?.scores?.IPC ?? 0,
    ar: r.iro?.scores?.AR ?? 0,
    ca: r.iro?.scores?.CA ?? 0,
    gch: r.iro?.scores?.GCH ?? 0,
    vertical: r.vertical ?? 'SAAS',
    stade_financement: r.stade_financement ?? '',
    clients_actifs: r.clients_actifs ?? null,
    quadrant: r.srd?.quadrant ?? '',
  } : null;

  if (!r) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        {loading ? (
          <div className="bg-slate-900/60 border border-slate-800/85 rounded-2xl p-8 backdrop-blur-md shadow-2xl text-center space-y-6 relative overflow-hidden animate-in fade-in duration-300">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-slate-800 border-t-indigo-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-mono font-bold text-indigo-400">v7.0</span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-indigo-950/50 border border-indigo-500/20 text-indigo-400 text-[11px] font-bold tracking-widest uppercase">
                  Calculateur Actif
                </div>
                <h3 className="text-sm font-black text-slate-200">
                  Génération de l'Audit IRO pour {startup}...
                </h3>
              </div>
            </div>
            
            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/40 text-[10px] text-slate-400 max-w-sm mx-auto flex items-center justify-center gap-3">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping shrink-0" />
              <div className="text-left font-mono">
                <div className="font-extrabold text-slate-200 uppercase text-[11px]">Étape : {loadingStep}</div>
                <div className="text-slate-500 text-[11px] mt-0.5">
                  {loadingStep === 'collecting' && 'Extraction API Pappers / INPI / GitHub...'}
                  {loadingStep === 'analyzing' && 'Concertation multi-LLM (3 passes REV20)...'}
                  {loadingStep === 'calculating' && 'Evaluation des trajectoires de survie Cox...'}
                  {loadingStep === 'saving' && 'Persistance des variables d\'audit...'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 backdrop-blur-md shadow-2xl relative overflow-hidden text-center space-y-6 animate-in fade-in zoom-in-95 duration-250">
            {error && (
              <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 rounded-xl p-5 text-left text-xs space-y-2 relative overflow-hidden animate-in fade-in duration-200">
                <div className="absolute top-0 left-0 bottom-0 w-1 bg-rose-500" />
                <div className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-rose-450 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="flex-1 space-y-1">
                    <div className="font-extrabold text-slate-100 uppercase tracking-widest text-[10px]">
                      Échec de l'Analyse IRO
                    </div>
                    <p className="leading-relaxed font-mono">
                      {error}
                    </p>
                    <p className="text-slate-500 text-[12px] mt-2 italic">
                     Veuillez vous assurer que votre clé GEMINI_API_KEY est bien renseignée dans l'onglet des Secrets du projet.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="max-w-lg mx-auto space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-[10px] font-black uppercase tracking-widest">
                🛡️ Pas d'analyse disponible
              </div>
              <h2 className="text-xl font-black text-slate-100 uppercase tracking-tight">
                Analyse de Survie non disponible
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Aucune analyse de survie n'a encore été générée pour la startup active <strong className="text-indigo-400 font-extrabold">{startup}</strong>. Lancez l'analyse IRO multi-critères dès maintenant pour débloquer les courbes de risque :
              </p>
            </div>

            <button
              onClick={handleAnalyze}
              className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-550 hover:to-indigo-450 border border-indigo-500/30 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl cursor-pointer shadow-lg shadow-indigo-650/15 transition-all text-center flex items-center justify-center gap-2 mx-auto"
            >
              <span>Générer l'audit direct IRO</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 text-slate-200"
    >
      {/* Gold standard calibration status */}
      <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
        <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 flex items-center gap-1.5 uppercase">
          <Clock size={14} className="text-indigo-400" />
          Calibration Gold Standard — {r.startup_name}
        </div>
        {goldCalib ? (
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="text-center shrink-0">
              <div className="text-[10px] text-slate-500 mb-1">STATUT</div>
              <div className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                goldCalib.status === 'calibre' ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-500/20' : 'bg-amber-900/20 text-amber-500 border border-amber-500/20'
              }`}>
                {goldCalib.status.toUpperCase().replace('_', ' ')}
              </div>
            </div>
            <div className="text-center shrink-0">
              <div className="text-[10px] text-slate-500 mb-1">SCORE REF</div>
              <div className="text-xl font-black font-mono text-slate-200">{goldCalib.iro_ref}</div>
            </div>
            <div className="text-center shrink-0">
              <div className="text-[10px] text-slate-500 mb-1">DELTA</div>
              <div className={`text-xl font-black font-mono ${goldCalib.within_tolerance ? 'text-emerald-400' : 'text-amber-500'}`}>
                {goldCalib.delta > 0 ? '+' : ''}{goldCalib.delta} pts
              </div>
            </div>
            <div className="flex-1 text-[11px] text-slate-400 leading-relaxed italic bg-slate-950/40 p-3 rounded border border-slate-850">
              {goldCalib.within_tolerance 
                ? "L'analyse est parfaitement alignée avec le consensus des experts Delphi (tolérance restreinte ±5pts)."
                : "Dérive statistiquement détectée face au consensus Delphi. Veuillez vérifier et fact-checker rigoureusement les variables."}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic">Cette startup ne fait pas partie de la cohorte normative Gold Standard (n=10).</p>
        )}
      </div>

      {/* Model curves and Cox Risk Dashboard */}
      <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
        <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-3">
          <div className="text-xs text-slate-400 font-bold tracking-widest uppercase flex items-center gap-2">
            <Shield size={14} className="text-indigo-400" />
            {rsf_available ? "Modèle de Survie de Cox + RSF v6 (Ensemble 60/40)" : "Modèle de Survie Cox IRO v6"}
          </div>
          <div className="text-[10px] text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 italic font-mono">
            {rsf_available ? "TRL 2→3 · AUC ~0.79 (Cox+RSF)" : "TRL 2→3 · AUC 0.74 (Cox seul)"}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Survival Chart */}
          <div className="flex flex-col items-center">
            <ErrorBoundary fallback={<div className="h-[200px] flex items-center justify-center text-xs text-slate-500 italic">Erreur graphe survie</div>}>
              {currentSurvivalCurve && (
                <div className="w-full">
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
            </ErrorBoundary>
          </div>

          {/* Cox Dashboard */}
          <div className="space-y-4">
            <ErrorBoundary fallback={<div className="p-4 bg-slate-950 rounded border border-slate-800 text-xs text-slate-500 italic">Erreur dashboard de risque</div>}>
              {r?.cox_survival && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                      <div className="text-[11px] text-slate-500 mb-1">PROBA 12M</div>
                      <div className="text-base font-black text-slate-200">{(r.cox_survival.survival_12m * 100).toFixed(1)}%</div>
                      {r.cox_survival.survival_12m_lo != null && r.cox_survival.survival_12m_hi != null && (
                        <div className="text-[11px] text-slate-600 font-mono">
                          [{(r.cox_survival.survival_12m_lo * 100).toFixed(1)}-{(r.cox_survival.survival_12m_hi * 100).toFixed(1)}]
                        </div>
                      )}
                    </div>
                    
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                      <div className="text-[11px] text-slate-500 mb-1">PROBA 24M</div>
                      <div className="text-base font-black text-slate-200">{(r.cox_survival.survival_24m * 100).toFixed(1)}%</div>
                    </div>

                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                      <div className="text-[11px] text-slate-500 mb-1">PROBA 36M</div>
                      <div className="text-base font-black text-slate-200">{(r.cox_survival.survival_36m * 100).toFixed(1)}%</div>
                      {r.cox_survival.survival_36m_lo != null && r.cox_survival.survival_36m_hi != null && (
                        <div className="text-[11px] text-slate-600 font-mono">
                          [{(r.cox_survival.survival_36m_lo * 100).toFixed(1)}-{(r.cox_survival.survival_36m_hi * 100).toFixed(1)}]
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Profil de Risque Structurel</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                        r.cox_survival.risk_profile === 'critique' ? 'bg-red-900/40 text-red-500' :
                        r.cox_survival.risk_profile === 'élevé' ? 'bg-orange-900/40 text-orange-400' :
                        r.cox_survival.risk_profile === 'modéré' ? 'bg-amber-900/40 text-amber-400' : 'bg-emerald-900/40 text-emerald-400'
                      }`}>
                        {r.cox_survival.risk_profile}
                      </span>
                    </div>

                    <div className="space-y-1.5 border-t border-slate-800/60 pt-2">
                      {(Object.entries(r.cox_survival.beta_contributions) as [string, number][]).map(([label, val]) => (
                        <div key={`beta-${label}`} className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-400 italic">{label}</span>
                          <span className={`font-mono font-bold ${val > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {val > 0 ? '+' : ''}{val.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-850 flex items-center justify-between text-[10px]">
                      <span className="text-slate-500 italic">Hazard Ratio (HR) Élargi :</span>
                      <span className="text-xs font-black text-indigo-400 font-mono">{r.cox_survival.hazard_ratio}x</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed italic">
                    <b>Note méthodologique :</b> {r.cox_survival.confidence_note}
                    {r.cox_survival.ci_note && <><br/>{r.cox_survival.ci_note}</>}
                    {r.cox_survival.c_index_display && (
                      <><br/><b>C-index :</b> {r.cox_survival.c_index_display} ({r.cox_survival.c_index_interpretation}) | <b>EPV :</b> {r.cox_survival.epv_note}</>
                    )}
                    {r.cox_survival.lp_clip_note && (
                      <span className="block mt-1.5 p-2 rounded border border-amber-500/25 bg-amber-950/20 text-amber-300 not-italic text-[10px] font-medium leading-normal animate-pulse">
                        {r.cox_survival.lp_clip_note}
                      </span>
                    )}
                    <br/>L'Hazard Ratio exprime le sur-risque multiplicatif d'échec structurel par rapport à la médiane de la cohorte.
                  </p>

                  {r.competing_risks && (
                    <div className="mt-3">
                      <CompetingRisksPanel result={r.competing_risks} />
                    </div>
                  )}
                </>
              )}
            </ErrorBoundary>
          </div>
        </div>
      </div>

      {/* ── MODULE DEUX HORIZONS & FINANCIAL SUSTAINABILITY FACTOR (FSF) ── */}
      {r.dual_horizon && (
        <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="text-xs text-slate-400 font-bold tracking-widest uppercase flex items-center gap-2">
              <Activity size={14} className="text-indigo-400" />
              Analyse Deux Horizons & FSF — Module Synthèse
            </div>
            <div className="text-[10px] text-indigo-400 bg-indigo-950/40 px-2.5 py-1 rounded-full border border-indigo-500/20 font-bold font-mono">
              Horizon 18M vs 36M
            </div>
          </div>

          {/* Combined Reading / Diagnostic Note */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-850/60 relative overflow-hidden">
            <div className="absolute top-0 left-0 bottom-0 w-1 bg-indigo-500" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">Diagnostic Combiné Double Horizon</span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-black uppercase ${
                  r.dual_horizon.dominant_risk === 'aucun' ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-500/15' :
                  r.dual_horizon.dominant_risk === 'structurel' ? 'bg-indigo-950/50 text-indigo-400 border border-indigo-500/15' :
                  r.dual_horizon.dominant_risk === 'opérationnel' ? 'bg-amber-950/50 text-amber-500 border border-amber-500/15' :
                  'bg-rose-950/50 text-rose-500 border border-rose-500/15'
                }`}>
                  Risque dominant : {
                    r.dual_horizon.dominant_risk === 'aucun' ? 'Aucun' : 
                    r.dual_horizon.dominant_risk === 'structurel' ? 'Structurel (36M)' : 
                    r.dual_horizon.dominant_risk === 'opérationnel' ? 'Opérationnel (18M)' : 
                    'Structurel & Opérationnel'
                  }
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed font-sans font-medium">
                {r.dual_horizon.combined_reading}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Horizon Opérationnel (Court Terme 0-18 Mois) */}
            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/40 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Clock size={12} className="text-amber-400" />
                    Horizon Opérationnel (0-18m)
                  </h4>
                  {r.dual_horizon.operational.available && (
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold uppercase ${
                      r.fsf?.fsf_label === 'exceptionnel' ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-500/10' :
                      r.fsf?.fsf_label === 'solide' ? 'bg-indigo-900/30 text-indigo-400 border border-indigo-500/10' :
                      r.fsf?.fsf_label === 'sain' ? 'bg-cyan-900/30 text-cyan-400 border border-cyan-500/10' :
                      r.fsf?.fsf_label === 'fragile' ? 'bg-amber-900/30 text-amber-500 border border-amber-500/10' :
                      'bg-red-900/30 text-red-500 border border-red-500/10'
                    }`}>
                      FSF : {r.fsf?.fsf_label}
                    </span>
                  )}
                </div>

                {r.dual_horizon.operational.available ? (
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-slate-500">Financial Sustainability Factor (FSF)</span>
                      <span className="text-lg font-black font-mono text-slate-200">
                        {r.fsf?.fsf_score?.toFixed(2)} <span className="text-[10px] text-slate-500 font-normal">/ 4</span>
                      </span>
                    </div>

                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-850 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">Survie Opérationnelle (18m) :</span>
                        <span className="font-mono font-bold text-slate-200">
                          {r.fsf?.survival_18m_operational ? `${Math.round(r.fsf.survival_18m_operational * 100)}%` : '—'}
                        </span>
                      </div>
                      <p className="text-[12px] text-slate-400 leading-relaxed italic border-t border-slate-800/40 pt-1.5">
                        {r.fsf?.survival_18m_label}
                      </p>
                    </div>

                    {/* Sub-Metrics details */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-slate-900/30 p-2 rounded border border-slate-850 text-center">
                        <div className="text-[11px] text-slate-500 uppercase">LTV / CAC</div>
                        <div className="text-xs font-bold text-slate-300 font-mono">
                          {r.fsf?.ltv_cac_ratio != null ? `${r.fsf.ltv_cac_ratio}x` : 'N/A'}
                        </div>
                      </div>
                      <div className="bg-slate-900/30 p-2 rounded border border-slate-850 text-center text-ellipsis overflow-hidden">
                        <div className="text-[11px] text-slate-500 uppercase">Score ROAS</div>
                        <div className="text-xs font-bold text-slate-300 font-mono">
                          {r.fsf?.roas_score != null ? `${r.fsf.roas_score}/4` : 'N/A'}
                        </div>
                      </div>
                      <div className="bg-slate-900/30 p-2 rounded border border-slate-850 text-center">
                        <div className="text-[11px] text-slate-500 uppercase">Score Growth</div>
                        <div className="text-xs font-bold text-slate-300 font-mono">
                          {r.fsf?.growth_score != null ? `${r.fsf.growth_score}/4` : 'N/A'}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-950 text-[12px] text-slate-500 leading-relaxed italic border border-slate-850 rounded">
                    Données financières absentes pour cet horizon. FSF non calculable. La survie à court terme n'est pas modélisable. Aucun champ manquant ne pénalise la survie structurelle.
                  </div>
                )}
              </div>

              <div className="text-[11px] text-slate-600 italic">
                {r.dual_horizon.operational.note}
              </div>
            </div>

            {/* Horizon Structurel (Long Terme 0-36 Moins) */}
            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/40 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Shield size={12} className="text-indigo-400" />
                    Horizon Structurel (0-36m)
                  </h4>
                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold uppercase ${
                    r.dual_horizon.structural.risk_profile === 'faible' ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-500/10' :
                    r.dual_horizon.structural.risk_profile === 'modéré' ? 'bg-amber-900/30 text-amber-500 border border-amber-500/10' :
                    r.dual_horizon.structural.risk_profile === 'élevé' ? 'bg-orange-900/30 text-orange-500 border border-orange-500/10' :
                    'bg-red-900/30 text-red-500 border border-red-500/10'
                  }`}>
                    Risque : {r.dual_horizon.structural.risk_profile}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-slate-500">Survie Structurelle estimée (S36)</span>
                    <span className="text-lg font-black font-mono text-slate-200">
                      {Math.round(r.dual_horizon.structural.survival_36m * 100)}%
                      {r.dual_horizon.structural.survival_36m_lo != null && r.dual_horizon.structural.survival_36m_hi != null && (
                        <span className="text-[11px] text-slate-550 font-normal ml-1.5">
                          [{Math.round(r.dual_horizon.structural.survival_36m_lo * 100)}-{Math.round(r.dual_horizon.structural.survival_36m_hi * 100)}%]
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-850 space-y-2">
                    <p className="text-[12px] text-slate-400 leading-relaxed font-sans font-medium">
                      {r.dual_horizon.structural.label}
                    </p>
                    <div className="flex flex-wrap gap-1 border-t border-slate-800/40 pt-1.5">
                      <span className="text-[11px] text-slate-500 self-center mr-1">COVARIABLES ACTIVES :</span>
                      {r.dual_horizon.structural.covariables_used.map((cov, i) => (
                        <span key={`cov-${i}`} className="bg-slate-900 px-1 text-[7.5px] font-mono text-indigo-450 border border-slate-800 rounded">
                          {cov}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-600 italic">
                {r.dual_horizon.structural.note}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Indicators & Trajectory */}
      <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
        <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 uppercase flex justify-between items-center">
          <span>{buildIROMetadata(GOLD_STANDARD_N).ui_labels.horizon_label} & Indicateurs Dynamiques (v6.6)</span>
          {velocity && (
            <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded shadow-sm" style={{ background: `${velocity.velocity_color}20`, color: velocity.velocity_color, border: `1px solid ${velocity.velocity_color}40` }}>
              {velocity.velocity_label}
            </span>
          )}
        </div>
        
        <ErrorBoundary fallback={<div className="text-xs text-slate-500 italic">Erreur indicateurs dynamiques.</div>}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Global Velocity */}
            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800/50">
              <div className="text-[10px] text-slate-500 font-bold mb-3 uppercase tracking-tighter italic">Vélocité Globale (IVR)</div>
              <div className="flex items-end gap-2 mb-2">
                <div className="text-3xl font-black font-mono text-slate-100">{velocity?.velocity_global.toFixed(2) ?? dynamics?.ivr ?? '—'}</div>
                <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-widest pb-1 self-end">pts/mois</div>
              </div>
              <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden">
                <div 
                  className="h-full transition-all duration-500" 
                  style={{ 
                    width: velocity ? `${Math.min(100, (Math.abs(velocity.velocity_global) / 3) * 100)}%` : '0%',
                    backgroundColor: velocity?.velocity_color ?? '#818cf8'
                  }} 
                />
              </div>
              <div className="mt-3 text-[12px] text-slate-400 italic leading-relaxed">
                {velocity?.interpretation ?? 'Analysez cette startup une seconde fois pour activer la vélocité historique.'}
              </div>
            </div>

            {/* Trajectory and confidence */}
            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800/50 flex flex-col justify-between">
              <div>
                <div className="text-[10px] text-slate-500 font-bold mb-3 uppercase tracking-tighter italic">Trajectoire & Confiance</div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] text-slate-600 uppercase mb-1">Trajectoire</div>
                    <div className={`text-xs font-black uppercase flex items-center gap-1 ${
                      velocity?.trend === 'ascending' ? 'text-emerald-400' :
                      velocity?.trend === 'descending' ? 'text-red-400' : 
                      velocity?.trend === 'volatile' ? 'text-amber-400' : 'text-slate-400'
                    }`}>
                      {velocity?.trend === 'ascending' && '↗'}
                      {velocity?.trend === 'descending' && '↘'}
                      {velocity?.trend === 'stable' && '→'}
                      {velocity?.trend === 'volatile' && '≈'}
                      <span>{velocity?.trend ?? 'Stable'}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 uppercase mb-1">Confiance</div>
                    <div className={`text-xs font-black uppercase ${
                      velocity?.confidence === 'high' ? 'text-emerald-400' :
                      velocity?.confidence === 'medium' ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {velocity?.confidence ?? 'Medium'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-900 flex justify-between items-center text-[10px]">
                <span className="text-slate-500 italic">Delta Total :</span>
                <span className={`font-black ${velocity && velocity.delta_iro > 0 ? 'text-emerald-400' : 'text-slate-200'}`}>
                  {velocity && velocity.delta_iro > 0 ? '+' : ''}{velocity?.delta_iro.toFixed(1) ?? '0.0'} pts
                </span>
              </div>
            </div>

            {/* Projection 18M */}
            <div className="bg-gradient-to-br from-indigo-950/30 to-slate-950 rounded-xl p-4 border border-indigo-500/20">
              <div className="text-[10px] text-indigo-400 font-bold mb-3 uppercase tracking-tighter italic">Projection Stratégique 18M</div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-2xl font-black text-indigo-400 font-mono">
                  {velocity ? (velocity.snapshots[velocity.snapshots.length-1].iro_total + (velocity.velocity_global * 18)).toFixed(1) : dynamics?.iro_proj_18m ?? '—'}
                </div>
                <div className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[11px] text-indigo-400 font-bold">
                  PREDICTIVE
                </div>
              </div>
              <p className="text-[12px] text-slate-400 italic leading-relaxed">
                Basé sur l'hypothèse H5 : "La trajectoire IRO prédit mieux la survie à t₀+36 que le niveau absolu."
              </p>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-indigo-500 font-bold uppercase tracking-widest">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                Validité Normative : 88%
              </div>
            </div>
          </div>
        </ErrorBoundary>
      </div>

      {/* Honeymoon & Commoditization risks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Honeymoon section */}
        <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
          <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 uppercase">
            🍯 Honeymoon Effect (Fichman & Levinthal)
          </div>
          {honeymoon ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xl font-black text-slate-200 uppercase tracking-tighter">{honeymoon.stade}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest">Stade de maturation</div>
                </div>
                <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${
                  honeymoon.honeymoon_level === 'haute' ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/20' :
                  honeymoon.honeymoon_level === 'décroissante' ? 'bg-amber-950 text-amber-500 border border-amber-500/20' : 'bg-red-950 text-red-400 border border-red-500/20'
                }`}>
                  Honeymoon : {honeymoon.honeymoon_level}
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-500 font-bold uppercase mb-2">Risque de Mortalité</div>
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full animate-pulse ${honeymoon.mortality_peak ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-emerald-500 opacity-30'}`} />
                  <span className="text-xs text-slate-300 font-bold font-mono">
                    {honeymoon.mortality_peak ? 'CRÊTE DE MORTALITÉ DE FICHMAN-LEVINTHAL (12-24M)' : 'Zone de risque standard'}
                  </span>
                </div>
                <p className="text-[12px] text-slate-500 mt-2 leading-relaxed italic">
                  {honeymoon.interpretation}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/50">
                  <div className="text-[11px] text-slate-500 uppercase mb-1">Coût de Pivot</div>
                  <div className="text-xs font-black text-slate-300 uppercase">{honeymoon.pivot_cost}</div>
                </div>
                <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/50">
                  <div className="text-[11px] text-slate-500 uppercase mb-1">Poids Cox</div>
                  <div className="text-xs font-black text-indigo-400 font-mono">{honeymoon.weight.toFixed(2)}x</div>
                </div>
              </div>

              <div className="pt-2">
                <div className="text-[10px] text-indigo-400 font-bold uppercase mb-1">Action Prioritaire</div>
                <div className="text-xs text-slate-300 bg-indigo-500/5 p-2.5 rounded border border-indigo-500/10 italic">
                  {honeymoon.action_prioritaire}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center text-xs text-slate-500 italic">
              Données d'âge manquantes pour le profil d'immunité Honeymoon.
            </div>
          )}
        </div>

        {/* DI Decay Section */}
        <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
          <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 uppercase">
            ⚡ Vélocité de Commoditisation DI
          </div>
          {diVelocity ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-black text-indigo-400 font-mono">{diVelocity.di_effectif.toFixed(1)}/4</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest">DI Effectif (Pondéré Marché)</div>
                </div>
                <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${
                  diVelocity.risque_label === 'critique' ? 'bg-red-950 text-red-400 border border-red-500/20' :
                  diVelocity.risque_label === 'modéré' ? 'bg-amber-900/40 text-amber-400 border border-amber-500/20' : 'bg-emerald-900/20 text-emerald-400 border border-emerald-500/20'
                }`}>
                  Risque : {diVelocity.risque_label}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-slate-500 uppercase">Perte de Moat vs VMM ({diVelocity.vmm}/4)</span>
                    <span className="text-rose-500 font-bold font-mono">-{diVelocity.delta_depreciation.toFixed(1)} pts</span>
                  </div>
                  <div className="h-2 w-full bg-slate-950 rounded-full border border-slate-800 overflow-hidden">
                    <div 
                      className="h-full bg-rose-500 opacity-60 transition-all duration-700" 
                      style={{ width: `${(diVelocity.delta_depreciation / 4) * 100}%` }} 
                    />
                  </div>
                </div>
                
                <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                  <p className="text-[12px] text-slate-400 leading-relaxed">
                    <b>Interprétation :</b> {diVelocity.interpretation}
                  </p>
                </div>

                <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle size={12} className="text-amber-400" />
                    <span className="text-[10px] font-bold text-amber-400 uppercase">Avertissement de Commoditisation</span>
                  </div>
                  <p className="text-[11px] text-slate-550 italic leading-relaxed">
                    Le Moat technique (DI) s'érode à une vitesse de {diVelocity.vmm * 0.25}x par an par rapport au benchmark d'exposition produit.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center text-xs text-slate-500 italic">
              Scoring IRO requis pour calculer la vélocité DI.
            </div>
          )}
        </div>
      </div>

      {/* Development and Funding Phase */}
      {phaseInput && (
        <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
          <div className="text-xs text-slate-550 font-black tracking-widest mb-4 uppercase flex items-center gap-1.5">
            <Zap size={14} className="text-indigo-400" />
            Phase de Développement & Financement Indispensable
          </div>
          <ErrorBoundary>
            <StartupPhasePanel input={phaseInput} />
          </ErrorBoundary>
        </div>
      )}
    </motion.div>
  );
};
export default SurvivalAnalysisView;
