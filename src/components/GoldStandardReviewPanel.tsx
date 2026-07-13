import React, { useState } from 'react';
import type { GoldStandardEntry } from '../types/iro';
import { Check, Shield, ExternalLink, ChevronRight, AlertCircle, Lock } from 'lucide-react';

interface GoldStandardReviewPanelProps {
  entries: GoldStandardEntry[];
  onValidate: (validated: GoldStandardEntry[]) => void;
}

const GoldStandardReviewPanel: React.FC<GoldStandardReviewPanelProps> = ({ entries, onValidate }) => {
  const [reviewed, setReviewed] = useState<Map<string, GoldStandardEntry>>(
    new Map(entries.map(e => [e.id, e]))
  );
  const [allConfirmed, setAllConfirmed] = useState<Set<string>>(new Set());

  const updateGCH = (id: string, gch: number) => {
    setReviewed(prev => {
      const updated = new Map(prev);
      const originalEntry = updated.get(id);
      if (!originalEntry) return prev;
      
      const entry = Object.assign({}, originalEntry) as GoldStandardEntry;
      entry.scores = Object.assign({}, entry.scores, { GCH: gch }) as any;
      updated.set(id, entry);
      return updated;
    });
    // Si on change le score, on retire la confirmation
    setAllConfirmed(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const confirm = (id: string) =>
    setAllConfirmed(prev => new Set([...prev, id]));

  const canFinalize = allConfirmed.size === entries.length;
  const progress = (allConfirmed.size / entries.length) * 100;

  return (
    <div className="bg-slate-900 rounded-xl border border-indigo-500/30 overflow-hidden shadow-2xl shadow-indigo-500/10">
      <div className="p-6 border-b border-slate-800 bg-indigo-500/5">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-indigo-500/20 p-2 rounded-lg">
            <Shield className="w-5 h-5 text-indigo-400" />
          </div>
          <h2 className="text-lg font-bold text-white tracking-tight">Validation Gold Standard v4.5-S46</h2>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
          Vérifiez et confirmez le score <strong>GCH (Gouvernance & Capital Humain)</strong> et les dimensions Lead User pour chaque startup. 
          Toutes les entrées doivent être validées individuellement avant de geler le Gold Standard pour la calibration v4.5-S46.
        </p>

        <div className="mt-6">
          <div className="flex justify-between items-end mb-2">
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Progression de la revue</span>
            <span className="text-xs font-mono text-white">{allConfirmed.size} / {entries.length} confirmés</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-indigo-500 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="max-h-[600px] overflow-y-auto p-6 space-y-4 bg-slate-950/20">
        {entries.map(entry => {
          const isConfirmed = allConfirmed.has(entry.id);
          const currentEntry = reviewed.get(entry.id)!;

          return (
            <div 
              key={entry.id} 
              className={`group transition-all duration-300 rounded-xl border ${
                isConfirmed 
                  ? 'bg-emerald-500/5 border-emerald-500/30' 
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              } p-4`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-white">{entry.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded uppercase tracking-wider font-medium">
                      {entry.vertical}
                    </span>
                    {isConfirmed && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                        <Check size={10} /> Confirmé
                      </span>
                    )}
                  </div>
                  
                  <div className="flex flex-wrap gap-3 mt-3">
                    {(['DI','ADC','IPC','AR','CA'] as const).map(dim => (
                      <div key={dim} className="flex flex-col">
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">{dim}</span>
                        <span className="text-xs font-mono text-slate-300">{entry.scores[dim]}</span>
                      </div>
                    ))}
                    <div className="flex flex-col px-3 border-l border-slate-800">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-tighter">GCH</span>
                        <span className="text-[8px] bg-indigo-500/20 text-indigo-400 px-1 rounded font-black">NEW</span>
                      </div>
                      <select
                        value={currentEntry.scores.GCH ?? ''}
                        onChange={e => updateGCH(entry.id, Number(e.target.value))}
                        disabled={isConfirmed}
                        className={`bg-slate-950 border ${isConfirmed ? 'border-transparent' : 'border-slate-700 focus:border-indigo-500'} rounded px-2 py-1 text-xs text-white outline-none transition-all cursor-pointer appearance-none min-w-[60px] text-center`}
                      >
                        <option value="" disabled>—</option>
                        {[0,1,2,3,4].map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <div className="text-[10px] text-slate-500 font-medium">
                    SCE <span className="text-slate-300 font-mono">{entry.sce.final}</span> 
                    <span className="mx-2 text-slate-800">|</span> 
                    ICC <span className="text-slate-300 font-mono">{entry.sce.icc}</span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {entry.sourcesDocumentees.slice(0, 2).map((url, i) => (
                        <a 
                          key={`src-${i}`} 
                          href={url} 
                          target="_blank" 
                          rel="noreferrer"
                          className="p-1.5 rounded bg-slate-800 text-slate-500 hover:text-indigo-400 hover:bg-indigo-400/10 transition-all"
                          title={url}
                        >
                          <ExternalLink size={12} />
                        </a>
                      ))}
                    </div>
                    
                    {!isConfirmed ? (
                      <button
                        disabled={currentEntry.scores.GCH === undefined}
                        onClick={() => confirm(entry.id)}
                        className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] font-bold text-white transition-all shadow-lg shadow-indigo-600/20"
                      >
                        Confirmer
                        <ChevronRight size={14} />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setAllConfirmed(prev => {
                            const next = new Set(prev);
                            next.delete(entry.id);
                            return next;
                          });
                        }}
                        className="text-[10px] text-slate-500 hover:text-slate-300 underline underline-offset-4 transition-colors"
                      >
                        Modifier
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-6 bg-slate-900/50 border-t border-slate-800 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3 text-slate-500">
          <AlertCircle size={16} />
          <span className="text-[10px] leading-tight max-w-xs">
            Le gel du Gold Standard verrouille les scores pour la session actuelle et recalibre les poids de l'IRO Certified.
          </span>
        </div>
        
        <button
          disabled={!canFinalize}
          onClick={() => onValidate([...reviewed.values()])}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed text-sm font-black text-white transition-all shadow-xl shadow-emerald-600/20"
        >
          <Lock size={16} />
          Geler le Gold Standard v4.5-S46
        </button>
      </div>
    </div>
  );
};

export default GoldStandardReviewPanel;
