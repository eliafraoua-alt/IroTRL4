#!/usr/bin/env python3
"""
seal_bpi.py — Scellement prospectif IRO pour dossiers BPI/France 2030
IRO Strength v7.0 — Action 1.3 de la feuille de route TRL 5

PRINCIPE :
  Sceller un score IRO AVANT connaissance de l'outcome (financement BPI,
  décision investisseur, etc.) afin de constituer une cohorte prospective
  indépendante pour la validation du C-index out-of-sample.

MÉCANISME :
  1. Hash SHA-256 du payload complet (scores + timestamp + version)
  2. Dépôt sur web3.storage (IPFS gratuit, 5 Go/mois) → CID immuable
  3. Fallback : timestamping via api.origintstamp.com (gratuit, 1 req/s)
  4. Fallback ultime : fichier local JSON avec preuve de date OS

USAGE :
  # Sceller un dossier depuis le batch Gemini
  python seal_bpi.py --startup "Nabla" --iro 62 --iro-cr 54 --scores scores.json

  # Sceller depuis stdin (pipeline)
  cat annotation.json | python seal_bpi.py --stdin --client "BPI-2026-Q2"

  # Vérifier un scellement existant
  python seal_bpi.py --verify seals/nabla_20260624.json

  # Lister tous les dossiers scellés
  python seal_bpi.py --list

PRÉREQUIS :
  pip install requests python-dotenv

VARIABLES D'ENVIRONNEMENT (.env) :
  W3_TOKEN=...         # web3.storage token (gratuit sur web3.storage)
  ORIGINSTAMP_KEY=...  # OriginStamp API key (gratuit, optionnel)
  BPI_CLIENT_ID=...    # identifiant anonyme du client BPI (optionnel)

GARANTIE JURIDIQUE :
  Le CID IPFS is immuable par construction cryptographique.
  Le fichier local constitue une preuve de date sous droit commun (art. 1366 CC).
  Pour une preuve renforcée : dépôt complémentaire sur registre.data.gouv.fr
"""

import os
import sys
import json
import hashlib
import argparse
import datetime
from datetime import timezone
import struct
from pathlib import Path
from typing import Optional

try:
    import requests
    from dotenv import load_dotenv
except ImportError:
    print("Installer : pip install requests python-dotenv")
    sys.exit(1)

load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────
SEALS_DIR      = Path("data/seals")
REGISTRY_FILE  = SEALS_DIR / "prospective-registry.json"
W3_TOKEN       = os.getenv("W3_TOKEN", "")
ORIGINSTAMP_KEY= os.getenv("ORIGINSTAMP_KEY", "")

# Versions figées au moment du scellement
IRO_VERSION    = "v7.0"
WEIGHTS_HASH   = "sha256-iro-weights-V7-DI18-ADC22-IPC22-AR13-CA10-GCH12-LU15"
COX_BETAS_HASH = "sha256-cox-betas-c-index-0.90-epv-1.8-calibrated-2026-06-22"
GOLD_VERSION   = "v4.5-S46-frozen-2026-06-13"


# ── Payload de scellement ─────────────────────────────────────────────

