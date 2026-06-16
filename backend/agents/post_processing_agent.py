"""Step 7: merge sources into recommendations_raw.csv"""

from __future__ import annotations

from typing import Any

from agents.base import PipelineStepAgent


class PostProcessingAgent(PipelineStepAgent):
    name = "post_processing_agent"
    description = "Merges FPG, popularity, and ALS into ranked raw recommendations"
    script_name = "07_post_processing.py"
    output_relative = "outputs/recommendations_raw.csv"

    def build_context_update(self, result: dict[str, Any]) -> dict[str, Any]:
        return {"recommendations_raw_path": result.get("output_file")}
