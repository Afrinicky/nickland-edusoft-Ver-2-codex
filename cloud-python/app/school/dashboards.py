"""The dashboards, online — a translation of ``electron/server/dashboards_api.js``.

The same eight readings the installed application shows above each module, and
the same ones the school's own server now serves to the browser. Three copies
of a figure is two too many, so this file is deliberately a translation and not
a redesign: same query, same field names, same arithmetic, in the order the
JavaScript states them, so the two can be read side by side and a reviewer can
see that they agree.

── What changes between SQLite and Postgres ────────────────────────────────

Four things, and nothing else:

  * ``strftime('%Y-%m', d)`` becomes ``substr(d, 1, 7)``. Dates are TEXT in
    both schemas — ISO, sorted lexically — so the month is the first seven
    characters either way, and that expression happens to be valid in both.
  * ``julianday('now') - julianday(x)`` has no Postgres spelling that is safe
    on a TEXT column: casting a malformed date raises, and one bad row would
    cost the whole debtor list rather than one figure. The age of a bill is
    therefore counted in Python, from the date the query returns.
  * ``COUNT(*) FILTER (WHERE …)`` needs no translation. Postgres has had it
    longer than SQLite has.
  * A parameter is ``%s`` rather than ``?``.

── Why a missing figure is not a missing dashboard ─────────────────────────

Same rule as offline: a school upgraded from an old version may not have every
table yet, and one absent table should cost one card rather than the screen.
``_safe`` returns the fallback and logs the fault once per distinct message —
because a dashboard silently reading zero is worse than one that fails, and
the office believes the zero.
"""
import datetime
import logging

from . import billing, security

log = logging.getLogger("nickland.dashboards")

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

_reported = set()


