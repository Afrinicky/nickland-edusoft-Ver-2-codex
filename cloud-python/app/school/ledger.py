"""The books — a translation of ``electron/ipc/_ledger.js``.

Every payment the school receives and every payment it makes lands here, once,
whichever screen it came from. The offline system learned this the hard way:
income posted from the fees screen and income posted from the finance screen
used to be two different code paths, and a school's books were the sum of two
ideas about what a receipt was.

Both writers are idempotent on the thing that identifies the source row — a
payment id, a canteen payment id, a receipt number, a salary id — so a
redelivered sync change or a retried request cannot post the same money twice.
"""
import datetime

from .billing import round2


def today_iso():
    return datetime.date.today().isoformat()


def resolve_term_for_date(db, date):
    """The term a date falls in, or the current one.

    A payment taken on the last day of the holidays belongs to a term, and
    which term decides which bill it settles.
    """
    row = db.one("""SELECT * FROM terms
                     WHERE start_date IS NOT NULL AND end_date IS NOT NULL
                       AND %s BETWEEN start_date AND end_date
                     ORDER BY id DESC LIMIT 1""", (date,))
    return row or db.one("SELECT * FROM terms WHERE is_current = 1")


def next_counter(tx, key, prefix):
    """The next number in a sequence, consumed inside the caller's transaction.

    Upsert, not a bare UPDATE: a plain UPDATE silently affects nothing when the
    counter row is missing, so the number never advances — and postExpense
    de-duplicates on the transaction number, which would then collapse every
    salary expense into the first one.
    """
    row = tx.one("SELECT value FROM settings WHERE key = %s FOR UPDATE", (key,))
    try:
        n = int(row["value"]) if row and row["value"] else 1
    except (TypeError, ValueError):
        n = 1
    tx.run("""INSERT INTO settings (key, value, category) VALUES (%s, %s, 'system')
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""", (key, str(n + 1)))
    return f"{prefix}{str(n).zfill(5)}"


def post_income(tx, rec):
    """Record money in. Idempotent on the source row it came from."""
    date = rec.get("date") or rec.get("transaction_date") or today_iso()

    for key, column in (("linked_payment_id", "linked_payment_id"),
                        ("linked_canteen_payment_id", "linked_canteen_payment_id"),
                        ("receipt_number", "receipt_number")):
        if rec.get(key):
            existing = tx.one(f"SELECT id FROM income_records WHERE {column} = %s", (rec[key],))
            if existing:
                return existing["id"]

    term_id = rec.get("term_id")
    year_id = rec.get("academic_year_id")
    if term_id is None or year_id is None:
        term = resolve_term_for_date(tx, date)
        if term_id is None:
            term_id = term["id"] if term else None
        if year_id is None:
            year_id = term["academic_year_id"] if term else None

    return tx.insert("income_records", {
        "receipt_number": rec.get("receipt_number"),
        "category": rec.get("category") or "other",
        "subcategory": rec.get("subcategory"),
        "amount": round2(rec.get("amount")),
        "payer_name": rec.get("payer_name"),
        "description": rec.get("description") or "",
        "payment_method": rec.get("payment_method") or "Cash",
        "reference": rec.get("reference"),
        "transaction_date": date, "date": date,
        "source": rec.get("source"),
        "linked_payment_id": rec.get("linked_payment_id"),
        "linked_canteen_payment_id": rec.get("linked_canteen_payment_id"),
        "academic_year_id": year_id, "term_id": term_id,
        "recorded_by": rec.get("recorded_by"),
        "student_id": rec.get("student_id"), "staff_id": rec.get("staff_id"),
        "is_auto": 1 if rec.get("is_auto") else 0,
    })


def post_expense(tx, rec):
    """Record money out. Idempotent on the salary row or transaction number."""
    date = rec.get("date") or rec.get("transaction_date") or today_iso()

    for key, column in (("linked_salary_id", "linked_salary_id"),
                        ("transaction_number", "transaction_number")):
        if rec.get(key):
            existing = tx.one(f"SELECT id FROM expense_records WHERE {column} = %s", (rec[key],))
            if existing:
                return existing["id"]

    term_id = rec.get("term_id")
    year_id = rec.get("academic_year_id")
    if term_id is None or year_id is None:
        term = resolve_term_for_date(tx, date)
        if term_id is None:
            term_id = term["id"] if term else None
        if year_id is None:
            year_id = term["academic_year_id"] if term else None

    return tx.insert("expense_records", {
        "transaction_number": rec.get("transaction_number"),
        "category": rec.get("category") or "other",
        "subcategory": rec.get("subcategory"),
        "amount": round2(rec.get("amount")),
        "payee_name": rec.get("payee_name") or rec.get("paid_to"),
        "paid_to": rec.get("paid_to") or rec.get("payee_name"),
        "description": rec.get("description") or "",
        "payment_method": rec.get("payment_method") or "Cash",
        "reference": rec.get("reference"),
        "transaction_date": date, "date": date,
        "linked_salary_id": rec.get("linked_salary_id"),
        "academic_year_id": year_id, "term_id": term_id,
        "approved_by": rec.get("approved_by"), "recorded_by": rec.get("recorded_by"),
        "is_auto": 1 if rec.get("is_auto") else 0,
    })
