#!/usr/bin/env python3
"""
batch_gemini_iro.py — Pipeline batch d'annotation IRO via Gemini API
IRO Strength v7.0 — Antigravity Intelligence Platform
Calibration V2 : juste milieu Claude/Gemini/Humain — juin 2026

Usage:
    python batch_gemini_iro.py --input startups.json --output ./data/annotations/
    python batch_gemini_iro.py --single "Nabla" --sector "IA médicale"
    python batch_gemini_iro.py --cohorte  # annotate from cohorte-france.ts

Prérequis:
    pip install google-generativeai python-dotenv tqdm

Variables d'environnement:
    GEMINI_API_KEY=your_key_here  (ou .env)

Output:
    - data/annotations/<startup_name>.json  (1 fichier par startup)
    - data/annotations/batch_report.csv     (rapport consolidé)
    - data/annotations/audit_export.csv     (format journal d'audit IRO)

Objectif TRL 4:
    30 rapports annotés → C-index > 0.75 → pré-print arXiv v0
    Calibration V2 active : poids IRO V7, REV1 V2, LU intégré
"""

import os
import sys
import json
import time
import csv
import logging
import argparse
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import google.generativeai as genai
except ImportError:
    genai = None

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None

# ── Configuration ─────────────────────────────────────────────────────
if load_dotenv:
    load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if genai and GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

MODEL_NAME    = "gemini-3.5-flash"
TEMPERATURE   = 0.1
MAX_TOKENS    = 2048
RATE_LIMIT_S  = 2.0   # délai entre requêtes (quota gratuit : 15 rpm)
MAX_RETRIES   = 3
RETRY_DELAY_S = 10

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("data/annotations/batch.log", mode="a")
    ]
)
log = logging.getLogger(__name__)

# ── Prompts ───────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Tu es un expert en évaluation de startups IA agentiques, spécialisé dans le framework IRO v4.4 (Indice de Robustesse Organisationnelle).

CADRE THÉORIQUE :
- Barney (1991) — RBV/VRIN : Valorisable, Rare, Inimitable, Non-substituable
- Teece et al. (1997) — Capacités dynamiques : Sensing, Seizing, Reconfiguring
- Adner (2006) — Écosystèmes d'innovation : dépendances fournisseurs LLM
- Carr (2003) — Commoditisation : les LLMs deviennent infrastructure

DIMENSIONS IRO (scores [0-4]) :
- DI (18%) : Dépendance Infrastructurelle — autonomie vis-à-vis des fournisseurs LLM
  0=wrapper total  1=dépendance forte  2=hybride  3=infra partiellement propre  4=entièrement propriétaire
- ADC (22%) : Actif de Données Cumulatif — volume, unicité, flywheel organisationnel
  0=aucune donnée propre  1=données génériques  2=sectorielles  3=VRIN partiel  4=VRIN complet exclusif
- IPC (22%) : Intégration Processus Critiques — profondeur dans workflows client
  0=aucune  1=déclarative  2=production  3=certifiée  4=critique irremplaçable
- AR (13%) : Anticipation Réglementaire — conformité AI Act, certifications sectorielles
  0=aucune  1=réactive  2=en cours  3=avancée  4=native et certifiée
- CA (13%) : Capacité d'Adaptation — sensing/seizing/reconfiguring face aux ruptures
  0=rigide  1=réactif lent  2=mixte  3=proactif  4=agilité démontrée multi-pivot
- GCH (12%) : Gouvernance et Capital Humain — équipe, publications, track record
  0=généraliste  1=junior  2=expérimenté  3=sénior ex-GAFAM  4=publications+brevets+exits
- LU (15%) : Lead User Integration — co-construction avec utilisateurs avancés (von Hippel 1986)
  0=clients passifs  1=early adopters déclarés  2=feedback structuré documenté  3=co-développeurs avec données irréplicables  4=ancrage VRIN mutuel non réplicable

