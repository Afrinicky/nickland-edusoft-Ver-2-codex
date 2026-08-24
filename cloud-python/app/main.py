"""Nickland Edusoft Cloud — FastAPI portal + sync service (Python).

Same HTTP contract as the original Node service, so the (JS) desktop sync
client and the parent web app work against it unchanged. Two auth schemes:
  • x-school-key  → /api/v1/sync/*  and  /api/v1/admin/*   (desktop + portal backend)
  • Bearer token  → /api/v1/portal/* (schools + login public; rest need the token)
The cloud holds only the thin read model + change queue; the desktop stays the
source of truth.
"""
import os
from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware

from . import portal_auth as pauth
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
        return {
            "ok": True, "role": "staff", "mode": "cloud",
            "user": {"id": rec["user_id"], "full_name": rec.get("full_name"),
                     "username": rec.get("username"), "staff_id": rec.get("staff_id")},
            "designation": rec.get("designation"), "is_admin": bool(rec.get("is_admin")),
            "permissions": rec.get("permissions") or {}, "school": S().get_school(claims["school_id"]),
        }

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
        return _send(staff_api.students(S(), claims["school_id"], classId))

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
        return _send(staff_api.classes(S(), claims["school_id"]))

    @app.get("/api/v1/staff/attendance")
    def staff_attendance(classId: str = None, date: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can_any(rec, [("students", "view"), ("academics", "view")]):
            return _deny()
        if not classId or not date:
            return _err(400, "classId and date are required.")
        return _send(staff_api.attendance_sheet(S(), claims["school_id"], classId, date))

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
        return _send(staff_api.score_subjects(S(), claims["school_id"], classId))

    @app.get("/api/v1/staff/scores")
    def staff_scores(classId: str = None, subjectId: str = None, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "view"):
            return _deny()
        if not classId or not subjectId:
            return _err(400, "classId and subjectId are required.")
        return _send(staff_api.score_sheet(S(), claims["school_id"], classId, subjectId))

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
        return _send(staff_api.canteen_student(S(), claims["school_id"], student_id))

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
        return _send(staff_api.homework_for_class(S(), claims["school_id"], classId))

    @app.post("/api/v1/staff/homework")
    async def staff_homework_post(request: Request, authorization: str = Header(None)):
        claims, rec = require_staff(authorization)
        if not staff_api.can(rec, "academics", "edit"):
            return _deny()
        return _send(staff_api.submit_homework(S(), claims["school_id"], rec, await _json(request)))

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

    # ── School-key: admin (portal backend / read model) ──
    @app.get("/api/v1/admin/snapshots")
    def admin_snapshots(type: str = None, x_school_key: str = Header(None)):
        school = require_school(x_school_key)
        return {"ok": True, "snapshots": S().list_snapshots(school["school_id"], type)}

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
