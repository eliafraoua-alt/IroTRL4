/**
 * Server — Antigravity Intelligence Platform
 * Express + Vite middleware with modular Routing
 */

import 'dotenv/config';
import express      from 'express';
import helmet       from 'helmet';
import cors         from 'cors';
import rateLimit    from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs   from 'fs';

import { logger }   from './src/utils/logger';
import { ensureDbInitialized } from './server/db';
import apiRouter    from './server/routes/index';

function validateEnvironment() {
  const secrets = ['GEMINI_API_KEY', 'PAPPERS_API_KEY'];
  const missing = secrets.filter(secret => !process.env[secret]);
  if (missing.length > 0) {
    console.warn(`⚠️ ALERTE ENVIRONNEMENT : Certaines variables ne sont pas encore configurées : ${missing.join(', ')}`);
    console.warn(`L'application démarre tout de même pour permettre l'accès à l'interface graphique.`);
  }
}

async function startServer() {
  validateEnvironment();
  await ensureDbInitialized();
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Configuration pour les proxys (Cloud Run / Nginx dans AI Studio)
  app.set('trust proxy', 1);

  // ── SÉCURITÉ HTTP ─────────────────────────────────────────────────────────
  // CORRECTION : helmet() ajoute CSP, X-Frame-Options, X-Content-Type-Options, etc.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", "'unsafe-inline'"],  // requis pour Vite HMR en dev
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://generativelanguage.googleapis.com',
                               'https://api.anthropic.com',
                               'https://api.mistral.ai'],
        // CORRECTIF AUDIT SEC-08 : frame-ancestors "*" exposait l'application au
        // clickjacking. Par défaut 'self' et les domaines Google AI Studio (requis pour l'embedding) ;
        // les ancêtres additionnels se déclarent via EMBED_ANCESTORS=...
        frameAncestors: [
          "'self'",
          "https://aistudio.google.com",
          "https://*.google.com",
          "https://*.googleusercontent.com",
          ...(process.env.EMBED_ANCESTORS || '').split(',').filter(Boolean)
        ],
      },
    },
    crossOriginEmbedderPolicy: false,  // désactivé pour compatibilité Vite dev
    frameguard: false,                 // X-Frame-Options remplacé par frame-ancestors (CSP, plus précis)
  }));

  // CORRECTION : CORS explicite — seules les origines autorisées acceptées
  // Configurer ALLOWED_ORIGINS dans .env (ex: https://app.example.com,https://staging.example.com)
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';
  // CORRECTIF AUDIT SEC-07 : en production, une liste ALLOWED_ORIGINS vide ne doit
  // plus signifier "toutes origines acceptées avec credentials" (fail-open) mais
  // "aucune origine cross-site acceptée" (fail-closed). En dev, comportement permissif conservé.
  if (isProduction && allowedOrigins.length === 0) {
    console.warn('⚠️ CORS : ALLOWED_ORIGINS non configuré en production — les requêtes cross-origin seront refusées.');
  }
  app.use(cors({
    origin: (origin, callback) => {
      // Autoriser les requêtes sans origin (serveur-à-serveur, Postman, tests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProduction && allowedOrigins.length === 0) return callback(null, true);
      callback(new Error(`CORS: origine non autorisée — ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }));

  // ── RATE LIMITING ──────────────────────────────────────────────
  const apiLimiter = rateLimit({
    windowMs: 60_000, 
    max: 120,
    standardHeaders: true, 
    legacyHeaders: false,
  });

  app.use('/api/', apiLimiter);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── REGISTER MODULAR API ROUTES ───────────────────────────────────
  app.use('/api', apiRouter);

  // ── Catch-all API 404 ───────────────────────────────────────────────
  app.all('/api/*', (req, res) => {
    logger.error(`[API] 404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({ 
      error: 'Route API non trouvée', 
      path: req.url,
      method: req.method,
      suggestion: 'Utilisez /api/llm pour les appels LLM.'
    });
  });

  // ── Vite middleware ────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use((req, res, next) => {
      // Éviter absolument que Vite ne capture les appels API même si l'URL est mal formée
      if (req.originalUrl.startsWith('/api') || req.url.startsWith('/api') || req.originalUrl.includes('/api') || req.url.includes('/api')) return next();
      return vite.middlewares(req, res, next);
    });
    app.use(async (req, res, next) => {
      if (req.originalUrl.startsWith('/api') || req.url.startsWith('/api') || req.originalUrl.includes('/api') || req.url.includes('/api')) return next();
      try {
        const html = await vite.transformIndexHtml(req.originalUrl,
          '<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>IROSTRENGTH VELOCITY</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'
        );
        res.status(200).set({ 'Content-Type': 'text/html' }).send(html);
      } catch (e) { next(e); }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Antigravity Intelligence Platform - Modular Server Active`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`   Gemini key   : ${process.env.GEMINI_API_KEY ? '✅ configuré' : '❌ manquant'}\n`);
  });
}

startServer();
