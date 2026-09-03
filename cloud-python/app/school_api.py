"""The online school — the whole of it, over HTTP.

Everything the offline system does, reachable from a browser or a phone, with
access control that is stricter than the desktop's rather than looser. The
desktop sits in a locked office; this is on the internet, and the difference
shows up in four places:

  1. THE PORTAL IS CHECKED AS WELL AS THE PERMISSION. A route belongs to a
     portal, and an account that may not enter that portal is refused before
     the module permission is even consulted. What you cannot do, you cannot
     see — and you cannot reach it by typing its address either.
  2. EVERY REQUEST RE-RESOLVES THE ACCOUNT. The permission map, the designation
     and the teaching scope are read from the database on every call, so a
     permission withdrawn in the office takes effect on the next tap.
  3. SESSIONS ARE SHORTER, AND REVOCABLE. A password change, a deactivation or
     a change of role signs every device out at once.
  4. WRITES ARE AUDITED, INCLUDING THE REFUSALS. A pattern of denials is the
     earliest sign anybody gets that an account has been taken.

The bearer token carries the school it belongs to — ``<school_id>.<token>`` —
so one credential names both the tenant and the session, and a token from one
school cannot be presented to another: the hash is only findable inside that
school's own schema.
"""
import functools
import inspect

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from . import portals, ratelimit
from .school import (academics, admin, canteen, communications, db as sdb, fees,
                     finance, homework, payments, payroll, security, session,
                     staff, stores, students, timetable)

router = APIRouter(prefix="/api/v1/school")


def _err(code, message, **extra):
    return JSONResponse(status_code=code, content={"ok": False, "error": message, **extra})


def _send(result):
    """A module's answer, as HTTP.

    The modules return ``{"ok": False, "status": 4xx, "error": …}`` rather than
    raising, because that is what the offline handlers do and keeping the shape
    means the two can be read side by side.
    """
    if isinstance(result, dict) and not result.get("ok"):
        return _err(result.get("status", 400), result.get("error", "That did not work."),
                    **{k: v for k, v in result.items() if k not in ("ok", "status", "error")})
    return result


def _split_token(authorization):
    """`<school_id>.<token>` → the school and the token."""
    if not authorization or not authorization.startswith("Bearer "):
        return None, None
    raw = authorization[7:]
    if "." not in raw:
        return None, None
    school_id, _, token = raw.partition(".")
    return school_id, token


class Denied(Exception):
    def __init__(self, response):
        self.response = response


def require(authorization, portal=None, module=None, action="view"):
    """Resolve the caller, and refuse them if this is not theirs.

    Order matters. The portal is checked first because it answers "is this
    person in this part of the school at all", and that is the answer that
    decides whether a route may admit to existing.
    """
    school_id, token = _split_token(authorization)
    if not school_id or not token:
        raise Denied(_err(401, "Please sign in."))
    db = sdb.SchoolDb(school_id)
    try:
        actor = session.actor_for(db, token)
    except Exception:
        raise Denied(_err(401, "Please sign in."))
    if not actor:
        raise Denied(_err(401, "Please sign in."))

    if portal and not portals.has_portal(actor, portal):
        security.deny(db, actor, f"portal:{portal}", "Access denied.")
        raise Denied(_err(403, "Access denied."))
    if module and not security.can(actor, module, action):
        security.deny(db, actor, f"{module}:{action}",
                      f"You do not have permission to {action} {module}.")
        raise Denied(_err(403, f"Access denied. You do not have permission to {action} {module}."))
    return db, actor


def guarded(portal=None, module=None, action="view"):
    """Wrap a handler so it is only reached by somebody entitled to it.

    The handler is written as ``(db, actor, …)`` — the school it is acting on
    and the person acting — and everything after that is FastAPI's to fill in.
    The signature handed to FastAPI is therefore the handler's own with those
    two removed and the Authorization header added, so a route declares only
    what a caller actually sends and cannot be tricked into accepting ``db``
    as a query parameter.
    """
    def wrap(fn):
        original = inspect.signature(fn)
        outer_params = [p for name, p in original.parameters.items()
                        if name not in ("db", "actor")]
        outer_params.append(inspect.Parameter(
            "authorization", inspect.Parameter.KEYWORD_ONLY,
            default=Header(None), annotation=str))

        @functools.wraps(fn)
        async def inner(*args, **kwargs):
            authorization = kwargs.pop("authorization", None)
            try:
                db, actor = require(authorization, portal, module, action)
            except Denied as d:
                return d.response
            return _send(await fn(db, actor, *args, **kwargs))

        # functools.wraps sets __wrapped__, which inspect.signature follows —
        # so without this FastAPI would read the ORIGINAL signature and try to
        # inject `db` and `actor` from the query string.
        inner.__signature__ = original.replace(parameters=outer_params)
        del inner.__wrapped__
        return inner
    return wrap


