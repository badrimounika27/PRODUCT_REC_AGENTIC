"""Aggregate metrics from pipeline outputs (for dashboard & AI context)."""

from __future__ import annotations

import math
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from api.csv_cache import read_csv_cached
from config import get_effective_config


def _final_path(engine: Path) -> Path:
    return engine / "outputs" / "recommendations_final.csv"


def _mtime_iso(path: Path) -> str | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
    except OSError:
        return None


def compute_summary(engine: Path) -> dict[str, Any]:
    """Mirror recommendation_engine /summary shape from CSV on disk."""
    p = _final_path(engine)
    empty = {
        "total_stores": 0,
        "total_recommendations": 0,
        "avg_recommendations_per_store": 0.0,
        "source_breakdown": {"FPG": 0, "POPULARITY": 0, "ALS": 0},
        "top_10_products": [],
        "top_10_products_overall": [],
        "top_10_products_upsell": [],
        "top_10_products_crosssell": [],
        "estimated_monthly_revenue_uplift": 0.0,
        "avg_recommendation_value_per_store": 0.0,
        "pct_stores_with_upsell_opportunity": 0.0,
        "pipeline_last_run": None,
        "data_window_used": "Last 6 months in 2025 (non-seasonality)",
        "recommendation_period": "Current month",
    }
    if not p.is_file():
        return empty

    df = read_csv_cached(p)
    empty["pipeline_last_run"] = _mtime_iso(p)
    if df.empty:
        return empty

    n_stores = int(df["STORE_ID"].nunique())
    n_rows = len(df)
    avg = n_rows / n_stores if n_stores else 0.0
    src = df["SOURCE"].astype(str).str.strip().str.upper()
    br = {
        "FPG": int((src == "FPG").sum()),
        "POPULARITY": int((src == "POPULARITY").sum()),
        "ALS": int((src == "ALS").sum()),
    }
    total_final = float(df["FINAL_ADJUSTED_AMT"].sum()) if "FINAL_ADJUSTED_AMT" in df.columns else 0.0
    est_monthly = total_final / 12.0
    avg_val = total_final / n_stores if n_stores else 0.0
    stores_pop = df.loc[src == "POPULARITY", "STORE_ID"].nunique()
    pct_up = (stores_pop / n_stores * 100.0) if n_stores else 0.0

    def top10(sub: pd.DataFrame) -> list[dict[str, Any]]:
        if sub.empty:
            return []
        vc = (
            sub.groupby(["SKU_CODE", "PRODUCT_NAME"], observed=False)
            .size()
            .reset_index(name="count")
            .sort_values("count", ascending=False)
            .head(10)
        )
        return [
            {
                "sku_code": str(r["SKU_CODE"]),
                "product_name": str(r["PRODUCT_NAME"]),
                "count": int(r["count"]),
            }
            for _, r in vc.iterrows()
        ]

    df_up = df[src == "POPULARITY"]
    df_cross = df[(src == "FPG") | (src == "ALS")]
    top10_all = top10(df)

    return {
        "total_stores": n_stores,
        "total_recommendations": n_rows,
        "avg_recommendations_per_store": float(avg),
        "source_breakdown": br,
        "top_10_products": top10_all,
        "top_10_products_overall": top10_all,
        "top_10_products_upsell": top10(df_up),
        "top_10_products_crosssell": top10(df_cross),
        "estimated_monthly_revenue_uplift": float(est_monthly),
        "avg_recommendation_value_per_store": float(avg_val),
        "pct_stores_with_upsell_opportunity": float(round(pct_up, 2)),
        "pipeline_last_run": _mtime_iso(p),
        "data_window_used": "Last 6 months in 2025 (non-seasonality)",
        "recommendation_period": "Current month",
    }


def compute_cluster_breakdown(engine: Path) -> dict[str, Any]:
    clp = engine / "outputs" / "clustered_data.csv"
    fp = _final_path(engine)
    if not clp.is_file() or not fp.is_file():
        return {"clusters": []}

    cl = read_csv_cached(clp)
    df = read_csv_cached(fp)
    counts = cl.groupby("CLUSTER_ID", observed=False)["STORE_ID"].nunique()
    top_cat: dict[int, str] = {}
    t = (
        df.groupby(["CLUSTER_ID", "CATEGORY"], observed=False)
        .size()
        .reset_index(name="n")
        .sort_values(["CLUSTER_ID", "n"], ascending=[True, False])
        .drop_duplicates("CLUSTER_ID", keep="first")
    )
    for _, r in t.iterrows():
        top_cat[int(r["CLUSTER_ID"])] = str(r["CATEGORY"])

    rows = []
    for cid in sorted(counts.index.tolist(), key=lambda x: (x < 0, x)):
        cid_i = int(cid)
        rows.append(
            {
                "cluster_id": cid_i,
                "store_count": int(counts.loc[cid]),
                "top_category": top_cat.get(cid_i, "—"),
                "cluster_persona": f"{top_cat.get(cid_i, 'Mixed').split()[0] if top_cat.get(cid_i) else 'Mixed'}-focused stores",
                "primary_recommendation_type": "—",
            }
        )
    return {"clusters": rows}


