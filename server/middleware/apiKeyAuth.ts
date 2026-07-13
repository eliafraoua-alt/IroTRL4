// server/middleware/apiKeyAuth.ts
// Middleware d'authentification par API Key.
// Activé uniquement si INTERNAL_API_KEY est défini dans .env.
// Si la variable est absente, le middleware laisse passer (mode dev / AI Studio).

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../src/utils/logger';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.INTERNAL_API_KEY;

  // Si pas de clé configurée → mode développement / AI Studio, on laisse passer
  if (!expectedKey) {
    next();
    return;
  }

  const providedKey =
    (req.headers['x-api-key'] as string) ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

  if (!providedKey || providedKey !== expectedKey) {
    logger.warn(`[apiKeyAuth] Accès refusé : clé invalide depuis ${req.ip} — ${req.method} ${req.path}`);
    res.status(401).json({
      error: 'Accès non autorisé — clé API requise (header X-Api-Key ou Authorization: Bearer <key>)',
    });
    return;
  }

  next();
}
