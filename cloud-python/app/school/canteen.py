"""The canteen — a translation of ``electron/ipc/canteen.js``.

A pupil pays for lunch by the day, so a payment is not an amount against a
balance: it buys a number of school days and marks the next unpaid ones as
paid, from the school calendar forward. That is why this is its own module
rather than a category of fees.

Two consequences worth naming, both the offline system's:

  * The daily rate is read at the time of collection and STORED on the payment.
    A school that raises the rate mid-term has not retrospectively changed what
    yesterday's cedi bought.
  * The days are marked from the payment date FORWARD. Paying on Wednesday for
    five days covers Wednesday to Tuesday, skipping the weekend and any day the
    calendar says is not a school day.
"""
import datetime

from . import ledger, scope as scope_lib, security
from .billing import round2


def _today():
    return datetime.date.today().isoformat()


def daily_rate(db):
    try:
        return float(db.get_setting("canteen_daily_rate", "5") or 5)
    except (TypeError, ValueError):
        return 5.0


def student_status(db, actor, student_id, term_id=None):
    """What one pupil owes, day by day."""
    if not scope_lib.can_access_student(db, actor["scope"], student_id):
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}
    term = (db.one("SELECT * FROM terms WHERE id = %s", (term_id,)) if term_id
            else db.one("SELECT * FROM terms WHERE is_current = 1"))
    rate = daily_rate(db)
    student = db.one("""
      SELECT s.id, s.index_number, s.surname, s.first_name, c.name AS class_name
        FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE s.id = %s""", (student_id,))
    if not student:
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}

    days = db.all("""
      SELECT sc.date, COALESCE(cds.status, 'unpaid') AS status
        FROM school_calendar sc
        LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = %s
       WHERE sc.term_id = %s AND sc.day_type = 'school_day'
       ORDER BY sc.date""", (student_id, term["id"] if term else None)) if term else []
    unpaid = [d for d in days if d["status"] == "unpaid"]

    student["name"] = f"{student.get('surname') or ''} {student.get('first_name') or ''}".strip()
    return {
        "ok": True, "student": student, "daily_rate": rate,
        "term": {"id": term["id"], "label": term["label"]} if term else None,
        "days": days,
        "paid_days": sum(1 for d in days if d["status"] == "paid"),
        "exempt_days": sum(1 for d in days if d["status"] == "exempt"),
        "unpaid_days": len(unpaid),
        "amount_owed": round2(len(unpaid) * rate),
        "payments": db.all("""
          SELECT payment_date, amount, days_covered, start_date, end_date, daily_rate, notes
            FROM canteen_payments WHERE student_id = %s
           ORDER BY payment_date DESC, id DESC LIMIT 60""", (student_id,)),
        "may_collect": security.can(actor, "canteen", "create"),
    }


