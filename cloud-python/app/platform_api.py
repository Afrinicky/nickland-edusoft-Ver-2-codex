"""Nickland's own admin surface — enrolling a school.

Every other admin route in this service is authenticated with a SCHOOL's key
and can only ever reach that school. This one is the vendor's, and it is the
only place that can bring a school into existence. Keeping the two apart is the
point: a school key that could create schools would make every desktop in the
country a provisioning console.

── Why this exists ────────────────────────────────────────────────────────
Onboarding was `scripts/create_school.py`, run by hand, and it did half the
job. It wrote the row in `schools` — which is what the desktop's sync key is
checked against — and stopped there. The school's own database, the eighty-one
tables the hosted office application reads, was never created: `sdb.provision`
is called nowhere outside the tests. So an enrolled school could sync, and
could not be opened on the web at all, and nothing said so.

A school is therefore provisioned here as ONE act, and reported on as one
thing. Half a school is a state the platform can be in — a schema created and a
registry row that failed, or the reverse — so the listing says which half is
missing rather than quietly showing a name.

── The tenant id ──────────────────────────────────────────────────────────
It used to be `sch_` and eight random hex characters, which is fine for a
foreign key and useless for everything else: it cannot be read down a phone,
and it cannot be a subdomain. A school is now identified by a slug of its own
name — `ave-maria` — so `ave-maria.nickland.edu.gh` needs no lookup table, and
an operator reading a support ticket knows which school it is about.
"""
import hashlib
import os
import re
import secrets

from . import auth
from .school import db as sdb

# ── The operator's key ──────────────────────────────────────────────────────
# Read from the environment and never stored: the platform has exactly one of
# these, held by Nickland, and a service with none configured refuses every
# route here rather than falling back to something weaker. There is no "no key
# set means open" path — that is how an internal tool becomes a public one.
ENV_KEY = "PLATFORM_ADMIN_KEY"
MIN_KEY_LENGTH = 24


def _configured_key():
    key = os.environ.get(ENV_KEY, "")
    return key if len(key) >= MIN_KEY_LENGTH else None


def platform_enabled():
    return _configured_key() is not None


def check_key(presented):
    """Constant-time compare against the configured operator key.

    `compare_digest` over the hashes rather than the raw strings: it keeps the
    comparison length-independent, so a wrong key of a different length cannot
    be told from a wrong key of the right one.
    """
    expected = _configured_key()
    if not expected or not presented:
        return False
    return secrets.compare_digest(
        hashlib.sha256(str(presented).encode()).hexdigest(),
        hashlib.sha256(str(expected).encode()).hexdigest())


# ── Tenant ids ──────────────────────────────────────────────────────────────
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
# Postgres identifiers are capped at 63 bytes and `school_` is already spent,
# so a school with a very long name is trimmed rather than colliding on the
# truncation Postgres would do silently.
MAX_SLUG = 40

# Names that must not become a school's address, because they already mean
# something else on it. A school called "API" is not worth the outage.
RESERVED = {
    "www", "api", "admin", "app", "portal", "mail", "ftp", "cdn", "static",
    "assets", "status", "health", "docs", "help", "support", "billing",
    "login", "signin", "signup", "auth", "account", "dashboard", "school",
    "schools", "platform", "nickland", "edusoft", "test", "staging", "demo",
}


def slugify(name):
    """A school's name as an address. "Ave Maria School" → "ave-maria-school"."""
    s = _SLUG_STRIP.sub("-", str(name or "").strip().lower()).strip("-")
    return s[:MAX_SLUG].strip("-")


def allocate_school_id(store, name, requested=None):
    """The identifier this school will answer to, for good.

    A school's id is in its sync configuration, its subdomain and every row it
    owns, so it is chosen once and never reissued. Collisions take a numeric
    suffix rather than a random one: `ave-maria-2` is still something an
    operator can read out, which `ave-maria-7f3a` is not.
    """
    base = slugify(requested or name)
    if not base:
        # A name with nothing alphanumeric in it at all. Rare, and not worth
        # refusing an enrolment over.
        base = "school-" + secrets.token_hex(3)
    if base in RESERVED:
        base = f"{base}-school"

    taken = {str(s["school_id"]) for s in store.list_schools()}
    try:
        taken |= {str(s["school_id"]) for s in sdb.provisioned()}
    except Exception:
        # No Postgres, or nothing provisioned yet. The registry is enough to
        # avoid a collision; a schema without a registry row is a half-school
        # and shows up in the listing as one.
        pass

    if base not in taken:
        return base
    for n in range(2, 1000):
        candidate = f"{base}-{n}"
        if candidate not in taken:
            return candidate
    return f"{base}-{secrets.token_hex(3)}"


