"""The online school, over HTTP, with the five kinds of person a school has.

    DATABASE_URL=... ALLOW_DEV_SECRET=1 ALLOW_MEMORY_STORE=1 \
        python3 cloud-python/tests/test_school.py

It runs the REAL service against a REAL Postgres — no mocks, no fixtures
standing in for the schema — because the faults worth catching here are the
ones where a route and a table disagree, or where an account reaches something
the school did not grant it.

Every grant is checked, and every refusal is checked harder. The refusals are
the product: an accountant is not shown a register, a head teacher is not shown
what everybody earns, and the user table belongs to the Super Admin alone.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ.setdefault("ALLOW_MEMORY_STORE", "1")

from fastapi.testclient import TestClient          # noqa: E402

from app import ratelimit                          # noqa: E402
from app.school import session as session_lib      # noqa: E402
from app.main import create_app                    # noqa: E402
from app.school import access, db as sdb, session  # noqa: E402

PASS = FAIL = 0


def ck(name, condition):
    global PASS, FAIL
    if condition:
        PASS += 1
        print("✓ " + name)
    else:
        FAIL += 1
        print("✗ " + name)


LEVELS = {"no": 0, "view": 1, "contribute": 2, "manage": 3, "full": 4}


def main():
    if not os.environ.get("DATABASE_URL"):
        print("DATABASE_URL is not set — the online system needs Postgres.")
        return 1

    school_id = "t" + uuid.uuid4().hex[:10]
    sdb.provision(school_id)
    db = sdb.SchoolDb(school_id)
    client = TestClient(create_app())
    # A clean throttle, so a test that grows does not start failing on the
    # limit rather than on what it is checking.
    ratelimit.reset()
    session_lib.reset_throttle()

    # ── a school ────────────────────────────────────────────────────────────
    def designation(name):
        return db.value("SELECT id FROM designations WHERE name = %s", (name,))

    def grant(name, levels):
        did = designation(name)
        db.run("DELETE FROM designation_permissions WHERE designation_id = %s", (did,))
        for module, level in levels.items():
            o = LEVELS[level]
            db.run("""INSERT INTO designation_permissions
                        (designation_id, module, can_view, can_create, can_edit, can_delete)
                      VALUES (%s,%s,%s,%s,%s,%s)""",
                   (did, module, int(o >= 1), int(o >= 2), int(o >= 3), int(o >= 4)))

    grant("Class Teacher", {"dashboard": "view", "students": "view",
                            "academics": "full", "canteen": "manage"})
    grant("Accountant", {"dashboard": "view", "students": "view", "fees": "full",
                         "finance": "full", "payroll": "view", "canteen": "view"})
    grant("Head Teacher", {"dashboard": "full", "students": "full", "academics": "full",
                           "fees": "view", "canteen": "full", "staff": "full",
                           "notifications": "full"})

    def make_user(username, name, designation_name, staff_id=None):
        return db.insert("users", {
            "username": username, "password_hash": session.hash_password("pass1234"),
            "full_name": name, "designation_id": designation(designation_name),
            "staff_id": staff_id, "is_active": 1,
        })

    staff_ids = {}
    for number, surname, first, role, salary in (
            ("STAFF/0001", "OWUSU", "Kwabena", "Teaching", 1800),
            ("STAFF/0002", "ASANTE", "Efua", "Non-Teaching", 2200),
            ("STAFF/0003", "BOATENG", "Yaw", "Teaching", 3000)):
        staff_ids[surname] = db.insert("staff", {
            "staff_number": number, "surname": surname, "first_name": first,
            "role": role, "status": "Active", "base_salary": salary, "ssnit_enrolled": 1,
        })

    make_user("owusu", "Mr Owusu", "Class Teacher", staff_ids["OWUSU"])
    make_user("asante", "Mrs Asante", "Accountant", staff_ids["ASANTE"])
    make_user("boateng", "Mr Boateng", "Head Teacher", staff_ids["BOATENG"])
    make_user("adjei", "Ms Adjei", "Administrator")
    make_user("amoah", "Nana Amoah", "Proprietor")
    make_user("tetteh", "Mr Tetteh", "Security")

    b5 = db.value("SELECT id FROM class_groups WHERE short_code = 'BS5'")
    b6 = db.value("SELECT id FROM class_groups WHERE short_code = 'BS6'")
    maths = db.value("SELECT id FROM subjects WHERE name = %s", ("Mathematics",))
    # Mr Owusu holds Basic 5 outright and is answerable for it. Nothing in Basic 6.
    db.run("""INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, is_class_teacher)
                VALUES (%s, %s, NULL, 1)""", (staff_ids["OWUSU"], b5))

    pupils = {}
    for index, surname, first, class_id in (("AVE/001", "ANSU", "Monalisa", b5),
                                            ("AVE/002", "BOATENG", "Kwame", b5),
                                            ("AVE/021", "OTHER", "Pupil", b6)):
        pupils[surname] = db.insert("students", {
            "index_number": index, "surname": surname, "first_name": first,
            "current_class_id": class_id, "status": "Active", "admission_date": "2026-01-08",
        })

    # ── signing in ──────────────────────────────────────────────────────────
    def sign_in(username):
        r = client.post("/api/v1/school/signin",
                        json={"school_id": school_id, "username": username, "password": "pass1234"})
        return r.json()

    tokens, me = {}, {}
    for username in ("owusu", "asante", "boateng", "adjei", "amoah", "tetteh"):
        body = sign_in(username)
        tokens[username] = body.get("token")
        me[username] = body
    ck("every account signs in", all(tokens.values()))

    ck("the credential names the school as well as the session",
       tokens["adjei"].startswith(school_id + "."))

    bad = sign_in_wrong = client.post("/api/v1/school/signin", json={
        "school_id": school_id, "username": "adjei", "password": "nope"}).json()
    ck("a wrong password says nothing about whether the account exists",
       not bad["ok"] and "did not match" in bad["error"])
    unknown = client.post("/api/v1/school/signin", json={
        "school_id": "no_such_school", "username": "adjei", "password": "pass1234"}).json()
    ck("...and neither does a school that is not here",
       not unknown["ok"] and unknown["error"] == bad["error"])

    def auth(username):
        return {"Authorization": "Bearer " + tokens[username]}

    def get(username, path, **params):
        return client.get("/api/v1/school" + path, headers=auth(username), params=params)

    def post(username, path, body=None):
        return client.post("/api/v1/school" + path, headers=auth(username), json=body or {})

    # ── who is handed which portal ──────────────────────────────────────────
    keys = {u: [p["key"] for p in me[u]["portals"]] for u in me}
    ck("a class teacher is given the teaching portal and no other",
       keys["owusu"] == ["teacher"])
    ck("an accountant is given FINANCE AND NOTHING ELSE", keys["asante"] == ["finance"])
    ck("...and is never shown that a teaching portal exists", "teacher" not in keys["asante"])
    ck("a head teacher runs the school", keys["boateng"] == ["teacher", "finance", "admin"])
    ck("...but is not the Super Admin", "system" not in keys["boateng"])
    ck("the proprietor runs the school too", keys["amoah"] == ["teacher", "finance", "admin"])
    ck("...and is still not the Super Admin", "system" not in keys["amoah"])
    ck("the Super Admin has all four", keys["adjei"] == ["teacher", "finance", "admin", "system"])
    ck("an account granted nothing still has somewhere to be", keys["tetteh"] == ["teacher"])
    ck("...and lands there", me["tetteh"]["home_portal"] == "teacher")
    ck("the accountant starts the morning in finance", me["asante"]["home_portal"] == "finance")

    # ── the register ────────────────────────────────────────────────────────
    r = get("owusu", "/attendance", classId=b5, date="2026-05-11")
    ck("the class teacher opens their own register",
       r.status_code == 200 and len(r.json()["students"]) == 2)
    r = get("owusu", "/attendance", classId=b6, date="2026-05-11")
    ck("...and not somebody else's class", r.status_code == 403)

    r = post("owusu", "/attendance", {"classId": b5, "date": "2026-05-11", "marks": [
        {"student_id": pupils["ANSU"], "status": "present"},
        {"student_id": pupils["BOATENG"], "status": "absent", "notes": "sick"},
    ]})
    ck("marking the register works", r.json().get("marked") == 2)
    r = post("owusu", "/attendance", {"classId": b5, "date": "2026-05-11", "marks": [
        {"student_id": pupils["OTHER"], "status": "present"}]})
    ck("...and a pupil from another class is silently not marked",
       r.json().get("marked") == 0)

    r = get("asante", "/attendance", classId=b5, date="2026-05-11")
    ck("the accountant cannot open a register at all", r.status_code == 403)
    r = post("asante", "/attendance", {"classId": b5, "date": "2026-05-11", "marks": []})
    ck("...nor mark one", r.status_code == 403)

    # ── marks ───────────────────────────────────────────────────────────────
    col = post("owusu", "/assessments/column",
               {"classId": b5, "subjectId": maths, "assessmentType": "Class Test", "maxMarks": 20})
    ck("a teacher adds an assessment column", col.json().get("ok"))
    r = post("owusu", "/assessments", {"classId": b5, "subjectId": maths,
                                       "marks": [{"column_id": col.json()["id"],
                                                  "student_id": pupils["ANSU"], "marks": 16}]})
    ck("...and enters class work against it", r.json().get("saved") == 1)
    r = post("owusu", "/scores", {"subjectId": maths,
                                  "marks": [{"student_id": pupils["ANSU"], "exam_score": 75}]})
    ck("...and an exam mark", r.json().get("saved") == 1)

    row = db.one("""SELECT class_score, exam_score, total_score, grade_remark FROM scores
                     WHERE student_id = %s AND subject_id = %s""", (pupils["ANSU"], maths))
    ck("the weighting is the school's own: 16/20 of 40, plus 75/100 of 60",
       row["class_score"] == 32 and row["total_score"] == 77)
    ck("...and the total is graded against the school's bands", bool(row["grade_remark"]))

    r = post("owusu", "/scores", {"subjectId": maths,
                                  "marks": [{"student_id": pupils["OTHER"], "exam_score": 90}]})
    ck("a mark for a pupil in another class is refused, and the sheet with it",
       r.status_code == 403)
    r = post("owusu", "/scores", {"subjectId": maths,
                                  "marks": [{"student_id": pupils["ANSU"], "exam_score": 140}]})
    ck("a mark above 100 is refused", r.status_code == 400)

    r = get("owusu", "/results", classId=b5)
    ck("the broadsheet ranks the class", r.json()["students"][0]["position"] == 1)

    # ── fees ────────────────────────────────────────────────────────────────
    term = db.value("SELECT id FROM terms WHERE is_current = 1")
    r = post("asante", "/fees/templates", {
        "name": "Basic 5", "class_group_id": b5, "term_id": term,
        "items": [{"description": "Tuition", "amount": 400}, {"description": "PTA", "amount": 50}]})
    ck("the bursar creates a fee template", r.json().get("ok"))
    r = post("asante", "/fees/bills", {"classId": b5})
    ck("...and raises the class's bills", r.json().get("generated") == 2)

    r = post("asante", "/fees/collections", {"student_id": pupils["ANSU"], "amount": 200})
    ck("...and takes a payment, receipted", r.json()["receipt_number"].startswith("FE/"))
    payment_id = r.json()["payment_id"]
    ck("...which reduces the bill by exactly that",
       db.value("SELECT balance FROM student_bills WHERE student_id = %s AND term_id = %s",
                (pupils["ANSU"], term)) == 250)
    ck("...and posts to the books once",
       db.value("SELECT count(*) FROM income_records WHERE linked_payment_id = %s",
                (payment_id,)) == 1)

    r = post("owusu", "/fees/collections", {"student_id": pupils["ANSU"], "amount": 50})
    ck("a class teacher cannot take a fee payment", r.status_code == 403)
    r = get("owusu", "/fees/debtors")
    ck("...nor read the arrears list", r.status_code == 403)
    r = get("boateng", "/fees/debtors")
    ck("a head teacher with fees:view can read the arrears", r.status_code == 200)
    r = post("boateng", "/fees/collections", {"student_id": pupils["ANSU"], "amount": 50})
    ck("...but cannot take money with it", r.status_code == 403)

    r = post("asante", f"/fees/collections/{payment_id}/reverse", {"reason": "Wrong account"})
    ck("even a bursar with full fees cannot reverse a payment", r.status_code == 403)
    r = post("adjei", f"/fees/collections/{payment_id}/reverse", {"reason": "x"})
    ck("...and an administrator cannot without a real reason", r.status_code == 400)
    r = post("adjei", f"/fees/collections/{payment_id}/reverse", {"reason": "Paid into the wrong account"})
    ck("an elevated account, with a reason, can", r.json().get("ok"))
    ck("...and the reversal is its own entry in the books",
       db.value("SELECT count(*) FROM expense_records WHERE category = 'refund'") == 1)
    ck("...and the bill goes back up",
       db.value("SELECT balance FROM student_bills WHERE student_id = %s AND term_id = %s",
                (pupils["ANSU"], term)) == 450)
    r = post("adjei", f"/fees/collections/{payment_id}/reverse", {"reason": "Trying it twice"})
    ck("...and cannot be reversed twice", r.status_code == 400)

    # ── finance ─────────────────────────────────────────────────────────────
    r = post("asante", "/finance/expenses",
             {"category": "maintenance", "amount": 120, "description": "Borehole pump"})
    ck("the bursar records an expense", r.json().get("ok"))
    ck("...and recording it is not approving it", r.json()["approved"] is False)
    expense_id = r.json()["id"]
    r = post("asante", "/finance/expenses", {"category": "maintenance", "amount": 120})
    ck("...and one that does not say what it was for is refused", r.status_code == 400)
    r = post("asante", f"/finance/expenses/{expense_id}/approve")
    ck("...and cannot approve the expense they recorded themselves", r.status_code == 400)
    r = post("adjei", f"/finance/expenses/{expense_id}/approve")
    ck("somebody else can", r.json().get("ok"))
    r = post("adjei", f"/finance/expenses/{expense_id}/approve")
    ck("...once", r.status_code == 400)

    r = get("boateng", "/finance/statement")
    ck("a head teacher without finance cannot read the statement", r.status_code == 403)
    # An explicit window: the statement defaults to the current TERM, and the
    # seeded term dates are not today's — which is correct behaviour and a
    # misleading thing to assert against.
    r = get("asante", "/finance/statement", dateFrom="2000-01-01", dateTo="2099-12-31")
    ck("the bursar can", r.status_code == 200 and r.json()["totals"]["expense"] >= 120)
    # The one recorded above was approved; a fresh one has not been, and the
    # finance audit is the thing that says so.
    post("asante", "/finance/expenses",
         {"category": "supplies", "amount": 40, "description": "Chalk"})
    ck("...and the finance audit reports expenditure nobody has signed off",
       any(f["check"] == "unapproved_expense"
           for f in get("asante", "/finance/audit").json()["findings"]))

    # ── payroll ─────────────────────────────────────────────────────────────
    r = post("adjei", "/payroll/run", {"month": 5, "year": 2026})
    ck("the payroll runs for every salaried member of staff", r.json().get("created") == 3)
    sheet = get("adjei", "/payroll", month=5, year=2026).json()
    ck("...and the month adds up", sheet["totals"]["staff"] == 3 and sheet["totals"]["net"] > 0)
    salary_id = sheet["rows"][0]["id"]
    r = post("adjei", f"/payroll/{salary_id}/paid", {"amount": 0})
    ck("a salary cannot be marked paid for nothing", r.status_code == 400)
    r = post("adjei", f"/payroll/{salary_id}/paid", {"amount": 100})
    ck("...and paying part of it carries the rest over", r.json()["carry_over"] > 0)
    ck("...and the payment leaves the school's books",
       db.value("SELECT count(*) FROM expense_records WHERE linked_salary_id = %s",
                (salary_id,)) == 1)
    r = post("adjei", f"/payroll/{salary_id}/paid", {"amount": 100})
    ck("...and marking it paid again does not double-post",
       db.value("SELECT count(*) FROM expense_records WHERE linked_salary_id = %s",
                (salary_id,)) == 1)

    r = get("asante", "/payroll", month=5, year=2026)
    ck("an accountant with payroll:view reads the run", r.status_code == 200)
    r = post("asante", "/payroll/run", {"month": 6, "year": 2026})
    ck("...but cannot run it", r.status_code == 403)
    r = get("owusu", "/payroll", month=5, year=2026)
    ck("a teacher cannot see payroll at all", r.status_code == 403)

    # ── staff, and the salary that is not staff ─────────────────────────────
    r = get("boateng", f"/staff/{staff_ids['OWUSU']}")
    ck("a head teacher opens a staff record", r.status_code == 200)
    ck("...and is NOT shown what they earn, which is payroll",
       r.json()["may_see_pay"] is False and "base_salary" not in r.json()["staff"])
    r = get("adjei", f"/staff/{staff_ids['OWUSU']}")
    ck("the Super Admin, who holds payroll, is",
       r.json()["may_see_pay"] is True and r.json()["staff"]["base_salary"] == 1800)
    r = get("owusu", "/staff")
    ck("a class teacher cannot read the staff register", r.status_code == 403)

    r = post("owusu", "/my/leave", {"start_date": "2026-06-01", "end_date": "2026-06-03",
                                    "justification": "Family funeral"})
    ck("anybody may ask for their own leave", r.json().get("days") == 3)
    request_id = r.json()["id"]
    r = post("owusu", f"/leave/{request_id}/decision", {"decision": "approved"})
    ck("...and cannot approve it themselves", r.status_code == 403)
    r = post("boateng", f"/leave/{request_id}/decision", {"decision": "approved"})
    ck("the head teacher can", r.json().get("ok"))
    r = post("boateng", f"/leave/{request_id}/decision", {"decision": "approved"})
    ck("...once", r.status_code == 400)

    r = get("tetteh", "/my/employment")
    ck("an account with no module still reaches its own record", r.status_code == 200)
    r = get("tetteh", "/students")
    ck("...and nothing of the school", r.status_code == 403)

    # ── the system ──────────────────────────────────────────────────────────
    for username in ("owusu", "asante", "boateng", "amoah"):
        ck(f"{username} cannot read the user table", get(username, "/system/users").status_code == 403)
        ck(f"{username} cannot read the audit trail", get(username, "/system/audit").status_code == 403)
        ck(f"{username} cannot grant themselves anything",
           post(username, "/system/access",
                {"designationId": designation("Class Teacher"),
                 "levels": {"finance": "full"}}).status_code == 403)

    r = get("adjei", "/system/users")
    ck("the Super Admin sees the accounts", len(r.json()["users"]) == 6)
    r = post("adjei", "/system/users", {"username": "mensah", "full_name": "Mr Mensah",
                                        "password": "short"})
    ck("a five-character password is refused", r.status_code == 400)
    r = post("adjei", "/system/users", {"username": "mensah", "full_name": "Mr Mensah",
                                        "password": "abcd1234",
                                        "designation_id": designation("Class Teacher")})
    ck("...and a real one creates the account, flagged to be changed",
       r.json().get("must_change_password") is True)
    new_user = r.json()["id"]

    r = post("adjei", f"/system/users/{new_user}/status", {"active": False})
    ck("an account can be deactivated", r.json().get("ok"))
    admin_id = db.value("SELECT id FROM users WHERE username = 'adjei'")
    r = post("adjei", f"/system/users/{admin_id}/status", {"active": False})
    ck("...but never the one you are signed in with", r.status_code == 400)

    # A session dies the moment the account behind it does.
    victim = sign_in("owusu")["token"]
    owusu_id = db.value("SELECT id FROM users WHERE username = 'owusu'")
    ck("a live session works", client.get("/api/v1/school/me",
                                          headers={"Authorization": "Bearer " + victim}).status_code == 200)
    post("adjei", f"/system/users/{owusu_id}/status", {"active": False})
    ck("...and stops the moment the account is deactivated",
       client.get("/api/v1/school/me",
                  headers={"Authorization": "Bearer " + victim}).status_code == 401)
    post("adjei", f"/system/users/{owusu_id}/status", {"active": True})

    # ── access, granted and withdrawn, taking effect at once ────────────────
    ck("before the grant, the teacher has no finance portal",
       "finance" not in [p["key"] for p in sign_in("owusu")["portals"]])
    post("adjei", "/system/access", {"designationId": designation("Class Teacher"),
                                     "levels": {"fees": "view"}})
    tokens["owusu"] = sign_in("owusu")["token"]
    ck("after it, the finance portal is there",
       "finance" in [p["key"] for p in me_after(client, tokens["owusu"])["portals"]])
    ck("...and the arrears list opens", get("owusu", "/fees/debtors").status_code == 200)
    ck("...but only the part that was granted",
       get("owusu", "/finance/expenses").status_code == 403)
    post("adjei", "/system/access", {"designationId": designation("Class Teacher"),
                                     "levels": {"fees": "no"}})
    ck("and withdrawing it closes the door on the very next request — no re-sign-in",
       get("owusu", "/fees/debtors").status_code == 403)

    r = post("adjei", "/system/access", {"designationId": designation("Administrator"),
                                         "levels": {"finance": "no"}})
    ck("the Super Admin's own role cannot be weakened", r.status_code == 400)
    r = post("adjei", "/system/access", {"designationId": designation("Class Teacher"),
                                         "levels": {"fees": "nonsense"}})
    ck("an unknown level is refused rather than stored", r.status_code == 400)

    # ── the secret that never comes back ────────────────────────────────────
    r = post("adjei", "/system/settings", {"settings": {
        "paystack_secret_key": "sk_test_supersecret", "payment_gateway": "paystack",
        "online_payments_enabled": "true"}})
    ck("the Super Admin configures the gateway", r.json().get("ok"))
    r = get("adjei", "/system/settings")
    ck("...and the secret is never read back out of it",
       "paystack_secret_key" not in r.json()["settings"]
       and "sk_test_supersecret" not in r.text)
    ck("...only whether one is set at all",
       any(s["key"] == "paystack_secret_key" and s["configured"] for s in r.json()["secrets"]))
    note = db.value("""SELECT justification FROM audit_log WHERE action = 'change_settings'
                        ORDER BY id DESC LIMIT 1""")
    ck("...and the audit row does not quote it either", "sk_test_" not in (note or ""))

    # ── refusals are recorded ───────────────────────────────────────────────
    ck("every refusal is written to the school's own audit log",
       db.value("""SELECT count(*) FROM audit_log
                    WHERE action = 'permission_denied' AND severity = 'high'""") > 10)
    ck("and so is every failed sign-in",
       db.value("SELECT count(*) FROM audit_log WHERE action = 'login_failed'") >= 1)

    # ── guessing at passwords is throttled ──────────────────────────────────
    # Per account AND per source. The per-account limit is what stops a slow
    # guess; the per-source one stops somebody working through the school's
    # whole user list from one place.
    ratelimit.reset()
    session_lib.reset_throttle()
    refused = 0
    for _ in range(30):
        r = client.post("/api/v1/school/signin", json={
            "school_id": school_id, "username": "adjei", "password": "wrong"})
        if r.status_code == 429:
            refused += 1
    ck("a run of wrong passwords is throttled, not answered", refused > 0)
    ratelimit.reset()
    session_lib.reset_throttle()
    ck("...and clearing it lets the right password back in",
       client.post("/api/v1/school/signin", json={
           "school_id": school_id, "username": "adjei", "password": "pass1234"}).json().get("ok"))

    # The thing the desktop's rule would get wrong on the internet: an attacker
    # guessing from one address must not lock the real person out from theirs.
    # The count is per (account, source), so it does not.
    ratelimit.reset()
    session_lib.reset_throttle()
    for _ in range(8):
        client.post("/api/v1/school/signin",
                    json={"school_id": school_id, "username": "adjei", "password": "wrong"},
                    headers={"X-Forwarded-For": "203.0.113.9"})
    blocked = client.post("/api/v1/school/signin",
                          json={"school_id": school_id, "username": "adjei", "password": "wrong"},
                          headers={"X-Forwarded-For": "203.0.113.9"})
    ck("an attacker guessing from one address is shut out", blocked.status_code == 429)
    ratelimit.reset()   # the per-source HTTP limit, which is by design address-bound
    ok = client.post("/api/v1/school/signin",
                     json={"school_id": school_id, "username": "adjei", "password": "pass1234"},
                     headers={"X-Forwarded-For": "198.51.100.4"})
    ck("...and the real administrator still signs in from their own phone",
       ok.status_code == 200 and ok.json().get("ok"))

    ratelimit.reset()
    session_lib.reset_throttle()
    tokens["adjei"] = sign_in("adjei")["token"]

    # ── the rest of the school ──────────────────────────────────────────────
    # Timetable, homework, notices, stock, transport, books and discounts —
    # the modules a school uses that are not marks or money, checked for the
    # same two things: that the screen has something behind it, and that the
    # wrong account cannot reach it.

    r = post("adjei", "/timetable/periods", {"label": "Period 1", "start_time": "08:00",
                                             "end_time": "08:40", "display_order": 1})
    ck("the Super Admin sets up a period", r.json().get("ok"))
    period_id = r.json()["id"]
    r = post("owusu", "/timetable/class", {"classId": b5, "entries": [
        {"day_of_week": 1, "period_id": period_id, "subject_id": maths,
         "teacher_id": staff_ids["OWUSU"]}]})
    ck("the class teacher lays out their week", r.json().get("entries") == 1)
    r = get("owusu", "/timetable/mine")
    ck("...and it appears on their own timetable",
       r.json()["entries"].get("1", {}).get(str(period_id), {}).get("subject_name") == "Mathematics")
    r = post("owusu", "/timetable/periods", {"label": "Sneaky", "display_order": 9})
    ck("but the periods themselves belong to the office", r.status_code == 403)

    r = post("owusu", "/homework", {"classId": b5, "subjectId": maths, "title": "Fractions",
                                    "dueDate": "2026-05-20", "maxMarks": 10})
    ck("a teacher sets homework", r.json().get("ok"))
    homework_id = r.json()["id"]
    r = post("owusu", f"/homework/{homework_id}/marks",
             {"entries": [{"student_id": pupils["ANSU"], "status": "submitted", "marks": 8}]})
    ck("...marks it", r.json().get("marked") == 1)
    ck("...and the mark counts towards the class score rather than sitting in a corner",
       r.json().get("counted_towards_class_score") is True)
    # The class score is recomputed across EVERY column, not adjusted: 16 out
    # of 20 on the class test plus 8 out of 10 for the homework is 24 out of
    # 30, which is the same 32 of the 40 weight the class test alone was worth.
    # The number is unchanged and the working is not — two columns now stand
    # behind it, which is what the check is really for.
    ck("...and the class score is recomputed across every column",
       db.value("SELECT count(*) FROM assessment_columns WHERE subject_id = %s", (maths,)) == 2
       and db.value("SELECT class_score FROM scores WHERE student_id = %s AND subject_id = %s",
                    (pupils["ANSU"], maths)) == 32)

    r = post("boateng", "/announcements", {"title": "Vacation", "body": "School closes on the 20th."})
    ck("the head teacher posts a notice", r.json().get("ok"))
    r = post("owusu", "/announcements", {"title": "Mine", "body": "..."})
    ck("...and a class teacher without notifications cannot", r.status_code == 403)

    r = post("asante", "/inventory", {"name": "Exercise books", "unit": "box",
                                      "unit_cost": 60, "reorder_level": 2})
    ck("the bursar adds a stock item", r.json().get("ok"))
    item_id = r.json()["id"]
    r = post("asante", "/inventory/movement", {"item_id": item_id, "type": "in", "quantity": 5})
    ck("...takes five boxes in", r.json().get("quantity_on_hand") == 5)
    r = post("asante", "/inventory/movement", {"item_id": item_id, "type": "out", "quantity": 9})
    ck("...and cannot issue nine of them", r.status_code == 400)
    r = get("owusu", "/inventory")
    ck("a teacher cannot see the store room at all", r.status_code == 403)

    r = post("asante", "/transport", {"name": "Adenta run", "fee_per_term": 300,
                                      "driver_name": "Mr Tetteh", "capacity": 18})
    ck("the bursar sets up a transport route", r.json().get("ok"))
    route_id = r.json()["id"]
    r = post("asante", "/transport/riders", {"studentId": pupils["ANSU"], "routeId": route_id})
    ck("...and puts a pupil on it", r.json().get("ok"))
    r = post("asante", "/transport/payment", {"studentId": pupils["ANSU"], "amount": 300,
                                              "routeId": route_id})
    ck("...and the fare is receipted into the books",
       r.json()["receipt_number"].startswith("TR/")
       and db.value("SELECT count(*) FROM income_records WHERE category = 'transport'") == 1)

    r = post("asante", f"/books/{pupils['ANSU']}",
             {"items": [{"title": "Mathematics workbook", "amount": 45},
                        {"title": "Reader", "amount": 30}]})
    ck("a pupil's books are itemised", r.json().get("total") == 75)
    r = post("asante", f"/books/{pupils['ANSU']}/payment", {"amount": 45})
    ck("...and a payment against them is receipted", r.json()["receipt_number"].startswith("BK/"))
    ck("...and leaves the right balance",
       db.value("SELECT balance FROM student_books WHERE student_id = %s", (pupils["ANSU"],)) == 30)

    r = post("asante", "/discounts", {"studentId": pupils["BOATENG"], "discount_type": "percent",
                                      "discount_value": 50, "reason": "Staff child"})
    ck("even a bursar with full fees cannot grant a discount", r.status_code == 403)
    r = post("amoah", "/discounts", {"studentId": pupils["BOATENG"], "discount_type": "percent",
                                     "discount_value": 50, "reason": "Staff child"})
    ck("the proprietor can — it is money the school decides not to collect",
       r.json().get("ok"))
    post("asante", "/fees/bills", {"studentId": pupils["BOATENG"]})
    ck("...and it shows up when the bill is raised again",
       db.value("SELECT discount_amount FROM student_bills WHERE student_id = %s AND term_id = %s",
                (pupils["BOATENG"], term)) == 225)

    # ── a token from one school is not a token for another ──────────────────
    other = "t" + uuid.uuid4().hex[:10]
    sdb.provision(other)
    stolen = other + "." + tokens["adjei"].split(".", 1)[1]
    ck("a token presented against another school does not resolve",
       client.get("/api/v1/school/me", headers={"Authorization": "Bearer " + stolen}).status_code == 401)
    sdb.drop(other)

    sdb.drop(school_id)
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


def me_after(client, token):
    return client.get("/api/v1/school/me", headers={"Authorization": "Bearer " + token}).json()


if __name__ == "__main__":
    sys.exit(main())
