import React, { useState, useEffect } from 'react';
import { X, Info, AlertTriangle, Check, RefreshCcw, Save } from 'lucide-react';
import { AHPMatrix, AHPResult, computeAHPWeights, INITIAL_AHP_MATRIX } from '../utils/ahp';

interface AHPExpertPanelProps {
  open: boolean;
  onClose: () => void;
  onApplyWeights: (result: AHPResult) => void;
}

export default function AHPExpertPanel({ open, onClose, onApplyWeights }: AHPExpertPanelProps) {
  const [matrix, setMatrix] = useState<AHPMatrix>(INITIAL_AHP_MATRIX);
  const [result, setResult] = useState<AHPResult>(computeAHPWeights(INITIAL_AHP_MATRIX));

  // Recalculer les poids dès que la matrice change
  useEffect(() => {
    setResult(computeAHPWeights(matrix));
  }, [matrix]);

  const updateComparison = (i: number, j: number, value: number) => {
    const newComparisons = matrix.comparisons.map(row => [...row]);
    newComparisons[i][j] = value;
    newComparisons[j][i] = 1 / value; // Réciproque
    setMatrix({ ...matrix, comparisons: newComparisons });
  };

  const resetMatrix = () => {
    setMatrix(INITIAL_AHP_MATRIX);
  };

  const saatyScale = [
    { v: 1, l: 'Importance égale' },
    { v: 3, l: 'Importance modérée' },
    { v: 5, l: 'Importance forte' },
    { v: 7, l: 'Importance très forte' },
    { v: 9, l: 'Importance extrême' },
    { v: 0.33, l: 'Moins important (1/3)' },
    { v: 0.2, l: 'Beaucoup moins (1/5)' },
    { v: 0.11, l: 'Extrêmement moins (1/9)' },
  ];

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] transition-opacity"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-[500px] bg-slate-900 border-l border-slate-800 shadow-2xl z-[101] flex flex-col font-sans overflow-hidden animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <RefreshCcw className="text-indigo-400" size={20} />
              Calibration Expert AHP
            </h2>
            <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-semibold">
              Analytic Hierarchy Process — Raffinement des poids IRO
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Methodology Info */}
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 flex gap-4">
            <Info className="text-indigo-400 shrink-0" size={20} />
            <div className="text-sm text-slate-300 leading-relaxed">
              La méthode AHP permet d'extraire des poids stables à partir de comparaisons par paires. 
              <span className="block mt-2 text-indigo-300 font-medium italic">
                "Si la dimension A est 3x plus importante que B, alors B est 1/3 moins importante que A."
              </span>
            </div>
          </div>

          {/* Matrix Table */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">Matrice de Saaty</h3>
              <button 
                onClick={resetMatrix}
                className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 uppercase"
              >
                <RotateCcw size={10} />
                Réinitialiser
              </button>
            </div>
            
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/80 border-b border-slate-800">
                    <th className="p-3 text-slate-500 font-mono">VS</th>
                    {matrix.dimensions.map(d => (
                      <th key={d} className="p-3 text-center text-slate-300 font-bold">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.dimensions.map((di, i) => (
                    <tr key={di} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                      <td className="p-3 font-bold text-slate-300 bg-slate-900/30 whitespace-nowrap">{di}</td>
                      {matrix.dimensions.map((dj, j) => {
                        const val = matrix.comparisons[i][j];
                        const isEditable = i < j;
                        const isDiagonal = i === j;
                        
                        return (
                          <td 
                            key={dj} 
                            className={`p-1 text-center ${isDiagonal ? 'bg-slate-800/10' : ''}`}
                          >
                            {isDiagonal ? (
                              <span className="text-slate-600 font-mono">1</span>
                            ) : isEditable ? (
                              <select 
                                value={val} 
                                onChange={(e) => updateComparison(i, j, parseFloat(e.target.value))}
                                className="w-14 bg-slate-800 border border-slate-700 rounded p-1 text-[10px] text-indigo-300 font-mono focus:border-indigo-500 outline-none cursor-pointer"
                              >
                                {saatyScale.map(s => {
                                  const sv = s.v as number;
                                  return (
                                    <option key={`saaty-val-${sv}`} value={sv}>{sv >= 1 ? sv : `1/${Math.round(1/sv)}`}</option>
                                  );
                                })}
                                {/* Custom values if needed */}
                                {![1,3,5,7,9,0.33,0.2,0.11].includes(val) && (
                                  <option key="custom-val" value={val}>{val.toFixed(2)}</option>
                                )}
                              </select>
                            ) : (
                              <span className="text-slate-500 font-mono opacity-50">
                                {val >= 1 ? val.toFixed(0) : `1/${Math.round(1/(val as number))}`}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Verification Ratio */}
          <section className="bg-slate-950/50 rounded-xl border border-slate-800 p-5 p-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">Validité Statistique</h3>
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                result.isConsistent 
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}>
                {result.isConsistent ? <Check size={12} /> : <AlertTriangle size={12} />}
                {result.isConsistent ? 'Cohérent' : 'Incoherent'}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-slate-400">Consistency Ratio (CR)</span>
              <span className={`font-mono font-bold ${result.isConsistent ? 'text-emerald-400' : 'text-rose-400'}`}>
                {result.consistencyRatio.toFixed(4)}
              </span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${result.isConsistent ? 'bg-emerald-500' : 'bg-rose-500'}`}
                style={{ width: `${Math.min(100, result.consistencyRatio * 500)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-slate-600">Perfect (0.0)</span>
              <span className="text-[10px] text-slate-600">Threshold (0.1)</span>
            </div>
            
            {!result.isConsistent && (
              <p className="mt-4 text-xs text-rose-300 leading-relaxed italic bg-rose-500/5 p-3 rounded-lg border border-rose-500/10">
                L'indice de cohérence dépasse 10%. Vos jugements sont contradictoires (ex: A &gt; B, B &gt; C mais C &gt; A). Veuillez ajuster les priorités.
              </p>
            )}
          </section>

          {/* Weights Output */}
          <section>
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest mb-4">Poids Dérivés (Vecteur Propre)</h3>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(result.weights).map(([dim, weight]) => {
                const wNum = weight as number;
                return (
                  <div key={dim} className="bg-slate-800/40 border border-slate-800 rounded-lg p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center font-bold text-indigo-300 text-xs shadow-inner">
                        {dim}
                      </div>
                      <div className="w-24 bg-slate-700/50 h-1 rounded-full overflow-hidden">
                        <div 
                           className="h-full bg-indigo-500"
                           style={{ width: `${(wNum * 100 * 3)}%` }} 
                        />
                      </div>
                    </div>
                    <span className="font-mono font-bold text-white text-sm">
                      {(wNum * 100).toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/80 flex gap-3">
          <button 
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-700 text-slate-300 font-bold text-xs hover:bg-slate-800 transition-colors uppercase tracking-widest"
          >
            Annuler
          </button>
          <button 
            disabled={!result.isConsistent}
            onClick={() => onApplyWeights(result)}
            className="flex-1 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-xs shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 uppercase tracking-widest"
          >
            <Save size={14} />
            Appliquer
          </button>
        </div>
      </div>
    </>
  );
}

function RotateCcw(props: any) {
  return (
    <svg 
      {...props}
      xmlns="http://www.w3.org/2000/svg" 
      width="12" 
      height="12" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}
