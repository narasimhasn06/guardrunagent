from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class GuardrailActivity(BaseModel):
    id: UUID | None = None
    rule_id: UUID | None = None
    event_id: UUID | None = None
    org_id: UUID | None = None
    fired_at: datetime | None = None
    alert_sent: bool = False
