"""
Process-local, mtime-keyed CSV cache.

Loading pipeline output CSVs (``recommendations_final.csv``, ``clustered_data.csv``, etc.)
from disk on every request is the main source of "first-load-is-slow, next-loads-are-fast"
behavior for our API. This cache keeps parsed DataFrames alive between requests and
invalidates automatically when the underlying file is rewritten by a new pipeline run
(``st_mtime`` changes).

Usage
-----
    from api.csv_cache import read_csv_cached
    df = read_csv_cached(path)                            # full frame
    df = read_csv_cached(path, usecols=["STORE_ID"])      # column-subset frame

Notes
-----
* Returns a **shallow copy** of the cached DataFrame. Column-level assignments in
  callers (``df[col] = ...``) mutate their local copy but do NOT affect the cached
  entry. In-place mutations of underlying column data (``df[col].iloc[0] = ...``)
  would leak, but the codebase does not do that.
* Cache key = (absolute path, mtime, sorted usecols tuple). Different ``usecols``
  requests are cached separately so a small "columns" read does not force us to
  keep the whole wide frame.
* Thread-safe via a single RLock (all endpoints are IO-bound; a lock here is
  cheap compared to a fresh 800 MB CSV parse).
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional, Sequence

import pandas as pd

_lock = threading.RLock()
_cache: dict[tuple[str, float, Optional[tuple[str, ...]]], pd.DataFrame] = {}


def _key(path: Path, usecols: Optional[Sequence[str]]) -> tuple[str, float, Optional[tuple[str, ...]]]:
    mtime = path.stat().st_mtime
    cols_key = tuple(sorted(usecols)) if usecols else None
    return (str(path.resolve()), mtime, cols_key)


def read_csv_cached(
    path: Path,
    *,
    usecols: Optional[Sequence[str]] = None,
    low_memory: bool = False,
) -> pd.DataFrame:
    """Return a shallow copy of a cached DataFrame. First call reads from disk; later
    calls hit the cache until ``path``'s mtime changes.

    Raises
    ------
    FileNotFoundError
        If ``path`` does not exist on disk (caller decides how to surface).
    """
    if not path.is_file():
        raise FileNotFoundError(str(path))

    key = _key(path, usecols)

    with _lock:
        cached = _cache.get(key)
        if cached is not None:
            return cached.copy(deep=False)

    # Read outside the lock so we don't block other threads on I/O.
    if usecols is not None:
        df = pd.read_csv(path, usecols=list(usecols), low_memory=low_memory)
    else:
        df = pd.read_csv(path, low_memory=low_memory)

    with _lock:
        # Re-check inside the lock to avoid double-caching under a race.
        existing = _cache.get(key)
        if existing is None:
            _drop_older_signatures_locked(str(path.resolve()), key[1])
            _cache[key] = df
        else:
            df = existing
    return df.copy(deep=False)


def _drop_older_signatures_locked(abs_path: str, current_mtime: float) -> None:
    """Evict entries for this path whose mtime is older than ``current_mtime``.
    Runs while holding ``_lock``.
    """
    stale_keys = [k for k in _cache if k[0] == abs_path and k[1] < current_mtime]
    for k in stale_keys:
        _cache.pop(k, None)


def clear_cache() -> None:
    """Wipe the entire in-memory cache. Only intended for tests / manual triggers."""
    with _lock:
        _cache.clear()


def cache_stats() -> dict[str, object]:
    """Lightweight introspection for /api/health/cache and warmup verification."""
    with _lock:
        entries = [
            {
                "path": k[0],
                "mtime": k[1],
                "usecols": list(k[2]) if k[2] else None,
                "rows": int(len(v)),
                "cols": int(len(v.columns)),
            }
            for k, v in _cache.items()
        ]
    return {"entries": len(entries), "files": entries}
