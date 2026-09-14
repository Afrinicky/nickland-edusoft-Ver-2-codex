"""The offline licence — what lets the desktop know it is still paid for.

The problem this solves, said plainly: **the desktop application is the source
of truth and it runs without the internet.** A school whose subscription has
lapsed could pull out the network cable and keep running it forever, and until
now nothing would have stopped them. The cloud portal and the parents' app are
gated at `school_api.require()`; the desktop was not gated at all.

It cannot be solved by asking the desktop nicely. Anything the desktop decides
for itself, somebody can change — a flag in its SQLite file is a flag a bursar
can edit. So the decision is made HERE, where the school has no access, and
travels to the desktop as a short-lived signed lease:

    school ──sync──► cloud ──► {school_id, access, features, not_after}
                                signed with a key the school does not have
                                          │
                                          ▼
                                 desktop verifies with the
                                 PUBLIC key built into the app

The desktop can read a lease and can refuse to honour one. It cannot write one,
because signing needs the private key and that never leaves this service. So a
school can go offline for as long as the lease lasts — a fortnight by default,
which covers a genuinely bad month of Ghanaian internet — and after that the
application asks for a fresh one. No payment, no fresh lease.

**What this deliberately is not.** It is not copy protection and it will not
stop somebody determined enough to patch the application's own JavaScript.
Nothing shipped to a customer's machine can. What it stops is the realistic
thing: a school that stops paying and simply stays offline, a database copied
to a second site, a clock wound back, a reinstall to start the trial again.
Every one of those is a business problem rather than an attack, and every one
of them is closed here.

**And it never destroys anything.** A lease that has run out drops the school
to read-only — every record readable, every report printable, every export
available, and not one new mark, payment or pupil. §11 says suspension must
never delete a school's data, and an expired lease is a kind of suspension.
"""
import base64
import json
import os

from . import settings as platform_settings
from .repo import now_iso, parse_iso, shift

ENV_KEY = "LICENCE_SIGNING_KEY"

# The lease and what happens after it. Both are platform settings so that a
# Superadmin can lengthen the lease for a school on a satellite link without a
# deployment, which is the sort of thing that otherwise becomes a code change.
LEASE_DAYS = "licence_lease_days"
LEASE_GRACE_DAYS = "licence_lease_grace_days"


def _crypto():
    """Ed25519, or None where the library is not installed.

    Imported here rather than at module scope on purpose: a deployment missing
    the library must still boot and still serve every school. It loses offline
    licensing, loudly (the boot report says so), and loses nothing else.
    """
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ed25519
        return ed25519, serialization
    except Exception:
        return None


def available():
    return _crypto() is not None


def _b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text):
    pad = "=" * (-len(str(text)) % 4)
    return base64.urlsafe_b64decode(str(text) + pad)


def generate_key():
    """A new signing key, as the base64 this service reads from its environment."""
    modules = _crypto()
    if not modules:
        return None
    ed25519, serialization = modules
    key = ed25519.Ed25519PrivateKey.generate()
    return _b64(key.private_bytes(serialization.Encoding.Raw,
                                  serialization.PrivateFormat.Raw,
                                  serialization.NoEncryption()))


def _private_key(repo=None):
    """The signing key: the environment first, then one this platform made.

    The environment is preferred because a key set on the service is a decision
    made by whoever can deploy it. Where none is set, one is generated on first
    use and kept in `platform_settings` — which is weaker (anyone with the
    database could sign licences) and is still far better than the alternative
    of no licensing at all on a deployment whose operator did not read the
    manual. The boot report says which of the two is in use.
    """
    modules = _crypto()
    if not modules:
        return None
    ed25519, _ = modules

    raw = os.environ.get(ENV_KEY, "").strip()
    if not raw and repo is not None:
        raw = str(platform_settings.get(repo, "licence_signing_key", "") or "").strip()
        if not raw:
            raw = generate_key()
            if raw:
                platform_settings.put(repo, "licence_signing_key", raw, actor="system")
    if not raw:
        return None
    try:
        return ed25519.Ed25519PrivateKey.from_private_bytes(_unb64(raw))
    except Exception:
        return None


