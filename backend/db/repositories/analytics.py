"""Analytics snapshot repository."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from db.repositories.base import to_json, upsert_json, upsert_row
from db.repositories.clusters import ClusterRepository


class AnalyticsRepository:
    def __init__(self) -> None:
        self._clusters = ClusterRepository()

    def sync_summary(self, session: Session, data: dict[str, Any]) -> int:
        upsert_json(
            session,
            table="dashboard_summary",
            key_col="snapshot_key",
            key_val="latest",
            payload=data,
        )
        return 1

    def sync_snapshot(
        self,
        session: Session,
        *,
        snapshot_key: str,
        endpoint: str,
        data: dict[str, Any] | list[Any],
    ) -> int:
        session.execute(
            text(
                """
                INSERT INTO analytics_snapshots (snapshot_key, endpoint, payload)
                VALUES (:snapshot_key, :endpoint, :payload)
                ON DUPLICATE KEY UPDATE
                  endpoint=VALUES(endpoint),
                  payload=VALUES(payload)
                """
            ),
            {
                "snapshot_key": snapshot_key,
                "endpoint": endpoint,
                "payload": to_json(data),
            },
        )
        return 1

    def sync_cluster_breakdown(self, session: Session, data: dict[str, Any]) -> int:
        count = self._clusters.sync_cluster_list(session, data.get("clusters") or [])
        count += self.sync_snapshot(
            session,
            snapshot_key="cluster_breakdown",
            endpoint="/analytics/cluster_breakdown",
            data=data,
        )
        return count

    def sync_cluster_profile(self, session: Session, data: dict[str, Any]) -> int:
        return self.sync_snapshot(
            session,
            snapshot_key="cluster_profile",
            endpoint="/analytics/cluster_profile",
            data=data,
        )

    def sync_forecast_context(self, session: Session, data: dict[str, Any]) -> int:
        return self.sync_snapshot(
            session,
            snapshot_key="forecast_context",
            endpoint="/analytics/forecast_context",
            data=data,
        )

    def sync_dashboard(self, session: Session, data: dict[str, Any]) -> int:
        return self.sync_snapshot(
            session,
            snapshot_key="dashboard",
            endpoint="/analytics/dashboard",
            data=data,
        )

    def sync_runtime_config(self, session: Session, data: dict[str, Any]) -> int:
        config = data.get("config", data)
        upsert_row(
            session,
            table="runtime_config",
            key_cols=["config_key"],
            row={"config_key": "effective", "config_value": to_json(config)},
        )
        return 1
