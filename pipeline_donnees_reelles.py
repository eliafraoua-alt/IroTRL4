#!/usr/bin/env python3
"""
pipeline_donnees_reelles.py — Pipeline de données réelles pour IRO Velocity
IRO Strength v6.6 — Antigravity Intelligence Platform

Collecte multi-sources et génération de snapshots multi-temporels
pour calibrer β_velocity et valider H5.

Usage:
    python pipeline_donnees_reelles.py --startup "Nabla" --vertical HLTH
    python pipeline_donnees_reelles.py --batch cohorte_trl4.json
    python pipeline_donnees_reelles.py --calibrate  # calibre β_velocity

Sources intégrées :
    GRATUIT  : GitHub API, Pappers.fr, INPI Brevets, Gemini Search, Bodacc
    PAYANT   : Crunchbase API (~500$/an), Proxycurl LinkedIn (~0.01$/profil)
    OPEN     : data.gouv.fr Sirene, INPI data.inpi.fr

Prérequis :
    pip install requests python-dotenv lifelines pandas numpy tqdm colorama
"""

import os
import sys
import json
import time
import argparse
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, asdict

try:
    import requests
    import pandas as pd
    import numpy as np
    from dotenv import load_dotenv
    from tqdm import tqdm
    from colorama import Fore, Style, init as colorama_init
except ImportError:
    print("Installer : pip install requests python-dotenv pandas numpy tqdm colorama lifelines")
    sys.exit(1)

load_dotenv()
colorama_init(autoreset=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler("data/pipeline.log", mode="a")]
)
log = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────

GEMINI_API_KEY      = os.getenv("GEMINI_API_KEY", "")
GITHUB_TOKEN        = os.getenv("GITHUB_TOKEN", "")
CRUNCHBASE_API_KEY  = os.getenv("CRUNCHBASE_API_KEY", "")   # optionnel — payant
PROXYCURL_API_KEY   = os.getenv("PROXYCURL_API_KEY", "")    # optionnel — payant
PAPPERS_API_KEY     = os.getenv("PAPPERS_API_KEY", "")      # gratuit avec clé
INPI_API_KEY        = os.getenv("INPI_API_KEY", "")         # gratuit inscription
INSEE_API_KEY       = os.getenv("INSEE_API_KEY", "")        # gratuit inscription

OUTPUT_DIR = Path("data/snapshots")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ── Sources de données ──────────────────────────────────────────────────────────

class CrunchbaseCollector:
    """
    Crunchbase API v4.
    Sans clé : fallback Gemini search (confidence=medium).
    Avec clé  : données directes (confidence=high).
    Clé gratuite pour les fondateurs sur : https://www.crunchbase.com/home
    API payante Basic : ~500$/an (illimité)
    """

    BASE = "https://api.crunchbase.com/api/v4"

    def fetch(self, slug_or_name: str) -> dict:
        if CRUNCHBASE_API_KEY:
            return self._fetch_api(slug_or_name)
        else:
            log.info(f"  Crunchbase : pas de clé → fallback Gemini search pour {slug_or_name}")
            return self._fetch_via_gemini(slug_or_name)

    def _fetch_api(self, slug: str) -> dict:
        url = f"{self.BASE}/entities/organizations/{slug}"
        fields = "short_description,founded_on,funding_total,last_funding_type,last_funding_on,num_employees_enum,investor_identifiers,categories,homepage_url"
        try:
            r = requests.get(url, params={"user_key": CRUNCHBASE_API_KEY, "field_ids": fields}, timeout=10)
            r.raise_for_status()
            props = r.json().get("properties", {})

            founded_year = None
            if props.get("founded_on"):
                founded_year = int(props["founded_on"]["value"][:4])

            age_mois = None
            if founded_year:
                age_mois = int((datetime.now() - datetime(founded_year, 1, 1)).days / 30.44)

            return {
                "source": "crunchbase_api",
                "confidence": "high",
                "founded_year": founded_year,
                "age_mois": age_mois,
                "funding_total_usd": props.get("funding_total", {}).get("value_usd"),
                "funding_stage": props.get("last_funding_type"),
                "last_funding_date": props.get("last_funding_on", {}).get("value"),
                "employee_range": props.get("num_employees_enum"),
                "investors": [i["value"] for i in props.get("investor_identifiers", [])],
                "categories": [c["value"] for c in props.get("categories", [])],
            }
        except Exception as e:
            log.warning(f"  Crunchbase API erreur : {e}")
            return {"source": "crunchbase_api", "confidence": "low", "error": str(e)}

    def _fetch_via_gemini(self, name: str) -> dict:
        """Fallback gratuit via Gemini search"""
        prompt = f"""Recherche sur Crunchbase.com, Dealroom.co, et Tracxn.com les données de la startup "{name}".
Retourne UNIQUEMENT ce JSON (null si non trouvé) :
{{
  "founded_year": null, "funding_total_usd": null, "funding_stage": "",
  "last_funding_date": "", "investors": [], "employee_range": "",
  "location_city": "", "location_country": "", "categories": []
}}"""
        data = _call_gemini_json(prompt, f"Analyste startup. Recherche {name} sur Crunchbase.")
        if data:
            fy = data.get("founded_year")
            data["age_mois"] = int((datetime.now() - datetime(fy, 1, 1)).days / 30.44) if fy else None
            data["source"] = "gemini_search"
            data["confidence"] = "medium"
        return data or {"source": "gemini_search", "confidence": "low"}


