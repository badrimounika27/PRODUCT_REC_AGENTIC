"""
Step 7: Merge FPG, popularity, and ALS candidates; apply cumulative-score cutoff.
Requires outputs from prior steps and writes outputs/recommendations_raw.csv.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd
from config import EXCLUSION_WINDOW_MONTHS, TARGET_GROWTH, TOP_N_RECOMMENDATIONS

FPG_PATH = ROOT / "outputs" / "fpg_rules.csv"
POP_PATH = ROOT / "outputs" / "popularity_scores.csv"
ALS_PATH = ROOT / "outputs" / "als_scores.csv"
CLUSTER_PATH = ROOT / "outputs" / "clustered_data.csv"
FEATURED_PATH = ROOT / "outputs" / "featured_data.csv"
CLEANED_PATH = ROOT / "outputs" / "cleaned_data.csv"
OUTPUT_PATH = ROOT / "outputs" / "recommendations_raw.csv"

def _parse_skus(cell: str) -> list[str]:
    return [x.strip() for x in str(cell).split(",") if x.strip()]


def _load_required(path: Path, step_hint: str) -> pd.DataFrame:
    if not path.is_file():
        print(f"Input missing: {path.name}")
        print(step_hint)
        sys.exit(1)
    return pd.read_csv(path, low_memory=False)


def main() -> None:
    fpg = _load_required(FPG_PATH, "Run step 4 first: python src/04_fpg_model.py")
    pop = _load_required(POP_PATH, "Run step 5 first: python src/05_popularity_model.py")
    als = _load_required(ALS_PATH, "Run step 6 first: python src/06_als_model.py")
    cl = _load_required(CLUSTER_PATH, "Run step 3 first: python src/03_clustering.py")
    feat = _load_required(FEATURED_PATH, "Run step 2 first: python src/02_feature_engineering.py")
    tx = _load_required(CLEANED_PATH, "Run step 1 first: python src/01_data_prep.py")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    tx["INV_DATE"] = pd.to_datetime(tx["INV_DATE"], errors="coerce")
    tx["STORE_ID"] = tx["STORE_ID"].astype(str)
    tx["SKU_CODE"] = tx["SKU_CODE"].astype(str)

    end = tx["INV_DATE"].max()
    start_excl = end - pd.DateOffset(months=EXCLUSION_WINDOW_MONTHS)
    tx_excl = tx.loc[tx["INV_DATE"] >= start_excl]
    print(
        f"Last {EXCLUSION_WINDOW_MONTHS} months purchases: "
        f"{start_excl.date()} -> {end.date()}"
    )

    # store -> set of SKU purchased in last 3m
    purchased: dict[str, set[str]] = (
        tx_excl.groupby("STORE_ID", observed=False)["SKU_CODE"]
        .apply(lambda s: set(s))
        .to_dict()
    )

    uniq_map = feat.set_index("STORE_ID")["UNIQUE_PRD_COUNT"].to_dict()

    cl["STORE_ID"] = cl["STORE_ID"].astype(str)
    cluster_map = cl.set_index("STORE_ID")["CLUSTER_ID"].to_dict()

    # Rules grouped by cluster (only non-negative clusters have rules)
    rules_by_c: dict[int, pd.DataFrame] = {
        int(k): v for k, v in fpg.groupby("CLUSTER_ID")
    }

    pop["CLUSTER_ID"] = pop["CLUSTER_ID"].astype(int)
    pop_by_c: dict[int, pd.DataFrame] = {
        int(k): v for k, v in pop.groupby("CLUSTER_ID")
    }

    als["STORE_ID"] = als["STORE_ID"].astype(str)
    als_by_store: dict[str, pd.DataFrame] = {
        k: v for k, v in als.groupby("STORE_ID")
    }

    stores = sorted(cl["STORE_ID"].unique())
    out_rows: list[dict] = []
    source_counts = {"FPG": 0, "POPULARITY": 0, "ALS": 0}

    for store in stores:
        cid = int(cluster_map[store])
        bought = purchased.get(store, set())

        ucnt = float(uniq_map.get(store, 0) or 0)
        if pd.isna(ucnt):
            ucnt = 0.0
        target = ucnt * TARGET_GROWTH

        # best candidate per SKU: (score, source, antecedents_str, product fields)
        best: dict[str, tuple[float, str, str, str, str, str]] = {}

        def consider(
            sku: str,
            score: float,
            source: str,
            ante: str,
            pname: str,
            cat: str,
            l2: str,
        ) -> None:
            if sku in bought:
                return
            prev = best.get(sku)
            if prev is None or score > prev[0]:
                best[sku] = (score, source, ante, pname, cat, l2)

        # A — FPG
        if cid >= 0 and cid in rules_by_c:
            for row in rules_by_c[cid].itertuples(index=False):
                ante = _parse_skus(row.antecedents)
                cons = _parse_skus(row.consequents)
                if not ante or not cons:
                    continue
                if not set(ante).issubset(bought):
                    continue
                conf = float(row.confidence)
                ante_str = row.antecedents
                for sku in cons:
                    if sku in bought:
                        continue
                    consider(sku, conf, "FPG", ante_str, "", "", "")

        # B — Popularity (cluster-specific; -1 = global)
        if cid in pop_by_c:
            for row in pop_by_c[cid].itertuples(index=False):
                sku = str(row.SKU_CODE)
                consider(
                    sku,
                    float(row.POPULARITY_SCORE),
                    "POPULARITY",
                    "",
                    str(row.PRODUCT_NAME),
                    str(row.CATEGORY),
                    str(row.L2_CATEGORY),
                )

        # C — ALS
        if store in als_by_store:
            for row in als_by_store[store].itertuples(index=False):
                sku = str(row.SKU_CODE)
                consider(
                    sku,
                    float(row.ALS_SCORE),
                    "ALS",
                    "",
                    str(row.PRODUCT_NAME),
                    str(row.CATEGORY),
                    str(row.L2_CATEGORY),
                )

        # Fill missing product metadata from `best` (FPG may lack names)
        for sku, tup in list(best.items()):
            sc, src, ante, pname, cat, l2 = tup
            if not pname and sku:
                hit = tx.loc[tx["SKU_CODE"] == sku].sort_values("INV_DATE")
                if not hit.empty:
                    r = hit.iloc[-1]
                    pname, cat, l2 = str(r["PRODUCT_NAME"]), str(r["CATEGORY"]), str(
                        r["L2_CATEGORY"]
                    )
                    best[sku] = (sc, src, ante, pname, cat, l2)

        if not best:
            continue

        # D — sort by score, cap 20
        ranked = sorted(best.items(), key=lambda x: x[1][0], reverse=True)[
            :TOP_N_RECOMMENDATIONS
        ]

        # E — cumulative cutoff
        if target <= 0:
            continue

        cum = 0.0
        rank = 0
        for sku, (sc, src, ante, pname, cat, l2) in ranked:
            cum += sc
            rank += 1
            out_rows.append(
                {
                    "STORE_ID": store,
                    "CLUSTER_ID": cid,
                    "SKU_CODE": sku,
                    "PRODUCT_NAME": pname,
                    "CATEGORY": cat,
                    "L2_CATEGORY": l2,
                    "SCORE": sc,
                    "SOURCE": src,
                    "RANK": rank,
                    "ANTECEDENT_PRODUCTS": ante,
                    "UNIQUE_PRD_COUNT": int(ucnt),
                    "TARGET_INCREASE": target,
                    "CUMULATIVE_SCORE": cum,
                }
            )
            source_counts[src] = source_counts.get(src, 0) + 1
            if cum >= target:
                break

    out = pd.DataFrame(out_rows)
    out.to_csv(OUTPUT_PATH, index=False)

    n_stores = len(stores)
    n_with = out["STORE_ID"].nunique() if not out.empty else 0
    avg_r = len(out) / n_with if n_with else 0.0

    print(f"Total stores processed: {n_stores}")
    print(f"Stores with >=1 recommendation: {n_with}")
    print(f"Average recommendations per store (among stores with recs): {avg_r:.4f}")
    print(
        "Source breakdown (row counts): "
        f"FPG={source_counts['FPG']}, "
        f"POPULARITY={source_counts['POPULARITY']}, "
        f"ALS={source_counts['ALS']}"
    )
    print(f"Saved: {OUTPUT_PATH}  rows={len(out)}")


if __name__ == "__main__":
    main()
