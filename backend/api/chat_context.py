"""Chat-assistant context builder.

Detects entities (stores, SKUs, clusters, categories) in a user's message
and pulls focused, per-entity records from the pipeline outputs so
/ai/chat can answer targeted questions instead of only network-wide
aggregates.

Design goals:
- Cheap: pure pandas lookups on already-cached DataFrames (no extra Gemini
  calls, no vector DB).
- Deterministic: regex-based entity detection with a known-category
  dictionary; predictable results.
- Safe: bounded results per entity, capped totals per request so the
  serialized context stays within Gemini's practical prompt window.
"""

from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any

from api.analytics import (
    compute_cluster_breakdown,
    compute_cluster_profile,
    compute_store_spend_history,
)
from api.csv_cache import read_csv_cached

# ---------------------------------------------------------------------------
# Entity detection
# ---------------------------------------------------------------------------

# Store IDs look like S01001, S00100 etc.
_STORE_ID_RE = re.compile(r"\bS\d{4,}\b", re.IGNORECASE)

# SKU codes look like MEN-OUT-JAC-002 (three 2-4 letter groups, then digits).
_SKU_CODE_RE = re.compile(r"\b[A-Z]{2,4}-[A-Z]{2,4}-[A-Z]{2,4}-\d{2,4}\b")

# "cluster 2", "cluster-2", "cluster #2"
_CLUSTER_WORD_RE = re.compile(r"\bcluster\s*[-#]?\s*(\d+)\b", re.IGNORECASE)

# "C0", "C1", "C2", "C3" — standalone short form
_C_PREFIX_RE = re.compile(r"\bC(\d+)\b")

# Caps to keep the context blob bounded.
_MAX_STORES = 5
_MAX_SKUS = 5
_MAX_CLUSTERS = 4
_MAX_CATEGORIES = 3
_TOP_SKUS_PER_STORE = 10
_TOP_STORES_PER_SKU = 10
_TOP_SKUS_PER_CLUSTER = 10
_TOP_SKUS_PER_CATEGORY = 10

# Cache of distinct CATEGORY strings (populated lazily).
_categories_cache: list[str] | None = None
_cache_lock = threading.Lock()


def _final_path(engine: Path) -> Path:
    return engine / "outputs" / "recommendations_final.csv"


def _known_categories(engine: Path) -> list[str]:
    """Distinct CATEGORY values from recommendations_final.csv (cached)."""
    global _categories_cache
    with _cache_lock:
        if _categories_cache is not None:
            return _categories_cache

    path = _final_path(engine)
    if not path.is_file():
        with _cache_lock:
            _categories_cache = []
            return _categories_cache
    try:
        df = read_csv_cached(path, usecols=["CATEGORY"])
    except Exception:
        with _cache_lock:
            _categories_cache = []
            return _categories_cache

    cats = sorted({str(c).strip() for c in df["CATEGORY"].dropna().unique() if str(c).strip()})
    with _cache_lock:
        _categories_cache = cats
        return _categories_cache


def _match_categories(text: str, known: list[str]) -> list[str]:
    """Case-insensitive: match a known category if either the full string
    or its first word (e.g. 'Kids' from "Kids' Apparel") appears as a word
    in the user text."""
    if not known:
        return []
    lower = text.lower()
    hits: list[str] = []
    seen: set[str] = set()
    for cat in known:
        low = cat.lower()
        if low in seen:
            continue
        first_word = re.sub(r"[^a-z0-9]", "", low.split()[0]) if low else ""
        matched = low in lower or (
            first_word
            and re.search(rf"\b{re.escape(first_word)}\b", lower) is not None
        )
        if matched:
            hits.append(cat)
            seen.add(low)
    return hits


def extract_entities(text: str, engine: Path) -> dict[str, list[Any]]:
    """Return {'stores': [...], 'skus': [...], 'clusters': [...], 'categories': [...]}.

    All lists are deduplicated, sorted, and capped."""
    if not text:
        return {"stores": [], "skus": [], "clusters": [], "categories": []}

    stores = sorted({m.upper() for m in _STORE_ID_RE.findall(text)})
    skus = sorted({m.upper() for m in _SKU_CODE_RE.findall(text.upper())})

    clusters_set: set[int] = set()
    for m in _CLUSTER_WORD_RE.findall(text):
        try:
            clusters_set.add(int(m))
        except ValueError:
            pass
    for m in _C_PREFIX_RE.findall(text):
        try:
            clusters_set.add(int(m))
        except ValueError:
            pass
    clusters = sorted(clusters_set)

    categories = _match_categories(text, _known_categories(engine))

    return {
        "stores": stores[:_MAX_STORES],
        "skus": skus[:_MAX_SKUS],
        "clusters": clusters[:_MAX_CLUSTERS],
        "categories": categories[:_MAX_CATEGORIES],
    }