class LinkedInCollector:
    """
    LinkedIn via Gemini search (gratuit) ou Proxycurl ($0.01/profil).
    L'API officielle LinkedIn est réservée aux partenaires certifiés.
    """

    def fetch(self, company_name: str, linkedin_url: Optional[str] = None) -> dict:
        if PROXYCURL_API_KEY and linkedin_url:
            return self._fetch_proxycurl(linkedin_url)
        return self._fetch_via_gemini(company_name)

    def _fetch_proxycurl(self, url: str) -> dict:
        try:
            r = requests.get("https://nubela.co/proxycurl/api/linkedin/company",
                params={"url": url, "use_cache": "if-present"},
                headers={"Authorization": f"Bearer {PROXYCURL_API_KEY}"}, timeout=15)
            r.raise_for_status()
            data = r.json()
            return {
                "source": "proxycurl",
                "confidence": "high",
                "employee_count": data.get("company_size", [None])[0],
                "tech_job_titles": [],
                "llm_signals": [],
                "founders": [],
                "founder_backgrounds": [],
            }
        except Exception as e:
            log.warning(f"  Proxycurl erreur : {e}")
            return {"source": "proxycurl", "confidence": "low"}

    def _fetch_via_gemini(self, name: str) -> dict:
        prompt = f"""Recherche sur LinkedIn.com, les offres d'emploi et le profil de "{name}".
Retourne UNIQUEMENT ce JSON :
{{
  "employee_count": null,
  "employee_growth_pct": null,
  "tech_job_titles": [],
  "llm_signals": [],
  "founders": [],
  "founder_backgrounds": []
}}
llm_signals = mots-clés LLM dans les offres (fine-tuning, RLHF, GPU training, proprietary model)
founder_backgrounds = ex-emplois notables (ex-Google Brain, PhD NeurIPS, ex-Mistral AI)"""
        data = _call_gemini_json(prompt, f"Analyste RH startup IA. Recherche {name} sur LinkedIn.")
        if data:
            data["source"] = "gemini_search"
            data["confidence"] = "medium"
        return data or {"source": "gemini_search", "confidence": "low"}


