"""Forecast simulator: seasonality multipliers + amount simulation (Mousum formula)."""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path
import os
from typing import Any, Optional
from urllib.parse import unquote

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(tags=["forecast"])

DEFAULT_BETA = 0.18
# promo_elasticity CSV stores NET_AMOUNT ~ DISCOUNT_PCT regression slopes (scale varies wildly).
# The simulator expects a unitless elasticity-style coefficient in roughly 0.02–0.55.
ELASTICITY_MIN = 0.02
ELASTICITY_MAX = 0.55


def _engine_root() -> Path:
    import config as recai_config

    p = recai_config.engine_root()
    if not p.is_dir():
        raise HTTPException(status_code=503, detail=f"backend root not found at {p}")
    return p


def _seasonality_csv_path(engine: Path) -> Optional[Path]:
    """Resolve seasonality_multipliers.csv — read fresh on every call so new pipeline runs show up without restart."""
    engine = engine.resolve()
    primary = engine / "outputs" / "seasonality_multipliers.csv"
    if primary.is_file():
        return primary
    env_path = os.environ.get("SEASONALITY_MULTIPLIERS_CSV", "").strip()
    if env_path:
        ep = Path(env_path).expanduser().resolve()
        if ep.is_file():
            return ep
    return None


def _load_seasonality_df(engine: Path) -> pd.DataFrame:
    """Read fresh each call so new pipeline runs show up without server restart."""
    p = _seasonality_csv_path(engine)
    if p is None:
        return pd.DataFrame()
    try:
        return pd.read_csv(p, low_memory=False)
    except Exception:
        return pd.DataFrame()


@lru_cache(maxsize=1)
def _load_elasticity_df(engine_s: str) -> pd.DataFrame:
    p = Path(engine_s) / "outputs" / "promo_elasticity_by_sku_cluster.csv"
    if not p.is_file():
        return pd.DataFrame()
    return pd.read_csv(p, low_memory=False)


@lru_cache(maxsize=1)
def _date_span_years(engine_s: str) -> float:
    """Approximate years of history in cleaned_data (for status card)."""
    p = Path(engine_s) / "outputs" / "cleaned_data.csv"
    if not p.is_file():
        return 0.0
    try:
        df = pd.read_csv(p, usecols=["INV_DATE"], low_memory=False)
        df["INV_DATE"] = pd.to_datetime(df["INV_DATE"], errors="coerce")
        s = df["INV_DATE"].dropna()
        if len(s) < 2:
            return 0.0
        days = (s.max() - s.min()).days
        return max(0.0, days / 365.25)
    except Exception:
        return 0.0


def _multipliers_for_l2(engine: Path, l2: str) -> dict[int, float]:
    df = _load_seasonality_df(engine)
    if df.empty or "L2_CATEGORY" not in df.columns:
        return {m: 1.0 for m in range(1, 13)}
    sub = df.loc[df["L2_CATEGORY"].astype(str).str.strip() == str(l2).strip()]
    if sub.empty:
        return {m: 1.0 for m in range(1, 13)}
    out = {m: 1.0 for m in range(1, 13)}
    for _, row in sub.iterrows():
        m = int(row["MONTH"])
        if 1 <= m <= 12:
            out[m] = float(row["SEASONALITY_MULTIPLIER"])
    return out


def _beta_for(engine: Path, sku: str, cluster_id: int) -> float:
    df = _load_elasticity_df(str(engine))
    if df.empty:
        return DEFAULT_BETA
    sku = str(sku).strip()
    sub = df.loc[
        (df["SKU_CODE"].astype(str).str.strip() == sku)
        & (df["CLUSTER_ID"].astype(int) == int(cluster_id))
    ]
    if sub.empty:
        return DEFAULT_BETA
    b = float(sub["BETA"].iloc[0])
    if pd.isna(b) or not math.isfinite(b):
        return DEFAULT_BETA
    b = abs(b)
    if b < ELASTICITY_MIN or b > ELASTICITY_MAX:
        return DEFAULT_BETA
    return b


def _discount_adjustment(beta: float, discount_pct: float) -> float:
    """Factor applied after seasonality: 1 - elasticity * discount%, floored for stability."""
    raw = 1.0 - (beta * float(discount_pct) / 100.0)
    return float(max(raw, 0.01))


def _signal_for(mult: float, best_m: int, worst_m: int, month: int) -> str:
    if month == best_m:
        return "best"
    if mult >= 1.0:
        return "push"
    return "wait"


