"""Parent portal auth: scrypt password verification (matching the desktop's
`electron/server/parents.py`-style hash), phone normalisation, and HMAC-signed
session tokens (no external JWT dependency)."""
import base64
import hashlib
import hmac
import json
import os
import re
import time

SECRET = os.environ.get("PORTAL_SECRET", "dev-portal-secret-change-me").encode()

# scrypt cost params matching Node's crypto.scryptSync defaults (N=16384,r=8,p=1).
_N, _R, _P, _DKLEN = 16384, 8, 1, 64
_MAXMEM = 64 * 1024 * 1024


def verify_password(password: str, stored: str) -> bool:
    if not stored or not str(stored).startswith("scrypt$"):
        return False
    try:
        _, salt, expected = str(stored).split("$")
        derived = hashlib.scrypt(
            str(password).encode(), salt=salt.encode(),
            n=_N, r=_R, p=_P, dklen=_DKLEN, maxmem=_MAXMEM,
        ).hex()
    except Exception:
        return False
    return hmac.compare_digest(derived, expected)


def hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    derived = hashlib.scrypt(
        str(password).encode(), salt=salt.encode(),
        n=_N, r=_R, p=_P, dklen=_DKLEN, maxmem=_MAXMEM,
    ).hex()
    return f"scrypt${salt}${derived}"


def norm_phone(raw: str) -> str:
    s = re.sub(r"[^\d+]", "", str(raw or ""))
    if not s:
        return ""
    if s.startswith("+"):
        s = s[1:]
    if s.startswith("00"):
        s = s[2:]
    if s.startswith("0"):
        s = "233" + s[1:]
    elif len(s) == 9:
        s = "233" + s
    return s


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def sign_token(payload: dict, ttl_seconds: int = 7 * 24 * 3600) -> str:
    body = {**payload, "exp": int(time.time()) + ttl_seconds}
    data = _b64url(json.dumps(body, separators=(",", ":")).encode())
    sig = _b64url(hmac.new(SECRET, data.encode(), hashlib.sha256).digest())
    return f"{data}.{sig}"


def verify_token(token: str):
    if not token or "." not in token:
        return None
    data, sig = token.split(".", 1)
    expected = _b64url(hmac.new(SECRET, data.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        body = json.loads(_b64url_decode(data))
    except Exception:
        return None
    if not body.get("exp") or body["exp"] < int(time.time()):
        return None
    return body
