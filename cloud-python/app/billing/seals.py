"""Sealing the documents a school cannot run a term without.

This is the strongest thing in the whole licensing design, and it is the only
part a patched client cannot reach. Everything else here — the lease, the build
hash, the fuses — protects code that runs on somebody else's computer, and code
that runs on somebody else's computer can, given enough determination, be
changed. A seal cannot, because making one needs a private key that is not on
that computer and never will be.

**What a seal is.** A short signed statement that Nickland issued a particular
receipt or report card for a particular school:

    NE-7K2M-4QXP-9  →  signature over {school, kind, serial, issued}

Printed on the document, checkable by anyone at /verify. A parent handed a
receipt, a head teacher handed a transcript, GES handed a report — any of them
can confirm it came from a licensed school, and none of them needs an account.

**Why it is the structural defence.** A cracked copy still runs. What it cannot
do is produce a receipt that verifies, because the seal is minted here, for a
school with a live subscription, and nowhere else. The school is then left
choosing between a working system whose paperwork nobody can confirm, and
paying. That is a far better position to argue from than a licence check.

**And it does not break offline use**, which is the whole product. Seals are
drawn in BATCHES while online and spent offline, exactly as a chequebook is.
A paying school draws hundreds at a time, tops up on any sync, and never knows
this exists. A school that stops paying stops being issued new ones and spends
what it has — no cliff, no lockout, nothing deleted, and a term or so of
runway before its paperwork stops verifying.
"""
import secrets

from . import audit as billing_audit
from . import licence as licence_lib
from . import settings as platform_settings
from . import subscriptions as subs
from .repo import now_iso, shift

# How many a school draws at a time, and when it tops up. Sized so a large
# school's whole term of receipts fits comfortably inside one batch: running
# out is the one failure mode that would hurt a paying customer, and the cost
# of a generous batch is a few kilobytes.
BATCH = 500
LOW_WATER = 100

# Kinds of document a seal can cover. Named rather than free text so a client
# cannot invent a kind that the verifier then displays verbatim.
KINDS = ("receipt", "report_card", "transcript", "statement", "certificate")

ALPHABET = "ACDEFGHJKLMNPQRTUVWXY3479"      # no O/0, I/1, S/5, B/8 — read aloud


def _mint(key, school_id, kind, serial, issued_at):
    payload = licence_lib.canonical({
        "school_id": str(school_id), "kind": kind,
        "serial": serial, "issued_at": issued_at, "v": 1})
    return licence_lib._b64(key.sign(payload))            # noqa: SLF001 — same module family


def _checksum(body):
    total = sum(ALPHABET.index(c) for c in body if c in ALPHABET)
    return ALPHABET[total % len(ALPHABET)]


def new_code():
    """A seal's human-readable form: NE-XXXX-XXXX-N.

    Read down a telephone by a bursar to a parent standing in front of somebody
    doubting their receipt, so the alphabet leaves out every character pair that
    gets misheard (O/0, I/1, S/5, B/8) and the last character is a checksum — a
    mistyped code then says "that is not a code" rather than "not found", which
    are very different things to be told.

    8 characters from 25 is about 1.5 x 10^11 codes, so guessing one is not a
    route in even before the rate limit on /verify.
    """
    raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return f"NE-{raw[:4]}-{raw[4:]}-{_checksum(raw)}"


def valid_code(text):
    """Cheap shape check, so a typo is refused before a database round trip."""
    parts = str(text or "").strip().upper().split("-")
    if len(parts) != 4 or parts[0] != "NE":
        return False
    if len(parts[1]) != 4 or len(parts[2]) != 4 or len(parts[3]) != 1:
        return False
    body = parts[1] + parts[2]
    return all(c in ALPHABET for c in body) and _checksum(body) == parts[3]


