"""The office application, hosted — one contract, two backends.

    DATABASE_URL=... ALLOW_DEV_SECRET=1 ALLOW_MEMORY_STORE=1 \
        python3 cloud-python/tests/test_desk.py

The claim under test is narrow and worth stating precisely: the SAME browser
build that a school's own computer serves at /desk works against this service,
because both answer the same three routes with the same shapes.

Without Postgres this still runs, and checks the half that does not need a
school: the map, the refusals, and the two answers a screen can be given for a
channel that is not here. Those are the ones that go wrong silently.

The rest is the same rule this service is built on: the online school is
stricter than the offline one, never looser. An accountant is refused the
register here for exactly the reason they are refused it at the office PC —
the same module, the same resolved permissions.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ.setdefault("ALLOW_MEMORY_STORE", "1")

from fastapi.testclient import TestClient          # noqa: E402

from app import desk_api, ratelimit                # noqa: E402
from app.main import create_app                    # noqa: E402
from app.school import db as sdb, session          # noqa: E402
from app.school import session as session_lib      # noqa: E402

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


def without_a_school(client):
    """What holds whether or not this service has a database behind it."""
    r = client.get("/api/v1/desk/coverage")
    body = r.json()
    ck("the service says what it can answer",
       r.status_code == 200 and len(body["answered"]) > 50)

    # The two answers a screen can be given, and the difference between them.
    # "Do this at the school's computer" is an instruction; "not online yet" is
    # a fact about this service. Neither is "something went wrong", and a
    # screen that got a 500 instead would show neither.
    r = client.post("/api/v1/desk/call", json={"channel": "backup:restore", "args": ["/x"]})
    ck("restoring a backup is refused, as an instruction",
       r.status_code == 200 and r.json()["host_only"] is True)

    r = client.post("/api/v1/desk/call", json={"channel": "receipts:generate", "args": [{}]})
    body = r.json()
    ck("a channel the port has not reached says so plainly",
       r.status_code == 200 and body["not_online_yet"] is True
       and "not available online yet" in body["error"])
    ck("...and names the part of the school it belongs to, not the channel",
       body["error"].startswith("Receipts"))

    r = client.post("/api/v1/desk/call", json={"channel": "students:list", "args": [{}]})
    ck("a channel that IS here still needs somebody signed in", r.status_code == 401)

    r = client.post("/api/v1/desk/call", json={"channel": "nonsense:channel", "args": []})
    ck("a channel nobody has ever heard of is answered, not crashed",
       r.status_code == 200 and r.json().get("not_online_yet") is True)

    r = client.post("/api/v1/desk/call", json={"channel": "students:list", "args": "not-a-list"})
    ck("arguments that are not arguments do not reach a handler", r.status_code == 401)

    # Every channel in the map must declare the module that gates it, or it is
    # reachable by anybody who can sign in.
    ungated = [c for c, e in desk_api.CHANNELS.items()
               if e["module"] is None and not c.startswith(("settings:list", "settings:get",
                                                            "auth:", "access:"))]
    ck("every channel that is not a public read declares the module that gates it",
       ungated == [])

    r = client.get("/api/v1/desk/info")
    ck("a service with no school named still says what it is",
       r.status_code == 200 and r.json()["desk"] is True)


def with_a_school(client):
    school_id = "t" + uuid.uuid4().hex[:10]
    sdb.provision(school_id)
    db = sdb.SchoolDb(school_id)
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

    grant("Accountant", {"dashboard": "view", "students": "view", "fees": "full",
                         "finance": "full"})
    grant("Class Teacher", {"dashboard": "view", "students": "view", "academics": "full"})

    def make_user(username, name, designation_name):
        return db.insert("users", {
            "username": username, "password_hash": session.hash_password("pass1234"),
            "full_name": name, "designation_id": designation(designation_name),
            "is_active": 1,
        })

    make_user("asante", "Mrs Asante", "Accountant")
    make_user("owusu", "Mr Owusu", "Class Teacher")
    make_user("adjei", "Ms Adjei", "Super Admin")

    b5 = db.value("SELECT id FROM class_groups WHERE short_code = 'BS5'")
    db.insert("students", {"index_number": "T/001", "surname": "ANSU", "first_name": "Monalisa",
                           "current_class_id": b5, "status": "Active"})

    # ── the school, before anybody signs in ─────────────────────────────────
    r = client.get(f"/api/v1/desk/info?school_id={school_id}")
    info = r.json()
    ck("the sign-in screen is given the school to draw",
       r.status_code == 200 and "settings" in info
       and set(info["settings"]) == {"school", "branding"})
    ck("...and nothing that is not on its letterhead",
       not any(k for k in info["settings"]["school"]
               if "key" in k or "secret" in k or "password" in k))

    r = client.get("/api/v1/desk/info?school_id=no-such-school")
    ck("a school that does not exist is not confirmed as one", r.status_code in (400, 404))

    # ── signing in ──────────────────────────────────────────────────────────
    def sign_in(username, password="pass1234"):
        return client.post("/api/v1/desk/login", json={
            "school_id": school_id, "username": username, "password": password}).json()

    bursar = sign_in("asante")
    teacher = sign_in("owusu")
    admin = sign_in("adjei")
    ck("staff sign in", all(x.get("token") for x in (bursar, teacher, admin)))

    # The offline application's own user shape, to the letter — the sign-in
    # screen is the same screen and reads the same fields.
    ck("...and are handed the shape the office application's screen expects",
       set(bursar["user"]) == {"id", "username", "fullName", "designation",
                               "mustChangePassword", "permissions"})
    ck("...with the school named inside the credential, not beside it",
       bursar["token"].startswith(school_id + "."))

    ck("a wrong password is refused", not sign_in("asante", "wrong").get("ok"))
    ck("a school that does not exist answers exactly as a wrong password does",
       client.post("/api/v1/desk/login", json={
           "school_id": "no-such-school", "username": "asante",
           "password": "pass1234"}).status_code == 401)

    def call(who, channel, *args):
        return client.post("/api/v1/desk/call",
                           headers={"Authorization": f'Bearer {who["token"]}'},
                           json={"channel": channel, "args": list(args)})

    # ── the same rules as the office PC ─────────────────────────────────────
    r = call(bursar, "students:list", {})
    ck("an accountant may read the roll",
       r.status_code == 200 and isinstance(r.json()["result"], list))

    r = call(bursar, "students:create", {"surname": "MENSAH", "first_name": "Ama"})
    ck("...and may not admit a pupil, because the school did not grant it",
       r.status_code == 403)

    r = call(bursar, "payroll:bulk-preview", {"month": 1, "year": 2026})
    ck("...and is refused payroll, which was never theirs", r.status_code == 403)

    r = call(admin, "students:create",
             {"surname": "MENSAH", "first_name": "Ama", "current_class_id": b5})
    ck("an administrator may admit a pupil",
       r.status_code == 200 and r.json()["result"].get("ok") is True)

    # The answer is the plain value the offline handler gives, not this
    # service's envelope — because four hundred lines of screen code read it.
    r = call(admin, "settings:list-classes")
    ck("a list channel answers with a list, as the office PC does",
       r.status_code == 200 and isinstance(r.json()["result"], list)
       and r.json()["result"][0].get("name"))

    r = call(admin, "auth:effective-permissions", admin["user"]["id"])
    perms = r.json()["result"]
    ck("permissions come back in the shape the application reads",
       isinstance(perms, dict) and "canView" in next(iter(perms.values())))

    r = call(teacher, "auth:effective-permissions", admin["user"]["id"])
    ck("...and a teacher cannot read an administrator's",
       r.json()["result"].get("ok") is False)

    r = call(bursar, "backup:restore", "/x")
    ck("a signed-in account is refused the office PC's own work too",
       r.json().get("host_only") is True)

    return school_id


def main():
    client = TestClient(create_app())
    without_a_school(client)

    if not os.environ.get("DATABASE_URL"):
        print("\n(Postgres not configured — the half that needs a school was skipped.)")
    else:
        with_a_school(client)

    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
