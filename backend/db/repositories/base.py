"""Shared repository helpers."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def to_json(value: Any) -> str:
    return json.dumps(value, default=str)


def upsert_json(
    session: Session,
    *,
    table: str,
    key_col: str,
    key_val: str,
    payload: dict[str, Any],
    extra_cols: dict[str, Any] | None = None,
) -> int:
    cols = {key_col: key_val, "payload": to_json(payload)}
    if extra_cols:
        cols.update(extra_cols)
    col_names = ", ".join(cols.keys())
    placeholders = ", ".join(f":{k}" for k in cols.keys())
    updates = ", ".join(
        f"{k}=VALUES({k})" for k in cols.keys() if k != key_col
    )
    sql = (
        f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) "
        f"ON DUPLICATE KEY UPDATE {updates}"
    )
    session.execute(text(sql), cols)
    return 1


def upsert_row(
    session: Session,
    *,
    table: str,
    key_cols: list[str],
    row: dict[str, Any],
) -> int:
    cols = list(row.keys())
    col_names = ", ".join(cols)
    placeholders = ", ".join(f":{c}" for c in cols)
    updates = ", ".join(f"{c}=VALUES({c})" for c in cols if c not in key_cols)
    if not updates:
        updates = ", ".join(f"{k}=VALUES({k})" for k in key_cols)
    sql = (
        f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) "
        f"ON DUPLICATE KEY UPDATE {updates}"
    )
    session.execute(text(sql), row)
    return 1
