"""
B2C Step 2: Cluster customers into behavior segments and assign readable personas.

Reads
-----
outputs/b2c/customer_features.csv

Writes
------
outputs/b2c/customer_clusters.csv
    columns: user_id, cluster_id, cluster_persona,
             <all feature columns carried through>

Persona logic
-------------
We fit KMeans on scaled behavioral features, then rank each cluster on 3
dimensions (buy_rate, engagement_volume, recency_days) to label them with
plain-English personas. Cluster IDs may vary run-to-run; personas are the
stable, user-facing labels.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

import config as recai_config  # noqa: E402

N_CLUSTERS = 5
RANDOM_STATE = 42

# Columns used to fit KMeans (must all be numeric in customer_features.csv).
FIT_COLS = [
    "pv_count", "cart_count", "fav_count", "buy_count", "total_events",
    "distinct_items", "distinct_categories", "active_days",
    "recency_days",
    "pv_to_buy_rate", "cart_to_buy_rate", "buy_share",
]


def _load_features() -> pd.DataFrame:
    src = recai_config.b2c_outputs_dir() / "customer_features.csv"
    if not src.is_file():
        print(f"Input missing: {src}")
        print("Run b2c_01_customer_features.py first.")
        sys.exit(1)
    print(f"Loading {src} ...")
    return pd.read_csv(src)


def _assign_personas(df: pd.DataFrame, n_clusters: int) -> dict[int, str]:
    """Assign a plain-English persona label to each cluster id.

    Strategy: rank clusters by their center on a few interpretable axes,
    then pick the label for each cluster that best matches its rank profile.
    Available labels (in priority order):
        1. Frequent Buyers        - high buy_count, low recency
        2. Cart Abandoners        - high cart:buy ratio (adds to cart, rarely buys)
        3. Big-Basket Occasional  - high buy_count per active_day, mid recency
        4. Passive Browsers       - many pv, very low buy_share
        5. One-Time / New         - low total_events, high recency
    """
    centers = (
        df.groupby("cluster_id")[
            ["buy_count", "cart_count", "pv_count", "total_events",
             "recency_days", "buy_share", "active_days"]
        ]
        .mean()
    )

    # Compute derived scores per cluster
    scored = pd.DataFrame(index=centers.index)
    scored["buy_share"] = centers["buy_share"]
    scored["cart_to_buy"] = centers["cart_count"] / centers["buy_count"].replace(0, np.nan)
    scored["cart_to_buy"] = scored["cart_to_buy"].fillna(centers["cart_count"].max() * 10)
    scored["buys_per_active_day"] = centers["buy_count"] / centers["active_days"].replace(0, np.nan)
    scored["buys_per_active_day"] = scored["buys_per_active_day"].fillna(0)
    scored["engagement"] = centers["total_events"]
    scored["recency"] = centers["recency_days"]

    labels_priority = [
        ("Frequent Buyers",       lambda s: s.nlargest(1, "buy_share").index),
        ("Cart Abandoners",       lambda s: s.nlargest(1, "cart_to_buy").index),
        ("Big-Basket Occasional", lambda s: s.nlargest(1, "buys_per_active_day").index),
        ("Passive Browsers",      lambda s: s.nsmallest(1, "buy_share").index),
        ("One-Time / New",        lambda s: s.nlargest(1, "recency").index),
    ]

    remaining = set(scored.index.tolist())
    mapping: dict[int, str] = {}
    for label, pick in labels_priority:
        if not remaining:
            break
        cand = pick(scored.loc[list(remaining)])
        if len(cand) == 0:
            continue
        cid = int(cand[0])
        mapping[cid] = label
        remaining.discard(cid)

    # If we asked for more clusters than labels, use generic fallback
    for i, cid in enumerate(sorted(remaining)):
        mapping[cid] = f"Segment {cid}"

    return mapping


def main() -> None:
    feats = _load_features()
    missing = [c for c in FIT_COLS if c not in feats.columns]
    if missing:
        print(f"customer_features.csv is missing required columns: {missing}")
        sys.exit(1)

    X = feats[FIT_COLS].to_numpy(dtype=float)
    # Replace inf and NaN defensively (feature rates can produce NaN for zero-event users)
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)

    print(f"Fitting KMeans (K={N_CLUSTERS}) on {Xs.shape[0]:,} users x "
          f"{Xs.shape[1]} features ...")
    km = KMeans(n_clusters=N_CLUSTERS, random_state=RANDOM_STATE, n_init=10, max_iter=300)
    feats["cluster_id"] = km.fit_predict(Xs).astype("int32")

    personas = _assign_personas(feats, N_CLUSTERS)
    feats["cluster_persona"] = feats["cluster_id"].map(personas)

    # Reorder columns so cluster info is upfront
    lead = ["user_id", "cluster_id", "cluster_persona"]
    out_cols = lead + [c for c in feats.columns if c not in lead]
    out = feats[out_cols].sort_values(["cluster_id", "user_id"]).reset_index(drop=True)

    out_path = recai_config.b2c_outputs_dir() / "customer_clusters.csv"
    out.to_csv(out_path, index=False)

    print("--- Customer clustering complete ---")
    sizes = out["cluster_id"].value_counts().sort_index()
    for cid, cnt in sizes.items():
        persona = personas.get(int(cid), "(unlabeled)")
        pct = 100.0 * cnt / len(out)
        print(f"  Cluster {int(cid)} [{persona:<24s}] : {int(cnt):>7,} users  ({pct:4.1f}%)")
    print(f"Saved: {out_path}  shape={out.shape}")


if __name__ == "__main__":
    main()
