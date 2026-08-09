"""Python cloud tests via FastAPI TestClient, plus a cross-language check that
a scrypt hash produced by the Node desktop verifies in Python (so accounts
created on the desktop log into the Python cloud)."""
import os
import subprocess
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from app.main import create_app
from app.store import MemoryStore
from app import portal_auth as pauth

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

passed = failed = 0


def ck(name, cond):
    global passed, failed
    cond = bool(cond)
    passed += cond
    failed += (not cond)
    print(("✓" if cond else "✗") + " " + name)


def node_hash(pw):
    """Get a scrypt hash from the REAL Node desktop parents module."""
    code = "console.log(require(process.argv[1]).hashPassword(process.argv[2]))"
    parents = os.path.join(ROOT, "electron", "server", "parents.js")
    out = subprocess.check_output(["node", "-e", code, parents, pw], text=True)
    return out.strip()


def main():
    # Cross-language scrypt: Node-produced hash verifies in Python.
    h = node_hash("pass12")
    ck("Node scrypt hash verifies in Python", pauth.verify_password("pass12", h) is True)
    ck("wrong password rejected", pauth.verify_password("nope", h) is False)

    store = MemoryStore()
    sch = store.create_school(name="Ave Maria School")
    sid = sch["school_id"]
    store.upsert_snapshot(sid, {"entity_type": "parent_auth", "entity_key": "parent:1", "uuid": "u1", "version": 1,
        "payload": {"parent_id": 1, "full_name": "Papa", "phone": "233244123456", "email": "papa@mail.com",
                    "password_hash": h, "is_active": 1, "student_keys": ["student:1"]}})
    store.upsert_snapshot(sid, {"entity_type": "student_snapshot", "entity_key": "student:1", "uuid": "u2", "version": 1,
        "payload": {"student_id": 1, "name": "ANSU MONA", "index_number": "AVE/17/00001", "class_name": "Basic 5",
                    "term": "Third Term", "fees": {"billed": 410, "paid": 150, "balance": 260},
                    "canteen": {"unpaid_days": 3, "amount_owed": 15}, "updated_at": "2026-07-30T00:00:00Z"}})
    store.upsert_snapshot(sid, {"entity_type": "receipt", "entity_key": "receipt:FE/26/00001", "uuid": "u3", "version": 1,
        "payload": {"receipt_number": "FE/26/00001", "student_id": 1, "amount": 150, "category": "fees", "payment_method": "Cash", "date": "2026-07-30"}})

    c = TestClient(create_app(store))

    r = c.get("/")
    ck("website served at /", r.status_code == 200 and "Parent Portal" in r.text)

    r = c.get("/api/v1/portal/schools").json()
    ck("schools list includes tenant", r["ok"] and any(s["school_id"] == sid for s in r["schools"]))

    ck("wrong password -> 401", c.post("/api/v1/portal/login", json={"school_id": sid, "identifier": "0244123456", "password": "x"}).status_code == 401)

    r = c.post("/api/v1/portal/login", json={"school_id": sid, "identifier": "0244123456", "password": "pass12"})
    ck("login by phone ok + token", r.status_code == 200 and r.json().get("token"))
    token = r.json()["token"]
    hdr = {"Authorization": "Bearer " + token}

    ck("children without token -> 401", c.get("/api/v1/portal/children").status_code == 401)

    me = c.get("/api/v1/portal/me", headers=hdr).json()
    ck("me returns parent + school", me["ok"] and me["parent"]["full_name"] == "Papa" and me["school"]["name"] == "Ave Maria School")

    kids = c.get("/api/v1/portal/children", headers=hdr).json()
    ck("children shows linked child (balance 260)", kids["ok"] and len(kids["children"]) == 1 and kids["children"][0]["fees"]["balance"] == 260)

    rcs = c.get("/api/v1/portal/receipts", headers=hdr).json()
    ck("receipts returns the child receipt", rcs["ok"] and len(rcs["receipts"]) == 1 and rcs["receipts"][0]["receipt_number"] == "FE/26/00001")

    ck("profile update ok", c.post("/api/v1/portal/profile", headers=hdr, json={"full_name": "Papa Ansu", "email": "new@mail.com"}).json()["ok"])
    changes = store.changes_since(sid, "0")["changes"]
    ck("profile update queued parent_update for desktop", any(ch["type"] == "parent_update" and ch["payload"]["full_name"] == "Papa Ansu" for ch in changes))
    me2 = c.get("/api/v1/portal/me", headers=hdr).json()
    ck("me reflects update immediately", me2["parent"]["full_name"] == "Papa Ansu" and me2["parent"]["email"] == "new@mail.com")

    ck("login by (updated) email ok", c.post("/api/v1/portal/login", json={"school_id": sid, "identifier": "new@mail.com", "password": "pass12"}).status_code == 200)

    # sync contract (school key)
    key = sch["api_key"]
    sk = {"x-school-key": key}
    ck("sync ping ok", c.get("/api/v1/sync/ping", headers=sk).json()["ok"])
    push = c.post("/api/v1/sync/push", headers=sk, json={"records": [
        {"uuid": "u9", "entity_type": "student_snapshot", "entity_key": "student:2", "version": 1, "payload": {"student_id": 2, "fees": {"balance": 99}}}]}).json()
    ck("sync push accepts record", push["ok"] and push["accepted"] == ["u9"])
    ck("bad school key -> 401", c.get("/api/v1/sync/ping", headers={"x-school-key": "nope"}).status_code == 401)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
