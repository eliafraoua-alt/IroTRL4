# IRO Strength Velocity

**Outil d'évaluation de la résilience opérationnelle des startups**
Version 7.0.0 — Audit BPI · Confidentiel

---

## Description

IRO Strength Velocity est un système de scoring de startups assisté par LLM, combinant :
- **6 dimensions IRO** (DI, ADC, IPC, AR, CA, GCH) à pondération normative — voir la note sur les poids ci-dessous
- **Modèle à hasards proportionnels** calibré de façon exploratoire sur une cohorte française rétrospective **vérifiée** (n = 101 entités traçables ; périmètre de calibration n = 32, 9 événements) — voir *Statut de validation*
- **Fournisseur LLM** : Google Gemini (exclusif dans cette version)
- **Détection des biais Goodhart** sur 7 patterns anti-optimisation

> **Note sur les poids (18/22/22/13/13/12).** Ces poids sont **normatifs**, issus d'un arbitrage d'auteur (héritage Delphi v4.3). La matrice de comparaison par paires présente dans `src/utils/ahp.ts` est **dérivée arithmétiquement de ces poids** (ex. 0.18/0.22 = 0.82) : son ratio de cohérence est nul par construction et **ne constitue pas une validation externe**. Le moteur AHP est opérationnel et prêt à recevoir les jugements d'un panel d'experts réel — cette élicitation reste à conduire.

## Équipe

- **Analyse quantitative & moteur statistique**
- **Caroline Capelle** — Gouvernance & conformité AI Act

## Installation

### Prérequis système

| Outil   | Version minimale | Notes                                   |
|---------|------------------|-----------------------------------------|
| Node.js | 20 LTS           | Requis                                  |
| npm     | 10+              | Fourni avec Node                        |
| Python  | 3.11             | Batch uniquement (batch_gemini_iro.py)  |
| g++     | Optionnel        | Pour better-sqlite3 natif (plus rapide) |

### Installation rapide (Ubuntu 24)

```bash
git clone <repo>
cd irostrength-velocity

# Avec build tools (better-sqlite3 natif — recommandé)
sudo apt-get install -y python3 make g++
npm ci

# Sans build tools (fallback sql.js WASM — fonctionne aussi)
npm ci

# Tests
npm test
```

### Configuration

```bash
cp .env.example .env
# Renseigner au minimum GEMINI_API_KEY
# Pour le vrai multi-LLM : + ANTHROPIC_API_KEY + MISTRAL_API_KEY
```

### Démarrer

```bash
npm run dev      # Serveur de développement (port 3000)
npm run build    # Build production
npm start        # Serveur production
```

## Méthode en bref

Le score IRO (0–100) agrège 6 dimensions évaluées par consensus LLM :

| Dim | Libellé | Poids brut | Poids effectif* |
|-----|---------|-----------|-----------------|
| DI  | Dépendance Infrastructurelle | 0.18 | 16.1 % |
| ADC | Actif de Données Cumulatif   | 0.22 | 19.6 % |
| IPC | Intégration Processus Critiques | 0.22 | 19.6 % |
| AR  | Anticipation Réglementaire   | 0.13 | 11.6 % |
| CA  | Capacité d'Adaptation        | 0.10 | 8.9 %  |
| GCH | Gouvernance & Capital Humain | 0.12 | 10.7 % |
| **LU** | **Lead Users** (von Hippel) | **0.15** | **13.4 %** |

\* Les poids bruts somment à 1.12 ; le moteur normalise par leur somme. Le *poids effectif* est le poids réellement appliqué.
**Correctif d'audit SCI-D (13/07/2026)** : la version antérieure de ce tableau annonçait 6 dimensions sommant à 100 %, avec CA à 13 % (au lieu de 10 %) et **sans mentionner LU**, pourtant la 4ᵉ dimension par importance. Le moteur applique bien 7 dimensions.

Le score IRO-CR intègre un correctif de maturité (-30/200).

### Validation — cohorte auditée n = 442

**Résultat principal — AUC = 0.930 [IC 95 % bootstrap : 0.870 – 0.970]**

Mesuré sur 401 entités individuellement vérifiées (20 défaillances avérées), avec un bootstrap
déterministe (graine 20260712). Rejouable par un tiers :

```bash
npx tsx scripts/validate-cohorte-n442.ts   # redonne exactement les chiffres ci-dessous
```

| Élément | Valeur |
|---------|--------|
| Cohorte auditée | **442** entités (484 initiales − 42 non vérifiables) |
| Périmètre d'évaluation | **401** (les 41 non auditées sont exclues des calculs) |
| Issues | 336 actives · **45 acquises** · **20 défaillances** |
| **AUC (défaillance)** | **0.930** [IC 95 % : 0.870 – 0.970] |
| EPV (événements / dimensions) | **2.9** — seuil institutionnel ≥ 10 |
| Statut statistique | **Exploratoire** — non confirmatoire |

