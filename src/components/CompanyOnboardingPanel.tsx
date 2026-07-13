import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useCompanyContext } from '../contexts/CompanyContext';
import {
  Search, Building2, Check, ArrowRight, Sparkles,
  Globe, ChevronRight, X, ChevronDown,
} from 'lucide-react';

// ── Données locales de fallback ───────────────────────────────────────────────

const LOCAL_BACKUP_STARTUPS = [
  { nom_entreprise: 'Mistral AI',      siren: '952147072', libelle_code_naf: 'LLM Frontier / IA générative',    stage: 'Series B'   },
  { nom_entreprise: 'Alan',            siren: '819832547', libelle_code_naf: 'Healthtech / Insurtech',           stage: 'Series F'   },
  { nom_entreprise: 'Qonto',           siren: '819489626', libelle_code_naf: 'Fintech / Néo-banque B2B',         stage: 'Late Stage' },
  { nom_entreprise: 'Payfit',          siren: '820690760', libelle_code_naf: 'SaaS RH / Paie',                   stage: 'Series D'   },
  { nom_entreprise: 'Pennylane',       siren: '884377343', libelle_code_naf: 'SaaS Comptabilité',               stage: 'Series B'   },
  { nom_entreprise: 'Spendesk',        siren: '829498592', libelle_code_naf: 'SaaS gestion dépenses',           stage: 'Series C'   },
  { nom_entreprise: 'Dataiku',         siren: '810960566', libelle_code_naf: 'MLOps / Data Science',            stage: 'Series F'   },
  { nom_entreprise: 'Mirakl',          siren: '750207819', libelle_code_naf: 'SaaS marketplace B2B',            stage: 'Series E'   },
  { nom_entreprise: 'Shift Technology',siren: '790464877', libelle_code_naf: 'IA anti-fraude assurance',        stage: 'Series D'   },
  { nom_entreprise: 'Yousign',         siren: '852070814', libelle_code_naf: 'LegalTech signature',             stage: 'Series B'   },
  { nom_entreprise: 'Swan',            siren: '882166770', libelle_code_naf: 'Fintech BaaS',                    stage: 'Series B'   },
  { nom_entreprise: 'Agicap',          siren: '832540078', libelle_code_naf: 'SaaS trésorerie PME',             stage: 'Series C'   },
  { nom_entreprise: 'Withings',        siren: '497980312', libelle_code_naf: 'Medtech / objets connectés',      stage: 'Profitable' },
];

const SECTORS = [
  'IA généraliste / LLM', 'Cybersécurité IA', 'IA santé / diagnostic',
  'MLOps / plateforme IA', 'Agent IA autonome', 'IA finance / trading',
  'IA RH / recrutement', 'IA légale / LegalTech', 'IA éducation / EdTech',
  'IA logistique / supply chain', 'IA marketing / ad-tech', 'IA industrielle / IoT',
  'SaaS B2B généraliste', 'Fintech', 'Healthtech / Medtech', 'Deeptech / R&D',
  'E-commerce / marketplace', 'Proptech', 'GreenTech / ClimateTech', 'Autre',
];

const STAGES = [
  'Idée / Pré-création', 'Amorçage / Pre-seed', 'Seed', 'Série A',
  'Série B', 'Série C', 'Growth / Late stage', 'Profitable / Bootstrapped',
  'Coté / IPO', 'Groupe établi',
];