def public_key(repo=None):
    """The verifying key, base64. This is what goes INTO the desktop build, and
    it is not a secret — it can only check a signature, never make one."""
    modules = _crypto()
    key = _private_key(repo)
    if not (modules and key):
        return None
    _, serialization = modules
    return _b64(key.public_key().public_bytes(serialization.Encoding.Raw,
                                              serialization.PublicFormat.Raw))


def canonical(payload):
    """The exact bytes that get signed.

    Sorted keys and no incidental whitespace, because a signature is over bytes
    and two dictionaries that are equal in Python are not necessarily equal
    once serialised. The desktop rebuilds this same string before verifying.
    """
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def issue(store, repo, school_id, device="", lease_days=None):
    """A signed lease for one school, as of right now.

    `device` binds the lease to the machine that asked for it, so a licence
    file copied to a second school's computer verifies perfectly and is then
    refused for naming somebody else's machine. A school with two offices asks
    twice and gets two leases; a school handing its licence to a neighbour
    gains nothing.
    """
    from . import entitlements

    key = _private_key(repo)
    entitlement = entitlements.for_school(store, school_id, fresh=True)
    summary = entitlements.summary(entitlement)

    days = int(lease_days or platform_settings.get_int(repo, LEASE_DAYS, 14) or 14)
    days = max(1, min(days, 365))
    at = now_iso()

    payload = {
        "v": 1,
        "school_id": str(school_id),
        "device": str(device or "")[:64],
        "access": summary.get("access") or "full",
        "status": summary.get("status") or "",
        "status_label": summary.get("status_label") or "",
        "plan_id": summary.get("plan_id") or "",
        "plan_name": summary.get("plan_name") or "",
        "features": sorted(summary.get("features") or []),
        "managed": bool(summary.get("managed", True)),
        "issued_at": at,
        "not_after": shift(at, days),
        # After `not_after` the desktop tries to refresh. These are how long it
        # may keep working while that is failing — a school on a bad line is
        # not a school that has stopped paying, and must not be treated as one
        # the first morning the network is down.
        "offline_grace_days": max(0, platform_settings.get_int(repo, LEASE_GRACE_DAYS, 7)),
        "renew_url": renewal_url(repo, school_id),
        "expires_at": summary.get("current_period_end") or "",
        "support_email": platform_settings.get(repo, "support_email", ""),
    }
    if not key:
        # No signing key and no library: the lease is unsigned and the desktop
        # will say so. Deliberately still ISSUED rather than refused, because a
        # platform that cannot sign must not thereby lock out every school that
        # was paying — that is our fault, not theirs (the same rule entitlements
        # already follow).
        return {"ok": True, "signed": False, "licence": payload, "token": None}

    body = canonical(payload)
    return {"ok": True, "signed": True, "licence": payload,
            "token": f"{_b64(body)}.{_b64(key.sign(body))}"}


def read(token, repo=None):
    """Verify and unpack a token — the same check the desktop makes, kept here
    so the console can show an operator what a school is actually holding."""
    modules = _crypto()
    key = _private_key(repo)
    try:
        body_b64, _, sig_b64 = str(token or "").partition(".")
        body = _unb64(body_b64)
        payload = json.loads(body)
    except Exception:
        return {"ok": False, "error": "That is not a licence."}
    if not (modules and key and sig_b64):
        return {"ok": True, "verified": False, "licence": payload}
    try:
        key.public_key().verify(_unb64(sig_b64), body)
    except Exception:
        return {"ok": False, "error": "The signature does not match."}
    return {"ok": True, "verified": True, "licence": payload}


def renewal_url(repo, school_id):
    """Where a reminder sends somebody to pay.

    One function, so the email, the SMS, the in-app banner and the licence all
    point at the same page — a renewal link that differs between channels is a
    support call about the one that does not work.
    """
    from .. import platform_api
    base = str(platform_settings.get(repo, "portal_url", "") or "").strip().rstrip("/")
    if not base:
        domains = platform_api.portal_base_domains()
        if domains:
            base = f"https://{school_id}.{domains[0]}"
    if not base:
        return ""
    return f"{base}/billing?renew=1"
