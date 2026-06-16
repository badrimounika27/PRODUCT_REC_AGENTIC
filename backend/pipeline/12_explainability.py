"""
Step 12: Add EXPLAINABILITY copy using PPT templates per SOURCE.
Requires outputs/recommendations_with_volume.csv.
Writes outputs/recommendations_with_explainability.csv.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
INPUT_PATH = ROOT / "outputs" / "recommendations_with_volume.csv"
OUTPUT_PATH = ROOT / "outputs" / "recommendations_with_explainability.csv"


def main() -> None:
    if not INPUT_PATH.is_file():
        print("Input missing: outputs/recommendations_with_volume.csv")
        print("Run step 11 first: python src/11_volume_forecasting.py")
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    rec = pd.read_csv(INPUT_PATH, low_memory=False)
    src = rec["SOURCE"].astype(str).str.strip().str.upper()
    x = (pd.to_numeric(rec["SCORE"], errors="coerce").fillna(0.0) * 100.0).round().astype(int)
    ante = rec["ANTECEDENT_PRODUCTS"].fillna("").astype(str).str.strip()

    fp = (
        x.astype(str)
        + "% of stores similar to yours that stock "
        + ante
        + " also stock this product"
    )
    pop = (
        x.astype(str)
        + "% of stores similar to yours are already buying this product"
    )
    als_txt = (
        "Based on your store's purchase pattern, stores "
        "with a similar profile also buy this product"
    )

    als_full = np.full(len(rec), als_txt, dtype=object)
    rec["EXPLAINABILITY"] = np.select(
        [src == "FPG", src == "POPULARITY", src == "ALS"],
        [fp, pop, als_full],
        default="",
    )
    rec.to_csv(OUTPUT_PATH, index=False)

    print(f"Saved: {OUTPUT_PATH}  rows={len(rec)}")


if __name__ == "__main__":
    main()
