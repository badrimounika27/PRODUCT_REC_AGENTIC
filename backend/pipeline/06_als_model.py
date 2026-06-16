"""
Step 6: Implicit ALS on store x SKU purchase quantities (last 6 months).
Excludes SKUs already bought in the last 3 months from recommendations.
Requires outputs/cleaned_data.csv and outputs/clustered_data.csv.
Writes outputs/als_scores.csv.

Uses implicit.cpu.AlternatingLeastSquares (implicit feedback / confidence = clipped QTY).
For stable runs on CPU, set OPENBLAS_NUM_THREADS=1 in the environment if you see BLAS warnings.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import pandas as pd
from config import (
    ALS_FACTORS,
    ALS_ITERATIONS,
    ALS_REGULARIZATION,
    EXCLUSION_WINDOW_MONTHS,
    TOP_N_RECOMMENDATIONS,
)
from data_windows import filter_last_n_months_in_year, non_seasonality_label
from implicit.als import AlternatingLeastSquares
from scipy.sparse import csr_matrix

CLEANED_PATH = ROOT / "outputs" / "cleaned_data.csv"
CLUSTER_PATH = ROOT / "outputs" / "clustered_data.csv"
OUTPUT_PATH = ROOT / "outputs" / "als_scores.csv"

RECALL_N = 300  # fetch extra candidates, then drop recent purchases until top-N


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
    tx["STORE_ID"] = tx["STORE_ID"].astype(str)
    tx["SKU_CODE"] = tx["SKU_CODE"].astype(str)

    print(f"Loading {CLUSTER_PATH} ...")
    cl = pd.read_csv(CLUSTER_PATH, low_memory=False)
    print(f"Stores in clustered_data: {cl['STORE_ID'].nunique()}")

    end = tx["INV_DATE"].max()
    start_3m = end - pd.DateOffset(months=EXCLUSION_WINDOW_MONTHS)

    print(non_seasonality_label())
    tx_6m = filter_last_n_months_in_year(tx)
    tx_3m = tx.loc[tx["INV_DATE"] >= start_3m].copy()
    print(
        f"ALS training window (non-seasonality): {len(tx_6m)} rows; "
        f"max date {end.date()}"
    )
    print(
        f"Exclude purchases from last {EXCLUSION_WINDOW_MONTHS}m: "
        f"{start_3m.date()} -> {end.date()}"
    )

    # Positive implicit confidence: net qty per store-SKU (returns clipped at 0)
    qty = (
        tx_6m.groupby(["STORE_ID", "SKU_CODE"], observed=False)["QTY"]
        .sum()
        .reset_index(name="qty_sum")
    )
    qty["confidence"] = qty["qty_sum"].clip(lower=0.0)
    qty = qty.loc[qty["confidence"] > 0].copy()

    if qty.empty:
        print("ERROR: No positive purchase quantities in last 6 months.")
        sys.exit(1)

    store_ids = sorted(qty["STORE_ID"].unique().tolist())
    sku_ids = sorted(qty["SKU_CODE"].unique().tolist())
    user_map = {s: i for i, s in enumerate(store_ids)}
    item_map = {s: i for i, s in enumerate(sku_ids)}
    inv_item = np.array(sku_ids, dtype=object)

    rows = qty["STORE_ID"].map(user_map).to_numpy()
    cols = qty["SKU_CODE"].map(item_map).to_numpy()
    data = qty["confidence"].to_numpy(dtype=np.float64)
    ui = csr_matrix((data, (rows, cols)), shape=(len(store_ids), len(sku_ids)))

    # SKU metadata (latest row in 6m slice)
    meta = (
        tx_6m.sort_values("INV_DATE")
        .drop_duplicates("SKU_CODE", keep="last")[
            ["SKU_CODE", "PRODUCT_NAME", "CATEGORY", "L2_CATEGORY"]
        ]
        .set_index("SKU_CODE")
    )
    meta.index = meta.index.astype(str)

    model = AlternatingLeastSquares(
        factors=ALS_FACTORS,
        iterations=ALS_ITERATIONS,
        regularization=ALS_REGULARIZATION,
        random_state=42,
    )
    t0 = time.perf_counter()
    model.fit(ui, show_progress=False)
    train_secs = time.perf_counter() - t0
    print(f"ALS training time: {train_secs:.2f}s")

    # Last-3-month SKUs per store (to filter recommendations)
    excl = (
        tx_3m.groupby("STORE_ID", observed=False)["SKU_CODE"]
        .apply(lambda s: set(s))
        .to_dict()
    )

    out_rows: list[dict] = []
    sample_stores: list[str] = []

    for u_idx, store in enumerate(store_ids):
        row = ui[u_idx]
        if row.nnz == 0:
            continue
        item_ids_rec, scores = model.recommend(
            u_idx,
            row,
            N=min(RECALL_N, len(sku_ids)),
            filter_already_liked_items=False,
        )
        banned = excl.get(store, set())
        picked: list[tuple[str, float]] = []
        for iid, sc in zip(item_ids_rec, scores):
            sku = str(inv_item[int(iid)])
            if sku in banned:
                continue
            picked.append((sku, float(sc)))
            if len(picked) >= TOP_N_RECOMMENDATIONS:
                break
        if not picked:
            continue

        sc_vals = [p[1] for p in picked]
        mn, mx = min(sc_vals), max(sc_vals)

        if len(sample_stores) < 3:
            sample_stores.append(str(store))

        for rank, (sku, sc) in enumerate(picked[:TOP_N_RECOMMENDATIONS], start=1):
            norm = (sc - mn) / (mx - mn) if mx > mn else 1.0
            if sku in meta.index:
                mrow = meta.loc[sku]
                pname = mrow["PRODUCT_NAME"]
                cat = mrow["CATEGORY"]
                l2 = mrow["L2_CATEGORY"]
            else:
                pname, cat, l2 = "", "", ""
            out_rows.append(
                {
                    "STORE_ID": store,
                    "SKU_CODE": sku,
                    "PRODUCT_NAME": pname,
                    "CATEGORY": cat,
                    "L2_CATEGORY": l2,
                    "ALS_SCORE": float(norm),
                    "ALS_RANK": rank,
                }
            )

    out = pd.DataFrame(out_rows)
    if out.empty:
        print("WARNING: No ALS recommendations produced.")
    out.to_csv(OUTPUT_PATH, index=False)

    print("Sample recommendations (first 3 stores with recs, up to 5 lines each):")
    for sid in sample_stores:
        if out.empty:
            break
        sub = out.loc[out["STORE_ID"] == sid].head(5)
        print(f"  STORE_ID {sid}:")
        for _, r in sub.iterrows():
            print(
                f"    rank {int(r['ALS_RANK'])}: {r['SKU_CODE']} "
                f"als_score={r['ALS_SCORE']:.4f}"
            )

    print(f"Saved: {OUTPUT_PATH}  rows={len(out)}")


if __name__ == "__main__":
    main()
