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
ENV_PREVIOUS = "LICENCE_SIGNING_KEY_PREVIOUS"
ENV_ALLOW_WEAK = "ALLOW_UNMANAGED_LICENCE_KEY"

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


class KeyMissing(RuntimeError):
    """Raised at boot rather than letting the platform run unprotected."""


def _from_env(name):
    modules = _crypto()
    if not modules:
        return None
    ed25519, _ = modules
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        key = ed25519.Ed25519PrivateKey.from_private_bytes(_unb64(raw))
    except Exception as exc:
        # A key that is present and unreadable is a deployment mistake, and
        # falling back to "no licensing" would hide it until the day somebody
        # noticed schools were not being licensed at all.
        raise KeyMissing(
            f"{name} is set but is not a valid Ed25519 key. It must be the 32 "
            f"raw private bytes, base64url, exactly as `generate_key()` prints "
            f"them ({exc.__class__.__name__})."
        ) from exc
    return key


def require_key(repo=None):
    """Fail loudly at boot when this deployment cannot sign licences.

    THE SIGNING KEY IS THE WHOLE OF THE PROTECTION. Anybody who has it can mint
    a licence granting any school permanent full access, on any machine, for
    ever. It is not a configuration detail; it is the thing being protected.

    So, three rules, and they are all deliberately inconvenient:

      * **It comes from the environment and nowhere else.** It used to fall
        back to generating one and keeping it in `platform_settings`. That is
        gone. A private key in a row of the application's own database is a
        private key that is in every backup, every read replica, every
        `pg_dump` somebody mailed themselves, and every screen that can run a
        query. The blast radius of one leaked backup was the entire licensing
        system, permanently.
      * **The service refuses to start without it**, exactly as it refuses to
        start without DATABASE_URL and PORTAL_SECRET. A platform that quietly
        runs unlicensed is a platform whose protection nobody notices is off
        until they look at the revenue.
      * **Rotation is supported and does not lock anybody out.** Set the new
        key as LICENCE_SIGNING_KEY and the outgoing one as
        LICENCE_SIGNING_KEY_PREVIOUS; leases signed with either verify, new
        ones are signed with the new key, and the old variable can be dropped
        once every desktop has checked in (a lease's lifetime, by definition).

    `ALLOW_UNMANAGED_LICENCE_KEY=1` is the escape hatch for tests and local
    runs. It is the only way to get the old behaviour, it is named so that
    nobody sets it by accident, and the boot report says so in words.
    """
    if not _crypto():
        raise KeyMissing(
            "The `cryptography` package is not installed, so this deployment "
            "cannot sign offline licences and every desktop would run "
            "unlicensed. Install it (it is in requirements.txt), or set "
            f"{ENV_ALLOW_WEAK}=1 if you genuinely mean to run without "
            "licensing.")
    if _from_env(ENV_KEY):
        return True
    if os.environ.get(ENV_ALLOW_WEAK) == "1":
        return False
    raise KeyMissing(
        f"{ENV_KEY} is not set. Offline licences are signed with it, and "
        "without it every installed desktop runs unlicensed. Generate one "
        "with:\n\n"
        "    python3 -c \"import sys;sys.path.insert(0,'cloud-python');"
        "from app.billing.licence import generate_key;print(generate_key())\"\n\n"
        "Set it on the service and keep it out of the repository, out of the "
        "database and out of your shell history. To rotate, move the old value "
        f"to {ENV_PREVIOUS} for one lease period. For local development or "
        f"tests, set {ENV_ALLOW_WEAK}=1 instead.")


def managed():
    """Whether this deployment is signing with a key an operator set."""
    try:
        return bool(_from_env(ENV_KEY))
    except KeyMissing:
        return False


def _private_key(repo=None):
    """The signing key. The environment, and nothing else.

    `repo` is still accepted so that every caller did not have to change, and
    is deliberately unused — see `require_key` for why a key in the database
    was removed rather than merely discouraged.
    """
    if not _crypto():
        return None
    try:
        return _from_env(ENV_KEY)
    except KeyMissing:
        return None


def _verifying_keys(repo=None):
    """Every key a lease may legitimately have been signed with.

    The current one, and the outgoing one during a rotation. Nothing else — a
    list that grows silently is a list that keeps a compromised key alive.
    """
    keys = []
    for name in (ENV_KEY, ENV_PREVIOUS):
        try:
            key = _from_env(name)
        except KeyMissing:
            key = None
        if key:
            keys.append(key)
    return keys


