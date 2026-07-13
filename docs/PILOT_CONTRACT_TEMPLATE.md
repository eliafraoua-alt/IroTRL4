# Contrat-Cadre de Co-Validation et d'Évaluation Pilote (TRL 4)
### Entre IRO Strength SAS et le Partenaire Pilote

---

**ENTRE LES SOUSSIGNÉS :**

1. **IRO Strength SAS**, société par actions simplifiée au capital de 100 000 euros, immatriculée au Registre du Commerce et des Sociétés de Paris sous le numéro 920 123 456, dont le siège social est situé au 12 Rue de la Paix, 75002 Paris, représentée par son Président-Fondateur, ci-après désignée "**l'Éditeur**",

**D'UNE PART,**

**ET :**

2. **Le Partenaire Pilote**, tel qu'identifié dans l'Annexe A (généralement un client pilote institutionnel ou un fonds d'investissement tel que la BPI, un cabinet de Due Diligence ou un Corporate Venture Capitalist), représenté par son représentant légal dûment habilité aux fins des présentes, ci-après désigné "**le Partenaire Pilote**",

**D'AUTRE PART.**

Ci-après collectivement désignés "**les Parties**" et individuellement "**la Partie**".

---

## PRÉAMBULE

*   L’Éditeur a conçu et développé la méthodologie **IRO Strength Velocity (v7.0.0)**, un outil algorithmique d’évaluation de la résilience et de la survie à 18 et 36 mois des jeunes entreprises innovantes (startups).
*   Cette technologie combine des indicateurs d'actifs intangibles exclusifs (DI, ADC, IPC, AR, CA, GCH) avec des estimateurs statistiques de survie (modèle de Cox à risques proportionnels et estimateur haute-résolution de survie court-terme opérationnelle).
*   La solution est actuellement en phase de validation méthodologique formelle de niveau **TRL 4** (Technology Readiness Level 4).
*   Le Partenaire Pilote dispose d’une expertise reconnue dans le financement et l'accompagnement de l'innovation et souhaite évaluer les capacités de la solution en l’intégrant à titre expérimental dans sa phase de Due Diligence et ses comités de sélection de startups pour tracker l'efficience décisionnelle.

---

## ARTICLE 1 : OBJET DU CONTRAT

Le présent Contrat a pour objet d'établir les conditions juridiques, financières et techniques selon lesquelles l’Éditeur concède au Partenaire Pilote un droit d'accès temporaire et d'évaluation expérimentale de la solution **IRO Strength Velocity**, et organise la co-validation de la cohorte pilote.

---

## ARTICLE 2 : OCTROI DE LICENCE D’ÉVALUATION

L’Éditeur concède au Partenaire Pilote, pour la durée du pilote, une licence d'utilisation :
*   **Personnelle, non exclusive et non transférable** ;
*   Limitée aux seuls besoins d'évaluation de la pertinence des scores issus de l'algorithme ;
*   Sans droit de sous-licencier, altérer, modifier ou désassembler le code source.

Les Parties conviennent expressément que la licence reste régie par la **Licence Propriétaire Pilote** d'IRO Strength SAS, telle que figurant dans le fichier `LICENSE` à la racine de la distribution logicielle.

---

## ARTICLE 3 : TÉLÉMÉTRIE DE VALEUR ET PROTOCOLE DE CO-VALIDATION

Afin d'accumuler les preuves d'impact requises pour l'homologation TRL 5+, le Partenaire Pilote accepte de participer activement au dispositif de télémétrie de valeur décrit ci-après :
1.  **Tracking des sessions :** Pour chaque évaluation, la plateforme enregistre de manière anonyme et sécurisée l'identifiant évaluateur, la durée de la session de due diligence, et les éventuelles divergences d'appréciation entre l'expert humain et l'algorithme (sauvegardées via `PilotSession` et agrégées via `computePilotMetrics`).
2.  **Estimation du temps gagné :** L'évaluateur s'engage à qualifier après chaque comité de sélection l'indice de gain de temps et d’aide à la décision apporté par le rapport IRO.
3.  **Taux d'adoption :** Le Partenaire pilote partagera de manière anonymisée le taux d'intégration effectif du score IRO dans ses synthèses décisionnelles de conseil d'administration ou de comité de crédit.

---

## ARTICLE 4 : SÉCURITÉ DES DONNÉES ET CONFORMITÉ RGPD

Les Parties s'engagent à respecter l'ensemble des réglementations applicables en matière de protection des données à caractère personnel, en particulier le Règlement Général sur la Protection des Données (RGPD) :
*   Les uploads de pitch decks ou d'états financiers sont chiffrés en transit et au repos.
*   Aucune donnée relative aux fondateurs physiques ou aux coordonnées des équipes n'est stockée de façon non chiffrée. Les rapports ne contiennent aucun élément nominatif sensible n'ayant pas reçu le consentement exprès de la startup.
*   Pour l'homologation réglementaire préventive de conformité vis-à-vis du **Règlement Européen sur l'Intelligence Artificielle (EU AI Act)**, les Parties déclarent avoir pris acte du mémo de qualification éthique (`docs/AI_ACT_QUALIFICATION.md`).

---

## ARTICLE 5 : SENS DE LA TERMINOLOGIE ÉTHIQUE

Pour éviter tout effet performatif destructeur et respecter les dispositions de supervision humaine du projet, le Partenaire Pilote s'engage sous sa responsabilité exclusive à éliminer toute terminologie anxiogène lors des comptes-rendus d'évaluation. 

Il utilisera exclusivement les expressions validées par le **Glossaire Ethique (F4)** :
*   Remplacer *"probabilité de faillite"* par **"signal structurel de risque élevé"**.
*   Remplacer *"mauvaise startup"* par **"score IRO en dessous du seuil de référence sectoriel"**.
*   Remplacer *"startup en danger"* par **"startup en Zone Rouge — consolidation opérationnelle recommandée"**.

---

## ARTICLE 6 : SUPERVISION HUMAINE ET DROITS DE RECOURS

Conformément à l’article 14 de l'EU AI Act, tout score présentant un signal d'alerte extrême ou un score corrigé du risque (IRO-CR) inférieur à 30 déclenche la mise en place automatique d'un sas de supervision humaine (`evaluateHumanReviewGate`).
*   Le Partenaire Pilote s'interdit d'interrompre un accompagnement à l'innovation uniquement sur la base d'un score automatisé défavorable.
*   Toute startup évaluée conserve un droit d'accès à la justification de son scoring ainsi qu'un accès au **Processus de Recours de Score (F3)** lui garantissant une réévaluation formelle sous 30 jours calendaires (`POST /api/contest`).

---

## ARTICLE 7 : DURÉE ET RÉSILIATION

Le pilote est conclu pour une durée ferme de six (6) mois à compter de la date d'activation de la plateforme. Chacune des Parties peut y mettre fin de plein droit par lettre recommandée avec accusé de réception ou par notification électronique certifiée, moyennant le respect d'un préavis de trente (30) jours calendaires.

---

## ARTICLE 8 : DROIT APPLICABLE ET ATTRIBUTION DE COMPÉTENCE

Le présent contrat est régi par le **droit français**. Tout litige relatif à sa validité, son interprétation ou son exécution sera soumis, à défaut d'accord amiable sous quinze (15) jours, à la compétence exclusive des **Tribunaux de Paris**.
