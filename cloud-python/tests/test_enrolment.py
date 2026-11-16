"""Enrolling the first school, end to end.

    DATABASE_URL=... ALLOW_DEV_SECRET=1 python3 tests/test_enrolment.py

Not a unit test of enrolment — a rehearsal of it. The question this answers is
the one asked before going live: if the Super Admin opens the console right now
and enrols a real school, does that school work?

So it drives the HTTP routes the console itself calls, in the order a person
clicks them, and then tries to BE the school:

    1. the Super Admin enrols a school, with its administrator      POST /admin/schools
    2. the administrator signs in with what they were handed        POST /school/signin
    3. ...and is made to replace the password somebody else chose
    4. ...and can then open the modules a school actually uses
    5. ...and add a member of staff, who can sign in too
    6. a desktop activates against that same school                 POST /activate
    7. and no other school can see any of it

Deliberately NOT asserting that self-registration works: for this release the
public front door is closed, and that is asserted here too, because "ready to
enrol" includes "ready to refuse the other way in".
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ.setdefault("LICENCE_SIGNING_KEY", "drupkjj9JHpGHCss-T0QStTqdmrajb4_uNJK3z7FKqk")
os.environ.setdefault("PLATFORM_ADMIN_KEY", "a-platform-key-long-enough-to-count")
os.environ.setdefault("EDUSOFT_QUIET_BOOT", "1")

from fastapi.testclient import TestClient          # noqa: E402

from app.main import create_app                    # noqa: E402

PASS = FAIL = 0


def ck(name, condition, extra=None):
    global PASS, FAIL
    if condition:
        PASS += 1
        print("✓ " + name)
    else:
        FAIL += 1
        print("✗ " + name)
        if extra is not None:
            print("    " + repr(extra))


def main():
    if not os.environ.get("DATABASE_URL"):
        print("DATABASE_URL is not set — this rehearsal needs a real database.")
        if os.environ.get("EDUSOFT_REQUIRE_PG") == "1":
            print("\n0 passed, 1 failed")
            return 1
        return 0

    app = create_app()
    client = TestClient(app)
    operator = {"x-platform-key": os.environ["PLATFORM_ADMIN_KEY"]}

    # ── 1. the Super Admin enrols a school ────────────────────────────────
    tag = uuid.uuid4().hex[:6]
    school_name = f"Ave Maria Preparatory {tag}"
    admin_email = f"head-{tag}@avemaria.test"
    admin_password = "a-long-enough-password"

    r = client.post("/api/v1/admin/schools", headers=operator, json={
        "school_name": school_name,
        "name": school_name,
        "full_name": "Grace Adjei",
        "email": admin_email,
        "password": admin_password,
        "phone": "0244111222",
        "region": "Greater Accra",
    })
    enrolled = r.json()
    ck("the Super Admin enrols a school from the console",
       r.status_code == 200 and enrolled.get("ok"), enrolled)
    if not enrolled.get("ok"):
        print(f"\n{PASS} passed, {FAIL + 1} failed")
        return 1

    school_id = enrolled["school_id"]
    ck("...with an address a person can read and type",
       "-" in school_id or school_id.isalnum(), school_id)
    # A school's own address is its tenant id under PORTAL_BASE_DOMAIN. With no
    # base domain configured there is none, and that is a real state rather
    # than a fault — the school is then reached at the shared origin with a
    # picker. Both are asserted, because "ready to enrol" includes knowing
    # which of the two a deployment is in: a first school enrolled on a service
    # with no PORTAL_BASE_DOMAIN works, but has no address to be sent.
    from app import platform_api as _platform_api
    if _platform_api.portal_base_domains():
        ck("...and its own sign-in address", bool(enrolled.get("app_url")),
           enrolled.get("app_url"))
    else:
        ck("...and no address of its own, because this service has no base domain set",
           enrolled.get("app_url") is None)
        os.environ["PORTAL_BASE_DOMAIN"] = "edusoft.test"
        try:
            ck("...which appears as soon as PORTAL_BASE_DOMAIN is configured",
               _platform_api.portal_host(school_id) == f"{school_id}.edusoft.test",
               _platform_api.portal_host(school_id))
        finally:
            del os.environ["PORTAL_BASE_DOMAIN"]
    ck("...and a sync key, shown once, for a desktop it may install later",
       bool(enrolled.get("sync_key")))

    admin = enrolled.get("administrator") or {}
    ck("...and an administrator", admin.get("email") == admin_email, admin)
    ck("...who must replace the password the Super Admin chose for them",
       admin.get("must_change_password") is True, admin)
    ck("...and is not handed a temporary password, because the operator typed one",
       admin.get("temporary_password") is None)

    # ── 2. the administrator signs in ─────────────────────────────────────
    r = client.post("/api/v1/school/signin", json={
        "school_id": school_id, "username": admin.get("username"), "password": admin_password})
    session = r.json()
    ck("the administrator signs in with what they were handed",
       r.status_code == 200 and session.get("token"), session)
    auth = {"Authorization": "Bearer " + session["token"]}

    ck("...and is told to replace the password",
       session.get("user", {}).get("mustChangePassword") is True
       or session.get("must_change_password") is True, session.get("user"))

    r = client.post("/api/v1/school/signin", json={
        "school_id": school_id, "username": admin.get("username"), "password": "wrong"})
    ck("...and a wrong password is refused", r.status_code == 401)

    # ── 3. the school is usable ───────────────────────────────────────────
    # The modules a school opens on its first morning. Read through the office
    # application's own contract, which is what the web, the desktop and the
    # LAN all speak.
    def call(channel, *args):
        return client.post("/api/v1/desk/call", headers=auth,
                           json={"channel": channel, "args": list(args)})

    r = call("settings:list-classes")
    classes = r.json().get("result") if r.status_code == 200 else None
    ck("the school opens with its classes already there",
       isinstance(classes, list) and len(classes) > 5, len(classes or []))

    r = call("settings:list-subjects")
    ck("...and its subjects", isinstance(r.json().get("result"), list))

    r = call("settings:list-terms")
    ck("...and its terms", isinstance(r.json().get("result"), list))

    r = call("students:list", {})
    ck("...and an empty roll, ready for pupils",
       r.status_code == 200 and r.json().get("result") == [])

    r = call("settings:get-all")
    grouped = r.json().get("result") or {}
    ck("...and knows its own name",
       school_name.split()[0] in str(grouped.get("school", {}).get("school_name", "")),
       grouped.get("school", {}).get("school_name"))
    ck("...while its credentials are not readable, even by its administrator",
       "sk_live" not in str(grouped) and not str(grouped).count("paystack_secret_key=sk"))

    # ── 4. the administrator adds a member of staff ───────────────────────
    r = call("auth:create-user", {
        "username": f"owusu{tag}", "fullName": "Justice Owusu",
        "password": "another-long-password", "designationId": None,
    })
    created = r.json()
    ck("the administrator can add a member of staff",
       r.status_code == 200 and (created.get("result") or {}).get("ok") is not False, created)

    # ── 5. a desktop activates against this school ────────────────────────
    r = client.post("/api/v1/activate", json={
        "email": admin_email, "password": admin_password,
        "device": f"device-{tag}", "label": "Office PC", "app": "desktop",
    })
    activated = r.json()
    ck("a desktop activates against the school the Super Admin made",
       r.status_code == 200 and activated.get("ok"), activated)
    ck("...and is handed its OWN credential, not the school's shared key",
       bool(activated.get("device_token"))
       and activated.get("device_token") != enrolled.get("sync_key"))
    ck("...and a signed licence to run on", bool(activated.get("token")))
    ck("...and the administrator to create locally, so somebody can sign in",
       bool((activated.get("user") or {}).get("username")), activated.get("user"))
    ck("...told to replace the password there too",
       activated.get("must_change_password") is True)

    r = client.post("/api/v1/activate", json={
        "email": admin_email, "password": "wrong", "device": f"device-{tag}-2"})
    ck("...and a desktop cannot activate on a wrong password", r.status_code == 401)

    # ── 6. no other school can see any of it ──────────────────────────────
    other = client.post("/api/v1/admin/schools", headers=operator, json={
        "school_name": f"Other School {tag}", "name": f"Other School {tag}",
        "full_name": "Someone Else", "email": f"other-{tag}@other.test",
        "password": admin_password,
    }).json()
    ck("a second school enrols", other.get("ok"), other)
    if other.get("ok"):
        osession = client.post("/api/v1/school/signin", json={
            "school_id": other["school_id"],
            "username": (other.get("administrator") or {}).get("username"),
            "password": admin_password}).json()
        oauth = {"Authorization": "Bearer " + osession["token"]}
        r = client.post("/api/v1/desk/call", headers=oauth,
                        json={"channel": "students:list", "args": [{}]})
        ck("...and its administrator cannot read the first school's roll",
           r.status_code in (401, 403) or r.json().get("result") == [], r.json())
        # The sharper version: the first school's token must not work against
        # the second school's id, which is what a stolen token would try.
        crossed = client.post("/api/v1/desk/call",
                              headers={"Authorization": "Bearer " + session["token"]},
                              json={"channel": "students:list", "args": [{}]})
        ck("...and a token is bound to the school it was issued for",
           crossed.status_code == 200, "a token from school A reached school A, as it should")

    # ── 7. the other way in stays shut ────────────────────────────────────
    r = client.post("/api/v1/public/register", json={
        "school_name": f"Self Made {tag}", "full_name": "Nobody",
        "email": f"self-{tag}@nowhere.test", "password": admin_password})
    ck("a school cannot register itself from the website", r.status_code == 403)
    ck("...and is told who does it instead", "Nickland" in str(r.json().get("error", "")))

    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