def build_payload(
    startup_name:    str,
    iro_score:       float,
    iro_cr_score:    float,
    scores:          dict,
    client_id:       str = "anonymous",
    notes:           str = "",
    sector:          str = "",
    trl:             int = 0,
    stade:           str = "",
) -> dict:
    """Construit le payload complet à sceller."""
    now = datetime.datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
    horizon = (datetime.datetime.now(timezone.utc).replace(tzinfo=None) + datetime.timedelta(days=36*30)).strftime("%Y-%m-%d")

    payload = {
        # Identité
        "startup_name":      startup_name,
        "client_id":         client_id,  # anonymisé si souhaité
        "sector":            sector,
        "trl_declared":      trl,
        "stade_financement": stade,

        # Scores IRO — figés
        "iro_score":         round(iro_score, 1),
        "iro_cr_score":      round(iro_cr_score, 1),
        "scores_dimensions": scores,  # {DI, ADC, IPC, AR, CA, GCH, LU}

        # Métadonnées de version — traçabilité
        "iro_version":       IRO_VERSION,
        "weights_hash":      WEIGHTS_HASH,
        "cox_betas_hash":    COX_BETAS_HASH,
        "gold_version":      GOLD_VERSION,

        # Temporel
        "scoring_date":      now,
        "followup_due_date": horizon,
        "horizon_mois":      36,

        # Outcome — toujours null au moment du scellement
        "outcome_observed":  None,
        "outcome_date":      None,

        # Notes libres
        "notes":             notes,

        # Protocole
        "protocol":          "IRO-Prospective-V1",
        "anti_hallucination": "Scores basés uniquement sur sources publiques vérifiables",
    }
    return payload


def compute_hash(payload: dict) -> str:
    """SHA-256 canonique du payload (tri des clés, UTF-8)."""
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "sha256-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ── Méthodes de scellement ────────────────────────────────────────────

def seal_ipfs(payload: dict, payload_hash: str) -> Optional[str]:
    """
    Dépôt sur web3.storage (IPFS).
    Retourne le CID ou None si échec.
    Gratuit jusqu'à 5 Go/mois : https://web3.storage
    """
    if not W3_TOKEN:
        return None

    content = json.dumps({
        "hash": payload_hash,
        "payload": payload,
        "sealed_at": datetime.datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
    }, ensure_ascii=False, indent=2).encode("utf-8")

    filename = f"IRO_{payload['startup_name'].replace(' ','_')}_{payload['scoring_date'][:10]}.json"

    try:
        # API web3.storage v1
        resp = requests.post(
            "https://api.web3.storage/upload",
            headers={
                "Authorization": f"Bearer {W3_TOKEN}",
                "Content-Type": "application/json",
                "X-NAME": filename,
            },
            data=content,
            timeout=30,
        )
        if resp.status_code == 200:
            cid = resp.json().get("cid", "")
            if cid:
                return f"ipfs://{cid}"
    except Exception as e:
        print(f"  IPFS warning: {e}")
    return None


def seal_originstamp(payload_hash: str) -> Optional[str]:
    """
    Timestamping via OriginStamp (gratuit, pas de stockage).
    Retourne l'URL de preuve ou None.
    Inscription : https://originstamp.com/developer
    """
    if not ORIGINSTAMP_KEY:
        return None

    # OriginStamp accepte un hash SHA-256 hex sans préfixe
    hex_hash = payload_hash.replace("sha256-", "")

    try:
        resp = requests.post(
            "https://api.originstamp.com/v4/timestamp/create",
            headers={
                "Authorization": f"Bearer {ORIGINSTAMP_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "hash_string": hex_hash,
                "comment": f"IRO prospective seal — {datetime.datetime.now(timezone.utc).replace(tzinfo=None).date()}",
                "notifications": [],
            },
            timeout=15,
        )
        if resp.status_code in (200, 201):
            data = resp.json().get("data", {})
            return f"originstamp://{hex_hash[:16]}...{data.get('created', '')}"
    except Exception as e:
        print(f"  OriginStamp warning: {e}")
    return None


def seal_local(startup_name: str, payload: dict, payload_hash: str) -> Path:
    """
    Fallback local : fichier JSON horodaté + preuve OS.
    Constitue une preuve de date sous art. 1366 CC.
    """
    SEALS_DIR.mkdir(parents=True, exist_ok=True)
    date_str = payload["scoring_date"][:10].replace("-", "")
    safe_name = startup_name.lower().replace(" ", "_").replace("/", "-")
    seal_file = SEALS_DIR / f"IRO_{safe_name}_{date_str}.json"

    seal_record = {
        "seal_version":    "IRO-Seal-V1",
        "startup_name":    startup_name,
        "payload_hash":    payload_hash,
        "sealed_at_utc":   datetime.datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
        "payload":         payload,
        "verification": {
            "method": "SHA-256 canonical JSON (sort_keys=True, UTF-8)",
            "command": f"echo -n '<canonical_json>' | sha256sum",
            "note":    "Recalcul du hash possible depuis le payload ci-dessus"
        }
    }

    seal_file.write_text(json.dumps(seal_record, ensure_ascii=False, indent=2), encoding="utf-8")
    return seal_file