async def _json(request: Request):
    try:
        return await request.json()
    except Exception:
        return {}


# ══ sign in ═════════════════════════════════════════════════════════════════

@router.post("/signin")
async def signin(request: Request):
    body = await _json(request)
    school_id = str(body.get("school_id") or "").strip()
    if not school_id:
        return _err(400, "Which school?")
    # Throttled by SOURCE as well as by account. The per-account limit lives in
    # session.sign_in and is the one that actually stops a slow guess; this one
    # stops somebody working through a school's whole user list from one place,
    # and it runs before the school is even looked up so a stranger cannot use
    # this route to find out which schools exist.
    if ratelimit.limited(request, "school-signin", body.get("username")):
        return _err(429, "Too many attempts. Try again shortly.")
    try:
        db = sdb.SchoolDb(school_id)
        if not db.exists():
            # The same answer as a wrong password. Probing school ids should
            # not tell an outsider which schools this service holds.
            return _err(401, "Those details did not match an account. Check and try again.")
    except ValueError:
        return _err(400, "Which school?")

    result = session.sign_in(db, body.get("username"), body.get("password"),
                             device=body.get("device"),
                             platform=body.get("platform") or "online",
                             source=ratelimit.client_ip(request))
    if not result.get("ok"):
        return _err(result.get("status", 401), result["error"])

    actor = session.actor_for(db, result["token"])
    return {
        "ok": True,
        # The credential names the tenant as well as the session, so a token
        # from one school cannot be presented to another.
        "token": f'{school_id}.{result["token"]}',
        "expires_at": result["expires_at"],
        "user": result["user"], "designation": result["designation"],
        "must_change_password": result["must_change_password"],
        "portals": portals.portal_list_for(actor),
        "home_portal": portals.home_portal(actor),
        "permissions": actor["permissions"],
        "is_admin": actor["is_admin"], "is_super": actor["is_super"],
        "school": {"id": school_id, "name": db.get_setting("school_name", "School")},
    }


@router.get("/me")
async def me(authorization: str = Header(None)):
    try:
        db, actor = require(authorization)
    except Denied as d:
        return d.response
    return {
        "ok": True, "role": "staff", "mode": "online",
        "user": {"id": actor["user_id"], "username": actor["username"],
                 "full_name": actor["full_name"], "staff_id": actor["staff_id"]},
        "designation": actor["designation"],
        "is_admin": actor["is_admin"], "is_super": actor["is_super"],
        "must_change_password": actor["must_change_password"],
        "permissions": actor["permissions"],
        "portals": portals.portal_list_for(actor),
        "home_portal": portals.home_portal(actor),
        "school": {"id": db.school_id, "name": db.get_setting("school_name", "School")},
    }


@router.post("/password")
async def change_password(request: Request, authorization: str = Header(None)):
    try:
        db, actor = require(authorization)
    except Denied as d:
        return d.response
    body = await _json(request)
    result = session.change_own_password(
        db, actor, body.get("current_password") or body.get("currentPassword"),
        body.get("new_password") or body.get("newPassword"))
    if not result.get("ok"):
        return _err(result.get("status", 400), result["error"])
    # The new session is returned with the school on the front of it, like the
    # one sign-in hands out — the old ones have just been revoked.
    return {"ok": True, "token": f'{db.school_id}.{result["token"]}',
            "expires_at": result["expires_at"]}


@router.post("/signout")
async def signout(authorization: str = Header(None)):
    try:
        db, actor = require(authorization)
    except Denied as d:
        return d.response
    session.revoke_token(db, actor["token_id"])
    return {"ok": True}


# ══ the school at a glance ══════════════════════════════════════════════════

@router.get("/overview")
async def overview(authorization: str = Header(None)):
    try:
        db, actor = require(authorization)
    except Denied as d:
        return d.response
    return _send(admin.overview(db, actor))


