/**
 * src/components/PitchAnalyzer.tsx
 * Composant de saisie immersive du pitch fondateur.
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Shield, Rocket, Info, ChevronRight, Zap, Sparkles } from 'lucide-react';
import PdfUploader from './PdfUploader';

interface PitchAnalyzerProps {
  onAnalyze: (name: string, pitch: string, financialSignals?: any) => Promise<void>;
  loading: boolean;
  loadingStep: string;
}

const PitchAnalyzer: React.FC<PitchAnalyzerProps> = ({ onAnalyze, loading, loadingStep }) => {
  const [name, setName] = useState('');
  const [pitch, setPitch] = useState('');
  const [financialSignals, setFinancialSignals] = useState<any>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !pitch.trim() || loading) return;
    onAnalyze(name, pitch, financialSignals);
  };

  const handlePdfExtracted = (text: string, detectedName?: string, signals?: any) => {
    if (text) {
      setPitch(text);
    }
    if (detectedName) {
      setName(detectedName);
    }
    if (signals) {
      setFinancialSignals(signals);
    }
  };

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-6 md:p-8 shadow-2xl shadow-indigo-500/10 relative"
      >
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <Rocket size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white uppercase italic">Immersive Pitch Analyzer</h2>
            <div className="text-xs text-indigo-400 font-bold uppercase tracking-widest mt-1">IRO v6.6 — Accélération AI-First</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2 px-1">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Upload de document (optionnel)</label>
              <button
                type="button"
                onClick={() => {
                  const ocrSample = `=== DIAPOSITIVE 1 : CONTROL+ ===
Tudigo - Tous droits réservés・Pitch Deck 2026
Control+ : la solution de cybersécurité proactive qui neutralise 99,8% des menaces avant qu’elles n’agissent

=== DIAPOSITIVE 2 : POINTS CLÉS DU PROJET ===
1. En 2024, les consommateurs américains ont perdu 12,5Mds€ à cause des fraudes en ligne (+25% en un an) et 73% déclarent avoir déjà été ciblés par des attaques. Les menaces sont désormais multi-canaux et en temps réel, alors que les protections traditionnelles restent fragmentées et majoritairement réactives.
2. Control+ développe une solution de cybersécurité B2C proactive, déployée via une extension navigateur et application mobile, reposant sur 127 agents IA autonomes fonctionnant en continu. La technologie permet de détecter en temps réel les menaces avec un taux de fiabilité de +99,8%.
3. Avec un lancement réussi aux États-Unis au T2 2025, Control+ a vu son ARR passer de 1,6M€ en janvier 2025 à près de 8M€ en février 2026. En l’espace de 12 mois, le nombre moyen de clients acquis chaque mois est passé de 510 à +7 800, représentant un total de 27 000 clients avec une LTV par client multipliée par 2.
4. L’entreprise est dirigée par deux serial entrepreneurs, Laurent Amar (fondateur du Groupe EMOVA, 400 franchises, IPO puis exit) ainsi que Mehdi Bellatig (plusieurs exits dans les plateformes digitales) et accompagnée par des experts en IA et physique quantique.
5. Control+ se positionne sur le marché mondial de la cybersécurité estimé à plus de 250Mds€ en 2025, dont 73Mds€ aux États-Unis et 63Mds€ en Europe, porté par l’explosion des fraudes numériques et la montée en puissance des solutions de protection des particuliers.
6. Le marché capitalistique, notamment américain, s’est montré dynamique ces dernières années : les concurrents directs ont été valorisés à des multiples >10x le revenu, avec des valorisations dépassant le milliard d’euros, traduisant une réelle profondeur de marché.
* Scénarios d’exit envisagés :
- Rachat par un acteur de la cybersécurité, fintech ou assurtech à l’horizon 2030.
- Levée de fonds majeure constituant une opportunité d’exit pour les investisseurs.

=== DIAPOSITIVE 3 : DÉTAILS DE LA LEVÉE ===
Control+ lève 3M€ dont 800K€ avec Tudigo pour accélérer son acquisition et sa pénétration de marché.
- Instrument financier : Actions
- Montant total de la levée de fonds : 3M€
- Montant plancher Tudigo : 300K€
- Montant plafond Tudigo : 800K€
- Valorisation pré-money : 30M€
- Ticket minimum : 500€
Sur les 3M€ recherchés, Control+ a d’ores et déjà sécurisé +1,7M€, notamment auprès de ses investisseurs historiques (40% réinvestissent), de Badge et de Umento.
- Stade de financement : Série A
- Horizon de sortie : 5 ans
- Multiple cible : 4,0x
- Niveau de risque : 5,4/10

=== DIAPOSITIVE 4 : POTENTIEL DE RENDEMENT SELON LES SCÉNARIOS ===
- Scénario Management = à l’horizon 2030, 47,2M€ de CA, 17,5M€ d’EBE, dette nette de -25,4M€ (Multiple: 7,4x, Rendement: 49,1%)
- Scénario Middle = à l’horizon 2030, 35,2M€ de CA, 9,3M€ d’EBE, dette nette de -16,3M€ (Multiple: 4,0x, Rendement: 32,0%)
- Scénario Conservateur = à l’horizon 2030, 31,9M€ de CA, 6,2M€ d’EBE, dette nette de -11,8M€ (Multiple: 2,7x, Rendement: 22,1%)
- Valorisation cible à la revente : 132,3M€ (soit 12,4x l'EBE 2030, scénario Middle)

=== DIAPOSITIVE 5 : RISQUES LIÉS À L'ACTIVITÉ DE CONTROL+ ===
Niveau de risque moyen du projet – 5,4/10 (Profil d'équilibre dynamique)
- Risques opérationnels (6,0/10) : Dépendance au canal d'acquisition publicitaire unique Meta.
- Risques marché (5,9/10) : Marché de la cybersécurité grand public déjà bien occupé (Norton, McAfee, Guardio, Aura).
- Risques financiers (5,6/10) : Phase d'accélération à consolider dans la durée, trésorerie court terme confortable, rentabilité requise à moyen terme.

=== DIAPOSITIVE 11 : EXCELLENCE TECHNOLOGIQUE ===
Control+ propose une solution de cybersécurité en temps réel avec un taux d’efficacité de 99,8% :
- 6 ans de R&D pour développer la technologie.
- Plus de 3M€ investis pour entrainer l'IA propriétaire (IA informationnelle).
- +127 agents IA autonomes sur lesquels repose la solution en continu.
- Détection de menaces en moins de 10 secondes.
- Protection 24h/24 et 7j/7.

=== DIAPOSITIVE 12 : ÉQUIPE DE FONDATION ===
- Laurent Amar (PDG & Fondateur) : Fondateur du Groupe EMOVA (Monceau Fleurs, Au Nom de la Rose), passé de 1 point de vente à +400 franchises (>210M€ de CA), IPO en 2007 (Alternext) puis exit en 2014.
- Mehdi Bellatig (CTO & Co-fondateur) : Entrepreneur digital avec plusieurs exits dans les plateformes technologiques, co-fondateur de Red Media (passée de 0 à 17M€ de CA en 2 ans), co-fondateur de Broad People (cédée en 2015).
- Guillaume Mayot (CFO & Board Member) : +7 ans chez SG CIB en banquier d'affaires, fondateur de Lukeion Advisory.
- Mykola Yakovliev (Lead Data Scientist) : +7 ans chez 2021.AI spécialisé dans l'IA, détection de fraude chez Fareportal.
- Anastasiya Arkhipova (CAO) : +8 ans d'expérience en e-commerce en Europe et aux États-Unis.

=== DIAPOSITIVE 13 : CHIFFRES D'AFFAIRES HISTORIQUES & MÉTRIQUES DE JANVIER 2026 ===
- Chiffre d'affaires historique :
  - 2022 : 0,06 M€
  - 2023 : 0,30 M€
  - 2024 : 1,06 M€
  - 2025 : 2,37 M€
- Répartition géographique du CA : 82% États-Unis, 18% France.
- Métriques opérationnelles de janvier 2026 :
  - +27 000 utilisateurs acquis aux États-Unis.
  - ARPU de 66€ (vs 37€ en mars 2025, soit +77% de croissance).
  - CAC de 59,7€ (vs 99,4€ en mars 2025, soit -40% de baisse).
  - LTV de 198€ (vs 99,8€ en mars 2025, soit +98% de croissance).

=== DIAPOSITIVE 14 : BUSINESS MODEL HYBRIDE ===
- Control+ Abonnement : Offre d'abonnement (14€ par mois, 96€ par an, LTV 198€, ROAS 118%). Accès complet à la navigation sécurisée et protection d'identité.
- Control+ Extension : Extension navigateur générant 5 à 10% de rétrocessions sur les achats fiables auprès de +6 000 marchands partenaires (Amazon, Alibaba, Fnac, Darty, Cdiscount, BackMarket). `;

                  handlePdfExtracted(ocrSample, "Control+", {
                    arr_eur: 8000000,
                    arr_growth_12m: 5,
                    roas: 1.18,
                    ltv_eur: 198,
                    cac_eur: 60,
                    valuation_premoney_eur: 30000000,
                    raise_amount_eur: 3000000
                  });
                }}
                className="inline-flex items-center gap-1.5 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-500/30 text-indigo-300 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider cursor-pointer transform active:scale-[0.98] transition-all"
              >
                <Sparkles size={11} className="text-amber-400 animate-pulse shrink-0" />
                Charger l'exemple (Pitch Deck Control+)
              </button>
            </div>
            <PdfUploader 
              onTextExtracted={handlePdfExtracted}
              currentText={pitch}
              disabled={loading}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">Nom de la startup</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Mistral AI, Wayve, Pennylane..."
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-6 py-4 text-slate-200 outline-none transition-all font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1 flex justify-between items-center">
              <span>CONTENU DU PITCH (DECK, SITE, DESCRIPTION)</span>
              <span className="text-xs text-slate-600 font-normal lowercase italic">{pitch.length} caractères</span>
            </label>
            <div className="relative">
              <textarea
                value={pitch}
                onChange={e => setPitch(e.target.value)}
                rows={12}
                placeholder={`Collez l'intégralité du pitch ici.\n\nLe moteur IRO extraira :\n- Moats technologiques (DI)\n- Unicité des données (ADC)\n- Intégration métier (IPC)\n- Qualité équipe (GCH)`}
                className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-6 py-5 text-slate-200 outline-none transition-all font-mono leading-relaxed resize-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-4">
            <div className="flex gap-4 items-center">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase font-bold tracking-tight bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700">
                <Shield size={12} className="text-emerald-400" /> Confidentiel
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase font-bold tracking-tight bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700">
                <Zap size={12} className="text-amber-400" /> Extraction auto v6.6
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !name.trim() || !pitch.trim()}
              className="flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-black px-10 py-4 rounded-xl text-sm uppercase tracking-widest transition-all shadow-xl shadow-indigo-600/20 active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {loadingStep === 'collecting' ? 'Collecte...' : 'Analyse...'}
                </>
              ) : (
                <>
                  Lancer l'Analyse IRO
                  <ChevronRight size={18} />
                </>
              )}
            </button>
          </div>
        </form>

        <div className="mt-10 p-6 bg-indigo-500/5 rounded-2xl border border-indigo-500/10">
          <div className="flex gap-4">
            <Info className="text-indigo-400 shrink-0 mt-1" size={20} />
            <p className="text-[11px] text-slate-400 leading-relaxed italic">
              <b>Note Méthodologique :</b> IRO v6.6 utilise le pitch comme donnée <b>primaire</b>. Si des contradictions apparaissent entre le pitch et les données collectées sur le web (LinkedIn, GitHub), le LLM appliquera un <b>malus de confiance</b> sur les dimensions concernées. Assurez-vous que le texte collé reflète la réalité opérationnelle actuelle.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default PitchAnalyzer;
