/**
 * VerdictPanel — IRO v4.5-S46
 * Corrections :
 *   [F5] Labels dynamiques selon IROMode (normatif / prédictif)
 *   [F5] Disclaimer mode affiché en permanence
 *   [S46] Seuil de viabilité recalibré à 46 (SEUIL_VIABILITE dynamique)
 *   [S46] zoneIRO() branché sur seuil officiel — plus de valeurs hardcodées
 */

import { VerdictData, buildIROMetadata, GOLD_STANDARD_N } from '../types/iro';
import { SEUIL_VIABILITE, SEUIL_ALERTE, zoneIRO } from '../utils/iro-engine';

interface VerdictPanelProps {
  verdict?:             VerdictData & { iro_100?: number };
  forces:               string[];
  risques:              string[];
  recommandation:       string;
  verdict_investisseur: string;
  iro_es?: {
    is_early_stage: boolean;
    score_brut: number;
    score_final: number;
    zone: { min: number; max: number; label: string; color: string; description: string };
    revs_applied: string[];
  };
}

function verdictColor(v: string, type: 'viabilite' | 'financement'): string {
  const ok = type === 'viabilite' ? 'viable' : 'recommande';
  const ko = type === 'viabilite' ? 'non_viable' : 'deconseille';
  if (v === ok) return '#00c896';
  if (v === ko) return '#ef4444';
  return '#f59e0b';
}

function verdictLabel(v: string): string {
  const labels: Record<string, string> = {
    viable: 'Viable', viable_sous_conditions: 'Viable sous conditions',
    non_viable: 'Non viable', recommande: 'Recommandé',
    conditionnel: 'Conditionnel', deconseille: 'Déconseillé',
  };
  return labels[v] ?? v.replace(/_/g, ' ');
}

