# CORRECTIFS DE PRODUCTION — à appliquer avant tout déploiement

Votre dépôt GitHub actuel **ne contient pas** ces deux correctifs. Sans eux, le serveur
**crashe au démarrage** sur toute plateforme (Hugging Face, Antigravity, Cloud Run, VPS).

L'application fonctionne en `npm run dev` (mode ESM via tsx) mais pas en production
(bundle CJS) — c'est pourquoi le bug est passé inaperçu.

---

## Ce que contient cette archive

| Fichier | Rôle | Criticité |
|---------|------|-----------|
| `src/database.ts` | **PROD-01** — le serveur ne démarrait pas | 🔴 Bloquant |
| `server/routes/index.ts` | **PROD-02** — `/api/health` + garde-fou démo | 🔴 Bloquant |
| `Dockerfile` | Image de déploiement (port 7860, non-root) | 🟠 Requis pour HF |
| `.dockerignore` | Exclut `node_modules`, `.env`, `*.db` de l'image | 🟠 Requis |
| `README.md` | En-tête YAML exigé par Hugging Face | 🟠 Requis pour HF |
| `DEPLOIEMENT.md` | Notice de déploiement + règles de communication | 🟡 Documentation |
| `package-lock.json` | Lockfile synchronisé (vitest 3.2.6) | 🟠 Sinon `npm ci` échoue |

---

## Application (PowerShell)

Depuis le dossier de votre projet :

```powershell
# 1. Copier les fichiers de cette archive par-dessus le projet
#    (elle respecte l'arborescence : src\, server\routes\, racine)

# 2. Vérifier que les correctifs sont bien là
Select-String -Path src\database.ts -Pattern "nodeRequire"
Select-String -Path server\routes\index.ts -Pattern "PUBLIC_DEMO"
#    Les DEUX doivent renvoyer des résultats.

# 3. Nettoyer __pycache__ (artefacts Python versionnés par erreur)
git rm -r --cached __pycache__
Add-Content .gitignore "`n__pycache__/`n*.pyc"

# 4. Vérifier localement AVANT de pousser
npm ci
npm run build
node dist/server.cjs
#    → doit afficher « Antigravity Intelligence Platform - Modular Server Active »
#    → si ça crashe avec ERR_INVALID_ARG_VALUE, le correctif PROD-01 n'est pas appliqué
#    (Ctrl+C pour arrêter)

# 5. Pousser
git add -A
git commit -m "fix(prod): correctifs de démarrage serveur (PROD-01, PROD-02) + déploiement Docker"
git push
```

---

## Détail des deux bugs

### PROD-01 — Le serveur de production ne démarrait pas

`src/database.ts` appelait `createRequire(import.meta.url)`. Ce code fonctionne en ESM
(mode dev via `tsx`), mais le build de production est bundlé en **CJS** par esbuild
(`--format=cjs`). Dans ce contexte, esbuild remplace `import.meta` par `{}` :
`import.meta.url` vaut donc `undefined`, et `createRequire` lève une
`ERR_INVALID_ARG_VALUE` **au chargement du module** — le processus meurt avant même
d'écouter sur son port.

**Symptôme** : `npm run build` réussit, puis `npm start` plante instantanément.

### PROD-02 — Sonde de vitalité et protection de la clé LLM

Deux problèmes dans `server/routes/index.ts` :

1. **`/api/health` renvoyait 503** dès que `GEMINI_API_KEY` était absente. Or les
   plateformes d'hébergement utilisent cette route pour décider si le conteneur est
   vivant : un 503 permanent le fait redémarrer en boucle, puis marquer en échec.

2. **Aucune protection de la clé LLM sur un déploiement public.** Le front appelle
   `/api/llm` sans clé d'API. Sur une instance exposée à Internet, n'importe quel
   visiteur pouvait consommer votre quota Gemini — à vos frais.

Le correctif introduit `PUBLIC_DEMO=true` (activé par défaut dans le Dockerfile) :
les routes coûteuses (`/llm`, `/pappers`) renvoient un 503 explicatif, tandis que
l'interface, la cohorte n=442, les métriques et le journal d'audit restent consultables.
C'est exactement ce qu'un évaluateur (Bpifrance, investisseur) a besoin de voir.

---

## Vérifications post-déploiement

```
GET  /api/health   → 200   { "mode": "demo_public" }
GET  /             → 200   (interface)
POST /api/llm      → 503   (garde-fou actif)
```

Si `/api/health` renvoie 503, le correctif PROD-02 n'est pas appliqué.
Si rien ne répond, c'est PROD-01.