def _humanize_col(name: str) -> str:
    return name.replace("_", " ").strip().title()


def compute_cluster_profile(engine: Path) -> dict[str, Any]:
    """
    Cluster × metrics matrix for heatmap UI: mean feature values per CLUSTER_ID from clustered_data.csv.
    Adds PURCHASE_FREQ_PER_DAY = 1 / mean(AVG_NO_DAYS_BETWEEN_PURCHASE) per cluster when that column exists.
    """
    clp = engine / "outputs" / "clustered_data.csv"
    if not clp.is_file():
        return {"available": False, "columns": [], "rows": []}

    df = read_csv_cached(clp).copy()
    if "CLUSTER_ID" not in df.columns or "STORE_ID" not in df.columns:
        return {"available": False, "columns": [], "rows": []}

    skip = {"STORE_ID", "CLUSTER_ID", "NEW_CUSTOMER"}
    num_cols: list[str] = []
    for c in df.columns:
        if c in skip:
            continue
        s = pd.to_numeric(df[c], errors="coerce")
        if s.notna().sum() == 0:
            continue
        df[c] = s
        num_cols.append(c)

    if not num_cols:
        return {"available": True, "columns": [], "rows": []}

    counts = df.groupby("CLUSTER_ID", observed=False)["STORE_ID"].nunique()
    agg = df.groupby("CLUSTER_ID", observed=False)[num_cols].mean()

    days_col = "AVG_NO_DAYS_BETWEEN_PURCHASE"
    if days_col in agg.columns:

        def inv_mean(v: Any) -> float:
            try:
                x = float(v)
            except (TypeError, ValueError):
                return 0.0
            if math.isnan(x) or x <= 0:
                return 0.0
            return 1.0 / x

        agg["PURCHASE_FREQ_PER_DAY"] = agg[days_col].apply(inv_mean)

    LABELS: dict[str, tuple[str, str]] = {
        "NET_AMT_AVG_MONTHLY": ("Avg monthly net spend", "Spend & frequency"),
        "AVG_INVOICE_PURCHASE": ("Avg invoice amount", "Spend & frequency"),
        "UNIQUE_PRD_COUNT": ("Unique products (avg)", "Spend & frequency"),
        "INV_COUNT_AVG_MONTHLY": ("Avg invoices per month", "Spend & frequency"),
        "UNIQUE_PRD_COUNT_PER_INV": ("Products per invoice (avg)", "Spend & frequency"),
        "AVG_NO_DAYS_BETWEEN_PURCHASE": ("Avg days between purchases", "Spend & frequency"),
        "PURCHASE_FREQ_PER_DAY": ("Purchase frequency (per day)", "Spend & frequency"),
        "Kids_SALES_PCT": ("Kids share", "Category mix"),
        "Men_SALES_PCT": ("Men share", "Category mix"),
        "Women_SALES_PCT": ("Women share", "Category mix"),
    }

    TOP_CATEGORY_PCT = ("Kids_SALES_PCT", "Men_SALES_PCT", "Women_SALES_PCT")
    PRICE_TIER_COLS = ("Entry_PCT", "Luxury_PCT", "Mid_PCT", "Premium_PCT")

    def group_for(col: str) -> str:
        if col in LABELS:
            return LABELS[col][1]
        if col in TOP_CATEGORY_PCT:
            return "Category mix"
        if col.endswith("_SALES_PCT") or "_SALES_PCT" in col:
            return "Category mix"
        if col in PRICE_TIER_COLS:
            return "Price tier"
        return "Other"

    def label_for(col: str) -> str:
        if col in LABELS:
            return LABELS[col][0]
        return _humanize_col(col)

    core = [
        "NET_AMT_AVG_MONTHLY",
        "AVG_INVOICE_PURCHASE",
        "UNIQUE_PRD_COUNT",
        "INV_COUNT_AVG_MONTHLY",
        "UNIQUE_PRD_COUNT_PER_INV",
        "AVG_NO_DAYS_BETWEEN_PURCHASE",
    ]
    ordered: list[str] = []
    for p in core:
        if p in agg.columns:
            ordered.append(p)
    if "PURCHASE_FREQ_PER_DAY" in agg.columns:
        ordered.append("PURCHASE_FREQ_PER_DAY")
    for p in TOP_CATEGORY_PCT:
        if p in agg.columns:
            ordered.append(p)
    for p in PRICE_TIER_COLS:
        if p in agg.columns:
            ordered.append(p)
    seen = set(ordered)
    for c in sorted(agg.columns):
        if c in seen:
            continue
        if c.endswith("_SALES_PCT"):
            continue
        if c in TOP_CATEGORY_PCT or c in PRICE_TIER_COLS:
            continue
        ordered.append(c)

    columns_out = [{"id": c, "label": label_for(c), "group": group_for(c)} for c in ordered]

    rows_out: list[dict[str, Any]] = []
    for clus in sorted(agg.index.tolist(), key=lambda x: (x < 0, x)):
        cid_i = int(clus)
        vals: dict[str, float] = {}
        for c in ordered:
            v = agg.loc[clus, c]
            if v is None or (isinstance(v, float) and pd.isna(v)):
                vals[c] = 0.0
            else:
                vals[c] = float(v)
        rows_out.append(
            {
                "cluster_id": cid_i,
                "store_count": int(counts.loc[clus]),
                "values": vals,
            }
        )

    return {"available": True, "columns": columns_out, "rows": rows_out}


