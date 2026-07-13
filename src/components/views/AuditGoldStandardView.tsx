import React from 'react';
import { useIRO, VERSION, GOLD_STANDARD_N } from '../../contexts/IROAnalysisContext';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, AlertTriangle, Table, Play, CheckCircle2, RefreshCw, Download } from 'lucide-react';
import ErrorBoundary from '../ErrorBoundary';
import GoldStandardReviewPanel from '../GoldStandardReviewPanel';
import GoldStandardTable from '../GoldStandardTable';
import GoldStandardMigrationPanel from '../GoldStandardMigrationPanel';
import GoldStandardAuditPanel from '../GoldStandardAuditPanel';
import LoadingSpinner from '../LoadingSpinner';
import RegressionReportPanel from '../RegressionReportPanel';
import CohortValidationPanel from '../CohortValidationPanel';
import { auditGoldStandard } from '../../utils/gold-standard-qa';
import { downloadStabilityReport } from '../../utils/stability-download';

export const AuditGoldStandardView: React.FC = () => {
  const {
    goldEntries,
    setGoldEntries,
    isGoldLoading,
    goldValidation,
    isReviewingGoldStandard,
    setIsReviewingGoldStandard,
    handleFinalizeReview,
    iroCertified,
    certifiedProgress,
    regressionReport,
    testingRegression,
    runRegression,
    ahpResult,
    setToast
  } = useIRO();

  const [activeView, setActiveView] = React.useState<'gold' | 'cohort'>('gold');

  // Audit calculations
  const goldAudit = React.useMemo(() => auditGoldStandard(goldEntries), [goldEntries]);

  const handleMigrate = (id: string, gchScore: number) => {
    setGoldEntries(prev => {
      const updated = prev.map(e => e.id === id ? {
        ...e,
        migrated: true,
        scores: { ...e.scores, GCH: gchScore }
      } : e);
      return updated;
    });
    setToast({ message: `Entrée ${id} migrée avec succès`, type: 'success' });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 text-slate-200"
    >
      {/* View Header with stats trigger */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-[10px] text-indigo-400 font-bold tracking-widest uppercase flex items-center gap-1.5 mb-1">
            <Shield size={14} className="text-indigo-400" /> VOYANT DE QUALITÉ ET FIABILITÉ V7
          </div>
          <h2 className="text-xl font-black text-slate-100">Banc d'Audit Scientifique & Validation</h2>
          <p className="text-xs text-slate-500 max-w-2xl mt-1">
            Validez la robustesse du système d'analyse sur le Gold Standard d'experts (n=125) ou sur la cohorte d'analyse de survie longitudinale (n=442).
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap md:flex-nowrap">
          <button
            onClick={() => downloadStabilityReport()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            Rapport Stabilité C2
          </button>

          <button
            onClick={() => setIsReviewingGoldStandard(!isReviewingGoldStandard)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${
              isReviewingGoldStandard 
                ? 'bg-slate-800 text-slate-400 border border-slate-700' 
                : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/20'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            {isReviewingGoldStandard ? 'Fermer la revue' : 'Lancer la revue v4.5-S46'}
          </button>
          
          <button
            onClick={runRegression}
            disabled={testingRegression}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 border border-slate-700"
          >
            {testingRegression ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            ) : (
              <Play className="w-3.5 h-3.5 text-indigo-400" />
            )}
            {testingRegression ? 'Régression...' : 'Tester Non-Régression'}
          </button>
        </div>
      </div>

      {/* Sub-navigation to toggle view modes */}
      <div className="flex gap-4 border-b border-slate-800 pb-px">
        <button
          onClick={() => { setActiveView('gold'); setIsReviewingGoldStandard(false); }}
          className={`pb-3 text-xs font-extrabold uppercase tracking-widest border-b-2 cursor-pointer transition-all ${
            activeView === 'gold'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          🎯 Gold Standard (n={goldEntries.length})
        </button>
        <button
          onClick={() => { setActiveView('cohort'); setIsReviewingGoldStandard(false); }}
          className={`pb-3 text-xs font-extrabold uppercase tracking-widest border-b-2 cursor-pointer transition-all ${
            activeView === 'cohort'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          🔬 Cohorte de Validation prospective (n=442)
        </button>
      </div>

      {activeView === 'cohort' ? (
        <ErrorBoundary>
          <CohortValidationPanel />
        </ErrorBoundary>
      ) : isReviewingGoldStandard ? (
        <ErrorBoundary>
          <GoldStandardReviewPanel 
            entries={goldEntries} 
            onValidate={handleFinalizeReview} 
          />
        </ErrorBoundary>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main List and migration panel (Left column - 2 cols wide on lg) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-sm font-bold text-slate-300 border-b border-slate-800 pb-3 uppercase tracking-tight flex items-center gap-2">
                <Table size={15} className="text-indigo-400" />
                Matrice du Gold Standard
              </h3>
              {isGoldLoading ? (
                <div className="flex justify-center p-8">
                  <LoadingSpinner message="Chargement du Gold Standard (n=125)..." />
                </div>
              ) : (
                <ErrorBoundary>
                  <GoldStandardTable data={goldEntries} />
                </ErrorBoundary>
              )}
            </div>

            <ErrorBoundary>
              <GoldStandardMigrationPanel entries={goldEntries} onMigrate={handleMigrate} />
            </ErrorBoundary>
          </div>

          {/* Calibrations and Metrics Column (Right Column) */}
          <div className="space-y-6">
            {/* V7 statistical metrics card */}
            {iroCertified && (
              <div className="bg-gradient-to-br from-indigo-950/20 to-slate-900 border border-indigo-500/20 rounded-xl p-5">
                <h3 className="text-xs font-black text-indigo-400 tracking-wider uppercase mb-3">
                  Poids appris & Certifiés IRO_Certified
                </h3>
                
                {certifiedProgress < 1 && (
                  <div className="mb-4">
                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                      <span>Régression SGD stochastique...</span>
                      <span>{Math.round(certifiedProgress * 100)}%</span>
                    </div>
                    <div className="h-1 bg-slate-950 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 transition-all" style={{ width: `${certifiedProgress * 100}%` }} />
                    </div>
                  </div>
                )}

                <div className="space-y-2.5">
                  <div className="bg-slate-950 rounded-lg p-3 border border-slate-850">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">
                      Indicateur de concordance (Spearman)
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-2xl font-black font-mono text-emerald-400">
                        P = {iroCertified.spearman.toFixed(3)}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {iroCertified.spearman >= 0.7 ? 'Élevée ✓' : 'Insuffisante'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-950 rounded-lg p-2.5 border border-slate-850 text-center">
                      <div className="text-sm font-black text-slate-300 font-mono">
                        {iroCertified.rmse.toFixed(2)} pts
                      </div>
                      <div className="text-[9px] text-slate-500 uppercase font-bold mt-1">RMSE</div>
                    </div>
                    <div className="bg-slate-950 rounded-lg p-2.5 border border-slate-850 text-center">
                      <div className="text-sm font-black text-slate-300 font-mono">
                        {iroCertified.mae.toFixed(2)} pts
                      </div>
                      <div className="text-[9px] text-slate-500 uppercase font-bold mt-1">MAE</div>
                    </div>
                  </div>

                  {iroCertified.gold_standard_warning && (
                    <div className="bg-amber-500/15 border border-amber-500/35 rounded-lg px-3 py-2 flex items-start gap-2 text-[10px] text-amber-500 animate-pulse">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      <span>{iroCertified.gold_standard_warning}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <ErrorBoundary>
              <GoldStandardAuditPanel audit={goldAudit} />
            </ErrorBoundary>

            {/* Regression testing results panel */}
            {regressionReport && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="text-xs font-black text-slate-300 tracking-wider uppercase mb-3 flex items-center justify-between">
                  <span>Rapport de Non-Régression</span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                    regressionReport.failed === 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                  }`}>
                    {regressionReport.failed === 0 ? 'Passé ✓' : `${regressionReport.failed} échecs`}
                  </span>
                </h3>
                <ErrorBoundary>
                  <RegressionReportPanel report={regressionReport} />
                </ErrorBoundary>
              </div>
            )}

            {/* Warning block */}
            <div className="bg-slate-900/60 rounded-xl p-4 border border-amber-500/20">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold text-amber-400 tracking-widest mb-1.5 uppercase">
                    GOLD STANDARD OBSERVATION LIMITS
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    IRO V7 est calibré sur {GOLD_STANDARD_N} startups Delphi. Pour un modèle statistiquement solide, il faut au moins 60 observations (10 par variable x 6 variables). 
                  </p>
                  <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                    Le R² d'IRO_Certified évalue la capacité de mémorisation du jeu d'entraînement, pas la généralisation. Les scores s'appliquent comme audit normatif.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
export default AuditGoldStandardView;
