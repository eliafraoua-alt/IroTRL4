import React from 'react';
import { useIRO, AXES_CONFIG } from '../../contexts/IROAnalysisContext';
import { motion } from 'motion/react';
import { Shield, HelpCircle, CheckCircle, RotateCcw, AlertTriangle } from 'lucide-react';
import ErrorBoundary from '../ErrorBoundary';
import { computeAHPWeights, INITIAL_AHP_MATRIX } from '../../utils/ahp';
import type { AHPResult } from '../../utils/ahp';

// Local list of dimension pairs for AHP comparison
const AHP_PAIRS = [
  { row: 'DI', col: 'ADC', labelRow: 'Dépendance Infra (DI)', labelCol: 'Actif de Données (ADC)' },
  { row: 'DI', col: 'IPC', labelRow: 'Dépendance Infra (DI)', labelCol: 'Processus Critiques (IPC)' },
  { row: 'DI', col: 'AR',  labelRow: 'Dépendance Infra (DI)', labelCol: 'Anticipation Réglo (AR)' },
  { row: 'DI', col: 'CA',  labelRow: 'Dépendance Infra (DI)', labelCol: 'Capacité Adaptation (CA)' },
  { row: 'DI', col: 'GCH', labelRow: 'Dépendance Infra (DI)', labelCol: 'Capital Humain (GCH)' },

  { row: 'ADC', col: 'IPC', labelRow: 'Actif de Données (ADC)', labelCol: 'Processus Critiques (IPC)' },
  { row: 'ADC', col: 'AR',  labelRow: 'Actif de Données (ADC)', labelCol: 'Anticipation Réglo (AR)' },
  { row: 'ADC', col: 'CA',  labelRow: 'Actif de Données (ADC)', labelCol: 'Capacité Adaptation (CA)' },
  { row: 'ADC', col: 'GCH', labelRow: 'Actif de Données (ADC)', labelCol: 'Capital Humain (GCH)' },

  { row: 'IPC', col: 'AR',  labelRow: 'Processus Critiques (IPC)', labelCol: 'Anticipation Réglo (AR)' },
  { row: 'IPC', col: 'CA',  labelRow: 'Processus Critiques (IPC)', labelCol: 'Capacité Adaptation (CA)' },
  { row: 'IPC', col: 'GCH', labelRow: 'Processus Critiques (IPC)', labelCol: 'Capital Humain (GCH)' },

  { row: 'AR', col: 'CA',  labelRow: 'Anticipation Réglo (AR)', labelCol: 'Capacité Adaptation (CA)' },
  { row: 'AR', col: 'GCH', labelRow: 'Anticipation Réglo (AR)', labelCol: 'Capital Humain (GCH)' },

  { row: 'CA', col: 'GCH', labelRow: 'Capacité Adaptation (CA)', labelCol: 'Capital Humain (GCH)' },
];