# ---------------------------------------------------------------------------
# Per-entity lookups
# ---------------------------------------------------------------------------


def get_store_details(engine: Path, store_id: str) -> dict[str, Any] | None:
    path = _final_path(engine)
    if not path.is_file():
        return None
    df = read_csv_cached(path)
    if "STORE_ID" not in df.columns:
        return None
    sub = df.loc[df["STORE_ID"].astype(str) == str(store_id)]
    if sub.empty:
        return {"store_id": store_id, "found": False}

    if "RANK" in sub.columns:
        sub = sub.sort_values("RANK")
    cluster_id = int(sub["CLUSTER_ID"].iloc[0]) if "CLUSTER_ID" in sub.columns else None

    cols = [
        c
        for c in [
            "SKU_CODE",
            "PRODUCT_NAME",
            "CATEGORY",
            "SOURCE",
            "RANK",
            "CONFIDENCE",
            "FINAL_ADJUSTED_AMT",
            "VOLUME",
        ]
        if c in sub.columns
    ]
    top_recs = sub.head(_TOP_SKUS_PER_STORE)[cols].to_dict(orient="records")

    category_counts: dict[str, int] = {}
    if "CATEGORY" in sub.columns:
        vc = sub["CATEGORY"].astype(str).value_counts().head(6)
        category_counts = {str(k): int(v) for k, v in vc.items()}

    total_est_amt = (
        float(sub["FINAL_ADJUSTED_AMT"].astype(float).sum())
        if "FINAL_ADJUSTED_AMT" in sub.columns
        else None
    )

    try:
        spend_history = compute_store_spend_history(engine, store_id)
    except Exception:
        spend_history = {"available": False, "store_id": store_id, "series": []}

    return {
        "store_id": store_id,
        "found": True,
        "cluster_id": cluster_id,
        "num_recommendations": int(len(sub)),
        "total_estimated_amount": total_est_amt,
        "category_counts": category_counts,
        "top_recommendations": top_recs,
        "spend_history": spend_history,
    }


def get_sku_details(engine: Path, sku_code: str) -> dict[str, Any] | None:
    path = _final_path(engine)
    if not path.is_file():
        return None
    df = read_csv_cached(path)
    if "SKU_CODE" not in df.columns:
        return None
    sub = df.loc[df["SKU_CODE"].astype(str).str.upper() == str(sku_code).upper()]
    if sub.empty:
        return {"sku_code": sku_code, "found": False}

    product_name = str(sub["PRODUCT_NAME"].iloc[0]) if "PRODUCT_NAME" in sub.columns else None
    category = str(sub["CATEGORY"].iloc[0]) if "CATEGORY" in sub.columns else None

    per_cluster: dict[str, int] = {}
    if "CLUSTER_ID" in sub.columns:
        vc = sub["CLUSTER_ID"].astype(str).value_counts().head(10)
        per_cluster = {str(k): int(v) for k, v in vc.items()}

    if "CONFIDENCE" in sub.columns:
        top = sub.sort_values("CONFIDENCE", ascending=False).head(_TOP_STORES_PER_SKU)
    else:
        top = sub.head(_TOP_STORES_PER_SKU)
    keep = [
        c
        for c in ["STORE_ID", "CLUSTER_ID", "CONFIDENCE", "FINAL_ADJUSTED_AMT", "RANK"]
        if c in top.columns
    ]
    top_stores = top[keep].to_dict(orient="records")

    return {
        "sku_code": sku_code,
        "found": True,
        "product_name": product_name,
        "category": category,
        "num_recommendations": int(len(sub)),
        "recommendations_per_cluster": per_cluster,
        "top_stores": top_stores,
    }


