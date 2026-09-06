"""The office application, hosted.

The very same browser build a school's own computer serves at /desk, pointed
at this service instead — so a bursar can work with the school's PC switched
off, or from another town. One bundle, two backends, one contract:

    POST /api/v1/desk/call   {"channel": "students:list", "args": [{...}]}

The offline host answers that by calling the handler it already registered
(``electron/server/desk_api.js``). This answers it by calling the module that
was ported from that same handler (``app/school/``). Neither writes a second
implementation of anything, which is the only reason the two can be trusted to
agree.

── What is honest about this file ──────────────────────────────────────────

The offline application has 399 channels. This does not answer 399 of them,
and pretending otherwise would be worse than useless: a screen that silently
returns nothing is a bug report six months later from a school that has been
working around it.

So every channel is in one of three states, and the app is told which:

    answered      a module here implements it
    host_only     it only means something on the school's own computer
    not_yet       the port has not reached it

``not_yet`` answers with the shape a handler answers with — ``{ok: False}`` and
a sentence naming what to do instead — so the screen shows a message rather
than breaking. ``GET /api/v1/desk/coverage`` lists all three, and
``scripts/desk-coverage.mjs`` at the repo root turns that into
``docs/DESK_COVERAGE.md`` so the remaining work is countable rather than
folkloric.

── Stricter than the office PC, deliberately ───────────────────────────────

Everything in ``school_api.py``'s preamble applies here unchanged: the account
is re-resolved on every call, the module permission is the same one the desktop
enforces, sessions are revocable, and refusals are audited. The dispatcher adds
nothing to that and takes nothing away — each channel declares the module and
action it needs, and ``require()`` is the gate.
"""
import inspect

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from . import ratelimit
from .school import (academics, admin, calendar as school_calendar, canteen,
                     communications, dashboards, db as sdb, fees, finance,
                     homework, media, office, payroll, security, session,
                     staff, stores, students, timetable)
from .school_api import Denied, require, _err

router = APIRouter(prefix="/api/v1/desk")


# ══ the map ═════════════════════════════════════════════════════════════════
#
# One entry per channel: the module and action it needs, and how to reach the
# ported implementation.
#
# The adapter's job is the shape. The offline handlers answer with plain values
# — `students:list` is an array of pupils, not `{ok, students}` — because that
# is what four hundred lines of screen code are written against. The ported
# modules answer in the envelope this service uses everywhere else. The adapter
# unwraps, and it does so HERE rather than in either implementation, so neither
# has to know that the other exists.
#
# Args arrive as the browser sent them: the argument list of the call the
# screen made. `a(0)` is the first argument, and the shapes are exactly the
# ones in electron/api-surface.js.

def _pick(result, key, default=None):
    """The value inside a module's envelope, or the refusal it answered with.

    A refusal passes straight through — it is already the shape a screen reads.
    """
    if not isinstance(result, dict):
        return result
    if not result.get("ok", True):
        return result
    return result.get(key, default)


def _arg(args, i, default=None):
    return args[i] if len(args) > i and args[i] is not None else default


def _f(args, i, key, default=None):
    """A field out of an argument that is an object, tolerating either spelling.

    The offline channels are not consistent about camelCase and snake_case —
    `classId` in one, `class_id` in the next — because they grew over years.
    Rather than make the browser care, both are accepted.
    """
    obj = _arg(args, i) or {}
    if not isinstance(obj, dict):
        return default
    if key in obj and obj[key] is not None:
        return obj[key]
    snake = "".join("_" + c.lower() if c.isupper() else c for c in key)
    if snake in obj and obj[snake] is not None:
        return obj[snake]
    camel = "".join(p.title() if i else p for i, p in enumerate(key.split("_")))
    return obj.get(camel, default)


CHANNELS = {}


def channel(name, module=None, action="view"):
    """Declare how one offline channel is answered here."""
    def wrap(fn):
        CHANNELS[name] = {"module": module, "action": action, "fn": fn}
        return fn
    return wrap


# ── what the school is, and who is asking ───────────────────────────────────

@channel("settings:list-classes")
def _list_classes(db, actor, args):
    return db.all("""
        SELECT c.*, p.name AS parent_name,
               (SELECT COUNT(*) FROM students s
                 WHERE s.current_class_id = c.id AND s.status = 'Active') AS student_count
          FROM class_groups c
          LEFT JOIN class_groups p ON p.id = c.parent_class_id
         ORDER BY c.level_order, c.name""")


