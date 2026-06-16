"""Step 3: featured → clustered_data.csv"""

from __future__ import annotations

from typing import Any

from agents.base import PipelineStepAgent


class ClusteringAgent(PipelineStepAgent):
    name = "clustering_agent"
    description = "Clusters stores on scaled features"
    script_name = "03_clustering.py"
    output_relative = "outputs/clustered_data.csv"

    def build_context_update(self, result: dict[str, Any]) -> dict[str, Any]:
        return {"clustered_data_path": result.get("output_file")}
