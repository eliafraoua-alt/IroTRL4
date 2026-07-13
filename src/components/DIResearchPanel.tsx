/**
 * DIResearchPanel.tsx — IRO v7.0
 * Panel de recherche web structurée pour la consolidation de l'axe DI
 *
 * Features :
 *   - Collecte GitHub (repos, stars, ML signals)
 *   - Gemini Grounding Search (stack LLM, brevets)
 *   - Score DI recommandé avec justification sourcée
 *   - Injection dans le Modèle de fonctionnement
 */

import React, { useState, useCallback } from 'react';
import {
  Search, Github, FileText, Cpu, CheckCircle2,
  AlertTriangle, XCircle, Loader2, ChevronDown, ChevronUp,
  ExternalLink, Zap, Database, Shield, RefreshCw, Copy, Check,
} from 'lucide-react';
import { runDIResearch, DIEvidenceReport } from '../services/di-research-service';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DIResearchPanelProps {
  startupName: string;
  currentDIScore?: number;
  onApplyEvidence?: (report: DIEvidenceReport) => void;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScoreBadge({ score, max = 4, label }: { score: number; max?: number; label: string }) {
  const pct = score / max;
  const color = pct >= 0.75 ? '#00c896' : pct >= 0.5 ? '#fbbf24' : pct >= 0.25 ? '#f97316' : '#ef4444';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-3xl font-black font-mono leading-none" style={{ color }}>
        {score}/{max}
      </div>
      <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">{label}</div>
    </div>
  );
}

