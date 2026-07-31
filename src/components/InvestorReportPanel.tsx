import React, { useState, useMemo } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from 'recharts';
import {
  FileText, Download, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, TrendingUp, Shield,
  Target, Zap, Clock, Calendar,
} from 'lucide-react';
import type { IROResult } from '../types/iro';
import { buildInvestorReport, generateInvestorMarkdown } from '../utils/investor-report-generator';
import type { InvestorReport, DimDetail, DimRecommendation, InvestorFlag } from '../types/iro';

// ── Props ─────────────────────────────────────────────────────────────────────

interface InvestorReportPanelProps {
  result: IROResult;
  startupName: string;
  onExportWord?: (report: InvestorReport) => void;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const DIM_LABELS: Record<string, string> = {
  DI:  'Dépendance Infrastructurelle',
  ADC: 'Actif de Données Cumulatif',
  IPC: 'Intégration Processus Critiques',
  AR:  'Anticipation Réglementaire',
  CA:  'Capacité d\'Adaptation',
  GCH: 'Gouvernance & Capital Humain',
};

const WEIGHTS: Record<string, number> = {
  DI: 0.18, ADC: 0.22, IPC: 0.22, AR: 0.13, CA: 0.13, GCH: 0.12,
};

const DIM_COLORS: Record<string, string> = {
  DI: '#6366f1', ADC: '#10b981', IPC: '#f59e0b',
  AR: '#8b5cf6', CA: '#3b82f6', GCH: '#ec4899',
};

const VERDICT_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  CRITIQUE: { bg: 'bg-red-950/40',    text: 'text-red-400',    border: 'border-red-500/40' },
  FRAGILE:  { bg: 'bg-amber-950/40',  text: 'text-amber-400',  border: 'border-amber-500/40' },
  ROBUSTE:  { bg: 'bg-blue-950/40',   text: 'text-blue-400',   border: 'border-blue-500/40' },
  SOLIDE:   { bg: 'bg-emerald-950/40',text: 'text-emerald-400',border: 'border-emerald-500/40' },
};

const HORIZON_COLORS: Record<string, string> = {
  court: 'text-red-400 border-red-500/30 bg-red-950/20',
  moyen: 'text-amber-400 border-amber-500/30 bg-amber-950/20',
  long:  'text-blue-400 border-blue-500/30 bg-blue-950/20',
};

// ── Sous-composants ───────────────────────────────────────────────────────────

const ScoreBar: React.FC<{ score: number; max?: number; color?: string }> = ({
  score, max = 4, color = '#6366f1',
}) => (
  <div className="flex items-center gap-1.5">
    {Array.from({ length: max }, (_, i) => (
      <div key={i} className={`h-2 w-6 rounded-sm transition-all ${i < score ? '' : 'opacity-20'}`}
        style={{ backgroundColor: i < score ? color : '#475569' }} />
    ))}
    <span className="text-xs font-mono font-bold ml-1" style={{ color }}>
      {score}/{max}
    </span>
  </div>
);

