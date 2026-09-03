"""Payroll — a translation of ``electron/ipc/payroll.js``.

Ghana's PAYE bands and the SSNIT rates, applied exactly as the offline system
applies them, because a payslip computed one way online and another way on the
desktop is two payslips for one month and a conversation with the Ghana Revenue
Authority nobody wants.

The bands are cumulative monthly thresholds in GHS, from the Income Tax Act 896
and its amendments. They live here as data rather than in a settings table on
purpose: a school does not get to choose the country's tax bands, and a school
that could edit them would eventually file a return that did not add up.
"""
import datetime

from . import ledger, security
from .billing import round2

PAYE_BANDS = [
    (490.00, 0.000),        # first 490 — tax free
    (600.00, 0.050),        # next 110
    (730.00, 0.100),        # next 130
    (3896.67, 0.175),       # next 3,166.67
    (19896.67, 0.250),      # next 16,000
    (50416.67, 0.300),      # next 30,520
    (float("inf"), 0.350),  # above
]


def calculate_paye(taxable):
    if taxable <= 0:
        return 0.0
    tax, remaining, lower = 0.0, taxable, 0.0
    for upper, rate in PAYE_BANDS:
        width = upper - lower
        in_band = min(remaining, width)
        if in_band <= 0:
            break
        tax += in_band * rate
        remaining -= in_band
        lower = upper
        if remaining <= 0:
            break
    return round2(tax)


def ssnit_rates(db):
    if db.get_setting("feature_ssnit_enabled", "true") == "false":
        return {"worker": 0.0, "employer": 0.0, "disabled": True}
    try:
        worker = float(db.get_setting("ssnit_worker_pct", "5.5") or 5.5) / 100
    except (TypeError, ValueError):
        worker = 0.055
    try:
        employer = float(db.get_setting("ssnit_employer_pct", "13.0") or 13.0) / 100
    except (TypeError, ValueError):
        employer = 0.13
    return {"worker": worker, "employer": employer, "disabled": False}


def paye_enabled(db):
    return db.get_setting("feature_paye_enabled", "true") != "false"


def calculate(db, gross, extra=0, arrear=0, other_deductions=0, ssnit_enrolled=True):
    """One payslip's arithmetic, without saving anything.

    Taxable income is gross plus extras LESS the worker's SSNIT contribution,
    which is the GRA's order and not an arbitrary one.
    """
    gross, extra = float(gross or 0), float(extra or 0)
    arrear, other = float(arrear or 0), float(other_deductions or 0)
    rates = ssnit_rates(db)
    gross_income = gross + extra
    ssnit_worker = round2(gross_income * rates["worker"]) if ssnit_enrolled else 0.0
    ssnit_employer = round2(gross_income * rates["employer"]) if ssnit_enrolled else 0.0
    taxable = max(0.0, gross_income - ssnit_worker)
    paye = calculate_paye(taxable) if paye_enabled(db) else 0.0
    deductions = ssnit_worker + paye + other
    net = gross_income - deductions
    return {
        "gross_salary": gross, "extra_pay": extra, "gross_income": round2(gross_income),
        "arrear_brought_forward": arrear,
        "ssnit_worker": ssnit_worker, "ssnit_employer": ssnit_employer,
        "paye_tax": paye, "other_deductions": other,
        "total_deductions": round2(deductions), "net_salary": round2(net),
        "expected_amount": round2(net + arrear),
    }


