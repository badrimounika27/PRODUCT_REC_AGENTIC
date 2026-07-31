"""
B2C Step 1: Build per-customer feature table from raw UserBehavior events.

Reads
-----
data/raw/<B2C_INPUT_FILENAME>   (default: user_behavior_sampled_50k.csv)
    columns: user_id, item_id, category_id, behavior, timestamp

Writes
------
outputs/b2c/customer_features.csv    (one row per user_id)

Feature set
-----------
Volume       : pv_count, cart_count, fav_count, buy_count, total_events
Diversity    : distinct_items, distinct_categories
Recency      : recency_days (days since last event vs B2C_REFERENCE_DATE)
Tenure       : active_days (unique days with any event)
Funnel       : pv_to_buy_rate, cart_to_buy_rate, buy_share
Preference   : top_category, top_category_share
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

import config as recai_config  # noqa: E402


COLS = ["user_id", "item_id", "category_id", "behavior", "timestamp"]


def _load_events() -> pd.DataFrame:
    src = recai_config.b2c_input_path()
    if not src.is_file():
        print(f"Input missing: {src}")
        print("Run scripts/sample_user_behavior.py first, "
              "or set B2C_INPUT_FILENAME env var.")
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

    # Strip out-of-range timestamps (a handful of raw rows are malformed).
    lo, hi = recai_config.B2C_VALID_TS_MIN, recai_config.B2C_VALID_TS_MAX
    df = df[(df["timestamp"] >= lo) & (df["timestamp"] < hi)].copy()
    dropped = n0 - len(df)
    if dropped:
        print(f"  dropped {dropped:,} rows outside valid window "
              f"[{lo}, {hi})")

    df["ts_dt"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    df["event_date"] = df["ts_dt"].dt.date
    return df


def _behavior_counts(df: pd.DataFrame) -> pd.DataFrame:
    """user_id × behavior → count, pivoted wide."""
    counts = (
        df.groupby(["user_id", "behavior"], observed=True)
          .size()
          .unstack(fill_value=0)
    )
    # ensure all 4 columns exist even if a slice is missing one
    for b in ("pv", "cart", "fav", "buy"):
        if b not in counts.columns:
            counts[b] = 0
    counts = counts.rename(columns={
        "pv": "pv_count",
        "cart": "cart_count",
        "fav": "fav_count",
        "buy": "buy_count",
    })[["pv_count", "cart_count", "fav_count", "buy_count"]]
    counts["total_events"] = counts.sum(axis=1)
    return counts


def _diversity(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby("user_id", observed=True)
    return pd.DataFrame({
        "distinct_items": g["item_id"].nunique(),
        "distinct_categories": g["category_id"].nunique(),
        "active_days": g["event_date"].nunique(),
    })


def _recency(df: pd.DataFrame) -> pd.DataFrame:
    reference = pd.Timestamp(recai_config.B2C_REFERENCE_DATE, tz="UTC")
    last = df.groupby("user_id", observed=True)["ts_dt"].max()
    recency = (reference - last).dt.total_seconds() / 86400.0
    return pd.DataFrame({"recency_days": recency.round(3)})


def _top_category(df: pd.DataFrame) -> pd.DataFrame:
    """Most-touched category per user (weighted by all events, not just buys)."""
    g = (
        df.groupby(["user_id", "category_id"], observed=True)
          .size()
          .reset_index(name="c")
    )
    totals = g.groupby("user_id", observed=True)["c"].transform("sum")
    g["share"] = g["c"] / totals
    idx = g.groupby("user_id", observed=True)["c"].idxmax()
    top = g.loc[idx, ["user_id", "category_id", "share"]].rename(columns={
        "category_id": "top_category",
        "share": "top_category_share",
    }).set_index("user_id")
    top["top_category_share"] = top["top_category_share"].round(4)
    return top


def _funnel_rates(counts: pd.DataFrame) -> pd.DataFrame:
    """Derive conversion rates from behavior counts."""
    pv = counts["pv_count"].clip(lower=0)
    cart = counts["cart_count"].clip(lower=0)
    buy = counts["buy_count"].clip(lower=0)
    total = counts["total_events"].replace(0, pd.NA)

    def _rate(num: pd.Series, den: pd.Series) -> pd.Series:
        r = num / den.replace(0, pd.NA)
        return r.fillna(0.0).astype(float).round(4)

    return pd.DataFrame({
        "pv_to_buy_rate": _rate(buy, pv),
        "cart_to_buy_rate": _rate(buy, cart),
        "buy_share": _rate(buy, counts["total_events"]),
    }, index=counts.index)


def main() -> None:
    df = _load_events()
    print(f"Loaded events shape: {df.shape}")

    print("Computing behavior counts ...")
    counts = _behavior_counts(df)

    print("Computing diversity and tenure ...")
    diversity = _diversity(df)

    print("Computing recency ...")
    recency = _recency(df)

    print("Computing top-category preference ...")
    top_cat = _top_category(df)

    print("Computing funnel conversion rates ...")
    funnel = _funnel_rates(counts)

    features = (
        counts.join(diversity, how="left")
              .join(recency, how="left")
              .join(top_cat, how="left")
              .join(funnel, how="left")
              .reset_index()
    )
    features["top_category"] = features["top_category"].fillna(-1).astype("int64")

    out_dir = recai_config.b2c_outputs_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "customer_features.csv"
    features.to_csv(out_path, index=False)

    print("--- Customer features complete ---")
    print(f"users             : {len(features):,}")
    print(f"columns           : {list(features.columns)}")
    print(f"buyers            : {(features['buy_count'] > 0).sum():,}  "
          f"({(features['buy_count'] > 0).mean() * 100:.1f}%)")
    print(f"mean events/user  : {features['total_events'].mean():.1f}")
    print(f"median events     : {int(features['total_events'].median())}")
    print(f"mean recency days : {features['recency_days'].mean():.2f}")
    print(f"Saved: {out_path}  shape={features.shape}")


if __name__ == "__main__":
    main()