class PappersCollector:
    """
    API Pappers.fr — France uniquement, gratuite avec clé.
    Inscription gratuite : https://www.pappers.fr/api
    100 req/jour sans clé, 5000/jour avec clé gratuite.
    """

    def fetch(self, company_name: str) -> dict:
        url = "https://api.pappers.fr/v2/recherche"
        params = {"q": company_name, "par_page": 1}
        if PAPPERS_API_KEY:
            params["api_token"] = PAPPERS_API_KEY

        try:
            r = requests.get(url, params=params, timeout=10)
            r.raise_for_status()
            results = r.json().get("resultats", [])
            if not results:
                return {"source": "pappers", "confidence": "low", "found": False}

            c = results[0]
            date_creation = c.get("date_creation")
            age_mois = None
            if date_creation:
                try:
                    d = datetime.strptime(date_creation, "%Y-%m-%d")
                    age_mois = int((datetime.now() - d).days / 30.44)
                except:
                    pass

            return {
                "source": "pappers",
                "confidence": "high",
                "found": True,
                "siret": c.get("siret"),
                "siren": c.get("siren"),
                "denomination": c.get("nom_entreprise"),
                "date_creation": date_creation,
                "age_mois": age_mois,
                "effectifs": c.get("effectif"),
                "statut": "active" if c.get("statut") == "Actif" else "cessée",
                "code_naf": c.get("code_naf"),
                "libelle_naf": c.get("libelle_naf"),
                "ville": c.get("ville"),
                "capital": c.get("capital"),
            }
        except Exception as e:
            log.warning(f"  Pappers erreur : {e}")
            return {"source": "pappers", "confidence": "low", "error": str(e)}


class GitHubCollector:
    """
    Réutilise la logique de githubExtractor.ts en Python.
    Sans token : 60 req/h. Avec token (gratuit) : 5000 req/h.
    """

    DEPS_LLM = [
        "openai", "anthropic", "@anthropic-ai/sdk", "@google/genai", "langchain",
        "llamaindex", "mistralai", "cohere-ai", "transformers", "huggingface_hub",
        "litellm", "groq-sdk", "replicate", "together-ai",
    ]

    def fetch(self, org: str, repo: Optional[str] = None) -> dict:
        repo = repo or org
        headers = {}
        if GITHUB_TOKEN:
            headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
        headers["Accept"] = "application/vnd.github+json"

        base = {"org": org, "repo": repo, "source": "github", "confidence": "high"}

        try:
            # Repo info
            r = requests.get(f"https://api.github.com/repos/{org}/{repo}", headers=headers, timeout=10)
            if r.status_code == 404:
                return {**base, "private_or_missing": True, "di_signal": "none"}
            r.raise_for_status()
            repo_data = r.json()
            base["stars"] = repo_data.get("stargazers_count", 0)

            # Commits activité
            r = requests.get(f"https://api.github.com/repos/{org}/{repo}/commits?per_page=1", headers=headers, timeout=10)
            if r.ok and r.json():
                base["last_commit_date"] = r.json()[0]["commit"]["author"]["date"]

            r = requests.get(f"https://api.github.com/repos/{org}/{repo}/stats/commit_activity", headers=headers, timeout=10)
            if r.ok:
                commits = r.json()
                total = sum(w.get("total", 0) for w in commits) if isinstance(commits, list) else 0
                base["commits_year"] = total
                base["activity"] = "high" if total > 500 else "medium" if total > 100 else "low"

            # Dépendances LLM
            llm_deps = []
            for filename in ["package.json", "requirements.txt", "pyproject.toml"]:
                r = requests.get(f"https://api.github.com/repos/{org}/{repo}/contents/{filename}", headers=headers, timeout=10)
                if r.ok:
                    import base64
                    content = base64.b64decode(r.json()["content"]).decode("utf-8", errors="ignore").lower()
                    llm_deps.extend([d for d in self.DEPS_LLM if d.lower() in content])

            base["llm_dependencies"] = list(set(llm_deps))

            # Signal DI
            if not llm_deps:
                base["di_signal"] = "proprietary"
            elif "transformers" in llm_deps or "huggingface_hub" in llm_deps:
                base["di_signal"] = "rag_custom"
            else:
                base["di_signal"] = "wrapper"

            return base

        except Exception as e:
            log.warning(f"  GitHub erreur : {e}")
            return {**base, "confidence": "low", "error": str(e)}


