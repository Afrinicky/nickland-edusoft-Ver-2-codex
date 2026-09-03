"""The parent's side of the online school.

A parent reaches exactly one thing: their own children. Every read filters by
the links on the pupils' records, resolved from the database on the request —
there is no endpoint that takes a student id and trusts it.

The payment routes are here too, and the webhook, which is public by necessity
and therefore the most carefully guarded route in the service. See
``app/school/payments.py`` for what may be believed and what may not.
"""
from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from . import ratelimit
from .school import db as sdb, parents, payments, security, session

router = APIRouter(prefix="/api/v1/school/parent")


def _err(code, message, **extra):
    return JSONResponse(status_code=code, content={"ok": False, "error": message, **extra})


def _send(result):
    if isinstance(result, dict) and not result.get("ok"):
        return _err(result.get("status", 400), result.get("error", "That did not work."),
                    **{k: v for k, v in result.items() if k not in ("ok", "status", "error")})
    return result


async def _json(request: Request):
    try:
        return await request.json()
    except Exception:
        return {}


def _resolve(authorization):
    """The signed-in parent, or None. The token names the school as well as the
    session, exactly as a staff token does."""
    if not authorization or not authorization.startswith("Bearer "):
        return None, None
    raw = authorization[7:]
    if "." not in raw:
        return None, None
    school_id, _, token = raw.partition(".")
    try:
        db = sdb.SchoolDb(school_id)
        actor = session.parent_for(db, token)
    except Exception:
        return None, None
    return (db, actor) if actor else (None, None)


def _require(authorization):
    db, actor = _resolve(authorization)
    if not actor:
        return None, None, _err(401, "Please sign in.")
    return db, actor, None


def _owned(db, actor, student_id):
    return parents.owns(db, actor["parent_id"], student_id)


# ══ signing in ══════════════════════════════════════════════════════════════

@router.post("/signin")
async def signin(request: Request):
    body = await _json(request)
    school_id = str(body.get("school_id") or "").strip()
    if not school_id:
        return _err(400, "Which school?")
    if ratelimit.limited(request, "parent-signin", body.get("identifier") or body.get("phone")):
        return _err(429, "Too many attempts. Try again shortly.")
    try:
        db = sdb.SchoolDb(school_id)
        if not db.exists():
            # The same answer as a wrong password: probing school ids should
            # not tell an outsider which schools this service holds.
            return _err(401, "Those details did not match an account. Check and try again.")
    except ValueError:
        return _err(400, "Which school?")

    result = session.parent_sign_in(db, body.get("identifier") or body.get("phone"),
                                    body.get("password"), device=body.get("device"),
                                    platform=body.get("platform") or "online",
                                    source=ratelimit.client_ip(request))
    if not result.get("ok"):
        return _err(result.get("status", 401), result["error"])
    return {"ok": True, "token": f'{school_id}.{result["token"]}',
            "expires_at": result["expires_at"], "role": "parent",
            "parent": result["parent"],
            "school": {"id": school_id, "name": db.get_setting("school_name", "School")}}


@router.post("/register")
async def register(request: Request):
    body = await _json(request)
    school_id = str(body.get("school_id") or "").strip()
    if not school_id:
        return _err(400, "Which school?")
    # Registration is a lookup against every pupil's guardian contacts, so an
    # unthrottled one is a way to ask "is this number a parent at this school?"
    # a thousand times a minute.
    if ratelimit.limited(request, "parent-register", body.get("phone") or body.get("email")):
        return _err(429, "Too many attempts. Try again shortly.")
    try:
        db = sdb.SchoolDb(school_id)
        if not db.exists():
            return _err(400, "Which school?")
    except ValueError:
        return _err(400, "Which school?")
    result = parents.register(db, body.get("full_name"), body.get("phone"),
                              body.get("email"), body.get("password"))
    if not result.get("ok"):
        return _err(result.get("status", 400), result["error"])
    signed = session.parent_sign_in(db, body.get("phone") or body.get("email"),
                                    body.get("password"))
    return {"ok": True, "linked": result["linked"],
            "token": f'{school_id}.{signed["token"]}' if signed.get("ok") else None,
            "parent": signed.get("parent")}


@router.get("/me")
async def me(authorization: str = Header(None)):
    db, actor, refused = _require(authorization)
    if refused:
        return refused
    return {"ok": True, "role": "parent", "parent": {
                "id": actor["parent_id"], "full_name": actor["full_name"],
                "phone": actor["phone"], "email": actor["email"],
                "must_change_password": actor["must_change_password"]},
            "children": len(parents.student_ids(db, actor["parent_id"])),
            "school": {"id": db.school_id, "name": db.get_setting("school_name", "School")}}


