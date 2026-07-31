import React from 'react';
import { CompetingRisksResult } from '../types/iro';
import { AlertTriangle, Target, Repeat, Search } from 'lucide-react';

interface CompetingRisksPanelProps {
  result: CompetingRisksResult;
}

const CompetingRisksPanel: React.FC<CompetingRisksPanelProps> = ({ result }) => {
  const getIcon = (type: string) => {
    switch (type) {
      case 'faillite': return <AlertTriangle size={14} className="text-red-400" />;
      case 'acquisition': return <Target size={14} className="text-emerald-400" />;
      case 'pivot_radical': return <Repeat size={14} className="text-amber-400" />;
      case 'actif': return <Search size={14} className="text-indigo-400" />;
      default: return null;
    }
  };

  const getLabel = (type: string) => {
    switch (type) {
      case 'faillite': return 'FAILLITE';
      case 'acquisition': return 'ACQUISITION';
      case 'pivot_radical': return 'PIVOT RADICAL';
      case 'actif': return 'ACTIF (CONTINUATION)';
      default: return type.toUpperCase();
    }
  };

  const getColor = (type: string) => {
    switch (type) {
      case 'faillite': return 'text-red-400';
      case 'acquisition': return 'text-emerald-400';
      case 'pivot_radical': return 'text-amber-400';
      case 'actif': return 'text-indigo-400';
      default: return 'text-slate-400';
    }
  };

  const items = [
    { id: 'actif', prob: result.p_actif_36m },
    { id: 'faillite', prob: result.p_faillite_36m },
    { id: 'acquisition', prob: result.p_acquisition_36m },
    { id: 'pivot_radical', prob: result.p_pivot_36m },
  ].sort((a, b) => b.prob - a.prob);

  return (
    <div className="mt-8 pt-6 border-t border-slate-800">
      <div className="text-[10px] text-indigo-400/80 font-black tracking-[0.2em] mb-4 uppercase flex items-center gap-2">
        <Target size={12} />
        Modèle Risques Concurrents (Fine & Gray)
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        {items.map(item => (
          <div 
            key={item.id} 
            className={`p-3 rounded-lg border transition-all duration-300 ${
              result.most_likely === item.id 
                ? 'bg-slate-900 border-slate-700 shadow-lg scale-[1.02]' 
                : 'bg-slate-950/50 border-slate-900 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="p-1.5 bg-slate-900 rounded-md border border-slate-800">
                {getIcon(item.id)}
              </div>
              <div className={`text-xs font-black font-mono ${getColor(item.id)}`}>
                {(item.prob * 100).toFixed(1)}%
              </div>
            </div>
            <div className={`text-[11px] font-bold tracking-tighter ${result.most_likely === item.id ? 'text-slate-200' : 'text-slate-500'}`}>
              {getLabel(item.id)}
            </div>
            {result.most_likely === item.id && (
              <div className="mt-1 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${item.id === 'faillite' ? 'bg-red-500' : item.id === 'acquisition' ? 'bg-emerald-500' : item.id === 'pivot_radical' ? 'bg-amber-500' : 'bg-indigo-500'}`}
                  style={{ width: `${item.prob * 100}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-slate-950/80 border border-slate-800/50 rounded-xl p-4 mb-4">
        <div className="flex gap-3">
          <div className={`p-2 rounded-lg bg-slate-900 border border-slate-800 self-start mt-0.5`}>
            {getIcon(result.most_likely)}
          </div>
          <div>
            <div className={`text-[10px] font-black uppercase mb-1 ${getColor(result.most_likely)}`}>
              Scénario Dominant : {getLabel(result.most_likely)}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed italic">
              {result.interpretation}
            </p>
          </div>
        </div>
      </div>

      <div className="text-[11px] text-slate-500 leading-relaxed">
        <span className="font-bold">Note TRL & Confiance :</span> {result.trl_note}
        <br />
        Le modèle Fine & Gray traite les types de sortie comme des événements mutuellement exclusifs (Risques Concurrents).
      </div>
    </div>
  );
};

export default CompetingRisksPanel;
