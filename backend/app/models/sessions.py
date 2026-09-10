from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

SessionStatus = Literal["active", "completed", "error"]


class Session(BaseModel):
    id: UUID | None = None
    org_id: UUID | None = None
    agent_name: str  # e.g. 'claude-code'
    project_label: str | None = None
    started_at: datetime
    ended_at: datetime | None = None
    total_cost_usd: Decimal = Decimal("0")
    total_tokens: int = 0
    status: SessionStatus = "active"
