"""stores repository."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from db.repositories.base import upsert_row


class StoreRepository:
    def _upsert_store(self, session: Session, store_id: str) -> None:
        session.execute(
            text(
                "INSERT INTO stores (store_id) VALUES (:store_id) "
                "ON DUPLICATE KEY UPDATE "
                "store_id=VALUES(store_id), synced_at=CURRENT_TIMESTAMP"
            ),
            {"store_id": str(store_id)},
        )

    def sync_store_list(self, session: Session, data: dict[str, Any]) -> int:
        stores = data.get("stores") or []
        for store_id in stores:
            self._upsert_store(session, str(store_id))
        return len(stores)

    def sync_spend_history(
        self, session: Session, store_id: str, data: dict[str, Any]
    ) -> int:
        if not data.get("available", True):
            return 0
        series = data.get("series") or []
        count = 0
        for point in series:
            upsert_row(
                session,
                table="store_spend_history",
                key_cols=["store_id", "period"],
                row={
                    "store_id": str(store_id),
                    "period": str(point.get("period", "")),
                    "spend": float(point.get("spend", 0) or 0),
                },
            )
            count += 1
        return count

    def ensure_store(self, session: Session, store_id: str) -> None:
        self._upsert_store(session, store_id)
