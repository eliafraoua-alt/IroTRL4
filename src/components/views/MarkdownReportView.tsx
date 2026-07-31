/**
 * MarkdownReportView.tsx — Antigravity Intelligence Platform
 * Permet de visualiser, d'éditer, de copier et d'exporter le rapport détaillé au format Markdown.
 */

import React, { useState, useEffect } from 'react';
import { useIRO } from '../../contexts/IROAnalysisContext';
import { generateMarkdownReport } from '../../utils/markdownReport';
import { Clipboard, Download, Edit3, Eye, Check, RefreshCw, FileText } from 'lucide-react';
import { motion } from 'motion/react';

export const MarkdownReportView: React.FC = () => {
  const { result, loading, loadingStep, handleAnalyze, startup, error } = useIRO();
  const [markdown, setMarkdown] = useState<string>('');
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (result) {
      setMarkdown(generateMarkdownReport(result));
    }
  }, [result]);

  if (!result) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        {loading ? (
          <div className="bg-slate-900/60 border border-slate-800/85 rounded-2xl p-8 backdrop-blur-md shadow-2xl text-center space-y-6 relative overflow-hidden animate-in fade-in duration-300">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-slate-800 border-t-indigo-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-mono font-bold text-indigo-400">v7.0</span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-indigo-950/50 border border-indigo-500/20 text-indigo-400 text-[11px] font-bold tracking-widest uppercase">
                  Calculateur Actif
                </div>
                <h3 className="text-sm font-black text-slate-200">
                  Génération de l'Audit IRO pour {startup}...
                </h3>
              </div>
            </div>
            
            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/40 text-[10px] text-slate-400 max-w-sm mx-auto flex items-center justify-center gap-3">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping shrink-0" />
              <div className="text-left font-mono">
                <div className="font-extrabold text-slate-200 uppercase text-[11px]">Étape : {loadingStep}</div>
                <div className="text-slate-500 text-[11px] mt-0.5">
                  {loadingStep === 'collecting' && 'Extraction API Pappers / INPI / GitHub...'}
                  {loadingStep === 'analyzing' && 'Concertation multi-LLM (3 passes REV20)...'}
                  {loadingStep === 'calculating' && 'Evaluation des trajectoires de survie Cox...'}
                  {loadingStep === 'saving' && 'Persistance des variables d\'audit...'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 backdrop-blur-md shadow-2xl relative overflow-hidden text-center space-y-6 animate-in fade-in zoom-in-95 duration-250">
            {error && (
              <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 rounded-xl p-5 text-left text-xs space-y-2 relative overflow-hidden animate-in fade-in duration-200">
                <div className="absolute top-0 left-0 bottom-0 w-1 bg-rose-500" />
                <div className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-rose-450 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="flex-1 space-y-1">
                    <div className="font-extrabold text-slate-100 uppercase tracking-widest text-[10px]">
                      Échec de l'Analyse IRO
                    </div>
                    <p className="leading-relaxed font-mono">
                      {error}
                    </p>
                    <p className="text-slate-500 text-[12px] mt-2 italic">
                     Veuillez vous assurer que votre clé GEMINI_API_KEY est bien renseignée dans l'onglet des Secrets du projet.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="max-w-lg mx-auto space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-[10px] font-black uppercase tracking-widest">
                📝 Pas d'analyse disponible
              </div>
              <h2 className="text-xl font-black text-slate-100 uppercase tracking-tight">
                Rapport Markdown non disponible
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Aucun audit n'a encore été généré pour la startup active <strong className="text-indigo-400 font-extrabold">{startup}</strong>. Lancez l'analyse IRO multi-critères dès maintenant pour débloquer le rapport Markdown complet d'aide à la décision :
              </p>
            </div>

            <button
              onClick={handleAnalyze}
              className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-550 hover:to-indigo-450 border border-indigo-500/30 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl cursor-pointer shadow-lg shadow-indigo-650/15 transition-all text-center flex items-center justify-center gap-2 mx-auto"
            >
              <span>Générer l'audit direct IRO</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  const handleDownload = () => {
    const cleanName = result.startup_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Rapport_IRO_${cleanName}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReset = () => {
    if (window.confirm('Voulez-vous réinitialiser les modifications apportées au rapport Markdown ?')) {
      setMarkdown(generateMarkdownReport(result));
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md shadow-2xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-[10px] font-black uppercase tracking-widest mb-3">
            <FileText size={12} />
            Exportation Structurée Universelle (.md)
          </div>
          <h2 className="text-xl font-black text-slate-100 uppercase tracking-tight">
            Rapport Dynamique Markdown — {result.startup_name}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Copiez ou téléchargez ce rapport complet rédigé dans le standard normatif d'audit v7.0.0. Idéal pour vos notes d'investissement, emails de cadrage ou intégration dans votre CRM/Notion.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-center shrink-0">
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            className={`px-3 py-2 text-xs font-black uppercase tracking-wide rounded-lg border cursor-pointer flex items-center gap-1.5 transition-all ${
              isEditMode 
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20' 
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {isEditMode ? (
              <>
                <Eye size={12} />
                <span>Mode Aperçu</span>
              </>
            ) : (
              <>
                <Edit3 size={12} />
                <span>Mode Édition</span>
              </>
            )}
          </button>

          {isEditMode && (
            <button
              onClick={handleReset}
              className="px-3 py-2 text-xs font-black uppercase tracking-wide rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 cursor-pointer flex items-center gap-1.5 transition-all"
              title="Réinitialiser"
            >
              <RefreshCw size={12} />
            </button>
          )}

          <button
            onClick={handleCopy}
            className={`px-3 py-2 text-xs font-black uppercase tracking-wide rounded-lg border cursor-pointer flex items-center gap-1.5 transition-all ${
              copied
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                : 'bg-slate-850 border-slate-755 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {copied ? (
              <>
                <Check size={12} />
                <span>Copié !</span>
              </>
            ) : (
              <>
                <Clipboard size={12} />
                <span>Copier</span>
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            className="px-4 py-2 text-xs font-black uppercase tracking-wider rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer flex items-center gap-1.5 shadow-lg shadow-indigo-600/15 transition-all"
          >
            <Download size={12} />
            <span>Télécharger (.md)</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {isEditMode ? (
          <div className="bg-slate-950 border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[650px]">
            <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold tracking-widest text-slate-500 uppercase">Éditeur de texte brut (.md)</span>
              <span className="text-[10px] text-slate-600 font-mono font-bold">{markdown.length} caractères</span>
            </div>
            <textarea
              className="flex-1 w-full bg-slate-950 p-6 text-slate-300 font-mono text-xs focus:outline-none focus:ring-0 resize-none leading-relaxed overflow-y-auto"
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder="Rédigez ou éditez votre rapport ici..."
            />
          </div>
        ) : (
          <div className="bg-slate-950 border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold tracking-widest text-slate-400 uppercase">Aperçu du Rapport Markdown d'Audit IRO</span>
              <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Dernière génération en direct
              </span>
            </div>
            
            <div className="p-8 space-y-6 leading-relaxed text-sm text-slate-300 overflow-y-auto max-h-[700px] markdown-preview font-sans">
              
              {/* Custom High-Quality CSS-free HTML simulation of beautifully formatted markdown rules */}
              {markdown.split('\n\n').map((block, idx) => {
                const trimmed = block.trim();
                
                // Headers #
                if (trimmed.startsWith('# ')) {
                  return (
                    <h1 key={idx} className="text-2xl font-black text-white tracking-tight leading-tight border-b border-slate-800 pb-3 mt-4">
                      {trimmed.slice(2)}
                    </h1>
                  );
                }
                
                // Headers ##
                if (trimmed.startsWith('## ')) {
                  return (
                    <h2 key={idx} className="text-lg font-extrabold text-indigo-400 uppercase tracking-widest border-b border-slate-800/40 pb-2 mt-6">
                      {trimmed.slice(3)}
                    </h2>
                  );
                }
                
                // Headers ###
                if (trimmed.startsWith('### ')) {
                  return (
                    <h3 key={idx} className="text-sm font-black text-slate-200 uppercase tracking-tight mt-4">
                      {trimmed.slice(4)}
                    </h3>
                  );
                }

                // Blockquotes >
                if (trimmed.startsWith('> ')) {
                  return (
                    <blockquote key={idx} className="pl-4 border-l-3 border-indigo-500 bg-slate-900/40 py-2.5 px-3 rounded-r-lg text-slate-300 italic text-xs leading-relaxed my-3">
                      {trimmed.slice(2)}
                    </blockquote>
                  );
                }

                // Asterisk Bullet points *
                if (trimmed.startsWith('* ')) {
                  return (
                    <ul key={idx} className="space-y-1 my-2 pl-4 list-disc list-outside text-xs text-slate-300">
                      {trimmed.split('\n').map((li, liIdx) => {
                        const content = li.replace(/^\*\s*/, '');
                        // Parse simple bold tags like **text**
                        return (
                          <li key={liIdx} className="leading-relaxed">
                            {content.includes('**') ? (
                              content.split('**').map((part, pIdx) => (
                                pIdx % 2 === 1 ? <strong key={pIdx} className="font-extrabold text-slate-100">{part}</strong> : part
                              ))
                            ) : content}
                          </li>
                        );
                      })}
                    </ul>
                  );
                }

                // Table parsing |
                if (trimmed.startsWith('|')) {
                  const rows = trimmed.split('\n').filter(r => r.trim() !== '');
                  if (rows.length < 2) return null;
                  
                  const headers = rows[0].split('|').slice(1, -1).map(h => h.trim());
                  const contentRows = rows.slice(2).map(r => r.split('|').slice(1, -1).map(c => c.trim()));
                  
                  return (
                    <div key={idx} className="my-4 overflow-x-auto border border-slate-800 rounded-xl bg-slate-950">
                      <table className="w-full text-left font-sans text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-900/80 border-b border-slate-850">
                            {headers.map((h, hIdx) => (
                              <th key={hIdx} className="px-4 py-3 font-extrabold text-slate-400 uppercase tracking-wider text-[10px]">
                                {h.replace(/\*\*/g, '')}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850">
                          {contentRows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-slate-900/20 transition-colors">
                              {row.map((cell, cIdx) => {
                                // Parse bold (**xxx**) and code (`xxx`)
                                let rendering: React.ReactNode = cell;
                                if (cell.startsWith('**') && cell.endsWith('**')) {
                                  rendering = <strong className="font-extrabold text-slate-100">{cell.replace(/\*\*/g, '')}</strong>;
                                } else if (cell.startsWith('`') && cell.endsWith('`')) {
                                  rendering = <code className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold">{cell.replace(/`/g, '')}</code>;
                                } else if (cell.includes('`')) {
                                  rendering = cell.split('`').map((part, pIdx) => pIdx % 2 === 1 ? <code key={pIdx} className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold">{part}</code> : part);
                                }
                                return (
                                  <td key={cIdx} className="px-4 py-2.5 text-slate-300">
                                    {rendering}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }

                // Standard Paragraph
                return (
                  <p key={idx} className="text-xs text-slate-300 leading-relaxed my-3">
                    {trimmed.split('**').map((part, pIdx) => {
                      if (pIdx % 2 === 1) {
                        return <strong key={pIdx} className="font-extrabold text-slate-100">{part}</strong>;
                      }
                      return part.split('`').map((sub, sIdx) => {
                        if (sIdx % 2 === 1) {
                          return <code key={sIdx} className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold">{sub}</code>;
                        }
                        return sub;
                      });
                    })}
                  </p>
                );
              })}

            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkdownReportView;
