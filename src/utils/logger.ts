import pino from 'pino';

/**
 * Chemins à expurger des logs en production.
 * Les informations personnelles de dirigeants (RGPD) ou le contenu confidentiel
 * de pitch decks doivent être proscrits des logs clairs.
 * Politique de rétention : 30 jours (alignée RGPD, enregistrée au registre Art. 30).
 */
const REDACTED_PATHS = [
  // Contenu LLM — peut contenir des extraits de pitch deck
  'rawResponse',
  'llmResponse',
  'raw_response',
  '*.rawResponse',
  '*.raw_response',

  // Prompts — contiennent le texte du pitch deck injecté
  'prompt',
  '*.prompt',
  'body.prompt',

  // Contenu textuel des réponses API (Anthropic, Gemini, Mistral)
  'content[*].text',
  'candidates[*].content.parts[*].text',
  'choices[*].message.content',

  // Données personnelles dans les requêtes
  'body.pitchDeckContent',
  'body.rawText',
  'body.founderProfile',
  'req.body.pitchDeckContent',

  // Headers d'authentification
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers["x-gemini-key"]',
];

const baseLogger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Politique de rétention : 30 jours (alignée RGPD, à configurer côté infra)
  // Documenter dans le registre RGPD Art. 30.
  redact: {
    paths:  REDACTED_PATHS,
    censor: '[REDACTED-RGPD]',
  },
});

export const logger = {
  debug: (message: string, ctx?: Record<string, unknown>) => {
    if (ctx) baseLogger.debug(ctx, message);
    else     baseLogger.debug(message);
  },
  info: (message: string, ctx?: Record<string, unknown>) => {
    if (ctx) baseLogger.info(ctx, message);
    else     baseLogger.info(message);
  },
  warn: (message: string, ctx?: Record<string, unknown>) => {
    if (ctx) baseLogger.warn(ctx, message);
    else     baseLogger.warn(message);
  },
  error: (message: string, ctx?: Record<string, unknown>) => {
    if (ctx) baseLogger.error(ctx, message);
    else     baseLogger.error(message);
  },
} as const;