def _num(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0.0
    return n if n == n and n not in (float("inf"), float("-inf")) else 0.0


def _money(v):
    return round(_num(v), 2)


def _safe(fn, fallback):
    try:
        v = fn()
        return fallback if v is None else v
    except Exception as e:                                   # noqa: BLE001
        msg = str(e)
        if msg not in _reported:
            _reported.add(msg)
            log.warning("a figure could not be computed: %s", msg)
        return fallback


def _today():
    return datetime.date.today().isoformat()


def _days_since(text):
    """How long a bill has been outstanding, from the date it was raised.

    Counted here rather than in SQL: ``generated_at`` is TEXT, and a row a
    school typed by hand in 2019 must cost that row's age and not the query.
    """
    try:
        return max(0, (datetime.date.today()
                       - datetime.date.fromisoformat(str(text)[:10])).days)
    except Exception:                                        # noqa: BLE001
        return None


def _deny(module):
    return {"ok": False, "status": 403,
            "error": f"Access denied. You do not have permission to view {module}."}


def _gate(actor, module):
    return None if security.can(actor, module, "view") else _deny(module)


def _term(db, term_id=None):
    if term_id:
        return db.one("""SELECT t.*, y.label AS year_label FROM terms t
                           LEFT JOIN academic_years y ON y.id = t.academic_year_id
                          WHERE t.id = %s""", (int(term_id),))
    return db.one("""SELECT t.*, y.label AS year_label FROM terms t
                       LEFT JOIN academic_years y ON y.id = t.academic_year_id
                      WHERE t.is_current = 1""")


def _term_out(t):
    if not t:
        return None
    return {"id": t["id"], "label": t["label"], "year_label": t.get("year_label"),
            "start_date": t.get("start_date"), "end_date": t.get("end_date")}


def _daily_rate(db):
    try:
        v = float(db.get_setting("canteen_daily_rate", "5.00"))
        return v if v == v else 5.0
    except (TypeError, ValueError):
        return 5.0


# The school day, as the desktop states it. Fixed on all three surfaces until
# the timetable module owns it.
def _school_day():
    return [
        {"id": 1, "start": "08:00", "end": "09:00", "title": "Morning Assembly", "sub": "All Students"},
        {"id": 2, "start": "09:00", "end": "11:00", "title": "Lessons in Session", "sub": "All Classes"},
        {"id": 3, "start": "11:00", "end": "11:30", "title": "Break", "sub": "School-wide"},
        {"id": 4, "start": "11:30", "end": "13:00", "title": "Lessons Continue", "sub": "All Classes"},
        {"id": 5, "start": "13:00", "end": "14:00", "title": "Lunch", "sub": "Canteen"},
        {"id": 6, "start": "14:00", "end": "15:30", "title": "Afternoon Lessons", "sub": "All Classes"},
    ]


# ══ The main dashboard ══════════════════════════════════════════════════════

def main(db, actor, term_id=None):
    refused = _gate(actor, "dashboard")
    if refused:
        return refused

    term = _term(db, term_id)
    tid = term["id"] if term else None
    start = (term or {}).get("start_date") or "1970-01-01"
    end = (term or {}).get("end_date") or "2099-12-31"
    rate = _daily_rate(db)

    student_total = _safe(lambda: db.value(
        "SELECT COUNT(*) FROM students WHERE status = 'Active'"), 0)
    class_count = _safe(lambda: db.value(
        "SELECT COUNT(DISTINCT current_class_id) FROM students WHERE status = 'Active'"), 0)
    staff_active = _safe(lambda: db.value(
        "SELECT COUNT(*) FROM staff WHERE status = 'Active'"), 0)

    income = _safe(lambda: db.value("""
      SELECT COALESCE(SUM(amount), 0) FROM income_records
       WHERE term_id = %s OR (term_id IS NULL AND COALESCE(transaction_date, date) BETWEEN %s AND %s)
    """, (tid, start, end)), 0)

    collected = _safe(lambda: db.value(
        "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE term_id = %s AND is_reversed = 0",
        (tid,)), 0)

    outstanding = _safe(lambda: db.one("""
      SELECT COALESCE(SUM(balance), 0) AS total,
             COUNT(*) FILTER (WHERE balance > 0) AS debtor_count
        FROM student_bills WHERE term_id = %s AND COALESCE(status, 'active') = 'active'
    """, (tid,)), {"total": 0, "debtor_count": 0})

    canteen_owed = _safe(lambda: db.one("""
      SELECT COUNT(*) AS unpaid_days, COUNT(DISTINCT student_id) AS unpaid_students
        FROM canteen_day_status WHERE status = 'unpaid' AND date >= %s AND date <= %s
    """, (start, end)), {"unpaid_days": 0, "unpaid_students": 0})

    billed = _safe(lambda: db.value("""
      SELECT COALESCE(SUM(total_billed), 0) FROM student_bills
       WHERE term_id = %s AND COALESCE(status, 'active') = 'active'
    """, (tid,)), 0)

    income_by_month = _safe(lambda: db.all("""
      SELECT substr(COALESCE(transaction_date, date), 1, 7) AS ym,
             COALESCE(SUM(amount), 0) AS total
        FROM income_records
       WHERE COALESCE(transaction_date, date) >= %s AND COALESCE(transaction_date, date) <= %s
       GROUP BY ym ORDER BY ym
    """, (start, end)), [])

    expense_by_month = _safe(lambda: db.all("""
      SELECT substr(COALESCE(transaction_date, date), 1, 7) AS ym,
             COALESCE(SUM(amount), 0) AS total
        FROM expense_records
       WHERE COALESCE(transaction_date, date) >= %s AND COALESCE(transaction_date, date) <= %s
       GROUP BY ym ORDER BY ym
    """, (start, end)), [])

    fee_payments = _safe(lambda: db.all("""
      SELECT p.id, p.amount, p.payment_date, p.receipt_number,
             s.surname, s.first_name, s.index_number, 'Fee Payment' AS payment_type
        FROM payments p JOIN students s ON s.id = p.student_id
       WHERE p.is_reversed = 0
       ORDER BY p.payment_date DESC, p.id DESC LIMIT 5
    """), [])

    canteen_payments = _safe(lambda: db.all("""
      SELECT cp.id, cp.amount, cp.payment_date,
             s.surname, s.first_name, s.index_number, 'Canteen Payment' AS payment_type
        FROM canteen_payments cp JOIN students s ON s.id = cp.student_id
       ORDER BY cp.payment_date DESC, cp.id DESC LIMIT 5
    """), [])

    recent = sorted([*fee_payments, *canteen_payments],
                    key=lambda r: str(r.get("payment_date") or ""), reverse=True)[:5]

    top_fee_debtors = _safe(lambda: db.all("""
      SELECT sb.balance, sb.generated_at, s.id AS student_id, s.surname, s.first_name,
             s.index_number, cg.short_code AS class_code
        FROM student_bills sb
        JOIN students s ON s.id = sb.student_id
        LEFT JOIN class_groups cg ON cg.id = s.current_class_id
       WHERE sb.balance > 0 AND sb.term_id = %s AND COALESCE(sb.status, 'active') = 'active'
       ORDER BY sb.balance DESC LIMIT 5
    """, (tid,)), [])
    for r in top_fee_debtors:
        r["days_outstanding"] = _days_since(r.pop("generated_at", None))

    top_canteen_debtors = _safe(lambda: db.all("""
      SELECT s.id AS student_id, s.surname, s.first_name, s.index_number,
             cg.short_code AS class_code,
             COUNT(cds.id) AS unpaid_days, COUNT(cds.id) * %s AS amount_owed
        FROM canteen_day_status cds
        JOIN students s ON s.id = cds.student_id
        LEFT JOIN class_groups cg ON cg.id = s.current_class_id
       WHERE cds.status = 'unpaid' AND cds.date >= %s AND cds.date <= %s
       GROUP BY s.id, cg.short_code ORDER BY unpaid_days DESC LIMIT 5
    """, (rate, start, end)), [])

    return {
        "ok": True,
        "term": _term_out(term),
        "school": {"name": db.get_setting("school_name", "School"),
                   "motto": db.get_setting("school_motto", "")},
        "metrics": {
            "student_total": student_total,
            "class_count": class_count,
            "staff_active": staff_active,
            "income_total": round(_num(income)),
            "fees_collected": round(_num(collected)),
            "fees_outstanding": round(_num(outstanding["total"])),
            "debtor_count": outstanding.get("debtor_count") or 0,
            "canteen_owed": round(_num(canteen_owed["unpaid_days"]) * rate),
            "canteen_unpaid_students": canteen_owed.get("unpaid_students") or 0,
            "total_billed": round(_num(billed)),
            "collection_pct": (round(_num(collected) / _num(billed) * 100)
                               if _num(billed) > 0 else 0),
        },
        "charts": {"income_by_month": income_by_month, "expense_by_month": expense_by_month},
        "recent_payments": recent,
        "top_fee_debtors": top_fee_debtors,
        "top_canteen_debtors": top_canteen_debtors,
        "schedule": _school_day(),
    }


# ══ Students ════════════════════════════════════════════════════════════════

def students(db, actor):
    refused = _gate(actor, "students")
    if refused:
        return refused

    by_status = _safe(lambda: db.all(
        "SELECT COALESCE(status, 'Active') AS status, COUNT(*) AS c FROM students GROUP BY status"), [])
    count = lambda name: next((r["c"] for r in by_status if r["status"] == name), 0)  # noqa: E731
    total = sum(r["c"] for r in by_status)
    active = count("Active")

    # 'M'/'Male'/'boy' all mean the same thing in a register typed by four
    # people over six years.
    gender = _safe(lambda: db.one("""
      SELECT COUNT(*) FILTER (WHERE lower(trim(COALESCE(gender,''))) IN ('m','male','boy'))    AS male,
             COUNT(*) FILTER (WHERE lower(trim(COALESCE(gender,''))) IN ('f','female','girl')) AS female
        FROM students WHERE status = 'Active'
    """), {"male": 0, "female": 0})

    by_class = _safe(lambda: db.all("""
      SELECT COALESCE(c.name, 'Unassigned') AS name, COUNT(s.id) AS count
        FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE s.status = 'Active'
       GROUP BY COALESCE(c.name, 'Unassigned') ORDER BY count DESC
    """), [])

    recent = _safe(lambda: db.all("""
      SELECT s.id, s.index_number, s.surname, s.first_name,
             s.admission_date, c.name AS class_name
        FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE s.admission_date IS NOT NULL
       ORDER BY s.admission_date DESC, s.id DESC LIMIT 6
    """), [])

    male, female = gender.get("male") or 0, gender.get("female") or 0
    return {
        "ok": True,
        "metrics": {
            "total": total,
            "active": active,
            "inactive": count("Inactive") + count("Withdrawn") + count("Suspended"),
            "graduated": count("Graduated"),
            "male": male, "female": female,
            "male_pct": round(male / active * 100) if active > 0 else 0,
            "female_pct": round(female / active * 100) if active > 0 else 0,
        },
        "by_class": by_class,
        "recent_admissions": recent,
    }


# ══ Academics ═══════════════════════════════════════════════════════════════

def academics(db, actor, term_id=None):
    refused = _gate(actor, "academics")
    if refused:
        return refused
    term = _term(db, term_id)
    if not term:
        return {"ok": True, "term": None, "metrics": {},
                "class_performance": [], "top_students": []}
    tid = term["id"]

    scores_entered = _safe(lambda: db.value(
        "SELECT COUNT(*) FROM scores WHERE term_id = %s", (tid,)), 0)
    students_with_scores = _safe(lambda: db.value(
        "SELECT COUNT(DISTINCT student_id) FROM scores WHERE term_id = %s", (tid,)), 0)

    class_performance = _safe(lambda: db.all("""
      SELECT cg.id, cg.name AS class_name, cg.short_code,
             COUNT(DISTINCT sts.student_id) AS students_assessed,
             ROUND(AVG(sts.average_score)::numeric, 1) AS class_average
        FROM student_term_summary sts
        JOIN class_groups cg ON cg.id = sts.class_group_id
       WHERE sts.term_id = %s AND sts.average_score IS NOT NULL
       GROUP BY cg.id, cg.name, cg.short_code, cg.level_order ORDER BY cg.level_order
    """, (tid,)), [])

    top_students = _safe(lambda: db.all("""
      SELECT sts.average_score, sts.class_rank,
             s.id AS student_id, s.surname, s.first_name, s.index_number,
             cg.name AS class_name, cg.short_code
        FROM student_term_summary sts
        JOIN students s ON s.id = sts.student_id
        LEFT JOIN class_groups cg ON cg.id = sts.class_group_id
       WHERE sts.term_id = %s AND sts.average_score IS NOT NULL
       ORDER BY sts.average_score DESC LIMIT 10
    """, (tid,)), [])

    papers = _safe(lambda: db.one("""
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
             SUM(CASE WHEN status = 'draft'     THEN 1 ELSE 0 END) AS draft
        FROM exam_papers WHERE term_id = %s
    """, (tid,)), {"total": 0, "published": 0, "draft": 0})

    bank = _safe(lambda: db.value(
        "SELECT COUNT(*) FROM exam_questions WHERE in_question_bank = 1"), 0)

    return {
        "ok": True,
        "term": _term_out(term),
        "metrics": {
            "scores_entered": scores_entered,
            "students_with_scores": students_with_scores,
            "exam_papers_total": papers.get("total") or 0,
            "exam_papers_published": papers.get("published") or 0,
            "exam_papers_draft": papers.get("draft") or 0,
            "question_bank_size": bank,
        },
        "class_performance": class_performance,
        "top_students": top_students,
    }


# ══ Fees ════════════════════════════════════════════════════════════════════

def fees(db, actor, term_id=None):
    refused = _gate(actor, "fees")
    if refused:
        return refused
    term = _term(db, term_id)
    if not term:
        return {"ok": True, "term": None, "metrics": {},
                "top_debtors": [], "recent_payments": [], "by_class": []}
    tid = term["id"]

    billed = _safe(lambda: db.one("""
      SELECT COALESCE(SUM(total_billed), 0) AS total, COUNT(*) AS count
        FROM student_bills WHERE term_id = %s AND COALESCE(status, 'active') = 'active'
    """, (tid,)), {"total": 0, "count": 0})

    collected = _safe(lambda: db.one("""
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS payment_count
        FROM payments WHERE term_id = %s AND is_reversed = 0
    """, (tid,)), {"total": 0, "payment_count": 0})

    outstanding = _safe(lambda: db.one("""
      SELECT COALESCE(SUM(balance), 0) AS total,
             COUNT(*) FILTER (WHERE balance > 0) AS debtor_count
        FROM student_bills WHERE term_id = %s AND COALESCE(status, 'active') = 'active'
    """, (tid,)), {"total": 0, "debtor_count": 0})

    # The same projection the desktop shows, from the same rules: existing
    # bills are authoritative, and pupils with no bill are put through the
    # template bill generation would use — so raising the missing bills does
    # not move the figure.
    projected = _safe(lambda: billing.projected_income_for_term(db, tid),
                      {"total": 0, "billed_total": 0, "projected_total": 0,
                       "projected_count": 0, "unresolved_count": 0})

    top_debtors = _safe(lambda: db.all("""
      SELECT sb.balance, sb.generated_at, s.id AS student_id, s.surname, s.first_name,
             s.index_number, cg.short_code AS class_code, cg.name AS class_name
        FROM student_bills sb
        JOIN students s ON s.id = sb.student_id
        LEFT JOIN class_groups cg ON cg.id = s.current_class_id
       WHERE sb.balance > 0 AND sb.term_id = %s AND COALESCE(sb.status, 'active') = 'active'
       ORDER BY sb.balance DESC LIMIT 10
    """, (tid,)), [])
    for r in top_debtors:
        r["days_outstanding"] = _days_since(r.pop("generated_at", None))

    recent_payments = _safe(lambda: db.all("""
      SELECT p.id, p.amount, p.payment_date, p.receipt_number, p.payment_method,
             s.surname, s.first_name, s.index_number, cg.short_code AS class_code
        FROM payments p JOIN students s ON s.id = p.student_id
        LEFT JOIN class_groups cg ON cg.id = s.current_class_id
       WHERE p.term_id = %s AND p.is_reversed = 0
       ORDER BY p.payment_date DESC, p.id DESC LIMIT 10
    """, (tid,)), [])

    by_class = _safe(lambda: db.all("""
      SELECT cg.id, cg.name, cg.short_code,
             COUNT(DISTINCT sb.student_id) AS student_count,
             COALESCE(SUM(sb.total_billed), 0) AS total_billed,
             COALESCE(SUM(sb.total_paid), 0) AS total_paid,
             COALESCE(SUM(sb.balance), 0) AS total_outstanding
        FROM class_groups cg
        LEFT JOIN students s ON s.current_class_id = cg.id AND s.status = 'Active'
        LEFT JOIN student_bills sb ON sb.student_id = s.id AND sb.term_id = %s
                                  AND COALESCE(sb.status, 'active') = 'active'
       WHERE cg.is_active = 1
       GROUP BY cg.id, cg.name, cg.short_code, cg.level_order
      HAVING COUNT(DISTINCT sb.student_id) > 0
       ORDER BY cg.level_order
    """, (tid,)), [])

    return {
        "ok": True,
        "term": _term_out(term),
        "metrics": {
            "expected_income": _money(projected["total"]),
            "expected_billed": _money(projected["billed_total"]),
            "expected_projected": _money(projected["projected_total"]),
            "unbilled_students": projected.get("projected_count") or 0,
            "unbillable_students": projected.get("unresolved_count") or 0,
            "total_billed": _money(billed["total"]),
            "total_collected": _money(collected["total"]),
            "outstanding": _money(outstanding["total"]),
            "collection_pct": (round(_num(collected["total"]) / _num(billed["total"]) * 100)
                               if _num(billed["total"]) > 0 else 0),
            "debtor_count": outstanding.get("debtor_count") or 0,
            "bill_count": billed.get("count") or 0,
            "payment_count": collected.get("payment_count") or 0,
        },
        "top_debtors": top_debtors,
        "recent_payments": recent_payments,
        "by_class": by_class,
    }


# ══ Canteen ═════════════════════════════════════════════════════════════════

def canteen(db, actor, term_id=None):
    refused = _gate(actor, "canteen")
    if refused:
        return refused
    term = _term(db, term_id)
    if not term:
        return {"ok": True, "term": None, "metrics": {},
                "top_debtors": [], "recent_payments": []}
    tid = term["id"]
    rate = _daily_rate(db)
    start, end = term.get("start_date"), term.get("end_date")

    total_days = _safe(lambda: db.value("""
      SELECT COUNT(*) FROM school_calendar WHERE term_id = %s AND day_type = 'school_day'
    """, (tid,)), 0)

    paid = _safe(lambda: db.one("""
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS payment_count
        FROM canteen_payments
       WHERE term_id = %s OR (term_id IS NULL AND payment_date >= %s AND payment_date <= %s)
    """, (tid, start, end)), {"total": 0, "payment_count": 0})

    unpaid = _safe(lambda: db.one("""
      SELECT COUNT(*) AS days, COUNT(DISTINCT student_id) AS students
        FROM canteen_day_status WHERE status = 'unpaid' AND date >= %s AND date <= %s
    """, (start, end)), {"days": 0, "students": 0})

    active_students = _safe(lambda: db.value(
        "SELECT COUNT(*) FROM students WHERE status = 'Active'"), 0)

    top_debtors = _safe(lambda: db.all("""
      SELECT s.id AS student_id, s.surname, s.first_name, s.index_number,
             cg.short_code AS class_code, cg.name AS class_name,
             COUNT(cds.id) AS unpaid_days, COUNT(cds.id) * %s AS amount_owed
        FROM canteen_day_status cds
        JOIN students s ON s.id = cds.student_id
        LEFT JOIN class_groups cg ON cg.id = s.current_class_id
       WHERE cds.status = 'unpaid' AND cds.date >= %s AND cds.date <= %s
       GROUP BY s.id, cg.short_code, cg.name ORDER BY unpaid_days DESC LIMIT 10
    """, (rate, start, end)), [])

    recent_payments = _safe(lambda: db.all("""
      SELECT cp.id, cp.amount, cp.payment_date, cp.days_covered, cp.start_date, cp.end_date,
             s.surname, s.first_name, s.index_number, cg.short_code AS class_code
        FROM canteen_payments cp JOIN students s ON s.id = cp.student_id
        LEFT JOIN class_groups cg ON cg.id = s.current_class_id
       WHERE cp.term_id = %s OR (cp.term_id IS NULL AND cp.payment_date >= %s AND cp.payment_date <= %s)
       ORDER BY cp.payment_date DESC, cp.id DESC LIMIT 10
    """, (tid, start, end)), [])

    today = _safe(lambda: db.one("""
      SELECT SUM(CASE WHEN status = 'paid'   THEN 1 ELSE 0 END) AS paid,
             SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid,
             SUM(CASE WHEN status = 'exempt' THEN 1 ELSE 0 END) AS exempt
        FROM canteen_day_status WHERE date = %s
    """, (_today(),)), {"paid": 0, "unpaid": 0, "exempt": 0})

    return {
        "ok": True,
        "term": _term_out(term),
        "daily_rate": rate,
        "metrics": {
            "total_collected": _money(paid["total"]),
            "payment_count": paid.get("payment_count") or 0,
            "unpaid_days_total": unpaid.get("days") or 0,
            "unpaid_students": unpaid.get("students") or 0,
            "amount_owed": _money(_num(unpaid.get("days")) * rate),
            "total_school_days": total_days,
            "active_students": active_students,
            "attendance_exempt_enabled":
                db.get_setting("canteen_attendance_exempt_enabled", "true") == "true",
            "today_paid": today.get("paid") or 0,
            "today_unpaid": today.get("unpaid") or 0,
            "today_exempt": today.get("exempt") or 0,
        },
        "top_debtors": top_debtors,
        "recent_payments": recent_payments,
    }


# ══ Staff ═══════════════════════════════════════════════════════════════════

def staff(db, actor):
    refused = _gate(actor, "staff")
    if refused:
        return refused
    today = _today()

    total_active = _safe(lambda: db.value(
        "SELECT COUNT(*) FROM staff WHERE status = 'Active'"), 0)
    total_inactive = _safe(lambda: db.value(
        "SELECT COUNT(*) FROM staff WHERE status <> 'Active'"), 0)

    by_role = _safe(lambda: db.all("""
      SELECT COALESCE(role, 'Unassigned') AS role, COUNT(*) AS count
        FROM staff WHERE status = 'Active' GROUP BY role ORDER BY count DESC
    """), [])

    by_gender = _safe(lambda: db.all("""
      SELECT gender, COUNT(*) AS count FROM staff WHERE status = 'Active' GROUP BY gender
    """), [])

    att = _safe(lambda: db.one("""
      SELECT SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN status = 'absent'  THEN 1 ELSE 0 END) AS absent,
             SUM(CASE WHEN status = 'late'    THEN 1 ELSE 0 END) AS late,
             COUNT(*) AS total
        FROM staff_attendance WHERE date = %s
    """, (today,)), {"present": 0, "absent": 0, "late": 0, "total": 0})

    pending_leave = _safe(lambda: db.value(
        "SELECT COUNT(*) FROM leave_requests WHERE status = 'pending'"), 0)
    on_leave = _safe(lambda: db.value("""
      SELECT COUNT(*) FROM leave_requests
       WHERE status = 'approved' AND start_date <= %s AND end_date >= %s
    """, (today, today)), 0)

    ninety = (datetime.date.today() + datetime.timedelta(days=90)).isoformat()
    expiring = _safe(lambda: db.all("""
      SELECT sd.id, sd.title, sd.doc_type, sd.expiry_date,
             s.surname, s.first_name, s.id AS staff_id
        FROM staff_documents sd JOIN staff s ON s.id = sd.staff_id
       WHERE sd.expiry_date IS NOT NULL AND sd.expiry_date >= %s AND sd.expiry_date <= %s
         AND s.status = 'Active'
       ORDER BY sd.expiry_date LIMIT 10
    """, (today, ninety)), [])

    six_months = (datetime.date.today() - datetime.timedelta(days=180)).isoformat()
    recent_hires = _safe(lambda: db.all("""
      SELECT s.id, s.surname, s.first_name, s.role, s.hire_date
        FROM staff s WHERE s.hire_date >= %s AND s.status = 'Active'
       ORDER BY s.hire_date DESC LIMIT 6
    """, (six_months,)), [])

    return {
        "ok": True,
        "metrics": {
            "total_active": total_active,
            "total_inactive": total_inactive,
            "total_all": total_active + total_inactive,
            "today_present": att.get("present") or 0,
            "today_absent": att.get("absent") or 0,
            "today_late": att.get("late") or 0,
            "today_total_marked": att.get("total") or 0,
            "pending_leave": pending_leave,
            "on_leave_today": on_leave,
            "clockin_enabled": db.get_setting("staff_clockin_enabled", "false") == "true",
        },
        "by_role": by_role,
        "by_gender": by_gender,
        "expiring_documents": expiring,
        "recent_hires": recent_hires,
    }


# ══ Payroll ═════════════════════════════════════════════════════════════════
#
# SSNIT is reported as three numbers rather than one because they are three
# obligations: the worker's 5.5%, the employer's 13%, and the 18.5% that is
# filed. A single "SSNIT" figure is the one a school gets wrong on the return.

def payroll(db, actor, month=None, year=None):
    refused = _gate(actor, "payroll")
    if refused:
        return refused
    now = datetime.date.today()
    month = int(month or now.month)
    year = int(year or now.year)
    if not (1 <= month <= 12) or not (1970 <= year <= 2999):
        return {"ok": False, "status": 400, "error": "Bad month or year."}

    run = _safe(lambda: db.one("""
      SELECT COUNT(*) AS staff, COALESCE(SUM(gross_salary), 0) AS gross,
             COALESCE(SUM(net_salary), 0) AS net,
             COALESCE(SUM(ssnit_worker), 0) AS ssnit_employee,
             COALESCE(SUM(ssnit_employer), 0) AS ssnit_employer,
             COALESCE(SUM(paye_tax), 0) AS paye,
             COUNT(*) FILTER (WHERE is_paid = 1) AS paid_count,
             COALESCE(SUM(CASE WHEN is_paid = 1 THEN actual_amount_paid ELSE 0 END), 0) AS paid_total
        FROM staff_salaries WHERE month = %s AND year = %s
    """, (month, year)), {})

    eligible = _safe(lambda: db.value(
        "SELECT COUNT(*) FROM staff WHERE status = 'Active'"), 0)

    gross, net = _num(run.get("gross")), _num(run.get("net"))
    paid_total = _num(run.get("paid_total"))
    return {
        "ok": True,
        "month": month, "year": year,
        "month_label": f"{MONTHS[month - 1]} {year}",
        "metrics": {
            "staff_on_run": run.get("staff") or 0,
            "eligible_staff": eligible,
            "gross": _money(gross),
            "net": _money(net),
            "ssnit_employee": _money(run.get("ssnit_employee")),
            "ssnit_employer": _money(run.get("ssnit_employer")),
            "ssnit_combined": _money(_num(run.get("ssnit_employee")) + _num(run.get("ssnit_employer"))),
            "paye": _money(run.get("paye")),
            "employer_cost": _money(gross + _num(run.get("ssnit_employer"))),
            "paid_count": run.get("paid_count") or 0,
            "paid_total": _money(paid_total),
            "outstanding": _money(max(0.0, net - paid_total)),
        },
    }


# ══ Finance ═════════════════════════════════════════════════════════════════

def finance(db, actor, term_id=None):
    refused = _gate(actor, "finance")
    if refused:
        return refused
    term = _term(db, term_id)
    if not term:
        return {"ok": True, "term": None, "metrics": {},
                "income_by_category": [], "expense_by_category": [],
                "recent_income": [], "recent_expenses": []}
    tid = term["id"]
    start, end = term.get("start_date"), term.get("end_date")

    income = _safe(lambda: db.all("""
      SELECT category, COALESCE(SUM(amount), 0) AS total FROM income_records
       WHERE term_id = %s OR (term_id IS NULL AND COALESCE(transaction_date, date) BETWEEN %s AND %s)
       GROUP BY category ORDER BY total DESC
    """, (tid, start, end)), [])

    expense = _safe(lambda: db.all("""
      SELECT category, COALESCE(SUM(amount), 0) AS total FROM expense_records
       WHERE term_id = %s OR (term_id IS NULL AND COALESCE(transaction_date, date) BETWEEN %s AND %s)
       GROUP BY category ORDER BY total DESC
    """, (tid, start, end)), [])

    income_total = sum(_num(r["total"]) for r in income)
    expense_total = sum(_num(r["total"]) for r in expense)

    expected = _safe(lambda: billing.projected_income_for_term(db, tid)["total"], 0)
    staff_count = _safe(lambda: db.value(
        "SELECT COUNT(*) FROM staff WHERE status = 'Active'"), 0)

    recent_income = _safe(lambda: db.all("""
      SELECT ir.id, ir.receipt_number, ir.category, ir.amount, ir.payer_name,
             ir.description, COALESCE(ir.transaction_date, ir.date) AS transaction_date
        FROM income_records ir
       WHERE ir.term_id = %s OR (ir.term_id IS NULL
             AND COALESCE(ir.transaction_date, ir.date) BETWEEN %s AND %s)
       ORDER BY COALESCE(ir.transaction_date, ir.date) DESC, ir.id DESC LIMIT 5
    """, (tid, start, end)), [])

    recent_expenses = _safe(lambda: db.all("""
      SELECT er.id, er.transaction_number, er.category, er.amount, er.payee_name,
             er.description, COALESCE(er.transaction_date, er.date) AS transaction_date
        FROM expense_records er
       WHERE er.term_id = %s OR (er.term_id IS NULL
             AND COALESCE(er.transaction_date, er.date) BETWEEN %s AND %s)
       ORDER BY COALESCE(er.transaction_date, er.date) DESC, er.id DESC LIMIT 5
    """, (tid, start, end)), [])

    return {
        "ok": True,
        "term": _term_out(term),
        "may": {"record": security.can(actor, "finance", "create")
                or security.can(actor, "finance", "edit")},
        "metrics": {
            "expected_income": _money(expected),
            "income_total": _money(income_total),
            "expense_total": _money(expense_total),
            "net": _money(income_total - expense_total),
            "staff_active": staff_count,
        },
        "income_by_category": income,
        "expense_by_category": expense,
        "recent_income": recent_income,
        "recent_expenses": recent_expenses,
    }
