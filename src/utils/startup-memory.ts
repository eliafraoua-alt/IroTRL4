/**
 * src/utils/startup-memory.ts
 * IROSTRENGTH v7.2 — Correctif 3 : Mémoire longitudinale persistante
 *
 * Objectif : charger automatiquement le profil connu d'une startup avant
 * chaque analyse, pour que IROSTRENGTH se souvienne d'une session à l'autre
 * comme le font les agents frontier (GPT-5.2, Gemini avec mémoire native).
 *
 * Infrastructure réutilisée :
 *   - /api/audit (SQLite via AuditJournal) — entrées historiques
 *   - computeIROVelocity() — trajectoire IRO déjà calculée
 *   - startupModel (StartupModel) — state React déjà en place
 *
 * Architecture :
 *   1. loadStartupMemory()     — charge le profil persistant depuis SQLite
 *   2. StartupMemory           — type complet du profil
 *   3. buildMemoryContext()    — construit le contexte LLM enrichi avec l'historique
 *   4. updateStartupMemory()   — met à jour après chaque analyse
 *   5. useStartupMemory()      — hook React qui expose tout ça
 *
 * Intégration dans useIROAnalysis.ts :
 *   Appeler loadStartupMemory(startup) en étape 0 (avant la collecte)
 *   Injecter buildMemoryContext(memory) dans sharedContext
 *   Appeler updateStartupMemory() après le setState final
 *
 * Serveur : ajouter /api/startups/:name/memory dans server.ts
 */

import { useState, useCallback, useEffect } from 'react';
import { computeIROVelocity } from './iro-velocity';
import type { IROVelocity } from '../types/iro';
import type { AuditEntry } from './audit-journal';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StartupMemory {
  startup_name:         string;
  first_seen:           string;    // ISO date première analyse
  last_seen:            string;    // ISO date dernière analyse
  n_analyses:           number;
  // Scores moyens sur toutes les analyses
  avg_scores: {
    DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number;
  };
  // Derniers scores connus
  last_scores: {
    iro_total: number; iro_cr: number; srd: number;
    DI: number; ADC: number; IPC: number; AR: number; CA: number; GCH: number;
  };
  // Trajectoire
  velocity:             IROVelocity | null;
  trend:                'croissant' | 'stable' | 'décroissant' | 'inconnu';
  // Données stables (ne changent pas entre sessions)
  known_vertical?:      string;
  known_siren?:         string;
  known_funding_stage?: string;
  known_team_size?:     number;
  known_arr_eur?:       number;
  // Flags persistants
  goodhart_ever_triggered: boolean;
  red_flags_historical:    string[];
  // Contexte mémo pour le LLM (résumé des analyses précédentes)
  llm_context_summary:  string;
}

export interface MemoryLoadResult {
  memory:    StartupMemory | null;
  found:     boolean;
  entries:   AuditEntry[];
}

// ── Step 1 : Chargement depuis SQLite ──────────────────────────────────────────

export async function loadStartupMemory(
  startupName: string,
): Promise<MemoryLoadResult> {
  if (!startupName.trim()) return { memory: null, found: false, entries: [] };

  try {
    // Récupérer toutes les entrées audit pour cette startup
    const res = await fetch(`/api/audit?startup=${encodeURIComponent(startupName)}&limit=50`);
    if (!res.ok) return { memory: null, found: false, entries: [] };

    let entries: AuditEntry[] = await res.json();

    // Filtrer par nom (insensible à la casse)
    entries = entries
      .filter(e => e.startup_name.toLowerCase() === startupName.toLowerCase())
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (entries.length === 0) return { memory: null, found: false, entries: [] };

    const last = entries[entries.length - 1];
    const first = entries[0];

    // Moyennes sur toutes les analyses
    const avg = (key: keyof AuditEntry) =>
      Math.round(entries.reduce((s, e) => s + (Number(e[key]) || 0), 0) / entries.length * 10) / 10;

    // Vélocité longitudinale
    const velocity = computeIROVelocity(entries);

    // Trend
    let trend: StartupMemory['trend'] = 'inconnu';
    if (velocity) {
      if (velocity.velocity_global > 0.3)       trend = 'croissant';
      else if (velocity.velocity_global < -0.3)  trend = 'décroissant';
      else                                        trend = 'stable';
    }

    // Flags historiques
    const goodhart_ever = entries.some(e => e.goodhart_patterns && e.goodhart_patterns !== '[]');
    const red_flags = entries
      .filter(e => e.iro_total < 40)
      .map(e => `IRO=${e.iro_total} (${e.timestamp.split('T')[0]})`);

    // Résumé LLM
    const trendStr = trend === 'croissant' ? '📈 en progression' : trend === 'décroissant' ? '📉 en déclin' : '→ stable';
    const llm_summary = [
      `Startup connue : ${entries.length} analyse(s) entre ${first.timestamp.split('T')[0]} et ${last.timestamp.split('T')[0]}.`,
      `IRO actuel : ${last.iro_total}/100 (vs ${Math.round(avg('iro_total'))}/100 en moyenne). Tendance : ${trendStr}.`,
      velocity ? `Vélocité IRO : ${velocity.velocity_global > 0 ? '+' : ''}${velocity.velocity_global.toFixed(2)} pts/mois.` : '',
      goodhart_ever ? '⚠ Profil Goodhart détecté dans une analyse précédente.' : '',
      last.notes ? `Notes : ${last.notes.substring(0, 150)}` : '',
    ].filter(Boolean).join(' ');

    const memory: StartupMemory = {
      startup_name:      startupName,
      first_seen:        first.timestamp,
      last_seen:         last.timestamp,
      n_analyses:        entries.length,
      avg_scores: {
        DI:  Math.round(avg('DI')),
        ADC: Math.round(avg('ADC')),
        IPC: Math.round(avg('IPC')),
        AR:  Math.round(avg('AR')),
        CA:  Math.round(avg('CA')),
        GCH: Math.round(avg('GCH')),
      },
      last_scores: {
        iro_total: last.iro_total,
        iro_cr:    last.iro_cr ?? 0,
        srd:       Number(last.srd) || 0,
        DI:        Number(last.DI) || 2,
        ADC:       Number(last.ADC) || 2,
        IPC:       Number(last.IPC) || 2,
        AR:        Number(last.AR) || 2,
        CA:        Number(last.CA) || 2,
        GCH:       Number(last.GCH) || 2,
      },
      velocity,
      trend,
      known_vertical:      (last as any).vertical ?? undefined,
      known_siren:         undefined,  // enrichissable via Pappers
      known_funding_stage: undefined,
      goodhart_ever_triggered: goodhart_ever,
      red_flags_historical: red_flags,
      llm_context_summary: llm_summary,
    };

    return { memory, found: true, entries };
  } catch (e) {
    return { memory: null, found: false, entries: [] };
  }
}

