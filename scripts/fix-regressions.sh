#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fix-regressions.sh — IRO Strength Velocity
# Applique les 2 correctifs qui régressent à chaque merge.
# Usage : bash scripts/fix-regressions.sh
#         (ou automatiquement via hook post-merge)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=0

green() { printf '\033[32m✅ %s\033[0m\n' "$*"; }
red()   { printf '\033[31m❌ %s\033[0m\n' "$*"; }
info()  { printf '\033[36mℹ  %s\033[0m\n' "$*"; }

# ── CORRECTIF 1 : llm-router.ts — typo gemini-3-1-flash-lite ─────────────────
FILE1="$ROOT/src/utils/llm-router.ts"
BAD1="const fallbackModel = 'gemini-3-1-flash-lite';"
GOOD1="const fallbackModel = 'gemini-3.1-flash-lite';"

if grep -qF "$BAD1" "$FILE1" 2>/dev/null; then
  sed -i "s|$BAD1|$GOOD1|g" "$FILE1"
  green "llm-router.ts : fallbackModel 'gemini-3-1' → 'gemini-3.1'"
elif grep -qF "$GOOD1" "$FILE1" 2>/dev/null; then
  info "llm-router.ts : déjà correct"
else
  red "llm-router.ts : pattern non trouvé — vérifier manuellement"
  ERRORS=$((ERRORS+1))
fi

# ── CORRECTIF 2 : iro-engine.ts — 3 as any inutiles ─────────────────────────
FILE2="$ROOT/src/utils/iro-engine.ts"

# 2a. applyDimensionCaps (couvre les deux formes avec ou sans parenthèses externes)
GOOD2A="applyDimensionCaps(scores, flagsV45)"
if grep -qF "applyDimensionCaps(scores as any" "$FILE2" 2>/dev/null; then
  # Forme 1 : avec parenthèses  → flagsV45 ? (applyDimensionCaps(...) as any) : scores
  sed -i "s|flagsV45 ? (applyDimensionCaps(scores as any, flagsV45 as any) as any) : scores|flagsV45 ? $GOOD2A : scores|g" "$FILE2"
  # Forme 2 : sans parenthèses → flagsV45 ? applyDimensionCaps(...) as any : scores
  sed -i "s|flagsV45 ? applyDimensionCaps(scores as any, flagsV45 as any) as any : scores|flagsV45 ? $GOOD2A : scores|g" "$FILE2"
  green "iro-engine.ts : applyDimensionCaps — as any supprimés"
elif grep -qF "$GOOD2A" "$FILE2" 2>/dev/null; then
  info "iro-engine.ts : applyDimensionCaps déjà correct"
else
  red "iro-engine.ts : pattern applyDimensionCaps non trouvé"
  ERRORS=$((ERRORS+1))
fi

# 2b. applyFlagPenalties
BAD2B="applyFlagPenalties(s, flagsV45 as any, effectiveScores as any)"
GOOD2B="applyFlagPenalties(s, flagsV45, effectiveScores)"
if grep -qF "$BAD2B" "$FILE2" 2>/dev/null; then
  sed -i "s|$BAD2B|$GOOD2B|g" "$FILE2"
  green "iro-engine.ts : applyFlagPenalties — as any supprimés"
elif grep -qF "$GOOD2B" "$FILE2" 2>/dev/null; then
  info "iro-engine.ts : applyFlagPenalties déjà correct"
else
  red "iro-engine.ts : pattern applyFlagPenalties non trouvé"
  ERRORS=$((ERRORS+1))
fi

# 2c. calcIRO g.scores
BAD2C="calcIRO(g.scores as any,"
GOOD2C="calcIRO(g.scores,"
if grep -qF "$BAD2C" "$FILE2" 2>/dev/null; then
  sed -i "s|$BAD2C|$GOOD2C|g" "$FILE2"
  green "iro-engine.ts : calcIRO g.scores — as any supprimé"
elif grep -qF "$GOOD2C" "$FILE2" 2>/dev/null; then
  info "iro-engine.ts : calcIRO g.scores déjà correct"
else
  red "iro-engine.ts : pattern calcIRO g.scores non trouvé"
  ERRORS=$((ERRORS+1))
fi

# ── RÉSULTAT ──────────────────────────────────────────────────────────────────
echo ""
if [ "$ERRORS" -eq 0 ]; then
  printf '\033[32m✔ Tous les correctifs sont en place.\033[0m\n'
else
  printf '\033[31m✘ %d correctif(s) à vérifier manuellement.\033[0m\n' "$ERRORS"
  exit 1
fi