RÈGLES IMPÉRATIVES :
1. Chaque score DOIT être justifié par des faits observables (sources publiques)
2. Attribuer un niveau de confiance [0.2=déclaratif / 0.5=partiel / 0.8=convergent / 1.0=certifié]
3. REV1 V2 : DI=0 + ADC≤1 → IRO plafonné à 35 | DI=0 + ADC=2 → IRO plafonné à 50 | DI=0 + ADC≥3 → ancrage_warning=true, pas de plafond
4. Détecter les 6 patterns Goodhart si présents
5. Signaler tout manque d'information explicitement

RÉPONDRE UNIQUEMENT EN JSON VALIDE. Aucun texte avant ou après le JSON."""

USER_PROMPT_TEMPLATE = """BLOC 1 — CONTEXTE STARTUP
Startup : {name}
Secteur : {sector}
Description : {description}
Informations additionnelles : {context}
Sources à consulter : {sources}

BLOC 2 — SCORING DIMENSIONNEL (3 passes REV)
Effectue 3 passes successives indépendantes.
Passe 1 : scoring initial depuis les informations fournies.
Passe 2 : vérification des contradictions et biais possibles.
Passe 3 : consolidation avec niveaux de confiance finaux.
Retourne uniquement le résultat consolidé de la passe 3.

BLOC 3 — DÉTECTION PATTERNS GOODHART
Vérifie les 6 patterns :
1. ADC=4 et IPC≤1 → données sans usage client
2. AR≥3 et DI=0 → conformité sans infrastructure
3. GCH=4 et CA≤1 → équipe star sans agilité
4. IPC≥3 et ADC≤1 → intégration sans actif data
5. Toutes dimensions ≥3 → profil trop homogène
6. DI=4 et ADC≤1 → infrastructure sans données

