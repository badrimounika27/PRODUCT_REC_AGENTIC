"""clusters repository."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from db.repositories.base import upsert_row
from db.repositories.stores import StoreRepository


class ClusterRepository:
    def __init__(self) -> None:
        self._stores = StoreRepository()

    def sync_cluster_list(self, session: Session, rows: list[dict[str, Any]]) -> int:
        count = 0
        for row in rows:
            upsert_row(
                session,
                table="clusters",
                key_cols=["cluster_id"],
                row={
                    "cluster_id": int(row["cluster_id"]),
                    "store_count": int(row.get("store_count", 0)),
                },
            )
            count += 1
        return count

    def sync_cluster_detail(
        self, session: Session, data: dict[str, Any]
    ) -> int:
        cluster_id = int(data["cluster_id"])
        upsert_row(
            session,
            table="clusters",
            key_cols=["cluster_id"],
            row={
                "cluster_id": cluster_id,
                "store_count": int(data.get("store_count", 0)),
            },
        )
        count = 1
        for store_id in data.get("stores") or []:
            self._stores.ensure_store(session, str(store_id))
            upsert_row(
                session,
                table="cluster_stores",
                key_cols=["cluster_id", "store_id"],
                row={"cluster_id": cluster_id, "store_id": str(store_id)},
            )
            count += 1
        for idx, sku in enumerate(data.get("top_recommended_skus") or [], start=1):
            upsert_row(
                session,
                table="cluster_top_skus",
                key_cols=["cluster_id", "rank_position"],
                row={
                    "cluster_id": cluster_id,
                    "rank_position": idx,
                    "sku_code": str(sku.get("SKU_CODE", sku.get("sku_code", ""))),
                    "product_name": str(
                        sku.get("PRODUCT_NAME", sku.get("product_name", "")) or ""
                    ),
                    "recommendation_count": int(sku.get("count", 0) or 0),
                },
            )
            count += 1
        return count