# ── Gemini helper ─────────────────────────────────────────────────────────────

def _call_gemini_json(prompt: str, system: str, max_retries: int = 2) -> Optional[dict]:
    """Appel Gemini avec parsing JSON robuste."""
    if not GEMINI_API_KEY:
        log.warning("GEMINI_API_KEY manquante — impossible d'appeler Gemini")
        return None

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": system}]},
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2048, "responseMimeType": "application/json"}
    }

    for attempt in range(max_retries + 1):
        try:
            r = requests.post(url, json=payload, timeout=30)
            r.raise_for_status()
            text = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            # Nettoyer les backticks éventuels
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            return json.loads(text.strip())
        except Exception as e:
            if attempt < max_retries:
                time.sleep(3)
            else:
                log.warning(f"  Gemini erreur : {e}")
    return None


# ── IRO Scorer via Gemini ─────────────────────────────────────────────────────

def score_iro_gemini(startup_name: str, context: str, sector: str) -> Optional[dict]:
    """Score IRO complet via Gemini — 3 passes REV."""
    system = """Tu es un expert IRO v4.4. Score une startup IA agentique.
DIMENSIONS (scores [0-4]) :
DI=dépendance infra LLM, ADC=actif données, IPC=intégration critique,
AR=anticipation réglementaire, CA=capacité adaptation, GCH=capital humain.
Réponds UNIQUEMENT en JSON valide."""

    prompt = f"""Startup : {startup_name}
Secteur : {sector}
Contexte : {context}

3 passes REV puis consolide. Retourne :
{{
  "startup": "{startup_name}",
  "analyse_date": "{datetime.now().date().isoformat()}",
  "dimensions": {{
    "DI":  {{"score": 0, "confiance": 0.5, "justification": ""}},
    "ADC": {{"score": 0, "confiance": 0.5, "justification": ""}},
    "IPC": {{"score": 0, "confiance": 0.5, "justification": ""}},
    "AR":  {{"score": 0, "confiance": 0.5, "justification": ""}},
    "CA":  {{"score": 0, "confiance": 0.5, "justification": ""}},
    "GCH": {{"score": 0, "confiance": 0.5, "justification": ""}}
  }},
  "goodhart_patterns": [],
  "manques_information": [],
  "note_evaluateur": ""
}}"""
    return _call_gemini_json(prompt, system)


def compute_iro_from_gemini(gemini_result: dict) -> tuple[float, float]:
    """Calcule IRO_100 et IRO_cr depuis le JSON Gemini."""
    W = {"DI": 0.18, "ADC": 0.22, "IPC": 0.22, "AR": 0.13, "CA": 0.13, "GCH": 0.12}
    dims = gemini_result.get("dimensions", {})

    scores = {k: dims[k]["score"] for k in W if k in dims}
    confs  = {k: dims[k]["confiance"] for k in ["IPC", "ADC", "GCH"] if k in dims}

    ipc_eff = scores.get("IPC", 0) * (0.5 + 0.5 * confs.get("IPC", 0.5))
    adc_eff = scores.get("ADC", 0) * (0.5 + 0.5 * confs.get("ADC", 0.5))
    gch_eff = scores.get("GCH", 0) * (0.5 + 0.5 * confs.get("GCH", 0.5))

    brut = (
        scores.get("DI",  0) * W["DI"]  +
        adc_eff              * W["ADC"] +
        ipc_eff              * W["IPC"] +
        scores.get("AR",  0) * W["AR"]  +
        scores.get("CA",  0) * W["CA"]  +
        gch_eff              * W["GCH"]
    )
    iro100 = round((brut / 4) * 100, 1)
    if scores.get("DI", 0) == 0:
        iro100 = min(iro100, 40.0)  # REV1

    # SRD proxy (conf moyenne → SRD estimé)
    mean_conf = sum(confs.values()) / len(confs) if confs else 0.5
    srd_proxy = round((1 - mean_conf) * 60, 1)
    irocr = round(iro100 * (1 - srd_proxy / 200), 1)

    return iro100, irocr


