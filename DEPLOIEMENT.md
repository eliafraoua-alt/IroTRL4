# Déploiement — IRO Strength Velocity v7.0.0

Paquet vérifié le 13/07/2026. Toute la chaîne ci-dessous a été exécutée avec succès
sur une installation vierge avant livraison.

---

## 1. Installation

```bash
npm ci                    # installation reproductible depuis le lockfile
```

> ⚠️ **Important — lockfile.** Le fichier `package-lock.json` de ce paquet est
> **synchronisé** avec `package.json` (vitest 3.2.6). Les versions exportées depuis
> Google AI Studio embarquaient un lockfile obsolète (vitest 2.1.9), ce qui faisait
> échouer `npm ci` et cassait la CI. **Ne pas écraser ce fichier** par un export AI Studio.
> Il doit être versionné dans Git.

## 2. Configuration

```bash
cp .env.example .env
```

Variables de sécurité à renseigner **avant toute mise en production** :

| Variable | Rôle |
|----------|------|
| `GEMINI_API_KEY` | Clé du fournisseur LLM (serveur uniquement, jamais côté client) |
| `INTERNAL_API_KEY` | Protège **toutes** les routes `/api` sensibles (sauf `/health`, `/metrics`) |
| `ALLOWED_ORIGINS` | **Obligatoire en production** — CORS *fail-closed* si vide |
| `EMBED_ANCESTORS` | Origines autorisées à embarquer l'app en iframe (défaut : `'self'`) |
| `ALLOW_MOCK_FALLBACK` | **Laisser vide.** `true` active des réponses LLM *simulées* — dev/démo uniquement, jamais en production |

## 3. Chaîne de vérification

À exécuter par tout auditeur (Bpifrance, due diligence). Résultats attendus :

```bash
npm run lint     # → compilation TypeScript stricte, aucune erreur
npm test         # → 354 tests passants (1 ignoré)
npm run build    # → dist/server.cjs
npm audit        # → 1 vulnérabilité faible, 0 critique
```

## 4. Reproduction de la preuve scientifique

```bash
npx tsx scripts/validate-cohorte-n442.ts
```

Sortie attendue — **strictement déterministe** (bootstrap seedé, graine `20260712`) :

```
Périmètre d'analyse (vérifié) : n = 401
AUC Événement Correct (Défaillance strict)        : 0.930
AUC Événement Erroné (Défaillance + Acquisition)  : 0.680

Risque élevé (0-45)  : n =  48, défaillances = 16, taux = 33.3%
Vigilance    (46-64) : n = 191, défaillances =  3, taux =  1.6%
Solide       (65-79) : n = 112, défaillances =  0, taux =  0.0%
Excellent    (80-100): n =  25, défaillances =  0, taux =  0.0%
```

## 5. Lancement

```bash
npm run dev      # développement (port 3000)
npm start        # production (après npm run build)
```

---

## Statut du projet — à lire avant toute communication externe

**TRL 4** — technologie validée en environnement contrôlé.

| Élément | Valeur établie |
|---------|----------------|
| Cohorte auditée | n = 442 (484 initiales − 42 non vérifiables) |
| Périmètre d'évaluation | n = 401 (les 41 non auditées sont exclues) |
| Issues | 336 actives · **45 acquises** · **20 défaillances** |
| **AUC (défaillance)** | **0.930** [IC 95 % : 0.870 – 0.970] |
| EPV | 2.9 — seuil institutionnel ≥ 10 |
| Statut statistique | **Exploratoire — non confirmatoire** |

### Trois règles de communication

1. **Ne jamais citer l'exactitude.** Le taux de défaillance est de 5 % : un classifieur
   trivial prédisant « survit » pour tous atteindrait 95 %. L'exactitude est
   ininterprétable ici. **La métrique de référence est l'AUC.**

2. **Une acquisition n'est pas une défaillance.** L'événement d'intérêt est la
   défaillance avérée, et elle seule. Confondre les deux fait chuter l'AUC de
   0.930 à 0.680 (contre-épreuve exécutable ci-dessus).

3. **Ne pas revendiquer de validation prédictive.** Deux réserves subsistent et sont
   documentées : EPV insuffisant (2.9 < 10) et circularité potentielle du scoring
   rétrospectif. La validation est **exploratoire**. C'est cohérent avec un TRL 4.

### Chemin vers le TRL 5

- Scoring **en aveugle** de l'issue, horodaté et scellé dans le journal d'audit chaîné (SHA-256, déjà opérationnel) ;
- Collecte de **≥ 70 défaillances** documentées (BODACC, procédures collectives) pour atteindre EPV ≥ 10 ;
- Fenêtre d'observation prospective de 24 à 36 mois ;
- Pré-enregistrement du protocole avant relevé des issues.

---

## Chiffres retirés — ne pas réintroduire

Les valeurs suivantes figuraient dans les versions antérieures et **ont été retirées**
car elles n'étaient adossées à aucune donnée du dépôt (audit SCI-B). Elles subsistent
peut-être dans d'anciens supports (slides, pitch, dossier) : **les purger.**

| Chiffre retiré | Réalité |
|----------------|---------|
| « Exactitude 98,2 % » | Non reproductible ; inférieure en substance au classifieur trivial (95 %) |
| « F1 = 0,9497 » | Non reproductible (impliquerait 93 défaillances ; il y en a 20) |
| « Cohorte 500 » | N'existe pas. Cohorte réelle : 442 auditées, 401 vérifiées |
| « C-index LOO 0,90 » | 0,884 sur 9 événements (EPV 1,8), IC dégénéré [0,76–1,00] |
| « n = 125 » | Gold standard : 125 entrées, dont 32 avec issue et 9 événements |
| « Pilote actif » | Aucun pilote en conditions réelles (relève du TRL 6-7) |
| « Validation longitudinale acquise » | Aucune (relève du TRL 5+) |
| AUC sectorielles de 1,00 | Calculées sur n = 3 à 16 — dénuées de signification |

Les notes d'audit correspondantes sont conservées dans les fichiers de configuration
(champs `_audit_sci_b`, `_retire_audit_sci_b`) : un auditeur voit la correction, non un trou.

---

## Traçabilité

- `src/data/cohorte-validation-n442.ts` — cohorte auditée, registre des exclusions
- `src/config/validation-n442.json` — métriques recalculées, reproductibles
- `scripts/validate-cohorte-n442.ts` — script de reproduction (seed publié)
- `src/data/cohorte-france.ts` — `OBSERVATIONS_EXCLUES` : 7 entités retirées, avec motifs
