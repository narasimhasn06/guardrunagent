from __future__ import annotations

import hashlib
import hmac

from app.config import get_settings


def hash_api_key(plaintext_key: str) -> str:
    """Deterministic, fast, keyed hash for API key storage and lookup.

    Not bcrypt/argon2 (docs/03-low-level-design.md Section 7's suggested
    examples): those are deliberately slow to resist brute-forcing a
    human-guessable secret, which costs real latency on every check --
    measured at ~270ms per `bcrypt.checkpw` call on ordinary hardware.
    That alone blows the guardrail-check path's 200ms p99 target
    (docs/05-architecture-document.md Section 6) before any rule matching
    or DB work happens, and app.auth.verify_api_key used to pay that cost
    once per *org* in a loop. GuardrunAgent's API keys
    (`secrets.token_urlsafe(32)`, 256 bits of entropy, generated in
    app/routers/settings.py) aren't guessable regardless of hash speed --
    a slow hash buys nothing here. HMAC-SHA256 keyed by a server-only
    pepper (API_KEY_PEPPER) is fast (microseconds) and still means a
    leaked `orgs.api_key_hash` value can't be turned back into the
    original key, or reused as a bearer credential, without also knowing
    the pepper.

    Deterministic output (unlike bcrypt's salted output) is the other
    deliberate trade-off here: it's what lets verify_api_key look a
    presented key up with a single indexed equality query instead of
    hashing it against every org's stored hash in turn.
    """
    pepper = get_settings().api_key_pepper.encode("utf-8")
    return hmac.new(pepper, plaintext_key.encode("utf-8"), hashlib.sha256).hexdigest()