@router.get("/seasonality/{category}")
def get_seasonality_multipliers(category: str) -> dict[str, Any]:
    """
    Seasonality multipliers for one L2_CATEGORY (exact string as in CSV).
    Path segment may be URL-encoded.
    """
    engine = _engine_root()
    cat = unquote(category).strip()
    mults = _multipliers_for_l2(engine, cat)
    mult_str = {str(k): round(v, 4) for k, v in mults.items()}
    vals = list(mults.values())
    best_month = int(max(range(1, 13), key=lambda m: mults[m]))
    worst_month = int(min(range(1, 13), key=lambda m: mults[m]))
    years = _date_span_years(str(engine))
    data_years = max(1, min(4, int(round(years)))) if years > 0 else 1
    return {
        "category": cat,
        "multipliers": mult_str,
        "best_month": best_month,
        "worst_month": worst_month,
        "data_years_available": data_years,
        "history_span_years": round(years, 2),
    }


@router.get("/forecast/simulate")
def forecast_simulate(
    store_id: str = Query(..., description="Store ID"),
    sku_code: str = Query(..., description="SKU code"),
    month: int = Query(..., ge=1, le=12, description="Calendar month 1-12"),
    discount_pct: float = Query(0.0, ge=0.0, le=50.0, description="Discount 0-50"),
) -> dict[str, Any]:
    engine = _engine_root()
    path = engine / "outputs" / "recommendations_final.csv"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="recommendations_final.csv not found.")
    df = pd.read_csv(path, low_memory=False)
    df["STORE_ID"] = df["STORE_ID"].astype(str)
    df["SKU_CODE"] = df["SKU_CODE"].astype(str)
    sub = df.loc[(df["STORE_ID"] == str(store_id)) & (df["SKU_CODE"] == str(sku_code))]
    if sub.empty:
        raise HTTPException(status_code=404, detail="No recommendation for this store and SKU.")
    row = sub.iloc[0]
    base = float(row.get("FORECASTED_AMT", 0) or 0)
    l2 = str(row.get("L2_CATEGORY", "") or "")
    cluster_id = int(row["CLUSTER_ID"])
    mrp = float(row.get("MAX_LIST_PRICE", 0) or 0)
    if mrp <= 0:
        mrp = 1.0
    promo_mult = float(row.get("PROMOTIONAL_MULTIPLIER", 1) or 1)
    if not math.isfinite(promo_mult) or promo_mult <= 0:
        promo_mult = 1.0

    mults = _multipliers_for_l2(engine, l2)
    season = float(mults.get(int(month), 1.0))
    beta = _beta_for(engine, sku_code, cluster_id)
    disc_adj = _discount_adjustment(beta, discount_pct)
    # Slide: Adjusted forecasted amount = base × seasonality × promotional adjustment; volume ≈ adjusted / list price
    amt_after_season = base * season
    adjusted_forecast_amt = amt_after_season * promo_mult
    final_amt = adjusted_forecast_amt * disc_adj
    volume = int(max(round(final_amt / mrp), 1)) if mrp > 0 else 1

    best_m = int(max(range(1, 13), key=lambda m: mults[m]))
    worst_m = int(min(range(1, 13), key=lambda m: mults[m]))
    sig = _signal_for(season, best_m, worst_m, int(month))

    return {
        "store_id": str(store_id),
        "sku_code": str(sku_code),
        "month": int(month),
        "discount_pct": float(discount_pct),
        "l2_category": l2,
        "base_forecast_amt": round(base, 2),
        "seasonality_factor": round(season, 4),
        "amt_after_seasonality": round(amt_after_season, 2),
        "promotional_multiplier": round(promo_mult, 6),
        "adjusted_forecast_amt": round(adjusted_forecast_amt, 2),
        "price_elasticity_beta": round(beta, 4),
        "discount_adjustment": round(disc_adj, 4),
        "final_adjusted_amt": round(final_amt, 2),
        "max_list_price": round(mrp, 2),
        "volume": volume,
        "signal": sig,
        "best_month": best_m,
        "worst_month": worst_m,
    }


@router.get("/seasonality/l2_categories")
def list_l2_categories() -> dict[str, Any]:
    """Distinct L2_CATEGORY values from seasonality_multipliers.csv (for dashboards)."""
    engine = _engine_root()
    df = _load_seasonality_df(engine)
    if df.empty or "L2_CATEGORY" not in df.columns:
        return {"categories": []}
    cats = sorted(df["L2_CATEGORY"].astype(str).str.strip().unique().tolist())
    return {"categories": [c for c in cats if c]}


def clear_forecast_caches() -> None:
    """Invalidate caches if pipeline outputs are replaced (optional)."""
    _load_elasticity_df.cache_clear()
    _date_span_years.cache_clear()
