"""
FastAPI REST API for the RECAI agentic pipeline.

Serves JSON endpoints and the production React build from ../frontend/dist.
Business logic is delegated to agents; this file only orchestrates HTTP concerns.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# override=True: backend/.env wins over empty/mis-set GOOGLE_API_KEY in Windows env
load_dotenv(BACKEND_ROOT / ".env", override=True)

import config as recai_config
import pandas as pd
from agents import AGENT_REGISTRY
from agents.orchestrator_agent import OrchestratorAgent
from config import get_effective_config, save_runtime_overrides
from api.ai_routes import router as ai_router
from api.analytics import (
    compute_cluster_breakdown,
    compute_cluster_profile,
    compute_forecast_context,
    compute_store_spend_history,
    compute_summary,
)
from api.analytics_dashboard import compute_dashboard_analytics
from api.forecast_routes import router as forecast_router
from contextlib import asynccontextmanager

from db.connection import check_connection, init_schema, list_required_tables
from db.sync_middleware import DbSyncMiddleware
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# --- In-memory run state (last completed pipeline) ---
LAST_PIPELINE_RESULT: dict[str, Any] | None = None
AGENT_LAST_STATUS: dict[str, dict[str, Any]] = {}


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    init_schema()
    yield


app = FastAPI(
    title="RECAI Pipeline API",
    description="Agentic recommendation pipeline (Google ADK-ready) with REST endpoints.",
    version="0.1.0",
    lifespan=_lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(DbSyncMiddleware)


def _engine_root() -> Path:
    p = recai_config.engine_root()
    if not p.is_dir():
        raise HTTPException(
            status_code=503,
            detail=f"backend root not found at {p}",
        )
    return p


def _final_csv() -> Path:
    return _engine_root() / "outputs" / "recommendations_final.csv"


# ---------- Pydantic models ----------


class PipelineRunRequest(BaseModel):
    """Optional config overrides applied before run (merged into runtime_config.json)."""

    config_override: Optional[dict[str, Any]] = Field(
        default=None,
        description="Keys must match config.py (e.g. EXCLUSION_WINDOW_MONTHS).",
    )
    label: Optional[str] = Field(default=None, description="Optional human label for logs.")


class AgentRunRequest(BaseModel):
    config_override: Optional[dict[str, Any]] = None


class PipelineRunResultResponse(BaseModel):
    status: str
    run_id: Optional[str] = None
    time_taken_seconds: Optional[float] = None
    pipeline_results: Optional[dict[str, Any]] = None
    failed_at: Optional[str] = None
    error: Optional[str] = None


class ConfigResponse(BaseModel):
    config: dict[str, Any]


class ConfigPutRequest(BaseModel):
    """Partial update — only known keys are applied."""

    EXCLUSION_WINDOW_MONTHS: Optional[int] = None
    TARGET_GROWTH: Optional[float] = None
    FPG_MIN_SUPPORT: Optional[float] = None
    FPG_MIN_CONFIDENCE: Optional[float] = None
    FPG_MIN_LIFT: Optional[float] = None
    ALS_FACTORS: Optional[int] = None
    ALS_ITERATIONS: Optional[int] = None
    ALS_REGULARIZATION: Optional[float] = None
    TOP_N_RECOMMENDATIONS: Optional[int] = None
    DATA_WINDOW_CLUSTERING_MONTHS: Optional[int] = None
    DATA_WINDOW_RECO_MONTHS: Optional[int] = None

    def non_none_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.model_dump().items() if v is not None}


class StoreListResponse(BaseModel):
    stores: list[str]
    total: int


class RecommendationSummary(BaseModel):
    store_id: str
    cluster_id: Optional[int] = None
    total_recommendations: int
    top_confidence: Optional[float] = None
    total_estimated_amount: Optional[float] = None
    total_volume: Optional[int] = None


class ClusterSummary(BaseModel):
    cluster_id: int
    store_count: int


class ClusterDetailResponse(BaseModel):
    cluster_id: int
    store_count: int
    stores: list[str]
    top_recommended_skus: list[dict[str, Any]]


class AgentInfo(BaseModel):
    name: str
    description: str
    last_status: Optional[str] = None
    last_time_seconds: Optional[float] = None


class AgentListResponse(BaseModel):
    agents: list[AgentInfo]


class AgentStatusResponse(BaseModel):
    agent_name: str
    last_result: Optional[dict[str, Any]] = None


class PipelineStatusResponse(BaseModel):
    last_run: Optional[dict[str, Any]] = None
    effective_config: dict[str, Any]


# ---------- Pipeline endpoints ----------


@app.post(
    "/pipeline/run",
    response_model=PipelineRunResultResponse,
    summary="Run full pipeline via OrchestratorAgent",
)
def post_pipeline_run(body: PipelineRunRequest) -> PipelineRunResultResponse:
    global LAST_PIPELINE_RESULT, AGENT_LAST_STATUS
    if body.config_override:
        try:
            save_runtime_overrides(body.config_override)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

    orch = OrchestratorAgent()
    result = orch.run_full_pipeline()
    LAST_PIPELINE_RESULT = result
    AGENT_LAST_STATUS["orchestrator_agent"] = result
    for name, res in (result.get("pipeline_results") or {}).items():
        AGENT_LAST_STATUS[name] = res

    if result.get("status") != "success":
        return PipelineRunResultResponse(
            status="failed",
            run_id=result.get("run_id"),
            time_taken_seconds=result.get("time_taken_seconds"),
            pipeline_results=result.get("pipeline_results"),
            failed_at=result.get("failed_at"),
            error=result.get("error"),
        )
    return PipelineRunResultResponse(
        status="success",
        run_id=result.get("run_id"),
        time_taken_seconds=result.get("time_taken_seconds"),
        pipeline_results=result.get("pipeline_results"),
    )


@app.post(
    "/pipeline/run/{agent_name}",
    response_model=dict,
    summary="Run a single pipeline agent by id",
)
def post_pipeline_run_agent(agent_name: str, body: AgentRunRequest) -> dict[str, Any]:
    global AGENT_LAST_STATUS
    cmap = OrchestratorAgent.agent_class_map()
    if agent_name not in cmap and agent_name != OrchestratorAgent.name:
        if agent_name == "orchestrator_agent":
            raise HTTPException(
                status_code=400,
                detail="Use POST /pipeline/run for full orchestrator run.",
            )
        raise HTTPException(status_code=404, detail=f"Unknown agent: {agent_name}")

    if body.config_override:
        try:
            save_runtime_overrides(body.config_override)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

    orch = OrchestratorAgent()
    out = orch.run_single_agent(agent_name, {})
    AGENT_LAST_STATUS[agent_name] = out
    if out.get("status") != "success":
        raise HTTPException(status_code=500, detail=out.get("error", "agent failed"))
    return out


@app.get(
    "/pipeline/status",
    response_model=PipelineStatusResponse,
    summary="Last pipeline run snapshot and effective config",
)
def get_pipeline_status() -> PipelineStatusResponse:
    return PipelineStatusResponse(
        last_run=LAST_PIPELINE_RESULT,
        effective_config=get_effective_config(),
    )


# ---------- Config ----------


@app.get("/config", response_model=ConfigResponse)
def get_config() -> ConfigResponse:
    return ConfigResponse(config=get_effective_config())


@app.put("/config", response_model=ConfigResponse)
def put_config(body: ConfigPutRequest) -> ConfigResponse:
    updates = body.non_none_dict()
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update.")
    try:
        merged = save_runtime_overrides(updates)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return ConfigResponse(config=merged)


# ---------- Stores & recommendations ----------


@app.get("/stores", response_model=StoreListResponse)
def list_stores() -> StoreListResponse:
    path = _final_csv()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="recommendations_final.csv not found.")
    df = pd.read_csv(path, usecols=["STORE_ID"], low_memory=False)
    ids = sorted(df["STORE_ID"].astype(str).unique().tolist())
    return StoreListResponse(stores=ids, total=len(ids))


@app.get("/recommendations/sku_search")
def search_skus(q: str = Query("", description="Filter SKU_CODE or PRODUCT_NAME")) -> dict[str, Any]:
    """Distinct SKUs with product name for Analysis product-first search."""
    path = _final_csv()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="recommendations_final.csv not found.")
    df = pd.read_csv(
        path,
        usecols=["SKU_CODE", "PRODUCT_NAME"],
        low_memory=False,
    )
    df["SKU_CODE"] = df["SKU_CODE"].astype(str)
    df["PRODUCT_NAME"] = df["PRODUCT_NAME"].astype(str)
    uniq = df.drop_duplicates(subset=["SKU_CODE"], keep="first")
    qn = q.strip().lower()
    if qn:
        mask = uniq["SKU_CODE"].str.lower().str.contains(qn, regex=False) | uniq[
            "PRODUCT_NAME"
        ].str.lower().str.contains(qn, regex=False)
        uniq = uniq.loc[mask]
    rows = uniq.head(200).to_dict(orient="records")
    return {"query": q, "skus": rows, "total": len(rows)}


@app.get("/recommendations/by_sku/{sku_code}")
def get_recommendations_by_sku(sku_code: str) -> dict[str, Any]:
    """All recommendation rows for a SKU across stores (Analysis: all stores)."""
    path = _final_csv()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="recommendations_final.csv not found.")
    df = pd.read_csv(path, low_memory=False)
    df["SKU_CODE"] = df["SKU_CODE"].astype(str)
    sub = df.loc[df["SKU_CODE"] == str(sku_code).strip()]
    if sub.empty:
        raise HTTPException(status_code=404, detail="SKU not found in recommendations.")
    sub = sub.sort_values(["STORE_ID", "RANK"])
    product_name = str(sub["PRODUCT_NAME"].iloc[0])
    l2 = str(sub["L2_CATEGORY"].iloc[0])
    return {
        "sku_code": str(sku_code).strip(),
        "product_name": product_name,
        "l2_category": l2,
        "store_count": int(len(sub)),
        "recommendations": sub.to_dict(orient="records"),
    }


@app.get("/recommendations/{store_id}")
def get_recommendations(
    store_id: str,
    months: Optional[int] = Query(
        default=None,
        description="If set, must match EXCLUSION_WINDOW_MONTHS or 422.",
    ),
) -> dict[str, Any]:
    eff = get_effective_config()
    if months is not None and int(months) != int(
        eff.get("EXCLUSION_WINDOW_MONTHS", 0)
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                f"Query months={months} does not match configured "
                f"EXCLUSION_WINDOW_MONTHS={eff.get('EXCLUSION_WINDOW_MONTHS')}. "
                "Update config and re-run the pipeline."
            ),
        )
    path = _final_csv()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="recommendations_final.csv not found.")
    df = pd.read_csv(path, low_memory=False)
    df["STORE_ID"] = df["STORE_ID"].astype(str)
    sub = df.loc[df["STORE_ID"] == str(store_id)]
    if sub.empty:
        raise HTTPException(status_code=404, detail="Store not found.")
    cluster_id = int(sub["CLUSTER_ID"].iloc[0])
    recs = sub.sort_values("RANK").to_dict(orient="records")
    return {
        "store_id": str(store_id),
        "cluster_id": cluster_id,
        "total_recommendations": len(sub),
        "recommendations": recs,
    }


@app.get("/recommendations/{store_id}/summary", response_model=RecommendationSummary)
def get_recommendation_summary(
    store_id: str,
    months: Optional[int] = Query(default=None),
) -> RecommendationSummary:
    eff = get_effective_config()
    if months is not None and int(months) != int(
        eff.get("EXCLUSION_WINDOW_MONTHS", 0)
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                f"months={months} != EXCLUSION_WINDOW_MONTHS="
                f"{eff.get('EXCLUSION_WINDOW_MONTHS')}"
            ),
        )
    path = _final_csv()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="recommendations_final.csv not found.")
    df = pd.read_csv(path, low_memory=False)
    df["STORE_ID"] = df["STORE_ID"].astype(str)
    sub = df.loc[df["STORE_ID"] == str(store_id)]
    if sub.empty:
        raise HTTPException(status_code=404, detail="Store not found.")
    conf = sub["CONFIDENCE"].astype(float)
    return RecommendationSummary(
        store_id=str(store_id),
        cluster_id=int(sub["CLUSTER_ID"].iloc[0]),
        total_recommendations=len(sub),
        top_confidence=float(conf.max()) if len(conf) else None,
        total_estimated_amount=float(sub["FINAL_ADJUSTED_AMT"].sum())
        if "FINAL_ADJUSTED_AMT" in sub.columns
        else None,
        total_volume=int(sub["VOLUME"].sum()) if "VOLUME" in sub.columns else None,
    )


# ---------- Clusters ----------


@app.get("/clusters", response_model=list[ClusterSummary])
def list_clusters() -> list[ClusterSummary]:
    eng = _engine_root()
    cpath = eng / "outputs" / "clustered_data.csv"
    if not cpath.is_file():
        raise HTTPException(status_code=404, detail="clustered_data.csv not found.")
    cl = pd.read_csv(cpath, low_memory=False)
    counts = cl.groupby("CLUSTER_ID", observed=False)["STORE_ID"].nunique()
    out: list[ClusterSummary] = []
    for cid, cnt in counts.items():
        out.append(ClusterSummary(cluster_id=int(cid), store_count=int(cnt)))
    return sorted(out, key=lambda x: x.cluster_id)


@app.get("/clusters/{cluster_id}", response_model=ClusterDetailResponse)
def get_cluster(cluster_id: int) -> ClusterDetailResponse:
    eng = _engine_root()
    cpath = eng / "outputs" / "clustered_data.csv"
    fpath = _final_csv()
    if not cpath.is_file():
        raise HTTPException(status_code=404, detail="clustered_data.csv not found.")
    if not fpath.is_file():
        raise HTTPException(status_code=404, detail="recommendations_final.csv not found.")
    cl = pd.read_csv(cpath, low_memory=False)
    cl["STORE_ID"] = cl["STORE_ID"].astype(str)
    part = cl.loc[cl["CLUSTER_ID"] == int(cluster_id)]
    if part.empty:
        raise HTTPException(status_code=404, detail="Cluster not found.")
    stores = sorted(part["STORE_ID"].unique().tolist())
    fin = pd.read_csv(fpath, low_memory=False)
    fin = fin.loc[fin["CLUSTER_ID"] == int(cluster_id)]
    top = (
        fin.groupby(["SKU_CODE", "PRODUCT_NAME"], observed=False)
        .size()
        .reset_index(name="count")
        .sort_values("count", ascending=False)
        .head(15)
        .to_dict(orient="records")
    )
    return ClusterDetailResponse(
        cluster_id=int(cluster_id),
        store_count=len(stores),
        stores=stores,
        top_recommended_skus=top,
    )


# ---------- Agents meta ----------


@app.get("/agents", response_model=AgentListResponse)
def list_agents() -> AgentListResponse:
    agents: list[AgentInfo] = []
    for row in AGENT_REGISTRY:
        name = row["name"]
        last = AGENT_LAST_STATUS.get(name)
        agents.append(
            AgentInfo(
                name=name,
                description=row["description"],
                last_status=last.get("status") if last else None,
                last_time_seconds=float(last["time_taken_seconds"])
                if last and last.get("time_taken_seconds") is not None
                else None,
            )
        )
    return AgentListResponse(agents=agents)


@app.get("/agents/{agent_name}/status", response_model=AgentStatusResponse)
def get_agent_status(agent_name: str) -> AgentStatusResponse:
    last = AGENT_LAST_STATUS.get(agent_name)
    if not last:
        return AgentStatusResponse(agent_name=agent_name, last_result=None)
    return AgentStatusResponse(agent_name=agent_name, last_result=last)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health/db")
def health_db() -> dict[str, Any]:
    """Local MySQL connectivity and schema status (development only)."""
    status = check_connection()
    required = set(list_required_tables())
    present = set(status.get("tables") or [])
    status["required_tables"] = sorted(required)
    status["missing_tables"] = sorted(required - present)
    status["schema_complete"] = not status.get("missing_tables")
    return status


@app.get("/api/health/ai")
def health_ai() -> dict[str, Any]:
    """Whether a Gemini key is visible to this process (does not expose the key)."""
    import os

    key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    env_path = BACKEND_ROOT / ".env"
    return {
        "gemini_key_configured": bool(key and str(key).strip()),
        "env_file_found": env_path.is_file(),
        "env_file_path": str(env_path),
    }


# ---------- Analytics (dashboard) ----------


@app.get("/summary")
def get_summary() -> dict[str, Any]:
    """Aggregated KPIs from recommendations_final.csv (same shape as legacy /summary)."""
    return compute_summary(_engine_root())


@app.get("/analytics/cluster_breakdown")
def get_cluster_breakdown() -> dict[str, Any]:
    return compute_cluster_breakdown(_engine_root())


@app.get("/analytics/cluster_profile")
def get_cluster_profile() -> dict[str, Any]:
    """Cluster × metrics matrix for heatmap (clustered_data.csv means per cluster)."""
    return compute_cluster_profile(_engine_root())


@app.get("/analytics/forecast_context")
def get_forecast_context() -> dict[str, Any]:
    return compute_forecast_context(_engine_root())


@app.get("/analytics/dashboard")
def get_dashboard_analytics() -> dict[str, Any]:
    """Exploratory sales and category analytics for the dashboard (no AI)."""
    return compute_dashboard_analytics(_engine_root())


@app.get("/analytics/store/{store_id}/spend_history")
def get_store_spend_history(store_id: str) -> dict[str, Any]:
    """Monthly purchase spend for one store (last up to 6 months in transactions)."""
    return compute_store_spend_history(_engine_root(), store_id)


app.include_router(forecast_router)
app.include_router(ai_router)


# ---------- Static UI (Vite SPA build at ../frontend/dist) ----------
_ui_dist = BACKEND_ROOT.parent / "frontend" / "dist"

if _ui_dist.is_dir() and (_ui_dist / "index.html").is_file():
    _assets = _ui_dist / "assets"
    if _assets.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(_assets)),
            name="ui_assets",
        )

    def _spa_index() -> FileResponse:
        return FileResponse(_ui_dist / "index.html")

    @app.get("/")
    async def spa_root() -> FileResponse:
        return _spa_index()

    @app.get("/{full_path:path}")
    async def spa_history(full_path: str) -> FileResponse:
        candidate = (_ui_dist / full_path).resolve()
        root = _ui_dist.resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            raise HTTPException(status_code=404)
        if candidate.is_file():
            return FileResponse(candidate)
        return _spa_index()