@channel("settings:list-terms")
def _list_terms(db, actor, args):
    return db.all("""
        SELECT t.*, ay.label AS year_label
          FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id
         ORDER BY ay.id DESC, t.term_number""")


@channel("settings:list-subjects")
def _list_subjects(db, actor, args):
    return db.all("SELECT * FROM subjects WHERE is_active = TRUE ORDER BY name")


@channel("settings:get-all")
def _settings_all(db, actor, args):
    grouped = {}
    for row in db.all("SELECT key, value, category FROM settings"):
        grouped.setdefault(row["category"], {})[row["key"]] = row["value"]
    return grouped


@channel("settings:set", module="settings", action="edit")
def _settings_set(db, actor, args):
    return admin.save_settings(db, actor, {_f(args, 0, "key"): _f(args, 0, "value")})


@channel("settings:get-class-subjects")
def _class_subjects(db, actor, args):
    return academics.subjects_for_class(db, actor, _arg(args, 0))


@channel("auth:effective-permissions")
def _effective_permissions(db, actor, args):
    user_id = _arg(args, 0)
    # Your own is always yours to read; anybody else's is a Settings question.
    if str(user_id) != str(actor["user_id"]) and not security.can(actor, "settings", "view"):
        return {"ok": False, "error": "Access denied."}
    return security.resolve_effective_permissions(db, user_id)


@channel("auth:list-user-assignments")
def _user_assignments(db, actor, args):
    user = db.one("SELECT staff_id FROM users WHERE id = %s", (_arg(args, 0),))
    if not user or not user["staff_id"]:
        return []
    return db.all("""
        SELECT sa.id, sa.class_group_id, sa.subject_id, sa.term_id, sa.is_class_teacher,
               cg.name AS class_name, s.name AS subject_name, t.label AS term_label
          FROM staff_assignments sa
          LEFT JOIN class_groups cg ON cg.id = sa.class_group_id
          LEFT JOIN subjects s ON s.id = sa.subject_id
          LEFT JOIN terms t ON t.id = sa.term_id
         WHERE sa.staff_id = %s""", (user["staff_id"],))


@channel("auth:list-designations")
def _designations(db, actor, args):
    return db.all("SELECT * FROM designations ORDER BY id")


@channel("auth:list-users", module="settings")
def _users(db, actor, args):
    return _pick(admin.users(db, actor), "users", [])


@channel("auth:change-password")
def _change_password(db, actor, args):
    return session.change_own_password(db, actor, _f(args, 0, "oldPassword"),
                                       _f(args, 0, "newPassword"))


@channel("access:catalogue", module="settings")
def _access_catalogue(db, actor, args):
    return admin.access_matrix(db, actor)


@channel("access:role-matrix", module="settings")
def _role_matrix(db, actor, args):
    return admin.access_matrix(db, actor)


@channel("access:set-role-level", module="settings", action="edit")
def _set_role_level(db, actor, args):
    # The offline channel changes ONE module's level; the ported one is handed
    # the role's whole row. So the rest of the row is read back and sent with
    # it — otherwise setting Fees to Manage would silently clear everything
    # else the role holds.
    designation_id = _f(args, 0, "designationId")
    current = admin.access_matrix(db, actor)
    levels = {}
    for role in (current.get("designations") or []):
        if str(role.get("id")) == str(designation_id):
            levels = dict(role.get("levels") or {})
            break
    levels[_f(args, 0, "module")] = _f(args, 0, "level")
    return admin.set_access(db, actor, designation_id, levels)


# ── the school this morning ─────────────────────────────────────────────────

@channel("dashboard:summary", module="dashboard")
def _dashboard(db, actor, args):
    return dashboards.main(db, actor, _arg(args, 0))


@channel("academics:dashboard", module="academics")
def _academics_dashboard(db, actor, args):
    return dashboards.academics(db, actor)


@channel("fees:dashboard", module="fees")
def _fees_dashboard(db, actor, args):
    return dashboards.fees(db, actor)


@channel("finance:dashboard", module="finance")
def _finance_dashboard(db, actor, args):
    return dashboards.finance(db, actor)


@channel("canteen:dashboard", module="canteen")
def _canteen_dashboard(db, actor, args):
    return dashboards.canteen(db, actor)


@channel("staff:dashboard", module="staff")
def _staff_dashboard(db, actor, args):
    return dashboards.staff(db, actor)


# ── the roll ────────────────────────────────────────────────────────────────

