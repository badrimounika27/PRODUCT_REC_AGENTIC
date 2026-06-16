"""
Step 8: Add FORECASTED_AMT using PPT cluster ratios and base-SKU logic.
Requires recommendations_raw.csv, cleaned_data.csv, clustered_data.csv.
Writes outputs/recommendations_with_amounts.csv.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import pandas as pd
from config import NON_SEASONALITY_MONTHS
from data_windows import filter_last_n_months_in_year, non_seasonality_label

REC_PATH = ROOT / "outputs" / "recommendations_raw.csv"
CLEANED_PATH = ROOT / "outputs" / "cleaned_data.csv"
CLUSTER_PATH = ROOT / "outputs" / "clustered_data.csv"
OUTPUT_PATH = ROOT / "outputs" / "recommendations_with_amounts.csv"


def _parse_skus(cell: object) -> list[str]:
    if cell is None or (isinstance(cell, float) and np.isnan(cell)):
        return []
    return [x.strip() for x in str(cell).split(",") if x.strip()]


def main() -> None:
    for p, hint in [
        (REC_PATH, "Run step 7 first: python src/07_post_processing.py"),
        (CLEANED_PATH, "Run step 1 first: python src/01_data_prep.py"),
        (CLUSTER_PATH, "Run step 3 first: python src/03_clustering.py"),
    ]:
        if not p.is_file():
            print(f"Input missing: {p.name}")
            print(hint)
            sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    rec = pd.read_csv(REC_PATH, low_memory=False)
    tx = pd.read_csv(CLEANED_PATH, low_memory=False)
    cl = pd.read_csv(CLUSTER_PATH, low_memory=False)[["STORE_ID", "CLUSTER_ID"]]

    tx["INV_DATE"] = pd.to_datetime(tx["INV_DATE"], errors="coerce")
    tx["STORE_ID"] = tx["STORE_ID"].astype(str)
    tx["SKU_CODE"] = tx["SKU_CODE"].astype(str)
    tx["L2_CATEGORY"] = tx["L2_CATEGORY"].astype(str)
    cl["STORE_ID"] = cl["STORE_ID"].astype(str)

    print(non_seasonality_label())
    m6 = filter_last_n_months_in_year(tx).merge(cl, on="STORE_ID", how="inner")
    n_months_win = max(int(m6["YEAR_MONTH"].astype(str).nunique()), 1) if len(m6) else NON_SEASONALITY_MONTHS
    tx_3m = filter_last_n_months_in_year(tx)

    mean_c_sku = m6.groupby(["CLUSTER_ID", "SKU_CODE"], observed=False)[
        "NET_AMOUNT"
    ].mean()
    mean_g_sku = m6.groupby("SKU_CODE", observed=False)["NET_AMOUNT"].mean()

    mean_c_dict = {(int(a), str(b)): float(v) for (a, b), v in mean_c_sku.items()}
    mean_g_dict = mean_g_sku.to_dict()

    monthly_spend = (
        m6.groupby(["STORE_ID", "SKU_CODE"], observed=False)["NET_AMOUNT"].sum()
        / float(n_months_win)
    )
    monthly_dict = {(str(a), str(b)): float(v) for (a, b), v in monthly_spend.items()}

    # Distinct SKUs per (store, L2) in non-seasonality window — for base-SKU selection
    sku_by_sl2 = tx_3m.groupby(["STORE_ID", "L2_CATEGORY"], observed=False)[
        "SKU_CODE"
    ].agg(lambda s: list(pd.unique(s.astype(str))))
    sku_l2_dict: dict[tuple[str, str], list[str]] = sku_by_sl2.to_dict()

    def cluster_mean(cid: int, sku: str) -> float:
        sku = str(sku)
        v = mean_c_dict.get((cid, sku))
        if v is None:
            x = mean_g_dict.get(sku, np.nan)
            return float(x) if not pd.isna(x) else float("nan")
        return float(v)

    def monthly(store: str, sku: str) -> float:
        v = monthly_dict.get((store, str(sku)))
        return 0.0 if v is None else float(v)

    n = len(rec)
    stores = rec["STORE_ID"].astype(str).to_numpy()
    cids = rec["CLUSTER_ID"].to_numpy(dtype=int)
    sources = rec["SOURCE"].astype(str).to_numpy()
    skus = rec["SKU_CODE"].astype(str).to_numpy()
    l2s = rec["L2_CATEGORY"].astype(str).to_numpy()
    antes_col = rec["ANTECEDENT_PRODUCTS"].to_numpy() if "ANTECEDENT_PRODUCTS" in rec.columns else np.array([""] * n, dtype=object)

    forecasts = np.zeros(n, dtype=np.float64)

    for i in range(n):
        store = stores[i]
        cid = int(cids[i])
        src = sources[i]
        rec_sku = skus[i]
        rec_l2 = l2s[i]

        if src == "FPG":
            antes = _parse_skus(antes_col[i])
            m_cons = cluster_mean(cid, rec_sku)
            if not antes:
                forecasts[i] = m_cons if not pd.isna(m_cons) else 0.0
                continue
            ante_means = [cluster_mean(cid, a) for a in antes]
            valid_ante = [x for x in ante_means if not pd.isna(x)]
            m_ante = float(np.mean(valid_ante)) if valid_ante else np.nan
            spend_sum = sum(monthly(store, a) for a in antes)
            if not pd.isna(m_ante) and m_ante != 0 and not pd.isna(m_cons):
                forecasts[i] = float(m_cons / m_ante * spend_sum)
            else:
                forecasts[i] = float(m_cons) if not pd.isna(m_cons) else 0.0

        elif src in ("POPULARITY", "ALS"):
            cand_skus = sku_l2_dict.get((store, rec_l2), [])
            base_cands = [b for b in cand_skus if b != rec_sku]

            m_rec = cluster_mean(cid, rec_sku)
            if not base_cands:
                forecasts[i] = float(m_rec) if not pd.isna(m_rec) else 0.0
                continue

            best_base = max(base_cands, key=lambda b: monthly(store, b))
            m_base = cluster_mean(cid, best_base)
            if pd.isna(m_rec) or pd.isna(m_base) or m_base == 0:
                forecasts[i] = float(m_rec) if not pd.isna(m_rec) else 0.0
                continue

            base_ratio = m_rec / m_base
            forecasts[i] = float(base_ratio * monthly(store, best_base))
        else:
            forecasts[i] = 0.0

    out = rec.copy()
    out["FORECASTED_AMT"] = forecasts
    out.to_csv(OUTPUT_PATH, index=False)

    print(
        f"FORECASTED_AMT stats: min={out['FORECASTED_AMT'].min():.2f} "
        f"max={out['FORECASTED_AMT'].max():.2f}"
    )
    print(f"Saved: {OUTPUT_PATH}  rows={len(out)}")


if __name__ == "__main__":
    main()
