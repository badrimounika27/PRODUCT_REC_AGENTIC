"""chat_history repository (INSERT only)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from db.repositories.base import to_json


class ChatRepository:
    def insert(
        self,
        session: Session,
        *,
        messages: list[dict[str, Any]],
        reply: str,
    ) -> int:
        session.execute(
            text(
                "INSERT INTO chat_history (messages, reply) VALUES (:messages, :reply)"
            ),
            {"messages": to_json(messages), "reply": reply},
        )
        return 1
