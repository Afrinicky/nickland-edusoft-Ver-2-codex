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
}


def main():
    pw_hash = node_bcrypt("teach123")
    ck("a Node-hashed staff password verifies in Python", staff_api.verify_staff_password("teach123", pw_hash))
    ck("a wrong password does not", not staff_api.verify_staff_password("nope", pw_hash))

    store = MemoryStore()
    sid = store.create_school(name="Ave Maria School")["school_id"]

    store.upsert_snapshot(sid, {"entity_type": "staff_auth", "entity_key": "user:7", "uuid": "s1", "version": 1,
        "payload": {"user_id": 7, "username": "owusu", "full_name": "Mr Owusu", "staff_id": 3,
                    "designation": "Teacher", "is_admin": False, "password_hash": pw_hash,
                    "is_active": True, "permissions": PERMS}})
    store.upsert_snapshot(sid, {"entity_type": "class_roster", "entity_key": "class:1", "uuid": "c1", "version": 1,
        "payload": {"class_id": 1, "name": "Basic 5", "short_code": "B5", "level_order": 5,
                    "term": {"id": 3, "label": "Third Term"},
                    "students": [{"id": 11, "index_number": "AVE/001", "name": "ANSU Monalisa"},
                                 {"id": 12, "index_number": "AVE/002", "name": "BOATENG Kwame"}],
                    "subjects": [{"id": 4, "name": "Mathematics", "code": "MTH"}],
                    "scores": {}, "attendance": {}, "homework": [], "timetable": None}})
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

    # Revoking the account ends the session on the next request.
    store.upsert_snapshot(sid, {"entity_type": "staff_auth", "entity_key": "user:7", "uuid": "s2", "version": 2,
        "payload": {"user_id": 7, "username": "owusu", "full_name": "Mr Owusu", "is_active": False, "permissions": PERMS}})
    ck("a revoked teacher is signed out on their next request",
       c.get("/api/v1/staff/me", headers=hdr).status_code == 401)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