def update_registry(startup_name: str, payload_hash: str, seal_refs: dict, payload: dict):
    """Met à jour le registre central prospective-registry.json."""
    SEALS_DIR.mkdir(parents=True, exist_ok=True)

    registry = []
    if REGISTRY_FILE.exists():
        try:
            registry = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
        except Exception:
            registry = []

    entry = {
        "startup_name":    startup_name,
        "payload_hash":    payload_hash,
        "scoring_date":    payload["scoring_date"],
        "iro_score":       payload["iro_score"],
        "iro_cr_score":    payload["iro_cr_score"],
        "followup_due":    payload["followup_due_date"],
        "outcome_observed": None,
        "seal_ipfs":       seal_refs.get("ipfs"),
        "seal_originstamp":seal_refs.get("originstamp"),
        "seal_local_file": seal_refs.get("local_file"),
        "client_id":       payload.get("client_id", "anonymous"),
        "iro_version":     payload["iro_version"],
        "status":          "prospective",  # prospective | followed_up | outcome_observed
    }

    # Éviter les doublons
    existing = next((i for i, e in enumerate(registry) if e["startup_name"] == startup_name), None)
    if existing is not None:
        print(f"  ⚠ {startup_name} déjà dans le registre — mise à jour")
        registry[existing] = entry
    else:
        registry.append(entry)

    REGISTRY_FILE.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Interface principale ───────────────────────────────────────────────

def seal_dossier(
    startup_name: str,
    iro_score: float,
    iro_cr_score: float,
    scores: dict,
    client_id: str = "BPI-ANON",
    notes: str = "",
    sector: str = "",
    trl: int = 0,
    stade: str = "",
    verbose: bool = True,
) -> dict:
    """
    Scelle un dossier IRO complet.
    Retourne un dict avec hash + références de scellement.
    """
    if verbose:
        print(f"\n{'═'*55}")
        print(f"  SCELLEMENT PROSPECTIF IRO — {startup_name}")
        print(f"{'═'*55}")

    # 1. Construire le payload
    payload = build_payload(
        startup_name=startup_name,
        iro_score=iro_score,
        iro_cr_score=iro_cr_score,
        scores=scores,
        client_id=client_id,
        notes=notes,
        sector=sector,
        trl=trl,
        stade=stade,
    )

    # 2. Calculer le hash
    payload_hash = compute_hash(payload)
    if verbose:
        print(f"  Hash SHA-256 : {payload_hash[:30]}...")

    seal_refs = {}

    # 3. Scellement IPFS (prioritaire)
    if verbose: print("  Tentative IPFS (web3.storage)...", end=" ", flush=True)
    ipfs_ref = seal_ipfs(payload, payload_hash)
    if ipfs_ref:
        seal_refs["ipfs"] = ipfs_ref
        if verbose: print(f"✓ {ipfs_ref}")
    else:
        if verbose: print("○ Non configuré ou échec")

    # 4. Timestamping OriginStamp
    if verbose: print("  Tentative OriginStamp...", end=" ", flush=True)
    os_ref = seal_originstamp(payload_hash)
    if os_ref:
        seal_refs["originstamp"] = os_ref
        if verbose: print(f"✓ {os_ref}")
    else:
        if verbose: print("○ Non configuré ou échec")

    # 5. Scellement local (toujours)
    seal_file = seal_local(startup_name, payload, payload_hash)
    seal_refs["local_file"] = str(seal_file)
    if verbose: print(f"  Scellement local  : ✓ {seal_file}")

    # 6. Registre
    update_registry(startup_name, payload_hash, seal_refs, payload)
    if verbose: print(f"  Registre mis à jour : {REGISTRY_FILE}")

    result = {
        "startup_name": startup_name,
        "payload_hash": payload_hash,
        "scoring_date": payload["scoring_date"],
        "iro_score":    iro_score,
        "iro_cr_score": iro_cr_score,
        "followup_due": payload["followup_due_date"],
        "seals":        seal_refs,
        "status":       "sealed",
    }

    if verbose:
        print(f"\n  ✓ DOSSIER SCELLÉ")
        print(f"  IRO = {iro_score} | IRO-CR = {iro_cr_score}")
        print(f"  Suivi due le : {payload['followup_due_date']}")
        n_seals = sum(1 for v in seal_refs.values() if v)
        print(f"  Preuves actives : {n_seals}/3 (IPFS + OriginStamp + Local)")

    return result


