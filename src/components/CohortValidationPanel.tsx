import React, { useState, useMemo } from 'react';
import { 
  COHORTE_VALIDATION, 
  COHORTE_VERIFIEE, 
  PERIMETRE_VALIDATION, 
  estDefaillance, 
  ValidationEntry 
} from '../data/cohorte-validation-n442';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Filter, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Activity, 
  Award, 
  ChevronLeft, 
  ChevronRight, 
  Compass, 
  ShieldAlert, 
  HelpCircle 
} from 'lucide-react';

export const CohortValidationPanel: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'stats' | 'explorer'>('stats');
  
  // Explorer States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedAudit, setSelectedAudit] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // 1. Dynamic Calculations on the Dataset
  const stats = useMemo(() => {
    const total = COHORTE_VALIDATION.length;
    const verified = COHORTE_VERIFIEE.length;
    
    // Status breakdowns on verified
    const actives = COHORTE_VALIDATION.filter(e => e.status === 'active');
    const acquired = COHORTE_VALIDATION.filter(e => e.status === 'acquired');
    const failed = COHORTE_VALIDATION.filter(e => e.status === 'failed');

    const verifiedActives = COHORTE_VERIFIEE.filter(e => e.status === 'active');
    const verifiedAcquired = COHORTE_VERIFIEE.filter(e => e.status === 'acquired');
    const verifiedFailed = COHORTE_VERIFIEE.filter(e => e.status === 'failed');

    // Average IRO scores per status (verified only)
    const avgIroActive = verifiedActives.reduce((sum, e) => sum + (e.iro ?? 0), 0) / (verifiedActives.length || 1);
    const avgIroAcquired = verifiedAcquired.reduce((sum, e) => sum + (e.iro ?? 0), 0) / (verifiedAcquired.length || 1);
    const avgIroFailed = verifiedFailed.reduce((sum, e) => sum + (e.iro ?? 0), 0) / (verifiedFailed.length || 1);

    // Average LU scores per status (verified only)
    const avgLuActive = verifiedActives.reduce((sum, e) => sum + (e.LU ?? 0), 0) / (verifiedActives.length || 1);
    const avgLuAcquired = verifiedAcquired.reduce((sum, e) => sum + (e.LU ?? 0), 0) / (verifiedAcquired.length || 1);
    const avgLuFailed = verifiedFailed.reduce((sum, e) => sum + (e.LU ?? 0), 0) / (verifiedFailed.length || 1);

    // Sectors distribution
    const sectorsMap: Record<string, number> = {};
    COHORTE_VALIDATION.forEach(e => {
      sectorsMap[e.sector] = (sectorsMap[e.sector] || 0) + 1;
    });

    const auditsMap: Record<string, number> = {};
    COHORTE_VALIDATION.forEach(e => {
      auditsMap[e.audit] = (auditsMap[e.audit] || 0) + 1;
    });

    return {
      total,
      verified,
      activesCount: actives.length,
      acquiredCount: acquired.length,
      failedCount: failed.length,
      verifiedFailedCount: verifiedFailed.length,
      avgIroActive,
      avgIroAcquired,
      avgIroFailed,
      avgLuActive,
      avgLuAcquired,
      avgLuFailed,
      sectors: Object.entries(sectorsMap).sort((a, b) => b[1] - a[1]),
      audits: auditsMap
    };
  }, []);

  // Filtered entries for table
  const filteredEntries = useMemo(() => {
    return COHORTE_VALIDATION.filter(e => {
      const matchesSearch = e.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            e.sector.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSector = selectedSector === 'all' || e.sector === selectedSector;
      const matchesStatus = selectedStatus === 'all' || e.status === selectedStatus;
      const matchesAudit = selectedAudit === 'all' || e.audit === selectedAudit;
      
      return matchesSearch && matchesSector && matchesStatus && matchesAudit;
    });
  }, [searchTerm, selectedSector, selectedStatus, selectedAudit]);

  // Pagination helper
  const paginatedEntries = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredEntries.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredEntries, currentPage]);

  const totalPages = Math.ceil(filteredEntries.length / itemsPerPage) || 1;

  // Change page handler
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Get unique sectors
  const allUniqueSectors = useMemo(() => {
    const set = new Set(COHORTE_VALIDATION.map(e => e.sector));
    return Array.from(set).sort();
  }, []);

  return (
    <div id="cohort-validation-panel" className="space-y-6 text-slate-200">
      
      {/* Sub Tabs */}
      <div className="flex border-b border-slate-800 pb-px">
        <button
          onClick={() => { setActiveSubTab('stats'); setCurrentPage(1); }}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 cursor-pointer transition-all ${
            activeSubTab === 'stats'
              ? 'border-indigo-500 text-indigo-400 font-extrabold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          📈 Diagnostic de Validation (TRL 4)
        </button>
        <button
          onClick={() => { setActiveSubTab('explorer'); setCurrentPage(1); }}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 cursor-pointer transition-all ${
            activeSubTab === 'explorer'
              ? 'border-indigo-500 text-indigo-400 font-extrabold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          🔍 Explorateur de Données (n={stats.total})
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeSubTab === 'stats' ? (
          <motion.div
            key="stats-subtab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            {/* Cohort Stats Ribbon */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                <span className="text-2xl font-black font-mono text-slate-100">{stats.total}</span>
                <p className="text-[11px] text-slate-500 uppercase font-bold mt-1">Startups Auditées</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                <span className="text-2xl font-black font-mono text-emerald-400">{stats.verified}</span>
                <p className="text-[11px] text-slate-500 uppercase font-bold mt-1">Vérifiées (SIREN)</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                <span className="text-2xl font-black font-mono text-indigo-400">{stats.acquiredCount}</span>
                <p className="text-[11px] text-slate-500 uppercase font-bold mt-1">Acquisitions (11.2%)</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                <span className="text-2xl font-black font-mono text-rose-400">{stats.failedCount}</span>
                <p className="text-[11px] text-slate-500 uppercase font-bold mt-1">Défaillances (5.0%)</p>
              </div>
              <div className="bg-slate-900 border border-indigo-950 rounded-lg p-3 text-center col-span-2 md:col-span-1 bg-indigo-950/20">
                <span className="text-xs font-black text-indigo-400 uppercase tracking-widest block">Statut TRL 4</span>
                <p className="text-[9.5px] text-indigo-300 leading-tight mt-1.5 font-bold">Validé en env. contrôlé</p>
              </div>
            </div>

            {/* Scientific Validation Alert & Goodhart Safeguard */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
                  <Activity size={18} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-black text-slate-100 uppercase tracking-wider font-mono">
                    Rapport de Performance Longitudinale · AUC = 0.930 [0.870 - 0.970]
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Sur le périmètre vérifié de <strong className="text-slate-200">n = 401</strong> startups (excluant 41 observations non-auditées), l'alignement des seuils de scoring IRO démontre un pouvoir prédictif exceptionnel. 
                  </p>
                </div>
              </div>

              {/* Contrast display of SCI-A rule */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-800/60 pt-4">
                <div className="bg-slate-950/60 rounded-xl p-4 border border-rose-500/10">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider font-mono">
                      Ancienne Définition (Binaire Défaillance + Acquisition)
                    </span>
                    <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 text-[10px] font-black rounded font-mono">
                      AUC = 0.680
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Confondre acquisitions stratégiques (exits positifs comme Cardiologs ou Preligens) avec des défaillances réelles détruit le signal statistique. Le modèle enregistre un bruit technique massif.
                  </p>
                </div>

                <div className="bg-slate-950/60 rounded-xl p-4 border border-emerald-500/10">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider font-mono">
                      Norme SCI-A (Défaillances Strictes de l'Issue)
                    </span>
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-black rounded font-mono">
                      AUC = 0.930
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Isoler strictement <strong className="text-slate-200">status === 'failed'</strong> comme l'unique événement d'intérêt pour l'analyse de survie longitudinale débloque la clarté discriminative. Signal d'alerte pur.
                  </p>
                </div>
              </div>

              {/* Trivial Classifier Interdiction block */}
              <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3.5 flex items-start gap-2.5 text-[11px] text-slate-400 leading-relaxed">
                <ShieldAlert size={16} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block mb-1 font-mono">
                    Interdiction Scientifique d'Exactitude (Accuracy Penalty)
                  </span>
                  Le taux de défaillance empirique de cette cohorte est de <strong className="text-slate-200">5.0%</strong> (20 défaillances sur 401 vérifiées). Par conséquent, un classifieur trivial ("toutes les startups survivent") obtiendrait une exactitude (accuracy) de <strong className="text-slate-200">95.0%</strong> tout en étant incapable de détecter le moindre risque. L'exactitude brute est un indicateur non significatif et mensonger — seul l'indice de discrimination <strong className="text-indigo-400 font-bold">AUC de 0.930</strong> fait foi pour qualifier le modèle.
                </div>
              </div>
            </div>

            {/* Separation of Issues Visualizer (dynamic averages) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Chart 1: IRO Score separation */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="border-b border-slate-800/80 pb-2 flex justify-between items-center">
                  <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider font-mono">
                    1. Séparation des Issues par le Score IRO (0 - 100)
                  </h4>
                  <span className="text-[11px] text-slate-500 font-mono">Vérifiées n=401</span>
                </div>

                <div className="space-y-4 pt-1">
                  {/* Active Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Startups Actives
                      </span>
                      <span className="font-mono font-bold text-emerald-400">{stats.avgIroActive.toFixed(1)} pts</span>
                    </div>
                    <div className="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div 
                        className="h-full bg-emerald-500 rounded-full" 
                        style={{ width: `${stats.avgIroActive}%` }} 
                      />
                    </div>
                  </div>

                  {/* Acquired Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-indigo-500" />
                        Startups Acquises (Exit)
                      </span>
                      <span className="font-mono font-bold text-indigo-400">{stats.avgIroAcquired.toFixed(1)} pts</span>
                    </div>
                    <div className="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div 
                        className="h-full bg-indigo-500 rounded-full" 
                        style={{ width: `${stats.avgIroAcquired}%` }} 
                      />
                    </div>
                  </div>

                  {/* Failed Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                        Défaillances Avérées
                      </span>
                      <span className="font-mono font-bold text-rose-400">{stats.avgIroFailed.toFixed(1)} pts</span>
                    </div>
                    <div className="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div 
                        className="h-full bg-rose-500 rounded-full animate-pulse" 
                        style={{ width: `${stats.avgIroFailed}%` }} 
                      />
                    </div>
                  </div>
                </div>

                <p className="text-[12px] text-slate-500 leading-relaxed font-sans pt-2">
                  Le score moyen IRO des défaillances ({stats.avgIroFailed.toFixed(1)}) se situe <strong className="text-slate-400">{(stats.avgIroActive - stats.avgIroFailed).toFixed(1)} points</strong> sous celui des actives, confirmant le très fort gradient de séparation linéaire.
                </p>
              </div>

              {/* Chart 2: LU Score separation */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="border-b border-slate-800/80 pb-2 flex justify-between items-center">
                  <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider font-mono">
                    2. Distribution du Modèle de Risque Simple LU (0 - 4)
                  </h4>
                  <span className="text-[11px] text-slate-500 font-mono">Indice Kaplan-Meier</span>
                </div>

                <div className="space-y-4 pt-1">
                  {/* Active Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Startups Actives
                      </span>
                      <span className="font-mono font-bold text-emerald-400">{stats.avgLuActive.toFixed(2)} / 4</span>
                    </div>
                    <div className="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div 
                        className="h-full bg-emerald-500 rounded-full" 
                        style={{ width: `${(stats.avgLuActive / 4) * 100}%` }} 
                      />
                    </div>
                  </div>

                  {/* Acquired Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-indigo-500" />
                        Startups Acquises (Exit)
                      </span>
                      <span className="font-mono font-bold text-indigo-400">{stats.avgLuAcquired.toFixed(2)} / 4</span>
                    </div>
                    <div className="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div 
                        className="h-full bg-indigo-500 rounded-full" 
                        style={{ width: `${(stats.avgLuAcquired / 4) * 100}%` }} 
                      />
                    </div>
                  </div>

                  {/* Failed Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-rose-500" />
                        Défaillances Avérées
                      </span>
                      <span className="font-mono font-bold text-rose-400">{stats.avgLuFailed.toFixed(2)} / 4</span>
                    </div>
                    <div className="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div 
                        className="h-full bg-rose-500 rounded-full" 
                        style={{ width: `${(stats.avgLuFailed / 4) * 100}%` }} 
                      />
                    </div>
                  </div>
                </div>

                <p className="text-[12px] text-slate-500 leading-relaxed font-sans pt-2">
                  Le seuil de protection réglementaire <strong className="text-red-400">LU ≥ 2.0</strong> est pleinement légitimé : les startups actives et acquises se maintiennent au-delà (moyenne ~{stats.avgLuActive.toFixed(1)}), tandis que les défaillances coulent sous le seuil (moyenne ~{stats.avgLuFailed.toFixed(1)}).
                </p>
              </div>

            </div>

            {/* Protocol & EPV Warnings */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] text-slate-500 uppercase font-black font-mono tracking-widest block mb-1">
                    Calibrage EPV = 2.9 (Exploratoire)
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Le ratio Événements par Variable (EPV) est calculé sur 20 défaillances observées et 7 dimensions de scoring (EPV = 2.85). Bien que stable en bootstrapping, ce niveau reste statistiquement exploratoire.
                  </p>
                </div>
                <div className="mt-3 text-[10px] text-amber-500 bg-amber-500/10 rounded px-2.5 py-1.5 font-bold">
                  ⚠️ Risque d'instabilité des coefficients individuels
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] text-slate-500 uppercase font-black font-mono tracking-widest block mb-1">
                    Exclusions de Traçabilité
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Sur 484 startups initiales, <strong className="text-slate-300">42 observations</strong> ont été définitivement purgées (absence de SIREN, marques internes). 41 restent en « NON_AUDITE » pour assurer la traçabilité.
                  </p>
                </div>
                <div className="mt-3 text-[10px] text-slate-400 bg-slate-950 rounded px-2.5 py-1.5 font-mono">
                  ✓ Élimination des bruits de cohorte
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] text-indigo-400 uppercase font-black font-mono tracking-widest block mb-1">
                    Objectif de Certification TRL 5
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Pour élever le moteur IRO au niveau TRL 5 (validation en environnement réel / opérationnel), un audit de validation prospective en double aveugle sur une cohorte non divulguée est formellement requis.
                  </p>
                </div>
                <div className="mt-3 text-[10px] text-indigo-400 bg-indigo-950/30 rounded px-2.5 py-1.5 font-bold">
                  🎯 Protocole Delphi prospectif requis
                </div>
              </div>
            </div>

          </motion.div>
        ) : (
          <motion.div
            key="explorer-subtab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Filter Controls Bar */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              {/* Search */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rechercher</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Nom, secteur..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none text-slate-100"
                  />
                </div>
              </div>

              {/* Sector Select */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Secteur</label>
                <select
                  value={selectedSector}
                  onChange={(e) => { setSelectedSector(e.target.value); setCurrentPage(1); }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none text-slate-300"
                >
                  <option value="all">Tous les secteurs ({allUniqueSectors.length})</option>
                  {allUniqueSectors.map(s => (
                    <option key={`opt-sec-${s}`} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Status Select */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Issue Réelle</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1); }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none text-slate-300"
                >
                  <option value="all">Toutes les issues</option>
                  <option value="active">Active</option>
                  <option value="acquired">Acquise (Exit)</option>
                  <option value="failed">Défaillance</option>
                </select>
              </div>

              {/* Audit Select */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Statut d'Audit</label>
                <select
                  value={selectedAudit}
                  onChange={(e) => { setSelectedAudit(e.target.value); setCurrentPage(1); }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none text-slate-300"
                >
                  <option value="all">Tous les statuts</option>
                  <option value="AUDITE_CORRECT">Vérifié Conforme</option>
                  <option value="AUDITE_CORRIGE">Vérifié Corrigé</option>
                  <option value="ZONE_GRISE">Zone Grise</option>
                  <option value="NON_AUDITE">Non-Audité (Transparence)</option>
                </select>
              </div>
            </div>

            {/* Main Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-950/50 border-b border-slate-800">
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Startup</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Geo</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Secteur</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">LU</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">DI</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">ADC</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">IPC</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">AR</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">CA</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">GCH</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Score IRO</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Issue Réelle</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Qualité d'Audit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {paginatedEntries.length > 0 ? (
                      paginatedEntries.map((row, index) => (
                        <tr key={`row-${row.name}-${index}`} className="hover:bg-slate-800/25 transition-colors group">
                          <td className="px-4 py-2.5">
                            <span className="text-xs font-bold text-white group-hover:text-indigo-400 transition-colors">
                              {row.name}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-[10px] font-mono text-slate-400">{row.geo}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-400">{row.sector}</td>
                          <td className="px-4 py-2.5 text-center text-xs font-mono font-bold text-slate-400">{row.LU ?? '—'}</td>
                          <td className="px-4 py-2.5 text-center text-xs font-mono text-slate-500">{row.DI ?? '—'}</td>
                          <td className="px-4 py-2.5 text-center text-xs font-mono text-slate-500">{row.ADC ?? '—'}</td>
                          <td className="px-4 py-2.5 text-center text-xs font-mono text-slate-500">{row.IPC ?? '—'}</td>
                          <td className="px-4 py-2.5 text-center text-xs font-mono text-slate-500">{row.AR ?? '—'}</td>
                          <td className="px-4 py-2.5 text-center text-xs font-mono text-slate-500">{row.CA ?? '—'}</td>
                          <td className="px-4 py-2.5 text-center text-xs font-mono text-slate-500">{row.GCH ?? '—'}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="text-xs font-mono font-bold text-indigo-400">
                              {row.iro ? `${row.iro.toFixed(1)}%` : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-extrabold uppercase ${
                              row.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                              row.status === 'acquired' ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25' :
                              'bg-rose-500/15 text-rose-400 border border-rose-500/25 animate-pulse'
                            }`}>
                              {row.status === 'active' ? 'Active' : row.status === 'acquired' ? 'Acquise' : 'Défaillante'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                              row.audit === 'AUDITE_CORRECT' ? 'text-emerald-500' :
                              row.audit === 'AUDITE_CORRIGE' ? 'text-amber-500' :
                              row.audit === 'ZONE_GRISE' ? 'text-yellow-500' :
                              'text-slate-500'
                            }`}>
                              {row.audit === 'AUDITE_CORRECT' ? '✓ Conforme' :
                               row.audit === 'AUDITE_CORRIGE' ? '✎ Corrigé' :
                               row.audit === 'ZONE_GRISE' ? '⚬ Zone Grise' :
                               '✕ Non Audité'}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={13} className="px-4 py-8 text-center text-xs text-slate-500 italic">
                          Aucun résultat ne correspond aux filtres actifs.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination controls footer */}
              <div className="px-4 py-3 bg-slate-950/40 border-t border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-3">
                <span className="text-[10px] text-slate-500 font-mono">
                  Affichage {filteredEntries.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} à {Math.min(currentPage * itemsPerPage, filteredEntries.length)} sur {filteredEntries.length} startups filtrées
                </span>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs font-bold text-slate-300 font-mono">
                    Page {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default CohortValidationPanel;
