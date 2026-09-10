from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

Role = Literal["admin", "member"]


class OrgMember(BaseModel):
    id: UUID | None = None
    org_id: UUID | None = None
    auth_user_id: UUID  # references auth.users(id), managed by Supabase Auth
    email: str
    role: Role = "member"
    created_at: datetime | None = None