@channel("students:list", module="students")
def _students_list(db, actor, args):
    return _pick(students.listing(
        db, actor,
        class_id=_f(args, 0, "class_id") or _f(args, 0, "classId"),
        status=_f(args, 0, "status", "Active"),
        gender=_f(args, 0, "gender"),
        search=_f(args, 0, "search") or _f(args, 0, "q")), "students", [])


@channel("students:get", module="students")
def _students_get(db, actor, args):
    return _pick(students.get(db, actor, _arg(args, 0)), "student")


@channel("students:create", module="students", action="create")
def _students_create(db, actor, args):
    return students.create(db, actor, _arg(args, 0, {}))


@channel("students:update", module="students", action="edit")
def _students_update(db, actor, args):
    return students.update(db, actor, _f(args, 0, "id"), _f(args, 0, "data", {}))


@channel("students:add-event", module="students", action="create")
def _student_event(db, actor, args):
    return students.add_event(db, actor, _f(args, 0, "student_id"), _f(args, 0, "event_type"),
                              _f(args, 0, "title"), _f(args, 0, "description"), _f(args, 0, "date"))


@channel("students:list-class-attendance", module="academics")
def _class_attendance(db, actor, args):
    return _pick(students.attendance_sheet(db, actor, _f(args, 0, "classId"),
                                           _f(args, 0, "date")), "students", [])


@channel("students:mark-bulk-attendance", module="academics", action="edit")
def _mark_attendance(db, actor, args):
    return students.mark_attendance(db, actor, _f(args, 0, "classId"),
                                    _f(args, 0, "date"), _f(args, 0, "marks", []))


# ── marks ───────────────────────────────────────────────────────────────────

@channel("scores:list-subjects", module="academics")
def _score_subjects(db, actor, args):
    return _pick(academics.subjects_for_class(db, actor, _arg(args, 0)), "subjects", [])


@channel("scores:list-for-class", module="academics")
def _score_sheet(db, actor, args):
    return academics.score_sheet(db, actor, _f(args, 0, "classId"),
                                 _f(args, 0, "subjectId"), _f(args, 0, "termId"))


@channel("scores:save-bulk", module="academics", action="edit")
def _save_marks(db, actor, args):
    return academics.save_marks(db, actor, _f(args, 0, "subjectId"),
                                _f(args, 0, "scores") or _f(args, 0, "marks", []),
                                _f(args, 0, "termId"))


@channel("scores:class-sheet", module="academics")
def _assessment_sheet(db, actor, args):
    return academics.assessment_sheet(db, actor, _f(args, 0, "classId"),
                                      _f(args, 0, "subjectId"), _f(args, 0, "termId"))


@channel("scores:add-assessment-column", module="academics", action="create")
def _add_column(db, actor, args):
    return academics.add_assessment_column(
        db, actor, _f(args, 0, "classId"), _f(args, 0, "subjectId"),
        _f(args, 0, "assessmentType"), _f(args, 0, "maxMarks"), _f(args, 0, "termId"))


@channel("scores:get-weights", module="academics")
def _weights(db, actor, args):
    return academics.weights(db)


@channel("scores:student-report", module="academics")
def _student_report(db, actor, args):
    return academics.student_report(db, actor, _f(args, 0, "studentId"), _f(args, 0, "termId"))


@channel("scores:end-of-term", module="academics")
def _broadsheet(db, actor, args):
    return academics.broadsheet(db, actor, _f(args, 0, "classId"), _f(args, 0, "termId"))


# ── money ───────────────────────────────────────────────────────────────────

@channel("fees:list-payments", module="fees")
def _collections(db, actor, args):
    return _pick(fees.collections(db, actor, _f(args, 0, "dateFrom"), _f(args, 0, "dateTo"),
                                  _f(args, 0, "classId"), _f(args, 0, "method")), "payments", [])


@channel("fees:record-payment", module="fees", action="create")
def _record_payment(db, actor, args):
    return fees.record_payment(db, actor, _arg(args, 0, {}))


@channel("fees:student-financial-profile", module="fees")
def _student_account(db, actor, args):
    return fees.student_account(db, actor, _f(args, 0, "studentId"), _f(args, 0, "termId"))


@channel("fees:debtors-report", module="fees")
def _debtors(db, actor, args):
    return _pick(fees.debtors(db, actor, _f(args, 0, "classId"), _f(args, 0, "minimum")),
                 "debtors", [])


