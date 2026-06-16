"""Master controller: runs pipeline agents in order (only this module invokes other agents)."""

from __future__ import annotations

import time
import uuid
from typing import Any, Callable, Type

from agents.clustering_agent import ClusteringAgent
from agents.data_preparation_agent import DataPreparationAgent
from agents.explainability_agent import ExplainabilityAgent
from agents.feature_engineering_agent import FeatureEngineeringAgent
from agents.forecasting_agent import ForecastingAgent
from agents.output_agent import OutputAgent
from agents.post_processing_agent import PostProcessingAgent
from agents.recommendation_agent import RecommendationAgent


class OrchestratorAgent:
    name = "orchestrator_agent"
    description = "Controls the full recommendation pipeline execution order"

    _order: tuple[Type[Any], ...] = (
        DataPreparationAgent,
        FeatureEngineeringAgent,
        ClusteringAgent,
        RecommendationAgent,
        PostProcessingAgent,
        ForecastingAgent,
        ExplainabilityAgent,
        OutputAgent,
    )

    def run_full_pipeline(
        self,
        initial_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        run_id = str(uuid.uuid4())
        t_all = time.perf_counter()
        ctx: dict[str, Any] = dict(initial_context or {})
        ctx["run_id"] = run_id
        pipeline_results: dict[str, Any] = {}

        for cls in self._order:
            agent = cls()
            runner: Callable[[dict[str, Any]], dict[str, Any]] = getattr(
                agent, "run"
            )
            result = runner(ctx)
            pipeline_results[agent.name] = result
            ctx[agent.name] = result

            if result.get("status") != "success":
                return {
                    "status": "failed",
                    "run_id": run_id,
                    "failed_at": agent.name,
                    "error": result.get("error", "unknown"),
                    "pipeline_results": pipeline_results,
                    "time_taken_seconds": round(time.perf_counter() - t_all, 3),
                }

            updater = getattr(agent, "build_context_update", None)
            if callable(updater):
                ctx.update(updater(result))

        return {
            "status": "success",
            "run_id": run_id,
            "pipeline_results": pipeline_results,
            "time_taken_seconds": round(time.perf_counter() - t_all, 3),
            "context": {k: v for k, v in ctx.items() if not k.endswith("_path")},
        }

    def run_single_agent(
        self,
        agent_name: str,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        ctx = dict(context or {})
        t0 = time.perf_counter()
        for cls in self._order:
            inst = cls()
            if inst.name != agent_name:
                continue
            result = inst.run(ctx)
            result["run_single_seconds"] = round(time.perf_counter() - t0, 3)
            return result
        return {
            "status": "failed",
            "agent_name": agent_name,
            "time_taken_seconds": round(time.perf_counter() - t0, 3),
            "error": f"Unknown agent: {agent_name}",
        }

    @classmethod
    def agent_class_map(cls) -> dict[str, Type[Any]]:
        return {getattr(c, "name", c.__name__): c for c in cls._order}