# ── Enrolling a school ──────────────────────────────────────────────────────
def provision_school(store, name, school_id=None, seed=True):
    """Bring a school into existence — both halves of it, in one call.

    A school is two things in this service and needs both:

      * a row in `schools`, which is what the desktop's sync key is checked
        against, and what the parent portal's school picker lists;
      * a Postgres SCHEMA holding the eighty-one tables the hosted office
        application reads, seeded with the designations, classes, subjects and
        grading bands a desktop-provisioned school opens on.

    Order matters. The schema is created FIRST, because it is the half that can
    fail for reasons outside this request — a database asleep, a connection
    limit reached — and a registry row pointing at a school that does not exist
    is worse than no row: it appears in the picker, it accepts a sync key, and
    every read behind it fails. A schema with no registry row is inert by
    comparison, shows up in the listing as incomplete, and is what a retry
    lands on harmlessly, because `provision` is idempotent by construction
    (every statement is IF NOT EXISTS or ON CONFLICT DO NOTHING).
    """
    sid = school_id or allocate_school_id(store, name)
    if store.get_school(sid):
        return {"ok": False, "status": 409,
                "error": f'A school with the id "{sid}" is already enrolled.'}

    schema = None
    try:
        schema = sdb.provision(sid, seed=seed)
    except Exception as exc:
        return {"ok": False, "status": 503,
                "error": f"The school's database could not be created: {exc}"}

    # The school's own name, inside its own database, so the hosted application
    # and every report it prints say what the school calls itself rather than
    # its tenant id.
    try:
        sdb.SchoolDb(sid).set_setting("school_name", name, "school")
    except Exception:
        pass

    try:
        created = store.create_school(name=name, school_id=sid)
    except Exception as exc:
        return {"ok": False, "status": 503,
                "error": f"The school's database was created but it could not be enrolled: {exc}",
                "school_id": sid, "schema": schema}

    return {
        "ok": True,
        "school_id": created["school_id"],
        "name": name,
        # Shown ONCE. It is stored only as a hash, so a lost key is reissued
        # rather than recovered — see rotate_key.
        "api_key": created["api_key"],
        "schema": schema,
        "portal_host": portal_host(created["school_id"]),
    }


# ── Where the portals live ──────────────────────────────────────────────────
# `PORTAL_BASE_DOMAIN` holds one domain or several, separated by commas,
# semicolons or whitespace:
#
#     PORTAL_BASE_DOMAIN="nickland.edu.gh"
#     PORTAL_BASE_DOMAIN="edusoft.gh, nickland.edu.gh"
#     PORTAL_BASE_DOMAIN="edusoft.gh nickland.edu.gh localhost"
#
# Several rather than one because a deployment genuinely has several at once: a
# product domain and a vendor domain during a rename, a short one for typing
# and a long one for print, `localhost` while developing. A school is reachable
# under every one of them, and none of them is written into the code.
#
# The FIRST is canonical — the address the platform hands out and prints — and
# the rest are recognised. Putting a new domain at the front is therefore how a
# deployment moves, and the old address keeps working for as long as it stays
# in the list.
def portal_base_domains(base=None):
    raw = base if base is not None else os.environ.get("PORTAL_BASE_DOMAIN", "")
    parts = re.split(r"[,;\s]+", str(raw or ""))
    return [p.strip().lstrip(".").rstrip(".").lower() for p in parts if p.strip().strip(".")]


def portal_host(school_id, base=None):
    """The address this school is given, under the canonical domain.

    None when the deployment has configured no domain at all, which is a real
    state — a service reached only by IP, or a test — and not an error.
    """
    roots = portal_base_domains(base)
    return f"{school_id}.{roots[0]}" if roots else None


def portal_hosts(school_id, base=None):
    """Every address this school answers to, canonical first."""
    return [f"{school_id}.{r}" for r in portal_base_domains(base)]


