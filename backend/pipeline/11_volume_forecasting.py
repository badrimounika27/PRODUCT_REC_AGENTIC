"""
Step 11: Volume from FINAL_ADJUSTED_AMT / MAX_LIST_PRICE (min volume 1).
MAX_LIST_PRICE = max(MRP) per SKU in cleaned data; fallback = mean MRP by L2_CATEGORY.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CLEANED_PATH = ROOT / "outputs" / "cleaned_data.csv"
REC_PATH = ROOT / "outputs" / "recommendations_with_promotions.csv"
OUTPUT_PATH = ROOT / "outputs" / "recommendations_with_volume.csv"


def main() -> None:
    if not CLEANED_PATH.is_file():
        print("Input missing: outputs/cleaned_data.csv")
        print("Run step 1 first: python src/01_data_prep.py")
        sys.exit(1)
    if not REC_PATH.is_file():
        print("Input missing: outputs/recommendations_with_promotions.csv")
        print("Run step 10 first: python src/10_promotional_adjustment.py")
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    tx = pd.read_csv(CLEANED_PATH, low_memory=False)
    tx["SKU_CODE"] = tx["SKU_CODE"].astype(str)
    tx["L2_CATEGORY"] = tx["L2_CATEGORY"].astype(str)
    tx["MRP"] = pd.to_numeric(tx["MRP"], errors="coerce")

    # Highest observed list price per SKU (same product across multiple SKUs -> max MRP)
    max_sku = tx.groupby("SKU_CODE", observed=False)["MRP"].max().rename("MAX_LIST_PRICE")
    l2_mrp = tx.groupby("L2_CATEGORY", observed=False)["MRP"].mean().rename("L2_MEAN_MRP")

    rec = pd.read_csv(REC_PATH, low_memory=False)
    rec["SKU_CODE"] = rec["SKU_CODE"].astype(str)
    rec["L2_CATEGORY"] = rec["L2_CATEGORY"].astype(str)

    rec = rec.merge(max_sku, on="SKU_CODE", how="left")
    rec = rec.merge(l2_mrp, on="L2_CATEGORY", how="left")
    rec["MAX_LIST_PRICE"] = rec["MAX_LIST_PRICE"].fillna(rec["L2_MEAN_MRP"])
    rec["MAX_LIST_PRICE"] = rec["MAX_LIST_PRICE"].replace(0, np.nan).fillna(rec["L2_MEAN_MRP"])
    rec["MAX_LIST_PRICE"] = rec["MAX_LIST_PRICE"].fillna(1.0)
    rec["MAX_LIST_PRICE"] = rec["MAX_LIST_PRICE"].clip(lower=1e-9)
    rec = rec.drop(columns=["L2_MEAN_MRP"], errors="ignore")

    fa = pd.to_numeric(rec["FINAL_ADJUSTED_AMT"], errors="coerce").fillna(0.0)
    vol = np.round(fa / rec["MAX_LIST_PRICE"]).astype(int)
    rec["VOLUME"] = np.maximum(vol, 1)

    rec.to_csv(OUTPUT_PATH, index=False)

    print(
        f"VOLUME stats: min={rec['VOLUME'].min()} max={rec['VOLUME'].max()} "
        f"mean={rec['VOLUME'].mean():.2f}"
    )
    print(f"Saved: {OUTPUT_PATH}  rows={len(rec)}")


if __name__ == "__main__":
    main()