**Taux de défaillance observé par zone :**

| Zone | Plage | n | Défaillances | Taux |
|------|-------|---|--------------|------|
| Excellent | 80–100 | 25 | 0 | **0 %** |
| Solide | 65–79 | 112 | 0 | **0 %** |
| Vigilance | 46–64 | 191 | 3 | 1.6 % |
| Risque élevé | 0–45 | 48 | 16 | **33.3 %** |

**Robustesse géographique :** France (n = 224, 15 défaillances) → AUC **0.938**. Les périmètres US et EU
comptent trop peu d'événements (2 et 3) pour publier une AUC.

### Deux mises en garde qui engagent la lecture des chiffres

**1. L'exactitude ne doit pas être citée — et nous ne la citons pas.**
Le taux de défaillance est de 5 %. Un classifieur trivial prédisant « survit » pour tout le monde
atteindrait **95 % d'exactitude**. Toute annonce d'exactitude « élevée » est donc dénuée de sens sur
ces données. C'est l'**AUC** qui mesure la discrimination, et c'est la seule métrique que nous publions.

> *Correctif d'audit SCI-B (13/07/2026).* Les versions antérieures annonçaient une exactitude de
> **98,2 %** et un **F1 de 0,9497** « validés sur cohorte 500 ». Ces chiffres n'étaient adossés à
> aucune donnée du dépôt et **ont été retirés**. Ils étaient au demeurant contre-productifs : à peine
> supérieurs au classifieur trivial.

**2. Une acquisition n'est pas une défaillance.**
L'événement d'intérêt est la **défaillance avérée**, et elle seule. La cohorte distingue explicitement
les 45 acquisitions (dont plusieurs sorties réussies) des 20 défaillances.

> *Correctif d'audit SCI-A.* Le modèle antérieur confondait les deux dans un événement binaire —
> il comptait notamment l'acqui-hire d'Inflection AI par Microsoft parmi ses « événements ».
> **L'effet est mesurable** : en confondant acquisition et défaillance, l'AUC chute de **0.930 à 0.680**.
> La définition correcte de l'événement n'est pas un détail de méthode : elle conditionne le signal.

### Ce que ces chiffres justifient — et ce qu'ils ne justifient pas