@channel("fees:list-templates", module="fees")
def _templates(db, actor, args):
    return _pick(fees.templates(db, actor, _f(args, 0, "billType", "school_fees")), "templates", [])


@channel("fees:get-template", module="fees")
def _template(db, actor, args):
    return _pick(fees.template(db, actor, _arg(args, 0)), "template")


@channel("fees:save-template", module="fees", action="edit")
def _save_template(db, actor, args):
    return fees.save_template(db, actor, _arg(args, 0, {}))


@channel("fees:generate-bill", module="fees", action="create")
def _generate_bill(db, actor, args):
    return fees.generate_bill(db, actor, _f(args, 0, "studentId"), _f(args, 0, "termId"))


@channel("fees:generate-bulk", module="fees", action="create")
def _generate_bulk(db, actor, args):
    return fees.generate_bills_for_class(db, actor, _f(args, 0, "classId"), _f(args, 0, "termId"))


@channel("fees:void-bill", module="fees", action="delete")
def _void_bill(db, actor, args):
    return fees.void_bill(db, actor, _f(args, 0, "billId"), _f(args, 0, "reason"))


@channel("fees:restore-bill", module="fees", action="edit")
def _restore_bill(db, actor, args):
    return fees.restore_bill(db, actor, _f(args, 0, "billId"))


@channel("fees:list-voided-bills", module="fees")
def _voided(db, actor, args):
    return _pick(fees.voided_bills(db, actor, _f(args, 0, "termId"),
                                   bool(_f(args, 0, "allTerms"))), "bills", [])


@channel("fees:apply-supplementary", module="fees", action="create")
def _apply_supp(db, actor, args):
    return fees.apply_supplementary(db, actor, _arg(args, 0, {}))


@channel("fees:remove-supplementary", module="fees", action="delete")
def _remove_supp(db, actor, args):
    return fees.remove_supplementary(db, actor, _arg(args, 0, {}))


# ── the books ───────────────────────────────────────────────────────────────

@channel("finance:list-income", module="finance")
def _income(db, actor, args):
    return _pick(finance.income(db, actor), "income", [])


@channel("finance:record-income", module="finance", action="create")
def _record_income(db, actor, args):
    return finance.record_income(db, actor, _arg(args, 0, {}))


@channel("finance:list-expense", module="finance")
def _expenses(db, actor, args):
    return _pick(finance.expenses(db, actor), "expenses", [])


@channel("finance:record-expense", module="finance", action="create")
def _record_expense(db, actor, args):
    return finance.record_expense(db, actor, _arg(args, 0, {}))


@channel("finance:financial-statement", module="finance")
def _statement(db, actor, args):
    return finance.statement(db, actor)


@channel("finance:list-budgets", module="finance")
def _budgets(db, actor, args):
    return _pick(office.budgets(db, actor), "budgets", [])


@channel("finance:save-budget", module="finance", action="edit")
def _save_budget(db, actor, args):
    return office.save_budget(db, actor, _arg(args, 0, {}))


# ── the people who work there ───────────────────────────────────────────────

@channel("staff:list", module="staff")
def _staff_list(db, actor, args):
    return _pick(staff.listing(db, actor, _f(args, 0, "status", "Active")), "staff", [])


@channel("staff:get", module="staff")
def _staff_get(db, actor, args):
    return _pick(staff.get(db, actor, _arg(args, 0)), "staff")


@channel("staff:create", module="staff", action="create")
def _staff_create(db, actor, args):
    return staff.save(db, actor, _arg(args, 0, {}))


@channel("staff:update", module="staff", action="edit")
def _staff_update(db, actor, args):
    # The offline channel carries the id beside the record; the ported one
    # takes the id inside it and treats its presence as "amend, do not create".
    return staff.save(db, actor, {**(_f(args, 0, "data") or {}), "id": _f(args, 0, "id")})


@channel("staff:list-leave", module="staff")
def _leave(db, actor, args):
    return _pick(staff.leave_list(db, actor, _f(args, 0, "status")), "requests", [])


@channel("staff:review-leave", module="staff", action="edit")
def _decide_leave(db, actor, args):
    return staff.decide_leave(db, actor, _f(args, 0, "id"),
                              _f(args, 0, "status"), _f(args, 0, "note"))


@channel("lesson-notes:list", module="academics")
def _lesson_notes(db, actor, args):
    return _pick(staff.lesson_notes(db, actor, _arg(args, 0, {})), "notes", [])


