"""FastAPI middleware that mirrors successful JSON API responses into MySQL."""

from __future__ import annotations

import json
import logging
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from db.sync_service import should_sync_path, sync_api_response

logger = logging.getLogger(__name__)


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

        try:
            sync_api_response(
                method=request.method,
                path=path,
                status_code=response.status_code,
                payload=payload,
            )
        except Exception:
            logger.exception("Unexpected error in DbSyncMiddleware for %s", path)

        headers = dict(response.headers)
        headers.pop("content-length", None)
        return Response(
            content=body,
            status_code=response.status_code,
            headers=headers,
            media_type=response.media_type,
        )
