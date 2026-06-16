"""AI agent HTTP endpoints: insights, recommendations, clusters, forecast, chat."""

from __future__ import annotations

import json
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import config as recai_config
from ai import gemini_service
from api.analytics import (
    compute_chat_hints,
    compute_cluster_breakdown,
    compute_forecast_context,
    compute_summary,
)
from config import get_effective_config

router = APIRouter(prefix="/ai", tags=["ai"])


def _engine_root() -> Any:
    p = recai_config.engine_root()
    if not p.is_dir():
        raise HTTPException(
            status_code=503,
            detail=f"backend root not found at {p}",
        )
    return p


def _final_csv_path(eng: Any) -> Any:
    return eng / "outputs" / "recommendations_final.csv"


def _chat_context_blob(eng: Any) -> str:
    parts = {
        "summary": compute_summary(eng),
        "clusters": compute_cluster_breakdown(eng),
        "forecast_context": compute_forecast_context(eng),
        "chat_hints": compute_chat_hints(eng),
        "effective_config": get_effective_config(),
    }
    return json.dumps(parts, indent=2, default=str)[:28000]


class ChatRequest(BaseModel):
    messages: list[dict[str, str]] = Field(
        ...,
        description="OpenAI-style messages with role and content.",
    )


class ExplainRecommendationRequest(BaseModel):
    store_id: str
    sku_code: str


def _handle_gemini_error(e: Exception) -> HTTPException:
    msg = str(e)
    if "GOOGLE_API_KEY" in msg or "GEMINI_API_KEY" in msg or "API key" in msg:
        return HTTPException(
            status_code=503,
            detail="AI is not configured. Set GOOGLE_API_KEY or GEMINI_API_KEY in .env.",
        )
    return HTTPException(status_code=502, detail=f"AI provider error: {msg}")


@router.post("/insight/dashboard")
def post_insight_dashboard() -> dict[str, Any]:
    eng = _engine_root()
    payload = {
        "agent": "insight",
        "metrics": compute_summary(eng),
        "effective_config": get_effective_config(),
    }
    system = (
        "You are an Insight Agent for a retail recommendation system. "
        "Explain what the numbers imply for merchandising and operations."
    )
    try:
        insight = gemini_service.generate_json_insight(system, payload)
    except Exception as e:
        raise _handle_gemini_error(e) from e
    return {"payload": payload, "insight": insight}


@router.post("/insight/store/{store_id}")
def post_insight_store(store_id: str) -> dict[str, Any]:
    eng = _engine_root()
    path = _final_csv_path(eng)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="recommendations_final.csv not found.")
    df = pd.read_csv(path, low_memory=False)
    df["STORE_ID"] = df["STORE_ID"].astype(str)
    sub = df.loc[df["STORE_ID"] == str(store_id)]
    if sub.empty:
        raise HTTPException(status_code=404, detail="Store not found.")
    sub = sub.sort_values("RANK")
    cluster_id = int(sub["CLUSTER_ID"].iloc[0])
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
    top = sub.head(12)[cols].to_dict(orient="records")
    cl_info = compute_cluster_breakdown(eng)
    cluster_row = next(
        (c for c in cl_info.get("clusters", []) if c["cluster_id"] == cluster_id),
        None,
    )
    payload = {
        "agent": "recommendation",
        "store_id": str(store_id),
        "cluster_id": cluster_id,
        "cluster_context": cluster_row,
        "summary": {
            "total_recommendations": len(sub),
            "top_confidence": float(sub["CONFIDENCE"].max())
            if "CONFIDENCE" in sub.columns
            else None,
            "total_estimated_amount": float(sub["FINAL_ADJUSTED_AMT"].sum())
            if "FINAL_ADJUSTED_AMT" in sub.columns
            else None,
        },
        "top_recommendations": top,
        "effective_config": get_effective_config(),
    }
    system = (
        "You are a Recommendation Agent. Prioritize actionable, specific next steps "
        "for this store and its cluster. Reference sources (FPG, ALS, POPULARITY) when relevant."
    )
    try:
        insight = gemini_service.generate_json_insight(system, payload)
    except Exception as e:
        raise _handle_gemini_error(e) from e
    return {"payload": payload, "insight": insight}


@router.post("/insight/cluster/{cluster_id}")
def post_insight_cluster(cluster_id: int) -> dict[str, Any]:
    eng = _engine_root()
    breakdown = compute_cluster_breakdown(eng)
    clusters = breakdown.get("clusters", [])
    if not clusters:
        raise HTTPException(
            status_code=404,
            detail="No cluster data available. Run the pipeline first.",
        )
    row = next((c for c in clusters if c["cluster_id"] == int(cluster_id)), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Cluster not found.")
    payload = {
        "agent": "cluster",
        "cluster": row,
        "all_clusters_preview": clusters[:20],
        "effective_config": get_effective_config(),
    }
    system = (
        "You are a Cluster Agent. Interpret this segment for business users: "
        "persona, strengths, risks, and engagement strategies (marketing, assortment, ops)."
    )
    try:
        insight = gemini_service.generate_json_insight(system, payload)
    except Exception as e:
        raise _handle_gemini_error(e) from e
    return {"payload": payload, "insight": insight}


@router.post("/insight/forecast")
def post_insight_forecast() -> dict[str, Any]:
    eng = _engine_root()
    payload = {
        "agent": "forecast",
        "forecast_context": compute_forecast_context(eng),
        "summary": compute_summary(eng),
        "effective_config": get_effective_config(),
    }
    system = (
        "You are a Forecast Agent. Based on estimated amounts and confidence distribution, "
        "describe likely near-term outcomes, risks, and upside. Do not invent numbers not in data."
    )
    try:
        insight = gemini_service.generate_json_insight(system, payload)
    except Exception as e:
        raise _handle_gemini_error(e) from e
    return {"payload": payload, "insight": insight}


@router.post("/chat")
def post_chat(body: ChatRequest) -> dict[str, str]:
    eng = _engine_root()
    ctx = _chat_context_blob(eng)
    try:
        reply = gemini_service.chat_reply(body.messages, ctx)
    except Exception as e:
        raise _handle_gemini_error(e) from e
    return {"reply": reply}


@router.post("/explain/recommendation")
def post_explain_recommendation(body: ExplainRecommendationRequest) -> dict[str, str]:
    eng = _engine_root()
    path = _final_csv_path(eng)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="recommendations_final.csv not found.")
    df = pd.read_csv(path, low_memory=False)
    df["STORE_ID"] = df["STORE_ID"].astype(str)
    sub = df.loc[
        (df["STORE_ID"] == str(body.store_id))
        & (df["SKU_CODE"].astype(str) == str(body.sku_code))
    ]
    if sub.empty:
        raise HTTPException(
            status_code=404,
            detail="Recommendation row not found for this store and SKU.",
        )
    row = sub.iloc[0].to_dict()
    payload = {"store_id": body.store_id, "recommendation": row}
    system = (
        "Explain in 3-6 sentences WHY this SKU was recommended for this store: "
        "source model, confidence, cluster context if visible, and business takeaway. "
        "If a field is missing, say so briefly."
    )
    try:
        text = gemini_service.generate_text(system, payload)
    except Exception as e:
        raise _handle_gemini_error(e) from e
    return {"explanation": text}
