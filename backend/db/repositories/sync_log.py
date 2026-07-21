"""api_sync_log repository."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session


class SyncLogRepository:
    def insert(
        self,
        session: Session,
        *,
        endpoint: str,
        method: str,
        status: str,
        records_affected: int = 0,
        error_message: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        session.execute(
            text(
                """
                INSERT INTO api_sync_log
                  (endpoint, method, status, records_affected, error_message, duration_ms)
                VALUES
                  (:endpoint, :method, :status, :records_affected, :error_message, :duration_ms)
                """
            ),
            {
                "endpoint": endpoint,
                "method": method,
                "status": status,
                "records_affected": records_affected,
                "error_message": error_message,
                "duration_ms": duration_ms,
            },
        )
