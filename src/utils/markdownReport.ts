/**
 * markdownReport.ts — Antigravity Intelligence Platform
 * Générateur de rapport structuré au format Markdown (.md)
 */

import { IROResult } from '../types/iro';

// Type local pour les justifications IRO (champs optionnels de la réponse LLM)
interface IROJustifications {
  [dimension: string]: string | undefined;
}


export function generateMarkdownReport(r: IROResult, customTitle?: string): string {
  if (!r) return '';

  const dateStr = new Date().toLocaleDateString('fr-FR', {
    workingDay: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  } as any);

  let md = `# ${customTitle || "RAPPORT D'AUDIT DE ROBUSTESSE ET VIABILITÉ LONGITUDINALE (IRO)"}\n\n`;

  // IRO: En-tête Métadonnées
  md += `## 📋 MÉTADONNÉES DE L'ENTITÉ\n\n`;
  md += `| Paramètre | Valeur |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Nom de l'entreprise** | ${r.startup_name} |\n`;
  md += `| **Secteur / Vertical** | ${r.vertical || 'SAAS / Général'} |\n`;
  md += `| **Stade de financement** | ${r.stade_financement || 'Non renseigné'} |\n`;
  md += `| **Âge de l'entité** | ${r.age_mois ? `${r.age_mois} mois` : 'Non disponible'} |\n`;
  md += `| **Mise à jour d'Analyse** | ${dateStr} |\n`;
  md += `| **Référentiel Framework** | IRO v7.0.0 (Normatif Millésime 2026) |\n\n`;

  // IRO: Synthèse des Scores
  md += `## 📊 SYNTHÈSE EXÉCUTIVE DES SCORES\n\n`;
  md += `* **SCORE IRO DE BASE :** \`${r.iro?.score_100 ?? 0}/100\`\n`;
  md += `* **SCORE DE RISQUE STRUCTUREL (SRD) :** \`${r.srd?.srd_100 ?? 50}/100\`\n`;
  md += `* **SCORE IRO CORRIGÉ (Du Risque) :** **\`${r.srd?.iro_cr ?? 50}/100\`**\n`;
  md += `* **QUADRANT DE COMPORTEMENT :** **${r.srd?.quadrant || 'Non déterminé'}**\n`;
  md += `* **CONFIANCE GLOBALE :** \`${r.iro?.ipc_confiance ? (r.iro.ipc_confiance * 100).toFixed(0) : '70'}%\`\n\n`;

  md += `### Interprétation Globale\n`;
  md += `> ${r.iro?.interpretation || "Aucune interprétation enregistrée."}\n\n`;

  if (r.flags) {
    md += `### Alertes & Indicateurs de Contrôle\n`;
    md += `* **Plancher d'Axe Activé (Floor) :** ${r.flags.floor_activated ? '⚠️ ACTIVÉ (Un ou plusieurs scores d\'axe ont chuté à 0)' : '✅ AUCUN (Axe sain)'}\n`;
    md += `* **Effet d\'Ancrage Concurrentiel :** ${r.flags.ancrage_warning ? '⚠️ ALERTE (Anomalie d\'ancrage détectée entre les repères)' : '✅ STABLE'}\n\n`;
  }

  // IRO: Profil sur les 6 Axes
  md += `## 🎯 PROFIL D'IRO PAR AXES TECHNIQUE ET FONCTIONNELS\n\n`;
  md += `Le framework IRO audite 6 dimensions fondamentales sur une échelle normative de 0 (critique) à 4 (optimal) :\n\n`;
  
  const axesMap = {
    DI: { label: 'Dépendance Infrastructurelle Cloud', weight: '18%' },
    ADC: { label: 'Actif de Données & Modèle Propre', weight: '22%' },
    IPC: { label: 'Processus Critiques & Automatisation', weight: '22%' },
    AR: { label: 'Autonomie Réglementaire (Certifications)', weight: '14%' },
    CA: { label: 'Contrats d\'Affranchissement Propriété', weight: '12%' },
    GCH: { label: 'Gouvernance des compétences humaines', weight: '12%' }
  } as any;

  md += `| Axe | Nom Précis | Note / 4 | Pondération | Statut / Justification |\n`;
  md += `| :--- | :--- | :---: | :---: | :--- |\n`;
  
  Object.keys(axesMap).forEach(key => {
    const info = axesMap[key];
    const score = r.iro?.scores?.[key as keyof typeof r.iro.scores] ?? 0;
    const just = (r.iro?.justifications as IROJustifications)?.[key] || 'Non documenté';
    md += `| **${key}** | ${info.label} | \`${score}/4\` | ${info.weight} | ${just} |\n`;
  });
  
  md += `\n`;

  // IRO: Variables du Risque SRD
  md += `## 🛡️ ANALYSE DE RISQUE SRD ET DE CONCURRENCE DIRECTE\n\n`;
  md += `Le score SRD module le score de robustesse IRO en analysant la vitesse de marché, la concurrence féroce, et la dépendance systémique.\n\n`;
  
  const srdVars = [
    { key: 'VMM', name: 'Vélocité Marché LLM' },
    { key: 'NCD', name: 'Concurrents Directs Répertoriés' },
    { key: 'DFL', name: 'Dépendance Directe aux Modèles Tiers' }
  ];

  srdVars.forEach(v => {
    const data = r.srd[v.key as 'VMM' | 'NCD' | 'DFL'];
    if (data) {
      md += `### ${v.name} (${v.key}) : \`${data.score}/4\`\n`;
      md += `> **Justification :** ${data.justification || 'Aucune justification disponible.'}\n\n`;
    }
  });

  // IRO: Analyse prédictive de survie et risques concurrentiels
  if (r.cox_survival) {
    md += `## 📈 ESTIMATION LONGITUDINALE ET MODÈLE DE SURVIE (COX & RSF)\n\n`;
    md += `### Risque Global à Horizon 36 Mois\n`;
    md += `* **Probabilité de survie estimée à 12 Mois :** \`${(r.cox_survival.survival_12m * 100).toFixed(1)}%\`\n`;
    md += `* **Probabilité de survie estimée à 24 Mois :** \`${(r.cox_survival.survival_24m * 100).toFixed(1)}%\`\n`;
    md += `* **Probabilité de survie estimée à 36 Mois :** **\`${(r.cox_survival.survival_36m * 100).toFixed(1)}%\`**\n`;
    md += `* **Hazard Ratio Ajusté (HR) :** \`${r.cox_survival.hazard_ratio.toFixed(3)}\` *(par rapport à la cohorte moyenne de référence)*\n`;
    md += `* **Profil de Risque Qualitatif :** **\`${(r.cox_survival.risk_profile || 'Non spécifié').toUpperCase()}\`**\n`;
    if (r.cox_survival.c_index_display) {
      md += `* **Pouvoir prédictif (C-index) :** \`${r.cox_survival.c_index_display}\` *(${r.cox_survival.c_index_interpretation})*\n`;
      md += `* **Événements par Variable (EPV) :** \`${r.cox_survival.epv_note}\`\n`;
    }
    md += `\n`;

    // Risques concurrentiels compétitifs
    if (r.competing_risks) {
      md += `### Modèle de Risques Compétitifs (Scénarios d'Exit à 36 Mois)\n`;
      md += `Ce modèle estime les probabilités concurrentes que la startup connaisse différentes issues :\n\n`;
      md += `| Scénario d'issue | Probabilité prédite | Description de l'état |\n`;
      md += `| :--- | :---: | :--- |\n`;
      md += `| 📊 **Actif / Flottaison** | \`${(r.competing_risks.p_actif_36m * 100).toFixed(1)}%\` | Continue de faire du business en restant indépendante |\n`;
      md += `| 💰 **Acquisition (M&A)** | \`${(r.competing_risks.p_acquisition_36m * 100).toFixed(1)}%\` | Rachat de l'actif ou intégration stratégique par un tiers |\n`;
      md += `| 🔄 **Pivot Radical** | \`${(r.competing_risks.p_pivot_36m * 100).toFixed(1)}%\` | Abandon de l'actif initial pour restructuration ou reconversion |\n`;
      md += `| 🚨 **Liquidation / Faillite** | \`${(r.competing_risks.p_faillite_36m * 100).toFixed(1)}%\` | Cessation des paiements, dissolution de la structure |\n\n`;
    }
  }

  // IRO: Niveau TRL et règles réglementaires de contrôle
  if (r.trl) {
    md += `## ⚙️ MATURITÉ TECHNOLOGIQUE ET RÈGLES DE VALIDATION CONTRAINTES\n\n`;
    md += `### Niveau de Maturité : TRL ${r.trl.niveau}\n`;
    md += `> **Définition & Exigence :** ${r.trl.description || 'Non caractérisé'}\n\n`;

    if (r.validation_logs && r.validation_logs.length > 0) {
      md += `### Journal des règles d'audit exécutées\n`;
      r.validation_logs.forEach((log: string) => {
        md += `* **Règle :** ${log}\n`;
      });
      md += `\n`;
    }
  }

  // IRO: Diagnostic des hypothèses
  if (r.hypotheses) {
    md += `## 💡 DIAGNOSTIC DU CORPUS D'HYPOTHÈSES STRATÉGIQUES\n\n`;
    md += `Validation croisée du discours de la startup vis-à-vis des données constatées :\n\n`;
    md += `| Réf | Évaluation | Constat & Analyse Opérationnelle |\n`;
    md += `| :--- | :---: | :--- |\n`;
    
    (Object.entries(r.hypotheses) as [string, { signal: string; observation: string }][]).forEach(([hId, h]) => {
      md += `| **${hId}** | \`${(h.signal || 'neutre').toUpperCase()}\` | ${h.observation} |\n`;
    });
    
    md += `\n`;
  }

  // IRO: Synthèse & Verdict Investisseur
  if (r.synthese) {
    md += `## 💼 JUGEMENT NORMATIF ET VERDICT INVESTISSEUR\n\n`;
    md += `### 💪 Forces Clés Distinguées\n`;
    if (r.synthese.forces && r.synthese.forces.length > 0) {
      r.synthese.forces.forEach(f => {
        md += `* ${f}\n`;
      });
    } else {
      md += `* Aucun signal fort d'exclusivité propriétaire identifié.\n`;
    }
    md += `\n`;

    md += `### ⚠️ Facteurs de Risques Critiques / Bottlenecks\n`;
    if (r.synthese.risques && r.synthese.risques.length > 0) {
      r.synthese.risques.forEach(k => {
        md += `* ${k}\n`;
      });
    } else {
      md += `* Aucun facteur de risque majeur critique identifié.\n`;
    }
    md += `\n`;

    md += `### 🎯 Recommandations Stratégiques Préconisées\n`;
    md += `> ${r.synthese.recommandation || "Non renseignée"}\n\n`;

    md += `### ⚖️ Verdict d'Investissement Définitif\n`;
    md += `> **Position du Moteur :** **${r.synthese.verdict_investisseur || "Non déterminé"}**\n\n`;
  }

  // Disclaimer
  md += `---\n\n`;
  md += `### ⚖️ DISCLAIMER DE NON RESPONSABILITÉ\n`;
  md += `*Ce rapport constitue une modélisation théorique normative basée sur le framework d'évaluation IRO v7.0.0. Les résultats, scores d'Axes, probabilités de défaillances de Cox et d'Egressions compétitifs n'ont qu'une valeur indicative d'orientation stratégique à la date de signature de l'audit. Ils ne préjugent en rien de la viabilité financière effective à terme ou des performances réelles du business.*`;

  return md;
}