def collect(db, actor, student_id, amount, payment_method="Cash", notes=None, date=None):
    """Take a canteen payment: buys days, marks them, posts the income."""
    if not scope_lib.can_access_student(db, actor["scope"], student_id):
        return {"ok": False, "status": 403, "error": "That pupil is not in one of your classes."}
    amount = round2(amount)
    if amount <= 0:
        return {"ok": False, "status": 400, "error": "Enter an amount greater than zero."}

    rate = daily_rate(db)
    if rate <= 0:
        return {"ok": False, "status": 400,
                "error": "Set the canteen daily rate in Settings before collecting."}
    days = int(amount // rate)
    if days <= 0:
        return {"ok": False, "status": 400,
                "error": f"That is less than one day at {rate:g} a day."}

    pay_date = str(date or _today())[:10]
    term = db.one("SELECT id FROM terms WHERE is_current = 1")
    term_id = term["id"] if term else None

    unpaid = db.all("""
      SELECT sc.date FROM school_calendar sc
        LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = %s
       WHERE sc.date >= %s AND sc.day_type = 'school_day'
         AND (cds.status IS NULL OR cds.status = 'unpaid')
       ORDER BY sc.date LIMIT %s""", (student_id, pay_date, days))

    start_date = unpaid[0]["date"] if unpaid else pay_date
    end_date = unpaid[-1]["date"] if unpaid else pay_date

    with db.tx() as tx:
        payment_id = tx.insert("canteen_payments", {
            "student_id": student_id, "term_id": term_id, "payment_date": pay_date,
            "amount": amount, "daily_rate": rate, "days_covered": days,
            "start_date": start_date, "end_date": end_date,
            "received_by": actor["user_id"], "notes": notes or "",
        })
        for d in unpaid:
            tx.run("""INSERT INTO canteen_day_status (student_id, date, status, payment_id)
                           VALUES (%s,%s,'paid',%s)
                      ON CONFLICT (student_id, date)
                      DO UPDATE SET status = 'paid', payment_id = EXCLUDED.payment_id""",
                   (student_id, d["date"], payment_id))
        ledger.post_income(tx, {
            "category": "canteen", "amount": amount,
            "description": f"Canteen payment - {days} days @ {rate:.2f}",
            "payment_method": payment_method or "Cash", "date": pay_date,
            "source": "canteen_payment", "student_id": student_id, "term_id": term_id,
            "linked_canteen_payment_id": payment_id,
            "recorded_by": actor["user_id"], "is_auto": 1,
        })

    security.audit(db, actor, "canteen_payment", payment_id, "collect_canteen",
                   f"{amount} for {days} day(s)")
    return {"ok": True, "id": payment_id, "days_covered": days,
            "start_date": start_date, "end_date": end_date}


def class_sheet(db, actor, class_id, date=None):
    """The morning collection: who has paid for today and who has not.

    Belongs to the class teacher, exactly as on the desktop — the register and
    the canteen sheet are the two things one person is answerable for.
    """
    if not scope_lib.is_class_teacher_of(actor["scope"], class_id):
        return {"ok": False, "status": 403, "error": "The canteen sheet belongs to the class teacher."}
    date = str(date or _today())[:10]
    rate = daily_rate(db)
    term = db.one("SELECT id FROM terms WHERE is_current = 1")

    rows = db.all("""
      SELECT s.id, s.index_number, s.surname, s.first_name,
             COALESCE(cds.status, 'unpaid') AS today_status,
             (SELECT count(*) FROM school_calendar sc
                LEFT JOIN canteen_day_status c2 ON c2.date = sc.date AND c2.student_id = s.id
               WHERE sc.term_id = %s AND sc.day_type = 'school_day'
                 AND (c2.status IS NULL OR c2.status = 'unpaid')) AS unpaid_days
        FROM students s
        LEFT JOIN canteen_day_status cds ON cds.student_id = s.id AND cds.date = %s
       WHERE s.current_class_id = %s AND s.status = 'Active'
       ORDER BY s.surname, s.first_name""",
                  (term["id"] if term else None, date, class_id))
    for r in rows:
        r["name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
        r["amount_owed"] = round2((r["unpaid_days"] or 0) * rate)
    return {
        "ok": True, "date": date, "daily_rate": rate, "students": rows,
        "paid_today": sum(1 for r in rows if r["today_status"] == "paid"),
        "owed_total": round2(sum(r["amount_owed"] for r in rows)),
        "may_collect": security.can(actor, "canteen", "create"),
    }


def quick_pay(db, actor, class_id, student_ids, date=None, payment_method="Cash"):
    """One press for the pupils who have paid this morning.

    Each is its own collection — same function, same ledger entry, same day
    marking — so the sheet and a one-at-a-time collection cannot diverge.
    """
    if not scope_lib.is_class_teacher_of(actor["scope"], class_id):
        return {"ok": False, "status": 403, "error": "The canteen sheet belongs to the class teacher."}
    rate = daily_rate(db)
    done, failed = [], []
    for sid in student_ids or []:
        r = collect(db, actor, sid, rate, payment_method, "Morning collection", date)
        (done if r.get("ok") else failed).append(sid)
    return {"ok": True, "collected": len(done), "failed": failed,
            "amount": round2(len(done) * rate)}


def exempt(db, actor, class_id, student_ids, date=None, reason=""):
    """Excuse a pupil from the canteen for a day.

    A day already PAID for is never quietly turned into an exemption — that
    would strand a real payment against nothing and the money would vanish
    from the day it bought.
    """
    if not scope_lib.is_class_teacher_of(actor["scope"], class_id):
        return {"ok": False, "status": 403, "error": "The canteen sheet belongs to the class teacher."}
    date = str(date or _today())[:10]
    excused, skipped = 0, 0
    with db.tx() as tx:
        for sid in student_ids or []:
            existing = tx.one("SELECT status FROM canteen_day_status WHERE student_id = %s AND date = %s",
                              (sid, date))
            if existing and existing["status"] == "paid":
                skipped += 1
                continue
            tx.run("""INSERT INTO canteen_day_status (student_id, date, status)
                           VALUES (%s,%s,'exempt')
                      ON CONFLICT (student_id, date) DO UPDATE SET status = 'exempt'""",
                   (sid, date))
            excused += 1
    security.audit(db, actor, "canteen", class_id, "exempt_canteen",
                   f"{excused} excused on {date}: {reason}")
    return {"ok": True, "excused": excused, "already_paid": skipped}


def debtors(db, actor, term_id=None):
    term = (db.one("SELECT id FROM terms WHERE id = %s", (term_id,)) if term_id
            else db.one("SELECT id FROM terms WHERE is_current = 1"))
    if not term:
        return {"ok": True, "debtors": [], "total": 0}
    rate = daily_rate(db)
    rows = db.all("""
      SELECT s.id, s.index_number, s.surname, s.first_name, c.name AS class_name,
             COALESCE(s.guardian_contact, s.father_contact, s.mother_contact) AS contact,
             (SELECT count(*) FROM school_calendar sc
                LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = s.id
               WHERE sc.term_id = %s AND sc.day_type = 'school_day'
                 AND (cds.status IS NULL OR cds.status = 'unpaid')) AS unpaid_days
        FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE s.status = 'Active'
       ORDER BY unpaid_days DESC, s.surname""", (term["id"],))
    out = []
    for r in rows:
        if not r["unpaid_days"]:
            continue
        r["name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
        r["amount_owed"] = round2(r["unpaid_days"] * rate)
        out.append(r)
    return {"ok": True, "daily_rate": rate, "debtors": out,
            "total": round2(sum(r["amount_owed"] for r in out))}
