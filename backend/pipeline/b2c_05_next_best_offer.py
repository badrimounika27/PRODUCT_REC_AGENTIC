"""
B2C Step 5: Produce top-N item recommendations per customer.

Approach (Phase-1 friendly, no ALS)
----------------------------------
For each customer, we recommend items that customers *like them* bought.
"Like them" is defined by the customer's cluster from b2c_02.

Concretely:
    1. From bundles.csv (co-purchase lifts), any item the customer bought
       becomes a seed for its high-lift partners.
    2. From cluster-level popularity, we top-up with items popular
       within the customer's cluster that the customer hasn't seen yet.

Reads
-----
outputs/b2c/customer_clusters.csv
outputs/b2c/bundles.csv
data/raw/<B2C_INPUT_FILENAME>    (buy + high-signal events per user)

Writes
------
outputs/b2c/next_best_offers.csv
    columns: user_id, cluster_id, cluster_persona, rank, item_id, score, reason

Notes
-----
We cap at TOP_N per user and score in [0, 1]. `reason` values:
    - "bundle_lift"    : partner of an item the user already bought
    - "cluster_popular": top item in the user's cluster
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

import config as recai_config  # noqa: E402

TOP_N = 10
MAX_SEEDS_PER_USER = 20    # cap on how many "already bought" items we consider
MAX_BUNDLE_CANDIDATES = 500


def _load_inputs() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    b2c_out = recai_config.b2c_outputs_dir()
    cust_path = b2c_out / "customer_clusters.csv"
    bundles_path = b2c_out / "bundles.csv"
    raw_path = recai_config.b2c_input_path()

    if not cust_path.is_file():
        print(f"Input missing: {cust_path}. Run b2c_02_customer_clustering.py first.")
        sys.exit(1)
    if not raw_path.is_file():
        print(f"Input missing: {raw_path}")
        sys.exit(1)

    print(f"Loading {cust_path.name} ...")
    customers = pd.read_csv(
        cust_path,
        usecols=["user_id", "cluster_id", "cluster_persona"],
        dtype={"user_id": "int32", "cluster_id": "int32", "cluster_persona": "string"},
    )
    print(f"Loading {bundles_path.name} ...")
    if bundles_path.is_file():
        bundles = pd.read_csv(bundles_path)
    else:
        bundles = pd.DataFrame(columns=["item_a", "item_b", "pair_count", "lift"])

    print(f"Loading raw events (buy only) ...")
    raw = pd.read_csv(
        raw_path,
        dtype={
            "user_id": "int32", "item_id": "int32",
            "category_id": "int32", "behavior": "category",
            "timestamp": "int64",
        },
        low_memory=False,
    )
    lo, hi = recai_config.B2C_VALID_TS_MIN, recai_config.B2C_VALID_TS_MAX
    raw = raw[(raw["timestamp"] >= lo) & (raw["timestamp"] < hi)]
    buys = raw[raw["behavior"] == "buy"][["user_id", "item_id"]].drop_duplicates()
    return customers, bundles, buys


def _cluster_popular_items(customers: pd.DataFrame, buys: pd.DataFrame,
                           top_per_cluster: int = 200) -> dict[int, list[tuple[int, int]]]:
    """For each cluster: [(item_id, buyer_count), ...] sorted desc."""
    merged = buys.merge(customers[["user_id", "cluster_id"]], on="user_id", how="inner")
    pop = (
        merged.groupby(["cluster_id", "item_id"], observed=True)["user_id"]
              .nunique()
              .reset_index(name="buyer_count")
    )
    pop = pop.sort_values(["cluster_id", "buyer_count"], ascending=[True, False])
    out: dict[int, list[tuple[int, int]]] = {}
    for cid, g in pop.groupby("cluster_id", observed=True):
        out[int(cid)] = list(
            zip(g["item_id"].head(top_per_cluster).astype(int),
                g["buyer_count"].head(top_per_cluster).astype(int))
        )
    return out


def _bundle_partners(bundles: pd.DataFrame) -> dict[int, list[tuple[int, float]]]:
    """For each item, list of (partner_item, lift) sorted by lift desc.

    Bundles are undirected (item_a<item_b), so we expand into both directions.
    """
    if bundles.empty:
        return {}
    b = bundles.head(MAX_BUNDLE_CANDIDATES).copy()
    flipped = b.rename(columns={"item_a": "item_b", "item_b": "item_a"})
    combined = pd.concat([b, flipped], ignore_index=True)
    combined = combined.sort_values("lift", ascending=False)

    partners: dict[int, list[tuple[int, float]]] = {}
    for _, row in combined.iterrows():
        partners.setdefault(int(row["item_a"]), []).append(
            (int(row["item_b"]), float(row["lift"]))
        )
    return partners


def _score_for_user(
    user_id: int,
    cluster_id: int,
    already: set[int],
    partners: dict[int, list[tuple[int, float]]],
    cluster_pop: list[tuple[int, int]],
    max_pop_lift: float,
) -> list[tuple[int, float, str]]:
    """Rank candidate items for one user."""
    scored: dict[int, tuple[float, str]] = {}

    seeds = list(already)[:MAX_SEEDS_PER_USER]
    for seed in seeds:
        for partner_item, lift in partners.get(seed, []):
            if partner_item in already:
                continue
            # normalise lift into ~[0,1] using a soft cap of 20
            score = min(lift / 20.0, 1.0)
            prev = scored.get(partner_item)
            if prev is None or score > prev[0]:
                scored[partner_item] = (float(score), "bundle_lift")

    # top-up with cluster-popular items the user hasn't bought
    if cluster_pop:
        top_bc = max(cluster_pop[0][1], 1)
        for item, buyer_count in cluster_pop:
            if item in already or item in scored:
                continue
            score = 0.5 * buyer_count / top_bc  # scale cluster pop below any bundle_lift signal
            scored[item] = (float(score), "cluster_popular")

    ranked = sorted(scored.items(), key=lambda kv: kv[1][0], reverse=True)[:TOP_N]
    return [(item, sc, reason) for item, (sc, reason) in ranked]


def main() -> None:
    customers, bundles, buys = _load_inputs()
    print(f"customers: {len(customers):,},  bundles: {len(bundles):,},  "
          f"distinct (user,item) buys: {len(buys):,}")

    print("Precomputing bundle partner map ...")
    partners = _bundle_partners(bundles)
    print(f"  items with bundle partners: {len(partners):,}")

    print("Precomputing cluster-level item popularity ...")
    cluster_pop = _cluster_popular_items(customers, buys)
    max_pop_lift = 20.0

    # Pre-index user's already-bought items
    already_map: dict[int, set[int]] = {
        int(u): set(g["item_id"].astype(int))
        for u, g in buys.groupby("user_id")
    }

    print("Scoring recommendations per user ...")
    rows: list[tuple[int, int, str, int, int, float, str]] = []
    for _, row in customers.iterrows():
        user_id = int(row["user_id"])
        cluster_id = int(row["cluster_id"])
        persona = str(row["cluster_persona"])
        already = already_map.get(user_id, set())
        pop = cluster_pop.get(cluster_id, [])
        ranked = _score_for_user(user_id, cluster_id, already, partners, pop, max_pop_lift)
        for rank, (item, score, reason) in enumerate(ranked, start=1):
            rows.append((user_id, cluster_id, persona, rank, item, round(score, 4), reason))

    out = pd.DataFrame(rows, columns=[
        "user_id", "cluster_id", "cluster_persona", "rank",
        "item_id", "score", "reason",
    ])
    out_path = recai_config.b2c_outputs_dir() / "next_best_offers.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_path, index=False)

    print("--- Next-best-offer complete ---")
    print(f"users with recs   : {out['user_id'].nunique():,}")
    print(f"total rec rows    : {len(out):,}")
    if not out.empty:
        reasons = out["reason"].value_counts()
        for r, c in reasons.items():
            print(f"  reason={r:<18s} : {int(c):,}")
    print(f"Saved: {out_path}")


if __name__ == "__main__":
    main()
