/**
 * ReportContent.tsx — Antigravity Intelligence Platform
 * Contenu complet du rapport d'analyse pour affichage et export PDF
 */

import React from 'react';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import ScoreCard from './ScoreCard';
import VerdictPanel from './VerdictPanel';
import DimensionChart from './DimensionChart';
import SurvivalChart from './SurvivalChart';
import CompetingRisksPanel from './CompetingRisksPanel';
import { AXES_CONFIG, srdColor, scoreColor } from '../utils/iro-engine';

interface ReportContentProps {
  result: any;
  currentSurvivalCurve: any;
  survivalRefs: any;
  bm?: any;
  sect?: any;
  quad?: any;
  goldCalib?: any;
}

const ReportContent: React.FC<ReportContentProps> = ({ 
  result: r, 
  currentSurvivalCurve, 
  survivalRefs, 
  bm, 
  sect, 
  quad,
  goldCalib 
}) => {
  if (!r) return null;

  return (
    <div className="space-y-8 bg-slate-950 p-8 text-slate-200 min-h-screen">
      {/* Header Rapport */}
      <div className="border-b border-slate-800 pb-6 mb-8 flex justify-between items-end">
        <div>
          <div className="text-2xl font-black tracking-tighter text-white mb-1">
            RAPPORT D'ANALYSE STRATÉGIQUE IRO
          </div>
          <div className="text-xs text-slate-500 uppercase tracking-widest font-mono">
            {r.startup_name} · v5.0 · {new Date().toLocaleDateString()}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black font-mono text-indigo-400">
            {r.iro?.score_100 ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">
            Score IRO Final
          </div>
        </div>
      </div>

      {/* Grid 1: Vision Globale */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
           <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 uppercase">Profil de Robustesse</div>
           <DimensionChart scores={r.iro?.scores ?? {}} justifications={r.iro?.justifications ?? { DI: '', ADC: '', IPC: '', AR: '', CA: '', GCH: '' }} confiance={r.iro?.ipc_confiance ?? 0.7} />
        </div>
        
        <div className="space-y-6">
          <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
            <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 uppercase">Synthèse Exécutive</div>
            <ScoreCard
              score={r.iro?.score_100 ?? 0}
              interpretation={r.iro?.interpretation ?? 'Non disponible'}
              floor_activated={r.flags?.floor_activated ?? false}
              ancrage_warning={r.flags?.ancrage_warning ?? false}
              score_optimiste={Math.min(100, (r.iro?.score_100 ?? 0) + 8)}
              score_pessimiste={Math.max(0, (r.iro?.score_100 ?? 0) - 10)}
              confiance_globale={r.iro?.ipc_confiance ?? 0.7}
            />
          </div>

          <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
            <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 uppercase">Analyse de Risque SRD</div>
            <div className="flex items-center justify-between mb-4">
               <div>
                 <div className="text-2xl font-black font-mono" style={{ color: srdColor(r.srd?.srd_100 ?? 50) }}>{r.srd?.srd_100 ?? 50}</div>
                 <div className="text-[10px] text-slate-500 uppercase">Score SRD</div>
               </div>
               <div className="text-right">
                 <div className="text-2xl font-black font-mono" style={{ color: scoreColor(r.srd?.iro_cr ?? 50) }}>{r.srd?.iro_cr ?? 50}</div>
                 <div className="text-[10px] text-slate-500 uppercase">IRO Corrigé</div>
               </div>
            </div>
            {quad && (
              <div className="rounded-lg px-3 py-2 text-center bg-slate-950 border-l-4" style={{ borderColor: quad.color }}>
                <div className="text-sm font-black" style={{ color: quad.color }}>
                  {quad.emoji} {r.srd?.quadrant || 'Non déterminé'}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">{quad.action}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid 2: Survie & Benchmark */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800 col-span-2">
           <div className="text-xs text-slate-500 font-bold tracking-widest mb-6 uppercase">Modèle de Survie de Cox & Benchmarking</div>
           <div className="grid grid-cols-3 gap-6">
              <div className="col-span-2">
                {currentSurvivalCurve && (
                  <SurvivalChart 
                    startupName={r.startup_name}
                    mainCurve={currentSurvivalCurve} 
                    references={survivalRefs as any} 
                  />
                )}
              </div>
              <div className="space-y-4">
                 {r.competing_risks && (
                   <div className="mb-4">
                     <CompetingRisksPanel result={r.competing_risks} />
                   </div>
                 )}
                 {bm && (
                   <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-500 font-bold mb-3 uppercase tracking-widest">Position Marché</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 border border-slate-800 rounded text-center">
                          <div className="text-lg font-black text-indigo-400">P{bm.pct}</div>
                          <div className="text-[11px] text-slate-500 uppercase">Percentile</div>
                        </div>
                        <div className="p-2 border border-slate-800 rounded text-center">
                          <div className="text-lg font-black text-emerald-400">{bm.pos}</div>
                          <div className="text-[11px] text-slate-500 uppercase">Région</div>
                        </div>
                      </div>
                   </div>
                 )}
                 {r.cox_survival && (
                   <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-500 font-bold mb-3 uppercase tracking-widest">Risque Startup</div>
                      <div className="flex justify-between items-center mb-2">
                         <span className="text-[10px] text-slate-400 font-mono italic">36M Survival</span>
                         <span className="text-sm font-black text-indigo-400">{((r.cox_survival?.survival_36m ?? 0) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                         <span className="text-[10px] text-slate-400 font-mono italic">Risk Level</span>
                         <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${
                           r.cox_survival?.risk_profile === 'critique' ? 'bg-red-900/40 text-red-400' :
                           r.cox_survival?.risk_profile === 'élevé' ? 'bg-orange-900/40 text-orange-400' :
                           r.cox_survival?.risk_profile === 'modéré' ? 'bg-amber-900/40 text-amber-400' : 'bg-emerald-900/40 text-emerald-400'
                         }`}>
                           {r.cox_survival?.risk_profile}
                         </span>
                      </div>
                   </div>
                 )}
              </div>
           </div>
        </div>
      </div>

      {/* Grid 3: Verdict & Modèle */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
           <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 uppercase">Verdict Investisseur</div>
           <VerdictPanel
               verdict={{
                 viabilite: (r.srd?.iro_cr ?? 50) >= 46 ? 'viable' : ((r.srd?.iro_cr ?? 50) >= 35 ? 'viable_sous_conditions' : 'non_viable'),
                 financement: (r.srd?.srd_100 ?? 50) <= 44 ? 'recommande' : ((r.srd?.srd_100 ?? 50) <= 64 ? 'conditionnel' : 'deconseille'),
                 horizon_risque_mois: r.srd?.horizon_risque_mois ?? 12,
                 red_flags: r.synthese?.risques || [],
                 forces_cles: r.synthese?.forces || [],
                 iro_100: r.iro?.score_100 ?? r.srd?.iro_cr ?? 50,
               }}
              forces={r.synthese?.forces || []}
              risques={r.synthese?.risques || []}
              recommandation={r.synthese?.recommandation || "Non renseignée"}
              verdict_investisseur={r.synthese?.verdict_investisseur || "Non déterminé"}
              iro_es={r.iro_es}
            />
        </div>
        
        <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
           <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 uppercase">Modèle de fonctionnement & TRL</div>
           <div className="space-y-4">
              {r.trl && (
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 mb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Niveau TRL</span>
                    <span className="text-sm font-black text-indigo-400">TRL {r.trl.niveau}</span>
                  </div>
                  <p className="text-[12px] text-slate-500 italic">{r.trl.description}</p>
                </div>
              )}
              
              {r.validation_logs && r.validation_logs.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Règles Appliquées</div>
                  {r.validation_logs.map((log: string, i: number) => (
                    <div key={`vlog-rep-${i}`} className="flex items-center gap-2 text-[10px] text-slate-300 bg-slate-950/50 p-2 rounded border border-slate-800">
                      <div className="w-1 h-1 rounded-full bg-indigo-500" />
                      {log}
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Paramètres Modèle</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Vertical</span>
                    <span className="text-slate-300">{r.vertical}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Infra Propre</span>
                    <span className="text-slate-300">{r.di_infra_propre ? 'Oui' : 'Non'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Conf. IPC</span>
                    <span className="text-slate-300">{((r.iro?.ipc_confiance ?? 0.7) * 100)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Conf. ADC</span>
                    <span className="text-slate-300">{((r.iro?.confidence?.ADC ?? 1.0) * 100)}%</span>
                  </div>
                </div>
              </div>
           </div>
        </div>
      </div>

      {/* Grid 4: Hypothèses */}
      <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
         <div className="text-xs text-slate-500 font-bold tracking-widest mb-4 uppercase">Validation des Hypothèses</div>
         <div className="grid grid-cols-2 gap-4">
            {(Object.entries(r.hypotheses ?? {}) as [string, { signal: string; observation: string }][]).map(([h_id, h]) => (
              <div key={`h-rep-${h_id}`} className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded bg-slate-950 flex items-center justify-center text-[10px] font-black flex-shrink-0 border border-slate-800">
                  {h_id}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-[11px] font-black uppercase ${
                      h.signal === 'favorable' ? 'text-green-400' :
                      h.signal === 'défavorable' ? 'text-red-400' : 'text-amber-400'
                    }`}>
                      {h.signal}
                    </span>
                  </div>
                  <p className="text-[12px] text-slate-400 leading-tight">{h.observation}</p>
                </div>
              </div>
            ))}
         </div>
      </div>

      {/* Footer Disclaimer */}
      <div className="mt-8 pt-6 border-t border-slate-800 text-center">
        <p className="text-[11px] text-slate-600 italic max-w-2xl mx-auto leading-relaxed">
          <b>Disclaimer :</b> Ce rapport constitue un outil d'aide à la décision basé sur le framework normatif IRO v5.0. 
          Les scores et probabilités calculés ne sauraient constituer une garantie de performance future ou une recommandation d'investissement ferme. 
          Antigravity Intelligence Platform décline toute responsabilité quant aux décisions prises sur la base de ce rapport.
        </p>
      </div>
    </div>
  );
};

export default ReportContent;
