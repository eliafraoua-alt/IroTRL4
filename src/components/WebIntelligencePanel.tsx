import React from 'react';
import { Shield, TrendingUp, Users, Landmark, AlertTriangle, CheckCircle, ExternalLink, Globe, BookOpen, Star, RefreshCw } from 'lucide-react';
import type { WebIntelligence } from '../collectors/web-intelligence';

interface WebIntelligencePanelProps {
  wi: WebIntelligence | null;
  startupName: string;
}

export const WebIntelligencePanel: React.FC<WebIntelligencePanelProps> = ({ wi, startupName }) => {
  if (!wi) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-500">
        <p className="text-sm italic">Aucune donnée Web Intelligence collectée ou disponible. Lancez un diagnostic pour collecter en temps-réel.</p>
      </div>
    );
  }

  const sentimentColors = {
    positif: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    neutre: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
    négatif: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    mixte: 'bg-amber-500/10 text-amber-400 border-amber-500/30'
  };

  const confidenceLevels = {
    high: { label: 'ÉLEVÉE', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    medium: { label: 'MOYENNE', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
    low: { label: 'FAIBLE', color: 'text-rose-400 border-rose-500/30 bg-rose-500/10' }
  };

  const confInfo = confidenceLevels[wi.confidence] || confidenceLevels.low;

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-slate-200">
              ⚡ Web Intelligence Signal Capture
            </h3>
            <span className={`px-2 py-0.5 rounded text-[10px] font-black border uppercase ${confInfo.color}`}>
              Confiance {confInfo.label}
            </span>
          </div>
          <p className="text-slate-500 text-xs mt-1">
            Enrichissement Gemini Grounding Search v7.3 · Actualisation à la volée
          </p>
        </div>
        <div className="text-right whitespace-nowrap text-xs text-slate-500">
          <span className="font-mono">Dernière capture : {new Date(wi.fetched_at).toLocaleTimeString()}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Card 1: Financement & Business */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 flex flex-col space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800/60 pb-3">
            <Landmark className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-black uppercase text-slate-400">Financement & Marge</span>
          </div>
          <div className="space-y-3 flex-1 text-xs">
            <div className="flex justify-between items-center bg-slate-950/40 p-2 rounded">
              <span className="text-slate-500">Stade</span>
              <span className="font-mono font-bold text-slate-300 capitalize">
                {wi.funding_stage || 'Non renseigné'}
              </span>
            </div>
            <div className="flex justify-between items-center bg-slate-950/40 p-2 rounded">
              <span className="text-slate-500">Total levé</span>
              <span className="font-mono font-bold text-slate-300">
                {wi.funding_total || 'Non mentionné'}
              </span>
            </div>
            {wi.valuation && (
              <div className="flex justify-between items-center bg-slate-950/40 p-2 rounded">
                <span className="text-slate-500">Valorisation</span>
                <span className="font-mono font-bold text-emerald-400">
                  {wi.valuation}
                </span>
              </div>
            )}
            {wi.arr_estimate && (
              <div className="flex justify-between items-center bg-slate-950/40 p-2 rounded">
                <span className="text-slate-500">ARR estimé (Presse)</span>
                <span className="font-mono font-bold text-indigo-400">
                  ~{wi.arr_estimate}
                </span>
              </div>
            )}
            {wi.investors && wi.investors.length > 0 && (
              <div className="pt-2">
                <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1.5">Investisseurs clés</span>
                <div className="flex flex-wrap gap-1.5">
                  {wi.investors.map((inv, idx) => (
                    <span key={idx} className="bg-slate-800 px-2 py-0.5 rounded text-[10px] text-slate-300 font-medium">
                      {inv}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Stack IA & Autonomie (DI) */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 flex flex-col space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800/60 pb-3">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-black uppercase text-slate-400">Stack Tech & Autonomie</span>
          </div>
          <div className="space-y-3 flex-1 text-xs">
            <div className="flex justify-between items-center bg-slate-950/40 p-2 rounded">
              <span className="text-slate-500">Signal DI</span>
              <span className="font-mono font-bold text-emerald-400 uppercase">
                {wi.di_signal || 'Non documenté'}
              </span>
            </div>
            <div className="bg-slate-950/40 p-2.5 rounded space-y-1">
              <span className="text-[10px] text-slate-500 uppercase font-bold">Modèles documentés</span>
              <p className="text-slate-300 overflow-hidden text-ellipsis line-clamp-2">
                {wi.llm_stack || 'Donnée non répertoriée'}
              </p>
            </div>
            {wi.github_activity && (
              <div className="bg-slate-950/40 p-2.5 rounded">
                <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">GitHub & Open Source</span>
                <p className="text-slate-300 font-mono text-[12px] truncate">{wi.github_activity}</p>
                {wi.open_source && (
                  <p className="text-[12px] text-slate-500 italic mt-1">{wi.open_source}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Card 3: Traction & Certifications (IPC / AR) */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 flex flex-col space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800/60 pb-3">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-black uppercase text-slate-400">Traction & Conformité</span>
          </div>
          <div className="space-y-3 flex-1 text-xs">
            {wi.named_clients && (
              <div className="bg-slate-950/40 p-2.5 rounded">
                <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Clients majeurs identifiés</span>
                <p className="text-slate-300 font-bold tracking-tight text-[11px] line-clamp-2">
                  {wi.named_clients}
                </p>
              </div>
            )}
            {wi.certifications && (
              <div className="bg-slate-950/40 p-2.5 rounded">
                <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Certifications / Agréments</span>
                <p className="text-emerald-400 font-bold text-[12px]">
                  {wi.certifications}
                </p>
              </div>
            )}
            {wi.regulatory_news && (
              <div className="bg-slate-950/40 p-2 rounded">
                <span className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">Veille Réglementaire</span>
                <p className="text-[12px] text-slate-400 leading-tight italic line-clamp-2">
                  {wi.regulatory_news}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Case studies, founders, press highlights footer grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Presse & Sentiment Highlights */}
        {wi.press_highlights && (
          <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-5 space-y-3 text-xs">
             <div className="flex justify-between items-center pb-2 border-b border-slate-800/60">
               <span className="font-bold uppercase tracking-tight text-slate-400 flex items-center gap-1.5">
                 <Globe className="w-3.5 h-3.5 text-blue-400" />
                 Signaux Presse & Rumeur
               </span>
               {wi.press_sentiment && (
                 <span className={`px-2 py-0.5 rounded text-[11px] font-black border uppercase ${sentimentColors[wi.press_sentiment]}`}>
                   Presse : {wi.press_sentiment}
                 </span>
               )}
             </div>
             <p className="text-slate-300 leading-relaxed italic pr-2">
               "{wi.press_highlights.replace(/ \| /g, '"\n" ')}"
             </p>
          </div>
        )}

        {/* Fondateurs & RH */}
        {(wi.founders || wi.team_size) && (
          <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-5 space-y-3 text-xs">
             <div className="pb-2 border-b border-slate-800/60">
               <span className="font-bold uppercase tracking-tight text-slate-400 flex items-center gap-1.5">
                 <Users className="w-3.5 h-3.5 text-fuchsia-400" />
                 Structure Capital Humain
               </span>
             </div>
             {wi.founders && (
               <div className="bg-slate-950/20 p-2 rounded">
                 <span className="text-[11px] text-slate-500 uppercase font-bold block mb-1">Fondateurs identifiés</span>
                 <p className="text-slate-300 leading-relaxed font-sans">{wi.founders}</p>
               </div>
             )}
             {wi.team_size && (
               <div className="flex justify-between items-center bg-slate-950/40 p-2 rounded">
                 <span className="text-slate-500">Taille de l'équipe (est.)</span>
                 <span className="font-mono font-bold text-slate-300">{wi.team_size} employés</span>
               </div>
             )}
          </div>
        )}
      </div>

      {/* Queried targets summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-[10px] text-slate-500 font-mono">
         <div className="flex items-center gap-2">
           <span>Index de recherche :</span>
           {wi.sources_queried.map((src, i) => (
             <span key={i} className="bg-slate-950 border border-slate-800/50 px-2 py-0.5 rounded uppercase font-bold text-[11px]">
               {src}
             </span>
           ))}
         </div>
         <div className="flex items-center gap-1.5">
           <BookOpen size={10} className="text-indigo-400" />
           <span>{wi.query_count} passes de recherche exécutées</span>
         </div>
      </div>
    </div>
  );
};

export default WebIntelligencePanel;
