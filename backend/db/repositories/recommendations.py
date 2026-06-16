"""recommendations and SKU repository."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from db.repositories.base import upsert_row
from db.repositories.stores import StoreRepository


def _row_from_rec(rec: dict[str, Any], store_id: str | None = None) -> dict[str, Any]:
    sid = store_id or str(rec.get("STORE_ID", rec.get("store_id", "")))
    return {
        "store_id": sid,
        "sku_code": str(rec.get("SKU_CODE", rec.get("sku_code", ""))),
        "cluster_id": int(rec["CLUSTER_ID"]) if rec.get("CLUSTER_ID") is not None else None,
        "product_name": str(rec.get("PRODUCT_NAME", rec.get("product_name", "")) or ""),
        "category": str(rec.get("CATEGORY", rec.get("category", "")) or "") or None,
        "l2_category": str(rec.get("L2_CATEGORY", rec.get("l2_category", "")) or "") or None,
        "source": str(rec.get("SOURCE", rec.get("source", "")) or "") or None,
        "confidence": float(rec["CONFIDENCE"]) if rec.get("CONFIDENCE") is not None else None,
        "explainability": str(rec.get("EXPLAINABILITY", rec.get("explainability", "")) or "")
        or None,
        "forecasted_amt": float(rec["FORECASTED_AMT"])
        if rec.get("FORECASTED_AMT") is not None
        else None,
        "seasonality_multiplier": float(rec["SEASONAL_MULTIPLIER"])
        if rec.get("SEASONAL_MULTIPLIER") is not None
        else None,
        "forecasted_amt_after_seasonality": float(rec["FORECASTED_AMT_AFTER_SEASONALITY"])
        if rec.get("FORECASTED_AMT_AFTER_SEASONALITY") is not None
        else None,
        "promotional_multiplier": float(rec["PROMOTIONAL_MULTIPLIER"])
        if rec.get("PROMOTIONAL_MULTIPLIER") is not None
        else None,
        "final_adjusted_amt": float(rec["FINAL_ADJUSTED_AMT"])
        if rec.get("FINAL_ADJUSTED_AMT") is not None
        else None,
        "max_list_price": float(rec["MAX_LIST_PRICE"])
        if rec.get("MAX_LIST_PRICE") is not None
        else None,
        "volume": int(rec["VOLUME"]) if rec.get("VOLUME") is not None else None,
        "rank_position": int(rec["RANK"]) if rec.get("RANK") is not None else None,
    }


class RecommendationRepository:
    def __init__(self) -> None:
        self._stores = StoreRepository()

    def sync_skus(self, session: Session, data: dict[str, Any]) -> int:
        count = 0
        for sku in data.get("skus") or []:
            upsert_row(
                session,
                table="skus",
                key_cols=["sku_code"],
                row={
                    "sku_code": str(sku.get("SKU_CODE", sku.get("sku_code", ""))),
                    "product_name": str(
                        sku.get("PRODUCT_NAME", sku.get("product_name", "")) or ""
                    ),
                    "l2_category": None,
                    "category": None,
                },
            )
            count += 1
        return count

    def sync_store_recommendations(
        self, session: Session, store_id: str, data: dict[str, Any]
    ) -> int:
        self._stores.ensure_store(session, store_id)
        count = 0
        for rec in data.get("recommendations") or []:
            row = _row_from_rec(rec, store_id=store_id)
            if not row["sku_code"]:
                continue
            upsert_row(
                session,
                table="recommendations",
                key_cols=["store_id", "sku_code"],
                row=row,
            )
            count += 1
        return count

    def sync_by_sku(self, session: Session, data: dict[str, Any]) -> int:
        sku_code = str(data.get("sku_code", ""))
        upsert_row(
            session,
            table="skus",
            key_cols=["sku_code"],
            row={
                "sku_code": sku_code,
                "product_name": str(data.get("product_name", "") or ""),
                "l2_category": str(data.get("l2_category", "") or "") or None,
                "category": None,
            },
        )
        count = 1
        for rec in data.get("recommendations") or []:
            row = _row_from_rec(rec)
            if not row["store_id"]:
                row["store_id"] = str(rec.get("STORE_ID", ""))
            self._stores.ensure_store(session, row["store_id"])
            upsert_row(
                session,
                table="recommendations",
                key_cols=["store_id", "sku_code"],
                row=row,
            )
            count += 1
        return count

    def sync_store_summary(
        self, session: Session, store_id: str, data: dict[str, Any]
    ) -> int:
        self._stores.ensure_store(session, store_id)
        upsert_row(
            session,
            table="store_recommendation_summary",
            key_cols=["store_id"],
            row={
                "store_id": str(store_id),
                "cluster_id": int(data["cluster_id"]) if data.get("cluster_id") is not None else None,
                "total_recommendations": int(data.get("total_recommendations", 0) or 0),
                "top_confidence": float(data["top_confidence"])
                if data.get("top_confidence") is not None
                else None,
                "total_estimated_amount": float(data["total_estimated_amount"])
                if data.get("total_estimated_amount") is not None
                else None,
                "total_volume": int(data["total_volume"])
                if data.get("total_volume") is not None
                else None,
            },
        )
        return 1