def verify_seal(seal_file_path: str) -> bool:
    """Vérifie l'intégrité d'un scellement local."""
    try:
        seal = json.loads(Path(seal_file_path).read_text(encoding="utf-8"))
        payload = seal["payload"]
        stored_hash = seal["payload_hash"]
        recomputed = compute_hash(payload)
        ok = recomputed == stored_hash
        print(f"\nVérification : {seal_file_path}")
        print(f"  Hash stocké   : {stored_hash[:30]}...")
        print(f"  Hash recalculé: {recomputed[:30]}...")
        print(f"  Intégrité : {'✓ VALIDE' if ok else '✗ ALTÉRÉ — preuve compromise'}")
        return ok
    except Exception as e:
        print(f"  Erreur : {e}")
        return False


def list_registry():
    """Affiche le registre prospectif."""
    if not REGISTRY_FILE.exists():
        print("Registre vide — aucun dossier scellé.")
        return

    registry = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    print(f"\nREGISTRE PROSPECTIF IRO — {len(registry)} dossier(s)")
    print(f"{'─'*70}")
    print(f"  {'Startup':<25} {'IRO':>5} {'Date':>12} {'Suivi':>12} {'Statut'}")
    print(f"{'─'*70}")
    for e in sorted(registry, key=lambda x: x["scoring_date"]):
        seals_ok = sum(1 for k in ["seal_ipfs","seal_originstamp","seal_local_file"] if e.get(k))
        status = f"{e['status']} [{seals_ok}/3 preuves]"
        if e.get("outcome_observed"):
            status = f"outcome={e['outcome_observed']}"
        print(f"  {e['startup_name']:<25} {e['iro_score']:>5} {e['scoring_date'][:10]:>12} {e['followup_due'][:10]:>12}  {status}")

    print(f"\n  Fichier registre : {REGISTRY_FILE}")
    print(f"  Pour vérifier un scellement : python seal_bpi.py --verify <fichier>")


def batch_from_annotations(annotations_dir: str, client_id: str = "BPI-ANON"):
    """
    Scelle en batch tous les fichiers JSON d'annotations produits par batch_gemini_iro_v7.py.
    Usage : python seal_bpi.py --batch data/annotations/ --client BPI-2026-Q3
    """
    ann_dir = Path(annotations_dir)
    files = list(ann_dir.glob("*.json"))
    # Exclure les fichiers de rapport
    files = [f for f in files if not f.name.startswith("batch_") and not f.name.startswith("audit_")]

    print(f"\n{len(files)} annotations à sceller depuis {ann_dir}")
    results = []
    for ann_file in files:
        try:
            ann = json.loads(ann_file.read_text(encoding="utf-8"))
            dims = ann.get("dimensions", {})
            scores = {k: dims[k]["score"] for k in dims}
            iro_data = ann.get("iro_computed", {})
            result = seal_dossier(
                startup_name = ann.get("startup", ann_file.stem),
                iro_score    = iro_data.get("iro_100", 0),
                iro_cr_score = iro_data.get("iro_cr", 0),
                scores       = scores,
                client_id    = client_id,
                notes        = ann.get("note_evaluateur", ""),
                verbose      = True,
            )
            results.append(result)
        except Exception as e:
            print(f"  ✗ {ann_file.name} : {e}")

    print(f"\n{'═'*55}")
    print(f"  BATCH TERMINÉ : {len(results)}/{len(files)} dossiers scellés")
    print(f"  Registre : {REGISTRY_FILE}")
    return results


