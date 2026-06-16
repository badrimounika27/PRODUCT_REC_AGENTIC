"""Steps 8–11: amounts, seasonality, promotions, volume."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from typing import Any

import config as recai_config

from agents.base import count_csv_rows


class ForecastingAgent:
    name = "forecasting_agent"
    description = (
        "Forecasts amounts, applies seasonality, promotions, and volume"
    )

    _steps: tuple[tuple[str, str], ...] = (
        ("08_amount_forecasting.py", "outputs/recommendations_with_amounts.csv"),
        ("09_seasonality.py", "outputs/recommendations_with_seasonality.csv"),
        ("10_promotional_adjustment.py", "outputs/recommendations_with_promotions.csv"),
        ("11_volume_forecasting.py", "outputs/recommendations_with_volume.csv"),
    )

    def run(self, context: dict[str, Any]) -> dict[str, Any]:
        t0 = time.perf_counter()
        engine = recai_config.engine_root()
        env = os.environ.copy()
        backend = str(recai_config.BACKEND_ROOT)
        prev = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = backend + (f"{os.pathsep}{prev}" if prev else "")

        step_results: list[dict[str, Any]] = []
        last_out = ""
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
            last_out = str(out_path)
            step_results.append(
                {
                    "script": script,
                    "returncode": proc.returncode,
                    "output_file": last_out,
                    "rows_output": count_csv_rows(out_path),
                }
            )
            if proc.returncode != 0:
                return {
                    "status": "failed",
                    "agent_name": self.name,
                    "time_taken_seconds": round(time.perf_counter() - t0, 3),
                    "output_file": last_out,
                    "error": proc.stderr or proc.stdout or f"{script} failed",
                    "steps": step_results,
                }

        return {
            "status": "success",
            "agent_name": self.name,
            "time_taken_seconds": round(time.perf_counter() - t0, 3),
            "output_file": last_out,
            "rows_output": count_csv_rows(engine / "outputs/recommendations_with_volume.csv"),
            "summary": {"steps": step_results},
        }

    def build_context_update(self, result: dict[str, Any]) -> dict[str, Any]:
        return {"recommendations_volume_path": result.get("output_file")}
