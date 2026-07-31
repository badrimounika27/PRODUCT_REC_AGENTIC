"""Gemini function-calling tools for the retail chat assistant.

Each tool is a small, pure Python function bound to the engine root at
construction time. Gemini's `enable_automatic_function_calling=True`
reads the annotations + docstring to build the tool schema and invokes
these functions directly when needed.

Docstring style follows Google's function-calling guidance: the first
line is a crisp description of *what* the function does; the Args block
describes each parameter concretely so Gemini populates them accurately.

Tool families
-------------
- B2B (store / cluster / SKU): first 5 tools. Backed by the store-level
  ML pipeline (recommendations_final.csv, clustered_data.csv, ...).
- B2C (customer / segment / funnel / bundle): remaining tools. Backed by
  the b2c_* pipeline outputs under outputs/b2c/.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from api import chat_context


# ---------------------------------------------------------------------------
# Tool factory
# ---------------------------------------------------------------------------


def _safe(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Wrap a tool so unexpected exceptions surface as structured errors
    Gemini can read and recover from, rather than crashing the request."""

    def wrapper(*args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            result = fn(*args, **kwargs)
            return result if result is not None else {"found": False}
        except Exception as e:  # noqa: BLE001 — surface any lookup failure to the model
            return {"error": f"{type(e).__name__}: {e}"}

    wrapper.__name__ = fn.__name__
    wrapper.__doc__ = fn.__doc__
    wrapper.__annotations__ = getattr(fn, "__annotations__", {})
    return wrapper


def make_chat_tools(engine: Path) -> list[Callable[..., Any]]:
    """Return the list of tool functions Gemini can call, bound to `engine`."""

    def get_store_recommendations(store_id: str) -> dict:
        """Look up a single store's cluster, top recommended SKUs, category
        mix and recent monthly spend.

        Use this whenever the user mentions a specific store ID (e.g. S01001,
        S12277). If the store isn't in the pipeline outputs, the result has
        `"found": false` — do NOT invent a fallback answer, tell the user.

        Args:
            store_id: The store identifier, formatted like "S01001". Case
                is ignored.

        Returns:
            A dict with keys: found, store_id, cluster_id, num_recommendations,
            total_estimated_amount, category_counts, top_recommendations
            (list of {sku_code, product_name, category, confidence,
            final_adjusted_amt, ...}), and spend_history.
        """
        return chat_context.get_store_details(engine, str(store_id)) or {"found": False}

    def get_sku_placement(sku_code: str) -> dict:
        """Look up where a specific SKU is recommended across the network:
        which stores get it most, how it distributes across clusters, and
        its product name/category.

        Use this whenever the user asks about a specific SKU code (format
        like "MEN-OUT-JAC-002" or "KID-GIT-BLO-001").

        Args:
            sku_code: The SKU code exactly as it appears (letters + digits
                separated by dashes). Case is ignored.

        Returns:
            A dict with keys: found, sku_code, product_name, category,
            num_recommendations, recommendations_per_cluster,
            top_stores (list of {store_id, cluster_id, confidence,
            final_adjusted_amt, rank}).
        """
        return chat_context.get_sku_details(engine, str(sku_code)) or {"found": False}

    def get_cluster_profile(cluster_id: int) -> dict:
        """Return one cluster's profile: store count, top category, persona,
        per-cluster metrics (spend, invoice size, purchase cadence, category
        mix, price tier), and the top recommended SKUs within that cluster.

        Use this when the user asks about a cluster by number (e.g. "cluster
        2", "C0", "the smallest cluster"). Valid cluster ids are typically
        0-3 for this dataset.

        Args:
            cluster_id: The integer cluster id (0, 1, 2 or 3 for this pipeline).

        Returns:
            A dict with keys: found, cluster_id, store_count, top_category,
            cluster_persona, profile_metrics, top_recommended_skus.
        """
        return chat_context.get_cluster_details(engine, int(cluster_id))

    def top_skus_by_category(category: str, top_n: int = 10) -> dict:
        """List the most-recommended SKUs within a product category, plus
        how those recommendations distribute across clusters.

        Use this when the user asks about a category (e.g. "Kids",
        "Men", "Women", or full names like "Kids' Apparel"). Categories
        are matched case-insensitively.

        Args:
            category: The category name to filter by. Free-form.
            top_n: Maximum SKUs to return (default 10, capped internally).

        Returns:
            A dict with keys: found, category, num_recommendations,
            recommendations_per_cluster, top_skus (list of
            {sku_code, product_name, count}).
        """
        return chat_context.top_skus_by_category(engine, str(category), int(top_n))

    def list_stores_in_cluster(cluster_id: int, limit: int = 25) -> dict:
        """List store IDs that belong to a given cluster plus the total
        count in that cluster.

        Use this when the user asks "which stores are in cluster N", or
        needs a sample of stores from a segment.

        Args:
            cluster_id: The integer cluster id.
            limit: Max number of store IDs to return (default 25).

        Returns:
            A dict with keys: found, cluster_id, total, store_ids.
        """
        return chat_context.list_stores_in_cluster(engine, int(cluster_id), int(limit))

    # ------------------------------------------------------------------
    # B2C tools — customer behavior (Flavor A)
    # ------------------------------------------------------------------
    # Small helper to load B2C CSVs with mtime-aware caching so a fresh
    # `run_b2c_pipeline.py` shows up without a server restart.
    b2c_dir = engine / "outputs" / "b2c"

    @lru_cache(maxsize=16)
    def _load_b2c_cached(path_str: str, mtime_ns: int) -> pd.DataFrame:
        return pd.read_csv(path_str, low_memory=False)

    def _load_b2c(name: str) -> pd.DataFrame | None:
        p = b2c_dir / name
        if not p.is_file():
            return None
        return _load_b2c_cached(str(p), p.stat().st_mtime_ns).copy()

    def get_customer_profile(user_id: int) -> dict:
        """Look up a B2C customer's 360 profile: their segment (persona),
        behavior counts, funnel rates, and top recommendations.

        Use this whenever the user mentions a customer or user ID
        (e.g. "customer 12345", "user 88123") in the B2C context.

        Args:
            user_id: The integer customer identifier from UserBehavior data.

        Returns:
            A dict with keys: found, user_id, cluster_id, cluster_persona,
            features (pv_count, cart_count, buy_count, recency_days, ...),
            top_recommendations (list of {rank, item_id, score, reason}).
        """
        clusters = _load_b2c("customer_clusters.csv")
        if clusters is None:
            return {"found": False, "error": "customer_clusters.csv not found"}
        row = clusters[clusters["user_id"] == int(user_id)]
        if row.empty:
            return {"found": False, "user_id": int(user_id)}
        r = row.iloc[0]
        features = {
            col: (int(r[col]) if pd.api.types.is_integer_dtype(clusters[col])
                  else float(r[col]) if pd.api.types.is_float_dtype(clusters[col])
                  else str(r[col]))
            for col in clusters.columns
            if col not in ("user_id", "cluster_id", "cluster_persona")
        }
        recs: list[dict] = []
        nbo = _load_b2c("next_best_offers.csv")
        if nbo is not None:
            user_recs = nbo[nbo["user_id"] == int(user_id)].sort_values("rank").head(10)
            recs = [
                {"rank": int(rr["rank"]), "item_id": int(rr["item_id"]),
                 "score": float(rr["score"]), "reason": str(rr["reason"])}
                for _, rr in user_recs.iterrows()
            ]
        return {
            "found": True,
            "user_id": int(user_id),
            "cluster_id": int(r["cluster_id"]),
            "cluster_persona": str(r["cluster_persona"]),
            "features": features,
            "top_recommendations": recs,
        }

    def list_segments() -> dict:
        """List all B2C customer segments with their sizes and personas.

        Use this when the user asks "what customer segments do we have",
        "how many segments", "list personas", or "segment breakdown".

        Returns:
            A dict with keys: found, total_users, segments
            (list of {cluster_id, cluster_persona, user_count, share}).
        """
        clusters = _load_b2c("customer_clusters.csv")
        if clusters is None:
            return {"found": False, "error": "customer_clusters.csv not found"}
        total = int(len(clusters))
        agg = (
            clusters.groupby(["cluster_id", "cluster_persona"], observed=True)
                    .size().reset_index(name="user_count")
                    .sort_values("user_count", ascending=False)
        )
        segments = [
            {"cluster_id": int(r["cluster_id"]),
             "cluster_persona": str(r["cluster_persona"]),
             "user_count": int(r["user_count"]),
             "share": round(r["user_count"] / max(total, 1), 4)}
            for _, r in agg.iterrows()
        ]
        return {"found": True, "total_users": total, "segments": segments}

    def get_segment_profile(cluster_id: int) -> dict:
        """Return one B2C customer segment's profile: size, persona label,
        average behavioral features, and top items popular in the segment.

        Use this when the user asks about a specific customer segment
        (e.g. "tell me about segment 2", "who are the frequent buyers").

        Args:
            cluster_id: The integer segment / cluster id (typically 0-4).

        Returns:
            A dict with keys: found, cluster_id, cluster_persona,
            user_count, share, profile (avg feature values), top_items.
        """
        clusters = _load_b2c("customer_clusters.csv")
        if clusters is None:
            return {"found": False, "error": "customer_clusters.csv not found"}
        seg = clusters[clusters["cluster_id"] == int(cluster_id)]
        if seg.empty:
            return {"found": False, "cluster_id": int(cluster_id)}
        persona = str(seg["cluster_persona"].iloc[0])
        profile_cols = [
            "pv_count", "cart_count", "fav_count", "buy_count",
            "total_events", "distinct_items", "distinct_categories",
            "active_days", "recency_days",
            "pv_to_buy_rate", "cart_to_buy_rate", "buy_share",
        ]
        profile = {c: round(float(seg[c].mean()), 4)
                   for c in profile_cols if c in seg.columns}
        top_items: list[dict] = []
        nbo = _load_b2c("next_best_offers.csv")
        if nbo is not None:
            slice_ = nbo[nbo["cluster_id"] == int(cluster_id)]
            grouped = (
                slice_.groupby("item_id")
                      .agg(users=("user_id", "nunique"),
                           avg_score=("score", "mean"))
                      .reset_index()
                      .sort_values(["users", "avg_score"], ascending=False)
                      .head(10)
            )
            top_items = [
                {"item_id": int(rr["item_id"]),
                 "users": int(rr["users"]),
                 "avg_score": round(float(rr["avg_score"]), 4)}
                for _, rr in grouped.iterrows()
            ]
        return {
            "found": True,
            "cluster_id": int(cluster_id),
            "cluster_persona": persona,
            "user_count": int(len(seg)),
            "share": round(len(seg) / max(len(clusters), 1), 4),
            "profile": profile,
            "top_items": top_items,
        }

    def get_funnel_summary() -> dict:
        """Return the B2C event funnel: total page-views, cart-adds,
        favorites, buys, and conversion rates (pv->buy, cart->buy).

        Use this when the user asks about "the funnel", "conversion rate",
        "how many buys / views", or overall B2C traffic.

        Returns:
            A dict with keys: found, overall (pv/cart/fav/buy counts +
            rates + unique users/items/categories + date range),
            by_date (list of daily funnel snapshots).
        """
        summary = _load_b2c("funnel_summary.csv")
        if summary is None or summary.empty:
            return {"found": False, "error": "funnel_summary.csv missing/empty"}
        row = summary.iloc[0]
        overall = {}
        for k in row.index:
            v = row[k]
            if pd.isna(v):
                overall[k] = None
            elif isinstance(v, (int,)):
                overall[k] = int(v)
            elif isinstance(v, float):
                overall[k] = float(v)
            else:
                overall[k] = str(v)
        by_date = []
        bd = _load_b2c("funnel_by_date.csv")
        if bd is not None:
            by_date = bd.to_dict(orient="records")
        return {"found": True, "overall": overall, "by_date": by_date}

    def top_bundles(limit: int = 10) -> dict:
        """List the top 'frequently bought together' item pairs by lift.

        Use this when the user asks about "bundles", "bought together",
        "co-purchase", "cross-sell pairs", or "which items go together".

        Args:
            limit: Maximum number of pairs to return (default 10).

        Returns:
            A dict with keys: found, total, bundles
            (list of {item_a, item_b, pair_count, support, confidence, lift}).
        """
        df = _load_b2c("bundles.csv")
        if df is None:
            return {"found": False, "error": "bundles.csv not found"}
        df = df.sort_values(["lift", "pair_count"], ascending=[False, False]).head(int(limit))
        bundles = [
            {"item_a": int(r["item_a"]),
             "item_b": int(r["item_b"]),
             "pair_count": int(r["pair_count"]),
             "support": float(r["support"]),
             "confidence": float(r["confidence"]),
             "lift": float(r["lift"])}
            for _, r in df.iterrows()
        ]
        return {"found": True, "total": len(bundles), "bundles": bundles}

    return [
        # B2B — store / cluster / SKU
        _safe(get_store_recommendations),
        _safe(get_sku_placement),
        _safe(get_cluster_profile),
        _safe(top_skus_by_category),
        _safe(list_stores_in_cluster),
        # B2C — customer / segment / funnel / bundle
        _safe(get_customer_profile),
        _safe(list_segments),
        _safe(get_segment_profile),
        _safe(get_funnel_summary),
        _safe(top_bundles),
    ]
