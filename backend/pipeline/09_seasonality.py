"""
Step 9: L2_CATEGORY monthly seasonality via multiplicative seasonal_decompose.
Uses up to 3 years of cleaned history (or all available if shorter).

Recalculate seasonality multipliers every 3 months in production (see comment below).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from statsmodels.tsa.seasonal import seasonal_decompose

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import SEASONALITY_HISTORY_YEARS

CLEANED_PATH = ROOT / "outputs" / "cleaned_data.csv"
REC_PATH = ROOT / "outputs" / "recommendations_with_amounts.csv"
MULT_OUT = ROOT / "outputs" / "seasonality_multipliers.csv"
REC_OUT = ROOT / "outputs" / "recommendations_with_seasonality.csv"

# Production note: re-fit multipliers on a schedule (e.g. every calendar quarter)
# so the seasonal profile tracks recent demand shifts.
MIN_MONTHS_FOR_DECOMPOSE = 24


def _monthly_series_l2(sub: pd.DataFrame) -> pd.Series:
    """Sum NET_AMOUNT by calendar month start (from YEAR_MONTH string)."""
    g = sub.groupby("YM", observed=False)["NET_AMOUNT"].sum()
    g = g.sort_index()
    if g.empty:
        return g
    full = pd.date_range(g.index.min(), g.index.max(), freq="MS")
    return g.reindex(full, fill_value=0.0)


def _seasonal_multipliers_12m(ts: pd.Series) -> np.ndarray:
    """
    Return length-12 array of multipliers for months 1..12, mean normalized to 1.0.
    On failure or insufficient data, returns ones.
    """
    if ts is None or len(ts) < MIN_MONTHS_FOR_DECOMPOSE:
        return np.ones(12, dtype=float)

    # Multiplicative decomposition needs strictly positive values
    x = ts.astype(float).copy()
    x = x.clip(lower=1e-6)

    try:
        res = seasonal_decompose(
            x,
            model="multiplicative",
            period=12,
            extrapolate_trend="freq",
        )
    except (ValueError, np.linalg.LinAlgError):
        return np.ones(12, dtype=float)

    seas = res.seasonal.dropna()
    if seas.empty:
        return np.ones(12, dtype=float)

    # Average seasonal factor by calendar month (1-12) across years in sample
    by_m = seas.groupby(seas.index.month).mean()
    mult = np.ones(12, dtype=float)
    for m in range(1, 13):
        if m in by_m.index:
            mult[m - 1] = float(by_m.loc[m])

    # Normalize so mean over 12 months is 1.0 (multiplier 1.0 = normal)
    mmean = float(np.mean(mult))
    if mmean > 0:
        mult = mult / mmean
    return mult


def main() -> None:
    if not CLEANED_PATH.is_file():
        print("Input missing: outputs/cleaned_data.csv")
        print("Run step 1 first: python src/01_data_prep.py")
        sys.exit(1)
    if not REC_PATH.is_file():
        print("Input missing: outputs/recommendations_with_amounts.csv")
        print("Run step 8 first: python src/08_amount_forecasting.py")
        sys.exit(1)

    MULT_OUT.parent.mkdir(parents=True, exist_ok=True)

    tx = pd.read_csv(CLEANED_PATH, low_memory=False)
    tx["INV_DATE"] = pd.to_datetime(tx["INV_DATE"], errors="coerce")
    tx["L2_CATEGORY"] = tx["L2_CATEGORY"].astype(str)

    end = tx["INV_DATE"].max()
    start_3y = end - pd.DateOffset(years=SEASONALITY_HISTORY_YEARS)
    hist = tx.loc[tx["INV_DATE"] >= start_3y].copy()
    print(
        f"Seasonality history window ({SEASONALITY_HISTORY_YEARS}y): "
        f"{start_3y.date()} -> {end.date()} ({len(hist)} rows)"
    )

    hist["YM"] = pd.to_datetime(hist["YEAR_MONTH"].astype(str), errors="coerce")

    mult_rows: list[dict] = []
    for l2, sub in hist.groupby("L2_CATEGORY", observed=False):
        ts = _monthly_series_l2(sub)
        mult12 = _seasonal_multipliers_12m(ts)
        for m in range(1, 13):
            mult_rows.append(
                {
                    "L2_CATEGORY": l2,
                    "MONTH": m,
                    "SEASONALITY_MULTIPLIER": float(mult12[m - 1]),
                }
            )

    mult_df = pd.DataFrame(mult_rows)
    mult_df.to_csv(MULT_OUT, index=False)
    print(f"Saved: {MULT_OUT}  rows={len(mult_df)}")

    current_month = int(end.month)
    print(f"Current month (from max INV_DATE): {current_month}")

    cur = mult_df.loc[mult_df["MONTH"] == current_month, ["L2_CATEGORY", "SEASONALITY_MULTIPLIER"]]
    cur = cur.rename(columns={"SEASONALITY_MULTIPLIER": "_seas_join"})

    rec = pd.read_csv(REC_PATH, low_memory=False)
    rec["L2_CATEGORY"] = rec["L2_CATEGORY"].astype(str)
    out = rec.merge(cur, on="L2_CATEGORY", how="left")
    out["SEASONAL_MULTIPLIER"] = out["_seas_join"].fillna(1.0)
    out = out.drop(columns=["_seas_join"])
    out["FORECASTED_AMT_AFTER_SEASONALITY"] = (
        out["FORECASTED_AMT"] * out["SEASONAL_MULTIPLIER"]
    )
    out.to_csv(REC_OUT, index=False)

    print("FORECASTED_AMT_AFTER_SEASONALITY stats:")
    print(
        f"  min={out['FORECASTED_AMT_AFTER_SEASONALITY'].min():.2f} "
        f"max={out['FORECASTED_AMT_AFTER_SEASONALITY'].max():.2f}"
    )
    print(f"Saved: {REC_OUT}  rows={len(out)}")


if __name__ == "__main__":
    main()
