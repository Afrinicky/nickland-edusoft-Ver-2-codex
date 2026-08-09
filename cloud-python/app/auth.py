"""Per-school API key helpers (parity with the Node cloud)."""
import hashlib
import secrets


def gen_key() -> str:
    return "sk_" + secrets.token_urlsafe(24)


def hash_key(key: str) -> str:
    return hashlib.sha256(str(key).encode()).hexdigest()
