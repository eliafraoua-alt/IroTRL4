/**
 * src/components/SectorBenchmark.tsx
 * IROSTRENGTH v7.2 — Bibliothèque d'exemples & Benchmark sectoriel
 *
 * Affiche :
 *   1. Bibliothèque d'exemples — toutes les startups de la cohorte FR
 *      filtrables par secteur, statut, zone IRO
 *   2. Benchmark sectoriel — comparaison de la startup analysée
 *      avec ses pairs du même secteur dans la cohorte
 *   3. Radar de positionnement — 6 dimensions vs médiane sectorielle
 *   4. Distribution IRO par secteur — heatmap textuelle
 *
 * Props :
 *   currentResult  : IROResult | null  — résultat de l'analyse en cours
 *   currentName    : string             — nom de la startup analysée
 */

import { useState, useMemo } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, Cell, ReferenceLine,
} from 'recharts';
import { COHORTE_FRANCE } from '../data/cohorte-france';
import { WORLD_BENCHMARKS } from '../utils/benchmark-service';
import type { IROResult } from '../types/iro';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  currentResult?: IROResult | null;
  currentName?:   string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SECTOR_GROUPS: Record<string, string[]> = {
  'Fintech / Paiement':   ['fintech','paiement','banque','néo','neobank','assurance santé','insurtech','crédit','épargne','spend','paie','compt'],
  'Healthtech / Medtech': ['cardiolog','médical','médecin','santé','clinique','pharma','biomédicale','radiologie','dermatologie','obstétrique','IA clinique','biologie'],
  'LegalTech':            ['legal','juridique','contrats','legaltech'],
  'SaaS B2B':             ['saas','b2b','crm','erp','rh','recrutement','formation','marketplace','supply chain','logistique','analytics','prédiction'],
  'IA Fondatrice / LLM':  ['llm','modèles','fondateur','open-source','chiffrement','transcription','nlg'],
  'Industrie / IoT':      ['industrie','industriel','vision industrie','iot','firmware','maintenance','neuromorphique'],
  'Cybersécurité':        ['cybersécurité','threat','sécurité','xdr'],
  'Autre':                [],
};

function getSectorGroup(sector: string): string {
  const s = sector.toLowerCase();
  for (const [group, keywords] of Object.entries(SECTOR_GROUPS)) {
    if (group === 'Autre') continue;
    if (keywords.some(k => s.includes(k))) return group;
  }
  return 'Autre';
}

function getInterpColor(interp: string): string {
  if (interp === 'Exceptionnel') return '#10b981';
  if (interp === 'Solide')       return '#34d399';
  if (interp === 'Robuste')      return '#60a5fa';
  if (interp === 'Fragile')      return '#f59e0b';
  if (interp === 'Vulnérable')   return '#f97316';
  return '#ef4444';
}

function getIROColor(iro: number): string {
  if (iro >= 75) return '#10b981';
  if (iro >= 61) return '#60a5fa';
  if (iro >= 50) return '#f59e0b';
  if (iro >= 40) return '#f97316';
  return '#ef4444';
}

