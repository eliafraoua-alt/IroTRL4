import React from 'react';
import { useIRO, TabId } from '../../contexts/IROAnalysisContext';
import { Download } from 'lucide-react';

// Regroupement par catégorie plutôt qu'une liste à plat de 14 onglets :
// l'utilisateur cherche d'abord "où sont mes analyses ?" / "où sont mes
// rapports ?" avant de chercher un onglet précis — la structure doit
// répondre à cette question au premier coup d'œil.
const MENU_GROUPS = [
  {
    label: 'Analyse',
    items: [
      { id: 'overview', label: "Vue d'ensemble" },
      { id: 'iro', label: 'IRO détail' },
      { id: 'srd', label: 'Risque SRD' },
      { id: 'benchmark', label: 'Benchmark' },
      { id: 'phase', label: 'Phase & levée', accent: 'amber' },
    ],
  },
  {
    label: 'Outils',
    items: [
      { id: 'pitch-analyzer', label: 'Pitch Analyzer', icon: '✨' },
      { id: 'ahp', label: 'Calibration AHP' },
    ],
  },
  {
    label: 'Rapports',
    items: [
      { id: 'rapport-md', label: 'Rapport MD' },
      { id: 'rapport-inv', label: 'Rapport investisseur' },
      { id: 'hypotheses', label: 'Hypothèses' },
      { id: 'synthese', label: 'Synthèse' },
      { id: 'dynamique', label: 'Dynamique' },
    ],
  },
  {
    label: 'Qualité & pipeline',
    items: [
      { id: 'qualite', label: 'Qualité v7' },
      { id: 'pipeline', label: 'Pipeline' },
    ],
  },
] as const;

export const SideNavigation: React.FC = () => {
  const { tab, setTab, handleExportPDF, isExporting } = useIRO();

  return (
    <nav className="border-b border-slate-800 px-6 flex items-center justify-between overflow-x-auto bg-slate-900/10">
      <div className="flex items-stretch">
        {MENU_GROUPS.map((group, gi) => (
          <React.Fragment key={group.label}>
            {gi > 0 && <div className="w-px bg-slate-800/70 my-2.5 mx-1" />}
            <div className="flex flex-col justify-center py-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-600 px-3 leading-none mb-1">
                {group.label}
              </span>
              <div className="flex gap-1">
                {group.items.map(({ id, label, ...rest }) => {
                  const isActive = tab === id;
                  const accent = 'accent' in rest && rest.accent === 'amber';
                  return (
                    <button
                      key={`tab-${id}`}
                      onClick={() => setTab(id as TabId)}
                      className={`px-3 py-2 rounded-md text-xs font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                        isActive
                          ? accent
                            ? 'bg-amber-400/10 text-amber-400'
                            : 'bg-indigo-400/10 text-indigo-400'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      }`}
                    >
                      {'icon' in rest && rest.icon ? <span>{rest.icon}</span> : null}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>

      <button
        onClick={handleExportPDF}
        disabled={isExporting}
        className={`px-3.5 py-1.5 rounded text-[11px] font-bold flex items-center gap-2 cursor-pointer transition-all mr-4 shrink-0 ${
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
        {isExporting ? 'Génération...' : 'Exporter rapport'}
      </button>
    </nav>
  );
};
export default SideNavigation;
