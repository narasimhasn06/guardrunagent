from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

ActionType = Literal["file_edit", "bash", "git", "api_call"]
EventStatus = Literal["success", "failure", "blocked", "flagged"]


class AgentEvent(BaseModel):
    id: UUID | None = None
    session_id: UUID | None = None
    org_id: UUID | None = None  # denormalized for fast org-scoped queries
    action_type: ActionType
    action_summary: str | None = None  # redacted/truncated description
    payload_meta: dict[str, Any] | None = None  # no raw secrets — SDK redacts client-side
    reasoning_snippet: str | None = None
    tokens_used: int = 0
    cost_usd: Decimal = Decimal("0")
    status: EventStatus
    matched_rule_id: UUID | None = None
    created_at: datetime | None = None
