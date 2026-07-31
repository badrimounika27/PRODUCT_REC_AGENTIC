"""
Sample the raw Taobao UserBehavior.csv down to a manageable size for the B2C pipeline.

Approach
--------
1. Randomly sample N distinct `user_id` values from the raw file.
2. Keep ALL rows for those sampled users (so every user has their complete history).
3. Write the result to a new CSV with a proper header row.

Sampling is done by user (not by row) because behavioral features (RFM,
funnel, sequences, ALS) require each user's full event stream.

Backed by DuckDB so the 3.5 GB raw file is never fully loaded into RAM.

Usage (from `backend/`)
-----------------------
    ..\backend\.venv\Scripts\python.exe scripts\sample_user_behavior.py
    ..\backend\.venv\Scripts\python.exe scripts\sample_user_behavior.py --users 200000
    ..\backend\.venv\Scripts\python.exe scripts\sample_user_behavior.py --users 50000 --min-events 5

Defaults
--------
    --users       50000
    --seed        42
    --min-events  0        (0 = no filter; set to e.g. 5 to drop tiny users)
    --input       backend/data/raw/UserBehavior.csv
    --output      backend/data/raw/user_behavior_sampled_<users>k.csv
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import duckdb

# backend/ project root (this file lives at backend/scripts/)
BACKEND_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = BACKEND_ROOT / "data" / "raw" / "UserBehavior.csv"
COLUMNS = ["user_id", "item_id", "category_id", "behavior", "timestamp"]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sample Taobao UserBehavior.csv by user.")
    p.add_argument("--users", type=int, default=50_000,
                   help="Number of distinct users to sample (default: 50000)")
    p.add_argument("--seed", type=int, default=42,
                   help="Random seed for reproducibility (default: 42)")
    p.add_argument("--min-events", type=int, default=0,
                   help="After sampling, drop users with fewer than N events. "
                        "0 = keep all (default: 0)")
    p.add_argument("--input", type=Path, default=DEFAULT_INPUT,
                   help=f"Path to raw UserBehavior.csv (default: {DEFAULT_INPUT})")
    p.add_argument("--output", type=Path, default=None,
                   help="Output CSV path (default: same folder as input, "
                        "named user_behavior_sampled_<users>k.csv)")
    return p.parse_args()


def human_size(path: Path) -> str:
    if not path.exists():
        return "-"
    size = path.stat().st_size
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def main() -> int:
    args = parse_args()

    if not args.input.is_file():
        print(f"ERROR: input file not found: {args.input}", file=sys.stderr)
        return 1

    users_label = f"{args.users // 1000}k" if args.users % 1000 == 0 else str(args.users)
    output = args.output or (args.input.parent / f"user_behavior_sampled_{users_label}.csv")
    output.parent.mkdir(parents=True, exist_ok=True)

    print(f"Input   : {args.input}  ({human_size(args.input)})")
    print(f"Output  : {output}")
    print(f"Users   : {args.users:,}")
    print(f"Seed    : {args.seed}")
    print(f"Min ev  : {args.min_events}")
    print()

    con = duckdb.connect()
    # deterministic sampling
    con.execute(f"SELECT setseed({args.seed / 100.0})")

    # DuckDB reads the CSV lazily — no full load into RAM.
    # `columns={...}` supplies both names AND types (mutually exclusive with `names=`).
    con.execute(f"""
        CREATE VIEW raw AS
        SELECT * FROM read_csv(
            '{args.input.as_posix()}',
            header=false,
            columns={{
                'user_id':'INTEGER',
                'item_id':'INTEGER',
                'category_id':'INTEGER',
                'behavior':'VARCHAR',
                'timestamp':'BIGINT'
            }}
        )
    """)

    # Pass 1: quick totals (~1-2 min on 3.5 GB)
    t0 = time.time()
    print("[1/3] Counting rows and unique users in the raw file ...")
    total_rows, total_users = con.execute(
        "SELECT COUNT(*), COUNT(DISTINCT user_id) FROM raw"
    ).fetchone()
    print(f"      raw rows       : {total_rows:,}")
    print(f"      raw users      : {total_users:,}")
    print(f"      elapsed        : {time.time()-t0:.1f}s")

    if args.users > total_users:
        print(f"WARN: requested {args.users:,} users but raw only has {total_users:,}. "
              f"Sampling all {total_users:,}.", file=sys.stderr)
        n_users = total_users
    else:
        n_users = args.users

    # Pass 2: pick user IDs and materialise them once
    t0 = time.time()
    print(f"[2/3] Sampling {n_users:,} distinct users ...")
    con.execute(f"""
        CREATE TEMP TABLE sampled_users AS
        SELECT user_id FROM (SELECT DISTINCT user_id FROM raw)
        USING SAMPLE {n_users} ROWS
    """)
    picked = con.execute("SELECT COUNT(*) FROM sampled_users").fetchone()[0]
    print(f"      picked users   : {picked:,}")
    print(f"      elapsed        : {time.time()-t0:.1f}s")

    # Optional min-events filter
    min_events = args.min_events
    if min_events > 0:
        print(f"      filtering to users with >= {min_events} events ...")
        con.execute(f"""
            CREATE TEMP TABLE eligible_users AS
            SELECT s.user_id
            FROM sampled_users s
            JOIN raw r USING(user_id)
            GROUP BY s.user_id
            HAVING COUNT(*) >= {min_events}
        """)
        remaining = con.execute("SELECT COUNT(*) FROM eligible_users").fetchone()[0]
        print(f"      after filter   : {remaining:,} users")
        user_table = "eligible_users"
    else:
        user_table = "sampled_users"

    # Pass 3: stream out only the rows for sampled users
    t0 = time.time()
    print(f"[3/3] Writing sampled CSV to {output.name} ...")
    con.execute(f"""
        COPY (
            SELECT r.user_id, r.item_id, r.category_id, r.behavior, r.timestamp
            FROM raw r
            JOIN {user_table} u USING(user_id)
            ORDER BY r.user_id, r.timestamp
        )
        TO '{output.as_posix()}'
        (HEADER, DELIMITER ',')
    """)
    print(f"      elapsed        : {time.time()-t0:.1f}s")

    # Post-run stats
    print()
    from datetime import datetime, timezone
    stats = con.execute(f"""
        SELECT
            COUNT(*)                   AS rows,
            COUNT(DISTINCT user_id)    AS users,
            COUNT(DISTINCT item_id)    AS items,
            COUNT(DISTINCT category_id) AS categories,
            MIN(timestamp)             AS first_ts,
            MAX(timestamp)             AS last_ts
        FROM read_csv_auto('{output.as_posix()}')
    """).fetchone()
    rows, users, items, cats, first_ts, last_ts = stats
    first_ev = datetime.fromtimestamp(int(first_ts), tz=timezone.utc)
    last_ev = datetime.fromtimestamp(int(last_ts), tz=timezone.utc)
    behaviors = con.execute(f"""
        SELECT behavior, COUNT(*) c
        FROM read_csv_auto('{output.as_posix()}')
        GROUP BY behavior ORDER BY c DESC
    """).fetchall()

    print("---------- SAMPLE STATS ----------")
    print(f"file size        : {human_size(output)}")
    print(f"rows             : {rows:,}")
    print(f"unique users     : {users:,}")
    print(f"unique items     : {items:,}")
    print(f"unique categories: {cats:,}")
    print(f"date range       : {first_ev}  ->  {last_ev}")
    print("event breakdown  :")
    for beh, c in behaviors:
        pct = 100.0 * c / rows if rows else 0
        print(f"  {beh:<5s} {c:>12,}  ({pct:5.2f}%)")
    print("----------------------------------")
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