def compute_cluster_store_features(engine: Path, cluster_id: int) -> dict[str, Any]:
    """
    Per-store feature rows for one CLUSTER_ID from clustered_data.csv.
    Adds PURCHASE_FREQ_PER_DAY = 1 / AVG_NO_DAYS_BETWEEN_PURCHASE when days > 0.
    """
    clp = engine / "outputs" / "clustered_data.csv"
    if not clp.is_file():
        return {"available": False, "columns": [], "rows": []}

    df = read_csv_cached(clp).copy()
    if "CLUSTER_ID" not in df.columns or "STORE_ID" not in df.columns:
        return {"available": False, "columns": [], "rows": []}

    part = df.loc[df["CLUSTER_ID"] == int(cluster_id)].copy()
    if part.empty:
        return {"available": True, "columns": [], "rows": []}

    part["STORE_ID"] = part["STORE_ID"].astype(str)
    part["CLUSTER_ID"] = part["CLUSTER_ID"].astype(int)

    skip = {"NEW_CUSTOMER"}
    metric_cols: list[str] = []
    for c in part.columns:
        if c in ("STORE_ID", "CLUSTER_ID") or c in skip:
            continue
        s = pd.to_numeric(part[c], errors="coerce")
        if s.notna().sum() == 0:
            continue
        part[c] = s
        metric_cols.append(c)

    days_col = "AVG_NO_DAYS_BETWEEN_PURCHASE"
    if days_col in part.columns:
        days = pd.to_numeric(part[days_col], errors="coerce")
        freq = days.where(days > 0).rdiv(1.0)
        part["PURCHASE_FREQ_PER_DAY"] = freq
        if "PURCHASE_FREQ_PER_DAY" not in metric_cols:
            metric_cols.append("PURCHASE_FREQ_PER_DAY")

    LABELS: dict[str, str] = {
        "STORE_ID": "Store ID",
        "CLUSTER_ID": "Cluster ID",
        "NET_AMT_AVG_MONTHLY": "Avg Monthly Net Spend",
        "AVG_INVOICE_PURCHASE": "Avg Invoice Amount",
        "UNIQUE_PRD_COUNT": "Unique Products (Avg)",
        "INV_COUNT_AVG_MONTHLY": "Avg Invoices per Month",
        "UNIQUE_PRD_COUNT_PER_INV": "Products per Invoice (Avg)",
        "AVG_NO_DAYS_BETWEEN_PURCHASE": "Avg Days Between Purchases",
        "PURCHASE_FREQ_PER_DAY": "Purchase Frequency",
        "Kids_SALES_PCT": "Kids Share",
        "Men_SALES_PCT": "Men Share",
        "Women_SALES_PCT": "Women Share",
        "Entry_PCT": "Entry %",
        "Mid_PCT": "Mid %",
        "Premium_PCT": "Premium %",
        "Luxury_PCT": "Luxury %",
    }

    preferred = [
        "NET_AMT_AVG_MONTHLY",
        "AVG_INVOICE_PURCHASE",
        "UNIQUE_PRD_COUNT",
        "INV_COUNT_AVG_MONTHLY",
        "UNIQUE_PRD_COUNT_PER_INV",
        "AVG_NO_DAYS_BETWEEN_PURCHASE",
        "PURCHASE_FREQ_PER_DAY",
        "Kids_SALES_PCT",
        "Men_SALES_PCT",
        "Women_SALES_PCT",
        "Entry_PCT",
        "Mid_PCT",
        "Premium_PCT",
        "Luxury_PCT",
    ]
    ordered_metrics: list[str] = [c for c in preferred if c in metric_cols]
    seen = set(ordered_metrics)
    for c in sorted(metric_cols):
        if c not in seen:
            ordered_metrics.append(c)

    def label_for(col: str) -> str:
        if col in LABELS:
            return LABELS[col]
        return _humanize_col(col)

    columns_out = [
        {"id": "STORE_ID", "label": "Store ID"},
        {"id": "CLUSTER_ID", "label": "Cluster ID"},
        *[{"id": c, "label": label_for(c)} for c in ordered_metrics],
    ]

    rows_out: list[dict[str, Any]] = []
    # One row per store (dedupe if CSV ever has duplicates)
    part = part.drop_duplicates(subset=["STORE_ID"], keep="first")
    part = part.sort_values("STORE_ID")
    for _, r in part.iterrows():
        row: dict[str, Any] = {
            "STORE_ID": str(r["STORE_ID"]),
            "CLUSTER_ID": int(r["CLUSTER_ID"]),
        }
        for c in ordered_metrics:
            v = r.get(c)
            if v is None or (isinstance(v, float) and pd.isna(v)):
                row[c] = None
            else:
                try:
                    row[c] = float(v)
                except (TypeError, ValueError):
                    row[c] = None
        rows_out.append(row)

    return {"available": True, "columns": columns_out, "rows": rows_out}


