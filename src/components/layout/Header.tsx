/**
 * src/components/layout/Header.tsx
 * IRO Strength Velocity v7.3 — CORRECTIF FORMULAIRE RECHERCHE UNIVERSELLE
 *
 * NOUVEAUTÉ : Barre de recherche directe SIRET / INPI / Bodacc
 *   - Visible en permanence sur TOUS os onglets
 *   - Positionnée en plein centre du Header (row 2 dédiée)
 *   - Recherche par SIREN/SIRET (9 ou 14 chiffres) → route directe /api/pappers/search
 *   - Recherche par nom commercial → /api/pappers/search (idem flux existant)
 *   - Affiche un résumé inline de la fiche officielle après résultat
 *   - Injecte les données dans startupModel via handlePappersUpdate (sans ouvrir le panneau)
 *   - Gère les états : idle → loading → success / error
 *   - Détecte automatiquement SIRET (numérique) vs nom textuel
 */

import React, { useState, useCallback, useRef } from 'react';
import { useIRO, VERSION, MILLESIME } from '../../contexts/IROAnalysisContext';
import { useCompanyContext } from '../../contexts/CompanyContext';
import { RotateCcw, Database, Users, Landmark, Cpu, Check, Search, X, AlertTriangle, Building2, ChevronRight } from 'lucide-react';
import { scoreColor } from '../../utils/iro-engine';
import { fetchPappersComplete, mapPappersToIROContext, type PappersEntreprise } from '../../collectors/pappers';

// ── Types internes ─────────────────────────────────────────────────────────────

type SearchState = 'idle' | 'loading' | 'success' | 'error' | 'not_found';

interface SearchResult {
  data: PappersEntreprise;
  injected: boolean;
}

// ── Détection SIRET/SIREN ──────────────────────────────────────────────────────

function isSirenLike(query: string): boolean {
  const cleaned = query.replace(/\s/g, '');
  return /^\d{9,14}$/.test(cleaned);
}

// ── Formatage SIRET/SIREN ──────────────────────────────────────────────────────

function formatSiret(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 9)  return `${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6)}`;
  if (d.length === 14) return `${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6,9)} ${d.slice(9)}`;
  return raw;
}

// ── Composant identité entreprise (inline après recherche réussie) ─────────────

const CompanyCard: React.FC<{
  data:     PappersEntreprise;
  onInject: () => void;
  injected: boolean;
  onClose:  () => void;
}> = ({ data, onInject, injected, onClose }) => {
  const statutColor = data.statut === 'active' ? '#1D9E75' : '#D85A30';
  const ageMois = data.age_mois;
  const ageLabel = ageMois == null ? 'N/A'
    : ageMois < 12  ? `${ageMois}m — Seed 🌱`
    : ageMois < 36  ? `${ageMois}m — Validation`
    : ageMois < 60  ? `${ageMois}m — Growth`
    : `${ageMois}m — Mature`;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'rgba(15,23,42,0.95)',
      border: '1px solid rgba(99,102,241,0.35)',
      borderRadius: 10, padding: '10px 14px',
      flexWrap: 'wrap', rowGap: 6,
    }}>
      {/* Logo / Initiales */}
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 900, fontSize: 12, color: '#fff', flexShrink: 0,
        letterSpacing: '0.04em',
      }}>
        {data.denomination?.slice(0,2).toUpperCase() || '??'}
      </div>

      {/* Infos principales */}
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0', lineHeight: 1.2 }}>
          {data.denomination}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>
            SIREN {formatSiret(data.siren)}
          </span>
          <span style={{ fontSize: 10, color: statutColor, fontWeight: 700 }}>
            ● {data.statut === 'active' ? 'Active' : data.statut}
          </span>
          {data.ville && (
            <span style={{ fontSize: 10, color: '#64748b' }}>{data.ville}</span>
          )}
        </div>
      </div>

      {/* Méta-données rapides */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {ageMois !== null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Âge</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{ageLabel}</div>
          </div>
        )}
        {data.effectifs !== null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Effectifs</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{data.effectifs}</div>
          </div>
        )}
        {data.capital_social_eur !== null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Capital</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
              {data.capital_social_eur.toLocaleString('fr-FR')} €
            </div>
          </div>
        )}
        {(data as any).chiffre_affaires != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CA</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
              {((data as any).chiffre_affaires as number).toLocaleString('fr-FR')} €
            </div>
          </div>
        )}
        {data.brevets_count > 0 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brevets</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1' }}>
              {data.brevets_count} ({data.brevets_ia} IA)
            </div>
          </div>
        )}
      </div>

      {/* Alertes */}
      {(data.alerte_cessation || data.alerte_redressement) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4,
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 6, padding: '3px 8px',
        }}>
          <AlertTriangle size={10} style={{ color: '#ef4444' }} />
          <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700 }}>
            {data.alerte_cessation ? 'Cessation' : 'Redressement'}
          </span>
        </div>
      )}

      {/* Bouton injection */}
      <button
        onClick={onInject}
        disabled={injected}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700,
          cursor: injected ? 'default' : 'pointer',
          background: injected ? 'rgba(29,158,117,0.15)' : 'rgba(99,102,241,0.2)',
          border: `1px solid ${injected ? 'rgba(29,158,117,0.4)' : 'rgba(99,102,241,0.5)'}`,
          color: injected ? '#1D9E75' : '#818cf8',
          transition: 'all 0.15s',
          flexShrink: 0,
        }}
      >
        {injected ? <Check size={11} /> : <ChevronRight size={11} />}
        {injected ? 'Injecté' : 'Injecter dans IRO'}
      </button>

      {/* Fermer */}
      <button
        onClick={onClose}
        style={{
          width: 24, height: 24, borderRadius: 6, border: '1px solid rgba(100,116,139,0.3)',
          background: 'transparent', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >
        <X size={11} style={{ color: '#64748b' }} />
      </button>
    </div>
  );
};

