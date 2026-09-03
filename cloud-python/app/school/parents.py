"""Parents — a translation of ``electron/server/parents.py``'s JavaScript twin.

A parent is not a member of staff and never becomes one. They have their own
table, their own password hashing (scrypt, as the offline system uses, so
nobody has to be re-enrolled), and a session that can reach exactly one thing:
their own children.

The link between a parent and a child is verified against the guardian contact
details already on the pupil's record. That is the whole security model and it
is a good one: a school does not have to remember to link anybody, and somebody
who does not appear on a child's record cannot claim them by typing an id.

Every read below filters by the children this parent actually has, resolved
from the database on the request. There is no endpoint that takes a student id
and trusts it.
"""
import datetime
import hashlib
import hmac
import re
import secrets

from .billing import round2

_NON_DIGIT = re.compile(r"[^\d+]")


def hash_password(password):
    salt = secrets.token_hex(16)
    derived = hashlib.scrypt(str(password).encode(), salt=salt.encode(),
                             n=16384, r=8, p=1, dklen=64).hex()
    return f"scrypt${salt}${derived}"


def verify_password(password, stored):
    if not stored or not str(stored).startswith("scrypt$"):
        return False
    try:
        _, salt, expected = str(stored).split("$")
        derived = hashlib.scrypt(str(password).encode(), salt=salt.encode(),
                                 n=16384, r=8, p=1, dklen=64).hex()
        return hmac.compare_digest(derived, expected)
    except Exception:
        return False


def norm_phone(raw):
    """Ghanaian numbers, however they were typed.

    0244…, +233244…, 00233244… and 244… are one number, and a parent who typed
    it differently at registration should still be able to sign in.
    """
    s = _NON_DIGIT.sub("", str(raw or ""))
    if not s:
        return ""
    if s.startswith("+"):
        s = s[1:]
    if s.startswith("00"):
        s = s[2:]
    if s.startswith("0"):
        s = "233" + s[1:]
    elif len(s) == 9:
        s = "233" + s
    return s


def match_students(db, phone=None, email=None):
    """Which children this contact appears on."""
    found = {}
    if phone:
        np = norm_phone(phone)
        if np:
            for s in db.all("""SELECT id, father_contact, mother_contact, guardian_contact
                                 FROM students WHERE status = 'Active'"""):
                for column, relationship in (("father_contact", "Father"),
                                             ("mother_contact", "Mother"),
                                             ("guardian_contact", "Guardian")):
                    if norm_phone(s[column]) == np:
                        found.setdefault(s["id"], relationship)
                        break
    if email:
        e = str(email).strip().lower()
        if e:
            for s in db.all("""SELECT id, father_email, mother_email, guardian_email
                                 FROM students WHERE status = 'Active'"""):
                for column, relationship in (("father_email", "Father"),
                                             ("mother_email", "Mother"),
                                             ("guardian_email", "Guardian")):
                    if (s[column] or "").lower() == e:
                        found.setdefault(s["id"], relationship)
                        break
    return [{"student_id": k, "relationship": v} for k, v in found.items()]


def register(db, full_name, phone=None, email=None, password=None):
    """Self-registration, which only works if the school already has you.

    A parent whose number is not on any pupil's record is told to ask the
    school. That is deliberate: the alternative is an account that claims a
    child by asserting a relationship nobody checked.
    """
    if not password or len(str(password)) < 8:
        return {"ok": False, "status": 400, "error": "A password must be at least 8 characters."}
    if not phone and not email:
        return {"ok": False, "status": 400, "error": "A phone number or an email is required."}
    if db.get_setting("mobile_parent_self_register", "true") != "true":
        return {"ok": False, "status": 403,
                "error": "Registration is closed. Ask the school to set up your account."}

    matches = match_students(db, phone, email)
    if not matches:
        return {"ok": False, "status": 400,
                "error": "We could not find a pupil with those contact details. Ask the school."}

    np = norm_phone(phone) if phone else None
    if np and db.one("SELECT id FROM parents WHERE phone = %s", (np,)):
        return {"ok": False, "status": 400, "error": "An account already exists for this number."}

    parent_id = db.insert("parents", {
        "full_name": full_name or "Parent", "phone": np,
        "email": (email or "").strip().lower() or None,
        "password_hash": hash_password(password), "is_active": 1,
    })
    for m in matches:
        db.run("""INSERT INTO parent_students (parent_id, student_id, relationship)
                       VALUES (%s,%s,%s) ON CONFLICT DO NOTHING""",
               (parent_id, m["student_id"], m["relationship"]))
    return {"ok": True, "parent_id": parent_id, "linked": len(matches)}


def sign_in(db, identifier, password):
    np = norm_phone(identifier)
    em = str(identifier or "").strip().lower()
    parent = db.one("""SELECT * FROM parents
                        WHERE is_active = 1 AND (phone = %s OR lower(email) = %s)""", (np, em))
    if not parent or not verify_password(password, parent["password_hash"]):
        return {"ok": False, "status": 401,
                "error": "Those details did not match an account. Check and try again."}
    return {"ok": True, "parent": {"id": parent["id"], "full_name": parent["full_name"],
                                   "phone": parent["phone"], "email": parent["email"],
                                   "must_change_password": bool(parent["must_change_password"])}}


