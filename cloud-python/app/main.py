"""Nickland Edusoft Cloud — FastAPI portal + sync service (Python).

Same HTTP contract as the original Node service, so the (JS) desktop sync
client and the parent web app work against it unchanged. Two auth schemes:
  • x-school-key  → /api/v1/sync/*  and  /api/v1/admin/*   (desktop + portal backend)
  • Bearer token  → /api/v1/portal/* (schools + login public; rest need the token)
The cloud holds only the thin read model + change queue; the desktop stays the
source of truth.
"""
import datetime
import json
import os
from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware

from . import office
from . import payments as cloud_payments
from . import school_api
from . import portal_auth as pauth
from . import portals as portal_model
from . import ratelimit
from . import staff as staff_api
from . import webapp
from .store import create_store

_SITE_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "index.html")
try:
    with open(_SITE_PATH, encoding="utf-8") as fh:
        SITE = fh.read()
except OSError:
    SITE = "<!doctype html><title>Nickland Edusoft</title><p>Portal site not found.</p>"


def create_app(store=None) -> FastAPI:
    app = FastAPI(title="Nickland Edusoft Cloud", docs_url=None, redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.state.store = store or create_store()

    # The online school itself: every module the offline system has, against
    # that school's own Postgres schema. Mounted FIRST so it can never be
    # shadowed by the catch-all that serves the web app's static files.
    app.include_router(school_api.router)

    # Optional seed for dev / cross-language testing: provision a known school.
    seed_id, seed_key = os.environ.get("SEED_SCHOOL_ID"), os.environ.get("SEED_SCHOOL_KEY")
    if seed_id and seed_key and hasattr(app.state.store, "add_school"):
        app.state.store.add_school(seed_id, os.environ.get("SEED_SCHOOL_NAME", seed_id), seed_key)

    def S():
        return app.state.store

    def require_school(x_school_key):
        school = S().get_school_by_key(x_school_key) if x_school_key else None
        if not school:
            raise HTTPException(status_code=401, detail={"ok": False, "error": "invalid school key"})
        return school

    def require_parent(authorization):
        token = authorization[7:] if authorization and authorization.startswith("Bearer ") else None
        claims = pauth.verify_token(token) if token else None
        # A staff token must never open a parent endpoint. Without the explicit
        # check it would fall through to a lookup for a missing parent_id,
        # which is the kind of thing that matches one day by accident.
        if not claims or claims.get("role") == "staff" or not claims.get("parent_id"):
            raise HTTPException(status_code=401, detail={"ok": False, "error": "Please sign in."})
        rec = next((s["payload"] for s in S().list_snapshots(claims["school_id"], "parent_auth")
                    if s["payload"] and s["payload"].get("parent_id") == claims["parent_id"]), None)
        if not rec or not rec.get("is_active"):
            raise HTTPException(status_code=401, detail={"ok": False, "error": "Account unavailable."})
        return claims, rec

    # ── Website ──
    # The legacy hand-written parent page, kept reachable by name so a school
    # can be pointed back at it if the new app misbehaves.
    @app.get("/legacy", response_class=HTMLResponse)
    def legacy_site():
        return HTMLResponse(SITE)

    @app.get("/", response_class=HTMLResponse)
    @app.get("/portal", response_class=HTMLResponse)
    @app.get("/app", response_class=HTMLResponse)
    def site():
        shell = webapp.shell()
        if shell:
            return FileResponse(shell, media_type="text/html; charset=utf-8",
                                headers={"Cache-Control": "no-cache"})
        return HTMLResponse(SITE)

    @app.get("/health")
    @app.get("/api/v1/health")
    def health():
        return {"ok": True, "store": S().kind, "web_app": webapp.is_available()}

    # ── Public portal ──
    # The same path a desktop host answers, so a client can ask one question —
    # "what are you?" — instead of probing endpoint by endpoint. A host returns
    # a `school`; this returns the tenant list.
    @app.get("/api/v1/info")
    def info():
        return {"ok": True, "mode": "cloud", "portal": True, "staff": True, "schools": S().list_schools()}

    @app.get("/api/v1/portal/schools")
    def schools():
        return {"ok": True, "schools": S().list_schools()}

    # ── One school's identity ──
    # Public, and answered before anyone signs in: a parent opening the portal
    # should see their own school's crest and name, not a generic page. The
    # desktop projects this (see electron/server/sync/outbox.js
    # `enqueueSchoolProfile`), so the portal and the app on the school Wi-Fi
    # draw the same crest and offer the same contact numbers.
    #
    # A school that has not yet pushed one falls back to its name, which is all
    # the portal has ever had — no worse than before, and never an error.
    @app.get("/api/v1/portal/branding")
    def portal_branding(school_id: str = ""):
        if not school_id:
            return _err(400, "school_id is required")
        name = next((s["name"] for s in S().list_schools() if str(s["school_id"]) == str(school_id)), None)
        if name is None:
            return _err(404, "Unknown school")
        rec = next((s["payload"] for s in S().list_snapshots(school_id, "school_profile")
                    if s.get("payload")), None)
        if not rec:
            return {"ok": True, "school": {"name": name}, "contact": {}, "logo": None, "currency": "GHS"}
        school = dict(rec.get("school") or {})
        school.setdefault("name", name)
        return {
            "ok": True,
            "school": school,
            "contact": rec.get("contact") or {},
            "logo": rec.get("logo"),
            "currency": rec.get("currency") or "GHS",
        }

    @app.post("/api/v1/portal/login")
    async def login(request: Request):
        body = await _json(request)
        if not body.get("school_id") or not body.get("identifier") or not body.get("password"):
            return _err(400, "school, identifier and password are required")
        if ratelimit.limited(request, "parent", body.get("identifier")):
            return _err(429, "Too many attempts. Try again shortly.")
        auths = S().list_snapshots(body["school_id"], "parent_auth")
        np = pauth.norm_phone(body["identifier"])
        em = str(body["identifier"]).strip().lower()
        rec = next((a["payload"] for a in auths if a["payload"] and a["payload"].get("is_active")
                    and (pauth.norm_phone(a["payload"].get("phone")) == np
                         or (a["payload"].get("email") or "").lower() == em)), None)
        if not rec or not pauth.verify_password(body["password"], rec.get("password_hash")):
            return _err(401, "Invalid credentials.")
        token = pauth.sign_token({"school_id": body["school_id"], "parent_id": rec["parent_id"]})
        return {"ok": True, "token": token,
                "parent": {"full_name": rec.get("full_name"), "phone": rec.get("phone"), "email": rec.get("email")}}

    # ── One sign-in box (public) ──
    # The app used to ask "parent or staff?" before it asked who you were.
    # Nobody answers that at a school gate, and getting it wrong reads as a
    # wrong password. A staff username is matched first, then a parent's phone
    # or email, and the reply says which surface the account belongs to. A match
    # ends it, so an account is never authenticated twice against two different
    # passwords.
    @app.post("/api/v1/signin")
    async def signin(request: Request):
        body = await _json(request)
        identifier = str(body.get("identifier") or body.get("username") or "").strip()
        if not body.get("school_id") or not identifier or not body.get("password"):
            return _err(400, "school, identifier and password are required")
        if ratelimit.limited(request, "signin", identifier):
            return _err(429, "Too many attempts. Try again shortly.")

        staff_rec = staff_api.find_staff_by_username(S(), body["school_id"], identifier)
        if staff_rec and staff_api.verify_staff_password(body["password"], staff_rec.get("password_hash")):
            return {"ok": True, "role": "staff",
                    "token": staff_api.sign_staff_token(body["school_id"], staff_rec["user_id"]),
                    "user": {"id": staff_rec["user_id"], "full_name": staff_rec.get("full_name"),
                             "username": staff_rec.get("username")}}

        auths = S().list_snapshots(body["school_id"], "parent_auth")
        np = pauth.norm_phone(identifier)
        em = identifier.lower()
        rec = next((a["payload"] for a in auths if a["payload"] and a["payload"].get("is_active")
                    and (pauth.norm_phone(a["payload"].get("phone")) == np
                         or (a["payload"].get("email") or "").lower() == em)), None)
        if rec and pauth.verify_password(body["password"], rec.get("password_hash")):
            return {"ok": True, "role": "parent",
                    "token": pauth.sign_token({"school_id": body["school_id"], "parent_id": rec["parent_id"]}),
                    "parent": {"full_name": rec.get("full_name"), "phone": rec.get("phone"),
                               "email": rec.get("email")}}

        # One message for both tables. Saying "that username exists but the
        # password is wrong" tells an outsider which accounts are real.
        return _err(401, "Those details did not match an account. Check and try again.")

    # ── Parent-token portal ──
    @app.get("/api/v1/portal/me")
    def me(authorization: str = Header(None)):
        claims, rec = require_parent(authorization)
        return {"ok": True, "parent": {"full_name": rec.get("full_name"), "phone": rec.get("phone"), "email": rec.get("email")},
                "school": S().get_school(claims["school_id"])}

    @app.get("/api/v1/portal/children")
    def children(authorization: str = Header(None)):
        claims, rec = require_parent(authorization)
        by_key = {s["entity_key"]: s["payload"] for s in S().list_snapshots(claims["school_id"], "student_snapshot")}
        kids = [by_key[k] for k in (rec.get("student_keys") or []) if k in by_key]
        return {"ok": True, "children": kids}

    @app.get("/api/v1/portal/announcements")
    def announcements(authorization: str = Header(None)):
        claims, rec = require_parent(authorization)
        mine = set(rec.get("student_keys") or [])
        items = [s["payload"] for s in S().list_snapshots(claims["school_id"], "announcement")
                 if s["payload"] and s["payload"].get("is_active")
                 and (s["payload"].get("audience") == "all"
                      or (s["payload"].get("audience") == "student" and f"student:{s['payload'].get('student_id')}" in mine))]
        items.sort(key=lambda a: str(a.get("created_at")), reverse=True)
        return {"ok": True, "announcements": items}

    @app.get("/api/v1/portal/receipts")
    def receipts(authorization: str = Header(None)):
        claims, rec = require_parent(authorization)
        mine = set(rec.get("student_keys") or [])
        rcs = [s["payload"] for s in S().list_snapshots(claims["school_id"], "receipt")
               if s["payload"] and f"student:{s['payload'].get('student_id')}" in mine]
        rcs.sort(key=lambda r: str(r.get("date")), reverse=True)
        return {"ok": True, "receipts": rcs}

    @app.get("/api/v1/portal/messages")
    def messages(authorization: str = Header(None)):
        claims, rec = require_parent(authorization)
        threads = [s["payload"] for s in S().list_snapshots(claims["school_id"], "message_thread")
                   if s["payload"] and s["payload"].get("parent_id") == claims["parent_id"]]
        threads.sort(key=lambda t: str(t.get("last_message_at") or ""), reverse=True)
        return {"ok": True, "threads": threads}

    # ── Settling a bill over the internet ──
    # What the parent's app asks before it draws the screen: is there a gateway
    # here at all, what is owed, and what the school's own channels are for a
    # school that has not switched one on.
    @app.get("/api/v1/portal/payment-options")
    def payment_options(student_id: str = None, authorization: str = Header(None)):
        claims, rec = require_parent(authorization)
        if not student_id or f"student:{student_id}" not in set(rec.get("student_keys") or []):
            return _err(403, "Not your child.")
        child = next((s["payload"] for s in S().list_snapshots(claims["school_id"], "student_snapshot")
                      if s["entity_key"] == f"student:{student_id}"), None)
        profile = next((s["payload"] for s in S().list_snapshots(claims["school_id"], "school_profile")
                        if s.get("payload")), {}) or {}
        fees = (child or {}).get("fees") or {}
        contact = profile.get("contact") or {}
        return {
            "ok": True,
            "balance": float(fees.get("balance") or 0),
            "currency": profile.get("currency") or "GHS",
            "online": cloud_payments.availability(S(), claims["school_id"]),
            "offline": {
                "declare": True,
                "whatsapp": contact.get("whatsapp") or contact.get("phone") or "",
                "phone": contact.get("phone") or "",
            },
        }

    @app.post("/api/v1/portal/pay")
    async def portal_pay(request: Request, authorization: str = Header(None)):
        claims, rec = require_parent(authorization)
        if ratelimit.limited(request, "pay", str(claims["parent_id"])):
            return _err(429, "Too many attempts. Try again shortly.")
        body = await _json(request)
        return _send(cloud_payments.create_checkout(
            S(), claims["school_id"], claims["parent_id"], body.get("student_id"),
            body.get("amount"), rec.get("email"), set(rec.get("student_keys") or [])))

    # Where the app comes back to. It does not take the app's word that the
    # payment worked — it asks the gateway. So a phone that never returns costs
    # nothing: the webhook settles it regardless.
    @app.get("/api/v1/portal/payments/{reference}")
    def portal_payment_status(reference: str, authorization: str = Header(None)):
        claims, rec = require_parent(authorization)
        return _send(cloud_payments.status(S(), claims["school_id"], reference,
                                           set(rec.get("student_keys") or [])))

    # A payment made at the bank, declared. Not a payment: a message with a
    # number on it, which the office confirms against its own statement. It
    # reaches the desktop as a pending intent and nothing more.
    @app.post("/api/v1/portal/declare-payment")
    async def portal_declare(request: Request, authorization: str = Header(None)):
        claims, rec = require_parent(authorization)
        body = await _json(request)
        student_id = str(body.get("student_id") or "")
        if not student_id or f"student:{student_id}" not in set(rec.get("student_keys") or []):
            return _err(403, "Not your child.")
        try:
            amount = float(body.get("amount"))
        except (TypeError, ValueError):
            amount = 0
        if amount <= 0:
            return _err(400, "Enter the amount you paid.")
        reference = str(body.get("reference") or "").strip()[:80]
        if not reference:
            return _err(400, "Enter the transaction or deposit reference, so the office can find it.")
        if ratelimit.limited(request, "declare", str(claims["parent_id"])):
            return _err(429, "Too many attempts. Try again shortly.")
        channel = body.get("channel")
        S().enqueue_change(claims["school_id"], {
            "type": "payment_declared",
            "payload": {
                "student_id": student_id, "parent_id": claims["parent_id"], "amount": amount,
                "channel": channel if channel in ("bank", "mobile_money", "cash") else "bank",
                "reference": reference, "notes": str(body.get("notes") or "")[:300],
                "declared_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
        })
        return {"ok": True,
                "message": "The office has it. Your account updates once they confirm it against the school’s statement."}

    @app.post("/api/v1/portal/profile")
    async def profile(request: Request, authorization: str = Header(None)):
        claims, rec = require_parent(authorization)
        body = await _json(request)
        patch = {}
        if isinstance(body.get("full_name"), str):
            patch["full_name"] = body["full_name"]
        if isinstance(body.get("email"), str):
            patch["email"] = body["email"]
        if not patch:
            return _err(400, "Nothing to update.")
        S().upsert_snapshot(claims["school_id"], {
            "entity_type": "parent_auth", "entity_key": f"parent:{claims['parent_id']}",
            "uuid": rec.get("uuid"), "op": "upsert", "version": (rec.get("version") or 1) + 1,
            "payload": {**rec, **patch}})
        S().enqueue_change(claims["school_id"], {"type": "parent_update", "payload": {"parent_id": claims["parent_id"], **patch}})
        return {"ok": True}

    # ── School-key: sync ──
    # ── Staff: what lets a teacher work with the school's desktop switched off ──
    # The account, its password hash and its permissions are all projected up
    # by that desktop; the cloud only verifies, serves the read model, and
    # queues writes for the desktop to apply.
    def require_staff(authorization):
        token = authorization[7:] if authorization and authorization.startswith("Bearer ") else None
        claims = staff_api.staff_claims(token)
        if not claims:
            raise HTTPException(status_code=401, detail={"ok": False, "error": "Please sign in."})
        rec = staff_api.load_staff(S(), claims["school_id"], claims["user_id"])
        # Deactivated on the desktop and re-projected: the session dies with the
        # next request rather than lasting until the token expires.
        if not rec:
            raise HTTPException(status_code=401, detail={"ok": False, "error": "Account unavailable."})
        return claims, rec

    def _deny():
        return JSONResponse(status_code=403, content={"ok": False, "error": "Access denied."})

    def _send(result):
        if result.get("ok"):
            return result
        return JSONResponse(status_code=result.get("status", 400),
                            content={"ok": False, "error": result.get("error", "Bad request.")})

    @app.post("/api/v1/staff/login")
    async def staff_login(request: Request):
        body = await _json(request)
        if not body.get("school_id") or not body.get("username") or not body.get("password"):
            return _err(400, "school, username and password are required")
        if ratelimit.limited(request, "staff", body.get("username")):
            return _err(429, "Too many attempts. Try again shortly.")
        rec = staff_api.find_staff_by_username(S(), body["school_id"], body["username"])
        if not rec or not staff_api.verify_staff_password(body["password"], rec.get("password_hash")):
            return _err(401, "Invalid username or password.")
        return {
            "ok": True,
            "token": staff_api.sign_staff_token(body["school_id"], rec["user_id"]),
            "user": {"id": rec["user_id"], "full_name": rec.get("full_name"), "username": rec.get("username")},
        }

    @app.get("/api/v1/staff/me")
    def staff_me(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        # Which portals this account holds, from the same rules the desktop
        # applies. One of them cannot be served from here at all — the app is
        # told which, and why, rather than handed a door that opens onto an
        # error.
        held = []
        for entry in portal_model.portal_list_for(rec):
            if entry["key"] == "system":
                held.append({**entry, "available": False,
                             "reason": "Administered on the school's own network."})
            else:
                held.append({**entry, "available": True})
        return {
            "ok": True, "role": "staff", "mode": "cloud",
            "user": {"id": rec["user_id"], "full_name": rec.get("full_name"),
                     "username": rec.get("username"), "staff_id": rec.get("staff_id")},
            "designation": rec.get("designation"), "is_admin": bool(rec.get("is_admin")),
            "must_change_password": bool(rec.get("must_change_password")),
            "permissions": rec.get("permissions") or {}, "school": S().get_school(claims["school_id"]),
            "portals": held,
            "home_portal": portal_model.home_portal(rec),
        }

    # ── The finance office and the administration, off-LAN ──
    # Summaries the desktop projected, and the two approvals that move no
    # money. See app/office.py for what is deliberately absent.
    @app.get("/api/v1/staff/finance/overview")
    def staff_finance_overview(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(office.finance_overview(S(), claims["school_id"], rec))

    @app.get("/api/v1/staff/finance/debtors")
    def staff_finance_debtors(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(office.finance_debtors(S(), claims["school_id"], rec))

    @app.get("/api/v1/staff/admin/overview")
    def staff_admin_overview(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(office.admin_overview(S(), claims["school_id"], rec))

    @app.get("/api/v1/staff/admin/approvals")
    def staff_admin_approvals(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(office.approvals(S(), claims["school_id"], rec))

    @app.post("/api/v1/staff/admin/leave/decision")
    async def staff_leave_decision(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(office.submit_decision(S(), claims["school_id"], rec, "leave", await _json(request)))

    @app.post("/api/v1/staff/admin/lesson-note/decision")
    async def staff_note_decision(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(office.submit_decision(S(), claims["school_id"], rec, "lesson_note", await _json(request)))

    # Taking money, and the system portal, are not served from here at all.
    # Answered plainly so the app can say why rather than 404.
    @app.get("/api/v1/staff/finance/collections")
    @app.post("/api/v1/staff/finance/collections")
    @app.get("/api/v1/staff/finance/payroll")
    def staff_finance_host_only(authorization: str = Header(None)):
        require_staff(authorization)
        return JSONResponse(status_code=400, content={
            "ok": False, "host_only": True,
            "error": "The school's own system records money and runs payroll. Connect on the school Wi-Fi."})

    @app.get("/api/v1/staff/system/{rest:path}")
    @app.post("/api/v1/staff/system/{rest:path}")
    def staff_system_host_only(rest: str, authorization: str = Header(None)):
        require_staff(authorization)
        return JSONResponse(status_code=400, content={
            "ok": False, "host_only": True,
            "error": "Accounts, access and the audit trail are administered on the school's own network."})

    @app.get("/api/v1/staff/dashboard")
    def staff_dashboard(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "dashboard", "view"):
            return _deny()
        return _send(staff_api.dashboard(S(), claims["school_id"], rec))

    @app.get("/api/v1/staff/students")
    def staff_students(classId: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "students", "view"):
            return _deny()
        return _send(staff_api.students(S(), claims["school_id"], classId, rec))

    @app.get("/api/v1/staff/debtors")
    def staff_debtors(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "fees", "view"):
            return _deny()
        return _send(staff_api.debtors(S(), claims["school_id"]))

    @app.get("/api/v1/staff/classes")
    def staff_classes(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can_any(rec, [("students", "view"), ("academics", "view"), ("canteen", "view")]):
            return _deny()
        return _send(staff_api.classes(S(), claims["school_id"], rec))

    @app.get("/api/v1/staff/attendance")
    def staff_attendance(classId: str = None, date: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can_any(rec, [("students", "view"), ("academics", "view")]):
            return _deny()
        if not classId or not date:
            return _err(400, "classId and date are required.")
        return _send(staff_api.attendance_sheet(S(), claims["school_id"], classId, date, rec))

    @app.post("/api/v1/staff/attendance")
    async def staff_attendance_post(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can_any(rec, [("students", "edit"), ("academics", "edit")]):
            return _deny()
        return _send(staff_api.submit_attendance(S(), claims["school_id"], rec, await _json(request)))

    @app.get("/api/v1/staff/scores/subjects")
    def staff_score_subjects(classId: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "view"):
            return _deny()
        if not classId:
            return _err(400, "classId is required.")
        return _send(staff_api.score_subjects(S(), claims["school_id"], classId, rec))

    @app.get("/api/v1/staff/scores")
    def staff_scores(classId: str = None, subjectId: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "view"):
            return _deny()
        if not classId or not subjectId:
            return _err(400, "classId and subjectId are required.")
        return _send(staff_api.score_sheet(S(), claims["school_id"], classId, subjectId, rec))

    @app.post("/api/v1/staff/scores")
    async def staff_scores_post(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "edit"):
            return _deny()
        return _send(staff_api.submit_scores(S(), claims["school_id"], rec, await _json(request)))

    @app.get("/api/v1/staff/canteen/student/{student_id}")
    def staff_canteen_student(student_id: str, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "canteen", "view"):
            return _deny()
        return _send(staff_api.canteen_student(S(), claims["school_id"], student_id, rec))

    @app.post("/api/v1/staff/canteen/collect")
    async def staff_canteen_collect(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "canteen", "create"):
            return _deny()
        return _send(staff_api.submit_canteen(S(), claims["school_id"], rec, await _json(request)))

    @app.get("/api/v1/staff/timetable/mine")
    def staff_timetable(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.timetable_mine(S(), claims["school_id"], rec))

    @app.get("/api/v1/staff/homework")
    def staff_homework(classId: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "view"):
            return _deny()
        if not classId:
            return _err(400, "classId is required.")
        return _send(staff_api.homework_for_class(S(), claims["school_id"], classId, rec))

    @app.post("/api/v1/staff/homework")
    async def staff_homework_post(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "edit"):
            return _deny()
        return _send(staff_api.submit_homework(S(), claims["school_id"], rec, await _json(request)))

    @app.get("/api/v1/staff/subjects")
    def staff_subjects(classId: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "view"):
            return _deny()
        return _send(staff_api.all_subjects(S(), claims["school_id"], rec, classId))

    @app.get("/api/v1/staff/students/{student_id}/parents")
    def staff_student_parents(student_id: str, authorization: str = Header(None)):
        # Contacts live on the roster as guardian names and numbers; the portal
        # has no parent accounts to start a thread against, so this answers
        # empty rather than pretending otherwise.
        _claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "notifications", "view"):
            return _deny()
        return {"ok": True, "parents": []}

    @app.get("/api/v1/staff/students/{student_id}")
    def staff_student(student_id: str, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "students", "view"):
            return _deny()
        return _send(staff_api.student_profile(S(), claims["school_id"], student_id, rec))

    @app.get("/api/v1/staff/attendance/history")
    def staff_attendance_history(classId: str = None, days: int = 30, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can_any(rec, [("students", "view"), ("academics", "view")]):
            return _deny()
        if not classId:
            return _err(400, "classId is required.")
        return _send(staff_api.attendance_history(S(), claims["school_id"], classId, days, rec))

    @app.get("/api/v1/staff/assessments")
    def staff_assessments(classId: str = None, subjectId: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "view"):
            return _deny()
        if not classId or not subjectId:
            return _err(400, "classId and subjectId are required.")
        return _send(staff_api.assessment_sheet(S(), claims["school_id"], classId, subjectId, rec))

    @app.post("/api/v1/staff/assessments")
    async def staff_assessments_post(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "edit"):
            return _deny()
        return _send(staff_api.submit_assessments(S(), claims["school_id"], rec, await _json(request)))

    @app.post("/api/v1/staff/assessments/column")
    async def staff_assessment_column(request: Request, authorization: str = Header(None)):
        # The desktop numbers the column; marks queued against an id this side
        # invented would arrive pointing at nothing.
        require_staff(authorization)
        return _err(400, "Adding an assessment column needs the school's own system. "
                         "Connect on the school Wi-Fi to add one; marks against the columns "
                         "already there save from anywhere.")

    @app.get("/api/v1/staff/results")
    def staff_results(classId: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "view"):
            return _deny()
        if not classId:
            return _err(400, "classId is required.")
        return _send(staff_api.results_broadsheet(S(), claims["school_id"], classId, rec))

    @app.get("/api/v1/staff/results/student/{student_id}")
    def staff_student_report(student_id: str, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "view"):
            return _deny()
        return _send(staff_api.student_report(S(), claims["school_id"], student_id, rec))

    @app.post("/api/v1/staff/results/remarks")
    async def staff_remarks(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "edit"):
            return _deny()
        return _send(staff_api.submit_remarks(S(), claims["school_id"], rec, await _json(request)))

    @app.get("/api/v1/staff/canteen/class")
    def staff_canteen_class(classId: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "canteen", "view"):
            return _deny()
        if not classId:
            return _err(400, "classId is required.")
        return _send(staff_api.canteen_class(S(), claims["school_id"], classId, rec))

    @app.get("/api/v1/staff/lesson-notes")
    def staff_lesson_notes(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.lesson_notes(S(), claims["school_id"], rec))

    @app.post("/api/v1/staff/lesson-notes")
    async def staff_lesson_note_post(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.submit_lesson_note(S(), claims["school_id"], rec, await _json(request)))

    @app.get("/api/v1/staff/lesson-notes/{note_id}")
    def staff_lesson_note(note_id: str, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.lesson_note(S(), claims["school_id"], rec, note_id))

    @app.get("/api/v1/staff/hr/me")
    def staff_hr_me(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.staff_profile(S(), claims["school_id"], rec))

    @app.get("/api/v1/staff/hr/attendance")
    def staff_hr_attendance(month: int = None, year: int = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        prof = staff_api.staff_profile(S(), claims["school_id"], rec)
        today = datetime.date.today()
        m, y = month or today.month, year or today.year
        prefix = f"{y}-{m:02d}"
        days = [d for d in (prof.get("attendance") or []) if str(d.get("date") or "").startswith(prefix)]
        return {"ok": True, "has_staff": prof.get("has_staff"), "month": m, "year": y, "days": days,
                "summary": {"present": len([d for d in days if d.get("status") == "present"]),
                            "recorded": len(days)}}

    @app.post("/api/v1/staff/hr/clock")
    async def staff_hr_clock(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.submit_clock(S(), claims["school_id"], rec, await _json(request)))

    @app.get("/api/v1/staff/hr/leave")
    def staff_hr_leave(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        prof = staff_api.staff_profile(S(), claims["school_id"], rec)
        return {"ok": True, "has_staff": prof.get("has_staff"), "requests": prof.get("leave_requests") or []}

    @app.post("/api/v1/staff/hr/leave")
    async def staff_hr_leave_post(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.submit_leave(S(), claims["school_id"], rec, await _json(request)))

    @app.get("/api/v1/staff/hr/payslips")
    def staff_hr_payslips(year: int = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        prof = staff_api.staff_profile(S(), claims["school_id"], rec)
        slips = prof.get("payslips") or []
        if year:
            slips = [x for x in slips if x.get("year") == year]
        return {"ok": True, "has_staff": prof.get("has_staff"), "payslips": slips}

    @app.get("/api/v1/staff/messages")
    def staff_messages(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.staff_threads(S(), claims["school_id"], rec))

    @app.post("/api/v1/staff/messages")
    async def staff_messages_post(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.submit_message(S(), claims["school_id"], rec, await _json(request)))

    @app.get("/api/v1/staff/messages/{thread_uuid}")
    def staff_message(thread_uuid: str, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.staff_thread(S(), claims["school_id"], rec, thread_uuid))

    @app.get("/api/v1/staff/announcements")
    def staff_announcements(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.announcements(S(), claims["school_id"], rec))

    @app.post("/api/v1/staff/announcements")
    async def staff_announcements_post(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.submit_announcement(S(), claims["school_id"], rec, await _json(request)))

    @app.get("/api/v1/staff/pending")
    def staff_pending(authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        return _send(staff_api.pending_summary(S(), claims["school_id"], rec))

    @app.get("/api/v1/sync/ping")
    def ping(x_school_key: str = Header(None)):
        school = require_school(x_school_key)
        return {"ok": True, "school": {"id": school["school_id"], "name": school["name"]}}

    @app.post("/api/v1/sync/push")
    async def push(request: Request, x_school_key: str = Header(None)):
        school = require_school(x_school_key)
        body = await _json(request)
        accepted = []
        for r in (body.get("records") or []):
            if not r or not r.get("entity_type") or not r.get("entity_key"):
                continue
            S().upsert_snapshot(school["school_id"], r)
            if r.get("uuid"):
                accepted.append(r["uuid"])
        return {"ok": True, "accepted": accepted}

    @app.get("/api/v1/sync/pull")
    def pull(since: str = "0", x_school_key: str = Header(None)):
        school = require_school(x_school_key)
        res = S().changes_since(school["school_id"], since)
        return {"ok": True, "cursor": res["cursor"], "changes": res["changes"]}

    # ── The gateway's webhook (public by necessity) ──
    # The gateway has no account here, so this route is open — and therefore
    # the most carefully guarded one in the service. The signature is checked
    # over the RAW bytes against the school's own secret before the body is
    # believed about anything, a bad one is answered 401 and nothing else, and
    # the amount is never read from the body: settlement asks the gateway
    # directly. See app/payments.py.
    @app.post("/api/v1/payments/webhook/{school_id}")
    async def payment_webhook(school_id: str, request: Request):
        raw = (await request.body()).decode("utf-8", "replace")
        cfg = cloud_payments.config(S(), school_id)
        signature = request.headers.get("x-paystack-signature") or request.headers.get("x-signature") or ""
        if not cfg or not cloud_payments.verify_webhook(cfg.get("secret"), signature, raw):
            return _err(401, "Unauthorized")
        try:
            payload = json.loads(raw) if raw else {}
        except ValueError:
            payload = {}
        if payload.get("event") == "charge.success" and (payload.get("data") or {}).get("reference"):
            try:
                cloud_payments.settle(S(), school_id, payload["data"]["reference"])
            except Exception:                            # pragma: no cover
                pass
        return {"ok": True}

    # ── School-key: admin (portal backend / read model) ──
    @app.get("/api/v1/admin/snapshots")
    def admin_snapshots(type: str = None, x_school_key: str = Header(None)):
        school = require_school(x_school_key)
        return {"ok": True, "snapshots": S().list_snapshots(school["school_id"], type)}

    # The school's gateway, pushed by its own desktop when the school switches
    # internet payments on. Write only: there is no route that reads `secret`
    # back, and there must never be one. A school changing its key re-enters it
    # on the desktop, which is where it came from.
    @app.post("/api/v1/admin/payment-config")
    async def admin_payment_config(request: Request, x_school_key: str = Header(None)):
        school = require_school(x_school_key)
        body = await _json(request)
        if not hasattr(S(), "set_payment_config"):
            return _err(501, "This service does not hold gateway configuration.")
        gateway = str(body.get("gateway") or "none")
        if gateway != "none" and not str(body.get("secret") or ""):
            return _err(400, "A gateway needs its secret key.")
        S().set_payment_config(school["school_id"], None if gateway == "none" else {
            "gateway": gateway,
            "secret": str(body.get("secret")),
            "public_key": str(body.get("public_key") or ""),
            "base_url": str(body.get("base_url") or ""),
            "currency": str(body.get("currency") or "GHS"),
            "callback_url": str(body.get("callback_url") or ""),
            "min_amount": float(body.get("min_amount") or 1),
            "max_amount": float(body.get("max_amount") or 10000),
            "enabled": body.get("enabled") is not False,
        })
        return {"ok": True, "gateway": gateway, "configured": gateway != "none"}

    @app.post("/api/v1/admin/enqueue-change")
    async def admin_enqueue(request: Request, x_school_key: str = Header(None)):
        school = require_school(x_school_key)
        body = await _json(request)
        if not body.get("type"):
            return _err(400, "type required")
        cid = S().enqueue_change(school["school_id"], {"type": body["type"], "payload": body.get("payload", {})})
        return {"ok": True, "id": cid}

    # ── Web app static files (registered last, so it can never shadow the API) ──
    @app.get("/{full_path:path}")
    def web_app(full_path: str):
        if not webapp.is_available():
            raise HTTPException(status_code=404, detail={"ok": False, "error": "not found"})
        url_path = "/" + full_path
        if url_path.startswith("/api/"):
            raise HTTPException(status_code=404, detail={"ok": False, "error": "not found"})

        found = webapp.resolve(url_path)
        if found:
            return FileResponse(found, media_type=webapp.content_type(found), headers={
                "Cache-Control": webapp.cache_header(url_path),
                "X-Content-Type-Options": "nosniff",
            })

        # Single-page output: /parent/child/7 and every other client-side route
        # has no file of its own, so unmatched paths get the shell and the
        # router takes it from there. A path that plainly wants a file gets a
        # 404 rather than HTML pretending to be a script.
        if not os.path.splitext(url_path)[1]:
            return FileResponse(webapp.shell(), media_type="text/html; charset=utf-8",
                                headers={"Cache-Control": "no-cache"})
        raise HTTPException(status_code=404, detail={"ok": False, "error": "not found"})

    return app


async def _json(request: Request):
    try:
        return await request.json()
    except Exception:
        return {}


def _err(code, msg):
    return JSONResponse(status_code=code, content={"ok": False, "error": msg})


# Module-level app for `uvicorn app.main:app`.
app = create_app()
