/**
 * src/components/FounderProfilePanel.tsx
 * IRO Strength v6.6 — Antigravity Intelligence Platform
 *
 * CORRECTIF V2 : Version allégée (133L) remplacée par version complète (227L).
 * Apports :
 *   - Enrichissement individuel par fondateur (bouton par carte)
 *   - Score de confiance affiché par fondateur
 *   - Section "Contexte IRO injecté dans le prompt" (dépliable)
 *   - Détail expandable (publications, board, media, réponse Gemini brute)
 *   - Alertes REV11 / REV12 / key-person risk visuelles
 *   - LinkedIn URL cliquable
 *   - Chips colorés : ex-entreprises, formation, publications, brevets
 */

import React, { useState } from 'react';
import {
  computeGCHFromProfiles,
  type FounderProfile,
  type GCHAnalysis,
} from '../collectors/founder-enrichment';
import { useFounderEnrichment } from '../collectors/founder-enrichment-ui';
import { Users, Plus, Trash2, ExternalLink, RotateCw, ChevronDown, ChevronUp, Shield, Star } from 'lucide-react';

// ── Constantes ────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = ['CEO', 'CTO', 'CPO', 'CSO', 'COO', 'Chairman', 'Co-fondateur', 'Autre'];

const GCH_COLORS = ['#888780', '#854F0B', '#185FA5', '#3B6D11', '#534AB7'] as const;
const GCH_LABELS = ['Non documenté', 'Junior', 'Expérimenté', 'Senior ex-GAFAM', 'Publications + Exits'] as const;
const TRACK_LABELS: Record<string, string> = {
  exit: '🚀 Exit réalisé', scale: '📈 Scale >50M€', junior: '🌱 Junior', unknown: '—',
};
const CONF_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  high:   { bg: '#EAF3DE', color: '#27500A', label: 'Haute'   },
  medium: { bg: '#FAEEDA', color: '#854F0B', label: 'Moyenne' },
  low:    { bg: '#F1EFE8', color: '#888780', label: 'Faible'  },
};

// ── Sous-composant : Chip ─────────────────────────────────────────────────────

const Chip: React.FC<{ label: string; color: string; bg: string }> = ({ label, color, bg }) => (
  <span style={{ fontSize: 11, background: bg, color, padding: '2px 8px', borderRadius: 10, display: 'inline-block', margin: '2px 3px 2px 0' }}>
    {label}
  </span>
);

// ── Sous-composant : Barre GCH ────────────────────────────────────────────────

const GCHBar: React.FC<{ score: number; size?: 'sm' | 'md' }> = ({ score, size = 'md' }) => {
  const barW = size === 'sm' ? 14 : 18;
  const barH = size === 'sm' ? 4  : 6;
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2, 3].map(i => (
        <div key={`gch-bar-${i}`} style={{ width: barW, height: barH, borderRadius: 3,
          background: i < score ? GCH_COLORS[score as 0|1|2|3|4] : '#E4E3DB', transition: 'background .3s' }} />
      ))}
      {size === 'md' && (
        <span style={{ fontSize: 11, color: GCH_COLORS[score as 0|1|2|3|4], marginLeft: 4 }}>
          {score}/4 — {GCH_LABELS[score as 0|1|2|3|4]}
        </span>
      )}
    </div>
  );
};

// ── Sous-composant : Carte fondateur ──────────────────────────────────────────

