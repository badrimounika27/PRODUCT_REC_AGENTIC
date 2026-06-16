"""Steps 4-6: FPG rules, popularity, ALS scores."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from typing import Any

import config as recai_config

from agents.base import PipelineStepAgent, count_csv_rows


class RecommendationAgent(PipelineStepAgent):
    name = "recommendation_agent"
    description = "Mines FPG rules, cluster popularity, and ALS scores"
    script_name = "04_fpg_model.py"
    output_relative = "outputs/als_scores.csv"

    _steps: tuple[tuple[str, str], ...] = (
        ("04_fpg_model.py", "outputs/fpg_rules.csv"),
        ("05_popularity_model.py", "outputs/popularity_scores.csv"),
        ("06_als_model.py", "outputs/als_scores.csv"),
    )

    def run(self, context: dict[str, Any]) -> dict[str, Any]:
        t0 = time.perf_counter()
        engine = recai_config.engine_root()
        env = os.environ.copy()
        backend = str(recai_config.BACKEND_ROOT)
        prev = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = backend + (f"{os.pathsep}{prev}" if prev else "")

        step_results: list[dict[str, Any]] = []
        for script, out_rel in self._steps:
            script_path = engine / "pipeline" / script
            if not script_path.is_file():
                return {
                    "status": "failed",
                    "agent_name": self.name,
                    "time_taken_seconds": round(time.perf_counter() - t0, 3),
                    "error": f"Missing script {script_path}",
                    "output_file": str(engine / out_rel),
                }
            proc = subprocess.run(
                [sys.executable, str(script_path)],
                cwd=str(engine),
                env=env,
                capture_output=True,
                text=True,
            )
            out_path = engine / out_rel
            row = {
                "script": script,
                "returncode": proc.returncode,
                "output_file": str(out_path),
                "rows_output": count_csv_rows(out_path),
                "stderr_tail": (proc.stderr or "")[-2000:],
            }
            step_results.append(row)
            if proc.returncode != 0:
                return {
                    "status": "failed",
                    "agent_name": self.name,
                    "time_taken_seconds": round(time.perf_counter() - t0, 3),
                    "output_file": str(out_path),
                    "error": proc.stderr or proc.stdout or f"{script} failed",
                    "steps": step_results,
                }

        elapsed = time.perf_counter() - t0
        return {
            "status": "success",
            "agent_name": self.name,
            "time_taken_seconds": round(elapsed, 3),
            "output_file": str(engine / "outputs/als_scores.csv"),
            "rows_output": count_csv_rows(engine / "outputs/als_scores.csv"),
            "summary": {"steps": step_results},
            "fpg_rules_path": str(engine / "outputs/fpg_rules.csv"),
            "popularity_scores_path": str(engine / "outputs/popularity_scores.csv"),
            "als_scores_path": str(engine / "outputs/als_scores.csv"),
        }

    def build_context_update(self, result: dict[str, Any]) -> dict[str, Any]:
        return {
            "fpg_rules_path": result.get("fpg_rules_path"),
            "popularity_scores_path": result.get("popularity_scores_path"),
            "als_scores_path": result.get("als_scores_path"),
        }
