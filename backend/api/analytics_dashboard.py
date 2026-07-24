"""
Pure dataset analytics for the Dashboard (sales transactions and location-level enrichments).
No recommendations / AI — exploratory understanding only.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from api.csv_cache import read_csv_cached


def _safe_div(a: float, b: float) -> float:
    if b == 0 or (isinstance(b, float) and np.isnan(b)):
        return 0.0
    return float(a / b)


# Align with recommendation_engine: non-seasonality = last N months in this year; heatmap = up to 36 months.
_DASH_NON_SEASON_YEAR = 2025
_DASH_NON_SEASON_N = 6
_SEASONALITY_HEATMAP_MAX_MONTHS = 36


def _df_last_n_months_in_year(
    df: pd.DataFrame, year: int = _DASH_NON_SEASON_YEAR, n: int = _DASH_NON_SEASON_N
) -> pd.DataFrame:
    """Rows whose YEAR_MONTH falls in the last ``n`` distinct months of ``year``."""
    if df.empty or "YEAR_MONTH" not in df.columns:
        return df.iloc[0:0].copy()
    ym = df["YEAR_MONTH"].astype(str).str.strip()
    sub = df.loc[ym.str.startswith(f"{year}-")].copy()
    if sub.empty:
        return sub
    months = sorted(sub["YEAR_MONTH"].astype(str).unique())
    if len(months) > n:
        months = months[-n:]
    return sub.loc[sub["YEAR_MONTH"].astype(str).isin(months)].copy()


# In-process cache: recomputes only when transactions.csv or featured_data.csv changes (mtime).
_dash_cache: dict[str, Any] | None = None
_dash_cache_sig: tuple[float, float] | None = None


def _dashboard_cache_signature(engine: Path) -> tuple[float, float]:
    tx = engine / "data" / "raw" / "transactions.csv"
    ft = engine / "outputs" / "featured_data.csv"

    def _mt(p: Path) -> float:
        try:
            return float(p.stat().st_mtime)
        except OSError:
            return -1.0

    return (_mt(tx), _mt(ft))


def _read_transactions_df(tx_path: Path) -> pd.DataFrame:
    """Load only columns needed for analytics (faster on wide / large CSVs)."""
    try:
        hdr = pd.read_csv(tx_path, nrows=0).columns.tolist()
    except Exception:
        return read_csv_cached(tx_path)
    need = {
        "LINE_AMOUNT",
        "INVOICE_ID",
        "STORE_ID",
        "SKU_CODE",
        "YEAR_MONTH",
        "DISCOUNT_PCT",
        "QTY",
    }
    if "L2_CATEGORY" in hdr:
        need.add("L2_CATEGORY")
    elif "CATEGORY" in hdr:
        need.add("CATEGORY")
    usecols = [c for c in hdr if c in need]
    if "LINE_AMOUNT" not in usecols or "INVOICE_ID" not in usecols:
        return read_csv_cached(tx_path)
    return read_csv_cached(tx_path, usecols=usecols)


def _read_featured_subset(feat_path: Path) -> pd.DataFrame:
    want = [
        "NET_AMT_AVG_MONTHLY",
        "AVG_INVOICE_PURCHASE",
        "UNIQUE_PRD_COUNT",
        "AVG_NO_DAYS_BETWEEN_PURCHASE",
        "UNIQUE_PRD_COUNT_PER_INV",
    ]
    try:
        hdr = pd.read_csv(feat_path, nrows=0).columns.tolist()
    except Exception:
        return read_csv_cached(feat_path)
    usecols = [c for c in want if c in hdr]
    if not usecols:
        return read_csv_cached(feat_path)
    return read_csv_cached(feat_path, usecols=usecols)


def _compute_dashboard_analytics_uncached(engine: Path) -> dict[str, Any]:
    tx_path = engine / "data" / "raw" / "transactions.csv"
    feat_path = engine / "outputs" / "featured_data.csv"
    rec_path = engine / "outputs" / "recommendations_final.csv"

    out: dict[str, Any] = {
        "meta": {
            "transactions_available": tx_path.is_file(),
            "featured_available": feat_path.is_file(),
            "time_period_months": 0,
            "time_period_label": "",
        },
        "overview": {},
        "monthly_trend": [],
        "line_amount_histogram": [],
        "invoice_total_histogram": [],
        "invoice_frequency_histogram": [],
        "feature_insights": {},
        "category_intelligence": [],
        "seasonality_heatmap": {"categories": [], "months": [], "matrix": []},
        "category_contribution": [],
        "time_series": {"revenue": [], "orders": []},
        "kpi_trends": {},
    }

    if not tx_path.is_file():
        return out

    df = _read_transactions_df(tx_path).copy()
    df["LINE_AMOUNT"] = pd.to_numeric(df["LINE_AMOUNT"], errors="coerce").fillna(0.0)
    if "QTY" in df.columns:
        df["QTY"] = pd.to_numeric(df["QTY"], errors="coerce").fillna(0.0)
    if "DISCOUNT_PCT" in df.columns:
        df["DISCOUNT_PCT"] = pd.to_numeric(df["DISCOUNT_PCT"], errors="coerce").fillna(0.0)

    # Prefer top-level CATEGORY (e.g. Men / Women / Kids) when present
    cat_col = "CATEGORY" if "CATEGORY" in df.columns else ("L2_CATEGORY" if "L2_CATEGORY" in df.columns else "")

    # Aggregates / trends: last N months in 2025 (non-seasonality), matching recommendation_engine
    df_recent = _df_last_n_months_in_year(df)
    if df_recent.empty:
        df_recent = df.copy()
    dfx = df_recent

    out["meta"]["non_seasonality_window"] = (
        f"Last {_DASH_NON_SEASON_N} months in {_DASH_NON_SEASON_YEAR} (dashboard KPIs & trends)"
    )
    months_all = (
        sorted(df["YEAR_MONTH"].dropna().astype(str).unique().tolist())
        if "YEAR_MONTH" in df.columns
        else []
    )
    out["meta"]["full_data_months_span"] = len(months_all)

    total_revenue = float(dfx["LINE_AMOUNT"].sum())
    n_invoices = int(dfx["INVOICE_ID"].nunique())
    n_stores = int(dfx["STORE_ID"].nunique()) if "STORE_ID" in dfx.columns else 0
    n_skus = int(dfx["SKU_CODE"].nunique()) if "SKU_CODE" in dfx.columns else 0

    inv_totals = dfx.groupby("INVOICE_ID", observed=False)["LINE_AMOUNT"].sum()
    avg_invoice = float(inv_totals.mean()) if len(inv_totals) else 0.0

    months = (
        sorted(dfx["YEAR_MONTH"].dropna().astype(str).unique().tolist())
        if "YEAR_MONTH" in dfx.columns
        else []
    )
    n_months_distinct = len(months)
    n_months = max(n_months_distinct, 1)
    revenue_per_calendar_month = total_revenue / float(n_months)

    out["meta"]["time_period_months"] = int(n_months_distinct)
    if n_months_distinct:
        out["meta"]["time_period_label"] = (
            f"{n_months_distinct} month{'s' if n_months_distinct != 1 else ''} "
            f"({_DASH_NON_SEASON_YEAR}, non-seasonality window)"
        )
    else:
        out["meta"]["time_period_label"] = ""

    out["overview"] = {
        "total_revenue": total_revenue,
        "total_transactions": n_invoices,
        "total_customers": n_stores,
        "total_stores": n_stores,
        "total_unique_products": n_skus,
        "total_recommendations": 0,
        "average_monthly_spend": revenue_per_calendar_month,
        "average_invoice_value": avg_invoice,
        "estimated_revenue_opportunity": 0.0,
    }

    # Estimated opportunity from recommendation outputs (if available)
    if rec_path.is_file():
        try:
            rec = read_csv_cached(rec_path, usecols=["FINAL_ADJUSTED_AMT"])
            rec_amt = pd.to_numeric(rec["FINAL_ADJUSTED_AMT"], errors="coerce").fillna(0.0)
            out["overview"]["estimated_revenue_opportunity"] = float(rec_amt.sum())
            out["overview"]["total_recommendations"] = int(len(rec))
        except Exception:
            # Keep dashboard resilient if recommendation file/schema is temporarily unavailable.
            out["overview"]["estimated_revenue_opportunity"] = 0.0

    # Monthly trend (non-seasonality window)
    if "YEAR_MONTH" in dfx.columns:
        agg: dict[str, tuple[str, str]] = {
            "revenue": ("LINE_AMOUNT", "sum"),
            "orders": ("INVOICE_ID", "nunique"),
        }
        if "STORE_ID" in dfx.columns:
            agg["stores"] = ("STORE_ID", "nunique")
        if "SKU_CODE" in dfx.columns:
            agg["unique_products"] = ("SKU_CODE", "nunique")
        m = (
            dfx.groupby("YEAR_MONTH", observed=False)
            .agg(**agg)
            .reset_index()
        )
        if "stores" not in m.columns:
            m["stores"] = 0.0
        if "unique_products" not in m.columns:
            m["unique_products"] = 0.0
        m["avg_invoice_value"] = m.apply(
            lambda r: _safe_div(float(r["revenue"]), float(r["orders"])), axis=1
        )
        m["avg_monthly_spend"] = m.apply(
            lambda r: _safe_div(float(r["revenue"]), float(r["stores"])), axis=1
        )
        m["YEAR_MONTH"] = m["YEAR_MONTH"].astype(str)
        m = m.sort_values("YEAR_MONTH")
        out["monthly_trend"] = m.to_dict(orient="records")
        out["time_series"]["revenue"] = [
            {"period": r["YEAR_MONTH"], "value": float(r["revenue"])} for _, r in m.iterrows()
        ]
        out["time_series"]["orders"] = [
            {"period": r["YEAR_MONTH"], "value": float(r["orders"])} for _, r in m.iterrows()
        ]
        if len(m) >= 2:
            prev = m.iloc[-2]
            last = m.iloc[-1]

            def _trend(last_key: str) -> float | None:
                prev_v = float(prev[last_key]) if pd.notna(prev[last_key]) else 0.0
                last_v = float(last[last_key]) if pd.notna(last[last_key]) else 0.0
                if prev_v == 0:
                    return None
                return ((last_v - prev_v) / prev_v) * 100.0

            out["kpi_trends"] = {
                "total_revenue": _trend("revenue"),
                "total_transactions": _trend("orders"),
                "total_customers": _trend("stores"),
                "total_unique_products": _trend("unique_products"),
                "average_monthly_spend": _trend("avg_monthly_spend"),
                "average_invoice_value": _trend("avg_invoice_value"),
                # No true monthly comparator in recommendations_final.csv today.
                "estimated_revenue_opportunity": None,
            }

    # Line-level amount histogram
    bins = [0, 50, 100, 250, 500, 1000, 2500, 5000, 1e12]
    labels = [
        "0–50",
        "50–100",
        "100–250",
        "250–500",
        "500–1k",
        "1k–2.5k",
        "2.5k–5k",
        ">5k",
    ]
    cuts = pd.cut(dfx["LINE_AMOUNT"], bins=bins, labels=labels, include_lowest=True)
    lc = cuts.astype(str).value_counts().reindex(labels, fill_value=0)
    out["line_amount_histogram"] = [
        {"bin": lab, "count": int(lc[lab])} for lab in labels if lab in lc.index
    ]

    # Invoice total distribution
    inv_bins = [0, 500, 1000, 2500, 5000, 10000, 1e12]
    inv_labels = ["0–500", "500–1k", "1k–2.5k", "2.5k–5k", "5k–10k", ">10k"]
    inv_cut = pd.cut(inv_totals, bins=inv_bins, labels=inv_labels, include_lowest=True)
    vc = inv_cut.astype(str).value_counts().reindex(inv_labels, fill_value=0)
    out["invoice_total_histogram"] = [{"bin": lab, "count": int(vc[lab])} for lab in inv_labels]

    # Invoice frequency per store-month (how many distinct invoices in that month)
    if "YEAR_MONTH" in dfx.columns and "STORE_ID" in dfx.columns:
        fm = dfx.groupby(["STORE_ID", "YEAR_MONTH"], observed=False)["INVOICE_ID"].nunique()
        vc = fm.value_counts().sort_index()
        out["invoice_frequency_histogram"] = [
            {"bin": str(int(k)) if float(k).is_integer() else str(k), "count": int(v)}
            for k, v in vc.head(24).items()
        ]

    # Featured engineering aggregates
    if feat_path.is_file():
        fd = _read_featured_subset(feat_path).copy()
        want = [
            "NET_AMT_AVG_MONTHLY",
            "AVG_INVOICE_PURCHASE",
            "UNIQUE_PRD_COUNT",
            "INV_COUNT_AVG_MONTHLY",
            "AVG_NO_DAYS_BETWEEN_PURCHASE",
            "UNIQUE_PRD_COUNT_PER_INV",
        ]
        display_labels: dict[str, str] = {
            "NET_AMT_AVG_MONTHLY": "Average monthly net spend",
            "AVG_INVOICE_PURCHASE": "Average amount per invoice",
            "UNIQUE_PRD_COUNT": "Number of distinct products",
            "INV_COUNT_AVG_MONTHLY": "Average invoices per month",
            "AVG_NO_DAYS_BETWEEN_PURCHASE": "Average days between purchases",
            "UNIQUE_PRD_COUNT_PER_INV": "Distinct products per invoice",
        }
        fi: dict[str, Any] = {}
        net_key = None
        for c in want:
            if c not in fd.columns:
                continue
            s = pd.to_numeric(fd[c], errors="coerce")
            label = display_labels.get(c, c)
            fi[label] = {
                "mean": float(s.mean()),
                "median": float(s.median()),
                "std": float(s.std()) if len(s.dropna()) > 1 else 0.0,
                "min": float(s.min()),
                "max": float(s.max()),
            }
            if c == "NET_AMT_AVG_MONTHLY":
                net_key = label
        out["feature_insights"] = fi
        if net_key and net_key in fi:
            out["overview"]["average_monthly_spend"] = fi[net_key]["mean"]

    # Category intelligence (non-seasonality window)
    if cat_col and cat_col in dfx.columns and "YEAR_MONTH" in dfx.columns:
        dfx = dfx.copy()
        dfx["_YM"] = dfx["YEAR_MONTH"].astype(str)
        monthly_cat = (
            dfx.groupby(["_YM", cat_col], observed=False)["LINE_AMOUNT"].sum().reset_index()
        )
        monthly_cat.rename(columns={"_YM": "YEAR_MONTH"}, inplace=True)
        totals = dfx.groupby(cat_col, observed=False)["LINE_AMOUNT"].sum().sort_values(ascending=False)
        top_cats = totals.head(10).index.tolist()

        months_sorted = sorted(dfx["_YM"].unique())
        rows_intel: list[dict[str, Any]] = []
        pivot = monthly_cat[monthly_cat[cat_col].isin(top_cats)].pivot_table(
            index=cat_col,
            columns="YEAR_MONTH",
            values="LINE_AMOUNT",
            aggfunc="sum",
            fill_value=0.0,
        )
        for cname in top_cats:
            if cname not in pivot.index:
                continue
            ser = pivot.loc[cname].astype(float)
            first_m = months_sorted[0] if months_sorted else None
            last_m = months_sorted[-1] if months_sorted else None
            g_pct = 0.0
            if first_m and last_m and first_m in ser.index and last_m in ser.index:
                g_pct = _safe_div(float(ser[last_m] - ser[first_m]), float(ser[first_m]) or 1.0) * 100.0
            peak_m = str(ser.idxmax()) if len(ser) else ""
            disc_mean = (
                float(dfx.loc[dfx[cat_col] == cname, "DISCOUNT_PCT"].mean())
                if "DISCOUNT_PCT" in dfx.columns
                else 0.0
            )
            # Proxy: higher average discount → more promotional sensitivity
            if disc_mean >= 15:
                sens = "High"
            elif disc_mean >= 8:
                sens = "Medium"
            else:
                sens = "Low"
            elast = min(1.0, max(0.0, disc_mean / 40.0))
            rows_intel.append(
                {
                    "category": str(cname),
                    "total_revenue": float(totals.get(cname, 0.0)),
                    "growth_pct_first_to_last_month": float(g_pct),
                    "peak_month": peak_m,
                    "avg_discount_pct": float(disc_mean),
                    "elasticity_proxy": float(elast),
                    "sensitivity_label": sens,
                }
            )
        out["category_intelligence"] = sorted(
            rows_intel, key=lambda x: x["total_revenue"], reverse=True
        )

        # Heatmap: up to 36 months of full history (seasonality exploration)
        top8 = top_cats[:8]
        hm_months_sorted = sorted(df["YEAR_MONTH"].astype(str).unique()) if "YEAR_MONTH" in df.columns else []
        heat_months = (
            hm_months_sorted[-_SEASONALITY_HEATMAP_MAX_MONTHS:]
            if len(hm_months_sorted) > _SEASONALITY_HEATMAP_MAX_MONTHS
            else hm_months_sorted
        )
        out["meta"]["seasonality_heatmap_months"] = len(heat_months)
        monthly_cat_hm = (
            df.groupby(["YEAR_MONTH", cat_col], observed=False)["LINE_AMOUNT"]
            .sum()
            .reset_index()
        )
        mat: list[list[float]] = []
        for cname in top8:
            row = []
            for mo in heat_months:
                sub = monthly_cat_hm[
                    (monthly_cat_hm[cat_col] == cname)
                    & (monthly_cat_hm["YEAR_MONTH"].astype(str) == str(mo))
                ]
                row.append(float(sub["LINE_AMOUNT"].sum()) if len(sub) else 0.0)
            mat.append(row)
        out["seasonality_heatmap"] = {
            "categories": [str(x) for x in top8],
            "months": [str(x) for x in heat_months],
            "matrix": mat,
        }

        # Category share (pie)
        share = totals.head(12)
        out["category_contribution"] = [
            {"name": str(i), "value": float(v)} for i, v in share.items()
        ]

    return out


def compute_dashboard_analytics(engine: Path) -> dict[str, Any]:
    """Return dashboard JSON; cached until source CSV mtimes change."""
    global _dash_cache, _dash_cache_sig
    sig = _dashboard_cache_signature(engine)
    if _dash_cache is not None and _dash_cache_sig == sig:
        return _dash_cache
    out = _compute_dashboard_analytics_uncached(engine)
    _dash_cache = out
    _dash_cache_sig = sig
    return out
