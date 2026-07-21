"""Verify UI-facing endpoint synchronization into local MySQL."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv

load_dotenv(BACKEND_ROOT / ".env", override=True)

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from api.main import app
from db.config import db_settings
from db.connection import init_schema

TABLE_QUERIES: dict[str, str] = {
    "dashboard_summary": "SELECT COUNT(*) FROM dashboard_summary",
    "analytics_snapshots": "SELECT COUNT(*) FROM analytics_snapshots",
    "clusters": "SELECT COUNT(*) FROM clusters",
    "cluster_stores": "SELECT COUNT(*) FROM cluster_stores",
    "cluster_top_skus": "SELECT COUNT(*) FROM cluster_top_skus",
    "stores": "SELECT COUNT(*) FROM stores",
    "store_spend_history": "SELECT COUNT(*) FROM store_spend_history",
    "skus": "SELECT COUNT(*) FROM skus",
    "recommendations": "SELECT COUNT(*) FROM recommendations",
    "store_recommendation_summary": "SELECT COUNT(*) FROM store_recommendation_summary",
    "seasonality_category": "SELECT COUNT(*) FROM seasonality_category",
    "seasonality_l2_list": "SELECT COUNT(*) FROM seasonality_l2_list",
    "simulation_history": "SELECT COUNT(*) FROM simulation_history",
    "ai_insights": "SELECT COUNT(*) FROM ai_insights",
    "ai_explanations": "SELECT COUNT(*) FROM ai_explanations",
    "chat_history": "SELECT COUNT(*) FROM chat_history",
    "api_sync_log": "SELECT COUNT(*) FROM api_sync_log",
}


def _counts(engine) -> dict[str, int]:
    out: dict[str, int] = {}
    with engine.connect() as conn:
        for table, query in TABLE_QUERIES.items():
            out[table] = int(conn.execute(text(query)).scalar() or 0)
    return out


def _latest_sync_log(engine, endpoint: str) -> dict[str, Any] | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT status, records_affected, error_message
                FROM api_sync_log
                WHERE endpoint = :endpoint
                ORDER BY id DESC
                LIMIT 1
                """
            ),
            {"endpoint": endpoint},
        ).fetchone()
    if not row:
        return None
    return {
        "status": row[0],
        "records_affected": row[1],
        "error_message": row[2],
    }


def _delta(before: dict[str, int], after: dict[str, int], table: str) -> int:
    return after.get(table, 0) - before.get(table, 0)