const COUNTRIES = [
  'France', 'États-Unis', 'Royaume-Uni', 'Allemagne', 'Espagne',
  'Italie', 'Pays-Bas', 'Suède', 'Suisse', 'Belgique',
  'Canada', 'Israël', 'Inde', 'Singapour', 'Brésil', 'Autre',
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface PappersSuggestion {
  nom_entreprise: string;
  siren: string;
  libelle_code_naf?: string;
  code_naf?: string;
  stade?: string;
  siege?: { ville?: string };
}

type InputMode = 'france' | 'libre';

// ── Composant principal ───────────────────────────────────────────────────────

export const CompanyOnboardingPanel: React.FC = () => {
  const { setCompany, isLoaded } = useCompanyContext();

  // Mode
  const [mode, setMode]           = useState<InputMode>('france');

  // Champs mode France
  const [query, setQuery]         = useState('');
  const [suggestions, setSuggestions] = useState<PappersSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Champs mode libre (et compléments mode France)
  const [freeName, setFreeName]   = useState('');
  const [freeSector, setFreeSector] = useState('');
  const [freeStage, setFreeStage] = useState('Série A');
  const [freeCountry, setFreeCountry] = useState('France');
  const [freeSiren, setFreeSiren] = useState('');

  // Sélection Pappers confirmée
  const [selected, setSelected]   = useState<PappersSuggestion | null>(null);

  // Auto-switch to libre mode if country is not France
  useEffect(() => {
    if (freeCountry !== 'France' && mode === 'france') {
      setMode('libre');
      setSelected(null);
      setSuggestions([]);
    }
  }, [freeCountry, mode]);

  // ── Recherche Pappers (mode France uniquement) ──────────────────────────────

  useEffect(() => {
    if (mode !== 'france') return;
    if (query.trim().length < 2) { setSuggestions([]); return; }

    setIsSearching(true);
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pappers?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const text = await res.text();
          if (text.trim().startsWith('{')) {
            const data = JSON.parse(text);
            const results: PappersSuggestion[] = (data.resultats || []).map((item: any) => ({
              nom_entreprise: item.nom_entreprise || item.denomination || item.nom || 'Entreprise inconnue',
              siren: item.siren || '',
              libelle_code_naf: item.libelle_code_naf || item.domaine_activite || 'Autre secteur',
              code_naf: item.code_naf || '',
              stade: item.effectifs ? `Env. ${item.effectifs} sal.` : 'PME / ETI',
              siege: item.siege,
            }));
            setSuggestions(results.length > 0 ? results : fallback(query));
          } else {
            setSuggestions(fallback(query));
          }
        } else {
          setSuggestions(fallback(query));
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') setSuggestions(fallback(query));
      } finally {
        setIsSearching(false);
      }
    }, 380);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, mode]);

  const fallback = (q: string): PappersSuggestion[] => {
    const ql = q.toLowerCase();
    return LOCAL_BACKUP_STARTUPS.filter(s =>
      s.nom_entreprise.toLowerCase().includes(ql) || s.siren.includes(ql)
    );
  };

  // ── Sélection suggestion Pappers ────────────────────────────────────────────

  const handleSelect = useCallback((s: PappersSuggestion) => {
    setSelected(s);
    setFreeName(s.nom_entreprise);
    setFreeSiren(s.siren);
    setFreeSector(s.libelle_code_naf || 'Enterprise SaaS IA');
    setFreeStage(s.stade || 'Série A');
    setSuggestions([]);
    setQuery(s.nom_entreprise);
  }, []);

  // ── Soumission ───────────────────────────────────────────────────────────────

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();

    const name = freeName.trim() || query.trim();
    if (!name) return;

    setCompany({
      companyName: name,
      siren:  freeSiren.trim(),
      sector: freeSector.trim() || 'Enterprise SaaS IA',
      stage:  freeStage.trim()  || 'Série A',
      country: freeCountry.trim(),
    });
  }, [freeName, query, freeSiren, freeSector, freeStage, freeCountry, setCompany]);

  // ── Bascule de mode ──────────────────────────────────────────────────────────

  const switchMode = useCallback((m: InputMode) => {
    setMode(m);
    setSelected(null);
    setSuggestions([]);
    if (m === 'libre') {
      setFreeSiren('');
    }
  }, []);

  if (isLoaded) return null;

  const canSubmit = (freeName.trim() || query.trim()).length > 0;
  const isLibreMode = mode === 'libre';

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex items-center justify-center p-4 overflow-y-auto">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800/80 rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        {/* Glow effects */}
        <div className="absolute -top-12 -left-12 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="text-center space-y-2 mb-6 relative">
          <div className="inline-flex items-center gap-2 bg-indigo-950/80 border border-indigo-500/30 text-indigo-400 text-[10px] uppercase font-black tracking-widest px-3 py-1 rounded-full">
            <Sparkles className="w-3.5 h-3.5 animate-pulse text-amber-400" />
            <span>Onboarding Entreprise · IRO Strength Velocity</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-100 tracking-tight leading-none mt-3">
            Saisie de l'Entreprise
          </h1>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mt-2">
            Entreprise française (avec ou sans SIREN) ou internationale.
          </p>
        </div>

        {/* Toggle mode */}
        <div className="flex rounded-xl border border-slate-800 overflow-hidden mb-6">
          <button
            type="button"
            onClick={() => switchMode('france')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold transition-all cursor-pointer
              ${!isLibreMode
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200'}`}
          >
            <Building2 className="w-3.5 h-3.5" />
            France (Pappers)
          </button>
          <button
            type="button"
            onClick={() => switchMode('libre')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold transition-all cursor-pointer
              ${isLibreMode
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200'}`}
          >
            <Globe className="w-3.5 h-3.5" />
            International / Libre
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 relative">

          {/* ── MODE FRANCE ── */}
          {!isLibreMode && (
            <>
              <div>
                <label className="text-[10px] text-indigo-300 font-bold uppercase tracking-wider block mb-1.5">
                  Nom, SIREN ou SIRET
                </label>
                <div className="relative">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Ex. 952 147 072, Mistral AI, Control+…"
                    value={query}
                    onChange={e => { setQuery(e.target.value); setSelected(null); setFreeName(e.target.value); }}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3.5 pl-11 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all"
                  />
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-indigo-400 text-[9px] font-bold bg-slate-900 px-2 py-1 rounded border border-slate-800">
                      <span className="w-2 h-2 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                      Recherche…
                    </div>
                  )}
                </div>
              </div>

              {/* Résolution SIREN */}
              {/^\d{9,14}$/.test(query.replace(/\s/g,'')) && suggestions.length > 0 && (
                <div className="bg-emerald-950/40 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-xs flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span>Identité résolue : <strong className="text-white">{suggestions[0].nom_entreprise}</strong></span>
                </div>
              )}

              {/* Suggestions */}
              {suggestions.length > 0 && !selected && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl max-h-52 overflow-y-auto divide-y divide-slate-900 shadow-xl">
                  <div className="px-3.5 py-1.5 text-[9px] text-slate-500 font-bold uppercase tracking-wider bg-slate-900/40">
                    Suggestions ({suggestions.length})
                  </div>
                  {suggestions.map(s => (
                    <button
                      key={`${s.siren}-${s.nom_entreprise}`}
                      type="button"
                      onClick={() => handleSelect(s)}
                      className="w-full text-left px-4 py-3 hover:bg-slate-900/60 flex items-center justify-between group transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-950/60 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-900 transition-all">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-200">{s.nom_entreprise}</div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                            {s.siren && <span className="font-mono text-slate-400">SIREN {s.siren}</span>}
                            {s.siege?.ville && <><span>·</span><span>{s.siege.ville}</span></>}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 transition-all" />
                    </button>
                  ))}
                </div>
              )}

              {/* Sélection confirmée */}
              {selected && (
                <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-indigo-200">{selected.nom_entreprise}</div>
                      {selected.siren && <div className="text-[10px] text-slate-500 font-mono">SIREN {selected.siren}</div>}
                    </div>
                  </div>
                  <button type="button" onClick={() => { setSelected(null); setQuery(''); setFreeName(''); }}
                    className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Saisie libre sans résultat */}
              {query.trim().length >= 2 && suggestions.length === 0 && !isSearching && !selected && (
                <div className="text-[10px] text-slate-500 italic bg-slate-950/40 p-3 rounded-lg border border-slate-800/40 text-center">
                  Aucune entreprise trouvée — valider en saisie libre (sans SIREN).
                </div>
              )}
            </>
          )}

          {/* ── MODE LIBRE / INTERNATIONAL ── */}
          {isLibreMode && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-indigo-300 font-bold uppercase tracking-wider block mb-1.5">
                  Nom de l'entreprise *
                </label>
                <input
                  type="text"
                  autoFocus
                  placeholder="Ex. Control+, OpenAI, Wiz, Stripe…"
                  value={freeName}
                  onChange={e => setFreeName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
                    Pays
                  </label>
                  <div className="relative">
                    <select
                      value={freeCountry}
                      onChange={e => setFreeCountry(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none transition-all appearance-none cursor-pointer"
                    >
                      {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
                    SIREN / Identifiant <span className="text-slate-600 font-normal normal-case">(optionnel)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="SIREN, EIN, CRN…"
                    value={freeSiren}
                    onChange={e => setFreeSiren(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
                    Secteur
                  </label>
                  <div className="relative">
                    <select
                      value={freeSector}
                      onChange={e => setFreeSector(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none transition-all appearance-none cursor-pointer"
                    >
                      <option value="">— Choisir —</option>
                      {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
                    Stade de financement
                  </label>
                  <div className="relative">
                    <select
                      value={freeStage}
                      onChange={e => setFreeStage(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none transition-all appearance-none cursor-pointer"
                    >
                      {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Compléments mode France (secteur/stade) ── */}
          {!isLibreMode && (freeName.trim() || selected) && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
                  Secteur <span className="text-slate-600 font-normal normal-case">(affiner)</span>
                </label>
                <div className="relative">
                  <select
                    value={freeSector}
                    onChange={e => setFreeSector(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none transition-all appearance-none cursor-pointer"
                  >
                    <option value="">— Conserver Pappers —</option>
                    {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
                  Stade
                </label>
                <div className="relative">
                  <select
                    value={freeStage}
                    onChange={e => setFreeStage(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none transition-all appearance-none cursor-pointer"
                  >
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
                </div>
              </div>
            </div>
          )}

          {/* Bouton de validation */}
          <div className="pt-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full cursor-pointer bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/25 active:translate-y-[1px] transition-all"
            >
              <span>
                {isLibreMode
                  ? `Analyser${freeCountry !== 'France' ? ` (${freeCountry})` : ''} sans SIREN`
                  : 'Valider et Entrer dans l\'Audit'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>

            {/* Indicateur mode actif */}
            <p className="text-[9px] text-slate-600 text-center mt-2">
              {isLibreMode
                ? '⚡ Mode libre — sans enrichissement Pappers/INPI'
                : '🔍 Mode France — enrichissement Pappers/INPI actif'}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CompanyOnboardingPanel;
