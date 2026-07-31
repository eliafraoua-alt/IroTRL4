import React, { useState, useEffect } from 'react';
import { Database, TrendingUp, Filter, Download, Calendar, Users, Target, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { JournalStats } from '../utils/audit-journal';

interface AuditJournalPanelProps {
  // onRefresh?: () => void;
}

const AuditJournalPanel: React.FC<AuditJournalPanelProps> = () => {
  const [stats, setStats] = useState<JournalStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/audit/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.error('Echec fetch stats audit:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 h-48 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
    </div>
  );

  if (!stats || stats.total_entries === 0) return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 text-center">
      <Database className="w-8 h-8 text-slate-700" />
      <div>
        <div className="text-slate-300 font-bold">Journal d'audit vide</div>
        <div className="text-slate-500 text-xs">Lancez une analyse pour alimenter la base de données.</div>
      </div>
    </div>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      <div className="bg-slate-800/40 p-4 border-b border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-500/20 p-2 rounded-lg">
            <Database className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">Audit Trail Journal</h3>
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">Traçabilité IRO v4.5-S46 — Compliance Database</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => window.open('/api/audit/csv')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold transition-all border border-slate-700 hover:border-slate-600"
          >
            <Download className="w-3 h-3" />
            EXPORT CSV
          </button>
          <button 
            onClick={fetchStats}
            className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors text-slate-400"
          >
            <TrendingUp className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard 
            label="Total Entries" 
            value={stats.total_entries} 
            icon={<Database className="w-3 h-3" />} 
            color="text-indigo-400" 
          />
          <StatCard 
            label="Active Cohort" 
            value={stats.n_actives} 
            icon={<ShieldCheck className="w-3 h-3" />} 
            color="text-emerald-400" 
            subValue={`${Math.round(stats.n_actives / stats.total_entries * 100)}%`}
          />
          <StatCard 
            label="Mean IRO" 
            value={stats.mean_iro.toFixed(1)} 
            icon={<Target className="w-3 h-3" />} 
            color="text-blue-400" 
            unit="pts"
          />
          <StatCard 
            label="Separation Delta" 
            value={stats.delta_separation.toFixed(1)} 
            icon={<TrendingUp className="w-3 h-3" />} 
            color={stats.delta_separation > 15 ? "text-emerald-400" : "text-amber-400"} 
            unit="pts"
            subValue="Actives vs Failed"
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
            <div className="flex items-center justify-between mb-3 border-b border-slate-700/50 pb-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                <Users className="w-3 h-3" />
                Inter-Rater Reliability Stats
              </div>
              <div className="text-[10px] text-slate-400">
                {stats.evaluators.length} évaluateurs identifiés
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Moyenne IRO (Survivants)</span>
                <span className="text-xs font-mono font-bold text-emerald-400">{stats.mean_iro_actives.toFixed(1)}</span>
              </div>
              <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${stats.mean_iro_actives}%` }} />
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Moyenne IRO (Echecs)</span>
                <span className="text-xs font-mono font-bold text-rose-400">{stats.mean_iro_failed.toFixed(1)}</span>
              </div>
              <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-rose-500" style={{ width: `${stats.mean_iro_failed}%` }} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-[10px] text-slate-500 px-1">
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              First entry : {new Date(stats.date_first).toLocaleDateString()}
            </div>
            <div className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Dernier audit : {new Date(stats.date_last).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ 
  label: string; 
  value: string | number; 
  icon: React.ReactNode; 
  color: string;
  unit?: string;
  subValue?: string;
}> = ({ label, value, icon, color, unit, subValue }) => (
  <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3 flex flex-col gap-1">
    <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-tight">
      {icon}
      {label}
    </div>
    <div className="flex items-baseline gap-1">
      <span className={`text-xl font-black font-mono tracking-tighter ${color}`}>{value}</span>
      {unit && <span className="text-[10px] text-slate-600 font-bold uppercase">{unit}</span>}
    </div>
    {subValue && <div className="text-[11px] text-slate-500 font-medium italic">{subValue}</div>}
  </div>
);

export default AuditJournalPanel;