// ── Barre de recherche universelle ────────────────────────────────────────────

const UniversalSearchBar: React.FC = () => {
  const { handlePappersUpdate, setStartup, handleAnalyze } = useIRO();

  const [query,       setQuery]       = useState('');
  const [state,       setState]       = useState<SearchState>('idle');
  const [result,      setResult]      = useState<SearchResult | null>(null);
  const [errorMsg,    setErrorMsg]    = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;

    setState('loading');
    setResult(null);
    setErrorMsg('');

    try {
      const data = await fetchPappersComplete(q);
      if (!data) {
        setState('not_found');
        return;
      }
      setState('success');
      setResult({ data, injected: false });
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Erreur réseau');
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [query]);

  const handleInject = useCallback(() => {
    if (!result?.data) return;
    const ctx         = mapPappersToIROContext(result.data);
    const denomination = result.data.denomination || query;

    // ORDRE CRITIQUE (correctif race condition Greenerwave) :
    // 1. setStartup en premier → déclenche useEffect[startup] sur modèle vierge
    //    Le guard hasEnrichedData dans IROAnalysisContext laisse passer le reset initial.
    setStartup(denomination);

    // 2. Micro-task 0ms → React traite le setStartup et le useEffect AVANT l'injection.
    //    Puis handlePappersUpdate enrichit startupModel. Le guard external_pappers
    //    dans useEffect empêche tout écrasement ultérieur.
    setTimeout(() => {
      handlePappersUpdate(result.data!, ctx);

      // 3. 150ms → startupModel committed → lancer l'analyse IRO automatiquement.
      //    L'utilisateur n'a plus à cliquer "Démarrer l'audit" manuellement.
      setTimeout(() => { handleAnalyze(); }, 150);
    }, 0);

    setResult(r => r ? { ...r, injected: true } : r);
  }, [result, handlePappersUpdate, setStartup, handleAnalyze, query]);

  const handleClose = useCallback(() => {
    setState('idle');
    setResult(null);
    setQuery('');
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
    if (e.key === 'Escape') handleClose();
  };

  // Détection type de recherche
  const searchType = isSirenLike(query)
    ? (query.replace(/\s/g,'').length >= 14 ? 'SIRET' : 'SIREN')
    : query.length > 1 ? 'NOM' : '';

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Input row */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>

        {/* Champ de recherche */}
        <div style={{ position: 'relative', flex: 1, maxWidth: 520 }}>
          <Search
            size={14}
            style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)',
              color: state === 'loading' ? '#6366f1' : '#475569',
              transition: 'color 0.2s',
            }}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); if (state !== 'idle') setState('idle'); }}
            onKeyDown={handleKeyDown}
            placeholder="Nom d'entreprise, SIREN (9 chiffres) ou SIRET (14 chiffres)…"
            autoComplete="off"
            spellCheck={false}
            style={{
              width: '100%', paddingLeft: 36, paddingRight: searchType ? 64 : 36,
              paddingTop: 9, paddingBottom: 9,
              background: 'rgba(15,23,42,0.8)',
              border: `1px solid ${
                state === 'success'   ? 'rgba(29,158,117,0.5)'  :
                state === 'error'     ? 'rgba(239,68,68,0.5)'   :
                state === 'not_found' ? 'rgba(251,191,36,0.4)'  :
                state === 'loading'   ? 'rgba(99,102,241,0.5)'  :
                'rgba(51,65,85,0.6)'
              }`,
              borderRadius: 9,
              fontSize: 13, color: '#e2e8f0',
              outline: 'none',
              transition: 'border-color 0.2s',
              boxSizing: 'border-box',
            }}
          />
          {/* Badge type détecté */}
          {searchType && (
            <span style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 9, fontWeight: 800, color: '#6366f1',
              background: 'rgba(99,102,241,0.12)',
              border: '1px solid rgba(99,102,241,0.25)',
              borderRadius: 4, padding: '2px 6px',
              letterSpacing: '0.08em',
              pointerEvents: 'none',
            }}>
              {searchType}
            </span>
          )}
          {/* Spinner loading */}
          {state === 'loading' && (
            <div style={{
              position: 'absolute', right: searchType ? 68 : 10,
              top: '50%', transform: 'translateY(-50%)',
              width: 14, height: 14,
              border: '2px solid rgba(99,102,241,0.3)',
              borderTop: '2px solid #6366f1',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
          )}
        </div>

        {/* Bouton Rechercher */}
        <button
          type="submit"
          disabled={state === 'loading' || !query.trim()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '9px 16px', borderRadius: 9,
            fontSize: 12, fontWeight: 705,
            cursor: state === 'loading' || !query.trim() ? 'not-allowed' : 'pointer',
            background: state === 'loading' || !query.trim()
              ? 'rgba(51,65,85,0.4)'
              : 'rgba(99,102,241,0.2)',
            border: `1px solid ${
              state === 'loading' || !query.trim()
                ? 'rgba(51,65,85,0.4)'
                : 'rgba(99,102,241,0.5)'
            }`,
            color: state === 'loading' || !query.trim() ? '#475569' : '#818cf8',
            transition: 'all 0.15s',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <Search size={12} />
          {state === 'loading' ? 'Recherche…' : 'Rechercher'}
        </button>

        {/* Sources rapides */}
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {[
            { label: 'INPI', icon: '🏛', color: '#6366f1' },
            { label: 'Bodacc', icon: '📋', color: '#8b5cf6' },
            { label: 'INSEE', icon: '📊', color: '#0891b2' },
          ].map(src => (
            <span key={src.label} style={{
              fontSize: 10, fontWeight: 700, color: src.color,
              background: `${src.color}18`,
              border: `1px solid ${src.color}30`,
              borderRadius: 5, padding: '3px 8px',
              cursor: 'default', userSelect: 'none',
            }}>
              {src.icon} {src.label}
            </span>
          ))}
        </div>

        {/* Clear si résultat */}
        {state !== 'idle' && (
          <button
            type="button"
            onClick={handleClose}
            style={{
              width: 28, height: 28, borderRadius: 7,
              border: '1px solid rgba(100,116,139,0.3)',
              background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <X size={12} style={{ color: '#64748b' }} />
          </button>
        )}
      </form>

      {/* Résultats inline */}
      {state === 'success' && result && (
        <CompanyCard
          data={result.data}
          onInject={handleInject}
          injected={result.injected}
          onClose={handleClose}
        />
      )}

      {state === 'not_found' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 8,
          background: 'rgba(251,191,36,0.07)',
          border: '1px solid rgba(251,191,36,0.25)',
        }}>
          <AlertTriangle size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#92400e' }}>
            Aucune entreprise trouvée pour <strong>"{query}"</strong>.
            Vérifiez l'orthographe ou utilisez le SIREN exact.
          </span>
        </div>
      )}

      {state === 'error' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.07)',
          border: '1px solid rgba(239,68,68,0.25)',
        }}>
          <AlertTriangle size={12} style={{ color: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#991b1b' }}>
            Erreur : {errorMsg || 'Connexion au service Pappers/INPI échouée.'}
          </span>
        </div>
      )}

      {/* Style spinner */}
      <style>{`@keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }`}</style>
    </div>
  );
};

