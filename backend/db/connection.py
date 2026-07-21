"""SQLAlchemy engine, session factory, and schema bootstrap for local MySQL."""

from __future__ import annotations

import logging
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator, Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from db.config import db_settings

logger = logging.getLogger(__name__)

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None
_schema_ready = False

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def is_db_enabled() -> bool:
    return db_settings().MYSQL_ENABLED


def get_engine() -> Engine | None:
    global _engine
    if not is_db_enabled():
        return None
    if _engine is None:
        settings = db_settings()
        _engine = create_engine(
            settings.sqlalchemy_url,
            pool_pre_ping=True,
            pool_recycle=3600,
            future=True,
        )
    return _engine


def get_session_factory() -> sessionmaker[Session] | None:
    global _SessionLocal
    engine = get_engine()
    if engine is None:
        return None
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return _SessionLocal


@contextmanager
def get_session() -> Generator[Session | None, None, None]:
    factory = get_session_factory()
    if factory is None:
        yield None
        return
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _split_sql_statements(sql_text: str) -> list[str]:
    """Split schema.sql into executable statements (skip comments)."""
    cleaned: list[str] = []
    for raw in sql_text.splitlines():
        line = raw.strip()
        if not line or line.startswith("--"):
            continue
        cleaned.append(line)
    blob = "\n".join(cleaned)
    parts = re.split(r";\s*\n", blob)
    return [p.strip() for p in parts if p.strip()]


def _quote_ident(name: str) -> str:
    """Quote a MySQL identifier; only allow safe database names from env."""
    if not re.fullmatch(r"[A-Za-z0-9_]+", name or ""):
        raise ValueError(
            f"Invalid MYSQL_DATABASE {name!r}: use letters, digits, and underscores only"
        )
    return f"`{name}`"


def init_schema() -> dict[str, Any]:
    """Apply schema.sql to the database named in MYSQL_DATABASE. Safe on startup."""
    global _schema_ready
    if not is_db_enabled():
        return {"ok": False, "skipped": True, "reason": "MYSQL_ENABLED=false"}
    if not SCHEMA_PATH.is_file():
        return {"ok": False, "error": f"schema.sql not found at {SCHEMA_PATH}"}

    from urllib.parse import quote_plus

    settings = db_settings()
    try:
        db_ident = _quote_ident(settings.MYSQL_DATABASE)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    user = quote_plus(settings.MYSQL_USER)
    password = quote_plus(settings.MYSQL_PASSWORD)
    bootstrap_url = (
        f"mysql+pymysql://{user}:{password}"
        f"@{settings.MYSQL_HOST}:{settings.MYSQL_PORT}/?charset=utf8mb4"
    )
    bootstrap_engine = create_engine(bootstrap_url, pool_pre_ping=True, future=True)
    sql_text = SCHEMA_PATH.read_text(encoding="utf-8")
    statements = _split_sql_statements(sql_text)
    executed = 0
    try:
        with bootstrap_engine.connect() as conn:
            # Database name comes from backend/.env — never hardcode credentials or DB name here.
            conn.execute(
                text(
                    f"CREATE DATABASE IF NOT EXISTS {db_ident} "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            )
            conn.execute(text(f"USE {db_ident}"))
            executed += 2
            for stmt in statements:
                conn.execute(text(stmt))
                executed += 1
            conn.commit()
        _schema_ready = True
        return {
            "ok": True,
            "database": settings.MYSQL_DATABASE,
            "statements_executed": executed,
        }
    except Exception as exc:
        logger.warning("MySQL schema init skipped: %s", exc)
        return {"ok": False, "error": str(exc), "statements_executed": executed}
    finally:
        bootstrap_engine.dispose()


def check_connection() -> dict[str, Any]:
    """Ping local MySQL and report database/table status."""
    settings = db_settings()
    if not is_db_enabled():
        return {
            "enabled": False,
            "connected": False,
            "host": settings.MYSQL_HOST,
            "port": settings.MYSQL_PORT,
            "database": settings.MYSQL_DATABASE,
        }
    engine = get_engine()
    if engine is None:
        return {"enabled": True, "connected": False, "error": "engine not created"}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            tables = conn.execute(
                text(
                    "SELECT TABLE_NAME FROM information_schema.TABLES "
                    "WHERE TABLE_SCHEMA = :db ORDER BY TABLE_NAME"
                ),
                {"db": settings.MYSQL_DATABASE},
            ).fetchall()
        return {
            "enabled": True,
            "connected": True,
            "host": settings.MYSQL_HOST,
            "port": settings.MYSQL_PORT,
            "database": settings.MYSQL_DATABASE,
            "table_count": len(tables),
            "tables": [row[0] for row in tables],
            "schema_ready": _schema_ready,
        }
    except Exception as exc:
        return {
            "enabled": True,
            "connected": False,
            "host": settings.MYSQL_HOST,
            "port": settings.MYSQL_PORT,
            "database": settings.MYSQL_DATABASE,
            "error": str(exc),
        }


def list_required_tables() -> list[str]:
    return [
        "api_sync_log",
        "runtime_config",
        "stores",
        "clusters",
        "cluster_stores",
        "cluster_top_skus",
        "skus",
        "recommendations",
        "store_recommendation_summary",
        "dashboard_summary",
        "analytics_snapshots",
        "store_spend_history",
        "seasonality_category",
        "seasonality_l2_list",
        "ai_insights",
        "ai_explanations",
        "chat_history",
        "simulation_history",
    ]
