import React from 'react';
import { CompanyProvider, useCompanyContext } from './contexts/CompanyContext';
import { CompanyOnboardingPanel } from './components/CompanyOnboardingPanel';
import { IROAnalysisProvider, useIRO } from './contexts/IROAnalysisContext';
import { Header } from './components/layout/Header';
import { SideNavigation } from './components/layout/SideNavigation';
import { DashboardView } from './components/views/DashboardView';
import { SurvivalAnalysisView } from './components/views/SurvivalAnalysisView';
import { AuditGoldStandardView } from './components/views/AuditGoldStandardView';
import { ExpertAHPView } from './components/views/ExpertAHPView';
import { MarkdownReportView } from './components/views/MarkdownReportView';

// Side Panels / Control Panels
import StartupModelSidePanel from './components/StartupModelSidePanel';
import { FounderProfilePanel } from './components/FounderProfilePanel';
import { PappersPanel } from './components/PappersPanel';
import { DIResearchPanel } from './components/DIResearchPanel';
import VaultPanel from './components/VaultPanel';
import AHPExpertPanel from './components/AHPExpertPanel';
import PitchAnalyzer from './components/PitchAnalyzer';
import IROStrengthNLP from './components/IROStrengthNLP';
import IROAgentMode from './components/IROAgentMode';
import InvestorReportPanel from './components/InvestorReportPanel';
import { generateInvestorWordReport } from './utils/investor-word-export';
import { TRL_DESCRIPTIONS } from './types/iro';

// Subcomponents and Tab Views
import ReportContent from './components/ReportContent';
import SectorBenchmark from './components/SectorBenchmark';
import PipelineDashboard from './components/PipelineDashboard';
import StartupPhasePanel from './components/StartupPhasePanel';
import ErrorBoundary from './components/ErrorBoundary';

function AppContent() {
  const { isLoaded } = useCompanyContext();

  if (!isLoaded) {
    return <CompanyOnboardingPanel />;
  }

  return (
    <IROAnalysisProvider>
      <AppInner />
    </IROAnalysisProvider>
  );
}

