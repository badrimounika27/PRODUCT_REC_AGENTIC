"""simulation_history repository (INSERT only)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from db.repositories.base import to_json


class SimulationRepository:
    def insert(self, session: Session, data: dict[str, Any]) -> int:
        session.execute(
            text(
                """
                INSERT INTO simulation_history
                  (store_id, sku_code, month, discount_pct, result)
                VALUES
                  (:store_id, :sku_code, :month, :discount_pct, :result)
                """
            ),
            {
                "store_id": str(data.get("store_id", "")),
                "sku_code": str(data.get("sku_code", "")),
                "month": int(data.get("month", 0)),
                "discount_pct": float(data.get("discount_pct", 0) or 0),
                "result": to_json(data),
            },
        )
        return 1
