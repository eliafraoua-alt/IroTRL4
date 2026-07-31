/**
 * src/components/PappersPanel.tsx
 * IRO Strength v6.6 — Antigravity Intelligence Platform
 *
 * Visualisation des données Pappers / INPI / Bodacc
 * avec mapping direct vers les dimensions IRO.
 */

import React, { useState } from 'react';
import { 
  Shield, FileText, Activity, Users, Landmark, AlertCircle, RefreshCw, Check
} from 'lucide-react';
import {
  usePappers,
  type PappersEntreprise,
  type PappersIROContext,
} from '../collectors/pappers';

// ══════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ══════════════════════════════════════════════════════════════════

interface PappersPanelProps {
  startupName:    string;
  onDataLoaded?:  (data: PappersEntreprise, ctx: PappersIROContext) => void;
  compact?:       boolean;
}

export const PappersPanel: React.FC<PappersPanelProps> = ({
  startupName, onDataLoaded, compact = false,
}) => {
  const { data, iroContext, loading, error, fetch, reset } = usePappers();
  const [searched, setSearched] = useState(false);

  const handleFetch = async () => {
    setSearched(true);
    await fetch(startupName);
  };

  // Appelé après le chargement réussi
  React.useEffect(() => {
    if (data && iroContext) onDataLoaded?.(data, iroContext);
  }, [data, iroContext]); // eslint-disable-line react-hooks/exhaustive-deps

  const S = styles;

  // ── Stade honeymoon ────────────────────────────────────────────
  const stadeColor = (ageMois: number | null): string => {
    if (!ageMois) return '#888780';
    if (ageMois < 12)  return '#2DBA4E';  // discovery / validation
    if (ageMois < 24)  return '#F87171';  // pic risque
    if (ageMois < 36)  return '#FBBF24';  // efficiency
    return '#818CF8';                      // mature
  };
  const stadeLabel = (ageMois: number | null): string => {
    if (!ageMois) return 'N/A';
    if (ageMois < 6)  return `${ageMois}m — Discovery 🌱`;
    if (ageMois < 12) return `${ageMois}m — Validation`;
    if (ageMois < 24) return `${ageMois}m — Pic risque ⚠`;
    if (ageMois < 36) return `${ageMois}m — Efficiency`;
    return `${ageMois}m — Mature`;
  };

  return (
    <div style={S.wrap}>

      {/* ── Header ── */}
      <div style={S.header}>
        <div>
          <div style={S.title}>Pappers · INPI · Bodacc</div>
          <div style={S.subtitle}>Sources officielles françaises — Entièrement gratuit</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {data && (
            <button onClick={reset} style={S.btnLight}>
              <RefreshCw size={12} style={{ marginRight: 4 }} /> 
              Réinitialiser
            </button>
          )}
          <button
            onClick={handleFetch}
            disabled={loading || !startupName}
            style={{ ...S.btnPrimary, opacity: loading || !startupName ? 0.6 : 1 }}
          >
            {loading ? '⏳ Collecte…' : searched && !data ? '🔄 Réessayer' : '🔍 Collecter'}
          </button>
        </div>
      </div>

      {/* ── Sources badges ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: '① API État unifié (INPI/SIRENE/BODACC)', note: 'Mise à jour en direct', ok: true },
          { label: '② Pappers.fr',                          note: '100/j gratuit', ok: true },
          { label: '③ INPI brevets',                        note: 'Gratuit',       ok: true },
          { label: '④ Bodacc',                              note: 'Open data',     ok: true },
          { label: '⑤ INSEE Sirene',                        note: 'Backup',       ok: true },
        ].map((src, i) => (
          <div key={`src-badge-${i}`} style={S.sourceBadge}>
            <span style={{ color: '#2DBA4E', marginRight: 4 }}>✓</span>
            <strong>{src.label}</strong>
            <span style={{ color: '#888780', marginLeft: 4 }}>— {src.note}</span>
          </div>
        ))}
      </div>

      {/* ── Erreur ── */}
      {error && (
        <div style={S.alertWarn}>
          <AlertCircle size={16} />
          <span>{error}</span>
          <div style={{ fontSize: 11, marginTop: 4, color: 'rgba(0,0,0,0.5)' }}>
            Vérifiez que le nom correspond à la dénomination sociale exacte.
          </div>
        </div>
      )}

      {/* ── Placeholder ── */}
      {!data && !loading && !searched && (
        <div style={S.placeholder}>
          <Landmark size={48} style={{ color: '#1E293B', marginBottom: 12, opacity: 0.2 }} />
          <div style={{ fontWeight: 600, color: '#94A3B8', marginBottom: 4 }}>Données juridiques et légales</div>
          <div style={{ fontSize: 12, color: '#64748B' }}>
            Cliquez sur "Collecter" pour lancer le pipeline v6.6
          </div>
        </div>
      )}

      {/* ── Données chargées ── */}
      {data && iroContext && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Alertes Bodacc */}
          {(data.alerte_cessation || data.alerte_redressement) && (
            <div style={S.alertCritique}>
              <Activity size={20} />
              <div>
                <strong>
                  {data.alerte_cessation    ? 'CESSATION / RADIATION détectée' : ''}
                  {data.alerte_redressement ? 'REDRESSEMENT JUDICIAIRE détecté' : ''}
                </strong>
                <div style={{ fontSize: 11, marginTop: 2, opacity: 0.8 }}>
                  Signal SRD critique — DFL automatiquement majoré
                </div>
              </div>
            </div>
          )}

          {/* ── KPIs IRO ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <div style={S.kpi}>
              <div style={S.kpiLabel}>Stade</div>
              <div style={{ ...S.kpiVal, color: stadeColor(data.age_mois), fontSize: 11 }}>
                {stadeLabel(data.age_mois)}
              </div>
            </div>
            <div style={S.kpi}>
              <div style={S.kpiLabel}>Signal AR</div>
              <div style={{ ...S.kpiVal, color: iroContext.ar_signal_bonus > 0 ? '#10B981' : '#888780' }}>
                +{iroContext.ar_signal_bonus} pts
              </div>
              <div style={S.kpiSub}>{data.brevets_count} brevets · {data.brevets_ia} IA</div>
            </div>
            <div style={S.kpi}>
              <div style={S.kpiLabel}>Effectifs</div>
              <div style={{ ...S.kpiVal, color: iroContext.team_size_small ? '#F59E0B' : '#818CF8' }}>
                {data.effectifs ?? 'N/A'}
                {iroContext.team_size_small && <span style={{ fontSize: 10 }}> ⚠ REV11</span>}
              </div>
              <div style={S.kpiSub}>{data.tranche_effectif ?? ''}</div>
            </div>
            <div style={S.kpi}>
              <div style={S.kpiLabel}>Statut</div>
              <div style={{
                ...S.kpiVal, fontSize: 11,
                color: data.statut === 'active' ? '#10B981' : '#F87171',
              }}>
                {data.statut}
              </div>
              <div style={S.kpiSub}>{data.forme_juridique}</div>
            </div>
          </div>

          {/* ── Fiche entreprise ── */}
          {!compact && (
            <div style={S.card}>
              <div style={S.cardTitle}><FileText size={14} /> Fiche Entreprise</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 11 }}>
                {[
                  ['SIREN',         data.siren],
                  ['Dénomination',  data.denomination],
                  ['Capital',       data.capital_social_eur ? `${data.capital_social_eur.toLocaleString()} €` : 'N/A'],
                  ['CA',            data.chiffre_affaires ? `${(data.chiffre_affaires / 1000).toFixed(0)}K €` : 'N/A'],
                  ['NAF',           data.activite_naf],
                  ['Localisation',  data.ville],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 4 }}>
                    <span style={{ color: '#64748B' }}>{k}</span>
                    <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Dirigeants ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>
              <Users size={14} /> 
              Dirigeants
              {iroContext.single_founder_proxy && (
                <span style={{ fontSize: 11, background: '#312E81', color: '#818CF8', padding: '2px 6px', borderRadius: 10, marginLeft: 8 }}>REV11 Candidate</span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {data.dirigeants.map((d, i) => (
                <div key={`dir-${d.nom}-${d.prenom}-${i}`} style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 6, padding: '4px 8px', fontSize: 11 }}>
                  <div style={{ fontWeight: 600, color: '#A5B4FC' }}>
                    {d.prenom ? `${d.prenom} ` : ''}{d.nom}
                  </div>
                  <div style={{ color: '#6366F1', fontSize: 10 }}>{d.qualite}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Contexte IRO ── */}
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 10, color: '#64748B', cursor: 'pointer', padding: '5px 0', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
              Détails du Signal IRO Injecté
            </summary>
            <pre style={{
              fontSize: 10, marginTop: 8, background: '#020617', padding: 12,
              borderRadius: 8, overflow: 'auto', maxHeight: 200, lineHeight: 1.6, color: '#94A3B8',
              border: '1px solid #1E293B'
            }}>
              {iroContext.full_context}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════════════════════════

const styles = {
  wrap:       { fontSize: 13 } as React.CSSProperties,
  header:     { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 } as React.CSSProperties,
  title:      { fontSize: 16, fontWeight: 700, color: '#F1F5F9' } as React.CSSProperties,
  subtitle:   { fontSize: 11, color: '#64748B', marginTop: 2 } as React.CSSProperties,
  btnPrimary: { padding: '8px 16px', background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 700, transition: 'all 0.2s' } as React.CSSProperties,
  btnLight:   { padding: '8px 12px', background: '#1E293B', color: '#94A3B8', border: '1px solid #334155', borderRadius: 8, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center' } as React.CSSProperties,
  sourceBadge:{ background: '#0F172A', border: '1px solid #1E293B', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: '#94A3B8' } as React.CSSProperties,
  alertWarn:  { background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '12px', marginBottom: 16, fontSize: 12, color: '#FCD34D', display: 'flex', alignItems: 'flex-start', gap: 10 } as React.CSSProperties,
  alertCritique: { background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '12px', marginBottom: 12, fontSize: 12, color: '#FCA5A5', display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties,
  placeholder:{ textAlign: 'center' as const, padding: '40px 20px', color: '#64748B', fontSize: 13, background: '#0F172A', borderRadius: 12, border: '2px dashed #1E293B' },
  kpi:        { background: '#0F172A', border: '1px solid #1E293B', borderRadius: 10, padding: '10px' } as React.CSSProperties,
  kpiLabel:   { fontSize: 11, color: '#64748B', textTransform: 'uppercase' as const, fontWeight: 700, letterSpacing: '.05em', marginBottom: 6 },
  kpiVal:     { fontSize: 14, fontWeight: 800, color: '#F1F5F9' } as React.CSSProperties,
  kpiSub:     { fontSize: 11, color: '#475569', marginTop: 3 } as React.CSSProperties,
  card:       { background: 'rgba(15,23,42,0.5)', border: '1px solid #1E293B', borderRadius: 12, padding: 14 } as React.CSSProperties,
  cardTitle:  { fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, textTransform: 'uppercase', letterSpacing: '0.05em' } as React.CSSProperties,
};

export default PappersPanel;