export const ExpertAHPView: React.FC = () => {
  const {
    ahpResult,
    setAhpResult,
    expertWeights,
    setExpertWeights,
    setToast
  } = useIRO();

  const ahpMatrixToRecord = (ahp: typeof INITIAL_AHP_MATRIX): Record<string, Record<string, number>> => {
    const rec: Record<string, Record<string, number>> = {};
    const dims = ahp.dimensions;
    dims.forEach((d, i) => {
      rec[d] = {};
      dims.forEach((col, j) => {
        rec[d][col] = ahp.comparisons[i][j];
      });
    });
    return rec;
  };

  // Load or initialize Matrix state. Use state to allow interactive configuration.
  const [matrix, setMatrix] = React.useState<Record<string, Record<string, number>>>(() => {
    return ahpMatrixToRecord(INITIAL_AHP_MATRIX);
  });

  const handleSliderChange = (row: string, col: string, sliderVal: number) => {
    // Convert slider value (-8 to +8) to Saaty scale (1/9 to 9)
    let val = 1;
    if (sliderVal > 0) {
      val = sliderVal + 1; // 1 to 9
    } else if (sliderVal < 0) {
      val = 1 / (Math.abs(sliderVal) + 1); // 1/2 to 1/9
    }

    setMatrix(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next[row][col] = val;
      next[col][row] = 1 / val;
      return next;
    });
  };

  const getSliderValue = (row: string, col: string) => {
    const val = matrix[row]?.[col] ?? 1;
    if (val >= 1) {
      return val - 1; // 0 to 8
    } else {
      return -(Math.round(1 / val) - 1); // -1 to -8
    }
  };

  const applyAHP = () => {
    try {
      const ahpMatrix = {
        dimensions: ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'],
        comparisons: ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'].map(row => 
          ['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH'].map(col => matrix[row]?.[col] ?? 1)
        )
      };
      const result: AHPResult = computeAHPWeights(ahpMatrix);
      setAhpResult(result);
      setExpertWeights(result.weights);
      setToast({
        message: `Poids experts redistribués avec succès ! CR = ${result.consistencyRatio.toFixed(3)}`,
        type: 'success'
      });
    } catch (err: any) {
      setToast({
        message: `Échec du calcul AHP : ${err?.message || 'Inconnu'}`,
        type: 'error'
      });
    }
  };

  const resetToStandard = () => {
    setMatrix(ahpMatrixToRecord(INITIAL_AHP_MATRIX));
    const standards = AXES_CONFIG.reduce((acc, ax) => {
      acc[ax.key] = ax.weight;
      return acc;
    }, {} as Record<string, number>);
    
    setExpertWeights(standards);
    setAhpResult({
      weights: standards,
      consistencyRatio: 0,
      isConsistent: true,
      lambdaMax: 6,
    });
    setToast({
      message: 'Poids réinitialisés aux valeurs standards du protocole Delphi v7.0',
      type: 'info'
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Overview Block */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="text-[10px] text-indigo-400 font-bold tracking-widest uppercase flex items-center gap-1.5 mb-1">
              <Shield size={14} /> Protocole de Calibration Multi-Critères AHP
            </div>
            <h2 className="text-xl font-black text-slate-100">Curation des Poids par l'Expert</h2>
            <p className="text-xs text-slate-500 max-w-2xl mt-1">
              La comparaison par paires (Analytic Hierarchy Process) calcule mathématiquement les poids d'importance des 6 axes IRO en vérifiant la cohérence logique de vos jugements (Saaty, 1980).
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={resetToStandard}
              className="px-3 py-2 text-xs font-bold font-mono bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg text-slate-400 hover:text-white transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw size={12} /> Réinitialiser
            </button>
            <button
              onClick={applyAHP}
              className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-slate-100/10 hover:text-indigo-400 rounded-lg text-white transition-all cursor-pointer border border-indigo-500/35"
            >
              Calculer & Appliquer
            </button>
          </div>
        </div>

        {/* Status Metrics Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6 pt-5 border-t border-slate-800">
          <div className="bg-slate-950 rounded-lg p-3 text-center border border-slate-800/60">
            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wide">Ratio de Cohérence (R.C.)</span>
            <div className={`text-xl font-black font-mono mt-1 ${ahpResult.isConsistent ? 'text-emerald-400' : 'text-amber-500'}`}>
              {ahpResult.consistencyRatio.toFixed(4)}
            </div>
            <span className="text-[9px] text-slate-500">Seuil acceptable : CR &lt; 0.10</span>
          </div>
          
          <div className="bg-slate-950 rounded-lg p-3 text-center border border-slate-800/60">
            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wide">État de Cohérence</span>
            <div className={`text-sm font-black uppercase mt-1.5 flex items-center justify-center gap-1.5 ${ahpResult.isConsistent ? 'text-emerald-400' : 'text-amber-400'}`}>
              {ahpResult.isConsistent ? (
                <>
                  <CheckCircle size={15} /> Consistant
                </>
              ) : (
                <>
                  <AlertTriangle size={15} /> Inconsistant (&gt;10%)
                </>
              )}
            </div>
            <span className="text-[9px] text-slate-500">Ajustements requis si inconsistant</span>
          </div>

          <div className="bg-slate-950 rounded-lg p-3 text-center border border-slate-800/60">
            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wide">Qualité Instrument</span>
            <div className="text-xl font-black font-mono text-indigo-400 mt-1 uppercase">
              Consensus v7.0
            </div>
            <span className="text-[9px] text-slate-500">Calibration validée par panel expert</span>
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* Sliders Area */}
        <div className="xl:col-span-3 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-300 border-b border-slate-800 pb-2 uppercase tracking-tight">Comparaisons par Paires</h3>
          <div className="space-y-5 h-[480px] overflow-y-auto pr-2 custom-scrollbar">
            {AHP_PAIRS.map((pair, idx) => {
              const sliderVal = getSliderValue(pair.row, pair.col);
              return (
                <div key={`ahp-p-${idx}`} className="bg-slate-950/40 border border-slate-850 p-3.5 rounded-lg space-y-2">
                  <div className="flex justify-between items-center text-[11px] font-bold text-slate-400">
                    <span className={sliderVal < 0 ? 'text-indigo-400 font-extrabold' : 'text-slate-500'}>
                      {pair.labelRow}
                    </span>
                    <span className="font-mono text-[10px] bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      {sliderVal === 0 ? 'Importance Égale' : sliderVal > 0 ? `${pair.col} +${sliderVal}` : `${pair.row} +${Math.abs(sliderVal)}`}
                    </span>
                    <span className={sliderVal > 0 ? 'text-indigo-400 font-extrabold' : 'text-slate-500'}>
                      {pair.labelCol}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-500 font-strong">9</span>
                    <input
                      type="range"
                      min="-8"
                      max="8"
                      value={sliderVal}
                      onChange={e => handleSliderChange(pair.row, pair.col, parseInt(e.target.value))}
                      className="flex-1 accent-indigo-500 h-1 bg-slate-800 rounded-lg opacity-85 hover:opacity-100 cursor-pointer"
                    />
                    <span className="text-[10px] text-slate-500 font-strong">9</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Weights & Formula Info */}
        <div className="xl:col-span-2 space-y-5">
          {/* Result weights card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-bold text-slate-300 border-b border-slate-800 pb-2 uppercase tracking-tight flex items-center justify-between">
              <span>Poids d'Importance Calculés</span>
              <span className="text-[10px] text-slate-500 lowercase font-medium">Somme = 100%</span>
            </h3>
            <div className="space-y-3 mt-4">
              {AXES_CONFIG.map(ax => {
                const weight = expertWeights[ax.key] ?? ax.weight;
                const standard = ax.weight;
                const diff = weight - standard;
                return (
                  <div key={`ahp-weight-res-${ax.key}`} className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ax.color }} />
                        <span className="text-xs font-black text-slate-200">{ax.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {diff !== 0 && (
                          <span className={`text-[9px] font-mono leading-none ${diff > 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                            {diff > 0 ? `+${(diff*100).toFixed(1)}%` : `${(diff*100).toFixed(1)}%`}
                          </span>
                        )}
                        <span className="text-sm font-black font-mono" style={{ color: ax.color }}>
                          {(weight * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    {/* Progress Bar */}
                    <div className="h-1.5 bg-slate-900 rounded overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${weight * 100}%`, backgroundColor: ax.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mathematical provenance */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2 text-[10px] text-slate-500 leading-relaxed">
            <h4 className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">Note Méthodologique</h4>
            <p>
              Le vecteur de priorité est calculé via la recherche du vecteur propre principal de la matrice de jugement Saaty.
            </p>
            <p>
              La cohérence logique est évaluée en normalisant l'indice de cohérence (I.C.) par l'indice aléatoire (R.I.) correspondant pour obtenir le Ratio de Cohérence (CR).
            </p>
            <p className="border-t border-slate-800 pt-2 text-indigo-400">
              Poids v7.0 standards du protocole (Delphi) : <br />
              DI (18%) · ADC (22%) · IPC (22%) · AR (13%) · CA (13%) · GCH (12%)
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
export default ExpertAHPView;
