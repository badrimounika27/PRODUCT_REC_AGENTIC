"""Pipeline agents and orchestrator (REC AI)."""

from __future__ import annotations

from agents.clustering_agent import ClusteringAgent
from agents.data_preparation_agent import DataPreparationAgent
from agents.explainability_agent import ExplainabilityAgent
from agents.feature_engineering_agent import FeatureEngineeringAgent
from agents.forecasting_agent import ForecastingAgent
from agents.orchestrator_agent import OrchestratorAgent
from agents.output_agent import OutputAgent
from agents.post_processing_agent import PostProcessingAgent
from agents.recommendation_agent import RecommendationAgent

AGENT_REGISTRY: list[dict[str, str]] = [
    {"name": DataPreparationAgent.name, "description": DataPreparationAgent.description},
    {"name": FeatureEngineeringAgent.name, "description": FeatureEngineeringAgent.description},
    {"name": ClusteringAgent.name, "description": ClusteringAgent.description},
    {"name": RecommendationAgent.name, "description": RecommendationAgent.description},
    {"name": PostProcessingAgent.name, "description": PostProcessingAgent.description},
    {"name": ForecastingAgent.name, "description": ForecastingAgent.description},
    {"name": ExplainabilityAgent.name, "description": ExplainabilityAgent.description},
    {"name": OutputAgent.name, "description": OutputAgent.description},
    {"name": OrchestratorAgent.name, "description": OrchestratorAgent.description},
]

__all__ = [
    "AGENT_REGISTRY",
    "OrchestratorAgent",
    "DataPreparationAgent",
    "FeatureEngineeringAgent",
    "ClusteringAgent",
    "RecommendationAgent",
    "PostProcessingAgent",
    "ForecastingAgent",
    "ExplainabilityAgent",
    "OutputAgent",
]
