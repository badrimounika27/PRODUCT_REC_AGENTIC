"""
Optional Google ADK tool wrappers around the orchestrator.

ADK's LlmAgent expects model + tools; pipeline steps are deterministic subprocess
calls orchestrated in Python. These callables can be passed as FunctionTool(...) if
you add an LLM agent later.
"""

from __future__ import annotations

from typing import Any

from google.adk.tools import FunctionTool

from agents.orchestrator_agent import OrchestratorAgent


def run_full_recommendation_pipeline() -> dict[str, Any]:
    """Runs all pipeline agents in order via OrchestratorAgent."""
    return OrchestratorAgent().run_full_pipeline()


def build_pipeline_tools() -> list[FunctionTool]:
    return [FunctionTool(run_full_recommendation_pipeline)]