// ── Header principal ──────────────────────────────────────────────────────────

export const Header: React.FC = () => {
  const {
    startupModel,
    founderPanelOpen,
    setFounderPanelOpen,
    pappersPanelOpen,
    setPappersPanelOpen,
    diPanelOpen,
    setDiPanelOpen,
    pitchMode,
    setPitchMode,
    nlpMode,
    setNlpMode,
    agentMode,
    setAgentMode,
    modelPanelOpen,
    setModelPanelOpen,
    ahpPanelOpen,
    setAhpPanelOpen,
    vaultPanelOpen,
    setVaultPanelOpen,
    result: r,
    quad,
    history,
    diEvidence,
    handleAnalyze,
    loading,
  } = useIRO();

  const { companyName, resetCompany } = useCompanyContext();

  const currentEntry = r ? history.find(h => h.result === r) : null;
  const goldCalib = currentEntry?.gold ?? null;

  return (
    <header className="border-b border-slate-800 bg-slate-900/40" style={{ flexShrink: 0 }}>

      {/* ── Row 1 : Boutons de contrôle + identité IRO ── */}
      <div className="px-6 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/60">
        <div className="flex flex-wrap items-center gap-3">

          <button
            onClick={() => setModelPanelOpen(true)}
            title="Renseigner le modèle de fonctionnement de la startup"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer bg-slate-900 border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-100"
            style={{
              background: startupModel.secteur || startupModel.texte_libre
                ? 'rgba(99,102,241,0.1)' : 'rgba(15,23,42,0.6)',
              borderColor: startupModel.secteur || startupModel.texte_libre
                ? 'rgba(99,102,241,0.4)' : 'rgba(51,65,85,0.4)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            {(() => {
              const n = Object.entries(startupModel)
                .filter(([k]) => k !== 'texte_libre')
                .filter(([, v]) => v !== '' && v !== false).length;
              return n > 0 ? `Modèle (${n})` : 'Modèle';
            })()}
          </button>

          <button
            onClick={() => setAhpPanelOpen(true)}
            title="Expert Calibration AHP"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer bg-slate-900 border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-100"
          >
            <RotateCcw size={12} className="text-slate-400" />
            Calibration AHP
          </button>

          <button
            onClick={() => setVaultPanelOpen(true)}
            title="IRO Vault"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer bg-slate-900 border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-100"
          >
            <Database size={12} className="text-slate-400" />
            IRO Vault
          </button>

          <button
            onClick={() => { setPitchMode(p => !p); setNlpMode(false); setAgentMode(false); }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all ${
              pitchMode
                ? 'bg-amber-500/20 border-amber-500 text-amber-400 font-extrabold shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                : 'bg-slate-900 border-slate-700 hover:border-amber-500/50 hover:bg-slate-800 text-slate-100 hover:shadow-[0_0_10px_rgba(245,158,11,0.1)]'
            }`}
          >
            <span className="animate-pulse">✨</span> Immersive Pitch Analyzer
          </button>

          <button
            onClick={() => { setNlpMode(n => !n); setPitchMode(false); setAgentMode(false); }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all ${
              nlpMode
                ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400 font-extrabold'
                : 'bg-slate-900 border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-100'
            }`}
          >
            <span>🧬</span> Multimodalité NLP
          </button>

          <button
            onClick={() => { setAgentMode(a => !a); setPitchMode(false); setNlpMode(false); }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all ${
              agentMode
                ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400 font-extrabold'
                : 'bg-slate-900 border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-100'
            }`}
          >
            <span>◈</span> Agent Mode
          </button>

          <button
            onClick={() => setFounderPanelOpen(o => !o)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all ${
              founderPanelOpen
                ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400'
                : 'bg-slate-900 border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-100'
            }`}
          >
            <Users size={12} className="text-slate-400" />
            Fondateurs
            {startupModel.gch_founders && startupModel.gch_founders.length > 0 && (
              <span className="ml-1 bg-indigo-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                {startupModel.gch_founders.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setPappersPanelOpen(o => !o)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all ${
              pappersPanelOpen
                ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400'
                : 'bg-slate-900 border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-100'
            }`}
          >
            <Landmark size={12} className="text-slate-400" />
            Pappers / INPI
            {startupModel.external_pappers && (
              <Check size={10} className="text-emerald-400 ml-1 font-bold" />
            )}
          </button>

          <button
            onClick={() => setDiPanelOpen(o => !o)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all ${
              diPanelOpen
                ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400'
                : 'bg-slate-900 border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-100'
            }`}
          >
            <Cpu size={12} className="text-slate-400" />
            DI Research
            {diEvidence && (
              <span className="ml-1 bg-indigo-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-black">
                {diEvidence.di_score_recommande}/4
              </span>
            )}
          </button>

          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-orange-500 flex items-center justify-center text-white font-black text-sm">
            IRO
          </div>
          <div>
            <div className="font-black text-sm tracking-wider text-indigo-400">IRO EVALUATOR</div>
            <div className="text-[10px] text-slate-400 font-bold tracking-widest leading-none mt-0.5">
              v{VERSION} · {MILLESIME} · 6 AXES · SRD
            </div>
          </div>

          <div className="h-8 w-px bg-slate-800 hidden sm:block" />
          <div className="flex flex-col">
            <span className="text-[8px] text-indigo-400/80 font-black uppercase tracking-[0.1em] leading-none">Entreprise Active</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-black text-xs text-slate-100">{companyName || 'Non configurée'}</span>
              <button
                onClick={resetCompany}
                className="cursor-pointer text-[9px] text-amber-400 hover:text-amber-300 bg-amber-950/45 border border-amber-900/60 hover:border-amber-500/60 px-2 py-0.5 rounded font-extrabold transition-all"
              >
                Changer d'entreprise
              </button>
            </div>
          </div>
        </div>

        {r && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-slate-400 font-mono font-bold">{r.startup_name}</span>
            <span className="px-2.5 py-1 rounded text-xs font-black border uppercase tracking-wider bg-slate-950"
              style={{ color: scoreColor(r.iro?.score_100 ?? 50), borderColor: scoreColor(r.iro?.score_100 ?? 50) + '50' }}>
              IRO {r.iro?.score_100 ?? 'N/A'}
            </span>
            {quad && (
              <span className="px-2.5 py-1 rounded text-xs font-black border uppercase tracking-wider bg-slate-950"
                style={{ color: quad.color, borderColor: quad.color + '50' }}>
                {quad.emoji} {r.srd.quadrant}
              </span>
            )}
            {goldCalib && (
              <span className="px-2.5 py-1 rounded text-xs font-black border uppercase tracking-wider bg-slate-950"
                style={{
                  color: goldCalib.status === 'calibre' ? '#00c896' : goldCalib.status === 'derive_moderee' ? '#f59e0b' : '#ef4444',
                  borderColor: (goldCalib.status === 'calibre' ? '#00c896' : goldCalib.status === 'derive_moderee' ? '#f59e0b' : '#ef4444') + '50'
                }}>
                🎯 Gold Δ{goldCalib.delta}
              </span>
            )}
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-black bg-indigo-600 hover:bg-indigo-550 disabled:bg-slate-800 disabled:text-slate-500 text-white cursor-pointer transition-all border border-indigo-500/25 ml-1"
              title="Relancer tous les calculs IRO et SRD pour cette entreprise"
            >
              <RotateCcw size={11} className={`text-indigo-200 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Recalcul...' : 'Relancer l\'Analyse'}</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Row 2 : Barre de recherche universelle SIRET / INPI / Bodacc ── */}
      <div style={{
        padding: '10px 24px',
        background: 'rgba(8,10,20,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}>
        {/* Label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, paddingTop: 9 }}>
          <Building2 size={14} style={{ color: '#6366f1' }} />
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.1em', lineHeight: 1 }}>
              Recherche directe
            </div>
            <div style={{ fontSize: 8, color: '#475569', fontWeight: 600, marginTop: 2 }}>
              SIRET · INPI · Bodacc
            </div>
          </div>
        </div>

        {/* Séparateur vertical */}
        <div style={{ width: 1, height: 36, background: 'rgba(51,65,85,0.5)', flexShrink: 0, alignSelf: 'flex-start', marginTop: 4 }} />

        {/* Barre de recherche */}
        <UniversalSearchBar />
      </div>

    </header>
  );
};