@channel("lesson-notes:save", module="academics", action="create")
def _save_lesson_note(db, actor, args):
    return staff.save_lesson_note(db, actor, _arg(args, 0, {}))


@channel("lesson-notes:review", module="academics", action="edit")
def _review_lesson_note(db, actor, args):
    return staff.decide_lesson_note(db, actor, _f(args, 0, "id"), _arg(args, 0, {}))


# ── pay ─────────────────────────────────────────────────────────────────────

@channel("payroll:bulk-preview", module="payroll")
def _payroll_preview(db, actor, args):
    return payroll.preview_month(db, actor, _f(args, 0, "month"), _f(args, 0, "year"))


@channel("payroll:bulk-run", module="payroll", action="create")
def _payroll_run(db, actor, args):
    return payroll.run_month(db, actor, _f(args, 0, "month"), _f(args, 0, "year"),
                             _f(args, 0, "paymentDate"))


@channel("payroll:mark-paid", module="payroll", action="edit")
def _payroll_paid(db, actor, args):
    return payroll.mark_paid(db, actor, _f(args, 0, "salaryId"), _arg(args, 0, {}))


@channel("payroll:payslip-data", module="payroll")
def _payslip(db, actor, args):
    return payroll.payslip(db, actor, _arg(args, 0))


@channel("payroll:ytd-summary", module="payroll")
def _ytd(db, actor, args):
    return payroll.ytd(db, actor, _f(args, 0, "staffId"), _f(args, 0, "year"))


@channel("payroll:ssnit-schedule", module="payroll")
def _ssnit(db, actor, args):
    return payroll.statutory_schedule(db, actor, "ssnit", _f(args, 0, "month"), _f(args, 0, "year"))


@channel("payroll:paye-schedule", module="payroll")
def _paye(db, actor, args):
    return payroll.statutory_schedule(db, actor, "paye", _f(args, 0, "month"), _f(args, 0, "year"))


@channel("staff:list-salaries", module="payroll")
def _salaries(db, actor, args):
    return _pick(payroll.month_sheet(db, actor, _f(args, 0, "month"), _f(args, 0, "year")),
                 "rows", [])


# ── the canteen ─────────────────────────────────────────────────────────────

@channel("canteen:student-profile", module="canteen")
def _canteen_student(db, actor, args):
    return canteen.student_status(db, actor, _f(args, 0, "studentId"), _f(args, 0, "date"))


@channel("canteen:record-payment", module="canteen", action="create")
def _canteen_collect(db, actor, args):
    return canteen.collect(db, actor, _f(args, 0, "student_id"), _f(args, 0, "amount"),
                           _f(args, 0, "payment_method", "Cash"),
                           _f(args, 0, "notes"), _f(args, 0, "payment_date"))


@channel("canteen:class-roster-for-date", module="canteen")
def _canteen_sheet(db, actor, args):
    return canteen.class_sheet(db, actor, _f(args, 0, "classId"), _f(args, 0, "date"))


@channel("canteen:mark-exempt", module="canteen", action="edit")
def _canteen_exempt(db, actor, args):
    # The offline channel excuses ONE pupil across several dates; the ported
    # one excuses several pupils on one date. Same act, transposed — so it is
    # run once per date rather than losing all but the first.
    student_id = _f(args, 0, "studentId")
    reason = _f(args, 0, "reason", "")
    dates = _f(args, 0, "dates") or []
    if not isinstance(dates, list):
        dates = [dates]
    excused = 0
    for date in dates:
        r = canteen.exempt(db, actor, None, [student_id], date, reason)
        if not r.get("ok"):
            return r
        excused += r.get("excused", 0)
    return {"ok": True, "excused": excused}


@channel("canteen:debtors-report", module="canteen")
def _canteen_debtors(db, actor, args):
    return _pick(canteen.debtors(db, actor, _f(args, 0, "classId")), "debtors", [])


@channel("canteen:list-calendar", module="settings")
def _calendar(db, actor, args):
    return _pick(school_calendar.listing(db, actor, _f(args, 0, "termId")), "days", [])


@channel("canteen:save-calendar-day", module="settings", action="edit")
def _calendar_day(db, actor, args):
    return school_calendar.set_day(db, actor, _arg(args, 0, {}))


# ── the week ────────────────────────────────────────────────────────────────

@channel("timetable:list-periods", module="academics")
def _periods(db, actor, args):
    return timetable.periods(db)


@channel("timetable:get-class", module="academics")
def _class_week(db, actor, args):
    return timetable.class_week(db, actor, _f(args, 0, "classId"))


