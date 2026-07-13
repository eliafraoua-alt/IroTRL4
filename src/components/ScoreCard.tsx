/**
 * ScoreCard — Antigravity Intelligence Platform
 * Affiche le score IRO principal avec jauge, interprétation, badges REV
 */

interface ScoreCardProps {
  score: number;
  interpretation: string;
  floor_activated: boolean;
  ancrage_warning: boolean;
  score_optimiste: number;
  score_pessimiste: number;
  confiance_globale: number;
}

function scoreColor(s: number) {
  if (s >= 80) return '#10b981'; // Excellent - Green
  if (s >= 65) return '#059669'; // Solide - Emerald/Teal
  if (s >= 46) return '#fbbf24'; // Vigilance - Amber/Yellow
  return '#f43f5e';             // Risque élevé - Red/Rose
}

function Gauge({ value, size = 120, color }: { value: number; size?: number; color: string }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="rgba(255,255,255,0.07)" strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c - (value / 100) * c}
        style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)' }} />
    </svg>
  );
}

export default function ScoreCard({
  score, interpretation, floor_activated, ancrage_warning,
  score_optimiste, score_pessimiste, confiance_globale,
}: ScoreCardProps) {
  const color = scoreColor(score);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 16, padding: '16px 18px',
      display: 'flex', gap: 16, alignItems: 'center',
    }}>
      {/* Jauge */}
      <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
        <Gauge value={score} size={100} color={color} />
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>
            {Number(score || 0).toFixed(0)}
          </span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.32)' }}>/100</span>
        </div>
      </div>

      {/* Infos */}
      <div style={{ flex: 1 }}>
        {/* Interprétation + badges */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{
            padding: '2px 8px', borderRadius: 5, fontSize: 12, fontWeight: 700,
            background: `${color}22`, color,
          }}>{interpretation}</span>
          {floor_activated && (
            <span style={{
              padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
              background: 'rgba(239,68,68,0.15)', color: '#ef4444',
            }}>🔒 PLANCHER DI=0</span>
          )}
          {ancrage_warning && (
            <span style={{
              padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
              background: 'rgba(245,166,35,0.15)', color: '#f59e0b',
            }}>⚠ ANCRAGE REV8</span>
          )}
        </div>

        {/* Fourchette */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
          {[
            { l: 'Optimiste', v: score_optimiste, c: '#00c896' },
            { l: 'Pessimiste', v: score_pessimiste, c: '#ef4444' },
          ].map(x => (
            <div key={x.l}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', marginBottom: 2 }}>{x.l}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: x.c }}>{Number(x.v || 0).toFixed(0)}</div>
            </div>
          ))}
        </div>

        {/* Barre confiance */}
        <div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', marginBottom: 3 }}>
            CONFIANCE — {Math.round((confiance_globale || 0.7) * 100)}%
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden', width: 140 }}>
            <div style={{
              height: '100%',
              width: `${Math.round((confiance_globale || 0.7) * 100)}%`,
              background: color, borderRadius: 2,
              transition: 'width 1s ease',
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}
