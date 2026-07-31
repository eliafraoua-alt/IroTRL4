import React, { useState } from 'react';
import type { AuditResult } from '../utils/gold-standard-qa';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, BarChart3, Link2 } from 'lucide-react';

interface GoldStandardAuditPanelProps {
  audit: AuditResult;
}

const GoldStandardAuditPanel: React.FC<GoldStandardAuditPanelProps> = ({ audit }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
      <div 
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="bg-indigo-500/20 p-2 rounded-lg">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-300 tracking-widest uppercase">
              Audit de Qualité du Gold Standard
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Analyse de distribution, multicolinéarité et cohérence (v4.5-S46)
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            {audit.warnings.length > 0 ? (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold border border-amber-500/20">
                <AlertTriangle size={10} /> {audit.warnings.length} alertes
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-bold border border-emerald-500/20">
                <CheckCircle size={10} /> Validé
              </span>
            )}
          </div>
          {expanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
        </div>
      </div>

      {expanded && (
        <div className="p-5 border-t border-slate-800 bg-slate-950/30 space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
          
          {/* Warnings */}
          {audit.warnings.length > 0 && (
            <div className="space-y-2">
              {audit.warnings.map((w, i) => (
                <div key={`warn-${i}`} className="flex items-start gap-2 p-2.5 rounded bg-amber-500/5 border border-amber-500/20 text-[10.5px] text-slate-200 leading-relaxed font-sans">
                  <AlertTriangle size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  {w}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Distributions */}
            <div className="space-y-3">
              <div className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">Distributions par Dimension</div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(audit.distributions).map(([dim, stats]) => (
                  <div key={dim} className="bg-slate-900/50 p-2.5 rounded border border-slate-800">
                    <div className="text-[10px] font-bold text-indigo-400 mb-1">{dim}</div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-500">Moyenne</span>
                      <span className="text-slate-300 font-mono">{(stats as any).mean}</span>
                    </div>
                    <div className="flex justify-between text-[10px] mt-0.5">
                      <span className="text-slate-500">Variance</span>
                      <span className="text-slate-300 font-mono">{(stats as any).variance}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Correlations */}
            <div className="space-y-3">
              <div className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">Corrélations Critiques (|r| &gt; 0.7)</div>
              <div className="space-y-1.5">
                {Object.entries(audit.correlations)
                  .filter(([, r]) => Math.abs(r as number) > 0.7)
                  .sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number))
                  .map(([pair, r]) => (
                    <div key={pair} className="flex items-center justify-between p-2 rounded bg-slate-900/50 border border-slate-800">
                      <div className="flex items-center gap-2">
                        <Link2 size={12} className="text-slate-500" />
                        <span className="text-[10px] font-mono text-slate-400">{pair.replace('_', ' ↔ ')}</span>
                      </div>
                      <span className={`text-[10px] font-mono font-bold ${Math.abs(r as number) > 0.85 ? 'text-amber-400' : 'text-slate-300'}`}>
                        {(r as number).toFixed(3)}
                      </span>
                    </div>
                  ))}
                {Object.values(audit.correlations).filter(r => Math.abs(r as number) > 0.7).length === 0 && (
                  <div className="text-[10px] text-slate-600 italic p-2">Aucune corrélation forte détectée.</div>
                )}
              </div>
            </div>
          </div>

          {/* Global Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
            <div className="text-center p-3 bg-slate-900/50 rounded border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase mb-1">SCE Range</div>
              <div className={`text-lg font-black font-mono ${audit.sceRange >= 3 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {audit.sceRange.toFixed(1)}
              </div>
              <div className="text-[11px] text-slate-600 mt-1">Cible: ≥ 3.0</div>
            </div>
            <div className="text-center p-3 bg-slate-900/50 rounded border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase mb-1">ICC Moyen</div>
              <div className={`text-lg font-black font-mono ${audit.meanICC >= 0.7 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {audit.meanICC.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-600 mt-1">Cible: ≥ 0.70</div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};

export default GoldStandardAuditPanel;
