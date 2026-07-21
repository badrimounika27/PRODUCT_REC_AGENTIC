"""CLI verification for local MySQL setup and API sync."""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv

load_dotenv(BACKEND_ROOT / ".env", override=True)

from db.connection import check_connection, init_schema, list_required_tables
from db.sync_service import sync_api_response


def main() -> int:
    print("=== Local MySQL verification ===\n")

    init_result = init_schema()
    print("Schema init:", json.dumps(init_result, indent=2))

    status = check_connection()
    print("\nConnection:", json.dumps(status, indent=2))

    if not status.get("connected"):
        print("\nMySQL is not reachable. Ensure local MySQL is running and .env is configured.")
        return 1

    required = set(list_required_tables())
    present = set(status.get("tables") or [])
    missing = required - present
    if missing:
        print(f"\nMissing tables: {sorted(missing)}")
        return 1

    print("\nAll required tables exist.")

    # Dry-run sync with sample payload (no API server required)
    sync_api_response(
        method="GET",
        path="/stores",
        status_code=200,
        payload={"stores": ["TEST_STORE"], "total": 1},
    )
    print("Sample sync for GET /stores completed (see api_sync_log).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