const ConfidenceBadge: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const color = value >= 0.80 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-950/20'
              : value >= 0.60 ? 'text-amber-400 border-amber-500/30 bg-amber-950/20'
              : 'text-slate-400 border-slate-500/30 bg-slate-950/20';
  return (
    <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${color}`}>
      {Math.round(value * 100)}% · {label}
    </span>
  );
};

// ── Composant principal ───────────────────────────────────────────────────────

export const InvestorReportPanel: React.FC<InvestorReportPanelProps> = ({
  result, startupName, onExportWord,
}) => {
  const [expandedDim, setExpandedDim] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'synthese' | 'dimensions' | 'flags' | 'reco'>('synthese');

  const report = useMemo(() => {
    return result.investorReport || buildInvestorReport(result);
  }, [result]);
  const vStyle = VERDICT_STYLES[report.iro_verdict] ?? VERDICT_STYLES.FRAGILE;

  // Données radar
  const radarData = Object.entries(WEIGHTS).map(([dim]) => ({
    dim,
    score: report.dimensions[dim]?.score ?? 0,
    fullMark: 4,
  }));

  // Export Markdown
  const handleExportMD = () => {
    const md = generateInvestorMarkdown(report, result);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IRO_${startupName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-12 animate-in fade-in zoom-in-95 duration-200">

      {/* ── En-tête ──────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-indigo-400" />
              <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">
                {report.protocol_version} · Prompt {report.prompt_registry}
              </span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">{startupName}</h1>
            <p className="text-xs text-slate-400 mt-1">
              {report.secteur} · {report.marche} · Généré le {new Date(report.generated_at).toLocaleDateString('fr-FR')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExportMD}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-bold text-slate-300 transition-all cursor-pointer">
              <Download className="w-3.5 h-3.5" />
              Export MD
            </button>
            {onExportWord && (
              <button onClick={() => onExportWord(report)}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold text-white transition-all cursor-pointer">
                <Download className="w-3.5 h-3.5" />
                Export Word
              </button>
            )}
          </div>
        </div>

        {/* Score global */}
        <div className={`mt-4 rounded-xl border p-4 ${vStyle.bg} ${vStyle.border}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className={`text-5xl font-black ${vStyle.text}`}>{report.iro_score}</div>
              <div className="text-xs text-slate-400 mt-0.5">/100</div>
            </div>
            <div className={`text-2xl font-black ${vStyle.text} tracking-wider`}>{report.iro_verdict}</div>
            <div className="text-right text-[10px] text-slate-500 space-y-1">
              <div>Floor DI=0 : {report.floor_di_activated ? '⚠️ ACTIVÉ' : '✅ NON'}</div>
              <div>Ancrage : {report.ancrage_warning ? '⚠️ OUI' : '✅ NON'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
        {([
          { id: 'synthese',   label: 'Synthèse', icon: Target },
          { id: 'dimensions', label: '6 Dimensions', icon: Shield },
          { id: 'flags',      label: 'Flags', icon: AlertTriangle },
          { id: 'reco',       label: 'Recommandations', icon: TrendingUp },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer
              ${activeTab === id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB SYNTHÈSE ─────────────────────────────────────────────────── */}
      {activeTab === 'synthese' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Radar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Radar 6 dimensions</h3>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 700 }} />
                  <PolarRadiusAxis domain={[0, 4]} tick={false} axisLine={false} />
                  <Radar name="Score" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
                  <Tooltip formatter={(v) => [`${v}/4`]} contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tableau pondéré */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Détail du calcul</h3>
            <div className="space-y-2">
              {Object.entries(WEIGHTS).map(([dim, w]) => {
                const d = report.dimensions[dim];
                const contrib = ((d?.score ?? 0) * w / 4 * 100);
                return (
                  <div key={dim} className="flex items-center gap-3">
                    <div className="w-10 text-[10px] font-black text-slate-300">{dim}</div>
                    <ScoreBar score={d?.score ?? 0} color={DIM_COLORS[dim]} />
                    <div className="ml-auto text-[10px] font-mono text-slate-400">
                      ×{(w * 100).toFixed(0)}%
                    </div>
                    <div className="w-12 text-right text-xs font-bold"
                      style={{ color: DIM_COLORS[dim] }}>
                      {contrib.toFixed(1)}pts
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800 flex justify-between items-center">
              <span className="text-xs text-slate-400">IRO Total</span>
              <span className={`text-xl font-black ${vStyle.text}`}>{report.iro_score}/100</span>
            </div>
          </div>

          {/* Verdict + forces/risques */}
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Verdict investisseur</h3>
              <p className="text-sm text-slate-200 leading-relaxed">{report.verdict_investisseur}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-2">Forces clés</h4>
                {report.forces.map((f, i) => (
                  <div key={i} className="flex gap-2 mb-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-300">{f}</p>
                  </div>
                ))}
              </div>
              <div>
                <h4 className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-2">Risques principaux</h4>
                {report.risques.map((k, i) => (
                  <div key={i} className="flex gap-2 mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-300">{k}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Survie */}
            {report.survival_36m != null && (
              <div className="pt-3 border-t border-slate-800">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Modèle de survie</h4>
                <div className="flex gap-4 flex-wrap">
                  {report.survival_18m != null && (
                    <div className="bg-slate-800/50 border border-slate-800 rounded-xl px-4 py-3 text-center">
                      <div className="text-2xl font-black text-blue-400">{report.survival_18m}%</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">S(18m) opérationnel</div>
                      <div className="text-[11px] text-slate-500">FSF = {report.fsf_score?.toFixed(1) ?? '—'}/4</div>
                    </div>
                  )}
                  <div className="bg-slate-800/50 border border-slate-800 rounded-xl px-4 py-3 text-center">
                    <div className={`text-2xl font-black ${
                      (report.survival_36m ?? 0) >= 50 ? 'text-emerald-400'
                        : (report.survival_36m ?? 0) >= 30 ? 'text-amber-400' : 'text-red-400'
                    }`}>{report.survival_36m}%</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">S(36m) structurel</div>
                    {report.survival_36m_lo != null && (
                      <div className="text-[11px] text-slate-600">[{report.survival_36m_lo}% ; {report.survival_36m_hi}%]</div>
                    )}
                  </div>
                  <div className="bg-slate-800/50 border border-slate-800 rounded-xl px-4 py-3 text-center">
                    <div className="text-sm font-black text-slate-300 uppercase">{report.risk_profile}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Profil de risque</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB DIMENSIONS ───────────────────────────────────────────────── */}
      {activeTab === 'dimensions' && (
        <div className="space-y-3 animate-in fade-in-50 duration-250">
          {Object.entries(WEIGHTS).map(([dim, w]) => {
            const d = report.dimensions[dim];
            if (!d) return null;
            const isOpen = expandedDim === dim;

            return (
              <div key={dim} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setExpandedDim(isOpen ? null : dim)}
                  className="w-full p-4 flex items-center gap-4 text-left hover:bg-slate-800/50 transition-all cursor-pointer"
                >
                  <div className="shrink-0 w-14 h-14 rounded-xl flex items-center justify-center font-black text-lg"
                    style={{ background: `${DIM_COLORS[dim]}20`, color: DIM_COLORS[dim] }}>
                    {d.score}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <span className="text-sm font-black text-white">{dim}</span>
                      <span className="text-xs text-slate-400 truncate">— {DIM_LABELS[dim]}</span>
                      <span className="text-[10px] text-slate-500">({(w * 100).toFixed(0)}%)</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <ScoreBar score={d.score} color={DIM_COLORS[dim]} />
                      <ConfidenceBadge label={d.confidence_label} value={d.confidence} />
                    </div>
                    <p className="text-[12px] text-slate-400 mt-1 italic truncate">{d.qualificatif}</p>
                  </div>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 space-y-3 border-t border-slate-800 animate-in slide-in-from-top-2 duration-200">
                    <div className="mt-3">
                      <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-1">Grille v4.4.1</p>
                      <p className="text-[12px] text-slate-400 italic">{d.grille_label}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-1">Analyse</p>
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{d.justification}</p>
                    </div>
                    {d.integration_level && (
                      <p className="text-[11px] text-indigo-400 font-mono">[IPC REV3] integration_level = {d.integration_level}</p>
                    )}
                    {d.pivot_type && (
                      <p className="text-[11px] text-indigo-400 font-mono">[CA REV2] pivot_type = {d.pivot_type}</p>
                    )}
                    {d.missing_data.length > 0 && (
                      <div className="bg-amber-950/20 border border-amber-500/20 rounded-lg p-3">
                        <p className="text-[11px] text-amber-400 font-bold uppercase tracking-wider mb-1">Données manquantes</p>
                        <div className="flex flex-wrap gap-1">
                          {d.missing_data.map((m, i) => (
                            <span key={i} className="text-[11px] bg-amber-950/40 border border-amber-500/20 text-amber-300 px-2 py-0.5 rounded">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── TAB FLAGS ────────────────────────────────────────────────────── */}
      {activeTab === 'flags' && (
        <div className="space-y-3 animate-in fade-in-50 duration-200">
          {report.investor_flags.filter(f => f.type === 'risk').length > 0 && (
            <>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Risques identifiés</h3>
              {report.investor_flags.filter(f => f.type === 'risk').map((flag, i) => (
                <div key={i} className={`bg-slate-900 border rounded-xl p-4 ${
                  flag.severity === 'critique' ? 'border-red-500/30' : 'border-amber-500/20'}`}>
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${
                      flag.severity === 'critique' ? 'text-red-400' : 'text-amber-400'}`} />
                    <div>
                      <p className={`text-sm font-bold ${flag.severity === 'critique' ? 'text-red-300' : 'text-amber-300'}`}>
                        {flag.titre}
                      </p>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{flag.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          {report.investor_flags.filter(f => f.type === 'signal').length > 0 && (
            <>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1 mt-4">Signaux positifs</h3>
              {report.investor_flags.filter(f => f.type === 'signal').map((flag, i) => (
                <div key={i} className="bg-slate-900 border border-emerald-500/20 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-emerald-300">{flag.titre}</p>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{flag.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          {report.investor_flags.length === 0 && (
            <div className="text-center py-10 bg-slate-900 border border-slate-850 rounded-2xl text-slate-500 text-xs italic">
              Aucun flag identifié pour cette entreprise.
            </div>
          )}
        </div>
      )}

      {/* ── TAB RECOMMANDATIONS ──────────────────────────────────────────── */}
      {activeTab === 'reco' && (
        <div className="space-y-3 animate-in fade-in-50 duration-200">
          {report.recommendations.map((rec, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm"
                  style={{ background: `${DIM_COLORS[rec.dim]}20`, color: DIM_COLORS[rec.dim] }}>
                  {rec.dim}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-white">{rec.titre}</span>
                    <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${HORIZON_COLORS[rec.horizon] || 'text-slate-400 border-slate-800 bg-slate-950'}`}>
                      {rec.horizon_label}
                    </span>
                  </div>
                  <p className="text-[12px] text-slate-500 mt-0.5">
                    → {rec.dim} → Cible : {rec.target_score}/4
                  </p>
                </div>
              </div>
              <div className="space-y-2 pl-0 sm:pl-12">
                {rec.actions.map((action, j) => (
                  <div key={j} className="flex gap-2">
                    <Zap className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-300 leading-relaxed">{action}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {report.recommendations.length === 0 && (
            <div className="text-center py-10 bg-slate-900 border border-slate-850 rounded-2xl text-slate-500 text-xs italic">
              Aucune recommandation requise (tous les scores sont optimaux).
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="text-[11px] text-slate-600 text-center pt-2 border-t border-slate-800">
        {report.protocol_version} · Prompt registry {report.prompt_registry} · Poids DI 18% · ADC 22% · IPC 22% · AR 13% · CA 13% · GCH 12% · Ce rapport ne constitue pas un conseil en investissement.
      </div>
    </div>
  );
};

export default InvestorReportPanel;
