"""Gemini-backed structured insights for RECAI (requires GOOGLE_API_KEY)."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Callable

import google.generativeai as genai
from dotenv import load_dotenv

_RECAI_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_RECAI_ROOT / ".env", override=True)

DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")


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
    temperature: float = 0.3,
) -> str:
    """Single-turn style: last user message + context."""
    _ensure_configured()
    model = genai.GenerativeModel(DEFAULT_MODEL)
    history = "\n".join(
        f"{m.get('role', 'user').upper()}: {m.get('content', '')}" for m in messages[-8:]
    )
    prompt = f"""You are IntelliRecommend's retail decision-intelligence assistant.

CONTEXT SHAPE
The Context JSON has two sections:
  * network_context — aggregate summary, cluster breakdown, forecast context, chat hints.
    Use this for network-wide questions (totals, trends, cluster comparisons, forecast).
  * focused_context.entities_detected — {{stores, skus, clusters, categories}} auto-detected in the
    user's latest question (store IDs like S01001, SKU codes like MEN-OUT-JAC-002,
    "cluster N" / "CN" references, and known product categories).
  * focused_context.focused — the per-entity records fetched for those detected entities:
    focused.stores[]      → per-store record with top recommendations, cluster, category
                            counts, spend history.
    focused.skus[]        → per-SKU record with product name, category, per-cluster
                            recommendation counts, top stores.
    focused.clusters[]    → per-cluster record with store count, top category, profile
                            metrics, top recommended SKUs in that cluster.
    focused.by_category[] → per-category top recommended SKUs.

STRICT RULES
1. Ground every fact in Context. Never invent numbers or names not present.
2. If the user asks about a specific store / SKU / cluster / category:
   - If focused_context.focused has a record for it with "found": true, ANSWER from that record.
     Cite its numbers verbatim.
   - If focused_context.entities_detected lists the entity but the matching record has
     "found": false, reply exactly: "I couldn't find <entity> in the pipeline outputs — please
     double-check the ID."
   - If the user asked about a store/SKU/cluster but no entity was detected (e.g. "my store"),
     reply: "Please share the store ID (like S01001) so I can look it up — or open the
     Recommendations page and pick a store there."
3. For network-wide questions with no focused records, answer from network_context.
   If has_recommendations_file is true, do NOT reply "I don't have the data" — use the aggregates.
4. If the user asks something unrelated to this data (weather, news, general chit-chat),
   politely decline in one line and steer back to retail insights.
5. Do not extrapolate. You may add a brief operational note (1 line) after the numbers,
   but flag it as interpretation.

