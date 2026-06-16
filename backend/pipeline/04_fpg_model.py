"""
Step 4: FP-Growth association rules per cluster (last 6 months of baskets).
Requires outputs/cleaned_data.csv and outputs/clustered_data.csv.
Writes outputs/fpg_rules.csv.

Note: Last-3-months window is used later in post-processing for matching
store baskets to rules; rules themselves are mined on last 6 months per spec.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd
from config import (
    FPG_MIN_CONFIDENCE,
    FPG_MIN_LIFT,
    FPG_MIN_SUPPORT,
)
from data_windows import filter_last_n_months_in_year, non_seasonality_label
from mlxtend.frequent_patterns import association_rules, fpgrowth
from mlxtend.preprocessing import TransactionEncoder

CLEANED_PATH = ROOT / "outputs" / "cleaned_data.csv"
CLUSTER_PATH = ROOT / "outputs" / "clustered_data.csv"
OUTPUT_PATH = ROOT / "outputs" / "fpg_rules.csv"


def _fs_to_csv(fs: object) -> str:
    """Convert mlxtend frozenset of item names to a sorted comma-separated string."""
    items = [str(x) for x in fs]
    return ",".join(sorted(items))


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
    tx_6m = filter_last_n_months_in_year(tx)
    print(f"FPG mining rows: {len(tx_6m)}")

    merged = tx_6m.merge(cl, on="STORE_ID", how="inner")

    all_rules: list[pd.DataFrame] = []
    cluster_ids = sorted(
        c for c in merged["CLUSTER_ID"].dropna().unique().tolist() if int(c) >= 0
    )

    for cid in cluster_ids:
        sub = merged.loc[merged["CLUSTER_ID"] == cid]
        if sub.empty:
            print(f"WARNING: Cluster {cid} has no transactions in last 6 months - skipping.")
            continue

        # One basket = distinct SKUs on one invoice (store-scoped invoice)
        baskets = (
            sub.groupby(["STORE_ID", "INVOICE_ID"], sort=False)["SKU_CODE"]
            .apply(lambda s: sorted(s.astype(str).unique()))
            .tolist()
        )
        n_baskets = len(baskets)
        if n_baskets == 0:
            print(f"WARNING: Cluster {cid} produced 0 baskets - skipping.")
            continue

        te = TransactionEncoder()
        try:
            te_ary = te.fit(baskets).transform(baskets)
        except Exception as exc:
            print(f"WARNING: Cluster {cid} TransactionEncoder failed ({exc}) - skipping.")
            continue

        ohe = pd.DataFrame(te_ary, columns=te.columns_)
        try:
            fi = fpgrowth(ohe, min_support=FPG_MIN_SUPPORT, use_colnames=True)
        except Exception as exc:
            print(f"WARNING: Cluster {cid} fpgrowth failed ({exc}) - skipping.")
            continue

        if fi.empty:
            print(f"WARNING: Cluster {cid} produced 0 frequent itemsets - skipping.")
            continue

        rules = association_rules(fi, metric="confidence", min_threshold=FPG_MIN_CONFIDENCE)
        if rules.empty:
            print(f"WARNING: Cluster {cid} produced 0 association rules - skipping.")
            continue

        rules = rules.loc[rules["lift"] >= FPG_MIN_LIFT].copy()
        if rules.empty:
            print(
                f"WARNING: Cluster {cid} has rules but none with lift >= {FPG_MIN_LIFT} - skipping."
            )
            continue

        rules["CLUSTER_ID"] = int(cid)
        rules["antecedents"] = rules["antecedents"].apply(_fs_to_csv)
        rules["consequents"] = rules["consequents"].apply(_fs_to_csv)
        rules = rules[["antecedents", "consequents", "support", "confidence", "lift", "CLUSTER_ID"]]
        all_rules.append(rules)
        print(f"Cluster {cid}: {len(rules)} rules (from {n_baskets} baskets)")

    if not all_rules:
        out = pd.DataFrame(
            columns=[
                "antecedents",
                "consequents",
                "support",
                "confidence",
                "lift",
                "CLUSTER_ID",
            ]
        )
        print("WARNING: No FPG rules generated for any cluster. Saving empty file.")
    else:
        out = pd.concat(all_rules, axis=0, ignore_index=True)

    out.to_csv(OUTPUT_PATH, index=False)
    total = len(out)
    print(f"Total rules: {total}")
    print(f"Saved: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
