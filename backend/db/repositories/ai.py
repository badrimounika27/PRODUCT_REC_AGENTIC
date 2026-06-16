"""AI insights and explanations repository."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from db.repositories.base import to_json, upsert_row


class AIRepository:
    def sync_insight(
        self,
        session: Session,
        *,
        insight_type: str,
        entity_id: str | None,
        data: dict[str, Any],
    ) -> int:
        key = f"{insight_type}:{entity_id or 'global'}"
        upsert_row(
            session,
            table="ai_insights",
            key_cols=["insight_key"],
            row={
                "insight_key": key,
                "insight_type": insight_type,
                "entity_id": entity_id,
                "payload": to_json(data.get("payload") or {}),
                "insight": to_json(data.get("insight") or {}),
            },
        )
        return 1

    def sync_explanation(
        self,
        session: Session,
        *,
        store_id: str,
        sku_code: str,
        explanation: str,
        recommendation: dict[str, Any] | None = None,
    ) -> int:
        upsert_row(
            session,
            table="ai_explanations",
            key_cols=["store_id", "sku_code"],
            row={
                "store_id": str(store_id),
                "sku_code": str(sku_code),
                "explanation": explanation,
                "recommendation": to_json(recommendation or {}),
            },
        )
        return 1
