"""
Run all B2C pipeline steps in order.

Isolated from the B2B pipeline (`run_pipeline.py`): outputs land under
backend/outputs/b2c/ and no B2B artifacts are touched.

Usage (from backend/):
    ..\backend\.venv\Scripts\python.exe scripts\run_b2c_pipeline.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # backend/

# (step_number, script_name, output_csv_relative_to_root)
STEPS: list[tuple[int, str, str]] = [
    (1, "b2c_01_customer_features.py",   "outputs/b2c/customer_features.csv"),
    (2, "b2c_02_customer_clustering.py", "outputs/b2c/customer_clusters.csv"),
    (3, "b2c_03_funnel_metrics.py",      "outputs/b2c/funnel_metrics.csv"),
    (4, "b2c_04_bundles.py",             "outputs/b2c/bundles.csv"),
    (5, "b2c_05_next_best_offer.py",     "outputs/b2c/next_best_offers.csv"),
]


def _count_data_rows(csv_path: Path) -> int:
    if not csv_path.is_file():
        return 0
    n = 0
    with csv_path.open(encoding="utf-8", errors="replace") as f:
        for i, _ in enumerate(f):
            if i == 0:
                continue
            n += 1
    return n


def main() -> None:
    print("=" * 60)
    print("B2C Pipeline (Flavor A)")
    print("=" * 60)

    total_t0 = time.perf_counter()
    for step, script, out_rel in STEPS:
        print()
        print(f"--- Step {step}: {script} ---")
        src_path = ROOT / "pipeline" / script
        env = os.environ.copy()
        prev = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = str(ROOT) if not prev else f"{ROOT}{os.pathsep}{prev}"

        t0 = time.perf_counter()
        proc = subprocess.run(
            [sys.executable, str(src_path)],
            cwd=str(ROOT),
            env=env,
            capture_output=True,
            text=True,
        )
        elapsed = time.perf_counter() - t0
        if proc.stdout:
            print(proc.stdout.rstrip())
        if proc.returncode != 0:
            if proc.stderr:
                print(proc.stderr.rstrip())
            print(f"[FAIL] Step {step} ({script}) failed after {elapsed:.1f}s")
            sys.exit(1)
        out_path = ROOT / out_rel
        rows = _count_data_rows(out_path)
        print(f"[OK] step {step}  rows={rows:,}  time={elapsed:.1f}s")

    total_elapsed = time.perf_counter() - total_t0
    print()
    print("=" * 60)
    print(f"B2C pipeline complete in {total_elapsed:.1f}s")
    print("=" * 60)
    print("Artifacts:")
    for _, _, out_rel in STEPS:
        p = ROOT / out_rel
        marker = "OK " if p.is_file() else "-- "
        print(f"  {marker} {out_rel}")


if __name__ == "__main__":
    main()
