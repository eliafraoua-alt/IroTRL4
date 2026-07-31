import React from 'react';
import type { GoldStandardEntry } from '../types/iro';
import { ExternalLink, ShieldCheck } from 'lucide-react';

interface GoldStandardTableProps {
  data: GoldStandardEntry[];
}

const GoldStandardTable: React.FC<GoldStandardTableProps> = ({ data }) => {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-950/50 border-b border-slate-800">
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Startup</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vertical</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">DI</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">ADC</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">IPC</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">SCE</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {data.map((row) => (
              <tr key={row.id} className="hover:bg-slate-800/30 transition-colors group">
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-white group-hover:text-indigo-400 transition-colors">
                      {row.name}
                    </span>
                      <div className="flex gap-1.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {row.sourcesDocumentees.slice(0, 2).map((url, i) => (
                          <a 
                            key={`src-${row.id}-${i}`} 
                            href={url} 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-slate-600 hover:text-indigo-400"
                          >
                            <ExternalLink size={10} />
                          </a>
                        ))}
                      </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-mono text-slate-400">{row.vertical}</span>
                </td>
                <td className="px-4 py-3 text-center text-xs font-mono text-slate-500">{row.scores.DI}</td>
                <td className="px-4 py-3 text-center text-xs font-mono text-slate-500">{row.scores.ADC}</td>
                <td className="px-4 py-3 text-center text-xs font-mono text-indigo-400 font-bold">{row.scores.IPC}</td>
                <td className="px-4 py-3 text-center">
                  <span className="text-xs font-mono font-bold text-emerald-400">{row.sce.final}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={12} className="text-emerald-500" />
                    <span className="text-[11px] font-bold text-emerald-500/80 uppercase">Vérifié</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 bg-slate-950/30 border-t border-slate-800 flex justify-between items-center">
        <span className="text-[11px] text-slate-600 font-bold uppercase tracking-tighter">
          Calibrage rétrospectif — v4.5-S46
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          n = {data.length}
        </span>
      </div>
    </div>
  );
};

export default GoldStandardTable;