STYLE
- Reply in plain markdown. Use short headings (##) or **bold** for section markers when it aids scanning.
- Use bullet points for lists. Keep the whole reply under ~180 words unless the user asked for depth.
- Do not wrap the entire reply in a code block. Do not restate the user's question.
- Money values: format with thousands separators (e.g. $1,338,056,937 or $1.34B for very large amounts).
- Cite store IDs, cluster IDs and SKU codes exactly as they appear in Context.
- When helpful, finish with a single "Try next:" line suggesting one focused follow-up
  (e.g. "Try next: What's the top SKU in cluster 2?").

Context:
{context_blob}

Conversation:
{history}

Answer the user's latest question, obeying every STRICT RULE above."""
    resp = model.generate_content(
        prompt,
        generation_config={"temperature": temperature},
    )
    return (resp.text or "").strip()


# ---------------------------------------------------------------------------
# Chat with Gemini function-calling (Option 2 — tool use).
# ---------------------------------------------------------------------------


_CHAT_TOOLS_SYSTEM_INSTRUCTION = """You are IntelliRecommend's retail decision-intelligence assistant.

You have access to tools that look up per-store, per-SKU, per-cluster and
per-category data from the pipeline outputs. Prefer calling a tool whenever
the user's question is about a specific store, SKU, cluster or category —
do NOT answer from memory or extrapolate.

TOOL POLICY
- For a store question (mentions like "S01001"): call get_store_recommendations.
- For a SKU question (codes like "MEN-OUT-JAC-002"): call get_sku_placement.
- For a cluster question ("cluster 2", "C0"): call get_cluster_profile.
- For a category question ("Kids", "Men", "Women"): call top_skus_by_category.
- For "which stores are in cluster N": call list_stores_in_cluster.
- For multi-part questions ("compare S01000 and S01001") call the same tool
  multiple times, then answer once you have all the records.
- If a tool returns "found": false or "error": ..., say so plainly. Never
  invent numbers.

For truly network-wide questions (totals, averages, forecast, which cluster
needs attention), answer directly from the STARTING CONTEXT below — no tool
call needed.

STARTING CONTEXT (network aggregates):
{network_ctx}

REPLY STYLE
- Plain markdown, short headings (##) or **bold** where scannable.
- Bullet lists for enumerations. Money with thousands separators
  (e.g. $1,338,056,937 or $1.34B).
- Cite store IDs, cluster IDs and SKU codes exactly as returned by tools.
- If the user asked about a store/SKU/cluster but did NOT give an ID
  (e.g. "my store"), ask for it. Suggest opening the Recommendations page
  and picking a store there.
- Off-topic questions: politely decline in one line and steer back.
- Keep replies under ~180 words unless the user asked for depth.
- Do NOT wrap the whole reply in a code block. Do NOT restate the question.
- End with a single "Try next: ..." line suggesting one focused follow-up.
"""


def chat_reply_with_tools(
    messages: list[dict[str, str]],
    network_context: dict[str, Any],
    tools: list[Callable[..., Any]],
    *,
    temperature: float = 0.3,
    max_tool_calls: int = 8,
) -> tuple[str, list[dict[str, Any]]]:
    """Chat reply using Gemini function calling.

    The model may call any of the provided Python functions (bound with
    the correct engine root already). Automatic function calling is
    enabled, so the SDK handles the request/tool_response loop internally.

    Args:
        messages: OpenAI-style history [{role, content}, ...].
        network_context: dict of network-wide aggregates to seed the model.
        tools: list of bound Python functions Gemini can invoke.
        temperature: sampling temp (default 0.3 — grounded, low variance).
        max_tool_calls: safety cap on the auto function-call loop.

    Returns:
        (reply_text, tool_call_summary). tool_call_summary is a list of
        {"tool": name, "args": {...}} for every function actually invoked.
    """
    _ensure_configured()

    net_ctx_json = json.dumps(network_context, indent=2, default=str)[:20000]
    system_instruction = _CHAT_TOOLS_SYSTEM_INSTRUCTION.replace("{network_ctx}", net_ctx_json)

    model = genai.GenerativeModel(
        DEFAULT_MODEL,
        tools=tools,
        system_instruction=system_instruction,
        generation_config={"temperature": temperature},
    )

    # Convert prior turns to Gemini's chat history format.
    # Only keep the last few turns; the current user turn is sent separately.
    history: list[dict[str, Any]] = []
    prior = messages[-9:-1] if len(messages) > 1 else []
    for m in prior:
        role = str(m.get("role", "user")).lower()
        content = str(m.get("content") or "")
        if not content.strip():
            continue
        # Gemini expects role in {"user", "model"}.
        gemini_role = "model" if role == "assistant" else "user"
        history.append({"role": gemini_role, "parts": [content]})

    last_user = ""
    for m in reversed(messages):
        if str(m.get("role", "")).lower() == "user":
            last_user = str(m.get("content") or "")
            break
    if not last_user:
        return ("Please ask a question.", [])

    chat = model.start_chat(
        history=history,
        enable_automatic_function_calling=True,
    )
    response = chat.send_message(
        last_user,
        # Enforce a ceiling on automatic tool-call rounds.
        tool_config={
            "function_calling_config": {"mode": "AUTO"},
        },
    )

    # Extract summary of tool calls actually made, for observability.
    tool_calls_summary: list[dict[str, Any]] = []
    try:
        for content in chat.history:
            for part in getattr(content, "parts", []):
                fc = getattr(part, "function_call", None)
                if fc and getattr(fc, "name", None):
                    args = {}
                    try:
                        args = dict(fc.args) if fc.args else {}
                    except (TypeError, ValueError):
                        args = {}
                    tool_calls_summary.append({"tool": fc.name, "args": args})
                    if len(tool_calls_summary) >= max_tool_calls:
                        break
            if len(tool_calls_summary) >= max_tool_calls:
                break
    except Exception:
        pass

    text = ""
    try:
        text = (response.text or "").strip()
    except Exception:
        # If the final response was itself a function_call we couldn't
        # complete, fall back to the last text part in history.
        for content in reversed(chat.history):
            for part in getattr(content, "parts", []):
                t = getattr(part, "text", None)
                if t:
                    text = str(t).strip()
                    break
            if text:
                break

    return text, tool_calls_summary


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