# ── Pipeline principal ────────────────────────────────────────────────────────

@dataclass
class StartupToProcess:
    name:         str
    sector:       str          = ""
    vertical:     str          = "SAAS"
    github_org:   str          = ""
    linkedin_url: str          = ""
    crunchbase_slug: str       = ""
    status:       str          = "unknown"  # 'active' | 'failed' | 'unknown'
    is_french:    bool         = True


def process_startup(s: StartupToProcess) -> Optional[dict]:
    """Pipeline complet pour une startup — retourne un snapshot IRO."""
    log.info(f"\n{'─'*50}")
    log.info(f"  Traitement : {Fore.CYAN}{s.name}{Style.RESET_ALL} [{s.vertical}]")

    result = {
        "startup_name": s.name,
        "sector":       s.sector,
        "vertical":     s.vertical,
        "status":       s.status,
        "timestamp":    datetime.now().isoformat(),
        "sources":      {},
    }

    # ── 1. Crunchbase ─────────────────────────────────────────────────────
    log.info("  [1/5] Crunchbase...")
    cb = CrunchbaseCollector().fetch(s.crunchbase_slug or s.name)
    result["sources"]["crunchbase"] = cb
    if cb.get("age_mois"):
        result["age_mois"] = cb["age_mois"]
    if cb.get("funding_stage"):
        result["stade_financement"] = cb["funding_stage"]
    time.sleep(1.5)

    # ── 2. LinkedIn ───────────────────────────────────────────────────────
    log.info("  [2/5] LinkedIn...")
    li = LinkedInCollector().fetch(s.name, s.linkedin_url or None)
    result["sources"]["linkedin"] = li
    time.sleep(1.5)

    # ── 3. Pappers (France) ───────────────────────────────────────────────
    if s.is_french:
        log.info("  [3/5] Pappers (FR)...")
        pappers = PappersCollector().fetch(s.name)
        result["sources"]["pappers"] = pappers
        if pappers.get("age_mois") and not result.get("age_mois"):
            result["age_mois"] = pappers["age_mois"]
        if pappers.get("statut") == "cessée":
            result["alert_cessation"] = True
        time.sleep(1.0)
    else:
        result["sources"]["pappers"] = None

    # ── 4. GitHub ─────────────────────────────────────────────────────────
    if s.github_org:
        log.info("  [4/5] GitHub...")
        gh = GitHubCollector().fetch(s.github_org)
        result["sources"]["github"] = gh
        result["di_signal"] = gh.get("di_signal", "none")
        result["llm_dependencies"] = gh.get("llm_dependencies", [])
        time.sleep(1.0)
    else:
        log.info("  [4/5] GitHub : non configuré")
        result["sources"]["github"] = None

    # ── 5. Scoring IRO via Gemini ─────────────────────────────────────────
    log.info("  [5/5] Scoring IRO (Gemini REV3)...")
    context_parts = []
    if cb.get("funding_total_usd"):
        context_parts.append(f"Levée totale : {cb['funding_total_usd']:,} USD, stade {cb.get('funding_stage', '?')}")
    if li.get("employee_count"):
        context_parts.append(f"Effectifs LinkedIn : {li['employee_count']} employés")
    if li.get("founder_backgrounds"):
        context_parts.append(f"Fondateurs : {', '.join(li['founder_backgrounds'][:3])}")
    if li.get("llm_signals"):
        context_parts.append(f"Signaux LLM LinkedIn : {', '.join(li['llm_signals'][:3])}")
    if result.get("di_signal"):
        context_parts.append(f"Signal GitHub DI : {result['di_signal']}")

    context = " | ".join(context_parts) or "Aucune donnée contextuelle disponible"
    gemini_score = score_iro_gemini(s.name, context, s.sector)

    if gemini_score:
        iro100, irocr = compute_iro_from_gemini(gemini_score)
        result["iro_total"] = iro100
        result["iro_cr"]    = irocr
        result["dimensions"]= gemini_score.get("dimensions", {})
        result["goodhart"]  = gemini_score.get("goodhart_patterns", [])
        log.info(f"  ✓ IRO = {Fore.GREEN}{iro100:.1f}{Style.RESET_ALL} pts  IRO_cr = {irocr:.1f}")
    else:
        log.warning(f"  ✗ Scoring Gemini échoué pour {s.name}")
        return None

    # Sauvegarder le snapshot
    outfile = OUTPUT_DIR / f"{s.name.lower().replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M')}.json"
    outfile.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    log.info(f"  Snapshot sauvegardé : {outfile.name}")

    return result


