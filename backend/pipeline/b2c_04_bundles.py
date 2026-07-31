"""
B2C Step 4: Discover frequently-bought-together item pairs.

Reads
-----
data/raw/<B2C_INPUT_FILENAME>  (only rows with behavior='buy' are used)

Writes
------
outputs/b2c/bundles.csv
    columns: item_a, item_b, pair_count, item_a_buys, item_b_buys,
             support, confidence, lift

Methodology
-----------
Two items form a candidate pair if the SAME user bought both within the
data window. We compute:

    support(A,B)   = pair_count / total_buyers
    confidence(A→B)= pair_count / item_a_buys
    lift(A,B)      = support(A,B) / (P(A) * P(B))

where P(X) = users who bought X / total buyers.

Only pairs with at least MIN_PAIR_COUNT co-purchasers are kept, and we
cap output to TOP_N pairs by lift for tractable UI display.
"""
from __future__ import annotations

import sys
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

import config as recai_config  # noqa: E402

MIN_PAIR_COUNT = 3          # pair must appear for at least N distinct users
TOP_N = 500                 # cap output rows for tractable UI
MAX_ITEMS_PER_USER = 50     # skip explosive users (>50 distinct buys) — rare


def _load_buys() -> pd.DataFrame:
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
    lo, hi = recai_config.B2C_VALID_TS_MIN, recai_config.B2C_VALID_TS_MAX
    df = df[(df["timestamp"] >= lo) & (df["timestamp"] < hi)]
    buys = df[df["behavior"] == "buy"][["user_id", "item_id"]].drop_duplicates()
    print(f"  distinct (user, item) buy rows: {len(buys):,}")
    return buys


def _build_pair_counts(buys: pd.DataFrame) -> pd.DataFrame:
    """Count how many users bought each unordered (item_a < item_b) pair."""
    # user -> set(items)
    user_items = buys.groupby("user_id")["item_id"].apply(list)

    pair_counter: dict[tuple[int, int], int] = {}
    dropped_users = 0
    for items in user_items:
        if len(items) < 2:
            continue
        if len(items) > MAX_ITEMS_PER_USER:
            dropped_users += 1
            continue
        # dedupe within user, ensure sorted for canonical (a,b) with a<b
        items = sorted(set(items))
        for a, b in combinations(items, 2):
            pair_counter[(a, b)] = pair_counter.get((a, b), 0) + 1

    if dropped_users:
        print(f"  skipped {dropped_users:,} users with >{MAX_ITEMS_PER_USER} buys")

    if not pair_counter:
        return pd.DataFrame(columns=["item_a", "item_b", "pair_count"])

    pairs = pd.DataFrame(
        [(a, b, c) for (a, b), c in pair_counter.items()],
        columns=["item_a", "item_b", "pair_count"],
    )
    print(f"  raw pairs (any count): {len(pairs):,}")
    pairs = pairs[pairs["pair_count"] >= MIN_PAIR_COUNT].copy()
    print(f"  pairs >= {MIN_PAIR_COUNT} co-buyers: {len(pairs):,}")
    return pairs


def _score_pairs(pairs: pd.DataFrame, buys: pd.DataFrame) -> pd.DataFrame:
    """Attach support, confidence(A→B), and lift."""
    total_buyers = int(buys["user_id"].nunique())
    buyers_per_item = buys.groupby("item_id")["user_id"].nunique()

    pairs = pairs.copy()
    pairs["item_a_buys"] = pairs["item_a"].map(buyers_per_item).fillna(0).astype("int64")
    pairs["item_b_buys"] = pairs["item_b"].map(buyers_per_item).fillna(0).astype("int64")

    pairs["support"] = (pairs["pair_count"] / total_buyers).round(6)
    pairs["confidence"] = (pairs["pair_count"] / pairs["item_a_buys"].replace(0, np.nan))
    pairs["confidence"] = pairs["confidence"].fillna(0).round(4)

    p_a = pairs["item_a_buys"] / total_buyers
    p_b = pairs["item_b_buys"] / total_buyers
    denom = (p_a * p_b).replace(0, np.nan)
    pairs["lift"] = (pairs["support"] / denom).fillna(0).round(3)

    return pairs.sort_values(["lift", "pair_count"], ascending=[False, False]).reset_index(drop=True)


def main() -> None:
    buys = _load_buys()
    if buys.empty:
        print("No buy events found; skipping bundles.")
        sys.exit(0)

    print("Building co-purchase pairs ...")
    pairs = _build_pair_counts(buys)
    if pairs.empty:
        print("No pairs meet MIN_PAIR_COUNT; nothing to write.")
        # still write empty file so downstream API can read a well-formed CSV
        out_path = recai_config.b2c_outputs_dir() / "bundles.csv"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        pd.DataFrame(columns=[
            "item_a", "item_b", "pair_count", "item_a_buys", "item_b_buys",
            "support", "confidence", "lift",
        ]).to_csv(out_path, index=False)
        print(f"Saved: {out_path} (empty)")
        return

    print("Scoring pairs ...")
    scored = _score_pairs(pairs, buys)
    top = scored.head(TOP_N).copy()

    out_path = recai_config.b2c_outputs_dir() / "bundles.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    top.to_csv(out_path, index=False)

    print("--- Bundles complete ---")
    print(f"total scored pairs : {len(scored):,}")
    print(f"kept top-N by lift : {len(top):,}")
    if not top.empty:
        print(f"lift range         : {top['lift'].min():.2f}  ->  {top['lift'].max():.2f}")
        print(f"top pair example   : item {int(top.iloc[0]['item_a'])} + item "
              f"{int(top.iloc[0]['item_b'])}  "
              f"(count={int(top.iloc[0]['pair_count'])}, lift={top.iloc[0]['lift']})")
    print(f"Saved: {out_path}")


if __name__ == "__main__":
    main()
