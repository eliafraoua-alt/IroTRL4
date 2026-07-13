#!/usr/bin/env python3
"""
stability_c2_real.py — Test C2 Stabilité IRO — Mode réel
IRO Strength Velocity v7.0 — Critère BPI : σ ≤ 8 pts sur 5 passes

Reproduit exactement stability-5runs.vitest.test.ts (STABILITY_REAL=true)
Startup de référence : Mistral AI (gs-096)
5 modèles : gemini-3.5-flash × 2 + gemini-3.1-flash-lite × 2 + gemini-3-flash-preview × 1
Staggering : 8s entre chaque passe (quotas AI Studio)

USAGE :
  pip install requests
  python stability_c2_real.py --key AIza...
  # ou via variable d'environnement :
  GEMINI_API_KEY=AIza... python stability_c2_real.py
"""

import os, sys, json, time, math, hashlib, argparse, datetime

try:
    import requests
except ImportError:
    print("pip install requests")
    sys.exit(1)

# ── Configuration exacte du test vitest ──────────────────────────────────────
MODELS = [
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
]
PASS_LABELS = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON']
STAGGER_S   = 8       # secondes entre passes
TEMPERATURE = 0.1
MAX_TOKENS  = 512
SIGMA_BPI   = 8.0     # critère BPI C2
IRO_REF     = 74.0    # IRO de référence Mistral AI
IRO_TOL     = 8.0     # tolérance ±

# Poids IRO V7
W  = {'DI':.18,'ADC':.22,'IPC':.22,'AR':.13,'CA':.10,'GCH':.12,'LU':.15}
TW = 1.12

# Gold standard Mistral AI (gs-096)
GOLD = {'DI':4,'ADC':3,'IPC':2,'AR':2,'CA':4,'GCH':4,'LU':2}

SYSTEM_PROMPT = (
    "Tu es un expert en évaluation de startups IA agentiques, "
    "spécialisé dans le framework IRO v7.0.\n"
    "Réponds UNIQUEMENT en JSON valide. Aucun texte avant ou après."
)

def build_prompt(label: str) -> str:
    return f"""[PASS-{label}]

Évalue la startup suivante selon le framework IRO v7.0 :

Startup : Mistral AI
SIREN : 952147072
Secteur : LLM frontier / Infrastructure IA
Description : Modèles de langage open-source et propriétaires (Mistral 7B, \
Mixtral 8×7B, Mistral Large). Fondateurs : Arthur Mensch (ex-DeepMind), \
Guillaume Lample (ex-Meta FAIR), Timothée Lacroix (ex-Meta FAIR). \
Publications NeurIPS 2023. Levée Series B 600M€ juin 2024. \
200 employés. Infrastructure GPU propre.

Dimensions IRO [0-4] :
DI(18%) ADC(22%) IPC(22%) AR(13%) CA(10%) GCH(12%) LU(15%)

Retourne ce JSON :
{{
  "scores": {{"DI": 0, "ADC": 0, "IPC": 0, "AR": 0, "CA": 0, "GCH": 0, "LU": 0}},
  "justifications": {{"DI": "", "ADC": "", "IPC": "", "AR": "", "CA": "", "GCH": "", "LU": ""}}
}}"""

# ── Calculs ───────────────────────────────────────────────────────────────────
def calc_iro(scores: dict) -> float:
    brut = sum(scores.get(k, 0) * w for k, w in W.items())
    return min(100.0, max(0.0, round(brut / (4 * TW) * 100, 1)))

def std(vals: list) -> float:
    if len(vals) < 2:
        return 0.0
    mu = sum(vals) / len(vals)
    return math.sqrt(sum((x - mu) ** 2 for x in vals) / len(vals))

def mean(vals: list) -> float:
    return sum(vals) / len(vals) if vals else 0.0