// ── Step 2 : Contexte LLM enrichi avec l'historique ──────────────────────────

export function buildMemoryContext(memory: StartupMemory | null): string {
  if (!memory || memory.n_analyses === 0) return '';

  const lines = [
    '── MÉMOIRE LONGITUDINALE (analyses précédentes) ──────────────────',
    memory.llm_context_summary,
  ];

  if (memory.n_analyses >= 2) {
    lines.push(`Scores moyens historiques : DI=${memory.avg_scores.DI} ADC=${memory.avg_scores.ADC} IPC=${memory.avg_scores.IPC} AR=${memory.avg_scores.AR} CA=${memory.avg_scores.CA} GCH=${memory.avg_scores.GCH}`);
    lines.push(`Derniers scores connus : DI=${memory.last_scores.DI} ADC=${memory.last_scores.ADC} IPC=${memory.last_scores.IPC} AR=${memory.last_scores.AR} CA=${memory.last_scores.CA} GCH=${memory.last_scores.GCH}`);
  }

  if (memory.goodhart_ever_triggered) {
    lines.push('⚠ ALERTE : profil Goodhart détecté dans une analyse précédente — soyez vigilant sur les scores extrêmes.');
  }

  if (memory.velocity) {
    const v = memory.velocity;
    lines.push(`Vélocité IRO : ${v.velocity_global > 0 ? '+' : ''}${v.velocity_global.toFixed(2)} pts/mois sur ${v.snapshots.length} mesures (${v.trend}).`);
  }

  lines.push('INSTRUCTION : utilise ces données historiques comme contexte de calibration. Si les nouveaux scores s\'écartent fortement des scores historiques, justifie l\'écart explicitement dans ton analyse.');
  lines.push('──────────────────────────────────────────────────────────────────');

  return lines.join('\n');
}

// ── Step 3 : Mise à jour après chaque analyse ────────────────────────────────

export async function updateStartupMemory(
  startupName: string,
  newScores: { DI:number; ADC:number; IPC:number; AR:number; CA:number; GCH:number },
  iro_total: number,
  iro_cr: number,
  notes?: string,
): Promise<void> {
  // L'AuditJournal est déjà mis à jour dans useIROAnalysis — rien de plus à faire.
  // Cette fonction est un hook pour des enrichissements futurs (ex: push vers API externe).
  // Le rechargement de la mémoire au prochain appel lit automatiquement SQLite.
  return Promise.resolve();
}

// ── Hook React ─────────────────────────────────────────────────────────────────

export interface StartupMemoryState {
  memory:         StartupMemory | null;
  loading:        boolean;
  found:          boolean;
  memoryContext:  string;
}

export function useStartupMemory(startupName: string): StartupMemoryState {
  const [state, setState] = useState<StartupMemoryState>({
    memory: null, loading: false, found: false, memoryContext: '',
  });

  useEffect(() => {
    if (!startupName.trim()) {
      setState({ memory: null, loading: false, found: false, memoryContext: '' });
      return;
    }

    let cancelled = false;
    setState(s => ({ ...s, loading: true }));

    loadStartupMemory(startupName).then(({ memory, found }) => {
      if (cancelled) return;
      setState({
        memory,
        loading: false,
        found,
        memoryContext: buildMemoryContext(memory),
      });
    }).catch(() => {
      if (!cancelled) setState({ memory: null, loading: false, found: false, memoryContext: '' });
    });

    return () => { cancelled = true; };
  }, [startupName]);

  return state;
}

// ── Composant MemoryBadge pour l'UI ───────────────────────────────────────────

export interface MemoryBadgeProps {
  memory: StartupMemory | null;
  loading: boolean;
}

/** Badge à afficher dans le header résultats quand la mémoire est disponible */
export function formatMemoryBadge(memory: StartupMemory | null, loading: boolean): string {
  if (loading) return '⏳ Chargement mémoire…';
  if (!memory) return '';
  const icon = memory.trend === 'croissant' ? '📈' : memory.trend === 'décroissant' ? '📉' : '→';
  return `${icon} ${memory.n_analyses} analyse(s) · IRO ${memory.last_scores.iro_total}/100 · ${memory.last_seen.split('T')[0]}`;
}