@router.get("/classes")
async def classes(authorization: str = Header(None)):
    """The classes this account may see. `null` from the scope means all of
    them — a head teacher sees the school."""
    try:
        db, actor = require(authorization)
    except Denied as d:
        return d.response
    from .school import scope as scope_lib
    visible = scope_lib.visible_class_ids(db, actor["scope"])
    rows = db.all("""SELECT id, name, short_code, level_category, level_order
                       FROM class_groups ORDER BY level_order, name""")
    if visible is not None:
        rows = [r for r in rows if r["id"] in visible]
    for r in rows:
        r["is_class_teacher"] = scope_lib.is_class_teacher_of(actor["scope"], r["id"])
    return {"ok": True, "classes": rows}


@router.get("/terms")
async def terms(authorization: str = Header(None)):
    try:
        db, _ = require(authorization)
    except Denied as d:
        return d.response
    return {"ok": True, "terms": db.all("""
      SELECT t.id, t.label, t.term_number, t.start_date, t.end_date, t.is_current,
             y.label AS year_label
        FROM terms t LEFT JOIN academic_years y ON y.id = t.academic_year_id
       ORDER BY t.id DESC""")}


# ══ pupils ══════════════════════════════════════════════════════════════════

@router.get("/students")
@guarded(module="students")
async def list_students(db, actor, classId: int = None, status: str = "Active",
                        gender: str = None, q: str = None):
    return students.listing(db, actor, classId, status, gender, q)


@router.get("/students/{student_id}")
@guarded(module="students")
async def get_student(db, actor, student_id: int):
    return students.get(db, actor, student_id)


@router.post("/students")
@guarded(portal="admin", module="students", action="create")
async def admit_student(db, actor, request: Request):
    return students.create(db, actor, await _json(request))


@router.post("/students/{student_id}")
@guarded(portal="admin", module="students", action="edit")
async def update_student(db, actor, student_id: int, request: Request):
    return students.update(db, actor, student_id, await _json(request))


@router.post("/students/{student_id}/status")
@guarded(portal="admin", module="students", action="edit")
async def student_status(db, actor, student_id: int, request: Request):
    body = await _json(request)
    return students.set_status(db, actor, student_id, body.get("status"), body.get("reason"))


@router.post("/students/{student_id}/events")
@guarded(module="students", action="create")
async def student_event(db, actor, student_id: int, request: Request):
    body = await _json(request)
    return students.add_event(db, actor, student_id, body.get("event_type"),
                              body.get("title"), body.get("description"), body.get("date"))


# ══ the register ════════════════════════════════════════════════════════════

@router.get("/attendance")
@guarded(module="academics")
async def attendance(db, actor, classId: int, date: str = None):
    return students.attendance_sheet(db, actor, classId, date)


@router.post("/attendance")
@guarded(module="academics", action="edit")
async def mark_attendance(db, actor, request: Request):
    body = await _json(request)
    return students.mark_attendance(db, actor, body.get("classId") or body.get("class_id"),
                                    body.get("date"), body.get("marks"))


@router.get("/attendance/history")
@guarded(module="academics")
async def attendance_history(db, actor, classId: int, days: int = 30):
    return students.attendance_history(db, actor, classId, days)


# ══ marks ═══════════════════════════════════════════════════════════════════

@router.get("/subjects")
@guarded(module="academics")
async def subjects(db, actor, classId: int):
    return academics.subjects_for_class(db, actor, classId)


@router.get("/scores")
@guarded(module="academics")
async def scores(db, actor, classId: int, subjectId: int, termId: int = None):
    return academics.score_sheet(db, actor, classId, subjectId, termId)


@router.post("/scores")
@guarded(module="academics", action="edit")
async def save_scores(db, actor, request: Request):
    body = await _json(request)
    return academics.save_marks(db, actor, body.get("subjectId") or body.get("subject_id"),
                                body.get("marks"), body.get("termId"))


@router.get("/assessments")
@guarded(module="academics")
async def assessments(db, actor, classId: int, subjectId: int, termId: int = None):
    return academics.assessment_sheet(db, actor, classId, subjectId, termId)


@router.post("/assessments")
@guarded(module="academics", action="edit")
async def save_assessments(db, actor, request: Request):
    body = await _json(request)
    return academics.save_assessments(db, actor, body.get("classId"), body.get("subjectId"),
                                      body.get("marks"), body.get("termId"))


