"""Which machines a school has activated, and how many it may.

The model is the one Adobe and Wondershare both use, because it is the one a
customer already understands without being taught:

    sign in on a machine      → that machine takes a seat
    run out of seats          → you are TOLD, and shown what is using them
    deactivate one you're not  → the seat comes back immediately
      using

Without seats, one school's email and password run an unlimited number of
installs, and a single Pro subscription quietly serves a district. With them,
sharing credentials costs the sharer their own access, which is the only
enforcement that has ever worked on this.

**A reinstall does not eat a seat.** The row is keyed on (school, device), so a
machine that is wiped, reinstalled and activated again lands on the row it had.
That matters more than it sounds: the commonest support call in licensed
desktop software is "I reinstalled Windows and now it says I have no seats
left", and it is entirely self-inflicted.

**The number comes from the plan**, as `limits.devices` — so Free gets one
machine, Pro a few, Max as many as a large school needs, and changing any of
that is a row in the console rather than a release.
"""
from .. import auth
from . import audit as billing_audit
from . import plans as plan_lib
from . import settings as platform_settings
from . import subscriptions as subs
from .repo import now_iso

ACTIVE = "active"
DEACTIVATED = "deactivated"

# What a school gets when its plan says nothing. Deliberately generous: a school
# has an office PC, a head teacher's laptop and a bursar's machine before
# anybody has done anything unusual, and a limit that bites honest use is a
# limit that generates support calls rather than revenue.
DEFAULT_SEATS = 5


def seat_limit(repo, school_id):
    """How many machines this school may have activated at once.

    Zero and below mean unlimited — the honest way to express "we do not count
    these" for an enterprise plan, rather than a large number somebody has to
    guess the meaning of.
    """
    subscription = subs.current(repo, school_id)
    if not subscription:
        # No subscription at all is a grandfathered school (§28). It keeps
        # working, and counting seats on it would be introducing a restriction
        # by the back door that the grandfathering exists to prevent.
        return 0
    limits = plan_lib.limits_for_plan(repo, subscription.get("plan_id"))
    value = limits.get("devices", limits.get("seats"))
    if value in (None, ""):
        value = platform_settings.get_int(repo, "default_device_seats", DEFAULT_SEATS)
    try:
        return int(value)
    except (TypeError, ValueError):
        return DEFAULT_SEATS


def unlimited(limit):
    return int(limit or 0) <= 0


def list_devices(repo, school_id, include_deactivated=True):
    rows = repo.find("school_devices", {"school_id": school_id},
                     order_by="last_seen_at", desc=True)
    if not include_deactivated:
        rows = [r for r in rows if r.get("status") == ACTIVE]
    return rows


def active_count(repo, school_id):
    return sum(1 for r in list_devices(repo, school_id) if r.get("status") == ACTIVE)


def summary(repo, school_id):
    limit = seat_limit(repo, school_id)
    used = active_count(repo, school_id)
    return {
        "limit": limit,
        "unlimited": unlimited(limit),
        "used": used,
        "left": None if unlimited(limit) else max(0, limit - used),
        "devices": [public(d) for d in list_devices(repo, school_id)],
    }


def public(device):
    """A device as a school's own screen shows it. No fingerprint: the id is
    hashed and still nobody outside needs to see it."""
    return {
        "id": device.get("id"),
        "label": device.get("label") or "This computer",
        "platform": device.get("platform") or "",
        "app": device.get("app") or "desktop",
        "app_version": device.get("app_version") or "",
        "build_id": device.get("build_id") or "",
        "status": device.get("status"),
        "last_seen_at": device.get("last_seen_at"),
        "activated_at": device.get("created_at"),
        "activated_by": device.get("activated_by") or "",
    }


