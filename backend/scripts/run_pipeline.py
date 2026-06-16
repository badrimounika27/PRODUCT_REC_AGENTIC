"""
Run all 13 recommendation pipeline steps in order from backend/.

Resolves to backend/ root (parent of scripts/) and invokes each step in
backend/pipeline/. Outputs land in backend/outputs/.
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
    (1, "01_data_prep.py", "outputs/cleaned_data.csv"),
    (2, "02_feature_engineering.py", "outputs/featured_data.csv"),
    (3, "03_clustering.py", "outputs/clustered_data.csv"),
    (4, "04_fpg_model.py", "outputs/fpg_rules.csv"),
    (5, "05_popularity_model.py", "outputs/popularity_scores.csv"),
    (6, "06_als_model.py", "outputs/als_scores.csv"),
    (7, "07_post_processing.py", "outputs/recommendations_raw.csv"),
    (8, "08_amount_forecasting.py", "outputs/recommendations_with_amounts.csv"),
    (9, "09_seasonality.py", "outputs/recommendations_with_seasonality.csv"),
    (10, "10_promotional_adjustment.py", "outputs/recommendations_with_promotions.csv"),
    (11, "11_volume_forecasting.py", "outputs/recommendations_with_volume.csv"),
    (12, "12_explainability.py", "outputs/recommendations_with_explainability.csv"),
    (13, "13_final_output.py", "outputs/recommendations_final.csv"),
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
    for step, script, out_rel in STEPS:
        t0 = time.perf_counter()
        print(f"Running Step {step} — {script}...")
        src_path = ROOT / "pipeline" / script
        env = os.environ.copy()
        prev = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = str(ROOT) if not prev else f"{ROOT}{os.pathsep}{prev}"
        proc = subprocess.run(
            [sys.executable, str(src_path)],
            cwd=str(ROOT),
            env=env,
            capture_output=True,
            text=True,
        )
        elapsed = time.perf_counter() - t0
        if proc.returncode != 0:
            print(proc.stdout, end="")
            print(proc.stderr, end="")
            print(f"Pipeline failed at Step {step} ({script}).")
            sys.exit(1)
        if proc.stdout:
            print(proc.stdout, end="")
        out_path = ROOT / out_rel
        rows = _count_data_rows(out_path)
        print(f"Done — {rows} rows output — Time: {elapsed:.1f}s")

    final_path = ROOT / "outputs" / "recommendations_final.csv"
    print()
    print("Pipeline complete.")
    print(f"Output: {final_path}")


if __name__ == "__main__":
    main()
