"""
Background warmup for pipeline data caches.

The first request to ``/analytics/dashboard`` triggers a fresh parse of
``transactions.csv`` (~850 MB) plus ``featured_data.csv`` (~4 MB) — that single
parse is the dominant contributor to the "first Dashboard load is slow" symptom.
Similar (smaller) reads happen on the first ``/clusters``, ``/stores``, and
``/summary`` calls.

To eliminate the perceived delay we do all of these reads once, in a background
thread, immediately after uvicorn starts. The server itself is ready to accept
connections instantly; by the time the user has finished the login form the
analytics cache is warm and the first Dashboard render is fast.

Failures during warmup are logged but never propagate — the server still works,
just with the old lazy behavior for the endpoint that failed.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

_state: dict[str, Any] = {
    "started_at": None,
    "finished_at": None,
    "duration_seconds": None,
    "status": "not_started",  # not_started | running | ok | partial | error
    "steps": [],
}
_state_lock = threading.RLock()


def get_warmup_state() -> dict[str, Any]:
    with _state_lock:
        return {
            "status": _state["status"],
            "started_at": _state["started_at"],
            "finished_at": _state["finished_at"],
            "duration_seconds": _state["duration_seconds"],
            "steps": list(_state["steps"]),
        }


def _record_step(name: str, ok: bool, took_ms: float, error: str | None = None) -> None:
    with _state_lock:
        _state["steps"].append(
            {"name": name, "ok": ok, "took_ms": round(took_ms, 1), "error": error}
        )


def _run_step(name: str, fn: Callable[[], Any]) -> bool:
    start = time.perf_counter()
    try:
        fn()
        took = (time.perf_counter() - start) * 1000.0
        logger.info("warmup: %s ok in %.0f ms", name, took)
        _record_step(name, ok=True, took_ms=took)
        return True
    except Exception as exc:  # pragma: no cover - defensive
        took = (time.perf_counter() - start) * 1000.0
        logger.exception("warmup: %s failed after %.0f ms", name, took)
        _record_step(name, ok=False, took_ms=took, error=str(exc)[:300])
        return False


def _do_warmup(engine_root: Path) -> None:
    with _state_lock:
        _state["status"] = "running"
        _state["started_at"] = time.time()
        _state["steps"] = []

    from api.analytics import (
        compute_cluster_breakdown,
        compute_cluster_profile,
        compute_forecast_context,
        compute_summary,
    )
    from api.analytics_dashboard import compute_dashboard_analytics
    from api.csv_cache import read_csv_cached

    final_csv = engine_root / "outputs" / "recommendations_final.csv"
    clustered_csv = engine_root / "outputs" / "clustered_data.csv"

    ok_count = 0
    total = 0

    def _load_final() -> None:
        if final_csv.is_file():
            read_csv_cached(final_csv)

    def _load_clustered() -> None:
        if clustered_csv.is_file():
            read_csv_cached(clustered_csv)

    steps: list[tuple[str, Callable[[], Any]]] = [
        ("recommendations_final.csv", _load_final),
        ("clustered_data.csv", _load_clustered),
        ("summary", lambda: compute_summary(engine_root)),
        ("cluster_breakdown", lambda: compute_cluster_breakdown(engine_root)),
        ("cluster_profile", lambda: compute_cluster_profile(engine_root)),
        ("forecast_context", lambda: compute_forecast_context(engine_root)),
        ("dashboard_analytics", lambda: compute_dashboard_analytics(engine_root)),
    ]

    for name, fn in steps:
        total += 1
        if _run_step(name, fn):
            ok_count += 1

    duration = time.time() - (_state["started_at"] or time.time())
    with _state_lock:
        _state["finished_at"] = time.time()
        _state["duration_seconds"] = round(duration, 2)
        if ok_count == total:
            _state["status"] = "ok"
        elif ok_count == 0:
            _state["status"] = "error"
        else:
            _state["status"] = "partial"

    logger.info(
        "warmup: %d/%d steps ok in %.2fs (status=%s)",
        ok_count,
        total,
        duration,
        _state["status"],
    )


def start_warmup(engine_root: Path) -> threading.Thread:
    """Kick off warmup in a daemon thread. Returns the thread (mostly for tests)."""
    with _state_lock:
        if _state["status"] == "running":
            logger.info("warmup: already running, skipping duplicate start")
            return threading.current_thread()

    t = threading.Thread(
        target=_do_warmup,
        args=(engine_root,),
        name="recai-warmup",
        daemon=True,
    )
    t.start()
    return t
