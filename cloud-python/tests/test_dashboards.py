"""The dashboards and the office's own screens, online.

    DATABASE_URL=... ALLOW_DEV_SECRET=1 ALLOW_MEMORY_STORE=1 \
        python3 cloud-python/tests/test_dashboards.py

The offline system, the school's own server and this service are meant to be
one product seen from three places. This suite is the check on that for the
part that was missing here: the eight dashboards, the pickers the office needs,
the payroll preview, the school calendar, a training record and the approvals
queue — every one of which existed on the desktop and, until now, nowhere else.

The figures are asserted, not the shapes. A dashboard that returns the right
keys full of zeroes is the failure worth catching: the office reads the zero
and believes it.
"""
import datetime
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ.setdefault("ALLOW_MEMORY_STORE", "1")

from fastapi.testclient import TestClient          # noqa: E402

from app import ratelimit                          # noqa: E402
from app.main import create_app                    # noqa: E402
from app.school import db as sdb, session          # noqa: E402
from app.school import session as session_lib      # noqa: E402

PASS = FAIL = 0
LEVELS = {"no": 0, "view": 1, "contribute": 2, "manage": 3, "full": 4}

# "Recently hired" is six months on the dashboard, so the fixture's hire date
# is relative to today. A fixed date passes in the month it was written and
# starts failing quietly a year later, which is worse than no test.
RECENTLY = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()


def ck(name, condition):
    global PASS, FAIL
    if condition:
        PASS += 1
        print("✓ " + name)
    else:
        FAIL += 1
        print("✗ " + name)


