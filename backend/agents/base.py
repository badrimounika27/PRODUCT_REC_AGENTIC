"""Shared helpers for pipeline step agents (subprocess → backend/pipeline)."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import config as recai_config


class PipelineStepAgent(ABC):
    """One pipeline step; orchestrator is the only caller."""

    name: str
    description: str
    script_name: str
    output_relative: str  # relative to backend/

    def run(self, context: dict[str, Any]) -> dict[str, Any]:
        t0 = time.perf_counter()
        engine = recai_config.engine_root()
        script = engine / "pipeline" / self.script_name
        if not script.is_file():
            return self._fail(
                f"Script not found: {script}", t0, engine
            )

        env = os.environ.copy()
        backend = str(recai_config.BACKEND_ROOT)
        prev = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = backend + (f"{os.pathsep}{prev}" if prev else "")

        proc = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(engine),
            env=env,
            capture_output=True,
            text=True,
        )
        elapsed = time.perf_counter() - t0
        out_path = engine / self.output_relative

        base = {
            "status": "success" if proc.returncode == 0 else "failed",
            "agent_name": self.name,
            "time_taken_seconds": round(elapsed, 3),
            "output_file": str(out_path),
            "stdout_tail": (proc.stdout or "")[-4000:],
            "stderr_tail": (proc.stderr or "")[-4000:],
        }

        if proc.returncode != 0:
            base["error"] = proc.stderr or proc.stdout or f"exit {proc.returncode}"
            return base

        rows = count_csv_rows(out_path)
        base["rows_output"] = rows
        base["summary"] = {
            "output_relative": self.output_relative,
            "rows": rows,
        }
        return base

    def _fail(self, msg: str, t0: float, engine: Path) -> dict[str, Any]:
        return {
            "status": "failed",
            "agent_name": self.name,
            "time_taken_seconds": round(time.perf_counter() - t0, 3),
            "output_file": str(engine / self.output_relative),
            "error": msg,
        }

    @abstractmethod
    def build_context_update(self, result: dict[str, Any]) -> dict[str, Any]:
        """Keys merged into orchestrator context after success."""


def count_csv_rows(path: Path) -> int:
    if not path.is_file():
        return 0
    n = 0
    try:
        with path.open(encoding="utf-8", errors="replace") as f:
            for i, _ in enumerate(f):
                if i == 0:
                    continue
                n += 1
    except OSError:
        return 0
    return n