def month_sheet(db, actor, month=None, year=None):
    now = datetime.date.today()
    month = int(month or now.month)
    year = int(year or now.year)
    rows = db.all("""
      SELECT ss.id, ss.staff_id, ss.gross_salary, ss.extra_pay, ss.arrear_brought_forward,
             ss.ssnit_worker, ss.ssnit_employer, ss.paye_tax, ss.other_deductions,
             ss.net_salary, ss.actual_amount_paid, ss.carry_over_to_next, ss.is_paid,
             ss.payment_date, ss.payment_method, ss.payment_reference,
             st.staff_number, st.surname, st.first_name, st.role, d.name AS designation
        FROM staff_salaries ss
        JOIN staff st ON st.id = ss.staff_id
        LEFT JOIN designations d ON d.id = st.designation_id
       WHERE ss.month = %s AND ss.year = %s
       ORDER BY st.surname, st.first_name""", (month, year))
    for r in rows:
        r["staff_name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()

    def total(key):
        return round2(sum(r[key] or 0 for r in rows))

    return {
        "ok": True, "month": month, "year": year, "rows": rows,
        "totals": {
            "staff": len(rows), "gross": total("gross_salary"), "net": total("net_salary"),
            "ssnit_worker": total("ssnit_worker"), "ssnit_employer": total("ssnit_employer"),
            "paye": total("paye_tax"),
            "paid": sum(1 for r in rows if r["is_paid"]),
            "paid_total": round2(sum(r["actual_amount_paid"] or 0 for r in rows if r["is_paid"])),
        },
        "may_run": security.can(actor, "payroll", "edit"),
    }


def run_month(db, actor, month, year, payment_date=None):
    """Compute a month for every active member of staff with a salary.

    Re-runnable: an existing row for the month is updated rather than
    duplicated, and a payment date already set is kept, so re-running after
    correcting one person's base salary does not unpay everybody else.
    """
    month, year = int(month), int(year)
    payment_date = payment_date or datetime.date.today().isoformat()
    staff = db.all("SELECT id, base_salary, ssnit_enrolled FROM staff "
                   "WHERE status = 'Active' AND base_salary > 0")
    created = updated = 0
    prev_month = 12 if month == 1 else month - 1
    prev_year = year - 1 if month == 1 else year

    with db.tx() as tx:
        for s in staff:
            carry = tx.one("""SELECT carry_over_to_next FROM staff_salaries
                               WHERE staff_id = %s AND month = %s AND year = %s""",
                           (s["id"], prev_month, prev_year))
            arrear = (carry or {}).get("carry_over_to_next") or 0
            calc = calculate(db, s["base_salary"], 0, arrear, 0, bool(s["ssnit_enrolled"]))

            existing = tx.one("""SELECT id FROM staff_salaries
                                  WHERE staff_id = %s AND month = %s AND year = %s""",
                              (s["id"], month, year))
            if existing:
                tx.run("""UPDATE staff_salaries
                             SET gross_salary = %s, arrear_brought_forward = %s,
                                 ssnit_worker = %s, ssnit_employer = %s, paye_tax = %s,
                                 net_salary = %s, payment_date = COALESCE(payment_date, %s)
                           WHERE id = %s""",
                       (calc["gross_salary"], arrear, calc["ssnit_worker"], calc["ssnit_employer"],
                        calc["paye_tax"], calc["net_salary"], payment_date, existing["id"]))
                updated += 1
            else:
                tx.insert("staff_salaries", {
                    "staff_id": s["id"], "month": month, "year": year,
                    "gross_salary": calc["gross_salary"], "arrear_brought_forward": arrear,
                    "ssnit_worker": calc["ssnit_worker"], "ssnit_employer": calc["ssnit_employer"],
                    "paye_tax": calc["paye_tax"], "net_salary": calc["net_salary"],
                    "payment_date": payment_date, "is_paid": 0,
                }, returning=None)
                created += 1

    security.audit(db, actor, "payroll", None, "run_payroll",
                   f"{month}/{year}: {created} created, {updated} updated", "high")
    return {"ok": True, "created": created, "updated": updated, "month": month, "year": year}


def mark_paid(db, actor, salary_id, actual_amount, method=None, reference=None, payment_date=None):
    """Record that a salary was actually paid, and post the expense.

    A salary cannot be "paid" for nothing: that state reports the person as
    settled while the ledger records no money leaving the school, which is
    exactly the mismatch a finance audit flags. Anything short of the expected
    amount carries over to next month rather than disappearing.
    """
    salary = db.one("SELECT * FROM staff_salaries WHERE id = %s", (salary_id,))
    if not salary:
        return {"ok": False, "status": 404, "error": "No such salary row."}
    try:
        actual = float(actual_amount)
    except (TypeError, ValueError):
        actual = 0
    if actual <= 0:
        return {"ok": False, "status": 400,
                "error": "Enter the amount actually paid. To record an unpaid salary, leave it pending."}

    expected = round2((salary["net_salary"] or 0) + (salary["arrear_brought_forward"] or 0))
    carry = max(0.0, round2(expected - actual))
    payment_date = payment_date or datetime.date.today().isoformat()
    person = db.one("SELECT surname, first_name FROM staff WHERE id = %s", (salary["staff_id"],))

    with db.tx() as tx:
        tx.run("""UPDATE staff_salaries
                     SET actual_amount_paid = %s, carry_over_to_next = %s, payment_date = %s,
                         payment_method = %s, payment_reference = %s, is_paid = 1
                   WHERE id = %s""",
               (actual, carry, payment_date, method or "Bank", reference, salary_id))
        # Idempotent on linked_salary_id, so marking paid twice cannot double-post.
        ledger.post_expense(tx, {
            "transaction_number": ledger.next_counter(tx, "transaction_counter", "SAL"),
            "category": "salary", "amount": actual,
            "description": f'Salary {salary["month"]}/{salary["year"]}',
            "payee_name": f'{(person or {}).get("surname") or ""} {(person or {}).get("first_name") or ""}'.strip(),
            "payment_method": method or "Bank", "reference": reference,
            "date": payment_date, "linked_salary_id": salary_id,
            "recorded_by": actor["user_id"], "is_auto": 1,
        })

    security.audit(db, actor, "salary", salary_id, "mark_salary_paid",
                   f"{actual} paid, {carry} carried over", "high")
    return {"ok": True, "expected": expected, "actual": round2(actual), "carry_over": carry}


def payslip(db, actor, staff_id, month=None, year=None):
    now = datetime.date.today()
    month, year = int(month or now.month), int(year or now.year)
    row = db.one("""
      SELECT ss.*, st.staff_number, st.surname, st.first_name, st.other_names, st.role,
             st.ssnit_number, st.bank_name, st.bank_account, d.name AS designation
        FROM staff_salaries ss JOIN staff st ON st.id = ss.staff_id
        LEFT JOIN designations d ON d.id = st.designation_id
       WHERE ss.staff_id = %s AND ss.month = %s AND ss.year = %s""", (staff_id, month, year))
    if not row:
        return {"ok": False, "status": 404, "error": "No payslip for that month."}
    row["staff_name"] = f"{row.get('surname') or ''} {row.get('first_name') or ''}".strip()
    return {"ok": True, "payslip": row,
            "school": {"name": db.get_setting("school_name", "School")}}


def ytd(db, actor, staff_id, year=None):
    year = int(year or datetime.date.today().year)
    rows = db.all("""
      SELECT month, gross_salary, ssnit_worker, ssnit_employer, paye_tax,
             other_deductions, net_salary, actual_amount_paid, is_paid
        FROM staff_salaries WHERE staff_id = %s AND year = %s ORDER BY month""",
                  (staff_id, year))

    def total(key):
        return round2(sum(r[key] or 0 for r in rows))

    return {"ok": True, "year": year, "months": rows, "totals": {
        "gross": total("gross_salary"), "ssnit_worker": total("ssnit_worker"),
        "ssnit_employer": total("ssnit_employer"), "paye": total("paye_tax"),
        "net": total("net_salary"), "paid": total("actual_amount_paid"),
    }}


def statutory_schedule(db, actor, kind, month=None, year=None):
    """The SSNIT or PAYE schedule a school files.

    Both are the same query with different columns, and both are read-only: the
    filing itself is a paper act with a bank, and nothing here should pretend
    otherwise.
    """
    now = datetime.date.today()
    month, year = int(month or now.month), int(year or now.year)
    rows = db.all("""
      SELECT st.staff_number, st.surname, st.first_name, st.ssnit_number,
             ss.gross_salary, ss.ssnit_worker, ss.ssnit_employer, ss.paye_tax
        FROM staff_salaries ss JOIN staff st ON st.id = ss.staff_id
       WHERE ss.month = %s AND ss.year = %s ORDER BY st.surname, st.first_name""",
                  (month, year))
    for r in rows:
        r["staff_name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
        r["ssnit_total"] = round2((r["ssnit_worker"] or 0) + (r["ssnit_employer"] or 0))
    key = "ssnit_total" if kind == "ssnit" else "paye_tax"
    return {"ok": True, "kind": kind, "month": month, "year": year, "rows": rows,
            "total": round2(sum(r[key] or 0 for r in rows)),
            "school": {"name": db.get_setting("school_name", "School"),
                       "ssnit_employer_number": db.get_setting("school_ssnit_number", ""),
                       "tin": db.get_setting("school_tin", "")}}