BLOC 4 — FORMAT DE SORTIE JSON STRICT
{{
  "startup": "{name}",
  "analyse_date": "{date}",
  "modele": "gemini-3.5-flash",
  "passe": 3,
  "dimensions": {{
    "DI":  {{"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"}},
    "ADC": {{"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"}},
    "IPC": {{"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"}},
    "AR":  {{"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"}},
    "CA":  {{"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"}},
    "GCH": {{"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"}},
    "LU":  {{"score": <0-4>, "confiance": <0.2|0.5|0.8|1.0>, "justification": "<fait observable>"}}
  }},
  "goodhart_patterns": [],
  "sources_utilisees": [],
  "manques_information": [],
  "note_evaluateur": "<observation clé sur le profil>"
}}"""

# ── Cohorte de startups cibles pour TRL 4 ────────────────────────────
COHORTE_TRL4 = [
    {"name": "Coreweave", "sector": "Cloud GPU IA", "description": "Infrastructure GPU cloud pour entraînement LLMs", "status": "active"},
    {"name": "Cohere", "sector": "LLM enterprise", "description": "Modèles de langage déployables on-premise enterprise", "status": "active"},
    {"name": "Scale AI", "sector": "Data labeling IA", "description": "Annotation données ML à grande échelle", "status": "active"},
    {"name": "Qdrant", "sector": "Vector database IA", "description": "Base de données vectorielle pour RAG", "status": "active"},
    {"name": "Replit", "sector": "IDE IA code", "description": "Environnement développement avec IA intégrée", "status": "active"},
    {"name": "Runway ML", "sector": "IA vidéo générative", "description": "Génération et édition vidéo par IA", "status": "active"},
    {"name": "Perplexity AI", "sector": "Moteur recherche IA", "description": "Recherche conversationnelle avec citations", "status": "active"},
    {"name": "LangChain", "sector": "Framework LLM", "description": "Orchestration agents et pipelines LLM", "status": "active"},
    {"name": "Modjo", "sector": "IA conversation sales", "description": "Analyse appels commerciaux et coaching", "status": "active"},
    {"name": "Slite", "sector": "Base de connaissance IA", "description": "Documentation d'entreprise avec recherche IA", "status": "active"},
    {"name": "Adept AI", "sector": "Agent IA autonome", "description": "Agent IA pour tâches bureau — pivot 2024", "status": "failed"},
    {"name": "Embra", "sector": "Assistant IA Mac", "description": "Assistant IA natif macOS — fermé 2024", "status": "failed"},
    {"name": "Mem.ai", "sector": "Mémoire IA personnelle", "description": "Prise de notes IA — difficultés 2024", "status": "failed"},
    {"name": "Typeface", "sector": "IA contenu marketing", "description": "Génération contenu brand — pivot 2024", "status": "failed"},
    {"name": "Synthesis", "sector": "IA éducation enfants", "description": "Tutor IA mathématiques — restructuré 2024", "status": "failed"},
    {"name": "Harvey AI precursor", "sector": "LegalTech IA générique", "description": "LLM juridique sans données propriétaires — substituté", "status": "failed"},
    {"name": "Fixie.ai", "sector": "Agent IA web", "description": "Agents conversationnels web — shutdown 2024", "status": "failed"},
    {"name": "Inflection Pi v1", "sector": "LLM B2C empathique", "description": "Chatbot empathique — absorbé Microsoft 2024", "status": "failed"},
    {"name": "Stability AI Audio", "sector": "IA audio générative", "description": "Division audio Stability — cédée 2024", "status": "failed"},
    {"name": "Magic.dev", "sector": "IA code complet", "description": "Agent coding 1M tokens context — pivot B2B", "status": "failed"},
]

def compute_iro(dims: dict) -> dict:
    """Calcule IRO_100, SRD et IRO_cr depuis le JSON Gemini.
    
    Poids IRO V7 calibrés (total = 1.12, normalisé sur 4 * 1.12) :
      DI=18%  ADC=22%  IPC=22%  AR=13%  CA=10%  GCH=12%  LU=15%
    
    REV1 V2 (assouplie — validée par panel humain juin 2026) :
      DI=0 + ADC≤1 → IRO ≤ 35  (wrapper sans actifs propres)
      DI=0 + ADC=2 → IRO ≤ 50  (wrapper avec actifs partiels)
      DI=0 + ADC≥3 → ancrage_warning=True, pas de plafond
    """
    # Poids V7 corrigés (CA=10% et LU=15% — total 1.12)
    W = {"DI": 0.18, "ADC": 0.22, "IPC": 0.22, "AR": 0.13, "CA": 0.10, "GCH": 0.12, "LU": 0.15}
    TOTAL_W = sum(W.values())  # 1.12
    
    all_dims = list(W.keys())
    scores = {k: dims[k]["score"] for k in all_dims if k in dims}
    # LU optionnel : défaut à 2 si absent (transition depuis v4.4 sans LU)
    if "LU" not in dims:
        scores["LU"] = 2
    confs = {k: dims[k]["confiance"] for k in ["IPC", "ADC", "GCH", "LU"] if k in dims}
    
    # Scores effectifs pondérés par la confiance
    # [Unification 10/07/2026] LU n'est PAS amorti par la confiance, pour aligner avec
    # iro-engine.ts::calcIRO (seuls IPC/ADC/GCH sont amortis dans le modèle canonique).
    ipc_eff = scores["IPC"] * (0.5 + 0.5 * confs.get("IPC", 0.8))
    adc_eff = scores["ADC"] * (0.5 + 0.5 * confs.get("ADC", 0.8))
    gch_eff = scores["GCH"] * (0.5 + 0.5 * confs.get("GCH", 0.8))
    lu_eff  = scores["LU"]
    
    brut = (
        scores["DI"] * W["DI"]  +
        adc_eff       * W["ADC"] +
        ipc_eff       * W["IPC"] +
        scores["AR"]  * W["AR"]  +
        scores["CA"]  * W["CA"]  +
        gch_eff       * W["GCH"] +
        lu_eff        * W["LU"]
    )
    # Normalisation : brut / (4 * TOTAL_W) * 100
    iro = round((brut / (4 * TOTAL_W)) * 100, 1)
    
    # REV1 V2 — plafond assoupli selon ADC
    ancrage_warning = False
    di_score  = scores["DI"]
    adc_score = scores["ADC"]
    if di_score == 0:
        if adc_score <= 1:
            iro = min(iro, 35.0)   # wrapper sans données : plancher strict
        elif adc_score == 2:
            iro = min(iro, 50.0)   # wrapper avec actifs partiels
        else:
            ancrage_warning = True  # DI=0 mais données propriétaires : surveiller
    
    # Malus REV12 : ADC≥3 + IPC≤1 + LU≤1 → gap ancrage client
    if adc_score >= 3 and scores.get("IPC", 0) <= 1 and scores.get("LU", 0) <= 1:
        iro = max(0, iro - 5)
    
    # [Unification 10/07/2026] Bonus/malus d'interaction DI×ADC et IPC×GCH,
    # porté depuis iro-engine.ts::calcInteractionBonus (absent jusqu'ici de ce script).
    ipc_score = scores.get("IPC", 0)
    gch_score = scores.get("GCH", 0)

    if adc_score >= 3 and di_score <= 1:
        di_adc_bonus = -0.03 * (adc_score - di_score) * 100
    elif di_score >= 3 and adc_score <= 1:
        di_adc_bonus = -0.02 * (di_score - adc_score) * 100
    elif di_score >= 3 and adc_score >= 3:
        di_adc_bonus = 0.015 * min(di_score, adc_score) * 100 * 0.1
    else:
        di_adc_bonus = 0.0

    if ipc_score >= 3 and gch_score <= 1:
        ipc_gch_bonus = -0.02 * (ipc_score - gch_score) * 100 * 0.15
    elif ipc_score >= 3 and gch_score >= 3:
        ipc_gch_bonus = 0.01 * min(ipc_score, gch_score) * 100 * 0.1
    else:
        ipc_gch_bonus = 0.0

    interaction_bonus = round(di_adc_bonus + ipc_gch_bonus, 1)
    interaction_bonus = max(-3.0, min(3.0, interaction_bonus))
    iro = max(0, min(100, round(iro + interaction_bonus, 1)))

    mean_conf = sum(confs.values()) / len(confs) if confs else 0.5
    srd_est   = round((1 - mean_conf) * 60, 1)
    irocr     = round(iro * (1 - srd_est / 200), 1)
    
    level = (
        "Exceptionnel" if iro >= 80 else
        "Solide"       if iro >= 65 else
        "Vigilance"    if iro >= 46 else
        "Risque élevé" if iro >= 25 else
        "Critique"
    )
    return {
        "iro_100": iro,
        "srd_proxy": srd_est,
        "iro_cr": irocr,
        "level": level,
        "ancrage_warning": ancrage_warning,
        "lu_score": scores.get("LU", 2),
        "poids_version": "V7-1.12"
    }

def score_startup(startup: dict, output_dir: Path) -> Optional[dict]:
    name = startup["name"]
    out_file = output_dir / f"{name.lower().replace(' ', '_')}.json"
    if out_file.exists():
        log.info(f"SKIP (déjà annoté) : {name}")
        return json.loads(out_file.read_text())
    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        system_instruction=SYSTEM_PROMPT,
        generation_config=genai.GenerationConfig(
            temperature=TEMPERATURE,
            max_output_tokens=MAX_TOKENS,
            response_mime_type="application/json",
        ),
    )
    prompt = USER_PROMPT_TEMPLATE.format(
        name=name,
        sector=startup.get("sector", ""),
        description=startup.get("description", ""),
        context=startup.get("context", "Aucune information supplémentaire."),
        sources=startup.get("sources", "site web, Crunchbase, LinkedIn, presse tech"),
        date=datetime.now().strftime("%Y-%m-%d"),
    )
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            log.info(f"Scoring [{attempt}/{MAX_RETRIES}] : {name}")
            response = model.generate_content(prompt)
            raw = response.text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            raw = raw.strip()
            result = json.loads(raw)
            result["iro_computed"] = compute_iro(result["dimensions"])
            result["status_ground_truth"] = startup.get("status", "unknown")
            out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2))
            log.info(f"✓ {name} — IRO={result['iro_computed']['iro_100']} [{result['iro_computed']['level']}]")
            return result
        except json.JSONDecodeError as e:
            log.warning(f"JSON invalide (tentative {attempt}) : {name} — {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY_S)
        except Exception as e:
            log.error(f"Erreur API (tentative {attempt}) : {name} — {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY_S)
    log.error(f"ÉCHEC définitif : {name}")
    return None

def save_batch_report(results: list[dict], output_dir: Path):
    csv_path = output_dir / "batch_report.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "startup", "status_ground_truth", "analyse_date",
            "DI", "DI_conf", "ADC", "ADC_conf",
            "IPC", "IPC_conf", "AR", "AR_conf",
            "CA", "CA_conf", "GCH", "GCH_conf",
            "LU", "LU_conf",
            "iro_100", "srd_proxy", "iro_cr", "level",
            "ancrage_warning", "lu_score", "poids_version",
            "goodhart_patterns", "manques_info", "note"
        ])
        for r in results:
            if r is None: continue
            d = r["dimensions"]
            c = r["iro_computed"]
            lu = d.get("LU", {"score": 2, "confiance": 0.5})
            writer.writerow([
                r["startup"],
                r.get("status_ground_truth", "unknown"),
                r.get("analyse_date", ""),
                d["DI"]["score"],  d["DI"]["confiance"],
                d["ADC"]["score"], d["ADC"]["confiance"],
                d["IPC"]["score"], d["IPC"]["confiance"],
                d["AR"]["score"],  d["AR"]["confiance"],
                d["CA"]["score"],  d["CA"]["confiance"],
                d["GCH"]["score"], d["GCH"]["confiance"],
                lu["score"],       lu["confiance"],
                c["iro_100"], c["srd_proxy"], c["iro_cr"], c["level"],
                c.get("ancrage_warning", False),
                c.get("lu_score", 2),
                c.get("poids_version", "V7-1.12"),
                ";".join(r.get("goodhart_patterns", [])),
                ";".join(r.get("manques_information", [])),
                r.get("note_evaluateur", "")
            ])
    log.info(f"Rapport batch : {csv_path}")
    audit_path = output_dir / "audit_export.csv"
    with open(audit_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "timestamp", "startup_name", "iro_total", "iro_cr", "srd",
            "DI", "ADC", "IPC", "AR", "CA", "GCH", "LU",
            "ancrage_warning", "poids_version",
            "evaluator", "model_version", "source_type",
            "status", "goodhart_patterns", "notes"
        ])
        for r in results:
            if r is None: continue
            d = r["dimensions"]
            c = r["iro_computed"]
            lu_d = d.get("LU", {"score": 2})
            writer.writerow([
                r.get("analyse_date", datetime.now().isoformat()),
                r["startup"],
                c["iro_100"], c["iro_cr"], c["srd_proxy"],
                d["DI"]["score"], d["ADC"]["score"], d["IPC"]["score"],
                d["AR"]["score"], d["CA"]["score"], d["GCH"]["score"],
                lu_d["score"],
                c.get("ancrage_warning", False),
                c.get("poids_version", "V7-1.12"),
                "gemini_batch_v1", "IRO v7.0", "gemini_pipeline",
                r.get("status_ground_truth", "unknown"),
                ";".join(r.get("goodhart_patterns", [])),
                r.get("note_evaluateur", "")
            ])
    log.info(f"Journal audit : {audit_path}")

def print_summary(results: list[dict]):
    valid = [r for r in results if r is not None]
    if not valid: return
    actives = [r for r in valid if r.get("status_ground_truth") == "active"]
    failed  = [r for r in valid if r.get("status_ground_truth") == "failed"]
    iro_all = [r["iro_computed"]["iro_100"] for r in valid]
    iro_act = [r["iro_computed"]["iro_100"] for r in actives]
    iro_fai = [r["iro_computed"]["iro_100"] for r in failed]
    mean = lambda lst: sum(lst) / len(lst) if lst else 0
    print("\n" + "═"*60)
    print("  RAPPORT BATCH — IRO Strength v5")
    print("═"*60)
    print(f"  Total scoré      : {len(valid)}/{len(results)}")
    print(f"  Actives          : {len(actives)} — IRO moy. = {mean(iro_act):.1f}")
    print(f"  Échecs           : {len(failed)}  — IRO moy. = {mean(iro_fai):.1f}")
    print(f"  Δ séparation     : {mean(iro_act) - mean(iro_fai):.1f} pts")
    print(f"  IRO global moy.  : {mean(iro_all):.1f}")
    # Zones IRO V7 : Excellent≥80 | Solide 65-79 | Vigilance 46-64 | Risque 25-45 | Critique<25
    buckets = {"Excellent (≥80)": 0, "Solide (65-79)": 0, "Vigilance (46-64)": 0, "Risque élevé (25-45)": 0, "Critique (<25)": 0}
    for iro in iro_all:
        if iro >= 80: buckets["Excellent (≥80)"] += 1
        elif iro >= 65: buckets["Solide (65-79)"] += 1
        elif iro >= 46: buckets["Vigilance (46-64)"] += 1
        elif iro >= 25: buckets["Risque élevé (25-45)"] += 1
        else: buckets["Critique (<25)"] += 1
    print("\n  Distribution :")
    for label, count in buckets.items():
        print(f"    {label:<20} {'█' * count} ({count})")
    sorted_r = sorted(valid, key=lambda r: r["iro_computed"]["iro_100"], reverse=True)
    print("\n  Top 5 IRO :")
    for r in sorted_r[:5]:
        print(f"    {r['startup']:<25} IRO={r['iro_computed']['iro_100']:.1f}")
    print("\n  TRL 4 — checklist :")
    print(f"    Δ séparation ≥ 15 pts : {'✓' if (mean(iro_act) - mean(iro_fai)) >= 15 else '✗'}")
    print(f"    n ≥ 20 annotés        : {'✓' if len(valid) >= 20 else '✗'}")

def main():
    if genai is None or load_dotenv is None or tqdm is None:
        print("Installer les dépendances : pip install google-generativeai python-dotenv tqdm")
        sys.exit(1)
    if not GEMINI_API_KEY:
        print("ERREUR : GEMINI_API_KEY manquante dans .env ou variables d'environnement")
        sys.exit(1)

    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--output",  default="data/annotations")
    parser.add_argument("--single")
    parser.add_argument("--sector")
    parser.add_argument("--context")
    parser.add_argument("--cohorte", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit",   type=int)
    args = parser.parse_args()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.single:
        startups = [{"name": args.single, "sector": args.sector or "", "description": "", "context": args.context or "", "status": "unknown"}]
    elif args.input:
        with open(args.input) as f: startups = json.load(f)
    elif args.cohorte:
        startups = COHORTE_TRL4
    else:
        parser.print_help(); sys.exit(0)
    if args.limit: startups = startups[:args.limit]
    if args.dry_run:
        for i, s in enumerate(startups, 1): print(f"  {i:02d}. {s['name']}")
        return
    results = []
    for startup in tqdm(startups, desc="Scoring IRO"):
        result = score_startup(startup, output_dir)
        results.append(result)
        if len(startups) > 1: time.sleep(RATE_LIMIT_S)
    save_batch_report(results, output_dir)
    print_summary(results)

if __name__ == "__main__":
    main()
