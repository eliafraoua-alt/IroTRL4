import React from 'react';
import { RegressionReport } from '../utils/prompt-regression-test';
import { Check, X, AlertCircle, ShieldCheck, ShieldAlert } from 'lucide-react';

interface RegressionReportPanelProps {
  report: RegressionReport;
}

const RegressionReportPanel: React.FC<RegressionReportPanelProps> = ({ report }) => {
  return (
    <div className={`rounded-xl border p-6 transition-all duration-500 ${
      report.deploymentAllowed 
        ? 'bg-emerald-900/10 border-emerald-500/30' 
        : 'bg-red-900/10 border-red-500/30'
    }`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${report.deploymentAllowed ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
            {report.deploymentAllowed ? (
              <ShieldCheck className="w-6 h-6 text-emerald-500" />
            ) : (
              <ShieldAlert className="w-6 h-6 text-red-500" />
            )}
          </div>
          <div>
            <h3 className={`font-bold text-lg ${report.deploymentAllowed ? 'text-emerald-400' : 'text-red-400'}`}>
              Régression Prompt v{report.promptVersion}
            </h3>
            <p className="text-slate-500 text-xs">Testé le {new Date(report.testedAt).toLocaleString()}</p>
          </div>
        </div>
        
        <div className="text-right">
          <div className={`text-2xl font-black font-mono ${report.deploymentAllowed ? 'text-emerald-400' : 'text-red-400'}`}>
            {Math.round(report.passRate * 100)}%
          </div>
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Pass Rate</div>
        </div>
      </div>

      {!report.deploymentAllowed && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-6 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-xs text-red-200/80 leading-relaxed">
            <strong>Déploiement bloqué</strong> — Le seuil de stabilité requis est de 80%. 
            Les modifications récentes du prompt ont provoqué une dérive excessive par rapport au Gold Standard.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/50">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-900/80 text-slate-500 font-bold uppercase tracking-tighter border-b border-slate-800">
              <th className="px-4 py-3">Startup</th>
              <th className="px-4 py-3">Attendu</th>
              <th className="px-4 py-3">Obtenu</th>
              <th className="px-4 py-3">Dérive</th>
              <th className="px-4 py-3 text-center">Résultat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {report.results.map((r, i) => (
              <tr key={`res-${i}`} className="hover:bg-slate-800/20 transition-colors">
                <td className="px-4 py-3 font-bold text-slate-300">{r.case.startupName}</td>
                <td className="px-4 py-3 text-slate-500 font-mono">{r.case.expectedIRO.min}–{r.case.expectedIRO.max}</td>
                <td className="px-4 py-3 font-black font-mono text-white">{r.actualIRO.toFixed(1)}</td>
                <td className="px-4 py-3">
                  <span className={`font-mono font-bold ${Math.abs(r.drift) > 5 ? 'text-amber-400' : 'text-slate-400'}`}>
                    {r.drift > 0 ? '+' : ''}{r.drift.toFixed(1)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-center">
                    {r.passed ? (
                      <div className="bg-emerald-500/20 p-1 rounded">
                        <Check className="w-3 h-3 text-emerald-500" />
                      </div>
                    ) : (
                      <div className="bg-red-500/20 p-1 rounded">
                        <X className="w-3 h-3 text-red-500" />
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RegressionReportPanel;