def rotate_key(store, school_id):
    """Issue a fresh sync key for a school, retiring the old one.

    Needed for the ordinary reasons — a key pasted into a support ticket, a
    desktop sold with the school's key still on it — and it is a rotation, not
    a recovery: keys are held as hashes and the old one cannot be read back.
    The school's data is untouched; only what its desktop signs in with
    changes, so the school must be told before this is called, not after.
    """
    if not store.get_school(school_id):
        return {"ok": False, "status": 404, "error": "Unknown school."}
    key = auth.gen_key()
    try:
        store.set_school_key(school_id, key)
    except AttributeError:
        return {"ok": False, "status": 501,
                "error": "This store cannot rotate a school key."}
    return {"ok": True, "school_id": school_id, "api_key": key}


# ── What the platform holds ─────────────────────────────────────────────────
def list_schools(store):
    """Every school, from BOTH registers, reconciled.

    The service has two, and they are not the same question: `schools` says
    which keys are accepted, and the set of `school_*` schemas says which
    schools have a database. A listing that read only one would show a school
    that cannot be opened, or hide one that exists.

    So this reads both and says, per school, which halves are there. An
    operator looking for why a school "does not work" gets the answer on the
    first screen instead of from a psql session.
    """
    enrolled = {str(s["school_id"]): s for s in store.list_schools()}
    try:
        databases = {str(s["school_id"]): s for s in sdb.provisioned()}
    except Exception:
        databases = {}

    out = []
    for sid in sorted(set(enrolled) | set(databases)):
        reg = enrolled.get(sid)
        dbs = databases.get(sid)
        out.append({
            "school_id": sid,
            # The name in the school's own database is the one it chose; the
            # registry's is what it was enrolled as. Prefer the school's.
            "name": (dbs or {}).get("name") or (reg or {}).get("name") or sid,
            "enrolled": reg is not None,
            "has_database": dbs is not None,
            "complete": reg is not None and dbs is not None,
            "portal_host": portal_host(sid),
            "problem": _problem(reg, dbs),
        })
    return out


def _problem(reg, dbs):
    """Said in words an operator can act on, not as a pair of booleans."""
    if reg and dbs:
        return None
    if reg and not dbs:
        return ("Enrolled, but it has no database: it can sync and cannot be "
                "opened on the web. Re-run provisioning for this school id.")
    return ("It has a database but is not enrolled: nothing can sign in to it "
            "and no desktop can sync to it. Enrol it with this same school id.")


# ── A school's own address ──────────────────────────────────────────────────
# PRD §5: every school reaches its portal at `schoolname.nickland.edu.gh`.
#
# This is the read half — turning a Host header back into a school id. It is
# deliberately thin, and deliberately not a lookup: because a tenant id IS the
# subdomain (see allocate_school_id), resolving one is string work, and a
# school that has just been enrolled is reachable immediately rather than after
# some table is refreshed.
#
# Two rules it will not bend on:
#
#   * The host must sit under one of the configured base domains. A request
#     arriving with any other Host is not a school — answering it would let
#     anyone pointing a DNS record at this service pick a tenant by name.
#   * The result is a CANDIDATE, never an authorisation. It says which school
#     the address is asking for; whether that school exists, and whether the
#     caller may read it, are the existing checks' business and are unchanged.


def school_id_from_host(host, base=None):
    """The school a hostname is asking for, or None.

    None means "not a school address" for every reason — the wrong domain, the
    bare domain, a reserved name, an empty label — because a caller that has to
    tell those apart would be a caller making policy out of DNS.
    """
    roots = portal_base_domains(base)
    if not roots:
        return None

    h = str(host or "").strip().lower()
    if not h:
        return None
    # Host carries the port when it is not the default, and a trailing dot is
    # legal in a fully-qualified name. Neither is part of the school's name.
    h = h.split(",")[0].strip()          # a forwarded list; the first is the client's
    h = h.rsplit(":", 1)[0] if h.count(":") == 1 else h
    h = h.rstrip(".")

    for root in roots:
        suffix = "." + root
        if not h.endswith(suffix):
            continue
        label = h[: -len(suffix)]
        # Exactly one label. `a.b.edusoft.gh` is not school "a.b"; refusing it
        # keeps one school from ever being addressable under another's name.
        if not label or "." in label:
            continue
        if label in RESERVED:
            continue
        # It must look like an id this service would itself have issued.
        if re.fullmatch(r"[a-z0-9][a-z0-9-]{0,%d}" % (MAX_SLUG + 8), label):
            return label
    return None