@router.post("/assessments/column")
@guarded(module="academics", action="create")
async def add_column(db, actor, request: Request):
    body = await _json(request)
    return academics.add_assessment_column(db, actor, body.get("classId"), body.get("subjectId"),
                                           body.get("assessmentType") or body.get("assessment_type"),
                                           body.get("maxMarks") or body.get("max_marks"),
                                           body.get("termId"))


@router.get("/results")
@guarded(module="academics")
async def results(db, actor, classId: int, termId: int = None):
    return academics.broadsheet(db, actor, classId, termId)


@router.get("/results/student/{student_id}")
@guarded(module="academics")
async def student_result(db, actor, student_id: int, termId: int = None):
    return academics.student_report(db, actor, student_id, termId)


@router.post("/results/remarks")
@guarded(module="academics", action="edit")
async def save_remarks(db, actor, request: Request):
    body = await _json(request)
    return academics.save_remarks(db, actor, body.get("studentId") or body.get("student_id"),
                                  body.get("termId") or body.get("term_id"), body)


# ══ fees ════════════════════════════════════════════════════════════════════

@router.get("/fees/overview")
@guarded(portal="finance", module="fees")
async def fees_overview(db, actor):
    return fees.overview(db, actor)


@router.get("/fees/collections")
@guarded(portal="finance", module="fees")
async def fees_collections(db, actor, dateFrom: str = None, dateTo: str = None,
                           classId: int = None, method: str = None):
    return fees.collections(db, actor, dateFrom, dateTo, classId, method)


@router.post("/fees/collections")
@guarded(portal="finance", module="fees", action="create")
async def take_payment(db, actor, request: Request):
    return fees.record_payment(db, actor, await _json(request))


@router.post("/fees/collections/{payment_id}/reverse")
@guarded(portal="finance", module="fees", action="edit")
async def reverse_payment(db, actor, payment_id: int, request: Request):
    body = await _json(request)
    return fees.reverse_payment(db, actor, payment_id, body.get("reason"))


@router.get("/fees/students/{student_id}")
@guarded(portal="finance", module="fees")
async def fees_student(db, actor, student_id: int, termId: int = None):
    return fees.student_account(db, actor, student_id, termId)


@router.get("/fees/debtors")
@guarded(portal="finance", module="fees")
async def fees_debtors(db, actor, classId: int = None, minimum: float = None):
    return fees.debtors(db, actor, classId, minimum)


@router.get("/fees/templates")
@guarded(portal="finance", module="fees")
async def fee_templates(db, actor):
    return fees.templates(db, actor)


@router.get("/fees/templates/{template_id}")
@guarded(portal="finance", module="fees")
async def fee_template(db, actor, template_id: int):
    return fees.template(db, actor, template_id)


@router.post("/fees/templates")
@guarded(portal="finance", module="fees", action="edit")
async def save_fee_template(db, actor, request: Request):
    return fees.save_template(db, actor, await _json(request))


@router.post("/fees/bills")
@guarded(portal="finance", module="fees", action="create")
async def raise_bills(db, actor, request: Request):
    body = await _json(request)
    if body.get("classId"):
        return fees.generate_bills_for_class(db, actor, body["classId"], body.get("termId"))
    return fees.generate_bill(db, actor, body.get("studentId"), body.get("termId"))


# ══ finance ═════════════════════════════════════════════════════════════════

@router.get("/finance/income")
@guarded(portal="finance", module="finance")
async def income(db, actor, dateFrom: str = None, dateTo: str = None, category: str = None):
    return finance.income(db, actor, dateFrom, dateTo, category)


@router.post("/finance/income")
@guarded(portal="finance", module="finance", action="create")
async def record_income(db, actor, request: Request):
    return finance.record_income(db, actor, await _json(request))


@router.get("/finance/expenses")
@guarded(portal="finance", module="finance")
async def expenses(db, actor, dateFrom: str = None, dateTo: str = None, category: str = None):
    return finance.expenses(db, actor, dateFrom, dateTo, category)


@router.post("/finance/expenses")
@guarded(portal="finance", module="finance", action="create")
async def record_expense(db, actor, request: Request):
    return finance.record_expense(db, actor, await _json(request))


@router.post("/finance/expenses/{expense_id}/approve")
@guarded(portal="finance", module="finance", action="edit")
async def approve_expense(db, actor, expense_id: int):
    return finance.approve_expense(db, actor, expense_id)


