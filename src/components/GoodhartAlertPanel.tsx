import React, { useState } from 'react';
import { GoodhartAlert } from '../types/iro';
import { AlertTriangle, ChevronDown, ChevronUp, Info, Activity } from 'lucide-react';

interface GoodhartAlertPanelProps {
  alert: GoodhartAlert;
}

const GoodhartAlertPanel: React.FC<GoodhartAlertPanelProps> = ({ alert }) => {
  const [expanded, setExpanded] = useState(false);

  if (!alert.triggered) return null;

  const graph_res = alert.graph_reasoning;
  const tensions = graph_res?.tensions ?? [];

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-amber-500/30 bg-slate-900 shadow-xl transition-all duration-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-amber-500/5 focus:outline-none"
      >
        <div className="flex items-center gap-2.5 text-amber-400 font-bold text-sm">
          <AlertTriangle size={18} className="text-amber-400 shrink-0" />
          <span>
            Profil atypique — {alert.patterns.length} pattern(s)
            {tensions.length > 0 && ` & ${tensions.length} tension(s) de graphe`} détecté(s)
          </span>
        </div>
        <div className="text-amber-400 flex items-center gap-2 text-xs">
          {graph_res?.coherence_score !== undefined && (
            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] uppercase font-bold text-amber-300">
              Cohérence: {graph_res.coherence_score}/100
            </span>
          )}
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-800 px-5 py-5 space-y-5 bg-slate-950/40">
          <p className="text-sm text-slate-200 font-sans font-medium leading-relaxed">
            {alert.recommendation}
          </p>
          
          <div className="space-y-5">
            {/* Patterns Standard */}
            {alert.patterns.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-2.5">Patterns anormaux généraux</h4>
                <div className="space-y-2.5">
                  {alert.patterns.map(p => (
                    <div 
                      key={p.id} 
                      className={`rounded-lg p-3.5 border ${
                        p.severity === 'warning' 
                          ? 'bg-amber-500/5 border-amber-505/20' 
                          : 'bg-indigo-500/5 border-indigo-500/20'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className={`h-2.5 w-2.5 rounded-full ${p.severity === 'warning' ? 'bg-amber-400' : 'bg-indigo-400'}`} />
                        <strong className={`text-xs font-bold uppercase tracking-wider ${p.severity === 'warning' ? 'text-amber-300' : 'text-indigo-300'}`}>
                          {p.label}
                        </strong>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-sans">
                        {p.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tensions Graphe */}
            {tensions.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <Activity size={14} className="text-red-400" />
                  <span>Tensions de Graphe GCH-CA / DI-IPC (arXiv:2512.23489)</span>
                </h4>
                <div className="space-y-2.5">
                  {tensions.map((t: any, i: number) => (
                    <div 
                      key={i} 
                      className={`rounded-lg p-3.5 border ${
                        t.severity === 'critical' 
                          ? 'bg-rose-500/5 border-rose-500/30' 
                          : t.severity === 'warning'
                          ? 'bg-amber-500/5 border-amber-500/25'
                          : 'bg-slate-900 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wider uppercase border ${
                            t.severity === 'critical' ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' : 
                            t.severity === 'warning' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 
                            'bg-slate-800 text-slate-400 border-slate-700'
                          }`}>
                            {t.severity}
                          </span>
                          <strong className={`text-xs font-bold leading-normal ${
                            t.severity === 'critical' ? 'text-rose-100' : 
                            t.severity === 'warning' ? 'text-amber-100' : 
                            'text-slate-200'
                          }`}>{t.label}</strong>
                        </div>
                        <span className="font-mono text-[10px] text-slate-500 font-semibold">
                          {t.arc.from} ({t.arc.tension_score.toFixed(2)}) × {t.arc.to}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed mb-3 font-sans">
                        {t.arc.description}
                      </p>
                      <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800">
                        <span className="font-bold text-[9px] tracking-wider uppercase text-slate-400 block mb-1">Recommandation :</span>
                        <p className="text-slate-100 text-xs italic leading-relaxed">{t.recommendation}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-start gap-3 rounded-lg bg-slate-950/80 p-3.5 text-xs text-slate-400 leading-relaxed border border-slate-800">
            <Info size={14} className="mt-0.5 text-amber-400 shrink-0" />
            <p className="font-sans">
              Ces analyses structurelles multi-hop détectent des contradictions d'exécution 
              post-subvention (2026+). Une tension structurelle forte peut invalider 
              la cohérence d'un profil même si les scores individuels paraissent élevés.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoodhartAlertPanel;