def allowance(repo, school_id):
    """May this school draw seals, and how many.

    A school in any live state draws them, including PAST_DUE and GRACE_PERIOD
    — those are states in which the school is being asked to pay, not states in
    which its paperwork should start failing. SUSPENDED is where it stops, and
    even then what it has already drawn remains valid for ever: a receipt that
    was genuine when it was issued does not become a forgery because the school
    fell behind later.
    """
    subscription = subs.current(repo, school_id)
    if not subscription:
        # Grandfathered (§28). Introducing seals must not break a school that
        # predates all of this.
        return {"ok": True, "batch": BATCH, "reason": "grandfathered"}
    if subscription["status"] == subs.SUSPENDED:
        return {"ok": False, "batch": 0,
                "error": "This subscription is suspended, so no new documents can "
                         "be sealed. Everything already issued stays valid."}
    return {"ok": True, "batch": platform_settings.get_int(repo, "seal_batch", BATCH) or BATCH}


def draw(store, repo, school_id, kind="receipt", count=None, device=""):
    """A batch of unspent seals for a school to carry offline."""
    if kind not in KINDS:
        return {"ok": False, "status": 400, "error": "Not a kind of document we seal."}
    allowed = allowance(repo, school_id)
    if not allowed["ok"]:
        return {"ok": False, "status": 402, "error": allowed["error"]}

    key = licence_lib._private_key(repo)                   # noqa: SLF001
    wanted = max(1, min(int(count or allowed["batch"]), BATCH))
    at = now_iso()
    issued = []

    for _ in range(wanted):
        serial = new_code()
        row = {
            "school_id": school_id, "kind": kind, "serial": serial,
            "status": "issued", "device_id": str(device or "")[:64],
            "issued_at": at, "expires_at": shift(at, 400), "created_at": at,
        }
        repo.insert("document_seals", row)
        issued.append({
            "serial": serial,
            "issued_at": at,
            # Unsigned where this deployment has no key — the platform still
            # works, the documents simply carry an unverifiable code, and the
            # boot report has already said so in words.
            "signature": _mint(key, school_id, kind, serial, at) if key else "",
        })

    billing_audit.write(store, "seals_drawn", school_id=school_id, actor="desktop",
                        detail=f"{len(issued)} {kind} seals.")
    return {"ok": True, "kind": kind, "seals": issued, "expires_in_days": 400}


def spend(repo, school_id, serial, reference=""):
    """Mark a seal used, and refuse a second use of the same one.

    A seal is single-use because a receipt number is: the same seal on two
    receipts is either a mistake worth catching or a copied database worth
    catching, and both should be caught.
    """
    row = repo.find_one("document_seals", {"serial": str(serial or "").strip().upper()})
    if not row or str(row["school_id"]) != str(school_id):
        return {"ok": False, "status": 404, "error": "No such seal."}
    if row["status"] == "spent":
        return {"ok": False, "status": 409, "already": True,
                "error": "That seal has already been used.",
                "reference": row.get("reference") or ""}
    repo.update("document_seals", row["id"], {
        "status": "spent", "spent_at": now_iso(),
        "reference": str(reference or "")[:120]})
    return {"ok": True}


def verify(store, repo, serial):
    """What /verify answers. Public, and deliberately says very little.

    It confirms a document is one we sealed and names the school, because that
    is the question being asked. It does NOT say what the document contained, or
    who it was for, or what was paid — a verification page that leaks a pupil's
    fee history to anybody holding a receipt code is worse than no verification
    page.
    """
    text = str(serial or "").strip().upper()
    if not valid_code(text):
        return {"ok": False, "error": "That is not an Edusoft verification code."}
    row = repo.find_one("document_seals", {"serial": text})
    if not row:
        return {"ok": False, "error": "No document with that code was issued by us."}
    school = None
    try:
        school = store.get_school(row["school_id"])
    except Exception:
        pass
    return {
        "ok": True,
        "genuine": True,
        "kind": row["kind"],
        "school": (school or {}).get("name") or row["school_id"],
        "issued_at": row.get("issued_at"),
        "used": row.get("status") == "spent",
        "used_at": row.get("spent_at"),
    }


def stock(repo, school_id, kind="receipt"):
    """How many unspent seals a school is holding — what the top-up decides on."""
    rows = repo.find("document_seals", {"school_id": school_id, "kind": kind,
                                        "status": "issued"})
    return len(rows)
