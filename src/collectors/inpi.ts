/**
 * src/collectors/inpi.ts
 * IRO Strength v6.6 — Antigravity Intelligence Platform
 *
 * CORRECTIF V2 : Ce fichier était une duplication du contenu de pappers.ts.
 * Il est remplacé par un alias propre vers pappers.ts.
 *
 * Toutes les fonctions INPI (brevets, Bodacc, Sirene) sont implémentées
 * dans src/collectors/pappers.ts qui est la source de vérité unique.
 *
 * Les imports existants restent valides :
 *   import { fetchINPI, mapINPIToIRO, INPIData } from './inpi';
 *   → redirigés vers pappers.ts
 */

// Re-export complet depuis pappers.ts — source de vérité unique
export {
  // Types
  type PappersEntreprise as INPIData,        // compatibilité nommage ancien
  type PappersEntreprise,
  type PappersIROContext,

  // Fonctions principales
  fetchPappersComplete,
  fetchPappersComplete as fetchINPI,         // alias pour pipeline-orchestrator.ts
  mapPappersToFinancialData,
  mapPappersToIROContext,
  mapPappersToIROContext as mapINPIToIRO,   // alias pour pipeline-orchestrator.ts

  // Hook React
  usePappers,
} from './pappers';
