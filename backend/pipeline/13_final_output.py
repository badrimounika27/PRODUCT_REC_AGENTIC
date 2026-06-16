"""
Step 13: Final column selection, rename SCORE -> CONFIDENCE, sort, summary print.
Requires outputs/recommendations_with_explainability.csv.
Writes outputs/recommendations_final.csv.
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
INPUT_PATH = ROOT / "outputs" / "recommendations_with_explainability.csv"
OUTPUT_PATH = ROOT / "outputs" / "recommendations_final.csv"

FINAL_COLS = [
    "STORE_ID",
    "CLUSTER_ID",
    "SKU_CODE",
    "PRODUCT_NAME",
    "CATEGORY",
    "L2_CATEGORY",
    "SOURCE",
    "CONFIDENCE",
    "EXPLAINABILITY",
    "FORECASTED_AMT",
    "SEASONAL_MULTIPLIER",
    "FORECASTED_AMT_AFTER_SEASONALITY",
    "PROMOTIONAL_MULTIPLIER",
    "FINAL_ADJUSTED_AMT",
    "MAX_LIST_PRICE",
    "VOLUME",
    "RANK",
]


def _write_final_csv(df: pd.DataFrame) -> Path:
    """
    Write final CSV robustly.
    - Normal path: write to temp file then atomic replace target.
    - If target is locked, write a timestamped fallback file.
    """
    tmp_path = OUTPUT_PATH.with_suffix(".csv.tmp")
    df.to_csv(tmp_path, index=False)
    try:
        tmp_path.replace(OUTPUT_PATH)
        return OUTPUT_PATH
    except PermissionError:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        fallback = OUTPUT_PATH.with_name(f"recommendations_final_{ts}.csv")
        tmp_path.replace(fallback)
        print(
            "WARNING: recommendations_final.csv is locked by another program. "
            f"Saved fallback file instead: {fallback}"
        )
        return fallback


def main() -> None:
    if not INPUT_PATH.is_file():
        print("Input missing: outputs/recommendations_with_explainability.csv")
        print("Run step 12 first: python src/12_explainability.py")
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(INPUT_PATH, low_memory=False)
    df = df.rename(columns={"SCORE": "CONFIDENCE"})
    df = df[FINAL_COLS]
    df = df.sort_values(["STORE_ID", "RANK"], ascending=[True, True]).reset_index(
        drop=True
    )
    saved_path = _write_final_csv(df)

    n_stores = df["STORE_ID"].nunique()
    n_rows = len(df)
    avg_per = n_rows / n_stores if n_stores else 0.0

    src = df["SOURCE"].astype(str).str.strip().str.upper()
    br = {
        "FPG": int((src == "FPG").sum()),
        "POPULARITY": int((src == "POPULARITY").sum()),
        "ALS": int((src == "ALS").sum()),
    }

    vc = df["SKU_CODE"].value_counts().head(10)

    print("--- Final recommendations summary ---")
    print(f"Total unique stores with recommendations: {n_stores}")
    print(f"Total recommendation rows: {n_rows}")
    print(f"Average recommendations per store: {avg_per:.4f}")
    print("Top 10 most recommended SKUs overall:")
    for sku in vc.index:
        cnt = int(vc.loc[sku])
        pname = str(df.loc[df["SKU_CODE"] == sku, "PRODUCT_NAME"].iloc[0])
        if len(pname) > 72:
            pname = pname[:69] + "..."
        print(f"  {sku} | {pname} | count={cnt}")
    print(
        "Source breakdown: "
        f"FPG={br['FPG']}, POPULARITY={br['POPULARITY']}, ALS={br['ALS']}"
    )
    print(f"Saved: {saved_path}")


if __name__ == "__main__":
    main()