def calibrate_beta_velocity():
    """
    Calibre β_velocity sur les snapshots disponibles.
    Requiert ≥ 2 snapshots par startup dans OUTPUT_DIR.
    """
    try:
        from lifelines import CoxPHFitter
    except ImportError:
        log.error("pip install lifelines pour la calibration")
        return

    # Charger tous les snapshots
    snapshots = []
    for f in OUTPUT_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            if "iro_total" in data and "timestamp" in data:
                snapshots.append(data)
        except:
            pass

    if not snapshots:
        log.error("Aucun snapshot trouvé dans data/snapshots/")
        return

    # Grouper par startup et calculer la velocity
    df = pd.DataFrame(snapshots)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values(["startup_name", "timestamp"])

    rows = []
    for name, group in df.groupby("startup_name"):
        if len(group) < 2:
            continue

        first, last = group.iloc[0], group.iloc[-1]
        dt = (last["timestamp"] - first["timestamp"]).days / 30.44
        if dt < 0.5:
            continue

        velocity = (last["iro_total"] - first["iro_total"]) / max(dt, 1)
        status   = last.get("status", "unknown")

        rows.append({
            "startup_name": name,
            "period_months": dt,
            "velocity":     velocity,
            "iro_last":     last["iro_total"],
            "iro_cr_last":  last.get("iro_cr", last["iro_total"]),
            "event":        1 if status == "failed" else 0,
        })

    if len(rows) < 10:
        log.warning(f"Seulement {len(rows)} startups avec ≥2 snapshots — minimum 10 requis pour calibration fiable")
        if len(rows) < 3:
            return

    df_cox = pd.DataFrame(rows).dropna()

    print(f"\n{'═'*50}")
    print(f"  CALIBRATION β_velocity — n={len(df_cox)} startups")
    print(f"{'═'*50}")

    cox = CoxPHFitter()
    try:
        cox.fit(df_cox[["period_months", "event", "velocity", "iro_cr_last"]],
                duration_col="period_months", event_col="event")
        cox.print_summary()

        beta_v    = cox.params_["velocity"]
        ci_lo     = cox.confidence_intervals_.loc["velocity", "95% lower-bound"]
        ci_hi     = cox.confidence_intervals_.loc["velocity", "95% upper-bound"]
        c_index   = cox.concordance_index_

        print(f"\n  β_velocity calibré : {beta_v:.4f}")
        print(f"  IC95%             : [{ci_lo:.4f}, {ci_hi:.4f}]")
        print(f"  Harrell C         : {c_index:.4f}")

        if ci_lo < 0 < ci_hi:
            print(f"\n  {Fore.YELLOW}⚠ H5 non confirmée : IC95% inclut 0 — n insuffisant ou β réel ≈ 0{Style.RESET_ALL}")
        elif beta_v < 0:
            print(f"\n  {Fore.GREEN}✓ H5 confirmée : velocity protectrice (β < 0){Style.RESET_ALL}")
        else:
            print(f"\n  {Fore.RED}✗ H5 infirmée : velocity non protectrice (β > 0){Style.RESET_ALL}")

        print(f"\n  → Remplacer dans iro-velocity.ts :")
        print(f"    const BETA_VELOCITY = {beta_v:.4f}; // calibré {datetime.now().date()}")

        # Sauvegarder
        calibration = {
            "date": datetime.now().isoformat(),
            "n_startups": len(df_cox),
            "beta_velocity": beta_v,
            "ci_lo": ci_lo,
            "ci_hi": ci_hi,
            "harrell_c": c_index,
            "h5_confirmed": ci_lo < 0 and beta_v < 0,
        }
        Path("data/calibration.json").write_text(json.dumps(calibration, indent=2))
        log.info("Calibration sauvegardée : data/calibration.json")

    except Exception as e:
        log.error(f"Cox fitting error: {e}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Pipeline données réelles IRO Velocity")
    parser.add_argument("--startup",    help="Nom de la startup à traiter")
    parser.add_argument("--sector",     help="Secteur (ex: IA médicale)", default="")
    parser.add_argument("--vertical",   help="Vertical IRO (HLTH, FINT, SAAS, B2C, INDU, LEGL)", default="SAAS")
    parser.add_argument("--github",     help="GitHub org (ex: huggingface)", default="")
    parser.add_argument("--linkedin",   help="URL LinkedIn company", default="")
    parser.add_argument("--crunchbase", help="Slug Crunchbase (ex: nabla-1)", default="")
    parser.add_argument("--status",     choices=["active", "failed", "unknown"], default="unknown")
    parser.add_argument("--batch",      help="JSON file avec liste de startups")
    parser.add_argument("--calibrate",  action="store_true", help="Calibre β_velocity sur les snapshots existants")
    parser.add_argument("--not-french", action="store_true", help="Désactive Pappers (startup non française)")
    args = parser.parse_args()

    if args.calibrate:
        calibrate_beta_velocity()
        return

    if args.batch:
        startups_raw = json.loads(Path(args.batch).read_text())
        startups = [StartupToProcess(**s) for s in startups_raw]
    elif args.startup:
        startups = [StartupToProcess(
            name=args.startup, sector=args.sector, vertical=args.vertical,
            github_org=args.github, linkedin_url=args.linkedin,
            crunchbase_slug=args.crunchbase, status=args.status,
            is_french=not args.not_french
        )]
    else:
        parser.print_help()
        return

    results = []
    for s in tqdm(startups, desc="Pipeline IRO"):
        r = process_startup(s)
        if r:
            results.append(r)
        time.sleep(2)

    # Rapport
    print(f"\n{'═'*50}")
    print(f"  RAPPORT PIPELINE — {len(results)}/{len(startups)} succès")
    print(f"{'═'*50}")
    for r in results:
        status_icon = "✓" if r.get("status") == "active" else "✗" if r.get("status") == "failed" else "?"
        print(f"  {status_icon} {r['startup_name']:<25} IRO={r.get('iro_total', '?'):.1f}  sources={','.join(r.get('sources', {}).keys())}")

    # CSV export
    if results:
        rows = []
        for r in results:
            dims = r.get("dimensions", {})
            rows.append({
                "startup_name": r["startup_name"],
                "timestamp":    r["timestamp"],
                "status":       r["status"],
                "iro_total":    r.get("iro_total"),
                "iro_cr":       r.get("iro_cr"),
                "DI":  dims.get("DI",  {}).get("score"),
                "ADC": dims.get("ADC", {}).get("score"),
                "IPC": dims.get("IPC", {}).get("score"),
                "AR":  dims.get("AR",  {}).get("score"),
                "CA":  dims.get("CA",  {}).get("score"),
                "GCH": dims.get("GCH", {}).get("score"),
                "age_mois": r.get("age_mois"),
            })
        pd.DataFrame(rows).to_csv("data/annotations/audit_export_pipeline.csv", index=False)
        log.info("Export CSV : data/annotations/audit_export_pipeline.csv")
        log.info("→ Lancer --calibrate après ≥2 runs espacés pour calibrer β_velocity")


if __name__ == "__main__":
    main()
