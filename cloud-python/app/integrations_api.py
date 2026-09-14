"""A school setting up its own providers.

Seven routes, one screen, and the shape of the screen is the shape of the job:

    GET    /api/v1/school/integrations            everything, in one call
    POST   /api/v1/school/integrations/payments   choose a provider, paste keys
    POST   /api/v1/school/integrations/payments/test     ← the important one
    POST   /api/v1/school/integrations/payments/enable   switch it on
    DELETE /api/v1/school/integrations/payments   switch it off entirely
    POST   /api/v1/school/integrations/sms        Arkesel's key and sender ID
    POST   /api/v1/school/integrations/sms/test   check it, or send one message

Two rules hold across all of them.

**Only the people who run the school.** A gateway key is money: whoever holds
it can take payments in the school's name and can point them somewhere else.
Proprietor and Super Admin, and nobody else — not the bursar who records
payments, not the head teacher. Refusals are written to the school's own audit
log like every other refusal.

**Nothing ever comes back out.** Every response goes through
`integrations.overview`, which redacts. There is no route here that returns a
secret, and adding one would undo the reason the rest of this is careful.
"""
from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from . import portals
from .school import db as sdb, integrations, security, session as school_session

router = APIRouter(prefix="/api/v1/school/integrations")


def _err(code, message, **extra):
    return JSONResponse(status_code=code, content={"ok": False, "error": message, **extra})


def _send(result):
    if isinstance(result, dict) and not result.get("ok"):
        return JSONResponse(
            status_code=result.get("status", 400),
            content={"ok": False, "error": result.get("error", "That did not work."),
                     **{k: v for k, v in result.items() if k not in ("ok", "status", "error")}})
    return result


async def _json(request: Request):
    try:
        return await request.json()
    except Exception:
        return {}


class Denied(Exception):
    def __init__(self, response):
        self.response = response


def _owner(authorization):
    """The person asking, if the school's providers are theirs to change.

    Returns `(db, actor)`. The same message for an unknown school and a bad
    token, because both are reachable from the internet by guessing.
    """
    raw = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    if "." not in raw:
        raise Denied(_err(401, "Please sign in."))
    school_id, _, token = raw.partition(".")
    try:
        db = sdb.SchoolDb(school_id)
        actor = school_session.actor_for(db, token)
    except Exception:
        raise Denied(_err(401, "Please sign in."))
    if not actor:
        raise Denied(_err(401, "Please sign in."))
    if not (bool(actor.get("is_admin")) or portals.is_super_admin(actor)):
        security.deny(db, actor, "integrations:manage",
                      "Only the school's owner or Super Admin can change this.")
        raise Denied(_err(403, "Only the school's owner or Super Admin can set up "
                               "payments and messaging."))
    return db, actor


@router.get("")
@router.get("/")
def read(authorization: str = Header(None)):
    try:
        db, actor = _owner(authorization)
    except Denied as denied:
        return denied.response
    return integrations.overview(db, actor)


@router.post("/payments")
async def save_payments(request: Request, authorization: str = Header(None)):
    try:
        db, actor = _owner(authorization)
    except Denied as denied:
        return denied.response
    return _send(integrations.save_payment(db, actor, await _json(request)))


@router.post("/payments/test")
def test_payments(authorization: str = Header(None)):
    """Ask the provider whether the credentials are real.

    A read at the provider — no money moves, nothing is charged — and the only
    thing that unlocks the switch. It is a POST rather than a GET because it
    records its result.
    """
    try:
        db, actor = _owner(authorization)
    except Denied as denied:
        return denied.response
    return _send(integrations.test_payment(db, actor))


@router.post("/payments/enable")
async def enable_payments(request: Request, authorization: str = Header(None)):
    try:
        db, actor = _owner(authorization)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    return _send(integrations.set_enabled(db, actor, body.get("enabled") is not False))


@router.delete("/payments")
def clear_payments(authorization: str = Header(None)):
    try:
        db, actor = _owner(authorization)
    except Denied as denied:
        return denied.response
    return _send(integrations.save_payment(db, actor, {"gateway": "none"}))


@router.post("/sms")
async def save_sms(request: Request, authorization: str = Header(None)):
    try:
        db, actor = _owner(authorization)
    except Denied as denied:
        return denied.response
    return _send(integrations.save_sms(db, actor, await _json(request)))


@router.post("/sms/test")
async def test_sms(request: Request, authorization: str = Header(None)):
    """Check the key, and send one real message if a number is given.

    Without a number this costs no credit and needs no phone — it asks the
    provider for the account balance. With one it sends a single text, which is
    the only way to find out whether the sender ID has actually been approved,
    and the school is told that is what will happen before it presses.
    """
    try:
        db, actor = _owner(authorization)
    except Denied as denied:
        return denied.response
    body = await _json(request)
    return _send(integrations.test_sms(db, actor, str(body.get("to") or "").strip()))