def compute_forecast_context(engine: Path) -> dict[str, Any]:
    """Aggregates for forecast / risk AI panel."""
    p = _final_path(engine)
    if not p.is_file():
        return {}
    df = read_csv_cached(p)
    cfg = get_effective_config()
    src = df["SOURCE"].astype(str).str.strip().str.upper()
    amt = df["FINAL_ADJUSTED_AMT"].astype(float) if "FINAL_ADJUSTED_AMT" in df.columns else 0
    conf = df["CONFIDENCE"].astype(float) if "CONFIDENCE" in df.columns else 0
    forecast_accuracy: dict[str, Any] = {"available": False}
    tx_path = engine / "data" / "raw" / "transactions.csv"
    if tx_path.is_file():
        try:
            tx_hdr = pd.read_csv(tx_path, nrows=0).columns.tolist()
            need = {"YEAR_MONTH", "LINE_AMOUNT"}
            if need.issubset(set(tx_hdr)):
                tx = read_csv_cached(tx_path, usecols=list(need)).copy()
                tx["YEAR_MONTH"] = tx["YEAR_MONTH"].astype(str)
                tx["LINE_AMOUNT"] = pd.to_numeric(tx["LINE_AMOUNT"], errors="coerce").fillna(0.0)
                monthly = tx.groupby("YEAR_MONTH", observed=False)["LINE_AMOUNT"].sum().sort_index()
                if len(monthly):
                    last_month = str(monthly.index[-1])
                    actual_amt = float(monthly.iloc[-1])
                    forecast_amt = float(amt.sum()) / 12.0 if len(df) else 0.0
                    denom = abs(actual_amt) if abs(actual_amt) > 1e-6 else max(abs(forecast_amt), 1.0)
                    err_pct = abs(forecast_amt - actual_amt) / denom * 100.0
                    accuracy_pct = max(0.0, 100.0 - err_pct)
                    forecast_accuracy = {
                        "available": True,
                        "month_label": last_month,
                        "forecast_amount": float(forecast_amt),
                        "actual_amount": float(actual_amt),
                        "accuracy_pct": float(round(accuracy_pct, 2)),
                        "error_pct": float(round(err_pct, 2)),
                    }
        except Exception:
            forecast_accuracy = {"available": False}
    return {
        "config": cfg,
        "total_estimated_amount": float(amt.sum()),
        "mean_confidence": float(conf.mean()) if len(conf) else 0.0,
        "median_confidence": float(conf.median()) if len(conf) else 0.0,
        "low_confidence_rows": int((conf < 0.5).sum()) if len(conf) else 0,
        "forecast_accuracy": forecast_accuracy,
        "source_value_share": {
            "FPG": float(amt[src == "FPG"].sum()),
            "POPULARITY": float(amt[src == "POPULARITY"].sum()),
            "ALS": float(amt[src == "ALS"].sum()),
        },
        "top_categories_by_amount": (
            df.groupby("CATEGORY", observed=False)["FINAL_ADJUSTED_AMT"]
            .sum()
            .sort_values(ascending=False)
            .head(8)
            .to_dict()
            if "CATEGORY" in df.columns
            else {}
        ),
    }