function ListBlock({ title, items, color, numbered = false }: {
  title: string; items: string[]; color: string; numbered?: boolean;
}) {
  if (!items?.length) return null;
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12, padding: '12px 14px',
    }}>
      <div style={{ fontSize: 10, color, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>
        {title}
      </div>
      {items.map((item, i) => (
        <div key={`lst-${title}-${i}`} style={{ display: 'flex', gap: 7, marginBottom: 4, alignItems: 'flex-start' }}>
          <span style={{ color, fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
            {numbered ? String(i + 1).padStart(2, '0') : '›'}
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.62)', lineHeight: 1.5 }}>{item}</span>
        </div>
      ))}
    </div>
  );
}

export default function VerdictPanel({ verdict, forces, risques, recommandation, verdict_investisseur, iro_es }: VerdictPanelProps) {
  const vcol = verdict ? verdictColor(verdict.viabilite, 'viabilite') : '#60a5fa';
  const fcol = verdict ? verdictColor(verdict.financement, 'financement') : '#60a5fa';

  // [F5] Labels et disclaimer dynamiques selon le mode IRO
  const iroMeta = buildIROMetadata(GOLD_STANDARD_N);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* [F5] Disclaimer mode — toujours visible */}
      <div style={{
        padding: '8px 12px', borderRadius: 8,
        background: iroMeta.mode === 'normatif' ? 'rgba(99,102,241,0.08)' : 'rgba(0,200,150,0.08)',
        border: `1px solid ${iroMeta.mode === 'normatif' ? 'rgba(99,102,241,0.25)' : 'rgba(0,200,150,0.25)'}`,
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>{iroMeta.mode === 'normatif' ? 'ℹ' : '✓'}</span>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: iroMeta.mode === 'normatif' ? '#818cf8' : '#00c896', marginBottom: 2 }}>
            MODE {iroMeta.mode.toUpperCase()} — GOLD STANDARD n={iroMeta.gold_standard_n}/{iroMeta.gold_standard_min}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
            {iroMeta.ui_labels.mode_disclaimer}
          </div>
        </div>
      </div>

      {/* Métriques SRD */}
      {verdict && (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14, padding: '14px 16px',
          display: 'flex', gap: 0,
        }}>
          {[
            { label: 'VIABILITÉ',       value: verdictLabel(verdict.viabilite),  color: vcol },
            { label: 'FINANCEMENT',     value: verdictLabel(verdict.financement), color: fcol },
            {
              // [F5] Label dynamique : "HORIZON RISQUE" (normatif) vs "PRÉDICTION 18M" (prédictif)
              label: iroMeta.ui_labels.horizon_label.toUpperCase(),
              value: verdict.horizon_risque_mois ? `${verdict.horizon_risque_mois} mois` : '—',
              color: 'rgba(255,255,255,0.7)',
            },
          ].map((m, i) => (
            <div key={m.label} style={{
              flex: 1, textAlign: 'center' as const,
              borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              padding: '0 12px',
            }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.1em', marginBottom: 4 }}>
                {m.label}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* [S46] Zone IRO dynamique — seuil SEUIL_VIABILITE=46 */}
      {verdict && verdict.iro_100 !== undefined && (() => {
        const z = zoneIRO(verdict.iro_100);
        return (
          <div style={{
            padding: '10px 14px', borderRadius: 10,
            background: z.bg + '22',
            border: `1px solid ${z.bg}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 9, color: z.color, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 2 }}>
                ZONE IRO v4.5-S46 · seuil {SEUIL_VIABILITE}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: z.color }}>{z.label}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{z.desc}</div>
            </div>
            <div style={{ textAlign: 'right' as const }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: z.color }}>{verdict.iro_100}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>/100</div>
            </div>
          </div>
        );
      })()}

      {/* Module IRO-ES Early Stage Callout */}
      {iro_es?.is_early_stage && (
        <div style={{
          padding: '12px 14px', borderRadius: 10,
          background: 'rgba(0, 200, 150, 0.05)',
          border: '1px solid rgba(0, 200, 150, 0.2)',
          display: 'flex', flexDirection: 'column', gap: 8,
          marginTop: 4, marginBottom: 4,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 9, color: '#00c896', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 2 }}>
                MODULE RETRO-AJUSTÉ IRO-ES v1.0 (EARLY STAGE)
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                Mode de Scoring J+0 Activé
              </div>
              <p style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.5)', marginTop: 4, margin: '4px 0 0 0', lineHeight: 1.4 }}>
                Adapté pour jeunes startups de &lt;18m ou &lt;5 clients. Pondération orientée potentiel d'équipe (GCH = 22%) et vitesse d'apprentissage (CA = 18%).
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                background: iro_es.zone.color === 'green' ? 'rgba(0, 200, 150, 0.2)' : iro_es.zone.color === 'amber' || iro_es.zone.color === 'orange' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                color: iro_es.zone.color === 'green' ? '#00c896' : iro_es.zone.color === 'amber' || iro_es.zone.color === 'orange' ? '#f59e0b' : '#ef4444',
              }}>
                {iro_es.zone.label}
              </span>
            </div>
          </div>

          {iro_es.revs_applied && iro_es.revs_applied.length > 0 && (
            <div style={{ marginTop: 4, paddingTop: 6, borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <div style={{ fontSize: 8, color: 'rgba(255, 255, 255, 0.3)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }}>
                RÈGLES D'AJUSTEMENT APPLIQUÉES (REVs) :
              </div>
              {iro_es.revs_applied.map((rev, idx) => (
                <div key={idx} style={{ fontSize: 10, color: '#fbbf24', display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontSize: 8 }}>✦</span>
                  <span>{rev}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <ListBlock title="🚩 RED FLAGS"   items={verdict?.red_flags   ?? risques} color="#ef4444" />
        <ListBlock title="✦ FORCES CLÉS" items={verdict?.forces_cles ?? forces}  color="#00c896" />
      </div>

      {verdict?.opportunites_cachees && verdict.opportunites_cachees.length > 0 && (
        <ListBlock title="💡 OPPORTUNITÉS CACHÉES" items={verdict.opportunites_cachees} color="#a855f7" numbered />
      )}

      <div style={{
        background: 'rgba(99,102,241,0.06)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 12, padding: '13px 15px',
      }}>
        <div style={{ fontSize: 10, color: '#818cf8', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 7 }}>
          RECOMMANDATION
        </div>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', lineHeight: 1.7, margin: 0 }}>
          {recommandation}
        </p>
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12, padding: '13px 15px',
      }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 7 }}>
          VERDICT INVESTISSEUR
        </div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.82)', lineHeight: 1.65, margin: 0 }}>
          {verdict_investisseur}
        </p>
      </div>
    </div>
  );
}