@channel("timetable:save-entry", module="academics", action="edit")
def _save_week(db, actor, args):
    # The offline channel writes ONE cell of the week; the ported one replaces
    # the class's whole week. Writing one cell as a whole-week replacement
    # would erase every other lesson in it, so the week is read, the one cell
    # changed, and the week written back.
    class_id = _f(args, 0, "classId")
    day = _f(args, 0, "dayOfWeek")
    period_id = _f(args, 0, "periodId")
    if not class_id or not day or not period_id:
        return {"ok": False, "error": "Class, day and period are required."}

    week = timetable.class_week(db, actor, class_id)
    if isinstance(week, dict) and not week.get("ok", True):
        return week
    entries = [e for e in (week.get("entries") or [])
               if not (str(e.get("day_of_week")) == str(day)
                       and str(e.get("period_id")) == str(period_id))]

    subject_id = _f(args, 0, "subjectId")
    teacher_id = _f(args, 0, "teacherId")
    notes = _f(args, 0, "notes")
    # Nothing in the cell means the lesson was cleared, which is exactly the
    # entry being left out.
    if subject_id or teacher_id or notes:
        entries.append({"day_of_week": day, "period_id": period_id,
                        "subject_id": subject_id, "teacher_id": teacher_id,
                        "notes": notes})
    return timetable.save_class_week(db, actor, class_id, entries)


@channel("timetable:get-teacher", module="academics")
def _my_week(db, actor, args):
    return timetable.mine(db, actor)


# ── homework ────────────────────────────────────────────────────────────────

@channel("homework:list-class", module="academics")
def _homework(db, actor, args):
    return _pick(homework.for_class(db, actor, _f(args, 0, "classId")), "homework", [])


@channel("homework:save", module="academics", action="create")
def _set_homework(db, actor, args):
    return homework.set_homework(db, actor, _arg(args, 0, {}))


@channel("homework:sheet", module="academics")
def _homework_sheet(db, actor, args):
    return homework.sheet(db, actor, _f(args, 0, "homeworkId"))


@channel("homework:save-marks", module="academics", action="edit")
def _mark_homework(db, actor, args):
    return homework.mark(db, actor, _f(args, 0, "homeworkId"), _f(args, 0, "entries", []))


# ── talking to people ───────────────────────────────────────────────────────

@channel("messages:list-threads", module="notifications")
def _threads(db, actor, args):
    return _pick(communications.threads(db, actor), "threads", [])


@channel("messages:get-thread", module="notifications")
def _thread(db, actor, args):
    return communications.thread(db, actor, _arg(args, 0))


@channel("messages:reply", module="notifications", action="create")
def _reply(db, actor, args):
    return communications.reply(db, actor, _f(args, 0, "threadId"), _f(args, 0, "body"))


@channel("announcements:list", module="notifications")
def _announcements(db, actor, args):
    return _pick(communications.announcements(db, actor), "announcements", [])


@channel("announcements:save", module="notifications", action="create")
def _post_announcement(db, actor, args):
    return communications.post_announcement(db, actor, _arg(args, 0, {}))


@channel("notifications:list-log", module="notifications")
def _notification_log(db, actor, args):
    return _pick(communications.notification_log(db, actor), "log", [])


# ── the stores ──────────────────────────────────────────────────────────────

@channel("inventory:list-items", module="finance")
def _items(db, actor, args):
    return _pick(stores.items(db, actor), "items", [])


@channel("inventory:save-item", module="finance", action="edit")
def _save_item(db, actor, args):
    return stores.save_item(db, actor, _arg(args, 0, {}))


@channel("inventory:record-movement", module="finance", action="create")
def _move_stock(db, actor, args):
    return stores.move_stock(db, actor, _arg(args, 0, {}))


@channel("transport:list-routes", module="finance")
def _routes(db, actor, args):
    return _pick(stores.routes(db, actor), "routes", [])


@channel("transport:save-route", module="finance", action="edit")
def _save_route(db, actor, args):
    return stores.save_route(db, actor, _arg(args, 0, {}))


@channel("transport:record-payment", module="finance", action="create")
def _transport_payment(db, actor, args):
    return stores.transport_payment(db, actor, _f(args, 0, "student_id"), _f(args, 0, "amount"),
                                    _f(args, 0, "route_id"),
                                    _f(args, 0, "payment_method", "Cash"), _f(args, 0, "notes"))


