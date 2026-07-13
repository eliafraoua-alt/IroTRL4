import React, { useState, useEffect } from 'react';
import { Database, Search, Loader2, ChevronRight, BarChart2, X } from 'lucide-react';

interface Startup {
  id: string;
  name: string;
  vertical: string;
  status: string;
  auto_DI?: number;
  auto_ADC?: number;
  auto_IPC?: number;
  auto_AR?: number;
  auto_CA?: number;
}

interface VaultPanelProps {
  open: boolean;
  onClose: () => void;
  onSelect: (name: string) => void;
}

export default function VaultPanel({ open, onClose, onSelect }: VaultPanelProps) {
  const [startups, setStartups] = useState<Startup[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetch('/api/startups')
        .then(res => res.json())
        .then(data => {
          setStartups(data);
          setLoading(false);
        })
        .catch(err => {
          console.error(err);
          setLoading(false);
        });
    }
  }, [open]);

  const filtered = startups.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) || 
    s.vertical.toLowerCase().includes(search.toLowerCase())
  );

  if (!open) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] transition-opacity" 
        onClick={onClose} 
      />
      <div className="fixed inset-y-0 left-0 w-[500px] bg-slate-950 border-r border-slate-800 shadow-2xl z-[201] flex flex-col font-sans overflow-hidden animate-in slide-in-from-left duration-300">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/30">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Database size={24} />
             </div>
             <div>
                <h2 className="text-xl font-bold text-white uppercase tracking-tight">IRO Vault</h2>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mt-1">Base de données Diagnostic</p>
             </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 bg-slate-900/50 border-b border-slate-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input 
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher une startup ou une verticale..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-slate-200 outline-none focus:border-indigo-500/50 transition-all font-mono"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-4">
              <Loader2 className="animate-spin text-indigo-500" size={32} />
              <span className="text-xs font-bold uppercase tracking-widest animate-pulse">Chargement du coffre-fort...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-2 p-8 text-center">
              <Database size={48} className="opacity-10 mb-4" />
              <span className="text-xs font-bold uppercase text-slate-600">Aucun résultat trouvé pour "{search}"</span>
              <p className="text-[10px] text-slate-700 mt-2 lowercase">Vérifiez l'orthographe ou essayez un secteur d'activité.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/30">
              {filtered.map(s => (
                <div 
                  key={s.id} 
                  onClick={() => { onSelect(s.name); onClose(); }}
                  className="p-4 hover:bg-indigo-500/5 cursor-pointer transition-colors group flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center text-indigo-400 font-bold text-xs ring-1 ring-slate-800 group-hover:ring-indigo-500/50 transition-all shadow-inner">
                      {s.vertical.substring(0, 2)}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">{s.name}</div>
                      <div className="text-[10px] text-slate-600 font-mono mt-0.5 flex items-center gap-2">
                        <span className="text-slate-400">{s.vertical}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-800" />
                        <span className={s.status === 'pending' ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                          {s.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex gap-0.5 items-end h-6">
                      {[s.auto_DI, s.auto_ADC, s.auto_IPC, s.auto_AR, s.auto_CA].map((val, i) => (
                        <div key={`vault-stat-${i}`} className="w-1 bg-slate-800 rounded-t h-full overflow-hidden">
                           <div className="bg-indigo-500/40 w-full" style={{ height: `${(val ?? 0) * 25}%` }} />
                        </div>
                      ))}
                    </div>
                    <ChevronRight size={16} className="text-slate-700 group-hover:translate-x-1 transition-transform group-hover:text-indigo-400" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50 text-[10px] text-slate-500 flex justify-between items-center uppercase font-bold tracking-widest">
           <div className="flex items-center gap-2">
              <span className="text-indigo-400">{filtered.length}</span>
              <span>startups indexées</span>
           </div>
           <div className="flex items-center gap-1.5 text-emerald-500/50">
              <BarChart2 size={12}/>
              <span>Analytics Pipeline Active</span>
           </div>
        </div>
      </div>
    </>
  );
}
