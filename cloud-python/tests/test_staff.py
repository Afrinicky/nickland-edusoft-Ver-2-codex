"""The staff surface on the Python service, and a cross-language check that a
password hashed by the Node desktop verifies here.

Mirrors cloud/test/staff.js: a teacher signs in, marks a register with the
school's desktop off, sees their own pending work, and the queue carries it in
the shape the desktop's applier expects.
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ.setdefault("ALLOW_MEMORY_STORE", "1")

from fastapi.testclient import TestClient
from app.main import create_app
from app.store import MemoryStore
from app import staff as staff_api

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

passed = failed = 0


def ck(name, cond):
    global passed, failed
    cond = bool(cond)
    passed += cond
    failed += (not cond)
    print(("✓" if cond else "✗") + " " + name)


def node_bcrypt(pw):
    """A bcrypt hash from the REAL desktop's library, not Python's."""
    out = subprocess.check_output(
        ["node", "-e", "console.log(require(process.argv[1]).hashSync(process.argv[2], 8))",
         os.path.join(ROOT, "node_modules", "bcryptjs"), pw], text=True)
    return out.strip()


PERMS = {
    "students":  {"canView": True,  "canCreate": False, "canEdit": True,  "canDelete": False},
    "academics": {"canView": True,  "canCreate": True,  "canEdit": True,  "canDelete": False},
    "canteen":   {"canView": True,  "canCreate": True,  "canEdit": False, "canDelete": False},
    "dashboard": {"canView": True,  "canCreate": False, "canEdit": False, "canDelete": False},
    "fees":      {"canView": False, "canCreate": False, "canEdit": False, "canDelete": False},
    # Read and reply to a parent, but not post a notice to the whole school —
    # the split the desktop's own roles use.
    "notifications": {"canView": True, "canCreate": True, "canEdit": False, "canDelete": False},
}


def main():
    pw_hash = node_bcrypt("teach123")
    ck("a Node-hashed staff password verifies in Python", staff_api.verify_staff_password("teach123", pw_hash))
    ck("a wrong password does not", not staff_api.verify_staff_password("nope", pw_hash))

    store = MemoryStore()
    sid = store.create_school(name="Ave Maria School")["school_id"]

    # The desktop projects the teacher's scope alongside their permissions, so
    # the fixture carries one: Basic 5 outright and answerable for it, and
    # nothing in Basic 6. Without it the cloud served every class in the school
    # to every teacher.
    SCOPE = {"unrestricted": False, "whole_classes": [1], "class_subjects": {},
             "any_class_subjects": [], "class_teacher_of": [1]}

    store.upsert_snapshot(sid, {"entity_type": "staff_auth", "entity_key": "user:7", "uuid": "s1", "version": 1,
        "payload": {"user_id": 7, "username": "owusu", "full_name": "Mr Owusu", "staff_id": 3,
                    "designation": "Teacher", "is_admin": False, "password_hash": pw_hash,
                    "is_active": True, "permissions": PERMS, "scope": SCOPE}})
    store.upsert_snapshot(sid, {"entity_type": "class_roster", "entity_key": "class:1", "uuid": "c1", "version": 1,
        "payload": {"class_id": 1, "name": "Basic 5", "short_code": "B5", "level_order": 5,
                    "term": {"id": 3, "label": "Third Term"},
                    "students": [{"id": 11, "index_number": "AVE/001", "name": "ANSU Monalisa",
                                  "guardians": [{"relation": "Mother", "name": "Mrs Ansu", "contact": "0244000111"}]},
                                 {"id": 12, "index_number": "AVE/002", "name": "BOATENG Kwame", "guardians": []}],
                    "subjects": [{"id": 4, "name": "Mathematics", "code": "MTH"}],
                    "scores": {}, "attendance": {}, "homework": [], "timetable": None,
                    "assessments": {"4": {"columns": [{"id": 21, "assessment_type": "Class Test", "max_marks": 20,
                                                       "display_order": 1}],
                                          "marks": {"11": {"21": 14}}}},
                    "summaries": {"11": {"total_score_all": 300, "average_score": 75, "class_rank": 1,
                                         "number_on_roll": 2, "teacher_remarks": "A strong term."}},
                    "canteen": {"11": {"unpaid_days": 4, "amount_owed": 20},
                                "12": {"unpaid_days": 0, "amount_owed": 0}},
                    "daily_rate": 5, "weights": {"classWeight": 40, "examWeight": 60},
                    "grading_bands": [{"min_score": 75, "max_score": 100, "remark": "Higher"}],
                    "attendance_days": 14}})
    # A class this teacher has nothing to do with.
    store.upsert_snapshot(sid, {"entity_type": "class_roster", "entity_key": "class:2", "uuid": "c2", "version": 1,
        "payload": {"class_id": 2, "name": "Basic 6", "short_code": "B6", "level_order": 6,
                    "students": [{"id": 21, "index_number": "AVE/021", "name": "OTHER Pupil"}],
                    "subjects": [{"id": 4, "name": "Mathematics", "code": "MTH"}],
                    "scores": {}, "attendance": {}, "homework": []}})
    store.upsert_snapshot(sid, {"entity_type": "student_snapshot", "entity_key": "student:11", "uuid": "p1", "version": 1,
        "payload": {"student_id": 11, "index_number": "AVE/001", "name": "ANSU Monalisa",
                    "class_id": 1, "class_name": "Basic 5", "term": "Third Term",
                    "fees": {"billed": 500, "paid": 240, "balance": 260},
                    "canteen": {"unpaid_days": 4, "amount_owed": 20},
                    "attendance": {"present": 40, "absent": 2, "total": 42},
                    "report": {"term": "Third Term", "subjects": [{"subject": "Mathematics", "total": 78, "grade": "Higher"}],
                               "average": 75, "rank": 1, "number_on_roll": 2, "remarks": "A strong term."},
                    "homework": []}})
    store.upsert_snapshot(sid, {"entity_type": "student_snapshot", "entity_key": "student:21", "uuid": "p2", "version": 1,
        "payload": {"student_id": 21, "index_number": "AVE/021", "name": "OTHER Pupil",
                    "class_id": 2, "class_name": "Basic 6"}})
    store.upsert_snapshot(sid, {"entity_type": "staff_profile", "entity_key": "profile:user:7", "uuid": "hr1", "version": 1,
        "payload": {"user_id": 7, "has_staff": True,
                    "staff": {"id": 3, "staff_number": "AVE-003", "name": "Owusu Kofi", "role": "Teacher",
                              "status": "Active", "designation": "Teacher"},
                    "assignments": [{"class_group_id": 1, "subject_id": None, "is_class_teacher": 1,
                                     "class_name": "Basic 5", "subject_name": None}],
                    "lesson_notes": [{"id": 5, "topic": "Adding fractions", "status": "submitted",
                                      "class_name": "Basic 5", "subject_name": "Mathematics"}],
                    "leave": [], "attendance": [],
                    "payslips": [{"id": 2, "month": 7, "year": 2026, "net_salary": 1800,
                                  "actual_amount_paid": 1800}]}})
    store.upsert_snapshot(sid, {"entity_type": "announcement", "entity_key": "announcement:1", "uuid": "a1", "version": 1,
        "payload": {"id": 1, "title": "Mid-term break", "body": "School closes Friday.",
                    "audience": "all", "is_active": 1, "created_at": "2026-08-01"}})
    store.upsert_snapshot(sid, {"entity_type": "message_thread", "entity_key": "thread:t-1", "uuid": "t1", "version": 1,
        "payload": {"uuid": "t-1", "parent_id": 1, "student_id": 11, "student_name": "ANSU Monalisa",
                    "subject": "Absence on Monday", "last_message_at": "2026-08-20 09:00",
                    "messages": [{"sender_type": "parent", "sender_name": "Mrs Ansu",
                                  "body": "She was unwell.", "created_at": "2026-08-20 09:00"}]}})
    store.upsert_snapshot(sid, {"entity_type": "school_metrics", "entity_key": "metrics:school", "uuid": "m1", "version": 1,
        "payload": {"term": {"id": 3, "label": "Third Term"},
                    "metrics": {"students": 2, "staff": 1, "fees_collected": 900, "fees_outstanding": 260}}})

    c = TestClient(create_app(store))

    ck("the portal advertises a staff surface", c.get("/api/v1/info").json().get("staff") is True)

    ck("wrong password -> 401",
       c.post("/api/v1/staff/login", json={"school_id": sid, "username": "owusu", "password": "x"}).status_code == 401)

    r = c.post("/api/v1/staff/login", json={"school_id": sid, "username": "owusu", "password": "teach123"})
    ck("teacher signs in over the internet", r.status_code == 200 and r.json().get("token"))
    hdr = {"Authorization": "Bearer " + r.json()["token"]}

    ck("no token -> 401", c.get("/api/v1/staff/me").status_code == 401)

    # These credentials are on the public internet now, so guessing has to cost
    # something. Verified rather than assumed.
    from app import ratelimit
    refused = sum(1 for i in range(40) if c.post(
        "/api/v1/staff/login",
        json={"school_id": sid, "username": "owusu", "password": f"guess{i}"}).status_code == 429)
    ck("password guessing is throttled", refused > 0)
    ck("and a correct password is refused too once the limit is hit",
       c.post("/api/v1/staff/login", json={"school_id": sid, "username": "owusu", "password": "teach123"}).status_code == 429)
    ratelimit.reset()
    ck("the throttle lifts",
       c.post("/api/v1/staff/login", json={"school_id": sid, "username": "owusu", "password": "teach123"}).status_code == 200)

    me = c.get("/api/v1/staff/me", headers=hdr).json()
    ck("me returns the profile and permissions",
       me["ok"] and me["role"] == "staff" and me["user"]["full_name"] == "Mr Owusu"
       and me["permissions"]["academics"]["canEdit"] is True)

    # Cross-role: neither token opens the other's endpoints.
    from app import portal_auth as pauth
    parent_token = pauth.sign_token({"school_id": sid, "parent_id": 1})
    ck("a parent token is refused by staff endpoints",
       c.get("/api/v1/staff/me", headers={"Authorization": "Bearer " + parent_token}).status_code == 401)
    ck("a staff token is refused by parent endpoints",
       c.get("/api/v1/portal/children", headers=hdr).status_code == 401)

    ck("classes list", c.get("/api/v1/staff/classes", headers=hdr).json()["classes"][0]["name"] == "Basic 5")
    ck("roster lists the class", len(c.get("/api/v1/staff/students", headers=hdr).json()["students"]) == 2)

    dash = c.get("/api/v1/staff/dashboard", headers=hdr).json()
    ck("dashboard shows the school's numbers", dash["metrics"]["students"] == 2)
    ck("but hides money from a teacher who cannot see fees",
       dash["metrics"]["fees_collected"] == 0 and dash["metrics"]["fees_outstanding"] == 0)
    ck("and the debtor list is refused outright", c.get("/api/v1/staff/debtors", headers=hdr).status_code == 403)

    day = "2026-08-24"
    sheet = c.get(f"/api/v1/staff/attendance?classId=1&date={day}", headers=hdr).json()
    ck("register starts unmarked", len(sheet["students"]) == 2 and all(s["status"] is None for s in sheet["students"]))

    r = c.post("/api/v1/staff/attendance", headers=hdr, json={
        "date": day, "marks": [{"student_id": 11, "status": "present"},
                               {"student_id": 12, "status": "absent", "notes": "Sick"}]})
    ck("register submitted and queued", r.json()["ok"] and r.json()["queued"] and r.json()["saved"] == 2)

    sheet = c.get(f"/api/v1/staff/attendance?classId=1&date={day}", headers=hdr).json()
    by_id = {s["id"]: s for s in sheet["students"]}
    ck("the teacher sees their own marks after reloading",
       by_id[11]["status"] == "present" and by_id[12]["status"] == "absent" and by_id[12]["notes"] == "Sick")
    ck("and they are flagged as not yet at the school", all(s.get("pending") for s in sheet["students"]))

    ck("an impossible score is refused",
       c.post("/api/v1/staff/scores", headers=hdr, json={"subjectId": 4, "marks": [{"student_id": 11, "exam_score": 140}]}).status_code == 400)
    r = c.post("/api/v1/staff/scores", headers=hdr, json={"subjectId": 4, "marks": [{"student_id": 11, "exam_score": 82}]})
    ck("scores queued", r.json()["ok"] and r.json()["saved"] == 1)
    sc = c.get("/api/v1/staff/scores?classId=1&subjectId=4", headers=hdr).json()
    got = {s["id"]: s for s in sc["students"]}
    ck("the score sheet shows the queued mark", got[11]["exam_score"] == 82 and got[11].get("pending") is True)
    ck("and invents no total for it", got[11]["total_score"] is None)

    r = c.post("/api/v1/staff/canteen/collect", headers=hdr, json={"student_id": 11, "amount": 25})
    ck("canteen collection queued, with no invented receipt number",
       r.json()["ok"] and r.json()["queued"] and r.json()["receipt_number"] is None)

    r = c.post("/api/v1/staff/homework", headers=hdr, json={"classId": 1, "title": "Fractions p.42", "maxMarks": 10})
    ck("homework queued", r.json()["ok"])
    ck("the teacher sees the homework they just set",
       any(h["title"] == "Fractions p.42" and h.get("pending")
           for h in c.get("/api/v1/staff/homework?classId=1", headers=hdr).json()["homework"]))

    ck("the account screen can say how much is waiting",
       c.get("/api/v1/staff/pending", headers=hdr).json()["pending"] == 4)
    waiting_before_extras = 4

    # The queue must be in the shape the desktop's applier reads.
    queued = store.pending_changes(sid, types=staff_api.WRITE_TYPES)
    ck("every queued change carries the acting teacher", all((q["payload"] or {}).get("user_id") == 7 for q in queued))
    ck("money and homework carry a uuid so a replay cannot double them",
       all((q["payload"] or {}).get("uuid") for q in queued if q["type"] in ("canteen_collect", "homework_create")))

    # The desktop comes back: pull, then pull again to acknowledge.
    first = store.changes_since(sid, "0")
    ck("the desktop is served the queued work", len(first["changes"]) == 4)
    store.changes_since(sid, str(first["cursor"]))
    ck("nothing is left waiting once it has been taken",
       c.get("/api/v1/staff/pending", headers=hdr).json()["pending"] == 0)

    # ── the scope the desktop projects holds here too ──
    names = [c_["name"] for c_ in c.get("/api/v1/staff/classes", headers=hdr).json()["classes"]]
    ck("a class that is not theirs is not listed", "Basic 6" not in names)
    ck("and its roll is not served",
       all(s_["class_name"] != "Basic 6" for s_ in c.get("/api/v1/staff/students", headers=hdr).json()["students"]))
    ck("its register resolves to nothing at all",
       c.get("/api/v1/staff/attendance?classId=2&date=2026-08-24", headers=hdr).json()["students"] == [])
    ck("and a pupil in it answers not-found, not forbidden",
       c.get("/api/v1/staff/students/21", headers=hdr).status_code == 404)

    # ── a pupil's record ──
    prof = c.get("/api/v1/staff/students/11", headers=hdr).json()
    ck("a pupil's record carries who to ring",
       prof["guardians"][0]["contact"] == "0244000111")
    ck("and their attendance and marks", prof["attendance"]["present"] == 40 and prof["subjects"][0]["total_score"] == 78)
    ck("but not fees, which this teacher may not see", prof["fees"] is None)

    # ── continuous assessment ──
    a = c.get("/api/v1/staff/assessments?classId=1&subjectId=4", headers=hdr).json()
    ck("the assessment sheet carries its columns and marks",
       a["columns"][0]["max_marks"] == 20
       and {x["id"]: x for x in a["students"]}[11]["marks"]["21"] == 14)
    ck("adding a column is refused, because the desktop numbers it",
       c.post("/api/v1/staff/assessments/column", headers=hdr,
              json={"classId": 1, "subjectId": 4, "assessmentType": "Quiz", "maxMarks": 10}).status_code == 400)
    ck("a mark above what the assessment is out of is refused",
       c.post("/api/v1/staff/assessments", headers=hdr,
              json={"classId": 1, "subjectId": 4,
                    "marks": [{"student_id": 11, "column_id": 21, "marks": 30}]}).status_code == 400)
    r = c.post("/api/v1/staff/assessments", headers=hdr,
               json={"classId": 1, "subjectId": 4, "marks": [{"student_id": 12, "column_id": 21, "marks": 16}]})
    ck("class work marks queue", r.json()["ok"] and r.json()["queued"])
    a = c.get("/api/v1/staff/assessments?classId=1&subjectId=4", headers=hdr).json()
    ck("and the teacher sees their own straight away",
       {x["id"]: x for x in a["students"]}[12]["marks"]["21"] == 16)

    # ── the broadsheet and the report ──
    board = c.get("/api/v1/staff/results?classId=1", headers=hdr).json()
    ck("the broadsheet carries the position and average",
       {x["id"]: x for x in board["students"]}[11]["rank"] == 1)
    rep = c.get("/api/v1/staff/results/student/11", headers=hdr).json()
    ck("a report card carries the grading bands", rep["grading_bands"][0]["remark"] == "Higher")
    ck("only the class teacher writes the remarks — and this one is",
       c.post("/api/v1/staff/results/remarks", headers=hdr,
              json={"studentId": 11, "remarks": "Well done."}).json()["ok"])
    ck("but not for a pupil in another class",
       c.post("/api/v1/staff/results/remarks", headers=hdr,
              json={"studentId": 21, "remarks": "No."}).status_code == 403)

    # ── the canteen sheet ──
    sheet2 = c.get("/api/v1/staff/canteen/class?classId=1", headers=hdr).json()
    ck("the canteen sheet totals what the class owes", sheet2["totals"]["amount"] == 20)
    ck("and belongs to the class teacher only",
       c.get("/api/v1/staff/canteen/class?classId=2", headers=hdr).status_code == 403)

    # ── the teacher's own employment ──
    hr = c.get("/api/v1/staff/hr/me", headers=hdr).json()
    ck("their own record is served", hr["has_staff"] and hr["staff"]["staff_number"] == "AVE-003")
    ck("with the classes they are answerable for", hr["assignments"][0]["is_class_teacher"] == 1)
    ck("payslips are their own", c.get("/api/v1/staff/hr/payslips", headers=hdr).json()["payslips"][0]["year"] == 2026)
    ck("clocking in queues", c.post("/api/v1/staff/hr/clock", headers=hdr, json={"direction": "in"}).json()["queued"])
    ck("and shows at once", c.get("/api/v1/staff/hr/me", headers=hdr).json()["today"]["attendance"]["pending"] is True)
    ck("leave with the end before the start is refused",
       c.post("/api/v1/staff/hr/leave", headers=hdr,
              json={"leaveType": "Casual", "startDate": "2026-09-10", "endDate": "2026-09-01",
                    "justification": "x"}).status_code == 400)
    r = c.post("/api/v1/staff/hr/leave", headers=hdr,
               json={"leaveType": "Casual", "startDate": "2026-09-01", "endDate": "2026-09-03",
                     "justification": "Family funeral."})
    ck("a leave request counts its days", r.json()["days_requested"] == 3)
    ck("and shows as pending before the school has it",
       c.get("/api/v1/staff/hr/leave", headers=hdr).json()["requests"][0]["pending"] is True)

    # ── lesson notes ──
    ck("lesson notes are the teacher's own",
       c.get("/api/v1/staff/lesson-notes", headers=hdr).json()["notes"][0]["topic"] == "Adding fractions")
    ck("a note with no topic is refused",
       c.post("/api/v1/staff/lesson-notes", headers=hdr, json={"classId": 1}).status_code == 400)
    ck("one for another class is refused",
       c.post("/api/v1/staff/lesson-notes", headers=hdr,
              json={"classId": 2, "topic": "Nope"}).status_code == 403)
    ck("a new note queues",
       c.post("/api/v1/staff/lesson-notes", headers=hdr,
              json={"classId": 1, "topic": "Long division", "status": "submitted"}).json()["queued"])
    ck("and appears in the list at once",
       any(n["topic"] == "Long division" and n.get("pending")
           for n in c.get("/api/v1/staff/lesson-notes", headers=hdr).json()["notes"]))

    # ── messages and notices ──
    ck("the thread list is served",
       c.get("/api/v1/staff/messages", headers=hdr).json()["threads"][0]["subject"] == "Absence on Monday")
    ck("starting a new conversation says it needs the school",
       c.post("/api/v1/staff/messages", headers=hdr, json={"body": "Hello"}).status_code == 400)
    ck("a reply queues",
       c.post("/api/v1/staff/messages", headers=hdr,
              json={"threadUuid": "t-1", "body": "Thank you for letting us know."}).json()["queued"])
    ck("and shows in the thread before the school has it",
       c.get("/api/v1/staff/messages/t-1", headers=hdr).json()["messages"][-1]["pending"] is True)
    ck("notices are readable", c.get("/api/v1/staff/announcements", headers=hdr).json()["announcements"][0]["title"] == "Mid-term break")
    ck("posting one needs the right to edit notifications",
       c.post("/api/v1/staff/announcements", headers=hdr,
              json={"title": "x", "body": "y"}).status_code == 403)

    # ── one sign-in box ──
    ratelimit.reset()
    r = c.post("/api/v1/signin", json={"school_id": sid, "identifier": "owusu", "password": "teach123"})
    ck("the single sign-in box finds the staff account", r.status_code == 200 and r.json()["role"] == "staff")
    ck("and says nothing useful about a wrong one",
       c.post("/api/v1/signin", json={"school_id": sid, "identifier": "owusu", "password": "no"}).status_code == 401)

    # Revoking the account ends the session on the next request.
    store.upsert_snapshot(sid, {"entity_type": "staff_auth", "entity_key": "user:7", "uuid": "s2", "version": 2,
        "payload": {"user_id": 7, "username": "owusu", "full_name": "Mr Owusu", "is_active": False, "permissions": PERMS}})
    ck("a revoked teacher is signed out on their next request",
       c.get("/api/v1/staff/me", headers=hdr).status_code == 401)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