function FlagBadge({ active, label, icon }: { active: boolean; label: string; icon: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
      active
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
        : 'bg-slate-800/50 border-slate-700/50 text-slate-600'
    }`}>
      {icon}
      {label}
      {active
        ? <CheckCircle2 size={10} className="text-emerald-400 ml-auto" />
        : <XCircle size={10} className="text-slate-700 ml-auto" />
      }
    </div>
  );
}

function SourceChip({ url }: { url: string }) {
  const label = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[9px] rounded font-bold hover:bg-indigo-500/20 transition-colors"
    >
      {label}
      <ExternalLink size={8} />
    </a>
  );
}

function StepLog({ steps }: { steps: string[] }) {
  return (
    <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-2 text-[10px] font-mono">
          <span className="text-slate-600 flex-shrink-0 w-4 text-right">{i + 1}.</span>
          <span className={
            s.startsWith('✅') ? 'text-emerald-400' :
            s.startsWith('⚠️') ? 'text-amber-400' :
            s.startsWith('🔍') || s.startsWith('📦') || s.startsWith('🤖') || s.startsWith('📋') || s.startsWith('⚙️') ? 'text-indigo-300' :
            'text-slate-400'
          }>{s}</span>
        </div>
      ))}
    </div>
  );
}

function QualityMeter({ quality }: { quality: number }) {
  const color = quality >= 70 ? '#00c896' : quality >= 40 ? '#fbbf24' : '#ef4444';
  const label = quality >= 70 ? 'Haute' : quality >= 40 ? 'Moyenne' : 'Faible';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${quality}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-bold font-mono" style={{ color }}>
        {quality}% — {label}
      </span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export const DIResearchPanel: React.FC<DIResearchPanelProps> = ({
  startupName,
  currentDIScore,
  onApplyEvidence,
}) => {
  const [githubOrg, setGithubOrg] = useState(
    startupName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  );
  const [report, setReport] = useState<DIEvidenceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    github: true, llm: true, patents: false, steps: false,
  });
  const [copied, setCopied] = useState(false);

  const toggle = (k: string) => setExpanded(p => ({ ...p, [k]: !p[k] }));

  const handleResearch = useCallback(async () => {
    if (!startupName.trim()) return;
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const result = await runDIResearch(
        startupName,
        githubOrg || null,
        undefined,
        setCurrentStep
      );
      setReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
      setCurrentStep('');
    }
  }, [startupName, githubOrg]);

  const handleCopyJustification = () => {
    if (!report) return;
    navigator.clipboard.writeText(report.di_justification_enrichie);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const diDelta = report && currentDIScore !== undefined
    ? report.di_score_recommande - currentDIScore
    : null;

  return (
    <div className="space-y-4 font-mono">

      {/* Header + Controls */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-900/80 border border-indigo-500/20 rounded-xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-md bg-indigo-500/20 flex items-center justify-center">
                <Cpu size={12} className="text-indigo-400" />
              </div>
              <span className="text-xs font-black text-indigo-400 tracking-widest uppercase">
                DI Research Engine v7.0
              </span>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Consolidation de l'axe Dépendance Infra par recherche web multi-sources
              (GitHub · Grounding Search · Brevets · Stack technique)
            </p>
          </div>
          {currentDIScore !== undefined && (
            <div className="text-center bg-slate-800/50 rounded-lg px-4 py-2 border border-slate-700/50">
              <div className="text-2xl font-black text-slate-300 font-mono">{currentDIScore}/4</div>
              <div className="text-[9px] text-slate-500 uppercase">DI Actuel</div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1 block">
              Organisation GitHub (optionnel)
            </label>
            <input
              value={githubOrg}
              onChange={e => setGithubOrg(e.target.value)}
              placeholder="ex: qonto, mistral-ai, alan..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-500 transition-colors text-slate-200 placeholder-slate-600"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleResearch}
              disabled={loading || !startupName.trim()}
              className="px-5 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg"
              style={{
                background: loading ? '#1e293b' : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                boxShadow: loading ? 'none' : '0 0 20px rgba(79,70,229,0.3)',
              }}
            >
              {loading ? (
                <><Loader2 size={12} className="animate-spin" /> Recherche...</>
              ) : report ? (
                <><RefreshCw size={12} /> Relancer</>
              ) : (
                <><Search size={12} /> Analyser DI</>
              )}
            </button>
          </div>
        </div>

        {/* Loading step */}
        {loading && currentStep && (
          <div className="mt-3 flex items-center gap-2 text-[10px] text-indigo-300 animate-pulse">
            <Loader2 size={10} className="animate-spin flex-shrink-0" />
            <span>{currentStep}</span>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-red-950/40 border border-red-500/30 rounded-lg text-[10px] text-red-400">
            <AlertTriangle size={10} />
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {report && (
        <div className="space-y-3">

          {/* Score Summary */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] text-slate-500 font-black tracking-widest uppercase">
                📊 Résultat DI Consolidé
              </div>
              <div className="text-[9px] text-slate-600 font-mono">
                {new Date(report.timestamp).toLocaleTimeString('fr-FR')}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <ScoreBadge score={report.di_score_recommande} label="Score DI recommandé" />
              <div className="flex flex-col items-center gap-1">
                <div className={`text-2xl font-black font-mono ${
                  diDelta === null ? 'text-slate-500' :
                  diDelta > 0 ? 'text-emerald-400' :
                  diDelta < 0 ? 'text-red-400' : 'text-slate-400'
                }`}>
                  {diDelta === null ? '—' : diDelta > 0 ? `+${diDelta}` : diDelta}
                </div>
                <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">
                  Δ vs score actuel
                </div>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className={`text-lg font-black uppercase px-3 py-1 rounded-lg text-center ${
                  report.di_confiance === 'haute' ? 'bg-emerald-500/15 text-emerald-400' :
                  report.di_confiance === 'moyenne' ? 'bg-amber-500/15 text-amber-400' :
                  'bg-red-500/15 text-red-400'
                }`}>
                  {report.di_confiance}
                </div>
                <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">
                  Confiance
                </div>
              </div>
            </div>

            {/* Justification */}
            <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800 mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">
                  Justification enrichie
                </span>
                <button
                  onClick={handleCopyJustification}
                  className="flex items-center gap-1 text-[9px] text-slate-500 hover:text-indigo-400 transition-colors"
                >
                  {copied ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}
                  {copied ? 'Copié !' : 'Copier'}
                </button>
              </div>
              <p className="text-[10px] text-slate-300 leading-relaxed max-h-40 overflow-y-auto">
                {report.di_justification_enrichie}
              </p>
            </div>

            {/* Research quality */}
            <div>
              <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-1.5">
                Qualité de la recherche
              </div>
              <QualityMeter quality={report.research_quality} />
            </div>

            {/* Apply button */}
            {onApplyEvidence && (
              <button
                onClick={() => onApplyEvidence(report)}
                className="mt-4 w-full py-2.5 rounded-lg text-xs font-black text-white transition-all flex items-center justify-center gap-2 cursor-pointer"
                style={{ background: 'linear-gradient(135deg, #059669, #0d9488)' }}
              >
                <Shield size={12} />
                Appliquer à l'analyse IRO — Injecter DI={report.di_score_recommande}
              </button>
            )}
          </div>

          {/* Flags Grid */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-[10px] text-slate-500 font-black tracking-widest uppercase mb-3">
              🚩 Signaux Détectés
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FlagBadge
                active={report.flags.wrapper_pur}
                label="Wrapper API pur"
                icon={<AlertTriangle size={10} />}
              />
              <FlagBadge
                active={report.flags.rag_custom}
                label="RAG custom"
                icon={<Database size={10} />}
              />
              <FlagBadge
                active={report.flags.fine_tuning_doc}
                label="Fine-tuning documenté"
                icon={<Zap size={10} />}
              />
              <FlagBadge
                active={report.flags.modele_propre}
                label="Modèle propre / OS"
                icon={<Cpu size={10} />}
              />
              <FlagBadge
                active={report.flags.brevets_ia}
                label="Brevets IA déposés"
                icon={<FileText size={10} />}
              />
              <FlagBadge
                active={report.flags.infra_gpu}
                label="Cluster GPU propriétaire"
                icon={<Shield size={10} />}
              />
            </div>
          </div>

          {/* GitHub Details */}
          {report.github && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <button
                onClick={() => toggle('github')}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <Github size={12} className="text-slate-400" />
                  GitHub Signals · {report.github.org}
                </div>
                {expanded.github ? <ChevronUp size={12} className="text-slate-600" /> : <ChevronDown size={12} className="text-slate-600" />}
              </button>
              {expanded.github && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Stars', value: report.github.stars.toLocaleString(), color: '#fbbf24' },
                      { label: 'Repos', value: report.github.repos, color: '#60a5fa' },
                      { label: 'Commits/30j', value: report.github.commits_30j, color: '#34d399' },
                      { label: 'Contributors', value: report.github.contributors, color: '#e879f9' },
                    ].map(m => (
                      <div key={m.label} className="bg-slate-950 rounded-lg p-2 text-center border border-slate-800">
                        <div className="text-base font-black font-mono" style={{ color: m.color }}>{m.value}</div>
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">{m.label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'ML repos', active: report.github.has_ml_repos },
                      { label: 'Fine-tuning', active: report.github.has_fine_tuning },
                      { label: 'Modèle propre', active: report.github.has_own_model },
                    ].map(f => (
                      <div key={f.label} className={`flex items-center justify-between px-2 py-1.5 rounded text-[9px] font-bold border ${
                        f.active ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-600'
                      }`}>
                        {f.label}
                        {f.active ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
                      </div>
                    ))}
                  </div>

                  {report.github.topics.length > 0 && (
                    <div>
                      <div className="text-[9px] text-slate-600 uppercase font-bold mb-1">Topics GitHub</div>
                      <div className="flex flex-wrap gap-1">
                        {report.github.topics.slice(0, 15).map(t => (
                          <span key={t} className="px-1.5 py-0.5 bg-slate-800 text-slate-400 text-[9px] rounded font-mono">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <a
                    href={report.github.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[9px] text-indigo-400 hover:text-indigo-300"
                  >
                    <ExternalLink size={9} />
                    {report.github.source_url}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* LLM Stack Details */}
          {report.llm_stack && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <button
                onClick={() => toggle('llm')}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <Cpu size={12} className="text-slate-400" />
                  Stack LLM · {report.llm_stack.integration_level}
                </div>
                {expanded.llm ? <ChevronUp size={12} className="text-slate-600" /> : <ChevronDown size={12} className="text-slate-600" />}
              </button>
              {expanded.llm && (
                <div className="px-4 pb-4 space-y-3">
                  {/* Integration level badge */}
                  <div className={`px-3 py-2 rounded-lg text-xs font-bold inline-block ${
                    report.llm_stack.integration_level === 'Self-hosted' ? 'bg-emerald-500/15 text-emerald-400' :
                    report.llm_stack.integration_level === 'Fine-tuned' ? 'bg-amber-500/15 text-amber-400' :
                    report.llm_stack.integration_level === 'Hybrid' ? 'bg-blue-500/15 text-blue-400' :
                    report.llm_stack.integration_level === 'API' ? 'bg-red-500/15 text-red-400' :
                    'bg-slate-700 text-slate-400'
                  }`}>
                    {report.llm_stack.integration_level}
                  </div>

                  {report.llm_stack.modeles_detectes.length > 0 && (
                    <div>
                      <div className="text-[9px] text-slate-600 uppercase font-bold mb-1">Modèles LLM détectés</div>
                      <div className="flex flex-wrap gap-1">
                        {report.llm_stack.modeles_detectes.map(m => (
                          <span key={m} className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[9px] rounded font-bold">{m}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {report.llm_stack.frameworks_ia.length > 0 && (
                    <div>
                      <div className="text-[9px] text-slate-600 uppercase font-bold mb-1">Frameworks IA</div>
                      <div className="flex flex-wrap gap-1">
                        {report.llm_stack.frameworks_ia.map(f => (
                          <span key={f} className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] rounded font-bold">{f}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {report.llm_stack.raw_evidence && (
                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                      <div className="text-[9px] text-slate-600 uppercase font-bold mb-1">Preuves collectées</div>
                      <p className="text-[10px] text-slate-400 leading-relaxed italic">
                        {report.llm_stack.raw_evidence}
                      </p>
                    </div>
                  )}

                  {report.llm_stack.sources?.length > 0 && (
                    <div>
                      <div className="text-[9px] text-slate-600 uppercase font-bold mb-1.5">Sources</div>
                      <div className="flex flex-wrap gap-1">
                        {report.llm_stack.sources.map(url => (
                          <SourceChip key={url} url={url} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Patents Details */}
          {report.patents && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <button
                onClick={() => toggle('patents')}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <FileText size={12} className="text-slate-400" />
                  Brevets · {report.patents.nb_brevets} total · {report.patents.brevets_ia} IA
                </div>
                {expanded.patents ? <ChevronUp size={12} className="text-slate-600" /> : <ChevronDown size={12} className="text-slate-600" />}
              </button>
              {expanded.patents && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Brevets total', value: report.patents.nb_brevets, color: '#818cf8' },
                      { label: 'Brevets IA', value: report.patents.brevets_ia, color: '#00c896' },
                      { label: 'Offices', value: report.patents.offices.join(', ') || '—', color: '#60a5fa' },
                    ].map(m => (
                      <div key={m.label} className="bg-slate-950 rounded-lg p-2 text-center border border-slate-800">
                        <div className="text-lg font-black font-mono" style={{ color: m.color }}>{m.value}</div>
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">{m.label}</div>
                      </div>
                    ))}
                  </div>

                  {report.patents.titres_representatifs.length > 0 && (
                    <div>
                      <div className="text-[9px] text-slate-600 uppercase font-bold mb-1">Titres représentatifs</div>
                      <div className="space-y-1">
                        {report.patents.titres_representatifs.slice(0, 5).map((t, i) => (
                          <div key={i} className="flex items-start gap-2 text-[10px] text-slate-400">
                            <span className="text-slate-600">•</span>
                            <span className="italic">{t}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Sources vérifiées */}
          {report.sources_verifiees.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-[10px] text-slate-500 font-black tracking-widest uppercase mb-2">
                🔗 Sources vérifiées ({report.sources_verifiees.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {report.sources_verifiees.map(url => (
                  <SourceChip key={url} url={url} />
                ))}
              </div>
            </div>
          )}

          {/* Step log */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <button
              onClick={() => toggle('steps')}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors cursor-pointer"
            >
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                📋 Log de recherche ({report.loading_steps.length} étapes)
              </div>
              {expanded.steps ? <ChevronUp size={12} className="text-slate-600" /> : <ChevronDown size={12} className="text-slate-600" />}
            </button>
            {expanded.steps && (
              <div className="px-4 pb-4">
                <StepLog steps={report.loading_steps} />
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};

export default DIResearchPanel;
