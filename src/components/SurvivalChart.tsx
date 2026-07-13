/**
 * SurvivalChart.tsx — Antigravity Intelligence Platform
 * Graphique de survie basé sur le modèle de Cox
 * Affiche la courbe de la startup vs les références du marché
 */

import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';

interface SurvivalDataPoint {
  month: number;
  startup: number;     // Ensemble Cox+RSF (ou Cox seul si RSF indisponible)
  cox_only?: number;   // Cox seul (pour comparaison)
  actives: number;
  echecs: number;
  seuil: number;
}

interface SurvivalChartProps {
  startupName: string;
  mainCurve: { months: number[]; survival: number[] };
  /** Courbe Cox seule (sans RSF) — pour comparaison si RSF disponible */
  coxOnlyCurve?: { months: number[]; survival: number[] } | null;
  rsf_available?: boolean;
  /** Note IC conformal depuis cox_survival.ci_note */
  ci_note?: string;
  /** Méthode IC : 'conformal_sesia2025' ou 'delta_method' */
  ci_method?: string;
  references: {
    leader: { months: number[]; survival: number[] };
    mediane_actives: { months: number[]; survival: number[] };
    mediane_echecs: { months: number[]; survival: number[] };
    seuil_critique: { months: number[]; survival: number[] };
  };
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg shadow-xl outline-none">
        <p className="text-[10px] font-bold text-slate-500 mb-2 font-mono uppercase tracking-widest">
          MOIS {label}
        </p>
        <div className="space-y-1.5">
          {payload.map((entry: any, index: number) => (
            <div key={`tt-surv-${index}`} className="flex items-center justify-between gap-4">
              <span className="text-[10px] font-bold" style={{ color: entry.color }}>
                {entry.name}:
              </span>
              <span className="text-xs font-mono font-bold" style={{ color: entry.color }}>
                {entry.value.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export function SurvivalChart({ startupName, mainCurve, coxOnlyCurve, rsf_available, references }: SurvivalChartProps) {
  // Transformation des données pour Recharts
  const data: SurvivalDataPoint[] = mainCurve.months.map((m, i) => ({
    month: m,
    startup: mainCurve.survival[i],
    cox_only: coxOnlyCurve ? coxOnlyCurve.survival[i] : undefined,
    actives: references.mediane_actives.survival[i],
    echecs: references.mediane_echecs.survival[i],
    seuil: references.seuil_critique.survival[i],
  }));

  return (
    <div className="w-full h-full min-h-[220px] bg-slate-900/30 border border-slate-800/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">
          {rsf_available ? 'PROBABILITÉ DE SURVIE (COX + RSF v6 — Ensemble 60/40)' : 'PROBABILITÉ DE SURVIE (COX IRO v6)'}
        </div>
        <div className="text-[9px] text-slate-600 font-mono italic">
          Cohorte FR n=130
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: -15, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis 
            dataKey="month" 
            stroke="rgba(255,255,255,0.2)" 
            fontSize={10} 
            fontFamily="monospace"
            tick={{ fill: 'rgba(255,255,255,0.4)' }}
            ticks={[0, 6, 12, 18, 24, 30, 36]}
            domain={[0, 36]}
            label={{ value: 'Mois', position: 'insideBottomRight', offset: -5, fontSize: 9, fill: 'rgba(255,255,255,0.2)' }}
          />
          <YAxis 
            stroke="rgba(255,255,255,0.2)" 
            fontSize={10} 
            fontFamily="monospace"
            tick={{ fill: 'rgba(255,255,255,0.4)' }}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
          />
          <Tooltip content={<CustomTooltip />} />
          
          <Line 
            name={rsf_available ? `${startupName} (Ensemble Cox+RSF)` : startupName} 
            type="monotone" 
            dataKey="startup" 
            stroke="#38bdf8" 
            strokeWidth={3} 
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          {coxOnlyCurve && rsf_available && (
            <Line 
              name={`${startupName} (Cox seul)`}
              type="monotone" 
              dataKey="cox_only" 
              stroke="#a855f7"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              opacity={0.8}
            />
          )}
          <Line 
            name="Moyenne Actives" 
            type="monotone" 
            dataKey="actives" 
            stroke="#10b981" 
            strokeWidth={1.5} 
            strokeDasharray="4 4" 
            dot={false}
          />
          <Line 
            name="Similaires Échecs" 
            type="monotone" 
            dataKey="echecs" 
            stroke="#f43f5e" 
            strokeWidth={1.5} 
            strokeDasharray="2 2" 
            dot={false}
            opacity={0.8}
          />
          
          {/* Seuil critique à 50% de proba à 36m */}
          <ReferenceLine y={50} stroke="#ef4444" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.3} />
          
          <Legend 
            verticalAlign="bottom" 
            height={36} 
            iconType="circle"
            content={({ payload }) => (
              <div className="flex justify-center gap-4 mt-4">
                {payload?.map((entry: any, index: number) => (
                  <div key={`lg-surv-${index}`} className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider">
                    <div 
                      className="w-2 h-2 rounded-full" 
                      style={{ backgroundColor: entry.color }} 
                    />
                    <span style={{ color: entry.color }}>
                      {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── IC Method Badge — affiché sous le graphe dans App.tsx ──────────────────
export function ICMethodBadge({ ci_method, ci_note }: { ci_method?: string; ci_note?: string }) {
  if (!ci_method) return null;
  const isConformal = ci_method === 'conformal_sesia2025';
  return (
    <div className={`mt-1 text-[9px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${
      isConformal ? 'bg-emerald-900/30 text-emerald-400' : 'bg-slate-700 text-slate-400'
    }`}>
      <span>{isConformal ? '✓ IC Conformal (Sesia 2025)' : 'IC Delta-method'}</span>
      {ci_note && <span title={ci_note} className="cursor-help opacity-60">ⓘ</span>}
    </div>
  );
}

export default SurvivalChart;
