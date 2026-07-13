# Protocole de ré-annotation en aveugle — IRO Strength Velocity v7.0.0

Ce document définit de manière formelle le protocole de ré-annotation clinique/stratégique en aveugle pour l'évaluation des événements de défaillance (event=1) ou de censure (event=0) à 36 mois.

## 1. Objectifs de transparence scientifique
Pour parer aux biais d'annotation rétrospectifs et aux risques d'arbitrage subjectif, l'affectation des événements du Gold Standard (à partir de `gs-096`) obéit à une double saisie indépendante et anonymisée.

## 2. Rôles et anonymisation
- **Annotateurs indépendants** : Experts désignés (A1, A2, etc.) n'ayant pas participé au scoring initial IRO ou à la modélisation du risque.
- **Masquage** : Lors de la phase de ré-annotation, les annotateurs n'ont accès ni à l'identité exacte des porteurs de projet (anonymisation des noms propres et marques), ni au score IRO Global, ni aux prédictions de survie du modèle de Cox / RSF.

## 3. Critères d'annotation formelle (Delphi)
- **event = 1 (Événement négatif)** : Consolidé si la startup subit l'une des situations suivantes dans les 36 mois post-scoring :
  - Cessation d'activité formelle (liquidation, radiation).
  - Pivot stratégique majeur entraînant l'abandon complet de l'axe technologique/commercial initial (re-branding total avec perte d'actif).
  - Rachat de détresse (fire sale) non-générateur de plus-value.
- **event = 0 (Censure / Actif)** : Survie confirmée au terme de la période d'observation (activité commerciale ou R&D vérifiable sur Pappers, registre du commerce ou activité LinkedIn persistante).

## 4. Calcul de l'Accord Inter-Annotateurs (ICC)
Le niveau de concordance est caractérisé par le **Kappa de Cohen** pour la double saisie binaire de l'événement.
- **Formule de calcul** :
  $$P_o = \frac{\text{accords observés}}{n}$$
  $$P_e = P_{1,A} P_{1,B} + (1 - P_{1,A})(1 - P_{1,B})$$
  $$\kappa = \frac{P_o - P_e}{1 - P_e}$$

- **Interprétation de $\kappa$** :
  - $\kappa \ge 0.80$ : Excellente concordance (validation définitive)
  - $0.70 \le \kappa < 0.80$ : Bonne concordance
  - $0.60 \le \kappa < 0.70$ : Acceptable
  - $\kappa < 0.60$ : Insuffisant (réunion d'arbitrage Delphi obligatoire pour ré-annotation)

## 5. Gestion des Événements par Variable (EPV)
Avec un nombre restreint d'événements (événements observés = 9), l'EPV est de :
$$\text{EPV} = \frac{9}{5} = 1.80$$
Ce niveau est inférieur au seuil institutionnel classique ($\ge 10$), induisant un intervalle de confiance potentiellement large pour les coefficients. Cet aspect est explicitement documenté et rapporté de manière transparente aux institutions (BPI, VC, etc.) afin d'éviter toute sur-interprétation de la puissance prédictive brute.