@channel("books:list", module="fees")
def _books(db, actor, args):
    return stores.books_account(db, actor, _f(args, 0, "studentId"))


@channel("books:record-payment", module="fees", action="create")
def _books_payment(db, actor, args):
    return stores.books_payment(db, actor, _f(args, 0, "student_id"), _f(args, 0, "amount"),
                                _f(args, 0, "payment_method", "Cash"),
                                _f(args, 0, "receipt_number"), _f(args, 0, "notes"))


@channel("discounts:list", module="fees")
def _discounts(db, actor, args):
    return _pick(stores.discounts(db, actor), "discounts", [])


@channel("discounts:save", module="fees", action="create")
def _grant_discount(db, actor, args):
    return stores.grant_discount(db, actor, _arg(args, 0, {}))


# ── the record of what was done ─────────────────────────────────────────────

@channel("audit:list", module="settings")
def _audit(db, actor, args):
    return _pick(admin.audit_trail(db, actor), "entries", [])


@channel("staff-activities:list", module="staff")
def _activities(db, actor, args):
    return _pick(office.activities(db, actor, _arg(args, 0, {})), "activities", [])


@channel("staff-activities:save", module="staff", action="create")
def _save_activity(db, actor, args):
    return office.save_activity(db, actor, _arg(args, 0, {}))


# ══ what is not here, and why ═══════════════════════════════════════════════
#
# Two different answers, and the difference matters to whoever is looking at
# the screen. "Do this at the school's computer" is an instruction. "Not online
# yet" is a fact about this service. Neither is "something went wrong".

HOST_ONLY = {
    "auth:login", "auth:logout", "auth:bootstrap",
    "backup:restore", "backup:factory-reset", "backup:open-folder",
    "backup:pick-folder", "backup:pick-file", "backup:save-copy",
    "backup:set-primary-folder", "backup:create", "backup:list", "backup:get-info",
    "backup:get-config", "backup:set-config", "backup:run-auto", "backup:status",
    "backup:list-destinations", "backup:add-destination", "backup:update-destination",
    "backup:remove-destination", "backup:test-destination", "backup:retry",
    "workbook:open-folder", "workbook:reveal", "workbook:pick-file",
    "workbook:status", "workbook:export", "workbook:preview-import",
    "workbook:import", "workbook:import-history",
    "students:bulk-upload", "students:bulk-preview", "students:bulk-download",
    "students:run-initial-import", "exams:import-template",
    "mobile:status", "mobile:start", "mobile:stop", "mobile:set-config",
    "cloud:status", "cloud:configure", "cloud:push-now", "cloud:pull-now",
    "cloud:test", "cloud:backfill",
    "session:migration-preview", "session:migrate-term",
}

# The module a channel belongs to, for the sentence a school is shown. Derived
# from the channel's own prefix, because that is what it is named after.
MODULE_WORDS = {
    "students": "the roll", "fees": "Fees", "scores": "marks",
    "academics": "Academics", "canteen": "the canteen", "finance": "Finance",
    "payroll": "Payroll", "staff": "Staff", "settings": "Settings",
    "reports": "printed documents", "receipts": "receipts", "exams": "examinations",
    "timetable": "the timetable", "homework": "homework", "messages": "Messages",
    "notifications": "Notifications", "inventory": "Inventory",
    "transport": "Transport", "books": "Books", "discounts": "discounts",
    "photos": "photographs", "audit": "the audit trail",
}


def _not_yet(chan):
    area = MODULE_WORDS.get(chan.split(":")[0], "this part of the system")
    return {
        "ok": False,
        "not_online_yet": True,
        "channel": chan,
        "error": (f"{area[0].upper()}{area[1:]} is not available online yet — "
                  "this can be done at the school's own computer, or on the "
                  "school network."),
    }


def _host_only(chan):
    return {
        "ok": False,
        "host_only": True,
        "channel": chan,
        "error": "This happens at the school's own computer.",
    }


def coverage():
    """Every channel this service knows about, and what it does with it.

    Read by scripts/desk-coverage.mjs at the repo root, which checks it against
    electron/api-surface.js — the offline application's own list — so a channel
    added there shows up here as work outstanding rather than as nothing.
    """
    return {
        "answered": sorted(CHANNELS.keys()),
        "host_only": sorted(HOST_ONLY),
    }


# ══ the routes ══════════════════════════════════════════════════════════════

async def _json(request):
    try:
        return await request.json()
    except Exception:
        return {}


