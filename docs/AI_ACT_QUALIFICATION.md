# Mémo Juridique — Qualification EU AI Act
### IRO Strength Velocity v7.0.0 — Document Confidentiel de Gouvernance BPI

Ce mémo présente l'analyse de qualification juridique du système **IRO Strength Velocity** au regard du Règlement Européen sur l'Intelligence Artificielle (Règlement (UE) 2024/1689 - **EU AI Act**).

---

## 1. Description du Système IRO Strength Velocity

**IRO Strength Velocity** est un système algorithmique de scoring de startups combinant :
- Une pondération hybride normée (6 dimensions IRO : DI, ADC, IPC, AR, CA, GCH).
- Un estimateur de survie structurelle fondé sur un modèle de Cox à risques proportionnels calibré.
- Un estimateur de survie court-terme opérationnelle à 18 mois (FSF).

Le système est conçu pour être utilisé par des analystes d'investissement, notamment dans le cadre de la phase pilote avec la BPI, pour guider les décisions de financement et analyser les risques de portefeuilles.

---

## 2. Qualification au regard de l'AI Act

L'AI Act classe les systèmes d'IA en quatre niveaux de risque : Inacceptable, Élevé, Limité, et Minimal/Nul.

### 2.1 Critères de classification "Haut Risque" (Article 6 & Annexe III)

Selon l'**Annexe III, Section 5, "Accès et admissibilité aux services privés essentiels et aux avantages et services publics"** du texte consolidé de l'AI Act :
> "Les systèmes d'IA utilisés pour évaluer la solvabilité (*credit scoring*) des personnes physiques ou pour établir leur profil de risque de crédit, ou pour évaluer la viabilité financière de projets/entités dans le contexte de l'attribution d'aides publiques, de prêts ou de garanties bancaires."

#### Analyse applicative IRO :
1. **Évaluation de viabilité pour aides publiques :** Le système de scoring IRO est déployé à titre pilote à la BPI pour accompagner l'attribution éventuelle d'aides publiques à l'innovation (subventions, prêts d'honneur, avances récupérables).
2. **Scoring des startups individuelles :** Bien que l'accent soit mis sur les critères structurels de résilience IA, le résultat final (Zone Rouge/Jaune/Verte) et le score IRO Corrigé (IRO-CR) sont des instruments de profilage de viabilité opérationnelle.

**Conclusion de classification :** 
Le système IRO Strength Velocity est qualifié de **Système d'IA à Haut Risque (High-Risk AI System)** lorsqu'il est activement utilisé pour fonder ou influencer des décisions d'attribution de financements publics ou de subventions d'État.

---

## 3. Obligations de Conformité Applicables (TRL 5+)

En vertu des exigences pour les systèmes d'IA à haut risque, la feuille de route d'IRO Strength Velocity prévoit les piliers suivants avant tout déploiement de production à grande échelle (Post-TRL 5) :

### A. Système d'Analyse d'Impact (AIA) & Gestion des Risques
- Mise en place d'un registre de gestion des risques documentant le compromis biais/variance.
- Analyse d'impact sur les droits fondamentaux, en particulier concernant l'équité de traitement des start-ups dirigées par des fondateurs uniques (REV4 - Ancrage Warning).

### B. Gouvernance des Données de Calibrage
- Évaluation formelle des biais de sélection de la cohorte historique (32 start-ups de référence de l'échantillon français).
- Vérification que la proportionnalité des risques de Cox ne soit pas discriminatoire par secteur ou origine de l'équipe (GCH).

### C. Traçabilité et Auditabilité (Journalisation)
- Le journal d'audit (`src/utils/audit-journal.ts`) est actif et enregistre de manière immuable l'ensemble des inputs, scores générés, configurations de poids et versions de prompts.

### D. Contrôle et Supervision Humaine (F4)
- **Supervision humaine intégrée :** Aucun verdict extrême (IRO-CR < 30 ou présence de flags critiques) ne peut se traduire par un rejet automatique sans évaluation humaine obligatoire (voir `evaluateHumanReviewGate`).

---

## 4. Mesures Prises en Phase Pilote Actuelle (v7.0.0)

Pendant la phase pilote actuelle de TRL 4 (validation formelle) :
1. **Clause de Non-Automatisation :** Le système sert exclusivement de support d'aide à la décision. L'analyste humain conserve l'entière discrétion de la recommandation d'investissement.
2. **Processus de Recours Actif (F3) :** Toute start-up contestant l'impartialité de son score IRO peut soumettre un dossier de recours traité sous 30 jours calendaires (via `POST /api/contest`).
3. **Glossaire Ethique Approuvé (F4) :** Interdiction des termes catastrophistes non supervisés au profit d'alertes méthodologiques calibrées.