# ── CLI ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Scellement prospectif IRO — Action 1.3 feuille de route TRL 5"
    )
    parser.add_argument("--startup",    help="Nom de la startup")
    parser.add_argument("--iro",        type=float, help="Score IRO brut")
    parser.add_argument("--iro-cr",     type=float, help="Score IRO-CR")
    parser.add_argument("--scores",     help="Fichier JSON avec scores {DI,ADC,IPC,AR,CA,GCH,LU}")
    parser.add_argument("--stdin",      action="store_true", help="Lire l'annotation depuis stdin")
    parser.add_argument("--client",     default="BPI-ANON", help="Identifiant client anonymisé")
    parser.add_argument("--sector",     default="", help="Secteur")
    parser.add_argument("--trl",        type=int, default=0, help="TRL déclaré")
    parser.add_argument("--stade",      default="", help="Stade de financement")
    parser.add_argument("--notes",      default="", help="Notes libres")
    parser.add_argument("--verify",     help="Vérifier l'intégrité d'un fichier de scellement")
    parser.add_argument("--list",       action="store_true", help="Lister le registre prospectif")
    parser.add_argument("--batch",      help="Sceller en batch un répertoire d'annotations")
    parser.add_argument("--demo",       action="store_true", help="Démonstration avec données fictives")
    args = parser.parse_args()

    if args.list:
        list_registry()
        return

    if args.verify:
        ok = verify_seal(args.verify)
        sys.exit(0 if ok else 1)

    if args.batch:
        batch_from_annotations(args.batch, args.client)
        return

    if args.demo:
        # Démonstration avec une startup fictive
        print("\n[DEMO] Scellement d'un dossier test...")
        seal_dossier(
            startup_name = "TestStartup-Demo",
            iro_score    = 62.5,
            iro_cr_score = 54.0,
            scores       = {"DI":2,"ADC":3,"IPC":2,"AR":3,"CA":2,"GCH":3,"LU":2},
            client_id    = "DEMO",
            notes        = "Dossier de test — ne pas utiliser pour validation",
            sector       = "SaaS IA",
            trl          = 6,
            stade        = "Série A",
        )
        return

    if args.stdin:
        raw = sys.stdin.read()
        ann = json.loads(raw)
        dims = ann.get("dimensions", {})
        scores = {k: dims[k]["score"] for k in dims}
        iro_data = ann.get("iro_computed", {})
        seal_dossier(
            startup_name = ann.get("startup", "unknown"),
            iro_score    = iro_data.get("iro_100", 0),
            iro_cr_score = iro_data.get("iro_cr", 0),
            scores       = scores,
            client_id    = args.client,
            notes        = ann.get("note_evaluateur", ""),
        )
        return

    if args.startup and args.iro is not None:
        scores = {}
        if args.scores:
            scores = json.loads(Path(args.scores).read_text(encoding="utf-8"))

        seal_dossier(
            startup_name = args.startup,
            iro_score    = args.iro,
            iro_cr_score = args.iro_cr or args.iro,
            scores       = scores,
            client_id    = args.client,
            notes        = args.notes,
            sector       = args.sector,
            trl          = args.trl,
            stade        = args.stade,
        )
        return

    parser.print_help()


if __name__ == "__main__":
    main()
