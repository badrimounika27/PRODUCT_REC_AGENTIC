"""Step 2: cleaned → featured_data.csv"""

from __future__ import annotations

from typing import Any

from agents.base import PipelineStepAgent


class FeatureEngineeringAgent(PipelineStepAgent):
    name = "feature_engineering_agent"
    description = "Builds store-level features from the cleaned window"
    script_name = "02_feature_engineering.py"
    output_relative = "outputs/featured_data.csv"

    def build_context_update(self, result: dict[str, Any]) -> dict[str, Any]:
        return {"featured_data_path": result.get("output_file")}
