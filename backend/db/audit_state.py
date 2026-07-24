"""One-shot database health & activity audit for local MySQL (intellirec)."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv

load_dotenv(BACKEND_ROOT / ".env", override=True)

from sqlalchemy import create_engine, text

from db.config import db_settings
from db.connection import list_required_tables


def main() -> int:
    settings = db_settings()
    engine = create_engine(settings.sqlalchemy_url)

    with engine.connect() as conn:
        print("=" * 78)
        print(f" DATABASE STATE AUDIT — {settings.MYSQL_DATABASE} @ "
              f"{settings.MYSQL_HOST}:{settings.MYSQL_PORT}")
        print("=" * 78)

        print("\n[1] Row counts per table (with last activity timestamp)\n")
        tables = list_required_tables()
        print(f"  {'table':<32}  {'rows':>10}  {'last_activity':<22}")
        print(f"  {'-' * 32}  {'-' * 10}  {'-' * 22}")
        time_col_map = {
            "chat_history": "created_at",
            "simulation_history": "created_at",
            "runtime_config": "updated_at",
        }
        for t in tables:
            time_col = time_col_map.get(t, "synced_at")
            row = conn.execute(
                text(f"SELECT COUNT(*), MAX({time_col}) FROM {t}")
            ).fetchone()
            count, last = row[0], row[1]
            print(f"  {t:<32}  {count:>10}  {str(last or '-'):<22}")

        print("\n[2] Recent sync activity (last 15 entries in api_sync_log)\n")
        rows = conn.execute(
            text(
                """
                SELECT endpoint, method, status, records_affected,
                       duration_ms, error_message, synced_at
                FROM api_sync_log
                ORDER BY id DESC
                LIMIT 15
                """
            )
        ).fetchall()
        if not rows:
            print("  (no sync log entries yet — hit some endpoints first)")
        else:
            print(f"  {'endpoint':<45}  {'method':<6}  {'status':<8}  {'rows':>5}  "
                  f"{'ms':>5}  {'when':<20}")
            print(f"  {'-' * 45}  {'-' * 6}  {'-' * 8}  {'-' * 5}  {'-' * 5}  {'-' * 20}")
            for r in rows:
                ep, mth, st, rec, dur, err, when = r
                print(f"  {(ep or '')[:45]:<45}  {mth:<6}  {st:<8}  "
                      f"{rec or 0:>5}  {dur or 0:>5}  {str(when)[:19]:<20}")
                if err:
                    print(f"    ↳ ERROR: {err[:200]}")

        print("\n[3] Errors in api_sync_log (all-time)\n")
        errs = conn.execute(
            text(
                """
                SELECT endpoint, error_message, synced_at
                FROM api_sync_log
                WHERE status = 'error'
                ORDER BY id DESC
                LIMIT 10
                """
            )
        ).fetchall()
        if not errs:
            print("  No error rows in sync log.")
        else:
            for ep, err, when in errs:
                print(f"  [{when}] {ep}")
                print(f"    {err[:300]}")

        print("\n[4] Endpoint sync summary (aggregate over api_sync_log)\n")
        agg = conn.execute(
            text(
                """
                SELECT endpoint,
                       COUNT(*) AS calls,
                       SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS ok,
                       SUM(CASE WHEN status='error'   THEN 1 ELSE 0 END) AS bad,
                       MAX(synced_at) AS last_call
                FROM api_sync_log
                GROUP BY endpoint
                ORDER BY last_call DESC
                LIMIT 30
                """
            )
        ).fetchall()
        if not agg:
            print("  (empty)")
        else:
            print(f"  {'endpoint':<48}  {'calls':>5}  {'ok':>4}  {'err':>4}  {'last':<20}")
            print(f"  {'-' * 48}  {'-' * 5}  {'-' * 4}  {'-' * 4}  {'-' * 20}")
            for ep, calls, ok, bad, last in agg:
                print(f"  {(ep or '')[:48]:<48}  {calls:>5}  {ok:>4}  {bad:>4}  "
                      f"{str(last)[:19]:<20}")

        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
