"""
Backend configuration.

Merged from the legacy RECAI_AGENTIC/config.py and recommendation_engine/config.py.
Single source of truth for:
  - Tunable pipeline knobs (overridable at runtime via PUT /config and runtime_config.json).
  - DS pipeline constants (data windows, seasonality history).
  - Path helpers used by the API, agents, and scripts.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Roots
# ---------------------------------------------------------------------------

BACKEND_ROOT = Path(__file__).resolve().parent
RUNTIME_CONFIG_PATH = BACKEND_ROOT / "runtime_config.json"

# Backwards-compat alias used by api.main and a few agent modules.
RECAI_ROOT = BACKEND_ROOT


# ---------------------------------------------------------------------------
# Tunable pipeline knobs (mutable at runtime via /config)
# ---------------------------------------------------------------------------

EXCLUSION_WINDOW_MONTHS = 6
TARGET_GROWTH = 0.20
FPG_MIN_SUPPORT = 0.08
FPG_MIN_CONFIDENCE = 0.15
FPG_MIN_LIFT = 1.0
ALS_FACTORS = 50
ALS_ITERATIONS = 20
ALS_REGULARIZATION = 0.1
TOP_N_RECOMMENDATIONS = 20
DATA_WINDOW_CLUSTERING_MONTHS = 6
DATA_WINDOW_RECO_MONTHS = 3


# ---------------------------------------------------------------------------
# DS pipeline constants (immutable; from legacy recommendation_engine/config.py)
# ---------------------------------------------------------------------------

# Non-seasonality modeling uses the last N calendar months within this year (see data_windows.py).
NON_SEASONALITY_YEAR = 2025
NON_SEASONALITY_MONTHS = 6

# Seasonality (step 09) uses INV_DATE window of this many years ending at max date in cleaned data.
SEASONALITY_HISTORY_YEARS = 3


_CONFIG_KEYS = frozenset(
    {
        "EXCLUSION_WINDOW_MONTHS",
        "TARGET_GROWTH",
        "FPG_MIN_SUPPORT",
        "FPG_MIN_CONFIDENCE",
        "FPG_MIN_LIFT",
        "ALS_FACTORS",
        "ALS_ITERATIONS",
        "ALS_REGULARIZATION",
        "TOP_N_RECOMMENDATIONS",
        "DATA_WINDOW_CLUSTERING_MONTHS",
        "DATA_WINDOW_RECO_MONTHS",
    }
)


def _base_dict() -> dict:
    return {
        "EXCLUSION_WINDOW_MONTHS": EXCLUSION_WINDOW_MONTHS,
        "TARGET_GROWTH": TARGET_GROWTH,
        "FPG_MIN_SUPPORT": FPG_MIN_SUPPORT,
        "FPG_MIN_CONFIDENCE": FPG_MIN_CONFIDENCE,
        "FPG_MIN_LIFT": FPG_MIN_LIFT,
        "ALS_FACTORS": ALS_FACTORS,
        "ALS_ITERATIONS": ALS_ITERATIONS,
        "ALS_REGULARIZATION": ALS_REGULARIZATION,
        "TOP_N_RECOMMENDATIONS": TOP_N_RECOMMENDATIONS,
        "DATA_WINDOW_CLUSTERING_MONTHS": DATA_WINDOW_CLUSTERING_MONTHS,
        "DATA_WINDOW_RECO_MONTHS": DATA_WINDOW_RECO_MONTHS,
    }


def _load_runtime_overrides() -> dict:
    if not RUNTIME_CONFIG_PATH.is_file():
        return {}
    try:
        data = json.loads(RUNTIME_CONFIG_PATH.read_text(encoding="utf-8"))
        return {k: v for k, v in data.items() if k in _CONFIG_KEYS}
    except (json.JSONDecodeError, OSError):
        return {}


def get_effective_config() -> dict:
    """Merged defaults + runtime_config.json."""
    merged = _base_dict()
    merged.update(_load_runtime_overrides())
    return merged


def save_runtime_overrides(updates: dict) -> dict:
    bad = [k for k in updates if k not in _CONFIG_KEYS]
    if bad:
        raise ValueError(f"Unknown config keys: {bad}")
    current = _load_runtime_overrides()
    current.update({k: updates[k] for k in updates})
    RUNTIME_CONFIG_PATH.write_text(
        json.dumps(current, indent=2), encoding="utf-8"
    )
    return get_effective_config()


# ---------------------------------------------------------------------------
# Path helpers (replace the old engine_root() indirection)
# ---------------------------------------------------------------------------

def pipeline_dir() -> Path:
    """Directory containing the 13 ML step scripts (01_*.py … 13_*.py)."""
    return BACKEND_ROOT / "pipeline"


def outputs_dir() -> Path:
    """Directory where the pipeline writes CSVs (read by the API)."""
    return BACKEND_ROOT / "outputs"


def data_dir() -> Path:
    """Top-level data dir; raw input is at data/raw/transactions.csv."""
    return BACKEND_ROOT / "data"


def engine_root() -> Path:
    """
    Backwards-compatible alias used by older API/agent code that expected the
    'recommendation_engine' folder structure (outputs/, data/raw/, …).
    Now those subfolders live directly under backend/, so this just returns BACKEND_ROOT.
    Override with RECOMMENDATION_ENGINE_ROOT env var if you have an external dataset.
    """
    override = os.environ.get("RECOMMENDATION_ENGINE_ROOT", "").strip()
    if override:
        p = Path(override).expanduser().resolve()
        if p.is_dir():
            return p
    return BACKEND_ROOT


# ---------------------------------------------------------------------------
# B2C (customer-behavior) paths — isolated from the B2B pipeline
# ---------------------------------------------------------------------------

# Default sample name; can be pointed at a larger sample via env var.
B2C_INPUT_FILENAME = os.environ.get("B2C_INPUT_FILENAME", "user_behavior_sampled_50k.csv")

# Reference "today" for RFM recency. UserBehavior 2017 data ends 2017-12-03,
# so we use 2017-12-04 as the day-after-last snapshot date.
B2C_REFERENCE_DATE = "2017-12-04"

# Official raw data window (Nov 25 – Dec 3, 2017 UTC) — used to strip malformed rows.
B2C_VALID_TS_MIN = 1511539200   # 2017-11-25 00:00:00 UTC
B2C_VALID_TS_MAX = 1512432000   # 2017-12-05 00:00:00 UTC


def b2c_input_path() -> Path:
    """Sampled raw CSV that the B2C pipeline reads from."""
    return BACKEND_ROOT / "data" / "raw" / B2C_INPUT_FILENAME


def b2c_outputs_dir() -> Path:
    """Directory where the B2C pipeline writes CSVs (read by /api/b2c/*)."""
    return BACKEND_ROOT / "outputs" / "b2c"
