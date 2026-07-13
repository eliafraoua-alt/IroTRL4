/**
 * src/collectors/founder-enrichment-ui.ts
 * IRO Strength v6.6.2 — CORRECTIF ARCH-01 (nouveau fichier)
 *
 * Hooks React uniquement — isolés de la logique métier.
 * La logique pure (computeGCHFromProfiles, enrichFounderProfile)
 * reste dans founder-enrichment.ts sans aucun import React.
 *
 * Usage dans les composants React :
 *   import { useFounderEnrichment } from '../collectors/founder-enrichment-ui';
 */

import { useState, useCallback, useEffect } from 'react';
import {
  type FounderProfile,
  type GCHAnalysis,
  createEmptyFounder,
  computeGCHFromProfiles,
  enrichFounderProfile,
} from './founder-enrichment';

// ── Hook principal ────────────────────────────────────────────────────────────

export interface UseFounderEnrichmentReturn {
  founders:      FounderProfile[];
  loading:       boolean;
  enrichingId:   string | null;
  gchAnalysis:   GCHAnalysis;
  addFounder:    (data?: Partial<FounderProfile>) => void;
  removeFounder: (id: string) => void;
  updateFounder: (id: string, patch: Partial<FounderProfile>) => void;
  enrichOne:     (id: string, startupName: string) => Promise<void>;
  enrichAll:     (startupName: string) => Promise<void>;
  reset:         () => void;
}

export function useFounderEnrichment(
  initialFounders: FounderProfile[] = [],
  onAnalysisComputed?: (analysis: GCHAnalysis) => void,
): UseFounderEnrichmentReturn {
  const [founders,    setFounders]    = useState<FounderProfile[]>(initialFounders);
  const [loading,     setLoading]     = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  const gchAnalysis = computeGCHFromProfiles(founders);

  // Notifier le parent à chaque changement d'analyse
  useEffect(() => {
    onAnalysisComputed?.(gchAnalysis);
  }, [JSON.stringify(gchAnalysis)]);

  const addFounder = useCallback((data: Partial<FounderProfile> = {}) => {
    setFounders(prev => [...prev, createEmptyFounder(data)]);
  }, []);

  const removeFounder = useCallback((id: string) => {
    setFounders(prev => prev.filter(f => f.id !== id));
  }, []);

  const updateFounder = useCallback((id: string, patch: Partial<FounderProfile>) => {
    setFounders(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const enrichOne = useCallback(async (id: string, startupName: string) => {
    const founder = founders.find(f => f.id === id);
    if (!founder) return;

    setEnrichingId(id);
    try {
      const enriched = await enrichFounderProfile(founder, startupName);
      setFounders(prev => prev.map(f => f.id === id ? enriched : f));
    } finally {
      setEnrichingId(null);
    }
  }, [founders]);

  const enrichAll = useCallback(async (startupName: string) => {
    setLoading(true);
    try {
      const results = await Promise.all(
        founders.map(f => enrichFounderProfile(f, startupName))
      );
      setFounders(results);
    } finally {
      setLoading(false);
    }
  }, [founders]);

  const reset = useCallback(() => {
    setFounders(initialFounders);
  }, [initialFounders]);

  return {
    founders,
    loading,
    enrichingId,
    gchAnalysis,
    addFounder,
    removeFounder,
    updateFounder,
    enrichOne,
    enrichAll,
    reset,
  };
}
