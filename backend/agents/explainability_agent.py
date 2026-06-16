"""Step 12: explainability column."""

from __future__ import annotations

from typing import Any

from agents.base import PipelineStepAgent


class ExplainabilityAgent(PipelineStepAgent):
    name = "explainability_agent"
    description = "Adds explainability text to recommendations"
    script_name = "12_explainability.py"
    output_relative = "outputs/recommendations_with_explainability.csv"

    def build_context_update(self, result: dict[str, Any]) -> dict[str, Any]:
        return {"recommendations_explain_path": result.get("output_file")}
