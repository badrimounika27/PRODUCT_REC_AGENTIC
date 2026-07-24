"""Gemini function-calling tools for the retail chat assistant.

Each tool is a small, pure Python function bound to the engine root at
construction time. Gemini's `enable_automatic_function_calling=True`
reads the annotations + docstring to build the tool schema and invokes
these functions directly when needed.

Docstring style follows Google's function-calling guidance: the first
line is a crisp description of *what* the function does; the Args block
describes each parameter concretely so Gemini populates them accurately.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

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

    return [
        _safe(get_store_recommendations),
        _safe(get_sku_placement),
        _safe(get_cluster_profile),
        _safe(top_skus_by_category),
        _safe(list_stores_in_cluster),
    ]
