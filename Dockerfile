# ─────────────────────────────────────────────────────────────────────────────
# IRO Strength Velocity — image de déploiement (Hugging Face Spaces, SDK Docker)
#
# Hugging Face impose :
#   • l'écoute sur le port 7860
#   • un utilisateur non-root (UID 1000)
#   • un système de fichiers en lecture seule hors /tmp et $HOME
# ─────────────────────────────────────────────────────────────────────────────

# ── Étape 1 : build ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /build

# Dépendances natives de better-sqlite3 (journal d'audit)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Installation reproductible depuis le lockfile
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Sources et build (front Vite + serveur esbuild)
COPY . .
RUN npm run build

# Élagage des dépendances de développement
RUN npm prune --omit=dev


# ── Étape 2 : image d'exécution ──────────────────────────────────────────────
FROM node:20-slim AS runtime

# Utilisateur non-root exigé par Hugging Face (UID 1000)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

COPY --chown=user:user --from=builder /build/dist          ./dist
COPY --chown=user:user --from=builder /build/node_modules  ./node_modules
COPY --chown=user:user --from=builder /build/package.json  ./package.json

# Répertoire de données inscriptible (journal d'audit SQLite, recours)
RUN mkdir -p $HOME/app/data

# ── Configuration ────────────────────────────────────────────────────────────
ENV NODE_ENV=production \
    PORT=7860 \
    PUBLIC_DEMO=true

# GEMINI_API_KEY, INTERNAL_API_KEY et ALLOWED_ORIGINS se déclarent dans
# l'onglet « Settings › Variables and secrets » du Space — JAMAIS ici.

EXPOSE 7860

# Sonde de vitalité
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7860/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