const FounderCard: React.FC<{
  founder:     FounderProfile;
  enriching:   boolean;
  onEnrich:    () => void;
  onRemove:    () => void;
}> = ({ founder, enriching, onEnrich, onRemove }) => {
  const [expanded, setExpanded] = useState(false);
  const conf = CONF_STYLE[founder.confidence] ?? CONF_STYLE.low;

  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden bg-slate-900/50">
      {/* Header */}
      <div className="p-3 flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-200 text-sm">{founder.name}</span>
            <span className="text-[10px] bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-700/50">{founder.role}</span>
            <span style={{ fontSize: 10, background: conf.bg, color: conf.color, padding: '1px 7px', borderRadius: 10 }}>
              {founder.source} · {conf.label}
            </span>
            {founder.linkedin_verified && (
              <span className="text-[10px] bg-blue-900/40 text-blue-400 px-2 py-0.5 rounded-full">✓ LinkedIn</span>
            )}
          </div>

          {/* GCH Bar individuel */}
          <div className="mt-2">
            <GCHBar score={founder.gch_contribution} size="sm" />
            <span style={{ fontSize: 10, color: GCH_COLORS[founder.gch_contribution as 0|1|2|3|4], marginLeft: 2 }}>
              {' '}GCH individuel : {founder.gch_contribution}/4
            </span>
          </div>

          {/* LinkedIn link */}
          {founder.linkedin_url && (
            <a href={founder.linkedin_url.startsWith('http') ? founder.linkedin_url : `https://${founder.linkedin_url}`}
              target="_blank" rel="noopener noreferrer"
              className="mt-1 text-[11px] text-blue-400 flex items-center gap-1 hover:underline w-fit">
              <ExternalLink className="w-3 h-3" />
              Voir profil LinkedIn
            </a>
          )}

          {/* Chips */}
          <div className="mt-2 flex flex-wrap">
            {founder.previous_companies.map((c, i) => <Chip key={`co-${i}`} label={`🏢 ${c}`} color="#A39EFF" bg="#1E1B3A" />)}
            {founder.education.map((e, i) => <Chip key={`ed-${i}`} label={`🎓 ${e}`} color="#6EE7B7" bg="#0D2B20" />)}
            {founder.publications.slice(0, 2).map((p, i) => <Chip key={`pb-${i}`} label={`📄 ${p}`} color="#93C5FD" bg="#0C1A2E" />)}
            {founder.publications.length > 2 && <Chip key="pb-more" label={`+${founder.publications.length - 2} publications`} color="#93C5FD" bg="#0C1A2E" />}
            {founder.patents > 0 && <Chip key="pt-count" label={`⚡ ${founder.patents} brevet${founder.patents > 1 ? 's' : ''}`} color="#FCD34D" bg="#2A1E05" />}
            {founder.track_record !== 'unknown' && <Chip key="tr-label" label={TRACK_LABELS[founder.track_record] ?? founder.track_record} color="#D1D5DB" bg="#1F2937" />}
            {founder.open_source.slice(0, 1).map((o, i) => <Chip key={`os-${i}`} label={`⚙️ ${o}`} color="#6EE7B7" bg="#0D2B20" />)}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <button onClick={onEnrich} disabled={enriching}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-700/50 hover:bg-indigo-600/50 text-indigo-300 text-[11px] font-semibold rounded-lg border border-indigo-600/40 transition-colors disabled:opacity-50">
            {enriching ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : '✨'}
            {enriching ? 'Recherche…' : 'Enrichir'}
          </button>
          <button onClick={() => setExpanded(e => !e)}
            className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button onClick={onRemove}
            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Section expandable */}
      {expanded && (
        <div className="border-t border-slate-800 p-3 bg-slate-950/60 space-y-2 text-xs text-slate-400">
          {founder.board_roles.length > 0 && (
            <div><strong className="text-slate-300">Board :</strong> {founder.board_roles.join(', ')}</div>
          )}
          {founder.media_mentions.length > 0 && (
            <div><strong className="text-slate-300">Presse :</strong> {founder.media_mentions.join(' · ')}</div>
          )}
          {founder.enriched_at && (
            <div className="text-slate-600">
              Enrichi le {new Date(founder.enriched_at).toLocaleString('fr-FR')}
            </div>
          )}
          {founder.raw_gemini_response && (
            <details>
              <summary className="cursor-pointer text-slate-600 hover:text-slate-400">Réponse brute Gemini (audit)</summary>
              <pre className="mt-2 text-[10px] bg-slate-900 p-2 rounded overflow-auto max-h-40 text-slate-500">
                {founder.raw_gemini_response}
              </pre>
            </details>
          )}
          {!founder.board_roles.length && !founder.media_mentions.length && !founder.enriched_at && (
            <div className="text-slate-600 italic">Cliquez "✨ Enrichir" pour rechercher via Gemini Search.</div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Composant principal ───────────────────────────────────────────────────────

interface Props {
  startupName:      string;
  onUpdate?:        (score: number, context: string, founders: FounderProfile[]) => void;
  initialFounders?: FounderProfile[];
}

export const FounderProfilePanel: React.FC<Props> = ({ startupName, onUpdate, initialFounders = [] }) => {
  const { founders, loading, enrichingId, addFounder, removeFounder, enrichOne, enrichAll, gchAnalysis } =
    useFounderEnrichment(initialFounders, (analysis: GCHAnalysis) => {
      onUpdate?.(analysis.score, analysis.gch_fondateurs_context, founders);
    });

  const [showAdd,  setShowAdd]  = useState(false);
  const [newName,  setNewName]  = useState('');
  const [newRole,  setNewRole]  = useState('CEO');
  const [showContext, setShowContext]  = useState(false);

  const gch = gchAnalysis ?? computeGCHFromProfiles(founders);

  const handleAdd = () => {
    if (!newName.trim()) return;
    addFounder({
      name: newName, role: newRole, linkedin_url: '', linkedin_verified: false,
      previous_companies: [], education: [], publications: [], patents: 0,
      track_record: 'unknown', board_roles: [], open_source: [], media_mentions: [],
    });
    setNewName(''); setShowAdd(false);
  };

  const handleEnrichOne = async (id: string) => {
    await enrichOne(id, startupName);
  };

  const handleEnrichAll = async () => {
    await enrichAll(startupName);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-950 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-400" />
          <div>
            <h3 className="font-bold text-slate-200">Équipe Fondatrice</h3>
            <div className="text-[10px] text-slate-500">Enrichissement via Gemini Search · Gratuit</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(s => !s)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors" title="Ajouter un fondateur">
            <Plus className="w-5 h-5" />
          </button>
          <button onClick={handleEnrichAll} disabled={loading || founders.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {loading ? <RotateCw className="w-4 h-4 animate-spin" /> : '✨'}
            {loading ? 'Enrichissement…' : `Enrichir tous (${founders.length})`}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Score global GCH */}
        {founders.length > 0 && (
          <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 flex-wrap ${
            gch.score >= 3 ? 'bg-emerald-900/10 border-emerald-700/30' :
            gch.score >= 2 ? 'bg-blue-900/10 border-blue-700/30' : 'bg-amber-900/10 border-amber-700/30'
          }`}>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">Score GCH Calculé</div>
              <div className="text-3xl font-black text-slate-200">
                {gch.score}<span className="text-lg font-normal text-slate-500">/4</span>
              </div>
              <div className="mt-1"><GCHBar score={gch.score} size="sm" /></div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] text-slate-500">
                Confidence : {gch.confidence === 1.0 ? '1.0 (haute)' : gch.confidence === 0.8 ? '0.8 (moyenne)' : '0.5 (faible)'}
              </div>
              {gch.rev11_triggered && (
                <div className="flex items-center gap-1.5 text-amber-400 bg-amber-900/20 px-2.5 py-1 rounded-full text-[10px] font-bold border border-amber-700/40 uppercase">
                  <Shield className="w-3 h-3" /> REV11 : Fondateur unique
                </div>
              )}
              {gch.rev12_triggered && (
                <div className="flex items-center gap-1.5 text-amber-400 bg-amber-900/20 px-2.5 py-1 rounded-full text-[10px] font-bold border border-amber-700/40 uppercase">
                  <Shield className="w-3 h-3" /> REV12 : Équipe 100% tech
                </div>
              )}
              {gch.key_person_risk && !gch.rev11_triggered && (
                <div className="flex items-center gap-1.5 text-orange-400 bg-orange-900/20 px-2.5 py-1 rounded-full text-[10px] font-bold border border-orange-700/40 uppercase">
                  <Shield className="w-3 h-3" /> Key-Person Risk
                </div>
              )}
              {gch.score >= 3 && !gch.rev11_triggered && !gch.rev12_triggered && (
                <div className="flex items-center gap-1.5 text-emerald-400 text-[10px]">
                  <Star className="w-3 h-3" /> Équipe fondatrice solide
                </div>
              )}
            </div>
          </div>
        )}

        {/* RRF explanatory diagnostics */}
        {founders.length > 0 && gch.structured && (
          <div className="bg-slate-950/40 border border-slate-800 p-3 rounded-xl space-y-2">
            <div className="flex justify-between items-center text-[11px] font-sans font-semibold text-slate-400">
              <span>🌲 Random Rule Forest (RRF v7.0) — Stumps actifs</span>
              <span className="text-[10px] text-slate-600 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                arXiv:2505.24622
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="bg-slate-900/60 p-2 rounded border border-slate-800/80 text-[11px] text-slate-300">
                <div className="text-slate-500 font-semibold mb-1">Features clés extraites :</div>
                <ul className="space-y-1 font-mono text-[10px]">
                  <li>• Exits précédents : <span className="text-indigo-400 font-bold">{gch.structured.features.n_exits}</span></li>
                  <li>• Expérience cumulée : <span className="text-emerald-400 font-bold">{gch.structured.features.years_experience} ans</span></li>
                  <li>• École d'élite : <span className="text-blue-400 font-bold">{gch.structured.features.has_top_school ? 'Présente (Tier 3)' : 'Aucune'}</span></li>
                  <li>• Alignement sectoriel : <span className="text-amber-400 font-bold">{gch.structured.features.skill_relevance}/4</span></li>
                </ul>
              </div>
              <div className="bg-slate-900/60 p-2 rounded border border-slate-800/80 text-[11px] text-slate-300">
                <div className="text-slate-500 font-semibold mb-1">Détails des règles de contribution :</div>
                <div className="max-h-[68px] overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-slate-800/80 pr-1">
                  {gch.structured.rrf_rules_fired.map((rule: string, idx: number) => (
                    <div key={`rule-${idx}`} className="text-[10px] text-slate-400 leading-normal">
                      ✓ {rule}
                    </div>
                  ))}
                  {gch.structured.rrf_rules_fired.length === 0 && (
                    <div className="text-[10px] text-slate-600 italic">Aucune règle positive active.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Formulaire d'ajout */}
        {showAdd && (
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex gap-2 flex-wrap">
            <input placeholder="Nom complet *" value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              className="flex-1 min-w-[150px] px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 text-white placeholder-slate-600" />
            <select value={newRole} onChange={e => setNewRole(e.target.value)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white">
              {ROLE_OPTIONS.map(r => <option key={`role-opt-${r}`}>{r}</option>)}
            </select>
            <button onClick={handleAdd} disabled={!newName.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-bold transition-colors">
              Ajouter
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg text-sm transition-colors">
              Annuler
            </button>
          </div>
        )}

        {/* Liste vide */}
        {founders.length === 0 && !showAdd && (
          <div className="text-center py-8 text-slate-500 text-sm">
            <Users className="w-8 h-8 mx-auto mb-2 text-slate-700" />
            <div>Aucun fondateur renseigné</div>
            <div className="text-xs mt-1 text-slate-600">Cliquez + pour ajouter, puis "✨ Enrichir" via Gemini Search</div>
          </div>
        )}

        {/* Cartes fondateurs */}
        <div className="space-y-3">
          {founders.map(f => (
            <FounderCard key={f.id} founder={f}
              enriching={enrichingId === f.id}
              onEnrich={() => handleEnrichOne(f.id)}
              onRemove={() => removeFounder(f.id)} />
          ))}
        </div>

        {/* Contexte GCH injecté dans le prompt IRO */}
        {gchAnalysis && founders.length > 0 && (
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <button onClick={() => setShowContext(s => !s)}
              className="w-full p-3 flex justify-between items-center text-left hover:bg-slate-800/50 transition-colors">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="text-indigo-400">📋</span>
                <span>Contexte GCH injecté dans le prompt IRO</span>
              </div>
              {showContext ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>
            {showContext && (
              <pre className="px-4 pb-4 text-[10px] text-slate-400 whitespace-pre-wrap leading-relaxed bg-slate-950/50 border-t border-slate-800">
                {gchAnalysis.gch_fondateurs_context}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FounderProfilePanel;