@router.post("/password")
async def change_password(request: Request, authorization: str = Header(None)):
    db, actor, refused = _require(authorization)
    if refused:
        return refused
    body = await _json(request)
    return _send(session.change_parent_password(
        db, actor, body.get("current_password") or body.get("currentPassword"),
        body.get("new_password") or body.get("newPassword")))


@router.post("/signout")
async def signout(authorization: str = Header(None)):
    db, actor, refused = _require(authorization)
    if refused:
        return refused
    session.revoke_token(db, actor["token_id"])
    return {"ok": True}


# ══ their children ══════════════════════════════════════════════════════════

@router.get("/children")
async def children(authorization: str = Header(None)):
    db, actor, refused = _require(authorization)
    if refused:
        return refused
    return _send(parents.children(db, actor["parent_id"]))


@router.get("/children/{student_id}")
async def child(student_id: int, authorization: str = Header(None)):
    db, actor, refused = _require(authorization)
    if refused:
        return refused
    return _send(parents.child(db, actor["parent_id"], student_id))


@router.get("/announcements")
async def announcements(authorization: str = Header(None)):
    db, actor, refused = _require(authorization)
    if refused:
        return refused
    return _send(parents.announcements(db, actor["parent_id"]))


# ══ settling a bill ═════════════════════════════════════════════════════════

@router.get("/children/{student_id}/payment-options")
async def payment_options(student_id: int, authorization: str = Header(None)):
    db, actor, refused = _require(authorization)
    if refused:
        return refused
    if not _owned(db, actor, student_id):
        return _err(403, "Not your child.")
    return _send(payments.options(db, student_id))


@router.post("/children/{student_id}/pay")
async def pay(student_id: int, request: Request, authorization: str = Header(None)):
    db, actor, refused = _require(authorization)
    if refused:
        return refused
    if not _owned(db, actor, student_id):
        return _err(403, "Not your child.")
    # A checkout is cheap for us and expensive for the gateway; a loop in a
    # client should not become a thousand abandoned transactions on the
    # school's account.
    if ratelimit.limited(request, "pay", str(actor["parent_id"])):
        return _err(429, "Too many attempts. Try again shortly.")
    body = await _json(request)
    return _send(payments.start_checkout(db, actor, student_id, body.get("amount"),
                                         body.get("email")))


@router.get("/payments/{reference}")
async def payment_status(reference: str, authorization: str = Header(None)):
    db, actor, refused = _require(authorization)
    if refused:
        return refused
    return _send(payments.status(db, actor, reference))


@router.post("/children/{student_id}/declare-payment")
async def declare(student_id: int, request: Request, authorization: str = Header(None)):
    db, actor, refused = _require(authorization)
    if refused:
        return refused
    if not _owned(db, actor, student_id):
        return _err(403, "Not your child.")
    if ratelimit.limited(request, "declare", str(actor["parent_id"])):
        return _err(429, "Too many attempts. Try again shortly.")
    body = await _json(request)
    return _send(payments.declare(db, actor, student_id, body.get("amount"),
                                  body.get("channel"), body.get("reference"), body.get("notes")))


# ══ the gateway's webhook ═══════════════════════════════════════════════════
# Public by necessity — the gateway has no account here — and therefore the
# most carefully guarded route in the service. The signature is checked over
# the RAW bytes against the school's own secret before the body is believed
# about anything, a bad one is answered 401 and nothing else, and the amount is
# never read from the body: settlement asks the gateway directly.

webhook_router = APIRouter(prefix="/api/v1/school")


@webhook_router.post("/{school_id}/payments/webhook")
async def webhook(school_id: str, request: Request):
    raw = (await request.body()).decode("utf-8", "replace")
    try:
        db = sdb.SchoolDb(school_id)
    except ValueError:
        return _err(404, "Not found")
    cfg = payments.config(db)
    signature = (request.headers.get("x-paystack-signature")
                 or request.headers.get("x-signature") or "")
    if not cfg or not payments.verify_webhook(cfg["secret"], signature, raw):
        # Recorded in the school's own audit log: somebody posting unsigned
        # bodies at a school's payment endpoint is worth the school knowing.
        try:
            security.audit(db, None, "security", None, "webhook_rejected",
                           f"Unsigned or invalid webhook for {school_id}", "high")
        except Exception:
            pass
        return _err(401, "Unauthorized")

    import json as _json_lib
    try:
        payload = _json_lib.loads(raw) if raw else {}
    except ValueError:
        payload = {}
    if payload.get("event") == "charge.success" and (payload.get("data") or {}).get("reference"):
        try:
            payments.settle(db, payload["data"]["reference"])
        except Exception:
            security.audit(db, None, "payment_intent", None, "webhook_failed",
                           str(payload.get("data", {}).get("reference")), "high")
    return {"ok": True}
