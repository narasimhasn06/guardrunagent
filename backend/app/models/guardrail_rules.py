from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

PatternType = Literal["command_regex", "path_prefix", "action_type"]
ActionOnMatch = Literal["block", "flag"]


class GuardrailRule(BaseModel):
    id: UUID | None = None
    org_id: UUID | None = None
    name: str
    pattern_type: PatternType
    pattern_value: str  # e.g. '^rm -rf' or '/prod/config'
    action_on_match: ActionOnMatch
    enabled: bool = True
    created_at: datetime | None = None