@router.get("/info")
async def info(school_id: str = ""):
    """What this is, and the school it is about to show — before sign-in.

    Deliberately the same answer shape the offline host gives, including the
    curated public settings the sign-in screen draws itself from. `settings`
    here is a small, published subset and never the whole of Settings, which
    holds the school's payment keys.
    """
    school_id = str(school_id or "").strip()
    if not school_id:
        # Which schools this service holds, so the Connect screen can offer a
        # list rather than ask somebody to type an identifier. A service with
        # no database yet answers with an empty list rather than a 500: the
        # question "what are you" has an answer even when the answer is "not
        # holding any schools".
        try:
            schools = sdb.provisioned()
        except Exception:
            schools = []
        return {"ok": True, "product": "Nickland Edusoft", "desk": True,
                "online": True, "schools": schools}
    try:
        db = sdb.SchoolDb(school_id)
        if not db.exists():
            return _err(404, "Unknown school")
    except ValueError:
        return _err(400, "Which school?")

    get = db.get_setting
    return {
        "ok": True, "product": "Nickland Edusoft", "desk": True, "online": True,
        "school": get("school_name", "School"),
        "school_id": school_id,
        "bootstrap_done": True,
        "settings": {
            "school": {k: get(k, "") for k in (
                "school_name", "school_abbreviation", "school_motto",
                "school_address", "school_phone_1", "school_email")},
            "branding": {
                "school_logo_path": media.as_data_uri(get("school_logo_path", "")),
                **{k: get(k, "") for k in (
                    "school_color_primary", "school_color_accent",
                    "school_color_background", "school_color_foreground",
                    "ui_foreground_mode", "ui_theme_mode",
                    "ui_font_family", "ui_font_size_base")},
            },
        },
    }


@router.post("/login")
async def login(request: Request):
    """Signing in, in the shape the office application's own screen expects.

    The same act as `/api/v1/school/signin` — the same throttle, the same
    hashes, the same session — answered in the offline `auth:login` shape so
    the sign-in screen does not have to know which backend it reached.
    """
    body = await _json(request)
    school_id = str(body.get("school_id") or body.get("schoolId") or "").strip()
    if not school_id:
        return _err(400, "Which school?")
    if ratelimit.limited(request, "desk-signin", body.get("username")):
        return _err(429, "Too many attempts. Try again shortly.")
    try:
        db = sdb.SchoolDb(school_id)
        if not db.exists():
            # The same answer as a wrong password: probing school ids should
            # not reveal which schools this service holds.
            return _err(401, "Those details did not match an account. Check and try again.")
    except ValueError:
        return _err(400, "Which school?")

    result = session.sign_in(db, body.get("username"), body.get("password"),
                             device=body.get("device") or "Browser",
                             platform=body.get("platform") or "web",
                             source=ratelimit.client_ip(request))
    if not result.get("ok"):
        return _err(result.get("status", 401), result["error"])

    actor = session.actor_for(db, result["token"])
    return {
        "ok": True,
        "token": f'{school_id}.{result["token"]}',
        "expires_at": result["expires_at"],
        # The offline application's own user shape, to the letter.
        "user": {
            "id": actor["user_id"],
            "username": actor["username"],
            "fullName": actor["full_name"],
            "designation": actor["designation"],
            "mustChangePassword": actor["must_change_password"],
            "permissions": actor["permissions"],
        },
    }


@router.post("/call")
async def call(request: Request, authorization: str = Header(None)):
    """One channel, by name.

    The gate is the module the channel declares, checked by the same
    ``require()`` every other route on this service uses — so the online school
    is neither looser than the offline one nor a second set of rules that has
    to be kept in step with it.
    """
    body = await _json(request)
    chan = str(body.get("channel") or "")
    args = body.get("args")
    if not isinstance(args, list):
        args = []

    if chan in HOST_ONLY:
        return _host_only(chan)

    entry = CHANNELS.get(chan)
    if not entry:
        return _not_yet(chan)

    try:
        db, actor = require(authorization, module=entry["module"], action=entry["action"])
    except Denied as d:
        return d.response

    result = entry["fn"](db, actor, args)
    if inspect.isawaitable(result):
        result = await result

    # A module's refusal is already the shape a screen reads, and is passed on
    # as one rather than becoming an HTTP error the screen cannot show.
    return {"ok": True, "result": result}


@router.get("/coverage")
async def coverage_route():
    """What this service answers, for anybody who wants to know before asking."""
    return {"ok": True, **coverage()}
