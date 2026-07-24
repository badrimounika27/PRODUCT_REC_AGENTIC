"""FastAPI middleware that mirrors successful JSON API responses into MySQL.

The DB write is dispatched to a bounded background thread pool AFTER the HTTP
response has been fully returned to the client. This is important because some
endpoints (e.g. ``/stores`` → 11k+ UPSERTs, ``/recommendations/by_sku`` → 600+)
would otherwise block the response for many seconds and make navigation feel
slow.

Design notes
------------
* Executor is capped at ``_MAX_WORKERS`` threads. If more sync tasks arrive than
  workers, they queue (which is what we want — we never drop audit data).
* Failures are logged but never propagate; the HTTP response has already been
  sent by then.
* ``sync_api_response`` itself opens a fresh SQLAlchemy session, so there is no
  session-sharing hazard across threads.
"""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from db.sync_service import should_sync_path, sync_api_response

logger = logging.getLogger(__name__)

_MAX_WORKERS = 4
_executor = ThreadPoolExecutor(max_workers=_MAX_WORKERS, thread_name_prefix="db-sync")


def _submit_sync(method: str, path: str, status_code: int, payload: Any) -> None:
    """Schedule a background sync; swallow submission errors defensively."""

    def _run() -> None:
        try:
            sync_api_response(
                method=method,
                path=path,
                status_code=status_code,
                payload=payload,
            )
        except Exception:  # pragma: no cover - defensive
            logger.exception("Background DB sync failed for %s %s", method, path)

    try:
        _executor.submit(_run)
    except RuntimeError:
        # Executor has been shut down (e.g. during test teardown). Ignore.
        pass


class DbSyncMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_body: bytes = b""
        if request.method in ("POST", "PUT", "PATCH"):
            request_body = await request.body()

            async def receive() -> dict:
                return {"type": "http.request", "body": request_body, "more_body": False}

            request = Request(request.scope, receive)

        response = await call_next(request)

        path = request.url.path
        if response.status_code >= 400 or not should_sync_path(path):
            return response

        body = b""
        async for chunk in response.body_iterator:
            body += chunk

        payload: object = None
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type and body:
            try:
                payload = json.loads(body.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                payload = None

        if payload is not None and request_body and path == "/ai/chat":
            try:
                req = json.loads(request_body.decode("utf-8"))
                if isinstance(payload, dict) and isinstance(req, dict):
                    payload = {**payload, "_request_messages": req.get("messages", [])}
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

        if payload is not None and request_body and path == "/ai/explain/recommendation":
            try:
                req = json.loads(request_body.decode("utf-8"))
                if isinstance(payload, dict) and isinstance(req, dict):
                    payload = {
                        **payload,
                        "_request_store_id": req.get("store_id"),
                        "_request_sku_code": req.get("sku_code"),
                    }
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

        # Fire-and-forget: sync runs on the thread pool AFTER the client has
        # received the response body. This is the single biggest UX win for
        # navigation — pages no longer wait for MySQL UPSERT batches.
        if payload is not None:
            _submit_sync(
                method=request.method,
                path=path,
                status_code=response.status_code,
                payload=payload,
            )

        headers = dict(response.headers)
        headers.pop("content-length", None)
        return Response(
            content=body,
            status_code=response.status_code,
            headers=headers,
            media_type=response.media_type,
        )
