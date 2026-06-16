"""
Step 5: Per-cluster SKU popularity (same non-seasonality window as config: e.g. last 6 months in 2025)
and global popularity for CLUSTER_ID=-1.
Requires outputs/cleaned_data.csv and outputs/clustered_data.csv.
Writes outputs/popularity_scores.csv.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd
from data_windows import filter_last_n_months_in_year, non_seasonality_label

CLEANED_PATH = ROOT / "outputs" / "cleaned_data.csv"
CLUSTER_PATH = ROOT / "outputs" / "clustered_data.csv"
OUTPUT_PATH = ROOT / "outputs" / "popularity_scores.csv"

TOP_N = 50


def _sku_metadata(tx: pd.DataFrame) -> pd.DataFrame:
    """One row per SKU with stable product attributes from the transaction slice."""
    cols = ["SKU_CODE", "PRODUCT_NAME", "CATEGORY", "L2_CATEGORY"]
    return tx.sort_values("INV_DATE").drop_duplicates("SKU_CODE", keep="last")[cols]


def main() -> None:
    if not CLEANED_PATH.is_file():
        print("Input missing: outputs/cleaned_data.csv")
        print("Run step 1 first: python src/01_data_prep.py")
        sys.exit(1)
    if not CLUSTER_PATH.is_file():
        print("Input missing: outputs/clustered_data.csv")
        print("Run step 3 first: python src/03_clustering.py")
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    print(f"Loading {CLEANED_PATH} ...")
    tx = pd.read_csv(CLEANED_PATH, low_memory=False)
    tx["INV_DATE"] = pd.to_datetime(tx["INV_DATE"], errors="coerce")

    print(f"Loading {CLUSTER_PATH} ...")
    cl = pd.read_csv(CLUSTER_PATH, low_memory=False)[["STORE_ID", "CLUSTER_ID"]]

    print(non_seasonality_label())
    tx_3m = filter_last_n_months_in_year(tx)
    print(f"Popularity window rows: {len(tx_3m)}")

    meta = _sku_metadata(tx_3m)

    blocks: list[pd.DataFrame] = []
    cluster_ids = sorted(cl["CLUSTER_ID"].dropna().unique().tolist())

    # Per-cluster popularity (non-negative cluster ids)
    for cid in cluster_ids:
        if int(cid) < 0:
            continue
        store_set = set(cl.loc[cl["CLUSTER_ID"] == cid, "STORE_ID"])
        total_stores = len(store_set)
        if total_stores == 0:
            print(f"WARNING: Cluster {cid} has 0 stores - skipping popularity block.")
            continue

        sub = tx_3m.loc[tx_3m["STORE_ID"].isin(store_set)]
        stores_bought = sub.groupby("SKU_CODE")["STORE_ID"].nunique()
        scores = stores_bought.rename("STORES_BOUGHT").reset_index()
        scores["POPULARITY_SCORE"] = scores["STORES_BOUGHT"] / total_stores
        scores = scores.merge(meta, on="SKU_CODE", how="left")
        scores["TOTAL_STORES"] = total_stores
        scores["CLUSTER_ID"] = int(cid)
        scores = scores.sort_values("POPULARITY_SCORE", ascending=False).head(TOP_N)
        scores["POPULARITY_RANK"] = range(1, len(scores) + 1)
        blocks.append(scores)

    # Global popularity for new customers (CLUSTER_ID = -1)
    total_all = tx_3m["STORE_ID"].nunique()
    if total_all > 0:
        stores_bought_g = tx_3m.groupby("SKU_CODE")["STORE_ID"].nunique()
        glob = stores_bought_g.rename("STORES_BOUGHT").reset_index()
        glob["POPULARITY_SCORE"] = glob["STORES_BOUGHT"] / total_all
        glob = glob.merge(meta, on="SKU_CODE", how="left")
        glob["TOTAL_STORES"] = total_all
        glob["CLUSTER_ID"] = -1
        glob = glob.sort_values("POPULARITY_SCORE", ascending=False).head(TOP_N)
        glob["POPULARITY_RANK"] = range(1, len(glob) + 1)
        blocks.append(glob)

    if not blocks:
        print("ERROR: No popularity blocks generated.")
        sys.exit(1)

    out = pd.concat(blocks, axis=0, ignore_index=True)
    out = out[
        [
            "CLUSTER_ID",
            "SKU_CODE",
            "PRODUCT_NAME",
            "CATEGORY",
            "L2_CATEGORY",
            "STORES_BOUGHT",
            "TOTAL_STORES",
            "POPULARITY_SCORE",
            "POPULARITY_RANK",
        ]
    ]
    out.to_csv(OUTPUT_PATH, index=False)

    print("Top 5 products per cluster (by POPULARITY_SCORE):")
    for cid in sorted(out["CLUSTER_ID"].unique()):
        sub = out.loc[out["CLUSTER_ID"] == cid].head(5)
        print(f"  CLUSTER_ID {int(cid)}:")
        for _, r in sub.iterrows():
            print(
                f"    rank {int(r['POPULARITY_RANK'])}: {r['SKU_CODE']} "
                f"score={r['POPULARITY_SCORE']:.4f}"
            )

    print(f"Saved: {OUTPUT_PATH}  rows={len(out)}")


if __name__ == "__main__":
    main()
