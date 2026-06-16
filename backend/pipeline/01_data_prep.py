"""
Step 1: Load raw transactions, clean, and write outputs/cleaned_data.csv.
Paths are relative to the project root (backend/).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

# Project root = parent of src/
ROOT = Path(__file__).resolve().parent.parent
INPUT_PATH = ROOT / "data" / "raw" / "transactions.csv"
OUTPUT_PATH = ROOT / "outputs" / "cleaned_data.csv"


def main() -> None:
    if not INPUT_PATH.is_file():
        print("Input file missing: data/raw/transactions.csv")
        print("Run step 0 first: place transactions.csv under data/raw/")
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    print(f"Loading {INPUT_PATH} ...")
    df = pd.read_csv(INPUT_PATH, low_memory=False)
    original_shape = df.shape
    null_before = int(df.isna().sum().sum())

    # Parse transaction date
    df["INV_DATE"] = pd.to_datetime(df["INV_DATE"], errors="coerce")
    missing_dates = df["INV_DATE"].isna()
    n_no_date = int(missing_dates.sum())
    if n_no_date:
        df = df.loc[~missing_dates].copy()

    # Strip whitespace on all string/object columns
    obj_cols = df.select_dtypes(include=["object", "string"]).columns
    for col in obj_cols:
        df[col] = df[col].apply(lambda x: x.strip() if isinstance(x, str) else x)

    # Missing value defaults
    df["DISCOUNT_PCT"] = pd.to_numeric(df["DISCOUNT_PCT"], errors="coerce").fillna(0.0)
    df["EVENT_TAG"] = df["EVENT_TAG"].fillna("NONE")
    df.loc[df["EVENT_TAG"].astype(str).str.len() == 0, "EVENT_TAG"] = "NONE"

    # Returns: QTY < 0 → LINE_AMOUNT must be negative (magnitude preserved)
    df["LINE_AMOUNT"] = pd.to_numeric(df["LINE_AMOUNT"], errors="coerce")
    df["QTY"] = pd.to_numeric(df["QTY"], errors="coerce")
    return_mask = df["QTY"] < 0
    df.loc[return_mask, "LINE_AMOUNT"] = -df.loc[return_mask, "LINE_AMOUNT"].abs()

    # Drop invalid sales lines: positive quantity but non-positive line amount
    bad_sales = (df["LINE_AMOUNT"] <= 0) & (df["QTY"] > 0)
    removed_bad = int(bad_sales.sum())
    df = df.loc[~bad_sales].copy()

    # One row per invoice line (same invoice + SKU)
    before_dedup = len(df)
    df = df.drop_duplicates(subset=["INVOICE_ID", "SKU_CODE"], keep="first")
    removed_dupes = before_dedup - len(df)

    df["NET_AMOUNT"] = df["LINE_AMOUNT"]

    null_after = int(df.isna().sum().sum())

    df.to_csv(OUTPUT_PATH, index=False)

    print("--- Data prep complete ---")
    print(f"Original shape: {original_shape}")
    print(f"Cleaned shape: {df.shape}")
    print(f"Null cell count (all columns) before fills: {null_before}")
    print(f"Null cell count (all columns) after cleaning: {null_after}")
    if n_no_date:
        print(f"Rows removed (missing INV_DATE): {n_no_date}")
    print(f"Rows removed (LINE_AMOUNT <= 0 and QTY > 0): {removed_bad}")
    print(f"Rows removed (duplicate INVOICE_ID + SKU_CODE): {removed_dupes}")
    print(
        f"Date range (INV_DATE): {df['INV_DATE'].min()} -> {df['INV_DATE'].max()}"
    )
    print(f"Saved: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
