"""
Test de non-régression — parité inter-implémentations (T6, audit 10/07/2026).

Vérifie que batch_gemini_iro.py::compute_iro produit les mêmes scores que
iro-engine.ts (moteur canonique) sur le jeu de vecteurs partagé
tests/fixtures/parity-vectors.json. Voir tests/parity.vitest.test.ts pour
l'équivalent TypeScript, et le rapport d'audit du 10/07/2026 (constats T1/T2/T3)
pour le contexte de cette unification.

Exécution : GEMINI_API_KEY=dummy pytest tests/test_parity.py
(une clé factice suffit : ce test n'appelle jamais l'API Gemini, seule la
fonction pure compute_iro() est exercée.)
"""
import json
import os
import sys
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_compute_iro():
    os.environ.setdefault("GEMINI_API_KEY", "dummy_test_key")
    (ROOT / "data" / "annotations").mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location(
        "batch_gemini_iro", ROOT / "batch_gemini_iro.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.compute_iro


def _load_fixtures():
    with open(ROOT / "tests" / "fixtures" / "parity-vectors.json", encoding="utf-8") as f:
        return json.load(f)


def _dim(score, confiance=1.0):
    # Parité stricte : confiances par défaut à 1.0 (sauf IPC à 0.8)
    return {"score": score, "confiance": confiance, "justification": "test de parité"}


compute_iro = _load_compute_iro()
fixtures = _load_fixtures()


# Essai de support de pytest si importé, sinon simple assertion
try:
    import pytest
    
    @pytest.mark.parametrize("vector", fixtures["vectors"], ids=lambda v: v["label"])
    def test_parity_with_ts_engine(vector):
        conf_defaults = fixtures.get("confidence_defaults", {})
        ipc_conf = conf_defaults.get("ipcConf", 0.8)
        adc_conf = conf_defaults.get("adcConf", 1.0)
        gch_conf = conf_defaults.get("gchConf", 1.0)
        dims = {}
        for k, v in vector["scores"].items():
            if k == "IPC":
                conf = ipc_conf
            elif k == "ADC":
                conf = adc_conf
            elif k == "GCH":
                conf = gch_conf
            else:
                conf = 1.0
            dims[k] = _dim(v, conf)
            
        result = compute_iro(dims)
        assert abs(result["iro_100"] - vector["expected_iro"]) <= 0.1, (
            f"Divergence détectée pour {vector['label']} : "
            f"Python={result['iro_100']} vs attendu(TS)={vector['expected_iro']}"
        )
except ImportError:
    pass


# Exécutable directement avec: python3 tests/test_parity.py
if __name__ == "__main__":
    print("=== Démarrage du test de parité IRO (Python vs TS) ===")
    success = True
    conf_defaults = fixtures.get("confidence_defaults", {})
    ipc_conf = conf_defaults.get("ipcConf", 0.8)
    adc_conf = conf_defaults.get("adcConf", 1.0)
    gch_conf = conf_defaults.get("gchConf", 1.0)
    for vector in fixtures["vectors"]:
        dims = {}
        for k, v in vector["scores"].items():
            if k == "IPC":
                conf = ipc_conf
            elif k == "ADC":
                conf = adc_conf
            elif k == "GCH":
                conf = gch_conf
            else:
                conf = 1.0
            dims[k] = _dim(v, conf)
            
        result = compute_iro(dims)
        expected = vector["expected_iro"]
        diff = abs(result["iro_100"] - expected)
        if diff > 0.1:
            print(f"❌ [FAIL] {vector['label']}: Python={result['iro_100']} vs TS={expected} (diff={diff:.2f})")
            success = False
        else:
            print(f"✅ [PASS] {vector['label']}: {result['iro_100']} (parité parfaite)")
            
    if success:
        print("=== Tout est vert ! Parité validée à 100% ===")
        sys.exit(0)
    else:
        print("=== Échec du test de parité ===")
        sys.exit(1)
