"""
Smoke-test the /api/b2c/* endpoints via FastAPI's TestClient.

Runs in-process (no uvicorn needed) so it's fast and CI-friendly.

Usage (from backend/):
    ..\backend\.venv\Scripts\python.exe scripts\smoke_test_b2c_api.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from api.main import app  # noqa: E402

client = TestClient(app)


def _short(payload) -> str:
    """Truncate JSON for readable console output."""
    s = json.dumps(payload, default=str)
    return s if len(s) < 260 else s[:257] + "..."


def _check(name: str, path: str, expected_keys: list[str]) -> bool:
    r = client.get(path)
    status = r.status_code
    ok = status == 200
    body: dict = {}
    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text[:200]}
    missing = [k for k in expected_keys if k not in body] if isinstance(body, dict) else []
    if missing:
        ok = False

    tag = "[OK]" if ok else "[FAIL]"
    print(f"{tag} GET {path}  status={status}  missing_keys={missing}")
    print(f"      body: {_short(body)}")
    return ok


def main() -> None:
    results = []
    print("=" * 70)
    print("B2C API smoke tests")
    print("=" * 70)

    results.append(_check(
        "summary",
        "/api/b2c/summary",
        ["users", "buyers", "buy_count", "segments"],
    ))
    results.append(_check(
        "segments",
        "/api/b2c/segments",
        ["segments"],
    ))
    results.append(_check(
        "customers-list",
        "/api/b2c/customers?limit=3&segment=3",
        ["total", "customers"],
    ))

    # Pick one user id from the list response and drill in
    r = client.get("/api/b2c/customers?limit=1")
    user_id: int | None = None
    if r.status_code == 200:
        js = r.json()
        if js["customers"]:
            user_id = int(js["customers"][0]["user_id"])
    if user_id is not None:
        results.append(_check(
            f"customers/{user_id}",
            f"/api/b2c/customers/{user_id}",
            ["found", "user_id", "cluster_id", "features"],
        ))
    else:
        print("[WARN] no user_id available for detail test")

    results.append(_check("segments/0", "/api/b2c/segments/0", ["found", "cluster_persona", "profile"]))
    results.append(_check("funnel", "/api/b2c/funnel", ["overall", "by_date", "top_categories"]))
    results.append(_check("bundles", "/api/b2c/bundles?limit=5", ["total", "bundles"]))

    print()
    passed = sum(results)
    total = len(results)
    print(f"Result: {passed}/{total} endpoints OK")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
