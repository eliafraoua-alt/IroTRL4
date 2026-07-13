import React from 'react';
import type { GoldStandardEntry } from '../types/iro';
import { AlertTriangle, ChevronRight } from 'lucide-react';

interface GoldStandardMigrationPanelProps {
  entries: GoldStandardEntry[];
  onMigrate: (id: string, gchScore: number) => void;
}

const GoldStandardMigrationPanel: React.FC<GoldStandardMigrationPanelProps> = ({ entries, onMigrate }) => {
  const toMigrate = entries.filter(
    e => e.modelVersion === '4.2' && !e.migrated
  );

  if (toMigrate.length === 0) return null;

  return (
    <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-5 mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-amber-500/20 p-2 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h3 className="text-amber-400 font-bold text-sm">Migration requise — {toMigrate.length} entrée(s) v4.2</h3>
          <p className="text-slate-200 text-xs">
            Ces startups ont été notées sur 5 dimensions (v4.2). La dimension GCH doit être ajoutée avant tout calcul R².
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {toMigrate.map(entry => (
          <div key={entry.id} className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                {entry.name}
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded uppercase tracking-wider">v4.2</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-mono">
                DI={entry.scores.DI} ADC={entry.scores.ADC} IPC={entry.scores.IPC} AR={entry.scores.AR} CA={entry.scores.CA}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Attribuer GCH</span>
              <select
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-amber-500 transition-colors cursor-pointer"
                onChange={e => onMigrate(entry.id, Number(e.target.value))}
                defaultValue=""
              >
                <option value="" disabled>Score ?</option>
                {[0, 1, 2, 3, 4].map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <button 
                disabled
                className="p-1.5 rounded bg-slate-800 text-slate-500 opacity-50 cursor-not-allowed"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GoldStandardMigrationPanel;
