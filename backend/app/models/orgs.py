from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class Org(BaseModel):
    id: UUID | None = None
    name: str
    api_key_hash: str
    slack_webhook_url: str | None = None
    created_at: datetime | None = None
