"""Gemini-backed structured insights for RECAI (requires GOOGLE_API_KEY)."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import google.generativeai as genai
from dotenv import load_dotenv

_RECAI_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_RECAI_ROOT / ".env", override=True)

DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")


def _ensure_configured() -> None:
    key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError(
            "Missing GOOGLE_API_KEY (or GEMINI_API_KEY) in environment / .env"
        )
    genai.configure(api_key=key)


def generate_json_insight(
    system: str,
    user_payload: dict[str, Any],
    *,
    temperature: float = 0.35,
) -> dict[str, Any]:
    """
    Ask Gemini to return **only** JSON with keys:
    insight, key_points, trends, forecast_note, risks, opportunities, next_actions
    """
    _ensure_configured()
    model = genai.GenerativeModel(DEFAULT_MODEL)
    prompt = f"""{system}

You must respond with a single JSON object only, no markdown fences.
Schema:
{{
  "insight": "string — 2-4 sentences executive summary",
  "key_points": ["string", ...],
  "trends": ["string", ...],
  "forecast_note": "string — what may happen next based on numbers",
  "risks": ["string", ...],
  "opportunities": ["string", ...],
  "next_actions": ["string", ...]
}}

Data (JSON):
{json.dumps(user_payload, indent=2, default=str)}
"""
    resp = model.generate_content(
        prompt,
        generation_config={
            "temperature": temperature,
            "response_mime_type": "application/json",
        },
    )
    text = (resp.text or "").strip()
    return _parse_json_loose(text)


def chat_reply(
    messages: list[dict[str, str]],
    context_blob: str,
    *,
    temperature: float = 0.4,
) -> str:
    """Single-turn style: last user message + context."""
    _ensure_configured()
    model = genai.GenerativeModel(DEFAULT_MODEL)
    history = "\n".join(
        f"{m.get('role', 'user').upper()}: {m.get('content', '')}" for m in messages[-8:]
    )
    prompt = f"""You are an assistant for a retail recommendation & forecasting system.

Rules:
- The JSON in Context is loaded from the user's pipeline (stores, clusters, forecast). It is authoritative.
- Section "chat_hints" includes clusters_ranked_lowest_avg_confidence_first, smallest_clusters_by_store_count,
  suggested_attention_cluster_id, and suggested_attention_reason — use these to answer which cluster needs attention.
- Use "summary" for network totals, source mix, and uplift. Use "forecast_context" for confidence and risk posture.
- If has_recommendations_file is true and cluster lists are present, you MUST answer from those numbers.
  Do not reply with "I do not have the data" for cluster or network questions unless the context is empty or explicitly says files are missing.
- You may add brief, clearly labeled operational interpretation (e.g. why low confidence might matter), but do not invent metrics not shown in Context.

Be concise (short bullets ok). No made-up numbers.

Context:
{context_blob}

Conversation:
{history}

Answer the user's last question helpfully."""
    resp = model.generate_content(
        prompt,
        generation_config={"temperature": temperature},
    )
    return (resp.text or "").strip()


def generate_text(
    system: str,
    user_payload: dict[str, Any],
    *,
    temperature: float = 0.35,
) -> str:
    """Plain-text answer (e.g. 'why this recommendation')."""
    _ensure_configured()
    model = genai.GenerativeModel(DEFAULT_MODEL)
    prompt = f"""{system}

Data (JSON):
{json.dumps(user_payload, indent=2, default=str)}
"""
    resp = model.generate_content(
        prompt,
        generation_config={"temperature": temperature},
    )
    return (resp.text or "").strip()


def _parse_json_loose(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return {
        "insight": text[:2000],
        "key_points": [],
        "trends": [],
        "forecast_note": "",
        "risks": [],
        "opportunities": [],
        "next_actions": [],
    }
