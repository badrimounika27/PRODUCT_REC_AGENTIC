"""
Step 2: Build store-level features from last N months in NON_SEASONALITY_YEAR (config);
write outputs/featured_data.csv. Requires outputs/cleaned_data.csv from step 1.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import pandas as pd
from config import NON_SEASONALITY_MONTHS
from data_windows import filter_last_n_months_in_year, non_seasonality_label

INPUT_PATH = ROOT / "outputs" / "cleaned_data.csv"
OUTPUT_PATH = ROOT / "outputs" / "featured_data.csv"


def _sanitize_token(name: str) -> str:
    """Make a safe column name fragment from a category/tier label."""
    s = str(name).strip().replace(" ", "_")
    s = re.sub(r"[^0-9A-Za-z_]", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "UNKNOWN"


def _mean_days_between_purchase(dates: pd.Series) -> float:
    """Mean gap in days between distinct purchase calendar days."""
    u = pd.DatetimeIndex(pd.unique(dates.dropna())).normalize().sort_values()
    if len(u) < 2:
        return 0.0
    diffs = np.diff(u.values).astype("timedelta64[D]").astype(float)
    return float(np.mean(diffs))


def main() -> None:
    if not INPUT_PATH.is_file():
        print("Input missing: outputs/cleaned_data.csv")
        print("Run step 1 first: python src/01_data_prep.py")
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    print(f"Loading {INPUT_PATH} ...")
    df_all = pd.read_csv(INPUT_PATH, low_memory=False)
    df_all["INV_DATE"] = pd.to_datetime(df_all["INV_DATE"], errors="coerce")

    # NEW_CUSTOMER: full-history distinct months per store (not limited to 6 months)
    ym = df_all["YEAR_MONTH"].astype(str).str.strip()
    months_ct = df_all.assign(_ym=ym).groupby("STORE_ID")["_ym"].nunique()
    new_customer = months_ct < 2

    # Recent window: last N months within NON_SEASONALITY_YEAR (e.g. last 6 months of 2025)
    df = filter_last_n_months_in_year(df_all)
    print(non_seasonality_label())
    print(f"Feature engineering rows: {len(df)}")

    store_ids = df_all["STORE_ID"].unique()
    num_months = max(int(df["YEAR_MONTH"].astype(str).nunique()), 1) if len(df) else NON_SEASONALITY_MONTHS

    # Core aggregates on last-6-month slice
    store_total = df.groupby("STORE_ID")["NET_AMOUNT"].sum()
    inv_d = df.groupby("STORE_ID")["INVOICE_ID"].nunique()
    sku_d = df.groupby("STORE_ID")["SKU_CODE"].nunique()

    inv_per_month = inv_d / num_months

    inv_sku_counts = df.groupby(["STORE_ID", "INVOICE_ID"])["SKU_CODE"].nunique()
    unique_per_inv = inv_sku_counts.groupby("STORE_ID").mean()

    avg_gap = df.groupby("STORE_ID")["INV_DATE"].apply(_mean_days_between_purchase)

    base = pd.DataFrame(index=pd.Index(store_ids, name="STORE_ID"))
    base["NET_AMT_AVG_MONTHLY"] = store_total.reindex(store_ids).fillna(0.0) / num_months
    base["AVG_INVOICE_PURCHASE"] = np.where(
        inv_d.reindex(store_ids).fillna(0) > 0,
        store_total.reindex(store_ids).fillna(0.0) / inv_d.reindex(store_ids),
        0.0,
    )
    base["UNIQUE_PRD_COUNT"] = sku_d.reindex(store_ids).fillna(0).astype(int)
    base["INV_COUNT_AVG_MONTHLY"] = inv_per_month.reindex(store_ids).fillna(0.0)
    base["UNIQUE_PRD_COUNT_PER_INV"] = unique_per_inv.reindex(store_ids).fillna(0.0)
    base["AVG_NO_DAYS_BETWEEN_PURCHASE"] = avg_gap.reindex(store_ids).fillna(0.0)
    base["NEW_CUSTOMER"] = new_customer.reindex(store_ids).fillna(True)

    # Share features: pivot sums then divide by store total (last 6 months)
    def add_share_pivot(
        frame: pd.DataFrame,
        col: str,
        suffix: str,
    ) -> pd.DataFrame:
        sums = frame.groupby(["STORE_ID", col], observed=False)["NET_AMOUNT"].sum()
        totals = frame.groupby("STORE_ID")["NET_AMOUNT"].sum()
        store_level = sums.index.get_level_values(0)
        denom = totals.reindex(store_level).to_numpy()
        denom = np.where(denom == 0, np.nan, denom)
        pct = pd.Series(sums.values / denom, index=sums.index)
        pct = pct.fillna(0.0)
        wide = pct.unstack(fill_value=0.0)
        wide.columns = [f"{_sanitize_token(c)}_{suffix}" for c in wide.columns]
        return wide

    cat_pct = add_share_pivot(df, "CATEGORY", "SALES_PCT")
    l2_pct = add_share_pivot(df, "L2_CATEGORY", "SALES_PCT")
    tier_pct = add_share_pivot(df, "TIER", "PCT")

    out = base.join(cat_pct, how="left").join(l2_pct, how="left").join(tier_pct, how="left")
    out = out.fillna(0.0)
    # NEW_CUSTOMER stays boolean
    out["NEW_CUSTOMER"] = out["NEW_CUSTOMER"].astype(bool)

    out = out.reset_index()

    out.to_csv(OUTPUT_PATH, index=False)

    print("--- Feature list (name -> dtype) ---")
    for c in out.columns:
        print(f"  {c}: {out[c].dtype}")
    print(f"Saved: {OUTPUT_PATH}  shape={out.shape}")


if __name__ == "__main__":
    main()