@router.get("/finance/statement")
@guarded(portal="finance", module="finance")
async def statement(db, actor, termId: int = None, dateFrom: str = None, dateTo: str = None):
    return finance.statement(db, actor, termId, dateFrom, dateTo)


@router.get("/finance/audit")
@guarded(portal="finance", module="finance")
async def finance_audit(db, actor, termId: int = None):
    return finance.audit_checks(db, actor, termId)


# ══ payroll ═════════════════════════════════════════════════════════════════

@router.get("/payroll")
@guarded(portal="finance", module="payroll")
async def payroll_month(db, actor, month: int = None, year: int = None):
    return payroll.month_sheet(db, actor, month, year)


@router.post("/payroll/run")
@guarded(portal="finance", module="payroll", action="edit")
async def run_payroll(db, actor, request: Request):
    body = await _json(request)
    return payroll.run_month(db, actor, body.get("month"), body.get("year"),
                             body.get("paymentDate") or body.get("payment_date"))


@router.post("/payroll/{salary_id}/paid")
@guarded(portal="finance", module="payroll", action="edit")
async def mark_salary_paid(db, actor, salary_id: int, request: Request):
    body = await _json(request)
    return payroll.mark_paid(db, actor, salary_id,
                             body.get("amount") or body.get("actualAmount"),
                             body.get("method"), body.get("reference"), body.get("date"))


@router.get("/payroll/{staff_id}/payslip")
@guarded(portal="finance", module="payroll")
async def get_payslip(db, actor, staff_id: int, month: int = None, year: int = None):
    return payroll.payslip(db, actor, staff_id, month, year)


@router.get("/payroll/{staff_id}/ytd")
@guarded(portal="finance", module="payroll")
async def payroll_ytd(db, actor, staff_id: int, year: int = None):
    return payroll.ytd(db, actor, staff_id, year)


@router.get("/payroll/schedule/{kind}")
@guarded(portal="finance", module="payroll")
async def statutory(db, actor, kind: str, month: int = None, year: int = None):
    if kind not in ("ssnit", "paye"):
        return {"ok": False, "status": 404, "error": "No such schedule."}
    return payroll.statutory_schedule(db, actor, kind, month, year)


# ══ staff ═══════════════════════════════════════════════════════════════════

@router.get("/staff")
@guarded(portal="admin", module="staff")
async def list_staff(db, actor, status: str = "Active"):
    return staff.listing(db, actor, status)


@router.get("/staff/{staff_id}")
@guarded(portal="admin", module="staff")
async def get_staff(db, actor, staff_id: int):
    return staff.get(db, actor, staff_id)


@router.post("/staff")
@guarded(portal="admin", module="staff", action="create")
async def save_staff(db, actor, request: Request):
    return staff.save(db, actor, await _json(request))


@router.post("/staff/{staff_id}/assignments")
@guarded(portal="admin", module="staff", action="edit")
async def set_assignments(db, actor, staff_id: int, request: Request):
    body = await _json(request)
    return staff.set_assignments(db, actor, staff_id, body.get("assignments"))


@router.get("/staff-register")
@guarded(portal="admin", module="staff")
async def staff_register(db, actor, date: str = None):
    return staff.register(db, actor, date)


@router.get("/leave")
@guarded(portal="admin", module="staff")
async def leave_list(db, actor, status: str = "pending"):
    return staff.leave_list(db, actor, status)


@router.post("/leave/{request_id}/decision")
@guarded(portal="admin", module="staff", action="edit")
async def decide_leave(db, actor, request_id: int, request: Request):
    body = await _json(request)
    return staff.decide_leave(db, actor, request_id, body.get("decision"), body.get("notes"))


@router.get("/lesson-notes")
@guarded(module="academics")
async def lesson_notes(db, actor, status: str = None, classId: int = None, mine: bool = False):
    return staff.lesson_notes(db, actor, status, classId, mine)


@router.get("/lesson-notes/{note_id}")
@guarded(module="academics")
async def lesson_note(db, actor, note_id: int):
    return staff.get_lesson_note(db, actor, note_id)


@router.post("/lesson-notes/{note_id}/decision")
@guarded(module="academics", action="edit")
async def decide_note(db, actor, note_id: int, request: Request):
    body = await _json(request)
    return staff.decide_lesson_note(db, actor, note_id, body.get("decision"), body.get("comments"))


