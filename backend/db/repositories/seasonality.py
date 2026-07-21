"""Seasonality repository."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from db.repositories.base import to_json, upsert_row


class SeasonalityRepository:
    def sync_category(self, session: Session, data: dict[str, Any]) -> int:
        category = str(data.get("category", ""))
        upsert_row(
            session,
            table="seasonality_category",
            key_cols=["category"],
            row={
                "category": category,
                "multipliers": to_json(data.get("multipliers") or {}),
                "best_month": int(data["best_month"]) if data.get("best_month") is not None else None,
                "worst_month": int(data["worst_month"])
                if data.get("worst_month") is not None
                else None,
                "data_years_available": int(data["data_years_available"])
                if data.get("data_years_available") is not None
                else None,
                "history_span_years": float(data["history_span_years"])
                if data.get("history_span_years") is not None
                else None,
            },
        )
        return 1

    def sync_l2_categories(self, session: Session, data: dict[str, Any]) -> int:
        upsert_row(
            session,
            table="seasonality_l2_list",
            key_cols=["snapshot_key"],
            row={
                "snapshot_key": "latest",
                "categories": to_json(data.get("categories") or []),
            },
        )
        return 1