def _public_of(key):
    modules = _crypto()
    if not (modules and key):
        return None
    _, serialization = modules
    return _b64(key.public_key().public_bytes(serialization.Encoding.Raw,
                                              serialization.PublicFormat.Raw))


def public_key(repo=None):
    """The verifying key, base64. This is what goes INTO the desktop build, and
    it is not a secret — it can only check a signature, never make one."""
    return _public_of(_private_key(repo))


def public_keys(repo=None):
    """Every key a desktop should accept: the current one and, during a
    rotation, the outgoing one. A desktop that has not checked in since the
    rotation is still holding a lease signed by the old key, and refusing it
    would lock out exactly the schools with the worst connections."""
    return [k for k in (_public_of(key) for key in _verifying_keys(repo)) if k]


def canonical(payload):
    """The exact bytes that get signed.

    Sorted keys and no incidental whitespace, because a signature is over bytes
    and two dictionaries that are equal in Python are not necessarily equal
    once serialised. The desktop rebuilds this same string before verifying.
    """
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def build_verdict(repo, build_id):
    """Is this the code we shipped?

    The desktop hashes the files that decide whether it may be used and sends
    the result. A value that is not one we published means those files have
    changed since we built them — which is either a tampered copy, or a build
    whose fingerprint nobody added to the list. Both are worth knowing about;
    only one is worth acting on, which is why the action is a setting.

    An empty allowlist is not evidence of anything, and an empty report is not
    either: an older desktop simply does not send one. Both are `unknown`.
    """
    known = [b.strip() for b in
             str(platform_settings.get(repo, "expected_build_ids", "") or "").split(",")
             if b.strip()]
    reported = str(build_id or "").strip()
    if not reported:
        return {"state": "unknown", "reason": "the installation did not report a build"}
    if not known:
        return {"state": "unknown", "reason": "no builds have been published"}
    if reported in known:
        return {"state": "ok", "build": reported}
    return {"state": "tampered", "build": reported,
            "reason": "the running code does not match any build we published"}


def issue(store, repo, school_id, device="", lease_days=None, build_id="",
          integrity_report=""):
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

    # A copy whose code has been changed since we built it gets a read-only
    # lease where the platform is configured to act on that. The lease is still
    # ISSUED — refusing outright would tell a patcher exactly which check to
    # remove next, and a read-only lease is indistinguishable from an ordinary
    # lapse, which is a far less useful signal to be given.
    verdict = build_verdict(repo, build_id)
    access = summary.get("access") or "full"
    # Two routes to the same finding: the build does not match anything we
    # published, or the installation's own checks disagreed with each other.
    tampered = verdict["state"] == "tampered" or bool(str(integrity_report or "").strip())
    if (tampered
            and platform_settings.get(repo, "tampered_build_action", "report") == "refuse"):
        access = "read_only"

    payload = {
        "v": 1,
        "school_id": str(school_id),
        "device": str(device or "")[:64],
        # The build this lease was issued FOR. The desktop compares it against
        # its own hash, so a genuine lease cannot be lifted onto a modified
        # copy: the lease names the real build and the modified one does not
        # hash to it. Forging a lease that names the modified build needs the
        # private key, which is the thing that never leaves the service.
        "build": str(build_id or "")[:64],
        "access": access,
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
    if not key:  # noqa: E501 — see require_key; this path is tests and local runs only
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
    keys = _verifying_keys(repo)
    try:
        body_b64, _, sig_b64 = str(token or "").partition(".")
        body = _unb64(body_b64)
        payload = json.loads(body)
    except Exception:
        return {"ok": False, "error": "That is not a licence."}
    if not (keys and sig_b64):
        return {"ok": True, "verified": False, "licence": payload}
    # Any key this deployment legitimately signs with — the current one, and
    # the outgoing one while a rotation is in flight. Tried in order so the
    # common case is one verification.
    for key in keys:
        try:
            key.public_key().verify(_unb64(sig_b64), body)
        except Exception:
            continue
        return {"ok": True, "verified": True, "licence": payload}
    return {"ok": False, "error": "The signature does not match."}


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