# ── your own record. No permission is checked, and none should be. ──────────

@router.get("/my/employment")
async def my_employment(year: int = None, authorization: str = Header(None)):
    try:
        db, actor = require(authorization)
    except Denied as d:
        return d.response
    return _send(staff.me(db, actor, year))


@router.post("/my/clock")
async def my_clock(request: Request, authorization: str = Header(None)):
    try:
        db, actor = require(authorization)
    except Denied as d:
        return d.response
    body = await _json(request)
    return _send(staff.clock(db, actor, body.get("direction") or "in"))


@router.post("/my/leave")
async def my_leave(request: Request, authorization: str = Header(None)):
    try:
        db, actor = require(authorization)
    except Denied as d:
        return d.response
    return _send(staff.request_leave(db, actor, await _json(request)))


@router.post("/my/lesson-notes")
async def my_lesson_note(request: Request, authorization: str = Header(None)):
    try:
        db, actor = require(authorization)
    except Denied as d:
        return d.response
    return _send(staff.save_lesson_note(db, actor, await _json(request)))


# ══ canteen ═════════════════════════════════════════════════════════════════

@router.get("/canteen/student/{student_id}")
@guarded(module="canteen")
async def canteen_student(db, actor, student_id: int, termId: int = None):
    return canteen.student_status(db, actor, student_id, termId)


@router.post("/canteen/collect")
@guarded(module="canteen", action="create")
async def canteen_collect(db, actor, request: Request):
    body = await _json(request)
    return canteen.collect(db, actor, body.get("student_id") or body.get("studentId"),
                           body.get("amount"), body.get("payment_method") or body.get("method"),
                           body.get("notes"), body.get("date"))


@router.get("/canteen/class")
@guarded(module="canteen")
async def canteen_class(db, actor, classId: int, date: str = None):
    return canteen.class_sheet(db, actor, classId, date)


@router.post("/canteen/quick-pay")
@guarded(module="canteen", action="create")
async def canteen_quick_pay(db, actor, request: Request):
    body = await _json(request)
    return canteen.quick_pay(db, actor, body.get("classId"), body.get("studentIds"),
                             body.get("date"), body.get("paymentMethod"))


@router.post("/canteen/exempt")
@guarded(module="canteen", action="edit")
async def canteen_exempt(db, actor, request: Request):
    body = await _json(request)
    return canteen.exempt(db, actor, body.get("classId"), body.get("studentIds"),
                          body.get("date"), body.get("reason"))


@router.get("/canteen/debtors")
@guarded(module="canteen")
async def canteen_debtors(db, actor, termId: int = None):
    return canteen.debtors(db, actor, termId)


# ══ administration ══════════════════════════════════════════════════════════

@router.get("/admin/academics")
@guarded(portal="admin", module="academics")
async def admin_academics(db, actor, termId: int = None):
    return admin.academic_overview(db, actor, termId)


# ══ the system — the Super Admin alone ══════════════════════════════════════
#
# Every route below is additionally gated on the designation itself, not on a
# `settings` tick somebody could be granted by mistake.

def _system(authorization):
    db, actor = require(authorization, portal="system")
    if not security.is_super_admin(actor):
        security.deny(db, actor, "system", "Access denied.")
        raise Denied(_err(403, "Access denied."))
    return db, actor


