/**
 * DimensionChart — Antigravity Intelligence Platform
 * Radar chart Recharts des 5 dimensions IRO — dark mode cohérent
 */

import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from 'recharts';
import { IRO_WEIGHTS } from '../utils/weights-registry';

interface DimensionChartProps {
  scores: Record<string, number>;
  justifications: Record<string, string>;
  confiance?: number;
}

const DIM_LABELS: Record<string, string> = {
  DI:  'DI · Infra',
  ADC: 'ADC · Données',
  IPC: 'IPC · Intégration',
  AR:  'AR · Réglem.',
  CA:  'CA · Dynamique',
  GCH: 'GCH · Humain',
  LU:  'LU · Lead User',
};

const DIM_WEIGHTS: Record<string, number> = {
  DI: 18, ADC: 22, IPC: 22, AR: 13, CA: 10, GCH: 12, LU: 15,
};

function scoreColor(s: number) {
  if (s >= 80) return '#10b981'; // Excellent - Green
  if (s >= 65) return '#059669'; // Solide - Emerald/Teal
  if (s >= 46) return '#fbbf24'; // Vigilance - Amber/Yellow
  return '#f43f5e';             // Risque élevé - Red/Rose
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: { subject: string; score: number; justification: string } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const col = scoreColor((d.score / 4) * 100);
  return (
    <div style={{
      background: 'rgba(10,14,24,0.96)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 8, padding: '8px 12px',
      maxWidth: 240
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: col, marginBottom: 3 }}>{d.subject}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
        Score : <span style={{ fontWeight: 700, color: col }}>{d.score}/4</span>
      </div>
      {d.justification && (
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4, fontStyle: 'italic' }}>
          {d.justification}
        </div>
      )}
    </div>
  );
}

export default function DimensionChart({ scores, justifications, confiance }: DimensionChartProps) {
  const data = (['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH', 'LU'] as const).map(k => ({
    subject:  DIM_LABELS[k],
    score:    scores?.[k] ?? 0,
    justification: justifications?.[k] ?? 'Non documenté',
    fullMark: 4,
  }));

  // Couleur principale basée sur le score moyen pondéré
  const weighted = (
    (scores?.DI ?? 0)  * IRO_WEIGHTS.DI +
    (scores?.ADC ?? 0) * IRO_WEIGHTS.ADC +
    (scores?.IPC ?? 0) * IRO_WEIGHTS.IPC +
    (scores?.AR ?? 0)  * IRO_WEIGHTS.AR +
    (scores?.CA ?? 0)  * IRO_WEIGHTS.CA +
    (scores?.GCH ?? 0) * IRO_WEIGHTS.GCH +
    (scores?.LU ?? 0)  * (IRO_WEIGHTS.LU ?? 0.15)
  );
  const avgColor = scoreColor((weighted / 4) * 100);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 14, padding: '16px 18px',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.1em' }}>
          PROFIL RADAR — 7 DIMENSIONS IRO v4.5-S46
        </div>
        {confiance !== undefined && (
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>
            CONFIANCE IPC : {Math.round(confiance * 100)}%
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <RadarChart cx="50%" cy="50%" outerRadius="75%" data={data}>
          <PolarGrid stroke="rgba(255,255,255,0.08)" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10, fontFamily: 'monospace' }}
          />
          <PolarRadiusAxis
            angle={90} domain={[0, 4]}
            tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 9 }}
            tickCount={5}
            axisLine={false}
          />
          <Radar
            name="Score IRO"
            dataKey="score"
            stroke={avgColor}
            fill={avgColor}
            fillOpacity={0.18}
            strokeWidth={2}
          />
          <Tooltip content={<CustomTooltip />} />
        </RadarChart>
      </ResponsiveContainer>

      {/* Légende des poids */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
        marginTop: 12, paddingTop: 12,
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}>
        {(['DI', 'ADC', 'IPC', 'AR', 'CA', 'GCH', 'LU'] as const).map(k => {
          const val = scores?.[k] ?? 0;
          const col = scoreColor(val * 25);
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: col, flexShrink: 0,
              }} />
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
                {k} <span style={{ color: col, fontWeight: 700 }}>{val}/4</span>
                <span style={{ color: 'rgba(255,255,255,0.2)' }}> · {DIM_WEIGHTS[k]}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