def main() -> int:
    init_schema()
    settings = db_settings()
    engine = create_engine(settings.sqlalchemy_url)
    client = TestClient(app)

    # Discover sample IDs from live API
    stores_resp = client.get("/stores")
    store_id = (
        stores_resp.json()["stores"][0]
        if stores_resp.status_code == 200 and stores_resp.json().get("stores")
        else None
    )

    clusters_resp = client.get("/clusters")
    cluster_id = clusters_resp.json()[0]["cluster_id"] if clusters_resp.status_code == 200 and clusters_resp.json() else 0

    rec_resp = client.get(f"/recommendations/{store_id}") if store_id else None
    sku_code = None
    l2_category = None
    if rec_resp and rec_resp.status_code == 200:
        recs = rec_resp.json().get("recommendations") or []
        if recs:
            sku_code = str(recs[0].get("SKU_CODE", ""))
            l2_category = str(recs[0].get("L2_CATEGORY", ""))

    l2_resp = client.get("/seasonality/l2_categories")
    if l2_resp.status_code == 200 and l2_resp.json().get("categories"):
        l2_category = l2_category or l2_resp.json()["categories"][0]

    cases: list[dict[str, Any]] = [
        {"name": "GET /summary", "method": "GET", "path": "/summary", "tables": ["dashboard_summary"]},
        {"name": "GET /analytics/cluster_breakdown", "method": "GET", "path": "/analytics/cluster_breakdown", "tables": ["clusters", "analytics_snapshots"]},
        {"name": "GET /analytics/cluster_profile", "method": "GET", "path": "/analytics/cluster_profile", "tables": ["analytics_snapshots"]},
        {"name": "GET /analytics/forecast_context", "method": "GET", "path": "/analytics/forecast_context", "tables": ["analytics_snapshots"]},
        {"name": "GET /analytics/dashboard", "method": "GET", "path": "/analytics/dashboard", "tables": ["analytics_snapshots"]},
        {"name": "GET /analytics/store spend_history", "method": "GET", "path": f"/analytics/store/{store_id}/spend_history" if store_id else None, "tables": ["store_spend_history", "stores"]},
        {"name": "GET /stores", "method": "GET", "path": "/stores", "tables": ["stores"]},
        {"name": "GET /clusters", "method": "GET", "path": "/clusters", "tables": ["clusters"]},
        {"name": "GET /clusters/{id}", "method": "GET", "path": f"/clusters/{cluster_id}", "tables": ["clusters", "cluster_stores", "cluster_top_skus", "stores"]},
        {"name": "GET /recommendations/sku_search", "method": "GET", "path": "/recommendations/sku_search?q=a", "tables": ["skus"]},
        {"name": "GET /recommendations/by_sku", "method": "GET", "path": f"/recommendations/by_sku/{sku_code}" if sku_code else None, "tables": ["skus", "recommendations", "stores"]},
        {"name": "GET /recommendations/{store}", "method": "GET", "path": f"/recommendations/{store_id}" if store_id else None, "tables": ["recommendations", "stores"]},
        {"name": "GET /recommendations/{store}/summary", "method": "GET", "path": f"/recommendations/{store_id}/summary" if store_id else None, "tables": ["store_recommendation_summary", "stores"]},
        {"name": "GET /seasonality/l2_categories", "method": "GET", "path": "/seasonality/l2_categories", "tables": ["seasonality_l2_list"]},
        {"name": "GET /seasonality/{category}", "method": "GET", "path": f"/seasonality/{l2_category}" if l2_category else None, "tables": ["seasonality_category"]},
        {"name": "GET /forecast/simulate", "method": "GET", "path": f"/forecast/simulate?store_id={store_id}&sku_code={sku_code}&month=6&discount_pct=10" if store_id and sku_code else None, "tables": ["simulation_history"]},
        {"name": "POST /ai/insight/dashboard", "method": "POST", "path": "/ai/insight/dashboard", "tables": ["ai_insights"]},
        {"name": "POST /ai/insight/store", "method": "POST", "path": f"/ai/insight/store/{store_id}" if store_id else None, "tables": ["ai_insights"]},
        {"name": "POST /ai/insight/cluster", "method": "POST", "path": f"/ai/insight/cluster/{cluster_id}", "tables": ["ai_insights"]},
        {"name": "POST /ai/insight/forecast", "method": "POST", "path": "/ai/insight/forecast", "tables": ["ai_insights"]},
        {"name": "POST /ai/chat", "method": "POST", "path": "/ai/chat", "tables": ["chat_history"], "json": {"messages": [{"role": "user", "content": "Hello"}]}},
        {"name": "POST /ai/explain/recommendation", "method": "POST", "path": "/ai/explain/recommendation", "tables": ["ai_explanations"], "json": {"store_id": store_id, "sku_code": sku_code}},
    ]

    report: list[dict[str, Any]] = []
    failures = 0

    for case in cases:
        path = case["path"]
        if not path:
            report.append({**case, "skipped": True, "reason": "missing sample data"})
            continue

        before = _counts(engine)
        if case["method"] == "GET":
            resp = client.get(path)
        else:
            resp = client.post(path, json=case.get("json") or {})

        api_ok = resp.status_code < 400
        after = _counts(engine)
        sync_log = _latest_sync_log(engine, path.split("?")[0])

        table_deltas = {t: _delta(before, after, t) for t in case["tables"]}
        sync_ok = bool(api_ok and sync_log and sync_log["status"] == "success")
        rows_changed = any(v > 0 for v in table_deltas.values())
        upsert_only = any(
            t in ("analytics_snapshots", "dashboard_summary", "seasonality_l2_list", "ai_insights", "ai_explanations", "seasonality_category", "store_recommendation_summary")
            for t in case["tables"]
        )
        verified = sync_ok and (rows_changed or upsert_only or sync_log.get("records_affected", 0) > 0)
        if api_ok and not verified:
            failures += 1

        report.append(
            {
                "endpoint": case["name"],
                "path": path,
                "api_status": resp.status_code,
                "api_ok": api_ok,
                "target_tables": case["tables"],
                "rows_delta": table_deltas,
                "sync_status": sync_log["status"] if sync_log else "no_log",
                "records_affected": sync_log["records_affected"] if sync_log else 0,
                "sync_error": sync_log.get("error_message") if sync_log else None,
                "sync_ok": sync_ok,
                "verified": verified,
            }
        )

    print(json.dumps(report, indent=2, default=str))
    print(f"\nTotal cases: {len(report)}")
    print(f"Sync failures (API ok but sync not success): {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