function DimBar({ label, value, max = 4, color }: { label: string; value: number; max?: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-400 w-8 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-blue-950 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${(value / max) * 100}%`, background: color }}
        />
      </div>
      <span className="text-[10px] font-bold w-4" style={{ color }}>{value}</span>
    </div>
  );
}

// ── Composant principal ────────────────────────────────────────────────────────

export default function SectorBenchmark({ currentResult, currentName }: Props) {
  const [sectorFilter, setSectorFilter]   = useState<string>('all');
  const [statusFilter, setStatusFilter]   = useState<'all' | 'active' | 'failed'>('all');
  const [zoneFilter,   setZoneFilter]     = useState<string>('all');
  const [sortBy,       setSortBy]         = useState<'iro' | 'name' | 'sector'>('iro');
  const [search,       setSearch]         = useState('');
  const [expanded,     setExpanded]       = useState<string | null>(null);

  // ── Secteur courant depuis le résultat ──────────────────────────────────────
  const currentSectorRaw = currentResult?.vertical ?? currentResult?.startup_name ?? '';
  const currentGroup = currentName
    ? getSectorGroup(
        COHORTE_FRANCE.find(s => s.name.toLowerCase() === currentName.toLowerCase())?.sector ?? currentSectorRaw
      )
    : 'all';

  // ── Enrichissement de la cohorte avec les groupes ──────────────────────────
  const enriched = useMemo(() =>
    COHORTE_FRANCE.map(s => ({ ...s, group: getSectorGroup(s.sector) })),
  []);

  // ── Secteurs disponibles ────────────────────────────────────────────────────
  const availableGroups = useMemo(() => {
    const counts: Record<string, number> = {};
    enriched.forEach(s => { counts[s.group] = (counts[s.group] ?? 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [enriched]);

  // ── Filtrage ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = enriched;
    if (sectorFilter !== 'all') list = list.filter(s => s.group === sectorFilter);
    if (statusFilter !== 'all') list = list.filter(s => s.status === statusFilter);
    if (zoneFilter === 'leader')     list = list.filter(s => s.iro_total >= 75);
    if (zoneFilter === 'challenger') list = list.filter(s => s.iro_total >= 61 && s.iro_total < 75);
    if (zoneFilter === 'fragile')    list = list.filter(s => s.iro_total < 61);
    if (search.trim()) list = list.filter(s =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.sector.toLowerCase().includes(search.toLowerCase())
    );
    if (sortBy === 'iro')    return [...list].sort((a, b) => b.iro_total - a.iro_total);
    if (sortBy === 'name')   return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'sector') return [...list].sort((a, b) => a.sector.localeCompare(b.sector));
    return list;
  }, [enriched, sectorFilter, statusFilter, zoneFilter, sortBy, search]);

  // ── Stats secteur sélectionné ───────────────────────────────────────────────
  const sectorPeers = useMemo(() => {
    const peers = sectorFilter === 'all'
      ? enriched
      : enriched.filter(s => s.group === sectorFilter);
    const actives = peers.filter(s => s.status === 'active');
    const failed  = peers.filter(s => s.status === 'failed');
    const avg = (arr: typeof peers, key: keyof typeof peers[0]) =>
      arr.length ? arr.reduce((s, e) => s + (Number(e[key]) || 0), 0) / arr.length : 0;

    return {
      n: peers.length,
      n_active: actives.length,
      n_failed: failed.length,
      iro_avg_active: Math.round(avg(actives, 'iro_total') * 10) / 10,
      iro_avg_failed: Math.round(avg(failed, 'iro_total') * 10) / 10,
      di_avg:  Math.round(avg(actives, 'DI') * 10) / 10,
      adc_avg: Math.round(avg(actives, 'ADC') * 10) / 10,
      ipc_avg: Math.round(avg(actives, 'IPC') * 10) / 10,
      ar_avg:  Math.round(avg(actives, 'AR') * 10) / 10,
      ca_avg:  Math.round(avg(actives, 'CA') * 10) / 10,
      gch_avg: Math.round(avg(actives, 'GCH' as any) * 10) / 10,
    };
  }, [enriched, sectorFilter]);

  // ── Radar data : startup courante vs médiane sectorielle ───────────────────
  const radarData = useMemo(() => {
    if (!currentResult) return null;
    const scores = currentResult.iro?.scores;
    if (!scores) return null;
    return [
      { dim: 'DI',  current: scores.DI  ?? 0, secteur: sectorPeers.di_avg  },
      { dim: 'ADC', current: scores.ADC ?? 0, secteur: sectorPeers.adc_avg },
      { dim: 'IPC', current: scores.IPC ?? 0, secteur: sectorPeers.ipc_avg },
      { dim: 'AR',  current: scores.AR  ?? 0, secteur: sectorPeers.ar_avg  },
      { dim: 'CA',  current: scores.CA  ?? 0, secteur: sectorPeers.ca_avg  },
      { dim: 'GCH', current: scores.GCH ?? 0, secteur: sectorPeers.gch_avg },
    ];
  }, [currentResult, sectorPeers]);

  // ── Distribution IRO par secteur ───────────────────────────────────────────
  const distributionData = useMemo(() =>
    availableGroups.map(([group, n]) => {
      const peers = enriched.filter(s => s.group === group && s.status === 'active');
      return {
        name: group.split(' / ')[0].substring(0, 14),
        fullName: group,
        iro: peers.length ? Math.round(peers.reduce((s, e) => s + e.iro_total, 0) / peers.length * 10) / 10 : 0,
        n,
      };
    }).filter(d => d.iro > 0).sort((a, b) => b.iro - a.iro),
  [enriched, availableGroups]);

  const currentIRO = currentResult?.iro?.score_100 ?? null;

  return (
    <div className="space-y-6">

      {/* ── En-tête avec stats rapides ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Startups FR', value: COHORTE_FRANCE.length.toString(), sub: 'cohorte v7.2', color: '#60a5fa' },
          { label: 'Actives', value: COHORTE_FRANCE.filter(s=>s.status==='active').length.toString(), sub: 'documentées', color: '#10b981' },
          { label: 'Échecs documentés', value: COHORTE_FRANCE.filter(s=>s.status==='failed').length.toString(), sub: 'outcome réel', color: '#f87171' },
          { label: 'Secteurs', value: availableGroups.length.toString(), sub: 'groupes', color: '#a78bfa' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl p-4 border border-blue-100 shadow-sm text-center">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">{card.label}</div>
            <div className="text-2xl font-bold font-sans" style={{ color: card.color }}>{card.value}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Benchmark sectoriel — startup courante vs pairs ─────────────────── */}
      {currentResult && currentName && radarData && (
        <div className="bg-white rounded-xl border border-blue-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] text-blue-600 font-bold tracking-widest uppercase mb-1">
                Benchmark sectoriel
              </div>
              <div className="text-sm font-semibold text-slate-800">
                {currentName} vs pairs {currentGroup !== 'all' ? `· ${currentGroup}` : ''}
              </div>
            </div>
            {currentIRO !== null && (
              <div className="text-right">
                <div className="text-2xl font-bold font-sans" style={{ color: getIROColor(currentIRO) }}>
                  {currentIRO}/100
                </div>
                <div className="text-[10px] text-slate-400">
                  Médiane actives secteur : {sectorPeers.iro_avg_active}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Radar */}
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Profil 6 axes vs médiane sectorielle</div>
              <div className="w-full h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 4]} tick={false} axisLine={false} />
                    <Radar
                      name="Secteur (médiane)"
                      dataKey="secteur"
                      stroke="#cbd5e1"
                      fill="#e2e8f0"
                      fillOpacity={0.4}
                    />
                    <Radar
                      name={currentName}
                      dataKey="current"
                      stroke="#2563eb"
                      fill="#2563eb"
                      fillOpacity={0.25}
                    />
                    <Tooltip
                      formatter={(v: any, name: any) => [`${v}/4`, name]}
                      contentStyle={{ fontSize: 11, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8 }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tableau dimensions vs secteur */}
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-3">Dimensions vs médiane sectorielle actives</div>
              <div className="space-y-2.5">
                {(['DI','ADC','IPC','AR','CA','GCH'] as const).map((dim, i) => {
                  const cur = (currentResult.iro?.scores as any)?.[dim] ?? 0;
                  const med = [sectorPeers.di_avg, sectorPeers.adc_avg, sectorPeers.ipc_avg, sectorPeers.ar_avg, sectorPeers.ca_avg, sectorPeers.gch_avg][i];
                  const delta = Math.round((cur - med) * 10) / 10;
                  return (
                    <div key={dim} className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500 w-8">{dim}</span>
                      <div className="flex-1 h-2 bg-blue-50 rounded-full overflow-hidden relative">
                        {/* Médiane */}
                        <div
                          className="absolute h-full bg-slate-200 rounded-full"
                          style={{ width: `${(med / 4) * 100}%` }}
                        />
                        {/* Actuel */}
                        <div
                          className="absolute h-full rounded-full opacity-80"
                          style={{ width: `${(cur / 4) * 100}%`, background: cur >= med ? '#2563eb' : '#f59e0b' }}
                        />
                      </div>
                      <span className="text-[10px] font-bold w-6 text-slate-700">{cur}/4</span>
                      <span className="text-[10px] w-10 text-right font-mono" style={{ color: delta > 0 ? '#10b981' : delta < 0 ? '#f59e0b' : '#94a3b8' }}>
                        {delta > 0 ? '+' : ''}{delta}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-[10px] text-slate-400 flex gap-4">
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-blue-600 inline-block"/>&nbsp;{currentName}</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-slate-200 inline-block"/>&nbsp;Médiane secteur</span>
              </div>
            </div>
          </div>

          {/* Pairs du même secteur */}
          {currentGroup !== 'all' && (
            <div className="mt-5 border-t border-blue-50 pt-4">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-3">
                {sectorPeers.n} startups dans ce secteur · IRO moyen actives {sectorPeers.iro_avg_active} · échecs {sectorPeers.iro_avg_failed}
              </div>
              <div className="flex flex-wrap gap-2">
                {enriched
                  .filter(s => s.group === currentGroup)
                  .sort((a, b) => b.iro_total - a.iro_total)
                  .slice(0, 12)
                  .map(peer => (
                    <div
                      key={peer.id}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px]"
                      style={{
                        background: peer.status === 'failed' ? '#fef2f2' : '#f0f9ff',
                        borderColor: peer.status === 'failed' ? '#fecaca' : '#bfdbfe',
                        color: peer.status === 'failed' ? '#dc2626' : '#1e40af',
                      }}
                    >
                      <span className="font-semibold">{peer.name}</span>
                      <span className="font-bold" style={{ color: getIROColor(peer.iro_total) }}>{peer.iro_total}</span>
                      {peer.status === 'failed' && <span>✕</span>}
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Distribution IRO par secteur ───────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-blue-100 shadow-sm p-5">
        <div className="text-[10px] text-blue-600 font-bold tracking-widest uppercase mb-4">
          Distribution IRO par secteur — médiane actives
        </div>
        <div className="w-full h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distributionData} layout="vertical" margin={{ left: 0, right: 40 }}>
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9, fill: '#94a3b8' }} />
              <YAxis type="category" dataKey="name" width={105} tick={{ fontSize: 10, fill: '#64748b' }} />
              {currentIRO !== null && (
                <ReferenceLine x={currentIRO} stroke="#2563eb" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: currentName?.substring(0,8), fontSize: 9, fill: '#2563eb', position: 'top' }} />
              )}
              <ReferenceLine x={61.5} stroke="#94a3b8" strokeDasharray="2 2" strokeWidth={1} />
              <Tooltip
                formatter={(v: any, _: any, props: any) => [`IRO ${v} (n=${props.payload.n})`, props.payload.fullName]}
                contentStyle={{ fontSize: 11, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8 }}
              />
              <Bar dataKey="iro" radius={[0, 4, 4, 0]} maxBarSize={18}>
                {distributionData.map((entry) => (
                  <Cell key={entry.name} fill={getIROColor(entry.iro)} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-4 mt-2 text-[9px] text-slate-400">
          <span>Ligne pointillée bleue = {currentName ?? 'startup'}</span>
          <span>Ligne grise = médiane cohorte (61.5)</span>
        </div>
      </div>

      {/* ── Filtres bibliothèque ───────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-blue-100 shadow-sm p-4">
        <div className="text-[10px] text-blue-600 font-bold tracking-widest uppercase mb-4">
          Bibliothèque d'exemples — {filtered.length}/{COHORTE_FRANCE.length} startups
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {/* Recherche */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="border border-blue-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-blue-500 text-slate-700"
            style={{ minWidth: 140 }}
          />

          {/* Filtre secteur */}
          <select
            value={sectorFilter}
            onChange={e => setSectorFilter(e.target.value)}
            className="border border-blue-200 rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer bg-white text-slate-700"
          >
            <option value="all">Tous les secteurs</option>
            {availableGroups.map(([g, n]) => (
              <option key={g} value={g}>{g} ({n})</option>
            ))}
          </select>

          {/* Filtre statut */}
          {(['all','active','failed'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className="px-3 py-1.5 rounded-lg text-xs border transition-all"
              style={{
                background: statusFilter === s ? (s === 'failed' ? '#fef2f2' : s === 'active' ? '#f0fdf4' : '#eff6ff') : 'white',
                borderColor: statusFilter === s ? (s === 'failed' ? '#fca5a5' : s === 'active' ? '#86efac' : '#93c5fd') : '#e2e8f0',
                color: statusFilter === s ? (s === 'failed' ? '#dc2626' : s === 'active' ? '#16a34a' : '#2563eb') : '#64748b',
                fontWeight: statusFilter === s ? 600 : 400,
              }}
            >
              {s === 'all' ? 'Tous' : s === 'active' ? '✓ Actives' : '✕ Échecs'}
            </button>
          ))}

          {/* Filtre zone */}
          <select
            value={zoneFilter}
            onChange={e => setZoneFilter(e.target.value)}
            className="border border-blue-200 rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer bg-white text-slate-700"
          >
            <option value="all">Toutes zones IRO</option>
            <option value="leader">Leaders (≥75)</option>
            <option value="challenger">Challengers (61-75)</option>
            <option value="fragile">Fragiles (&lt;61)</option>
          </select>

          {/* Tri */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
            className="border border-blue-200 rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer bg-white text-slate-700"
          >
            <option value="iro">Tri : IRO ↓</option>
            <option value="name">Tri : Nom A-Z</option>
            <option value="sector">Tri : Secteur</option>
          </select>
        </div>

        {/* Grille de cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-1">
          {filtered.map(startup => {
            const isExpanded = expanded === startup.id;
            const isCurrent  = currentName?.toLowerCase() === startup.name.toLowerCase();
            return (
              <div
                key={startup.id}
                onClick={() => setExpanded(isExpanded ? null : startup.id)}
                className="rounded-xl border cursor-pointer transition-all font-sans"
                style={{
                  background: isCurrent ? '#eff6ff' : startup.status === 'failed' ? '#fef9f9' : 'white',
                  borderColor: isCurrent ? '#93c5fd' : startup.status === 'failed' ? '#fecaca' : '#e2e8f0',
                  boxShadow: isCurrent ? '0 0 0 2px #bfdbfe' : undefined,
                }}
              >
                <div className="p-3 font-sans">
                  <div className="flex items-start justify-between gap-2 mb-2 font-sans">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isCurrent && <span className="text-[9px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-bold font-sans">VOUS</span>}
                        {startup.status === 'failed' && <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold font-sans">ÉCHEC</span>}
                        <span className="text-xs font-semibold text-slate-800 truncate">{startup.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">{startup.sector}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold font-sans" style={{ color: getIROColor(startup.iro_total) }}>
                        {startup.iro_total}
                      </div>
                      <div className="text-[9px]" style={{ color: getInterpColor(startup.interpretation) }}>
                        {startup.interpretation}
                      </div>
                    </div>
                  </div>

                  {/* Barres mini */}
                  <div className="space-y-1">
                    {(['DI','ADC','IPC','AR','CA'] as const).map(dim => (
                      <div key={dim} className="flex items-center gap-1.5">
                        <span className="text-[9px] text-slate-400 w-6 font-mono">{dim}</span>
                        <div className="flex-1 h-1 bg-blue-50 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(startup[dim] / 4) * 100}%`, background: getIROColor(startup.iro_total), opacity: 0.7 }}
                          />
                        </div>
                        <span className="text-[9px] font-mono text-slate-500">{startup[dim]}</span>
                      </div>
                    ))}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-blue-50 space-y-1.5" onClick={e => e.stopPropagation()}>
                      <div className="grid grid-cols-3 gap-1 text-[9px] font-mono">
                        <div><span className="text-slate-400">Ville</span><br/><span className="font-medium text-slate-700">{startup.city}</span></div>
                        <div><span className="text-slate-400">Créée</span><br/><span className="font-medium text-slate-700">{startup.founded}</span></div>
                        <div><span className="text-slate-400">Pivot</span><br/><span className="font-medium text-slate-700">{startup.pivot_type}</span></div>
                      </div>
                      {startup.note_defaillance && (
                        <div className="text-[9px] text-red-600 bg-red-50 rounded p-1.5 italic font-mono">
                          ✕ {startup.note_defaillance}
                        </div>
                      )}
                      <DimBar label="GCH" value={startup.GCH ?? 2} color="#a78bfa" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-12 text-slate-400 text-sm">
              Aucune startup ne correspond aux filtres sélectionnés.
            </div>
          )}
        </div>

        {/* Légende */}
        <div className="mt-4 pt-3 border-t border-blue-50 flex flex-wrap gap-3 text-[9px] text-slate-400 font-mono">
          <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1"/>≥75 Leader</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1"/>61-75 Robuste</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1"/>50-61 Fragile</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1"/>&lt;50 Critique</span>
          <span className="ml-4">Cliquer sur une carte pour le détail</span>
        </div>
      </div>
    </div>
  );
}