def claim(store, repo, school_id, device_id, *, label="", platform="", app="desktop",
          app_version="", build_id="", actor="", remote_addr=""):
    """Take a seat for this machine, or say why it cannot.

    Returns `{"ok": True, "device": …}` or a refusal naming what is using the
    seats — because "device limit reached" with no list of devices is the most
    annoying error message in consumer software, and the fix is one sentence of
    extra data.
    """
    device_id = str(device_id or "").strip()[:64]
    if not device_id:
        return {"ok": False, "status": 400, "error": "This installation did not "
                                                     "identify itself."}

    existing = repo.find_one("school_devices",
                             {"school_id": school_id, "device_id": device_id})
    patch = {
        "label": str(label or "")[:120] or (existing or {}).get("label") or "",
        "platform": str(platform or "")[:60],
        "app": str(app or "desktop")[:20],
        "app_version": str(app_version or "")[:40],
        "build_id": str(build_id or "")[:64],
        "status": ACTIVE,
        "last_seen_at": now_iso(),
        "last_ip": str(remote_addr or "")[:64],
        "deactivated_at": None,
    }

    # A fresh credential on every activation, including a returning machine.
    # Signing in again is how somebody who thinks a token has leaked replaces
    # it, and the old one stops working the moment this is written.
    token = auth.gen_key()
    patch["token_hash"] = auth.hash_key(token)

    if existing:
        # Already ours. A machine coming back — from a reinstall, from a
        # deactivation somebody has changed their mind about — reclaims the row
        # it had rather than taking a second seat.
        was = existing.get("status")
        updated = repo.update("school_devices", existing["id"], patch)
        if was != ACTIVE:
            billing_audit.write(store, "device_reactivated", school_id=school_id,
                                actor=actor or "system",
                                detail=f'{patch["label"] or device_id[:8]} was activated again.')
        return {"ok": True, "device": public(updated), "token": token, "returning": True}

    limit = seat_limit(repo, school_id)
    if not unlimited(limit) and active_count(repo, school_id) >= limit:
        return {
            "ok": False, "status": 409, "reason": "seats",
            "error": (f"This subscription covers {limit} "
                      f"device{'' if limit == 1 else 's'}, and {limit} "
                      f"{'is' if limit == 1 else 'are'} already in use. "
                      "Deactivate one from Billing, or move to a larger plan."),
            "seats": summary(repo, school_id),
        }

    created = repo.insert("school_devices", {
        "school_id": school_id, "device_id": device_id,
        "activated_by": str(actor or "")[:120],
        "created_at": now_iso(), **patch})
    billing_audit.write(store, "device_activated", school_id=school_id,
                        actor=actor or "system",
                        detail=f'{patch["label"] or device_id[:8]} '
                               f'({patch["platform"] or patch["app"]}) was activated.')
    return {"ok": True, "device": public(created), "token": token}


def by_token(repo, token):
    """The device a credential belongs to, if it still holds a seat.

    A deactivated device resolves to nothing, which is what makes Deactivate
    take effect at the device's very next request rather than at its next
    licence refresh a fortnight later.
    """
    raw = str(token or "").strip()
    if not raw:
        return None
    row = repo.find_one("school_devices", {"token_hash": auth.hash_key(raw)})
    return row if (row and row.get("status") == ACTIVE) else None


def touch(repo, school_id, device_id, remote_addr=""):
    """This machine is still here. Called on every licence refresh, so the
    school's device list says when each was last used rather than only when it
    was first activated — which is the column somebody actually reads when
    deciding which to deactivate."""
    device_id = str(device_id or "").strip()[:64]
    if not device_id:
        return None
    row = repo.find_one("school_devices", {"school_id": school_id, "device_id": device_id})
    if not row:
        return None
    return repo.update("school_devices", row["id"],
                       {"last_seen_at": now_iso(),
                        "last_ip": str(remote_addr or "")[:64]})


def is_active(repo, school_id, device_id):
    """Whether this machine still holds a seat.

    A device deactivated from the school's own billing page stops getting
    licences on its next refresh — which is what makes the Deactivate button
    mean something rather than being a list that can be tidied.
    """
    device_id = str(device_id or "").strip()[:64]
    if not device_id:
        return True          # a caller that does not identify itself is not seat-checked
    row = repo.find_one("school_devices", {"school_id": school_id, "device_id": device_id})
    return bool(row and row.get("status") == ACTIVE)


def deactivate(store, repo, school_id, device_row_id, actor="school"):
    device = repo.get("school_devices", device_row_id)
    if not device or str(device["school_id"]) != str(school_id):
        return {"ok": False, "status": 404, "error": "No such device."}
    if device.get("status") != ACTIVE:
        return {"ok": True, "device": public(device), "already": True}
    updated = repo.update("school_devices", device["id"], {
        "status": DEACTIVATED, "deactivated_at": now_iso()})
    billing_audit.write(store, "device_deactivated", school_id=school_id, actor=actor,
                        detail=f'{device.get("label") or device["device_id"][:8]} '
                               "was deactivated and its seat released.")
    return {"ok": True, "device": public(updated)}