@router.get("/system/overview")
async def system_overview(authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    return _send(admin.system_overview(db, actor))


@router.get("/system/users")
async def system_users(authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    return _send(admin.users(db, actor))


@router.post("/system/users")
async def system_create_user(request: Request, authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    return _send(admin.create_user(db, actor, await _json(request)))


@router.post("/system/users/{user_id}/status")
async def system_user_status(user_id: int, request: Request, authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    body = await _json(request)
    return _send(admin.set_user_status(db, actor, user_id, bool(body.get("active"))))


@router.post("/system/users/{user_id}/role")
async def system_user_role(user_id: int, request: Request, authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    body = await _json(request)
    return _send(admin.set_user_role(db, actor, user_id,
                                     body.get("designationId") or body.get("designation_id")))


@router.post("/system/users/{user_id}/password")
async def system_user_password(user_id: int, request: Request, authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    body = await _json(request)
    return _send(admin.reset_user_password(db, actor, user_id,
                                           body.get("password") or body.get("newPassword")))


@router.get("/system/access")
async def system_access(authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    return _send(admin.access_matrix(db, actor))


@router.post("/system/access")
async def system_set_access(request: Request, authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    body = await _json(request)
    return _send(admin.set_access(db, actor,
                                  body.get("designationId") or body.get("designation_id"),
                                  body.get("levels")))


@router.get("/system/audit")
async def system_audit(severity: str = None, entity: str = None, action: str = None,
                       userId: int = None, limit: int = 100,
                       authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    return _send(admin.audit_trail(db, actor, severity, entity, action, userId, limit))


@router.get("/system/settings")
async def system_settings(authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    return _send(admin.settings(db, actor))


@router.post("/system/settings")
async def system_save_settings(request: Request, authorization: str = Header(None)):
    try:
        db, actor = _system(authorization)
    except Denied as d:
        return d.response
    body = await _json(request)
    return _send(admin.save_settings(db, actor, body.get("settings") or body))


# ══ the timetable ═══════════════════════════════════════════════════════════

@router.get("/timetable/periods")
@guarded(module="academics")
async def timetable_periods(db, actor):
    return {"ok": True, "periods": timetable.periods(db)}


@router.post("/timetable/periods")
@guarded(portal="admin", module="academics", action="edit")
async def save_period(db, actor, request: Request):
    return timetable.save_period(db, actor, await _json(request))


@router.get("/timetable/class")
@guarded(module="academics")
async def timetable_class(db, actor, classId: int):
    return timetable.class_week(db, actor, classId)


@router.post("/timetable/class")
@guarded(module="academics", action="edit")
async def save_timetable(db, actor, request: Request):
    body = await _json(request)
    return timetable.save_class_week(db, actor, body.get("classId"), body.get("entries"))


@router.get("/timetable/mine")
async def timetable_mine(authorization: str = Header(None)):
    try:
        db, actor = require(authorization)
    except Denied as d:
        return d.response
    return _send(timetable.mine(db, actor))


# ══ homework ════════════════════════════════════════════════════════════════

@router.get("/homework")
@guarded(module="academics")
async def homework_list(db, actor, classId: int, all: bool = False):
    return homework.for_class(db, actor, classId, all)


@router.post("/homework")
@guarded(module="academics", action="edit")
async def set_homework(db, actor, request: Request):
    return homework.set_homework(db, actor, await _json(request))


@router.get("/homework/{homework_id}")
@guarded(module="academics")
async def homework_sheet(db, actor, homework_id: int):
    return homework.sheet(db, actor, homework_id)


@router.post("/homework/{homework_id}/marks")
@guarded(module="academics", action="edit")
async def mark_homework(db, actor, homework_id: int, request: Request):
    body = await _json(request)
    return homework.mark(db, actor, homework_id, body.get("entries"))


# ══ talking to parents ══════════════════════════════════════════════════════

@router.get("/messages")
@guarded(module="notifications")
async def messages(db, actor, unread: bool = False):
    return communications.threads(db, actor, unread)


@router.get("/messages/{thread_id}")
@guarded(module="notifications")
async def message_thread(db, actor, thread_id: str):
    return communications.thread(db, actor, thread_id)


@router.post("/messages")
@guarded(module="notifications", action="create")
async def send_message(db, actor, request: Request):
    body = await _json(request)
    return communications.reply(db, actor, body.get("threadId") or body.get("thread_id"),
                                body.get("body"), body.get("studentId") or body.get("student_id"),
                                body.get("parentId") or body.get("parent_id"), body.get("subject"))


@router.get("/announcements")
@guarded(module="notifications")
async def announcements(db, actor, all: bool = False):
    return communications.announcements(db, actor, not all)


@router.post("/announcements")
@guarded(module="notifications", action="edit")
async def post_announcement(db, actor, request: Request):
    return communications.post_announcement(db, actor, await _json(request))


@router.post("/announcements/{announcement_id}/withdraw")
@guarded(module="notifications", action="edit")
async def withdraw_announcement(db, actor, announcement_id: int):
    return communications.withdraw_announcement(db, actor, announcement_id)


@router.get("/notifications")
@guarded(module="notifications")
async def notification_log(db, actor, limit: int = 200):
    return communications.notification_log(db, actor, limit)


@router.post("/notifications")
@guarded(module="notifications", action="create")
async def queue_notifications(db, actor, request: Request):
    return communications.queue_message(db, actor, await _json(request))


# ══ inventory, transport and books ══════════════════════════════════════════

@router.get("/inventory")
@guarded(portal="finance", module="finance")
async def inventory(db, actor, category: str = None, lowStock: bool = False):
    return stores.items(db, actor, category, lowStock)


@router.post("/inventory")
@guarded(portal="finance", module="finance", action="edit")
async def save_inventory_item(db, actor, request: Request):
    return stores.save_item(db, actor, await _json(request))


@router.post("/inventory/movement")
@guarded(portal="finance", module="finance", action="create")
async def move_stock(db, actor, request: Request):
    return stores.move_stock(db, actor, await _json(request))


@router.get("/inventory/movements")
@guarded(portal="finance", module="finance")
async def stock_movements(db, actor, itemId: int = None, limit: int = 200):
    return stores.movements(db, actor, itemId, limit)


@router.get("/transport")
@guarded(module="finance")
async def transport_routes(db, actor):
    return stores.routes(db, actor)


@router.get("/transport/{route_id}")
@guarded(module="finance")
async def transport_route(db, actor, route_id: int):
    return stores.route(db, actor, route_id)


@router.post("/transport")
@guarded(portal="finance", module="finance", action="edit")
async def save_transport_route(db, actor, request: Request):
    return stores.save_route(db, actor, await _json(request))


@router.post("/transport/riders")
@guarded(portal="finance", module="finance", action="edit")
async def assign_rider(db, actor, request: Request):
    body = await _json(request)
    return stores.assign_rider(db, actor, body.get("studentId") or body.get("student_id"),
                               body.get("routeId") or body.get("route_id"),
                               body.get("stopId"), body.get("direction"),
                               body.get("feeOverride"))


@router.post("/transport/payment")
@guarded(portal="finance", module="fees", action="create")
async def transport_payment(db, actor, request: Request):
    body = await _json(request)
    return stores.transport_payment(db, actor, body.get("studentId") or body.get("student_id"),
                                    body.get("amount"), body.get("routeId"),
                                    body.get("method"), body.get("notes"))


@router.get("/books/{student_id}")
@guarded(portal="finance", module="fees")
async def books_account(db, actor, student_id: int, yearId: int = None):
    return stores.books_account(db, actor, student_id, yearId)


@router.post("/books/{student_id}")
@guarded(portal="finance", module="fees", action="edit")
async def save_books(db, actor, student_id: int, request: Request):
    body = await _json(request)
    return stores.save_books(db, actor, student_id, body.get("items"), body.get("yearId"))


@router.post("/books/{student_id}/payment")
@guarded(portal="finance", module="fees", action="create")
async def books_payment(db, actor, student_id: int, request: Request):
    body = await _json(request)
    return stores.books_payment(db, actor, student_id, body.get("amount"),
                                body.get("method"), body.get("reference"), body.get("notes"))


@router.get("/discounts")
@guarded(portal="finance", module="fees")
async def discounts(db, actor, studentId: int = None):
    return stores.discounts(db, actor, studentId)


@router.post("/discounts")
@guarded(portal="finance", module="fees", action="edit")
async def grant_discount(db, actor, request: Request):
    return stores.grant_discount(db, actor, await _json(request))


# ══ money taken online, and the office's reconciliation of it ═══════════════

@router.get("/fees/online")
@guarded(portal="finance", module="fees")
async def online_payments(db, actor, status: str = "pending"):
    if status not in ("pending", "acknowledged", "rejected"):
        status = "pending"
    return payments.pending(db, actor, status)


@router.post("/fees/online/{intent_id}/acknowledge")
@guarded(portal="finance", module="fees", action="edit")
async def acknowledge_intent(db, actor, intent_id: int, request: Request):
    body = await _json(request)
    return payments.acknowledge(db, actor, intent_id, body.get("method"))


@router.post("/fees/online/{intent_id}/reject")
@guarded(portal="finance", module="fees", action="edit")
async def reject_intent(db, actor, intent_id: int, request: Request):
    body = await _json(request)
    return payments.reject(db, actor, intent_id, body.get("reason"))


@router.post("/fees/online/{intent_id}/verify")
@guarded(portal="finance", module="fees", action="edit")
async def verify_intent(db, actor, intent_id: int):
    return payments.verify_one(db, actor, intent_id)