Ils établissent une **discrimination élevée et stable** (l'IC ne touche pas 1.00) entre entreprises
défaillantes et survivantes, sur une cohorte vérifiée entité par entité. C'est un résultat réel.

Ils **n'établissent pas** de validité prédictive prospective, pour deux raisons qui subsistent :

1. **EPV = 2.9.** Avec 20 défaillances pour 7 dimensions, le modèle reste sur-paramétré au regard du
   standard (EPV ≥ 10). En progrès net (1.8 auparavant), mais insuffisant pour une validation confirmatoire.
2. **Circularité.** Si les scores IRO de cette cohorte ont été attribués en connaissance de l'issue,
   l'AUC mesurée surestime la capacité prédictive réelle. **Seul un scoring en aveugle, horodaté et
   scellé, lèvera cette réserve** — c'est l'objet du passage au TRL 5.

### Statut du modèle de survie (distinct de ce qui précède)

La survie à 36 mois est estimée par un modèle à hasards proportionnels, **calibré de façon exploratoire** :

| Élément | Valeur réelle |
|---------|---------------|
| Cohorte rétrospective **vérifiée** | **n = 101** (68 actives, 33 défaillances) — 100 % adossées à une entité juridique identifiable |
| Séparation actives / défaillances | **20,2 points** (IRO moyen 64,7 vs 44,5) |
| Périmètre de calibration du modèle | **n = 32 cas**, dont **9 événements** |
| Variables du modèle | 5 |
| EPV (événements par variable) | **1.8** — seuil institutionnel ≥ 10 |
| C-index LOO | **0.88** [IC 95% OOB : 0.76 – 1.00] |
| Statut statistique | **Exploratoire — non confirmatoire** |
| Reproductibilité | Bootstrap seedé (`bootstrap_seed: 20260712`) — `npx tsx scripts/calibrate-cox.ts` redonne les chiffres publiés |

### Périmètre de la cohorte — décision d'audit du 13/07/2026

La cohorte publiée compte **101 observations, toutes adossées à une entité juridique identifiable**.

Sept observations initialement présentes ont été **retirées** à l'issue d'un audit scientifique : elles ne correspondaient pas à des sociétés vérifiables au registre du commerce (unités internes de groupes, lignes de produit fermées, entités hypothétiques). Elles appartenaient toutes au groupe « défaillantes » et portaient les scores les plus bas.

| Périmètre | n | Séparation actives / défaillances |
|-----------|---|-----------------------------------|
| Avant audit (non vérifié) | 108 | 23,7 pts |
| **Publié (vérifié)** | **101** | **20,2 pts** |

Le retrait coûte 3,5 points de séparation — **et le signal demeure net**. Il n'a **aucun impact sur la calibration du modèle** : ces observations n'appartenaient pas au périmètre gold-standard (gs-096 → gs-125). Le C-index (0,88) et l'EPV (1,8) sont inchangés.

Le registre des exclusions is conservé dans le code (`OBSERVATIONS_EXCLUES`, `src/data/cohorte-france.ts`) : chaque retrait is documenté avec son motif, afin qu'un auditeur puisse constater ce qui a été écarté, quand et pourquoi.

**Trois limites assumées, à connaître :**

1. **EPV = 1.8.** Avec 9 événements pour 5 variables, le modèle est sur-paramétré au regard des standards de la recherche clinique (règle des 10 EPV). L'intervalle de confiance du C-index atteint 1.00, ce qui traduit l'instabilité de l'estimation et non une performance parfaite.
2. **Circularité du scoring rétrospectif.** Les scores IRO de la cohorte ont été attribués *en connaissance de l'issue* (active/défaillante). La discrimination mesurée est donc, pour partie, mécanique : elle **ne constitue pas une preuve de capacité prédictive prospective**.
3. **Pas de temps jusqu'à événement.** La cohorte ne comporte ni date d'événement ni censure. La courbe de survie est une transformation déterministe du score par un hasard de base constant (`H0_SCALE`), et non une estimation non-paramétrique de la ligne de base (Breslow).

**Ce que ces chiffres justifient — et ce qu'ils ne justifient pas.** Ils établissent qu'un système intégré, fonctionnel et instrumenté produit une séparation exploitable en environnement contrôlé : c'est la définition du TRL 4. Ils **n'établissent pas** de validité prédictive, qui relève du TRL 5+ et exige la validation prospective décrite ci-dessous.

### Statut TRL 4 — technologie validée en environnement représentatif (laboratoire)

Le système est intégré, testé (354 tests) et validé sur cohorte rétrospective en environnement contrôlé. **Aucun pilote en conditions réelles n'est en cours**, et aucune validation longitudinale n'a été acquise à ce jour.

**Chemin vers le TRL 5 — protocole de validation prospective (à conduire) :**
- Scoring **en aveugle de l'issue**, horodaté et scellé (le journal d'audit chaîné y pourvoit) ;
- Cohorte **traçable** : entités identifiées par SIREN, dates d'événement et censure à droite documentées ;
- Effectif cible : **≥ 50 événements** pour atteindre EPV ≥ 10 sur 5 variables ;
- Fenêtre d'observation prospective de 24 à 36 mois, pré-enregistrement du protocole et des hypothèses.

## Reproductibilité

**Calibration du modèle.** Le bootstrap est déterministe (seed publié). Rejouer `npx tsx scripts/calibrate-cox.ts` sur machine vierge redonne strictement les chiffres publiés — vérifiable par un auditeur.

Scores de référence (hash d'audit stables entre versions) :
- ALLinOne : IRO 26.2 (clippé)
- Control+ : IRO 67.1
- IRO Strength : IRO 60.1

## Gouvernance & Conformité (F1–F5)

Le projet intègre un cadre de conformité rigoureux pour garantir l'excellence et la loyauté de l'évaluation :

*   **F1 — Qualification AI Act :** Qualifié comme *Système d'IA à Haut Risque* selon les exigences réglementaires de l'EU AI Act (Règlement 2024/1689). Voir [AI_ACT_QUALIFICATION.md](/docs/AI_ACT_QUALIFICATION.md).
*   **F2 — Charte anti-conflit d'intérêts :** Cadre opérationnel d'évaluation croisée en aveugle et règles de ré-assignation automatique. Voir [ANTI_CONFLIT_INTERETS.md](/docs/ANTI_CONFLIT_INTERETS.md).
*   **F3 — Processus de recours de score :** Intégration du registre de contestations et de l'endpoint dédié de saisine `POST /api/contest` avec un SLA de traitement garanti de 30 jours calendaires.
*   **F4 — Supervision humaine des verdicts extrêmes :** Activation d'un sas de supervision systématique (`evaluateHumanReviewGate`) pour détection des scores IRO-CR ultra-faibles (< 30) et des flags critiques, encadré par le glossaire de terminologie éthique.
*   **F5 — Licence :** Propriétaire BPI en phase pilote de TRL 4, avec une feuille de route claire vers une dual-licensing AGPL-3.0 / Commerciale pour TRL 5+. Voir [LICENSE](/LICENSE).

## Contact

[contact@irostrength.ai]