def student_ids(db, parent_id):
    return [r["student_id"] for r in
            db.all("SELECT student_id FROM parent_students WHERE parent_id = %s", (parent_id,))]


def owns(db, parent_id, student_id):
    return bool(db.one("""SELECT 1 FROM parent_students
                           WHERE parent_id = %s AND student_id = %s""", (parent_id, student_id)))


def children(db, parent_id):
    """Every child of this parent, with the figures a parent actually opens for."""
    ids = student_ids(db, parent_id)
    if not ids:
        return {"ok": True, "children": []}
    term = db.one("SELECT id, label FROM terms WHERE is_current = 1")
    rows = db.all("""
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.gender, s.status,
             c.name AS class_name,
             (SELECT TRIM(COALESCE(st.surname,'') || ' ' || COALESCE(st.first_name,''))
                FROM staff_assignments sa JOIN staff st ON st.id = sa.staff_id
               WHERE sa.class_group_id = c.id AND sa.is_class_teacher = 1 LIMIT 1) AS class_teacher
        FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE s.id = ANY(%s) ORDER BY s.surname, s.first_name""", (ids,))
    for r in rows:
        r["name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()
        bill = db.one("""SELECT total_billed, total_paid, balance FROM student_bills
                          WHERE student_id = %s AND term_id = %s
                            AND COALESCE(status,'active') = 'active'""",
                      (r["id"], term["id"] if term else None)) if term else None
        r["fees"] = {"billed": round2((bill or {}).get("total_billed") or 0),
                     "paid": round2((bill or {}).get("total_paid") or 0),
                     "balance": round2((bill or {}).get("balance") or 0)}
        att = db.one("""SELECT count(*) FILTER (WHERE status = 'present') AS present,
                               count(*) FILTER (WHERE status = 'absent') AS absent
                          FROM student_attendance WHERE student_id = %s AND term_id = %s""",
                     (r["id"], term["id"] if term else None)) if term else None
        r["attendance"] = att or {"present": 0, "absent": 0}
    return {"ok": True, "term": term, "children": rows}


def child(db, parent_id, student_id):
    """One child, in full: the bill line by line, the receipts, the marks."""
    if not owns(db, parent_id, student_id):
        return {"ok": False, "status": 403, "error": "Not your child."}
    term = db.one("SELECT * FROM terms WHERE is_current = 1")
    student = db.one("""
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.gender,
             s.date_of_birth, s.status, c.name AS class_name
        FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
       WHERE s.id = %s""", (student_id,))
    if not student:
        return {"ok": False, "status": 404, "error": "Not found."}
    student["name"] = f"{student.get('surname') or ''} {student.get('first_name') or ''}".strip()

    bill = db.one("""SELECT * FROM student_bills WHERE student_id = %s AND term_id = %s
                       AND COALESCE(status,'active') = 'active'""",
                  (student_id, term["id"])) if term else None
    return {
        "ok": True, "child": student,
        "term": {"id": term["id"], "label": term["label"]} if term else None,
        "bill": {
            "billed": round2(bill["total_billed"]), "paid": round2(bill["total_paid"]),
            "balance": round2(bill["balance"]), "arrears": round2(bill["arrears_from_prev"]),
            "discount": round2(bill["discount_amount"]),
        } if bill else None,
        "items": db.all("""SELECT item_number, description, amount, is_arrear
                             FROM bill_line_items WHERE student_bill_id = %s
                            ORDER BY is_arrear, item_number, id""", (bill["id"],)) if bill else [],
        "payments": db.all("""
          SELECT receipt_number, amount, payment_date, payment_method, is_reversed
            FROM payments WHERE student_id = %s AND is_reversed = 0
           ORDER BY payment_date DESC, id DESC LIMIT 60""", (student_id,)),
        "results": db.all("""
          SELECT sub.name AS subject, sc.class_score, sc.exam_score, sc.total_score, sc.grade_remark
            FROM scores sc JOIN subjects sub ON sub.id = sc.subject_id
           WHERE sc.student_id = %s AND sc.term_id = %s ORDER BY sub.name""",
                          (student_id, term["id"])) if term else [],
        "conduct": db.all("""SELECT event_type, title, description, date FROM student_events
                              WHERE student_id = %s ORDER BY date DESC, id DESC LIMIT 20""",
                          (student_id,)),
        "attendance": db.all("""SELECT date, status FROM student_attendance
                                 WHERE student_id = %s AND term_id = %s ORDER BY date DESC LIMIT 90""",
                             (student_id, term["id"])) if term else [],
        "homework": db.all("""
          SELECT h.title, h.description, h.due_date, s.name AS subject_name,
                 hs.status, hs.marks, h.max_marks
            FROM homework h
            LEFT JOIN subjects s ON s.id = h.subject_id
            LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = %s
           WHERE h.class_group_id = (SELECT current_class_id FROM students WHERE id = %s)
           ORDER BY h.due_date DESC NULLS LAST LIMIT 30""", (student_id, student_id)),
    }


def announcements(db, parent_id):
    mine = student_ids(db, parent_id)
    return {"ok": True, "announcements": db.all("""
      SELECT id, title, body, audience, target_student_id, created_at
        FROM announcements
       WHERE is_active = 1 AND (audience = 'all'
             OR (audience = 'student' AND target_student_id = ANY(%s)))
       ORDER BY created_at DESC LIMIT 50""", (mine or [0],))}
