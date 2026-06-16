"""Step 13: final column selection and sort."""

from __future__ import annotations

from typing import Any

from agents.base import PipelineStepAgent


class OutputAgent(PipelineStepAgent):
    name = "output_agent"
    description = "Produces recommendations_final.csv and prints summary stats"
    script_name = "13_final_output.py"
    output_relative = "outputs/recommendations_final.csv"

    def build_context_update(self, result: dict[str, Any]) -> dict[str, Any]:
        return {"recommendations_final_path": result.get("output_file")}