def main():                                                  # noqa: C901
    if not os.environ.get("DATABASE_URL"):
        print("DATABASE_URL is not set — the online system needs Postgres.")
        return 1

    school_id = "d" + uuid.uuid4().hex[:10]
    sdb.provision(school_id)
    db = sdb.SchoolDb(school_id)
    client = TestClient(create_app())
    ratelimit.reset()
    session_lib.reset_throttle()

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

    # The account in the screenshots: the money, the roll to bill against, and
    # NO teaching assignments at all — which is what broke every picker.
    grant("Accountant", {"dashboard": "view", "students": "view", "fees": "full",
                         "finance": "full", "payroll": "full", "canteen": "full"})
    # Canteen at "view", not "manage": this suite checks that somebody who
    # cannot edit the canteen cannot rewrite the school calendar either, and a
    # class teacher who collects the canteen sheet legitimately can.
    grant("Class Teacher", {"dashboard": "view", "students": "view",
                            "academics": "full", "canteen": "view"})

    def make_user(username, name, designation_name, staff_id=None):
        return db.insert("users", {
            "username": username, "password_hash": session.hash_password("pass1234"),
            "full_name": name, "designation_id": designation(designation_name),
            "staff_id": staff_id, "is_active": 1})

    staff_ids = {}
    for number, surname, first, role, salary in (
            ("STAFF/0001", "OWUSU", "Kwabena", "Teaching", 2000),
            ("STAFF/0002", "OFORIWAA", "Genevieve", "Non-Teaching", 1500)):
        staff_ids[surname] = db.insert("staff", {
            "staff_number": number, "surname": surname, "first_name": first,
            "role": role, "status": "Active", "base_salary": salary,
            "ssnit_enrolled": 1, "hire_date": RECENTLY, "gender": "M"})

    make_user("owusu", "Mr Owusu", "Class Teacher", staff_ids["OWUSU"])
    make_user("bursa", "Mrs Oforiwaa", "Accountant", staff_ids["OFORIWAA"])
    make_user("adjei", "Ms Adjei", "Super Admin")

    b5 = db.value("SELECT id FROM class_groups WHERE short_code = 'BS5'")
    b6 = db.value("SELECT id FROM class_groups WHERE short_code = 'BS6'")
    db.run("""INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, is_class_teacher)
                VALUES (%s, %s, NULL, 1)""", (staff_ids["OWUSU"], b5))

    pupils = {}
    for index, surname, first, class_id, gender in (
            ("AVE/001", "ANSU", "Monalisa", b5, "F"),
            ("AVE/002", "BOATENG", "Kwame", b5, "Male"),
            ("AVE/021", "DUUT", "Esther", b6, "girl")):
        pupils[surname] = db.insert("students", {
            "index_number": index, "surname": surname, "first_name": first,
            "current_class_id": class_id, "status": "Active",
            "admission_date": "2026-01-08", "gender": gender})

    # A term with dates, so everything that counts against a term has one.
    year_id = db.value("SELECT id FROM academic_years WHERE is_current = 1") \
        or db.insert("academic_years", {"label": "2025/2026", "is_current": 1})
    db.run("UPDATE terms SET is_current = 0")
    term_id = db.insert("terms", {
        "academic_year_id": year_id, "term_number": 3, "label": "Third Term",
        "is_current": 1, "start_date": "2026-05-04", "end_date": "2026-07-31"})

    def sign_in(username):
        return client.post("/api/v1/school/signin", json={
            "school_id": school_id, "username": username, "password": "pass1234"}).json()

    tokens = {u: sign_in(u).get("token") for u in ("owusu", "bursa", "adjei")}
    ck("everybody signs in", all(tokens.values()))

    def auth(u):
        return {"Authorization": "Bearer " + tokens[u]}

    def get(u, path, **params):
        return client.get("/api/v1/school" + path, headers=auth(u), params=params)

    def post(u, path, body=None):
        return client.post("/api/v1/school" + path, headers=auth(u), json=body or {})

    # ══ the pickers ═════════════════════════════════════════════════════════
    #
    # An accountant has no teaching assignments, so every screen that filtered
    # by the teaching scope handed them an empty list — "Nothing to choose
    # from" on the bulk pay sheet, and an empty roll behind the payment sheet.

    r = get("bursa", "/office/classes")
    ck("an accountant is offered every class the school runs",
       r.status_code == 200 and len(r.json()["classes"]) >= 2)
    ck("...with the roll on each, so a picker can say how many are in it",
       any(c["pupils"] == 2 for c in r.json()["classes"]))

    r = get("bursa", "/office/students", q="an")
    names = [s["name"] for s in r.json()["students"]]
    ck("an accountant can find a pupil by name",
       r.status_code == 200 and any("ANSU" in n for n in names))

    r = get("bursa", "/office/staff")
    ck("...and name a member of staff, holding payroll but not the staff module",
       r.status_code == 200 and len(r.json()["staff"]) == 2)

    r = get("owusu", "/office/classes")
    ck("a teacher holding Students may read the office class list", r.status_code == 200)

    # ══ the eight dashboards ════════════════════════════════════════════════

    r = get("adjei", "/dash/main")
    m = r.json().get("metrics", {})
    ck("the main dashboard counts the school", r.status_code == 200 and m["student_total"] == 3)
    ck("...the classes actually in use", m["class_count"] == 2)
    ck("...and the staff on the books", m["staff_active"] == 2)
    ck("...and states the term it is counting", r.json()["term"]["label"] == "Third Term")
    ck("...and the school day, so the screen is not half empty",
       len(r.json()["schedule"]) == 6)

    r = get("adjei", "/dash/students")
    m = r.json()["metrics"]
    ck("the roll is split by sex however the register spelt it",
       m["male"] == 1 and m["female"] == 2)
    ck("...as a percentage the screen can draw a bar from",
       m["female_pct"] == 67 and m["male_pct"] == 33)
    ck("...and by class, biggest first",
       r.json()["by_class"][0]["count"] == 2)
    ck("...with the newest admissions to show faces against",
       len(r.json()["recent_admissions"]) == 3)

    # Fees: a template that covers every class and any term — the case that
    # could not raise a single bill from a browser.
    r = post("bursa", "/fees/templates", {
        "name": "Third Term fees", "items": [
            {"description": "Tuition", "amount": 300},
            {"description": "PTA levy", "amount": 50}]})
    ck("a template covering every class and any term can be written",
       r.status_code == 200 and r.json().get("ok"))

    r = post("bursa", "/fees/bills", {"classId": b5})
    ck("...and the bills raise against it",
       r.status_code == 200 and (r.json().get("generated") or r.json().get("raised")) == 2)

    r = get("bursa", "/dash/fees")
    m = r.json()["metrics"]
    ck("the fees dashboard shows what was billed", m["total_billed"] == 700)
    ck("...nothing collected yet, and says so as a percentage",
       m["total_collected"] == 0 and m["collection_pct"] == 0)
    ck("...both pupils owing", m["debtor_count"] == 2)
    ck("...and the pupil with no bill yet counted into what the term is worth",
       m["expected_income"] == 1050 and m["unbilled_students"] == 1)
    ck("...with nobody left uncovered by a template", m["unbillable_students"] == 0)
    ck("...and the debtors named, oldest bill measured in days",
       len(r.json()["top_debtors"]) == 2
       and r.json()["top_debtors"][0]["days_outstanding"] is not None)
    ck("...broken down by class for the bar chart",
       any(c["total_billed"] == 700 for c in r.json()["by_class"]))

    # ══ the school calendar ═════════════════════════════════════════════════

    r = get("bursa", "/calendar")
    ck("a term with no calendar says so rather than inventing one",
       r.status_code == 200 and r.json()["school_days"] == 0)

    r = post("bursa", "/calendar/term", {
        "termId": term_id, "holidays": [{"date": "2026-05-25", "label": "Africa Union Day"}]})
    ck("the term can be laid out from the browser", r.status_code == 200 and r.json()["ok"])
    # 2026-05-04 is a Monday and 2026-07-31 a Friday: 89 days, of which 24 are
    # weekend days, plus the single holiday the office named.
    ck("...with the weekends left out",
       r.json()["school_days"] == 64 and r.json()["off_days"] == 25)

    r = get("bursa", "/calendar", termId=term_id)
    ck("...and the holiday the office named taken out",
       any(d["label"] == "Africa Union Day" for d in r.json()["days"]))

    before = get("bursa", "/dash/canteen").json()["metrics"]["total_school_days"]
    post("bursa", "/calendar/day", {
        "date": "2026-06-10", "dayType": "holiday", "label": "Election Day", "termId": term_id})
    after = get("bursa", "/dash/canteen").json()["metrics"]["total_school_days"]
    ck("a day declared a holiday is one fewer day anybody owes for",
       before == 64 and after == 63)

    r = post("owusu", "/calendar/day", {"date": "2026-06-11", "dayType": "holiday"})
    ck("a teacher cannot rewrite the school calendar", r.status_code == 403)

    # ══ payroll ════════════════════════════════════════════════════════════

    r = get("bursa", "/payroll/preview", month=7, year=2026)
    ck("the month can be previewed before anybody commits to it",
       r.status_code == 200 and r.json()["totals"]["staff_count"] == 2)
    ck("...with SSNIT taken at the statutory 5.5% from the worker",
       r.json()["totals"]["total_ssnit_worker"] == 192.5)
    preview_net = r.json()["totals"]["total_net"]

    r = post("bursa", "/payroll/run", {"month": 7, "year": 2026})
    ck("the month runs", r.status_code == 200 and r.json().get("created") == 2)

    r = get("bursa", "/dash/payroll", month=7, year=2026)
    m = r.json()["metrics"]
    ck("...and writes exactly what the preview said it would", m["net"] == preview_net)
    ck("...with the employer's own SSNIT shown separately from the worker's",
       m["ssnit_employee"] == 192.5 and m["ssnit_employer"] == 455.0)
    ck("...and the cost to the school stated as one figure",
       m["employer_cost"] == 3955.0)
    ck("...with nothing paid yet, so the whole run is outstanding",
       m["paid_count"] == 0 and m["outstanding"] == m["net"])

    r = get("bursa", "/payroll/%d/year" % staff_ids["OWUSU"], year=2026)
    ck("a year's pay can be read month by month",
       r.status_code == 200 and len(r.json()["months"]) == 1
       and r.json()["totals"]["paid_months"] == 0)
    r = get("owusu", "/payroll/%d/year" % staff_ids["OWUSU"], year=2026)
    ck("...and a teacher may read their own without holding payroll",
       r.status_code == 200)
    r = get("owusu", "/payroll/%d/year" % staff_ids["OFORIWAA"], year=2026)
    ck("...but not somebody else's", r.status_code == 403)

    # ══ staff, academics, finance, canteen ═════════════════════════════════

    r = get("adjei", "/dash/staff")
    m = r.json()["metrics"]
    ck("the staff dashboard counts who is on the books",
       r.status_code == 200 and m["total_active"] == 2 and m["total_all"] == 2)
    ck("...and who joined recently, for the faces on the screen",
       len(r.json()["recent_hires"]) == 2)
    r = get("bursa", "/dash/staff")
    ck("...and an accountant without the staff module is refused it",
       r.status_code == 403)

    r = get("owusu", "/dash/academics")
    ck("the academics dashboard opens for a teacher",
       r.status_code == 200 and r.json()["term"]["label"] == "Third Term")
    ck("...and reports an empty question bank as empty, not as absent",
       r.json()["metrics"]["question_bank_size"] == 0)

    post("bursa", "/finance/income", {"category": "Donation", "amount": 500,
                                      "payerName": "Old Students", "date": "2026-05-20"})
    post("bursa", "/finance/expenses", {"category": "Utilities", "amount": 120,
                                        "payeeName": "ECG", "description": "Electricity",
                                        "date": "2026-05-21"})
    r = get("bursa", "/dash/finance")
    m = r.json()["metrics"]
    ck("the finance dashboard adds the money in and the money out",
       r.status_code == 200 and m["income_total"] == 500 and m["expense_total"] == 120)
    ck("...and states the difference rather than making a screen do the sum",
       m["net"] == 380)
    ck("...against what the term is expected to bring in", m["expected_income"] == 1050)
    ck("...broken down by category for the donut",
       r.json()["income_by_category"][0]["category"] == "Donation")

    r = get("bursa", "/dash/canteen")
    ck("the canteen dashboard knows the daily rate it is counting with",
       r.status_code == 200 and r.json()["daily_rate"] > 0)

    r = get("adjei", "/dash/main")
    ck("the main dashboard picks up the same income",
       r.json()["metrics"]["income_total"] == 500)
    ck("...and charts it by month",
       any(x["ym"] == "2026-05" for x in r.json()["charts"]["income_by_month"]))

    # ══ training, and what is waiting to be decided ════════════════════════

    r = post("adjei", "/staff/%d/training" % staff_ids["OWUSU"], {
        "title": "GES refresher", "provider": "GES", "startDate": "2026-04-01"})
    ck("a training record can be added", r.status_code == 200 and r.json()["ok"])
    r = get("owusu", "/staff/%d/training" % staff_ids["OWUSU"])
    ck("a teacher may read their own training record without holding Staff",
       r.status_code == 200 and len(r.json()["training"]) == 1)
    r = get("bursa", "/staff/%d/training" % staff_ids["OWUSU"])
    ck("...and an accountant may not read somebody else's", r.status_code == 403)
    r = post("owusu", "/staff/%d/training" % staff_ids["OWUSU"], {"title": "Self-awarded"})
    ck("...nor may anybody write their own", r.status_code == 403)

    r = get("owusu", "/admin/approvals")
    ck("an account holding one approval queue and not the other is not refused",
       r.status_code == 200 and r.json()["ok"])
    ck("...and is told which half it is being shown",
       r.json()["may_see"]["lesson_notes"] is True
       and r.json()["may_see"]["leave"] is False)
    r = get("bursa", "/admin/approvals")
    ck("...and an account holding neither is refused outright", r.status_code == 403)

    # ══ attaching a picture ════════════════════════════════════════════════
    #
    # There is no disk to write to here, so the picture goes in the column the
    # desktop keeps a path in. What matters is that the school gets its face
    # back, that a PHP file is not a photograph, and that the limit is the
    # one this service can afford rather than the one a laptop can.

    png = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
           "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

    r = post("adjei", "/students/%d/photo" % pupils["ANSU"], {"file": png})
    ck("a pupil's photograph can be attached from a browser",
       r.status_code == 200 and r.json()["photo"].startswith("data:image/"))
    r = get("adjei", "/students/%d" % pupils["ANSU"])
    ck("...and comes back on the pupil's record",
       r.json()["student"]["photo"].startswith("data:image/"))
    ck("...without naming a folder on anybody's disk",
       "photo_path" not in r.json()["student"])

    r = post("adjei", "/students/%d/photo" % pupils["ANSU"],
             {"file": "data:application/x-httpd-php;base64,PD9waHA="})
    ck("a file that is not an image is refused",
       r.status_code == 400 and "not something this can store" in r.json()["error"])

    big = "data:image/png;base64," + ("A" * 2_400_000)
    r = post("adjei", "/students/%d/photo" % pupils["ANSU"], {"file": big})
    ck("...and one too large for a database to carry is refused with its size",
       r.status_code == 400 and "MB" in r.json()["error"])

    r = post("owusu", "/students/%d/photo" % pupils["DUUT"], {"file": png})
    ck("an account that may not edit a pupil may not attach a face to them",
       r.status_code == 403)

    r = post("owusu", "/staff/%d/photo" % staff_ids["OWUSU"], {"file": png})
    ck("...but their own face is theirs to set", r.status_code == 200)
    r = post("owusu", "/staff/%d/photo" % staff_ids["OFORIWAA"], {"file": png})
    ck("...and nobody else's is", r.status_code == 403)

    r = post("adjei", "/staff/%d/documents" % staff_ids["OWUSU"], {
        "title": "Teaching certificate", "docType": "Certificate",
        "expiryDate": "2027-06-30", "file": png})
    ck("a staff document can be attached", r.status_code == 200 and r.json()["ok"])
    doc_id = r.json()["id"]
    r = get("adjei", "/staff/%d/documents" % staff_ids["OWUSU"])
    ck("...and read back", len(r.json()["documents"]) == 1)
    ck("...without the file itself, which no list needs",
       "file_path" not in r.json()["documents"][0])
    r = get("adjei", "/dash/staff")
    ck("...and counts towards what is expiring on the staff dashboard",
       len(r.json()["expiring_documents"]) == 0)   # 2027 is more than 90 days out

    r = post("adjei", "/settings/logo", {"file": png})
    ck("the school's crest can be set from a browser", r.status_code == 200)
    r = client.get("/api/v1/school/branding", params={"school_id": school_id})
    ck("...and is what /branding then serves",
       (r.json().get("logo") or "").startswith("data:image/"))

    r = post("adjei", "/settings/signature", {"role": "headmaster", "file": png})
    ck("a head teacher's signature can be set", r.status_code == 200)
    r = post("adjei", "/settings/signature", {"role": "caretaker", "file": png})
    ck("...and a role that signs nothing is refused", r.status_code == 400)

    r = post("adjei", "/staff/documents/%d/delete" % doc_id)
    ck("a document can be withdrawn", r.status_code == 200)
    r = get("adjei", "/staff/%d/documents" % staff_ids["OWUSU"])
    ck("...and is gone", len(r.json()["documents"]) == 0)

    # ══ the bell schedule ══════════════════════════════════════════════════
    #
    # The editor holds the school's day as a list and sends the list. The route
    # read ONE period out of it, found no label, and answered "Give the period
    # a name" — so the bell schedule could not be edited online at all.

    r = post("adjei", "/timetable/periods", {"periods": [
        {"label": "Period 1", "start_time": "08:00", "end_time": "09:00", "display_order": 0},
        {"label": "Break", "start_time": "11:00", "end_time": "11:30",
         "display_order": 1, "is_break": 1}]})
    ck("the school's day can be laid out from the browser",
       r.status_code == 200 and r.json().get("written") == 2)
    ck("...and comes back in the order it was given",
       [p["label"] for p in r.json()["periods"]] == ["Period 1", "Break"])

    kept = r.json()["periods"][0]
    r = post("adjei", "/timetable/periods", {"periods": [
        {"id": kept["id"], "label": "Assembly", "start_time": "07:40",
         "end_time": "08:00", "display_order": 0}]})
    ck("...a period dropped from the list is removed, not left ringing",
       r.status_code == 200 and len(r.json()["periods"]) == 1
       and r.json()["periods"][0]["label"] == "Assembly")

    r = post("adjei", "/timetable/periods", {"periods": [{"label": "Nameless"}]})
    ck("a period with no times is refused with a sentence, not a stack trace",
       r.status_code == 400 and "both times" in r.json()["error"])

    r = post("owusu", "/timetable/periods", {"periods": [
        {"label": "Sneaky", "start_time": "09:00", "end_time": "10:00"}]})
    ck("...and the bell belongs to the office, not to one class teacher",
       r.status_code == 403)

    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