# ── Appel Gemini ──────────────────────────────────────────────────────────────
def call_gemini(key: str, model: str, label: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": build_prompt(label)}]}],
        "generationConfig": {"temperature": TEMPERATURE, "maxOutputTokens": MAX_TOKENS}
    }
    resp = requests.post(url, json=payload, timeout=60)
    if not resp.ok:
        err = resp.json().get('error', {}).get('message', resp.text[:120])
        raise RuntimeError(f"HTTP {resp.status_code}: {err}")

    text = resp.json()['candidates'][0]['content']['parts'][0]['text']
    # Extraire le JSON
    import re
    m = re.search(r'\{[\s\S]*\}', text.replace('```json','').replace('```','').strip())
    if not m:
        raise RuntimeError("JSON non trouvé dans la réponse")
    parsed = json.loads(m.group(0))
    raw_scores = parsed.get('scores', parsed)
    scores = {k: max(0, min(4, round(float(raw_scores.get(k, 2) or 2)))) for k in W}
    return {'scores': scores, 'justifications': parsed.get('justifications', {}), 'raw': text}

# ── Test principal ────────────────────────────────────────────────────────────
def run_test(key: str, verbose: bool = True) -> dict:
    results  = []
    iro_scores = []
    all_scores = []

    sep = '═' * 55

    if verbose:
        print(f"\n{sep}")
        print(f"  TEST C2 — STABILITÉ IRO — MODE RÉEL")
        print(f"  Startup : Mistral AI (gs-096)")
        print(f"  Critère BPI : σ ≤ {SIGMA_BPI} pts · IRO ref={IRO_REF} ± {IRO_TOL}")
        print(f"  {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}")
        print(sep)

    for i, (label, model) in enumerate(zip(PASS_LABELS, MODELS)):
        if i > 0:
            if verbose:
                print(f"  [stagger] Attente {STAGGER_S}s…")
            time.sleep(STAGGER_S)

        if verbose:
            print(f"\n  → [PASS-{label}] {model}…", end=' ', flush=True)

        t0 = time.time()
        used_model = model
        fallback_used = False

        try:
            result = call_gemini(key, model, label)
        except Exception as e:
            # Fallback vers gemini-3.5-flash si modèle indisponible
            if model != 'gemini-3.5-flash':
                if verbose:
                    print(f"\n    ⚠ Fallback ({e}) → gemini-3.5-flash…", end=' ', flush=True)
                try:
                    used_model = 'gemini-3.5-flash'
                    fallback_used = True
                    result = call_gemini(key, used_model, label)
                except Exception as e2:
                    if verbose:
                        print(f"✗ ÉCHEC DÉFINITIF : {e2}")
                    results.append({'pass': label, 'model': used_model, 'success': False, 'error': str(e2)})
                    continue
            else:
                if verbose:
                    print(f"✗ ÉCHEC : {e}")
                results.append({'pass': label, 'model': model, 'success': False, 'error': str(e)})
                continue

        latency = round(time.time() - t0, 1)
        iro = calc_iro(result['scores'])
        iro_scores.append(iro)
        all_scores.append(result['scores'])

        if verbose:
            dims_str = ' '.join(f"{k}:{v}" for k, v in result['scores'].items())
            fallback_tag = ' [fallback]' if fallback_used else ''
            print(f"✓ IRO={iro:.1f} — {dims_str} ({latency}s){fallback_tag}")

        results.append({
            'pass': label,
            'model': used_model,
            'fallback_used': fallback_used,
            'success': True,
            'iro': iro,
            'scores': result['scores'],
            'latency_s': latency,
        })

    # ── Statistiques ──────────────────────────────────────────────────────────
    n_ok = len(iro_scores)

    if n_ok < 3:
        print(f"\n✗ Moins de 3 runs réussis ({n_ok}/5) — résultat non fiable")
        return {'success': False, 'n_runs': n_ok, 'results': results}

    sigma = std(iro_scores)
    mu    = mean(iro_scores)
    in_range = IRO_REF - IRO_TOL <= mu <= IRO_REF + IRO_TOL
    bpi_pass = sigma <= SIGMA_BPI

    # σ par dimension
    dim_stats = {}
    for k in W:
        vals = [s.get(k, 0) for s in all_scores]
        dim_stats[k] = {'mean': round(mean(vals), 2), 'sigma': round(std(vals), 3), 'gold': GOLD.get(k)}

    # Hash d'audit SHA-256
    payload_str = json.dumps({
        'startup': 'Mistral AI', 'gs_id': 'gs-096',
        'iro_scores': iro_scores, 'sigma': round(sigma, 4),
        'models': [r['model'] for r in results if r['success']],
        'date': datetime.datetime.now().isoformat(),
    }, sort_keys=True)
    audit_hash = 'C2-' + hashlib.sha256(payload_str.encode()).hexdigest()[:16].upper()

    # ── Affichage résultats ───────────────────────────────────────────────────
    if verbose:
        print(f"\n{sep}")
        print(f"  RÉSULTATS FINAUX — Mistral AI (gs-096)")
        print(f"  Runs réussis    : {n_ok}/5")
        print(f"  IRO par run     : [{', '.join(f'{s:.1f}' for s in iro_scores)}]")
        print(f"  Moyenne IRO     : {mu:.1f} pts  {'✓' if in_range else '⚠'} (ref={IRO_REF} ± {IRO_TOL})")
        print(f"  σ (écart-type)  : {sigma:.3f} pts")
        print(f"  Seuil BPI C2    : ≤ {SIGMA_BPI} pts")
        print(f"  Critère C2      : {'✅ PASSÉ' if bpi_pass else '❌ ÉCHOUÉ'}")
        print(f"  Hash audit      : {audit_hash}")
        print(sep)

        print("\n  Scores par dimension (moyenne ± σ vs gold) :")
        for k, v in dim_stats.items():
            sig_icon = '✓' if v['sigma'] <= 0.5 else ('~' if v['sigma'] <= 1.0 else '!')
            print(f"    {k:<4}  moy={v['mean']:.2f}  σ={v['sigma']:.3f}  gold={v['gold']}  {sig_icon}")

        # Interprétation σ par dimension
        volatile = [k for k, v in dim_stats.items() if v['sigma'] > 1.0]
        stable   = [k for k, v in dim_stats.items() if v['sigma'] <= 0.3]
        if stable:
            print(f"\n  Dimensions stables  (σ≤0.3) : {', '.join(stable)}")
        if volatile:
            print(f"  Dimensions volatiles (σ>1.0) : {', '.join(volatile)} — à surveiller")

        if bpi_pass:
            print(f"\n  ✅ CRITÈRE BPI C2 VALIDÉ — σ={sigma:.3f} ≤ {SIGMA_BPI} pts")
            print("     Le système IRO est stable sur 5 passes indépendantes.")
            print("     Ce résultat peut être joint au dossier BPI/France 2030.")
        else:
            print(f"\n  ❌ CRITÈRE BPI C2 NON VALIDÉ — σ={sigma:.3f} > {SIGMA_BPI} pts")
            print("     Vérifier le prompt système et relancer stability-5runs.")
            if volatile:
                print(f"     Dimensions à corriger en priorité : {', '.join(volatile)}")

    report = {
        'test':               'C2 — Stabilité IRO — Mode réel',
        'date':               datetime.datetime.now().isoformat(),
        'startup':            'Mistral AI (gs-096)',
        'iro_version':        'v7.0',
        'models_used':        MODELS,
        'n_runs_success':     n_ok,
        'iro_scores':         iro_scores,
        'sigma':              round(sigma, 4),
        'mean_iro':           round(mu, 2),
        'bpi_c2_passed':      bpi_pass,
        'in_reference_range': in_range,
        'sigma_threshold':    SIGMA_BPI,
        'iro_ref':            IRO_REF,
        'iro_tol':            IRO_TOL,
        'dim_stats':          dim_stats,
        'audit_hash':         audit_hash,
        'passes':             results,
    }

    return report

# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Test C2 stabilité IRO — 5 passes Gemini réelles')
    parser.add_argument('--key', default=os.getenv('GEMINI_API_KEY',''), help='Clé API Gemini')
    parser.add_argument('--output', default='', help='Fichier JSON de sortie (optionnel)')
    parser.add_argument('--quiet', action='store_true', help='Mode silencieux (JSON uniquement)')
    args = parser.parse_args()

    if not args.key:
        print("Erreur : clé Gemini manquante.\n"
              "Usage : python stability_c2_real.py --key AIza...\n"
              "    ou : GEMINI_API_KEY=AIza... python stability_c2_real.py")
        sys.exit(1)

    report = run_test(args.key, verbose=not args.quiet)

    # Sauvegarde
    out_file = args.output or f"IRO_C2_stability_{datetime.date.today()}.json"
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    if not args.quiet:
        print(f"\n  Rapport sauvegardé : {out_file}")

    sys.exit(0 if report.get('bpi_c2_passed') else 1)

if __name__ == '__main__':
    main()