def get_cluster_details(engine: Path, cluster_id: int) -> dict[str, Any]:
    breakdown = compute_cluster_breakdown(engine)
    row = next(
        (c for c in breakdown.get("clusters", []) if int(c["cluster_id"]) == int(cluster_id)),
        None,
    )
    if not row:
        return {"cluster_id": cluster_id, "found": False}

    profile = compute_cluster_profile(engine)
    profile_row = None
    for pr in profile.get("rows", []):
        if int(pr["cluster_id"]) == int(cluster_id):
            profile_row = pr
            break

    top_skus: list[dict[str, Any]] = []
    path = _final_path(engine)
    if path.is_file():
        df = read_csv_cached(path)
        if "CLUSTER_ID" in df.columns:
            sub = df.loc[df["CLUSTER_ID"].astype(str) == str(cluster_id)]
            if not sub.empty and "SKU_CODE" in sub.columns:
                grp_cols = ["SKU_CODE"]
                if "PRODUCT_NAME" in sub.columns:
                    grp_cols.append("PRODUCT_NAME")
                if "CATEGORY" in sub.columns:
                    grp_cols.append("CATEGORY")
                vc = (
                    sub.groupby(grp_cols, observed=False)
                    .size()
                    .reset_index(name="count")
                    .sort_values("count", ascending=False)
                    .head(_TOP_SKUS_PER_CLUSTER)
                )
                top_skus = vc.to_dict(orient="records")

    return {
        "cluster_id": cluster_id,
        "found": True,
        "store_count": row.get("store_count"),
        "top_category": row.get("top_category"),
        "cluster_persona": row.get("cluster_persona"),
        "profile_metrics": profile_row.get("values") if profile_row else None,
        "top_recommended_skus": top_skus,
    }


def list_stores_in_cluster(
    engine: Path,
    cluster_id: int,
    limit: int = 25,
) -> dict[str, Any]:
    """Return the store IDs belonging to a cluster, along with the total count."""
    clustered = engine / "outputs" / "clustered_data.csv"
    if not clustered.is_file():
        return {"cluster_id": cluster_id, "found": False, "store_ids": [], "total": 0}
    df = read_csv_cached(clustered)
    if "CLUSTER_ID" not in df.columns or "STORE_ID" not in df.columns:
        return {"cluster_id": cluster_id, "found": False, "store_ids": [], "total": 0}
    sub = df.loc[df["CLUSTER_ID"].astype(str) == str(cluster_id), "STORE_ID"]
    if sub.empty:
        return {"cluster_id": cluster_id, "found": False, "store_ids": [], "total": 0}
    ids = sorted({str(s) for s in sub})
    return {
        "cluster_id": int(cluster_id),
        "found": True,
        "total": len(ids),
        "store_ids": ids[: max(1, int(limit))],
    }


def top_skus_by_category(
    engine: Path,
    category: str,
    top_n: int = _TOP_SKUS_PER_CATEGORY,
) -> dict[str, Any]:
    path = _final_path(engine)
    if not path.is_file():
        return {"category": category, "found": False, "top_skus": []}
    df = read_csv_cached(path)
    if "CATEGORY" not in df.columns:
        return {"category": category, "found": False, "top_skus": []}

    sub = df.loc[df["CATEGORY"].astype(str).str.lower() == category.lower()]
    if sub.empty:
        return {"category": category, "found": False, "top_skus": []}

    grp_cols = ["SKU_CODE"]
    if "PRODUCT_NAME" in sub.columns:
        grp_cols.append("PRODUCT_NAME")
    vc = (
        sub.groupby(grp_cols, observed=False)
        .size()
        .reset_index(name="count")
        .sort_values("count", ascending=False)
        .head(top_n)
    )
    per_cluster: dict[str, int] = {}
    if "CLUSTER_ID" in sub.columns:
        pc = sub["CLUSTER_ID"].astype(str).value_counts().head(10)
        per_cluster = {str(k): int(v) for k, v in pc.items()}

    return {
        "category": category,
        "found": True,
        "num_recommendations": int(len(sub)),
        "recommendations_per_cluster": per_cluster,
        "top_skus": vc.to_dict(orient="records"),
    }


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------


def build_focused_context(engine: Path, user_text: str) -> dict[str, Any]:
    """Detect entities in `user_text` and gather focused records for each."""
    entities = extract_entities(user_text, engine)
    focused: dict[str, Any] = {}

    if entities["stores"]:
        recs = [get_store_details(engine, s) for s in entities["stores"]]
        focused["stores"] = [r for r in recs if r]

    if entities["skus"]:
        recs = [get_sku_details(engine, s) for s in entities["skus"]]
        focused["skus"] = [r for r in recs if r]

    if entities["clusters"]:
        focused["clusters"] = [get_cluster_details(engine, c) for c in entities["clusters"]]

    if entities["categories"]:
        focused["by_category"] = [top_skus_by_category(engine, c) for c in entities["categories"]]

    return {"entities_detected": entities, "focused": focused}
