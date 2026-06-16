"""
Step 10: Promotional multipliers from promo-line history (EVENT_TAG + discount).
PPT: PROMOTIONAL_MULTIPLIER = max(1 - beta * avg_discount / 100, 1.0) per SKU x cluster.
Requires cleaned_data, clustered_data, recommendations_with_seasonality.
Writes outputs/recommendations_with_promotions.csv.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_windows import filter_last_n_months_in_year, non_seasonality_label

CLEANED_PATH = ROOT / "outputs" / "cleaned_data.csv"
CLUSTER_PATH = ROOT / "outputs" / "clustered_data.csv"
REC_PATH = ROOT / "outputs" / "recommendations_with_seasonality.csv"
OUTPUT_PATH = ROOT / "outputs" / "recommendations_with_promotions.csv"


def _beta_net_on_discount(disc: np.ndarray, net: np.ndarray) -> float | None:
    """Slope of NET_AMOUNT ~ DISCOUNT_PCT; None if not identified."""
    if len(disc) < 2:
        return None
    if np.nanstd(disc) <= 1e-12:
        return None
    x = disc.reshape(-1, 1)
    y = net
    lr = LinearRegression()
    lr.fit(x, y)
    return float(lr.coef_[0])


def main() -> None:
    for p, hint in [
        (CLEANED_PATH, "Run step 1 first: python src/01_data_prep.py"),
        (CLUSTER_PATH, "Run step 3 first: python src/03_clustering.py"),
        (REC_PATH, "Run step 9 first: python src/09_seasonality.py"),
    ]:
        if not p.is_file():
            print(f"Input missing: {p.name}")
            print(hint)
            sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    tx = pd.read_csv(CLEANED_PATH, low_memory=False)
    cl = pd.read_csv(CLUSTER_PATH, low_memory=False)[["STORE_ID", "CLUSTER_ID"]]

    tx["INV_DATE"] = pd.to_datetime(tx["INV_DATE"], errors="coerce")
    tx["STORE_ID"] = tx["STORE_ID"].astype(str)
    tx["SKU_CODE"] = tx["SKU_CODE"].astype(str)
    tx["EVENT_TAG"] = tx["EVENT_TAG"].astype(str)
    cl["STORE_ID"] = cl["STORE_ID"].astype(str)

    print(non_seasonality_label())
    tx12 = filter_last_n_months_in_year(tx).merge(cl, on="STORE_ID", how="inner")
    print(f"Promo stats window rows: {len(tx12)}")

    promo = tx12.loc[
        (tx12["EVENT_TAG"].str.upper() != "NONE")
        & (tx12["EVENT_TAG"].str.len() > 0)
        & (pd.to_numeric(tx12["DISCOUNT_PCT"], errors="coerce").fillna(0) > 0)
    ].copy()
    promo["DISCOUNT_PCT"] = pd.to_numeric(promo["DISCOUNT_PCT"], errors="coerce")
    promo["NET_AMOUNT"] = pd.to_numeric(promo["NET_AMOUNT"], errors="coerce")

    rows: list[dict] = []
    for (sku, cid), g in promo.groupby(["SKU_CODE", "CLUSTER_ID"], observed=False):
        disc = g["DISCOUNT_PCT"].to_numpy(dtype=float)
        net = g["NET_AMOUNT"].to_numpy(dtype=float)
        avg_disc = float(np.mean(disc))
        beta = _beta_net_on_discount(disc, net)
        if beta is None:
            pm = 1.0
        else:
            raw = 1.0 - (beta * avg_disc / 100.0)
            pm = float(max(raw, 1.0))
        rows.append(
            {
                "SKU_CODE": str(sku),
                "CLUSTER_ID": int(cid),
                "AVG_DISCOUNT_PCT": avg_disc,
                "BETA": beta if beta is not None else np.nan,
                "PROMOTIONAL_MULTIPLIER": pm,
            }
        )

    pm_df = pd.DataFrame(rows)
    print(f"Built promo multipliers for {len(pm_df)} (SKU_CODE, CLUSTER_ID) groups")

    elast_out = ROOT / "outputs" / "promo_elasticity_by_sku_cluster.csv"
    pm_df[["SKU_CODE", "CLUSTER_ID", "BETA", "AVG_DISCOUNT_PCT", "PROMOTIONAL_MULTIPLIER"]].to_csv(
        elast_out, index=False
    )
    print(f"Saved: {elast_out}")

    rec = pd.read_csv(REC_PATH, low_memory=False)
    rec["SKU_CODE"] = rec["SKU_CODE"].astype(str)
    rec["CLUSTER_ID"] = rec["CLUSTER_ID"].astype(int)

    out = rec.merge(
        pm_df[["SKU_CODE", "CLUSTER_ID", "PROMOTIONAL_MULTIPLIER"]],
        on=["SKU_CODE", "CLUSTER_ID"],
        how="left",
    )
    out["PROMOTIONAL_MULTIPLIER"] = out["PROMOTIONAL_MULTIPLIER"].fillna(1.0)
    out["FINAL_ADJUSTED_AMT"] = (
        out["FORECASTED_AMT_AFTER_SEASONALITY"] * out["PROMOTIONAL_MULTIPLIER"]
    )
    out.to_csv(OUTPUT_PATH, index=False)

    print(
        f"PROMOTIONAL_MULTIPLIER: min={out['PROMOTIONAL_MULTIPLIER'].min():.4f} "
        f"max={out['PROMOTIONAL_MULTIPLIER'].max():.4f}"
    )
    print(f"Saved: {OUTPUT_PATH}  rows={len(out)}")


if __name__ == "__main__":
    main()