def compute_chat_hints(engine: Path) -> dict[str, Any]:
    """
    Structured facts for /ai/chat so the model can answer cluster / attention / next-step
    questions without claiming missing data when CSVs exist.
    """
    p = _final_path(engine)
    out: dict[str, Any] = {
        "has_recommendations_file": False,
        "instruction_for_model": (
            "Use clusters_ranked_lowest_avg_confidence_first and smallest_clusters_by_store_count "
            "to answer which cluster needs attention. Cite cluster_id and numeric values from this JSON. "
            "Use summary for network-wide next steps. Do not say you lack data if "
            "has_recommendations_file is true and cluster lists are non-empty."
        ),
    }
    if not p.is_file():
        return out

    df = read_csv_cached(p)
    out["has_recommendations_file"] = True
    out["summary_one_liner"] = {
        "total_stores": int(df["STORE_ID"].nunique()) if "STORE_ID" in df.columns else 0,
        "total_recommendation_rows": len(df),
    }

    clusters_low_conf: list[dict[str, Any]] = []
    if "CLUSTER_ID" in df.columns and "CONFIDENCE" in df.columns:
        g = df.groupby("CLUSTER_ID", observed=False)["CONFIDENCE"].agg(["mean", "count"])
        g = g.sort_values("mean", ascending=True)
        for cid, row in g.head(10).iterrows():
            clusters_low_conf.append(
                {
                    "cluster_id": int(cid),
                    "avg_confidence": float(row["mean"]),
                    "recommendation_rows": int(row["count"]),
                }
            )
    out["clusters_ranked_lowest_avg_confidence_first"] = clusters_low_conf

    bd = compute_cluster_breakdown(engine)
    clist = bd.get("clusters", [])
    smallest = sorted(clist, key=lambda x: x.get("store_count", 0))[:10]
    out["smallest_clusters_by_store_count"] = smallest

    if clusters_low_conf:
        worst = clusters_low_conf[0]
        out["suggested_attention_cluster_id"] = worst["cluster_id"]
        out["suggested_attention_reason"] = (
            f"Cluster {worst['cluster_id']} has the lowest average confidence "
            f"({worst['avg_confidence']:.4f}) across {worst['recommendation_rows']} recommendation rows."
        )
    elif clist:
        s = sorted(clist, key=lambda x: x.get("store_count", 0))[0]
        cid = s.get("cluster_id")
        out["suggested_attention_cluster_id"] = cid
        out["suggested_attention_reason"] = (
            f"Cluster {cid} has the fewest stores ({s.get('store_count')}) in segmentation — "
            "consider coverage, assortment fit, or data sparsity."
        )

    return out


def compute_store_spend_history(engine: Path, store_id: str) -> dict[str, Any]:
    """Last up to 6 calendar months of LINE_AMOUNT sum per YEAR_MONTH for one store (transactions.csv)."""
    tx_path = engine / "data" / "raw" / "transactions.csv"
    if not tx_path.is_file():
        return {"available": False, "store_id": str(store_id), "series": []}
    try:
        hdr = pd.read_csv(tx_path, nrows=0).columns.tolist()
    except Exception:
        return {"available": False, "store_id": str(store_id), "series": []}
    need = {"STORE_ID", "YEAR_MONTH", "LINE_AMOUNT"}
    if not need.issubset(set(hdr)):
        return {"available": False, "store_id": str(store_id), "series": []}
    df = read_csv_cached(tx_path, usecols=list(need)).copy()
    df["LINE_AMOUNT"] = pd.to_numeric(df["LINE_AMOUNT"], errors="coerce").fillna(0.0)
    df["STORE_ID"] = df["STORE_ID"].astype(str)
    df["YEAR_MONTH"] = df["YEAR_MONTH"].astype(str)
    sub = df.loc[df["STORE_ID"] == str(store_id)]
    if sub.empty:
        return {"available": True, "store_id": str(store_id), "series": []}
    m = (
        sub.groupby("YEAR_MONTH", observed=False)["LINE_AMOUNT"]
        .sum()
        .reset_index()
        .sort_values("YEAR_MONTH")
    )
    tail = m.tail(6)
    series = [
        {"period": str(r["YEAR_MONTH"]), "spend": float(r["LINE_AMOUNT"])}
        for _, r in tail.iterrows()
    ]
    return {"available": True, "store_id": str(store_id), "series": series}
