"""Synchronize UI-facing API responses into local MySQL (failures never break API)."""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from db.connection import get_session, is_db_enabled
from db.repositories import (
    AIRepository,
    AnalyticsRepository,
    ChatRepository,
    ClusterRepository,
    RecommendationRepository,
    SeasonalityRepository,
    SimulationRepository,
    StoreRepository,
    SyncLogRepository,
)

logger = logging.getLogger(__name__)

_sync_log = SyncLogRepository()
_stores = StoreRepository()
_clusters = ClusterRepository()
_recommendations = RecommendationRepository()
_analytics = AnalyticsRepository()
_seasonality = SeasonalityRepository()
_ai = AIRepository()
_chat = ChatRepository()
_simulation = SimulationRepository()


def _log_sync(
    session,
    *,
    endpoint: str,
    method: str,
    status: str,
    records_affected: int = 0,
    error_message: str | None = None,
    duration_ms: int | None = None,
) -> None:
    if session is None:
        return
    try:
        _sync_log.insert(
            session,
            endpoint=endpoint,
            method=method,
            status=status,
            records_affected=records_affected,
            error_message=error_message,
            duration_ms=duration_ms,
        )
    except Exception:
        logger.exception("Failed to write api_sync_log for %s", endpoint)


def _dispatch_sync(
    session,
    *,
    method: str,
    path: str,
    payload: Any,
) -> int:
    """Route a successful API response to the correct repository. Returns rows affected."""
    if payload is None:
        return 0

    # GET /summary
    if path == "/summary" and isinstance(payload, dict):
        return _analytics.sync_summary(session, payload)

    # GET /analytics/*
    if path == "/analytics/cluster_breakdown" and isinstance(payload, dict):
        return _analytics.sync_cluster_breakdown(session, payload)
    if path == "/analytics/cluster_profile" and isinstance(payload, dict):
        return _analytics.sync_cluster_profile(session, payload)
    if path == "/analytics/forecast_context" and isinstance(payload, dict):
        return _analytics.sync_forecast_context(session, payload)
    if path == "/analytics/dashboard" and isinstance(payload, dict):
        return _analytics.sync_dashboard(session, payload)

    m = re.match(r"^/analytics/store/([^/]+)/spend_history$", path)
    if m and isinstance(payload, dict):
        return _stores.sync_spend_history(session, m.group(1), payload)

    # GET /stores
    if path == "/stores" and isinstance(payload, dict):
        return _stores.sync_store_list(session, payload)

    # GET /seasonality/l2_categories
    if path == "/seasonality/l2_categories" and isinstance(payload, dict):
        return _seasonality.sync_l2_categories(session, payload)

    # GET /seasonality/{category}
    m = re.match(r"^/seasonality/([^/]+)$", path)
    if m and m.group(1) != "l2_categories" and isinstance(payload, dict):
        return _seasonality.sync_category(session, payload)

    # GET /forecast/simulate
    if path == "/forecast/simulate" and isinstance(payload, dict):
        return _simulation.insert(session, payload)

    # GET /recommendations/sku_search
    if path.startswith("/recommendations/sku_search") and isinstance(payload, dict):
        return _recommendations.sync_skus(session, payload)

    # GET /recommendations/by_sku/{sku}
    m = re.match(r"^/recommendations/by_sku/([^/]+)$", path)
    if m and isinstance(payload, dict):
        return _recommendations.sync_by_sku(session, payload)

    # GET /recommendations/{store}/summary
    m = re.match(r"^/recommendations/([^/]+)/summary$", path)
    if m and isinstance(payload, dict):
        return _recommendations.sync_store_summary(session, m.group(1), payload)

    # GET /recommendations/{store}
    m = re.match(r"^/recommendations/([^/]+)$", path)
    if m and isinstance(payload, dict):
        blocked = {"sku_search", "by_sku"}
        if m.group(1) not in blocked:
            return _recommendations.sync_store_recommendations(session, m.group(1), payload)

    # GET /clusters
    if path == "/clusters" and isinstance(payload, list):
        return _clusters.sync_cluster_list(session, payload)

    # GET /clusters/{id}
    m = re.match(r"^/clusters/(\d+)$", path)
    if m and isinstance(payload, dict):
        return _clusters.sync_cluster_detail(session, payload)

    # GET/PUT /config
    if path in ("/config",) and isinstance(payload, dict):
        return _analytics.sync_runtime_config(session, payload)

    # POST /ai/insight/*
    if path == "/ai/insight/dashboard" and isinstance(payload, dict):
        return _ai.sync_insight(session, insight_type="dashboard", entity_id=None, data=payload)
    m = re.match(r"^/ai/insight/store/([^/]+)$", path)
    if m and isinstance(payload, dict):
        return _ai.sync_insight(
            session, insight_type="store", entity_id=m.group(1), data=payload
        )
    m = re.match(r"^/ai/insight/cluster/(\d+)$", path)
    if m and isinstance(payload, dict):
        return _ai.sync_insight(
            session, insight_type="cluster", entity_id=m.group(1), data=payload
        )
    if path == "/ai/insight/forecast" and isinstance(payload, dict):
        return _ai.sync_insight(session, insight_type="forecast", entity_id=None, data=payload)

    # POST /ai/chat (INSERT)
    if path == "/ai/chat" and isinstance(payload, dict):
        messages = payload.get("_request_messages") or []
        reply = str(payload.get("reply", ""))
        return _chat.insert(session, messages=messages, reply=reply)

    # POST /ai/explain/recommendation
    if path == "/ai/explain/recommendation" and isinstance(payload, dict):
        store_id = str(payload.get("_request_store_id", ""))
        sku_code = str(payload.get("_request_sku_code", ""))
        return _ai.sync_explanation(
            session,
            store_id=store_id,
            sku_code=sku_code,
            explanation=str(payload.get("explanation", "")),
            recommendation=payload.get("_request_recommendation"),
        )

    return 0


_UI_SYNC_PREFIXES = (
    "/summary",
    "/analytics/",
    "/stores",
    "/seasonality/",
    "/forecast/simulate",
    "/recommendations/",
    "/clusters",
    "/config",
    "/ai/",
)


def should_sync_path(path: str) -> bool:
    if path.startswith("/api/health"):
        return False
    if path.startswith("/assets") or path == "/":
        return False
    return any(path.startswith(p) for p in _UI_SYNC_PREFIXES)


def sync_api_response(
    *,
    method: str,
    path: str,
    status_code: int,
    payload: Any,
) -> None:
    """Persist API response data. Never raises to callers."""
    if not is_db_enabled():
        return
    if status_code >= 400:
        return
    if not should_sync_path(path):
        return

    started = time.perf_counter()
    records = 0
    error: str | None = None
    status = "success"

    try:
        with get_session() as session:
            if session is None:
                return
            records = _dispatch_sync(session, method=method, path=path, payload=payload)
            duration_ms = int((time.perf_counter() - started) * 1000)
            _log_sync(
                session,
                endpoint=path,
                method=method,
                status=status,
                records_affected=records,
                duration_ms=duration_ms,
            )
    except Exception as exc:
        error = str(exc)
        status = "error"
        logger.warning("DB sync failed for %s %s: %s", method, path, exc)
        try:
            with get_session() as session:
                if session is not None:
                    duration_ms = int((time.perf_counter() - started) * 1000)
                    _log_sync(
                        session,
                        endpoint=path,
                        method=method,
                        status=status,
                        records_affected=records,
                        error_message=error,
                        duration_ms=duration_ms,
                    )
        except Exception:
            logger.exception("Failed to log sync error for %s", path)
