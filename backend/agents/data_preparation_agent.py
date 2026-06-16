"""Step 1: raw → cleaned_data.csv"""

from __future__ import annotations

from typing import Any

from agents.base import PipelineStepAgent


class DataPreparationAgent(PipelineStepAgent):
    name = "data_preparation_agent"
    description = "Cleans and prepares raw transaction data"
    script_name = "01_data_prep.py"
    output_relative = "outputs/cleaned_data.csv"

    def build_context_update(self, result: dict[str, Any]) -> dict[str, Any]:
        return {"cleaned_data_path": result.get("output_file")}
