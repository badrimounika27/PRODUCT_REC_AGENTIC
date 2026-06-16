"""
Generate Excel workbook with step-by-step forecast calculation trace for one store x SKU.
Run from backend/:  python scripts/build_forecast_excel_trace.py
Outputs: ../archive/docs/forecast_trace_<SKU>_<STORE>.xlsx
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent  # backend/
SRC = ROOT / "pipeline"
for p in (ROOT, SRC):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from data_windows import filter_last_n_months_in_year, non_seasonality_label  # noqa: E402
from config import NON_SEASONALITY_MONTHS, SEASONALITY_HISTORY_YEARS  # noqa: E402

STORE_ID = "S01044"
SKU_CODE = "MEN-OUT-JAC-002"
PRODUCT_NAME = "Waxed Canvas Field Jacket"


def cluster_means_and_monthly(tx: pd.DataFrame, cl: pd.DataFrame) -> tuple:
    m6 = filter_last_n_months_in_year(tx).merge(cl, on="STORE_ID", how="inner")
    n_months_win = max(int(m6["YEAR_MONTH"].astype(str).nunique()), 1) if len(m6) else NON_SEASONALITY_MONTHS

    mean_c_sku = m6.groupby(["CLUSTER_ID", "SKU_CODE"], observed=False)["NET_AMOUNT"].mean()
    mean_g_sku = m6.groupby("SKU_CODE", observed=False)["NET_AMOUNT"].mean()
    mean_c_dict = {(int(a), str(b)): float(v) for (a, b), v in mean_c_sku.items()}
    mean_g_dict = mean_g_sku.to_dict()

    monthly_spend = m6.groupby(["STORE_ID", "SKU_CODE"], observed=False)["NET_AMOUNT"].sum() / float(
        n_months_win
    )
    monthly_dict = {(str(a), str(b)): float(v) for (a, b), v in monthly_spend.items()}

    tx_3m = filter_last_n_months_in_year(tx)
    sku_by_sl2 = tx_3m.groupby(["STORE_ID", "L2_CATEGORY"], observed=False)["SKU_CODE"].agg(
        lambda s: list(pd.unique(s.astype(str)))
    )
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

    return (
        m6,
        tx_3m,
        n_months_win,
        mean_c_dict,
        mean_g_dict,
        monthly_dict,
        sku_l2_dict,
        cluster_mean,
        monthly,
    )


def main() -> None:
    out_xlsx = ROOT.parent / "archive" / "docs" / f"forecast_trace_{SKU_CODE}_{STORE_ID}.xlsx"

    tx = pd.read_csv(ROOT / "outputs" / "cleaned_data.csv", low_memory=False)
    cl = pd.read_csv(ROOT / "outputs" / "clustered_data.csv")[["STORE_ID", "CLUSTER_ID"]]
    tx["INV_DATE"] = pd.to_datetime(tx["INV_DATE"], errors="coerce")
    for c in ("STORE_ID", "SKU_CODE", "L2_CATEGORY"):
        tx[c] = tx[c].astype(str)
    cl["STORE_ID"] = cl["STORE_ID"].astype(str)

    final = pd.read_csv(ROOT / "outputs" / "recommendations_final.csv", low_memory=False)
    final["STORE_ID"] = final["STORE_ID"].astype(str)
    final["SKU_CODE"] = final["SKU_CODE"].astype(str)
    row = final.loc[(final["STORE_ID"] == STORE_ID) & (final["SKU_CODE"] == SKU_CODE)]
    if row.empty:
        print("Row not found in recommendations_final.csv")
        sys.exit(1)
    r = row.iloc[0]
    cluster_id = int(r["CLUSTER_ID"])
    l2 = str(r["L2_CATEGORY"])
    source = str(r["SOURCE"])

    (
        m6,
        tx_3m,
        n_months_win,
        mean_c_dict,
        mean_g_dict,
        monthly_dict,
        sku_l2_dict,
        cluster_mean,
        monthly,
    ) = cluster_means_and_monthly(tx, cl)

    # --- Step 08 ALS branch ---
    cand_skus = sku_l2_dict.get((STORE_ID, l2), [])
    if isinstance(cand_skus, float) and pd.isna(cand_skus):
        cand_skus = []
    base_cands = [b for b in cand_skus if b != SKU_CODE]

    m_rec = cluster_mean(cluster_id, SKU_CODE)
    best_base: str | None = None
    m_base = float("nan")
    mon_base = 0.0
    base_ratio = float("nan")
    forecasted = 0.0

    if source in ("POPULARITY", "ALS"):
        if not base_cands:
            forecasted = float(m_rec) if not pd.isna(m_rec) else 0.0
        else:
            best_base = max(base_cands, key=lambda b: monthly(STORE_ID, b))
            m_base = cluster_mean(cluster_id, best_base)
            mon_base = monthly(STORE_ID, best_base)
            if pd.isna(m_rec) or pd.isna(m_base) or m_base == 0:
                forecasted = float(m_rec) if not pd.isna(m_rec) else 0.0
            else:
                base_ratio = m_rec / m_base
                forecasted = float(base_ratio * mon_base)

    # Monthly spend table for Outerwear @ store (for Excel)
    rows_monthly = []
    for sku in cand_skus:
        rows_monthly.append(
            {
                "SKU_CODE": sku,
                "is_recommended_SKU": sku == SKU_CODE,
                "avg_monthly_NET_AMOUNT_at_store": monthly(STORE_ID, sku),
                "cluster_mean_NET_AMOUNT": cluster_mean(cluster_id, sku),
            }
        )
    if rows_monthly:
        df_monthly = pd.DataFrame(rows_monthly).sort_values(
            "avg_monthly_NET_AMOUNT_at_store", ascending=False
        )
    else:
        df_monthly = pd.DataFrame(
            columns=["SKU_CODE", "is_recommended_SKU", "avg_monthly_NET_AMOUNT_at_store", "cluster_mean_NET_AMOUNT"]
        )

    # --- Step 09 ---
    end = tx["INV_DATE"].max()
    current_month = int(end.month)
    mult_df = pd.read_csv(ROOT / "outputs" / "seasonality_multipliers.csv", low_memory=False)
    sm_row = mult_df[(mult_df["L2_CATEGORY"] == l2) & (mult_df["MONTH"] == current_month)]
    seasonal_mult = float(sm_row["SEASONALITY_MULTIPLIER"].iloc[0]) if len(sm_row) else 1.0
    amt_after_seas = forecasted * seasonal_mult

    # --- Step 10 ---
    pm_csv = pd.read_csv(ROOT / "outputs" / "promo_elasticity_by_sku_cluster.csv", low_memory=False)
    pm_row = pm_csv[(pm_csv["SKU_CODE"] == SKU_CODE) & (pm_csv["CLUSTER_ID"] == cluster_id)]
    if len(pm_row):
        beta = float(pm_row["BETA"].iloc[0])
        avg_disc = float(pm_row["AVG_DISCOUNT_PCT"].iloc[0])
        promo_mult = float(pm_row["PROMOTIONAL_MULTIPLIER"].iloc[0])
        raw_pm = 1.0 - (beta * avg_disc / 100.0)
    else:
        beta = float("nan")
        avg_disc = float("nan")
        promo_mult = 1.0
        raw_pm = 1.0
    final_adj = amt_after_seas * promo_mult

    # --- Step 11 ---
    tx["MRP"] = pd.to_numeric(tx["MRP"], errors="coerce")
    max_sku = tx.groupby("SKU_CODE", observed=False)["MRP"].max()
    l2_mrp = tx.groupby("L2_CATEGORY", observed=False)["MRP"].mean()
    mrp_val = max_sku.get(SKU_CODE, np.nan)
    if pd.isna(mrp_val) or mrp_val == 0:
        mrp_val = l2_mrp.get(l2, np.nan)
    if pd.isna(mrp_val) or mrp_val == 0:
        mrp_val = 1.0
    mrp_val = max(float(mrp_val), 1e-9)
    vol_raw = round(final_adj / mrp_val)
    volume = max(int(vol_raw), 1)

    # --- Excel ---
    with pd.ExcelWriter(out_xlsx, engine="openpyxl") as writer:
        cover = pd.DataFrame(
            {
                "Field": [
                    "Workbook",
                    "Store",
                    "SKU",
                    "Product",
                    "Cluster ID",
                    "SOURCE (recommendation)",
                    "L2_CATEGORY",
                    "Data: non-seasonality window",
                    "Data: seasonality history",
                    "Pipeline outputs folder",
                ],
                "Value": [
                    "Forecast calculation trace (steps 08–11)",
                    STORE_ID,
                    SKU_CODE,
                    PRODUCT_NAME,
                    cluster_id,
                    source,
                    l2,
                    non_seasonality_label(),
                    f"Up to {SEASONALITY_HISTORY_YEARS} years ending max(INV_DATE)",
                    str(ROOT / "outputs"),
                ],
            }
        )
        cover.to_excel(writer, sheet_name="00_Cover", index=False)

        s08 = pd.DataFrame(
            {
                "Step": ["8"] * 12,
                "Item": [
                    "SOURCE branch",
                    "Distinct YEAR_MONTH count in window (n_months_win)",
                    "m_rec = mean NET_AMOUNT for (CLUSTER_ID, recommended SKU) in window; else global SKU mean",
                    "SKUs purchased at (STORE, L2) in same window (tx_3m)",
                    "Base candidates (same L2, excluding recommended SKU)",
                    "best_base = base SKU with highest avg monthly spend at this store",
                    "m_base = cluster mean NET for (CLUSTER_ID, best_base)",
                    "monthly(STORE, best_base) = sum NET in window / n_months_win",
                    "base_ratio = m_rec / m_base",
                    "FORECASTED_AMT = base_ratio × monthly(STORE, best_base)",
                    "—",
                    "FORECASTED_AMT (from recommendations_final.csv for check)",
                ],
                "Formula_or_note": [
                    "ALS / POPULARITY: ratio × monthly spend at base SKU",
                    "Used to scale total spend to average per month",
                    f"Cluster {cluster_id}, SKU {SKU_CODE}",
                    "Distinct SKU list for store+L2",
                    ", ".join(base_cands) if base_cands else "(none)",
                    str(best_base) if best_base else "N/A",
                    f"{m_base:.6f}" if best_base and not pd.isna(m_base) else "N/A",
                    f"{mon_base:.6f}" if best_base else "N/A",
                    f"{base_ratio:.8f}" if best_base and not pd.isna(base_ratio) else "N/A",
                    f"= {forecasted:.6f}",
                    "",
                    f"{float(r['FORECASTED_AMT']):.6f}",
                ],
                "Numeric_value": [
                    source,
                    n_months_win,
                    m_rec,
                    len(cand_skus),
                    len(base_cands),
                    best_base if best_base else "",
                    m_base if best_base and not pd.isna(m_base) else np.nan,
                    mon_base if best_base else np.nan,
                    base_ratio if best_base and not pd.isna(base_ratio) else np.nan,
                    forecasted,
                    np.nan,
                    float(r["FORECASTED_AMT"]),
                ],
            }
        )
        s08.to_excel(writer, sheet_name="01_Step08_FORECASTED_AMT", index=False)
        df_monthly.to_excel(writer, sheet_name="01b_Monthly_by_SKU_at_store", index=False)

        s09 = pd.DataFrame(
            {
                "Item": [
                    "max(INV_DATE) in cleaned_data",
                    "Calendar month used for seasonality (pipeline)",
                    "L2_CATEGORY",
                    "SEASONAL_MULTIPLIER (from seasonality_multipliers.csv)",
                    "FORECASTED_AMT_AFTER_SEASONALITY = FORECASTED_AMT × SEASONAL_MULTIPLIER",
                    "Check vs recommendations_final",
                ],
                "Value": [
                    str(end.date()),
                    current_month,
                    l2,
                    seasonal_mult,
                    amt_after_seas,
                    float(r["FORECASTED_AMT_AFTER_SEASONALITY"]),
                ],
            }
        )
        s09.to_excel(writer, sheet_name="02_Step09_Seasonality", index=False)

        s10 = pd.DataFrame(
            {
                "Item": [
                    "Promo regression: NET_AMOUNT ~ DISCOUNT_PCT on promo lines (EVENT_TAG, DISCOUNT>0)",
                    "beta (slope)",
                    "AVG_DISCOUNT_PCT for (SKU, CLUSTER)",
                    "raw = 1 − beta × AVG_DISCOUNT_PCT / 100",
                    "PROMOTIONAL_MULTIPLIER = max(raw, 1.0)",
                    "FINAL_ADJUSTED_AMT = FORECASTED_AMT_AFTER_SEASONALITY × PROMOTIONAL_MULTIPLIER",
                    "Check vs recommendations_final",
                ],
                "Value": [
                    "",
                    beta,
                    avg_disc,
                    raw_pm,
                    promo_mult,
                    final_adj,
                    float(r["FINAL_ADJUSTED_AMT"]),
                ],
            }
        )
        s10.to_excel(writer, sheet_name="03_Step10_Promotional", index=False)

        s11 = pd.DataFrame(
            {
                "Item": [
                    "MAX_LIST_PRICE = max(MRP) for SKU in cleaned_data; else mean MRP by L2",
                    "VOLUME = max(round(FINAL_ADJUSTED_AMT / MAX_LIST_PRICE), 1)",
                    "MAX_LIST_PRICE (check)",
                    "VOLUME (check)",
                ],
                "Value": [mrp_val, volume, float(r["MAX_LIST_PRICE"]), int(r["VOLUME"])],
            }
        )
        s11.to_excel(writer, sheet_name="04_Step11_Volume", index=False)

        chain = pd.DataFrame(
            {
                "Column": [
                    "FORECASTED_AMT",
                    "× SEASONAL_MULTIPLIER",
                    "= FORECASTED_AMT_AFTER_SEASONALITY",
                    "× PROMOTIONAL_MULTIPLIER",
                    "= FINAL_ADJUSTED_AMT",
                    "÷ MAX_LIST_PRICE",
                    "= VOLUME (rounded, min 1)",
                ],
                "Excel_style_formula": [
                    "",
                    "",
                    "=FORECASTED_AMT*SEASONAL_MULTIPLIER",
                    "",
                    "=FORECASTED_AMT_AFTER_SEASONALITY*PROMOTIONAL_MULTIPLIER",
                    "",
                    "=MAX(ROUND(FINAL_ADJUSTED_AMT/MAX_LIST_PRICE,0),1)",
                ],
                "Computed": [
                    forecasted,
                    seasonal_mult,
                    amt_after_seas,
                    promo_mult,
                    final_adj,
                    mrp_val,
                    volume,
                ],
            }
        )
        chain.to_excel(writer, sheet_name="05_Full_chain", index=False)

        verify = pd.DataFrame(
            {
                "Field": list(r.index),
                "recommendations_final.csv": r.values,
            }
        )
        verify.to_excel(writer, sheet_name="06_Raw_row_final_CSV", index=False)

    print(f"Saved: {out_xlsx}")


if __name__ == "__main__":
    main()