function AppInner() {
  const { companyName } = useCompanyContext();
  const {
    tab,
    modelPanelOpen,
    setModelPanelOpen,
    founderPanelOpen,
    setFounderPanelOpen,
    pappersPanelOpen,
    setPappersPanelOpen,
    diPanelOpen,
    setDiPanelOpen,
    vaultPanelOpen,
    setVaultPanelOpen,
    ahpPanelOpen,
    setAhpPanelOpen,
    pitchMode,
    setPitchMode,
    nlpMode,
    setNlpMode,
    agentMode,
    setAgentMode,
    result,
    setResult,
    handleApplyDIEvidence,
    handlePappersUpdate,
    handleGCHUpdate,
    toast,
    setToast,

    // Additional context values for sub-reports and panels
    currentSurvivalCurve,
    survivalRefs,
    bm,
    sect,
    quad,
    history,
    startupModel,
    setStartupModel,
    handlePitchAnalyze,
    loading,
    loadingStep,
    setStartup,
    setNlpScores,
    expertWeights
  } = useIRO();

  // Dynamically compute phase keys for the development-phase indicator
  const phaseInput = result ? {
    age_mois: result.age_mois ?? 0,
    iro_score: result.iro?.score_100 ?? 0,
    iro_cr: result.srd?.iro_cr ?? 50,
    srd_score: result.srd?.srd_100 ?? 50,
    di: result.iro?.scores?.DI ?? 0,
    adc: result.iro?.scores?.ADC ?? 0,
    ipc: result.iro?.scores?.IPC ?? 0,
    ar: result.iro?.scores?.AR ?? 0,
    ca: result.iro?.scores?.CA ?? 0,
    gch: result.iro?.scores?.GCH ?? 0,
    vertical: result.vertical ?? 'SAAS',
    stade_financement: result.stade_financement ?? '',
    clients_actifs: result.clients_actifs ?? null,
    quadrant: result.srd?.quadrant ?? '',
  } : null;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden flex-col">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Control Bar & Global Diagnostics Summary */}
        <Header />

        {/* Global Tab Navigation */}
        <SideNavigation />

        {/* Main View Area */}
        <main className="flex-1 overflow-y-auto p-6 bg-slate-950/60">
          <ErrorBoundary>
            {tab === 'overview' && <DashboardView />}
            {tab === 'srd' && <SurvivalAnalysisView />}
            {tab === 'benchmark' && <SectorBenchmark currentResult={result} currentName={result?.startup_name ?? companyName} />}
            {tab === 'ahp' && <ExpertAHPView />}
            {tab === 'qualite' && <AuditGoldStandardView />}
            {tab === 'pipeline' && <PipelineDashboard />}
            {tab === 'rapport-md' && <MarkdownReportView />}
            {tab === 'pitch-analyzer' && (
              <div className="max-w-4xl mx-auto py-2">
                <PitchAnalyzer
                  onAnalyze={handlePitchAnalyze}
                  loading={loading}
                  loadingStep={loadingStep}
                />
              </div>
            )}
            
            {tab === 'rapport-inv' && (
              result ? (
                <InvestorReportPanel
                  result={result}
                  startupName={result.startup_name ?? companyName}
                  onExportWord={async (report) => {
                    try {
                      await generateInvestorWordReport(report, result);
                      setToast({ message: 'Rapport Word généré avec succès', type: 'success' });
                    } catch (e) {
                      setToast({ message: 'Erreur génération Word', type: 'error' });
                    }
                  }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center bg-slate-900/40 border border-slate-800 rounded-2xl max-w-2xl mx-auto p-6 animate-in fade-in duration-200">
                  <span className="text-4xl mb-4">💼</span>
                  <h3 className="font-bold text-slate-300 text-base mb-1">Aucun rapport disponible</h3>
                  <p className="text-slate-500 text-xs text-balance">
                    Veuillez d'abord exécuter ou charger une analyse IRO depuis la vue d'ensemble pour générer le rapport complet de l'investisseur.
                  </p>
                </div>
              )
            )}

            {tab === 'phase' && phaseInput && (
              <div className="bg-slate-900 rounded-xl p-6 border border-slate-800 space-y-6">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[11px] text-amber-400 font-black uppercase tracking-[0.2em] mb-1 flex items-center gap-2">
                      <span>🏷</span> Phase · Maturité · Financement
                    </div>
                    <h2 className="text-xl font-black text-slate-100 leading-tight">
                      {result?.startup_name}
                    </h2>
                    <p className="text-[12px] text-slate-500 mt-0.5">
                      {result?.secteur} · {result?.age_mois}m · {result?.stade_financement} · Cohorte FR n=130
                    </p>
                  </div>
                </div>
                <StartupPhasePanel input={phaseInput as any} />
              </div>
            )}

            {/* Structured Analytical Sub-Reports */}
            {['iro', 'hypotheses', 'synthese', 'dynamique'].includes(tab) && (
              <ReportContent
                result={result}
                currentSurvivalCurve={currentSurvivalCurve}
                survivalRefs={survivalRefs}
                bm={bm}
                sect={sect}
                quad={quad}
                goldCalib={result ? history.find(h => h.result?.startup_name === result.startup_name)?.gold : null}
              />
            )}
          </ErrorBoundary>
        </main>
      </div>

      {/* Slide-out Drawers and Micro-UI Overlays */}
      <StartupModelSidePanel 
        open={modelPanelOpen} 
        onClose={() => setModelPanelOpen(false)} 
        value={startupModel}
        onChange={setStartupModel}
      />

      {/* FIX Bug 1+2: panneau monté en permanence via style display (pas conditional render)
           pour préserver l'état founders. Key sur le nom de startup = reset propre au changement
           d'entité. initialFounders depuis startupModel.gch_founders pour réhydrater. */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
        style={{ display: founderPanelOpen ? 'flex' : 'none' }}
        onClick={() => setFounderPanelOpen(false)}
      >
        <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <FounderProfilePanel
            key={result?.startup_name ?? startupModel.nom ?? 'default'}
            startupName={result?.startup_name ?? startupModel.nom ?? 'Alma Health'}
            initialFounders={(startupModel as any).gch_founders ?? []}
            onUpdate={(score: any, ctx: any, f: any) => {
              handleGCHUpdate(score, ctx, f);
              setToast({ message: "Équipe fondatrice mise à jour !", type: 'success' });
            }}
          />
        </div>
      </div>

      {pappersPanelOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setPappersPanelOpen(false)}>
          <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <PappersPanel
              startupName={result?.startup_name ?? 'Alma Health'}
              onDataLoaded={handlePappersUpdate}
            />
          </div>
        </div>
      )}

      {diPanelOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setDiPanelOpen(false)}>
          <div className="max-w-4xl w-full max-h-[90vh] overflow-y-auto relative" onClick={e => e.stopPropagation()}>
            <DIResearchPanel
              startupName={result?.startup_name ?? 'Alma Health'}
              currentDIScore={result?.iro?.scores?.DI ?? 0}
              onApplyEvidence={(report) => {
                handleApplyDIEvidence(report);
                setDiPanelOpen(false);
              }}
            />
          </div>
        </div>
      )}

      <VaultPanel
        open={vaultPanelOpen}
        onClose={() => setVaultPanelOpen(false)}
        onSelect={(name) => {
          setStartup(name);
          const saved = history.find(h => h.result?.startup_name === name);
          if (saved) {
            setResult(saved.result);
          } else {
            setResult(null);
          }
        }}
      />

      {/* Overlay Dialogs / Modal Managers */}
      <AHPExpertPanel
        open={ahpPanelOpen}
        onClose={() => setAhpPanelOpen(false)}
        onApplyWeights={() => {}}
      />

      {pitchMode && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto" onClick={() => setPitchMode(false)}>
          <div className="max-w-3xl w-full relative" onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setPitchMode(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 z-50 hover:scale-115 transition-transform"
              title="Fermer"
              style={{ fontSize: '18px' }}
            >
              ✕
            </button>
            <PitchAnalyzer
              onAnalyze={handlePitchAnalyze}
              loading={loading}
              loadingStep={loadingStep}
            />
          </div>
        </div>
      )}

      {nlpMode && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setNlpMode(false)}>
          <div className="max-w-4xl w-full max-h-[90vh] overflow-y-auto relative bg-slate-900 border border-slate-800 rounded-xl p-6" onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setNlpMode(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
            >
              ✕
            </button>
            <IROStrengthNLP
              onScoresExtracted={(scores) => {
                setNlpScores(scores);
                setNlpMode(false);
                setToast({ message: "Scores NLP mis à jour !", type: 'success' });
              }}
            />
          </div>
        </div>
      )}

      {agentMode && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setAgentMode(false)}>
          <div className="max-w-5xl w-full h-[90vh] overflow-y-auto relative bg-slate-900 border border-slate-800 rounded-xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
              <h3 className="font-bold text-slate-200">Mode Agent Autonome (Antigravity v7.0)</h3>
              <button 
                onClick={() => setAgentMode(false)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                Fermer [✕]
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <IROAgentMode 
                trl={startupModel.trl_niveau ? {
                  niveau: parseInt(startupModel.trl_niveau as string),
                  description: TRL_DESCRIPTIONS[parseInt(startupModel.trl_niveau as string)],
                  source: 'utilisateur' as const,
                } : undefined}
                expertWeights={expertWeights}
              />
            </div>
          </div>
        </div>
      )}

      {/* Floating Alerts and Actions */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg border text-xs font-bold shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 ${
          toast.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/35 text-emerald-400' :
          toast.type === 'error' ? 'bg-rose-950/90 border-rose-500/35 text-rose-400' :
          'bg-slate-900 border-indigo-500/35 text-indigo-400'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <CompanyProvider>
      <AppContent />
    </CompanyProvider>
  );
}
