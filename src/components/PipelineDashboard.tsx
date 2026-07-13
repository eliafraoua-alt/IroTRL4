import React, { useState, useEffect } from 'react';
import { pipelineService, PipelineParams, CalibrationResult } from '../services/pipelineService';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCw, Activity, AlertTriangle, CheckCircle2, FlaskConical, Github } from 'lucide-react';

export const PipelineDashboard: React.FC = () => {
  const [params, setParams] = useState<PipelineParams>({
    startup: '',
    sector: '',
    vertical: 'SAAS',
    github: '',
    linkedin: '',
    crunchbase: '',
    status: 'active'
  });

  const [loading, setLoading] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [config, setConfig] = useState<CalibrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const data = await pipelineService.getConfig();
      setConfig(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await pipelineService.runAnalysis(params);
      setResult(data);
      if (data.success) {
        setParams({ ...params, startup: '' }); // Reset name
      }
    } catch (err: any) {
      setError(err.message || 'Échec du pipeline');
    } finally {
      setLoading(false);
    }
  };

  const handleCalibrate = async () => {
    setCalibrating(true);
    setError(null);
    try {
      await pipelineService.calibrate();
      await loadConfig();
    } catch (err: any) {
      setError(err.message || 'Échec calibration');
    } finally {
      setCalibrating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-indigo-400" />
            Real-World Data Pipeline
          </h2>
          <p className="text-slate-500 text-sm">Collecte multi-temporelle [GitHub, Pappers, Crunchbase] & Validation H5</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCalibrate}
            disabled={calibrating}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-lg border border-indigo-500/30 transition-colors disabled:opacity-50"
          >
            <FlaskConical className={`w-4 h-4 ${calibrating ? 'animate-spin' : ''}`} />
            Calibrer β_velocity
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulaire */}
        <div className="lg:col-span-1 bg-slate-950 p-6 rounded-xl border border-slate-800 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-slate-200">
            <Play className="w-4 h-4 text-indigo-400" />
            Lancer Analyse
          </h3>
          <form onSubmit={handleRun} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Nom Startup *</label>
              <input
                required
                value={params.startup}
                onChange={e => setParams({ ...params, startup: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-slate-200"
                placeholder="ex: Nabla, Mistral..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Secteur</label>
              <input
                value={params.sector}
                onChange={e => setParams({ ...params, sector: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-slate-200"
                placeholder="ex: IA Médicale"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Vertical</label>
                <select
                  value={params.vertical}
                  onChange={e => setParams({ ...params, vertical: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg outline-none text-slate-200"
                >
                  <option value="HLTH">Santé (HLTH)</option>
                  <option value="FINT">Finance (FINT)</option>
                  <option value="SAAS">SaaS (SAAS)</option>
                  <option value="LEGL">Legal (LEGL)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Status</label>
                <select
                  value={params.status}
                  onChange={e => setParams({ ...params, status: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg outline-none text-slate-200"
                >
                  <option value="active">Actif</option>
                  <option value="failed">Échec</option>
                  <option value="unknown">Inconnu</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1 flex items-center gap-1 text-slate-400">
                <Github className="w-3 h-3" /> GitHub Org
              </label>
              <input
                value={params.github}
                onChange={e => setParams({ ...params, github: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-slate-200"
                placeholder="nabla-company"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <RotateCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              Exécuter Snapshot
            </button>
          </form>
        </div>

        {/* Résultats & Calibration */}
        <div className="lg:col-span-2 space-y-6">
          {/* Status Calibration */}
          <div className={`p-6 rounded-xl border ${config?.h5_confirmed ? 'bg-emerald-900/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-950 border-slate-800 text-slate-300'}`}>
            <h3 className="text-lg font-semibold mb-4 flex items-center justify-between">
              Calibration H5
              {config?.h5_confirmed ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-amber-400" />
              )}
            </h3>
            {config ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-xs text-slate-500 uppercase">β_velocity</div>
                  <div className="text-xl font-bold text-indigo-400">{config.beta_velocity?.toFixed(4)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-500 uppercase">Harrell C</div>
                  <div className="text-xl font-bold text-purple-400">{config.harrell_c?.toFixed(3)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-500 uppercase">Startups n</div>
                  <div className="text-xl font-bold text-slate-200">{config.n_startups}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-500 uppercase">H5 Validée</div>
                  <div className={`text-lg font-bold ${config.h5_confirmed ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {config.h5_confirmed ? 'OUI' : 'NON'}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-slate-500 italic text-sm">Aucune calibration effectuée. Lancez au moins 10 analyses sur 2 snapshots pour calibrer.</p>
            )}
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-4 bg-rose-900/10 border border-rose-500/30 text-rose-400 rounded-lg flex items-center gap-3"
              >
                <AlertTriangle className="w-5 h-5" />
                {error}
              </motion.div>
            )}

            {result && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-950 rounded-xl border border-indigo-500/30 shadow-xl overflow-hidden"
              >
                <div className="bg-indigo-900/50 p-4 text-white flex justify-between items-center border-b border-indigo-500/20">
                  <h4 className="font-bold">Pipeline Output</h4>
                  <div className="text-xs opacity-80">Execution terminée</div>
                </div>
                <div className="p-4">
                  <p className="text-sm font-medium mb-2 text-emerald-400 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    {result.message}
                  </p>
                  <pre className="text-[10px] sm:text-xs font-mono bg-slate-900 text-slate-300 p-4 rounded-lg overflow-x-auto max-h-[300px]">
                    {result.stdout}
                    {result.stderr && <span className="text-rose-400">{result.stderr}</span>}
                  </pre>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="bg-slate-950 p-6 rounded-xl border border-slate-800">
            <h4 className="font-semibold mb-3 text-sm text-slate-500 uppercase">Guide Intégration API</h4>
            <div className="space-y-2 text-xs text-slate-400">
              <p><strong className="text-slate-300">1. Pappers :</strong> Inscription sur pappers.fr/api (Gratuit 5k/j). Clé : <code>PAPPERS_API_KEY</code></p>
              <p><strong className="text-slate-300">2. GitHub :</strong> Token classique sur github.com/settings/tokens. Clé : <code>GITHUB_TOKEN</code></p>
              <p><strong className="text-slate-300">3. Crunchbase :</strong> Optionnel, Gemini search prend le relais si <code>CRUNCHBASE_API_KEY</code> est absente.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PipelineDashboard;
