"""
Step 3: Cluster stores (K=4) on scaled numeric features; write outputs/clustered_data.csv.
New customers (NEW_CUSTOMER=True) are not clustered and get CLUSTER_ID=-1.
Requires outputs/featured_data.csv from step 2.
"""
from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from kneed import KneeLocator
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
INPUT_PATH = ROOT / "outputs" / "featured_data.csv"
OUTPUT_PATH = ROOT / "outputs" / "clustered_data.csv"
ELBOW_PATH = ROOT / "outputs" / "elbow_plot.png"

# Fixed cluster count (business override; elbow curve is still saved for reference)
N_CLUSTERS = 4


def main() -> None:
    if not INPUT_PATH.is_file():
        print("Input missing: outputs/featured_data.csv")
        print("Run step 2 first: python src/02_feature_engineering.py")
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    print(f"Loading {INPUT_PATH} ...")
    feat = pd.read_csv(INPUT_PATH, low_memory=False)

    new_mask = feat["NEW_CUSTOMER"].astype(bool)
    train_df = feat.loc[~new_mask].copy()
    new_df = feat.loc[new_mask].copy()

    # Numeric feature columns only (exclude ids and flag)
    exclude = {"STORE_ID", "NEW_CUSTOMER"}
    num_cols = [
        c
        for c in feat.columns
        if c not in exclude and pd.api.types.is_numeric_dtype(feat[c])
    ]
    if not num_cols:
        print("No numeric feature columns found.")
        sys.exit(1)

    X = train_df[num_cols].to_numpy(dtype=float)
    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)

    # Elbow curve (K=2..20) for documentation; knee is computed but final K uses N_CLUSTERS
    k_range = range(2, 21)
    inertias: list[float] = []
    for k in k_range:
        km = KMeans(
            n_clusters=k, random_state=42, n_init=10, max_iter=300
        )
        km.fit(Xs)
        inertias.append(float(km.inertia_))

    kneedle = KneeLocator(
        list(k_range), inertias, curve="convex", direction="decreasing"
    )
    knee_k = kneedle.knee
    print(f"KneeLocator suggested K (from elbow): {knee_k}")

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(list(k_range), inertias, "b-o", markersize=4)
    ax.axvline(N_CLUSTERS, color="green", linestyle="--", label=f"Using K={N_CLUSTERS}")
    if knee_k:
        ax.axvline(knee_k, color="orange", linestyle=":", label=f"Knee ~{knee_k}")
    ax.set_xlabel("K")
    ax.set_ylabel("Inertia")
    ax.set_title("Elbow curve (inertia vs K); vertical line = model K")
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(ELBOW_PATH, dpi=120)
    plt.close(fig)
    print(f"Saved elbow plot: {ELBOW_PATH}")

    # Final clustering with fixed K=4
    optimal_k = N_CLUSTERS
    km_final = KMeans(
        n_clusters=optimal_k, random_state=42, n_init=10, max_iter=300
    )
    train_df["CLUSTER_ID"] = km_final.fit_predict(Xs)

    # Top 3 features per cluster by |cluster center| in scaled space
    centers = km_final.cluster_centers_
    top_features: dict[int, list[str]] = {}
    for cid in range(optimal_k):
        idx = np.argsort(np.abs(centers[cid]))[::-1][:3]
        top_features[cid] = [num_cols[j] for j in idx]

    new_df["CLUSTER_ID"] = -1
    out = pd.concat([train_df, new_df], axis=0, ignore_index=True)

    # Preserve original row order optional - not required; sort by STORE_ID for stability
    out = out.sort_values("STORE_ID").reset_index(drop=True)

    out.to_csv(OUTPUT_PATH, index=False)

    sizes = out.loc[out["CLUSTER_ID"] >= 0, "CLUSTER_ID"].value_counts().sort_index()
    print(f"Optimal K used for KMeans: {optimal_k} (fixed)")
    print("Cluster sizes (CLUSTER_ID 0..K-1):")
    for cid, cnt in sizes.items():
        print(f"  Cluster {int(cid)}: {int(cnt)} stores")
    print(f"New customer stores (CLUSTER_ID -1): {int((out['CLUSTER_ID'] == -1).sum())}")
    print("Top 3 features per cluster (by |scaled center|):")
    for cid in range(optimal_k):
        print(f"  Cluster {cid}: {', '.join(top_features[cid])}")
    print(f"Saved: {OUTPUT_PATH}  shape={out.shape}")


if __name__ == "__main__":
    main()
