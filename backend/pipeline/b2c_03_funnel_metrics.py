"""
B2C Step 3: Compute event-funnel metrics (pv → cart → fav → buy).

Reads
-----
data/raw/<B2C_INPUT_FILENAME>

Writes
------
outputs/b2c/funnel_metrics.csv          (funnel counts by event_date × category_id)
outputs/b2c/funnel_summary.csv          (overall totals + conversion rates)
outputs/b2c/funnel_by_category.csv      (per-category rollup, no date breakdown)
outputs/b2c/funnel_by_date.csv          (per-date rollup, all categories)

Columns in funnel_metrics.csv
-----------------------------
event_date, category_id, pv_count, cart_count, fav_count, buy_count,
pv_to_buy_rate, cart_to_buy_rate
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

import config as recai_config  # noqa: E402


def _load_events() -> pd.DataFrame:
    src = recai_config.b2c_input_path()
    if not src.is_file():
        print(f"Input missing: {src}")
        sys.exit(1)
    print(f"Loading {src} ...")
    df = pd.read_csv(
        src,
        dtype={
            "user_id": "int32",
            "item_id": "int32",
            "category_id": "int32",
            "behavior": "category",
            "timestamp": "int64",
        },
        low_memory=False,
    )
    n0 = len(df)
    lo, hi = recai_config.B2C_VALID_TS_MIN, recai_config.B2C_VALID_TS_MAX
    df = df[(df["timestamp"] >= lo) & (df["timestamp"] < hi)].copy()
    dropped = n0 - len(df)
    if dropped:
        print(f"  dropped {dropped:,} out-of-window rows")
    df["event_date"] = pd.to_datetime(df["timestamp"], unit="s", utc=True).dt.date
    return df


def _pivot_counts(df: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """Pivot event counts by behavior over the given group_cols."""
    g = (
        df.groupby(group_cols + ["behavior"], observed=True)
          .size()
          .unstack(fill_value=0)
    )
    for b in ("pv", "cart", "fav", "buy"):
        if b not in g.columns:
            g[b] = 0
    g = g.rename(columns={
        "pv": "pv_count",
        "cart": "cart_count",
        "fav": "fav_count",
        "buy": "buy_count",
    })[["pv_count", "cart_count", "fav_count", "buy_count"]]
    return g.reset_index()


def _add_rates(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["pv_to_buy_rate"] = (df["buy_count"] / df["pv_count"].replace(0, pd.NA)).fillna(0).round(4)
    df["cart_to_buy_rate"] = (df["buy_count"] / df["cart_count"].replace(0, pd.NA)).fillna(0).round(4)
    return df


def main() -> None:
    df = _load_events()
    print(f"Events after filter: {len(df):,}")

    out_dir = recai_config.b2c_outputs_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Fine-grained: date x category
    print("Computing funnel by (event_date, category_id) ...")
    fine = _pivot_counts(df, ["event_date", "category_id"])
    fine = _add_rates(fine)
    fine.to_csv(out_dir / "funnel_metrics.csv", index=False)
    print(f"  -> {out_dir / 'funnel_metrics.csv'}  shape={fine.shape}")

    # 2. Category rollup
    print("Computing funnel per category ...")
    by_cat = _pivot_counts(df, ["category_id"])
    by_cat = _add_rates(by_cat)
    by_cat = by_cat.sort_values("pv_count", ascending=False).reset_index(drop=True)
    by_cat.to_csv(out_dir / "funnel_by_category.csv", index=False)
    print(f"  -> {out_dir / 'funnel_by_category.csv'}  shape={by_cat.shape}")

    # 3. Date rollup
    print("Computing funnel per date ...")
    by_date = _pivot_counts(df, ["event_date"])
    by_date = _add_rates(by_date)
    by_date = by_date.sort_values("event_date").reset_index(drop=True)
    by_date.to_csv(out_dir / "funnel_by_date.csv", index=False)
    print(f"  -> {out_dir / 'funnel_by_date.csv'}  shape={by_date.shape}")

    # 4. Overall summary
    totals = {
        "pv_count": int(df[df["behavior"] == "pv"].shape[0]),
        "cart_count": int(df[df["behavior"] == "cart"].shape[0]),
        "fav_count": int(df[df["behavior"] == "fav"].shape[0]),
        "buy_count": int(df[df["behavior"] == "buy"].shape[0]),
    }
    totals["pv_to_buy_rate"] = round(totals["buy_count"] / totals["pv_count"], 4) \
        if totals["pv_count"] else 0.0
    totals["cart_to_buy_rate"] = round(totals["buy_count"] / totals["cart_count"], 4) \
        if totals["cart_count"] else 0.0
    totals["unique_users"] = int(df["user_id"].nunique())
    totals["unique_items"] = int(df["item_id"].nunique())
    totals["unique_categories"] = int(df["category_id"].nunique())
    totals["date_min"] = str(df["event_date"].min())
    totals["date_max"] = str(df["event_date"].max())

    summary_df = pd.DataFrame([totals])
    summary_df.to_csv(out_dir / "funnel_summary.csv", index=False)
    print(f"  -> {out_dir / 'funnel_summary.csv'}")

    print("--- Funnel metrics complete ---")
    print(f"Overall: pv={totals['pv_count']:,}, cart={totals['cart_count']:,}, "
          f"fav={totals['fav_count']:,}, buy={totals['buy_count']:,}")
    print(f"pv->buy rate  : {totals['pv_to_buy_rate']*100:.2f}%")
    print(f"cart->buy rate: {totals['cart_to_buy_rate']*100:.2f}%")


if __name__ == "__main__":
    main()
