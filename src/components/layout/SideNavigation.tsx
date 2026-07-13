import React from 'react';
import { useIRO, TabId } from '../../contexts/IROAnalysisContext';
import { Download } from 'lucide-react';

export const SideNavigation: React.FC = () => {
  const { tab, setTab, handleExportPDF, isExporting } = useIRO();

  const menuItems = [
    { id: 'overview', label: "VUE D'ENSEMBLE" },
    { id: 'pitch-analyzer', label: "✨ IMMERSIVE PITCH ANALYSER" },
    { id: 'rapport-md', label: "📝 RAPPORT MD" },
    { id: 'rapport-inv', label: "💼 RAPPORT INVESTISSEUR" },
    { id: 'iro', label: "IRO DÉTAIL" },
    { id: 'srd', label: "RISQUE SRD" },
    { id: 'benchmark', label: "BENCHMARK" },
    { id: 'phase', label: "🏷 PHASE & LEVÉE" },
    { id: 'ahp', label: "CALIBRATION AHP" },
    { id: 'hypotheses', label: "HYPOTHÈSES" },
    { id: 'synthese', label: "SYNTHÈSE" },
    { id: 'dynamique', label: "DYNAMIQUE" },
    { id: 'qualite', label: "QUALITÉ V7" },
    { id: 'pipeline', label: "PIPELINE" },
  ] as const;

  return (
    <nav className="border-b border-slate-800 px-6 flex items-center justify-between overflow-x-auto bg-slate-900/10">
      <div className="flex gap-1">
        {menuItems.map(({ id, label }) => (
          <button
            key={`tab-${id}`}
            onClick={() => setTab(id as TabId)}
            className={`px-4 py-3.5 text-xs font-bold tracking-wider whitespace-nowrap border-b-2 transition-all cursor-pointer ${
              tab === id
                ? id === 'phase'
                  ? 'border-amber-400 text-amber-400'
                  : 'border-indigo-400 text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-850'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        onClick={handleExportPDF}
        disabled={isExporting}
        className={`px-3.5 py-1.5 rounded text-[10px] font-bold flex items-center gap-2 cursor-pointer transition-all mr-4 shrink-0 ${
          isExporting
            ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
        }`}
      >
        {isExporting ? (
          <div className="w-3 h-3 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin" />
        ) : (
          <Download size={12} />
        )}
        {isExporting ? 'GÉNÉRATION...' : 'EXPORTER RAPPORT'}
      </button>
    </nav>
  );
};
export default SideNavigation;
