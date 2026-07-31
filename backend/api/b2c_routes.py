"""
B2C REST endpoints for the planner dashboard.

Mounted under `/api/b2c/*` in api/main.py.

All artifacts are re-read fresh on every call so a fresh `run_b2c_pipeline.py`
shows up in the UI without a server restart.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

import config as recai_config

router = APIRouter(prefix="/api/b2c", tags=["b2c"])


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------


def _b2c_dir() -> Path:
    p = recai_config.b2c_outputs_dir()
    if not p.is_dir():
        raise HTTPException(
            status_code=503,
            detail=(f"B2C outputs directory not found: {p}. "
                    f"Run scripts/run_b2c_pipeline.py first."),
        )
    return p


def _require_csv(name: str) -> Path:
    p = _b2c_dir() / name
    if not p.is_file():
        raise HTTPException(
            status_code=503,
            detail=(f"B2C artifact missing: outputs/b2c/{name}. "
                    f"Run scripts/run_b2c_pipeline.py to produce it."),
        )
    return p


# ---------------------------------------------------------------------------
# Cached loaders keyed by (path, mtime) so file changes invalidate the cache.
# ---------------------------------------------------------------------------


@lru_cache(maxsize=32)
def _load_csv_cached(path_str: str, mtime_ns: int) -> pd.DataFrame:
    return pd.read_csv(path_str, low_memory=False)


def _load(name: str) -> pd.DataFrame:
    p = _require_csv(name)
    return _load_csv_cached(str(p), p.stat().st_mtime_ns).copy()


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class B2CSummaryResponse(BaseModel):
    users: int
    buyers: int
    buyer_rate: float
    total_events: int
    pv_count: int
    cart_count: int
    fav_count: int
    buy_count: int
    pv_to_buy_rate: float
    cart_to_buy_rate: float
    unique_items: int
    unique_categories: int
    date_min: Optional[str] = None
    date_max: Optional[str] = None
    segments: list[dict[str, Any]] = Field(default_factory=list)


class CustomerListItem(BaseModel):
    user_id: int
    cluster_id: int
    cluster_persona: str
    total_events: int
    buy_count: int
    pv_count: int
    recency_days: float
    top_category: int


class CustomerListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    customers: list[CustomerListItem]


class CustomerDetailResponse(BaseModel):
    found: bool
    user_id: int
    cluster_id: Optional[int] = None
    cluster_persona: Optional[str] = None
    features: dict[str, Any] = Field(default_factory=dict)
    top_recommendations: list[dict[str, Any]] = Field(default_factory=list)


class SegmentSummary(BaseModel):
    cluster_id: int
    cluster_persona: str
    user_count: int
    share: float
    avg_buy_count: float
    avg_pv_count: float
    avg_recency_days: float
    avg_buy_share: float


class SegmentListResponse(BaseModel):
    segments: list[SegmentSummary]


class SegmentDetailResponse(BaseModel):
    found: bool
    cluster_id: int
    cluster_persona: Optional[str] = None
    user_count: int
    share: float
    profile: dict[str, Any] = Field(default_factory=dict)
    top_items: list[dict[str, Any]] = Field(default_factory=list)
    sample_users: list[int] = Field(default_factory=list)


class FunnelResponse(BaseModel):
    overall: dict[str, Any]
    by_date: list[dict[str, Any]]
    top_categories: list[dict[str, Any]]


class BundleItem(BaseModel):
    item_a: int
    item_b: int
    pair_count: int
    support: float
    confidence: float
    lift: float


class BundleListResponse(BaseModel):
    total: int
    bundles: list[BundleItem]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/summary", response_model=B2CSummaryResponse)
def get_summary() -> B2CSummaryResponse:
    """One-shot dashboard payload: totals, funnel, and segment sizes."""
    feats = _load("customer_features.csv")
    clusters = _load("customer_clusters.csv")
    funnel_summary = _load("funnel_summary.csv")

    if funnel_summary.empty:
        raise HTTPException(status_code=500, detail="funnel_summary.csv is empty")
    row = funnel_summary.iloc[0]

    seg = (
        clusters.groupby(["cluster_id", "cluster_persona"], observed=True)
                .size().reset_index(name="user_count")
                .sort_values("user_count", ascending=False)
    )
    seg["share"] = (seg["user_count"] / seg["user_count"].sum()).round(4)
    segments = seg.to_dict(orient="records")

    buyers = int((feats["buy_count"] > 0).sum())
    return B2CSummaryResponse(
        users=int(len(feats)),
        buyers=buyers,
        buyer_rate=round(buyers / max(len(feats), 1), 4),
        total_events=int(feats["total_events"].sum()),
        pv_count=int(row["pv_count"]),
        cart_count=int(row["cart_count"]),
        fav_count=int(row["fav_count"]),
        buy_count=int(row["buy_count"]),
        pv_to_buy_rate=float(row["pv_to_buy_rate"]),
        cart_to_buy_rate=float(row["cart_to_buy_rate"]),
        unique_items=int(row["unique_items"]),
        unique_categories=int(row["unique_categories"]),
        date_min=str(row.get("date_min")) if "date_min" in row else None,
        date_max=str(row.get("date_max")) if "date_max" in row else None,
        segments=segments,
    )


@router.get("/customers", response_model=CustomerListResponse)
def list_customers(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    segment: Optional[int] = Query(None, description="Filter by cluster_id"),
    persona: Optional[str] = Query(None, description="Filter by cluster_persona (case-insensitive contains)"),
    min_buys: Optional[int] = Query(None, ge=0),
    sort: str = Query("buy_count", pattern="^(buy_count|pv_count|total_events|recency_days|user_id)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
) -> CustomerListResponse:
    df = _load("customer_clusters.csv")

    if segment is not None:
        df = df[df["cluster_id"] == segment]
    if persona:
        df = df[df["cluster_persona"].str.contains(persona, case=False, na=False)]
    if min_buys is not None:
        df = df[df["buy_count"] >= min_buys]

    total = int(len(df))
    ascending = order == "asc"
    if sort in df.columns:
        df = df.sort_values(sort, ascending=ascending)

    page = df.iloc[offset:offset + limit]
    customers = [
        CustomerListItem(
            user_id=int(r["user_id"]),
            cluster_id=int(r["cluster_id"]),
            cluster_persona=str(r["cluster_persona"]),
            total_events=int(r["total_events"]),
            buy_count=int(r["buy_count"]),
            pv_count=int(r["pv_count"]),
            recency_days=float(r["recency_days"]),
            top_category=int(r["top_category"]),
        )
        for _, r in page.iterrows()
    ]
    return CustomerListResponse(total=total, limit=limit, offset=offset, customers=customers)


@router.get("/customers/{user_id}", response_model=CustomerDetailResponse)
def get_customer(user_id: int) -> CustomerDetailResponse:
    df = _load("customer_clusters.csv")
    row = df[df["user_id"] == user_id]
    if row.empty:
        return CustomerDetailResponse(found=False, user_id=user_id)
    r = row.iloc[0]

    features = {
        col: (int(r[col]) if pd.api.types.is_integer_dtype(df[col])
              else float(r[col]) if pd.api.types.is_float_dtype(df[col])
              else str(r[col]))
        for col in df.columns
        if col not in ("user_id", "cluster_id", "cluster_persona")
    }

    # Load recs; only slice this user's rows for speed
    recs: list[dict[str, Any]] = []
    nbo_path = _b2c_dir() / "next_best_offers.csv"
    if nbo_path.is_file():
        try:
            nbo = _load("next_best_offers.csv")
            user_recs = (
                nbo[nbo["user_id"] == user_id]
                .sort_values("rank")
                [["rank", "item_id", "score", "reason"]]
            )
            recs = [
                {"rank": int(rr["rank"]), "item_id": int(rr["item_id"]),
                 "score": float(rr["score"]), "reason": str(rr["reason"])}
                for _, rr in user_recs.iterrows()
            ]
        except Exception:
            recs = []

    return CustomerDetailResponse(
        found=True,
        user_id=user_id,
        cluster_id=int(r["cluster_id"]),
        cluster_persona=str(r["cluster_persona"]),
        features=features,
        top_recommendations=recs,
    )


@router.get("/segments", response_model=SegmentListResponse)
def list_segments() -> SegmentListResponse:
    df = _load("customer_clusters.csv")
    total_users = len(df)
    agg = (
        df.groupby(["cluster_id", "cluster_persona"], observed=True)
          .agg(
              user_count=("user_id", "count"),
              avg_buy_count=("buy_count", "mean"),
              avg_pv_count=("pv_count", "mean"),
              avg_recency_days=("recency_days", "mean"),
              avg_buy_share=("buy_share", "mean"),
          )
          .reset_index()
          .sort_values("user_count", ascending=False)
    )
    segments = [
        SegmentSummary(
            cluster_id=int(r["cluster_id"]),
            cluster_persona=str(r["cluster_persona"]),
            user_count=int(r["user_count"]),
            share=round(r["user_count"] / max(total_users, 1), 4),
            avg_buy_count=round(float(r["avg_buy_count"]), 2),
            avg_pv_count=round(float(r["avg_pv_count"]), 2),
            avg_recency_days=round(float(r["avg_recency_days"]), 3),
            avg_buy_share=round(float(r["avg_buy_share"]), 4),
        )
        for _, r in agg.iterrows()
    ]
    return SegmentListResponse(segments=segments)


@router.get("/segments/{cluster_id}", response_model=SegmentDetailResponse)
def get_segment(cluster_id: int, sample_size: int = Query(25, ge=1, le=200)) -> SegmentDetailResponse:
    df = _load("customer_clusters.csv")
    seg = df[df["cluster_id"] == cluster_id]
    if seg.empty:
        return SegmentDetailResponse(found=False, cluster_id=cluster_id, user_count=0, share=0.0)

    persona = str(seg["cluster_persona"].iloc[0])

    profile_cols = [
        "pv_count", "cart_count", "fav_count", "buy_count",
        "total_events", "distinct_items", "distinct_categories",
        "active_days", "recency_days",
        "pv_to_buy_rate", "cart_to_buy_rate", "buy_share",
    ]
    profile = {c: round(float(seg[c].mean()), 4) for c in profile_cols if c in seg.columns}

    # Top items among this segment (from next_best_offers.csv where reason=cluster_popular)
    top_items: list[dict[str, Any]] = []
    nbo_path = _b2c_dir() / "next_best_offers.csv"
    if nbo_path.is_file():
        try:
            nbo = _load("next_best_offers.csv")
            slice_ = nbo[nbo["cluster_id"] == cluster_id]
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
        except Exception:
            top_items = []

    sample_users = seg["user_id"].head(sample_size).astype(int).tolist()

    return SegmentDetailResponse(
        found=True,
        cluster_id=cluster_id,
        cluster_persona=persona,
        user_count=int(len(seg)),
        share=round(len(seg) / max(len(df), 1), 4),
        profile=profile,
        top_items=top_items,
        sample_users=sample_users,
    )


@router.get("/funnel", response_model=FunnelResponse)
def get_funnel(top_categories: int = Query(15, ge=1, le=100)) -> FunnelResponse:
    summary_df = _load("funnel_summary.csv")
    by_date_df = _load("funnel_by_date.csv")
    by_cat_df = _load("funnel_by_category.csv")

    if summary_df.empty:
        raise HTTPException(status_code=500, detail="funnel_summary.csv is empty")

    row = summary_df.iloc[0]
    overall = {k: (int(row[k]) if k in ("pv_count", "cart_count", "fav_count",
                                        "buy_count", "unique_users",
                                        "unique_items", "unique_categories")
                   else float(row[k]) if k in ("pv_to_buy_rate", "cart_to_buy_rate")
                   else str(row[k]))
               for k in row.index}

    by_date = by_date_df.to_dict(orient="records")
    top_cats = by_cat_df.head(top_categories).to_dict(orient="records")
    return FunnelResponse(overall=overall, by_date=by_date, top_categories=top_cats)


@router.get("/bundles", response_model=BundleListResponse)
def get_bundles(limit: int = Query(50, ge=1, le=500),
                min_lift: float = Query(0.0, ge=0.0)) -> BundleListResponse:
    df = _load("bundles.csv")
    if min_lift > 0:
        df = df[df["lift"] >= min_lift]
    df = df.sort_values(["lift", "pair_count"], ascending=[False, False]).head(limit)
    bundles = [
        BundleItem(
            item_a=int(r["item_a"]),
            item_b=int(r["item_b"]),
            pair_count=int(r["pair_count"]),
            support=float(r["support"]),
            confidence=float(r["confidence"]),
            lift=float(r["lift"]),
        )
        for _, r in df.iterrows()
    ]
    return BundleListResponse(total=len(bundles), bundles=bundles)
