"""Trying to break it on purpose.

    DATABASE_URL=... ALLOW_DEV_SECRET=1 \\
        python3 cloud-python/tests/test_attack.py

Every other suite here asks "does it work". This one asks "what happens when
somebody who has read the source tries". The cases are the ones a real attempt
would start with, in roughly the order somebody would think of them, and each
is written so that a regression fails LOUDLY rather than quietly widening
what an attacker can reach.

The three things being protected, in the order they matter:

  1. **One school's data from another school.** By far the worst outcome here.
     A school's roll, its marks and its parents' phone numbers are not ours to
     lose, and multi-tenancy is one forgotten `WHERE school_id` from losing
     them.
  2. **The platform from its own customers.** A school administrator is
     powerful inside their own school and must be powerless outside it.
  3. **The licensing from the licensee.** Last, deliberately: money is worth
     less than somebody else's children's records.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ["EDUSOFT_QUIET_BOOT"] = "1"
os.environ["PLATFORM_ADMIN_KEY"] = "pk_test_" + ("x" * 32)
os.environ.setdefault("LICENCE_SIGNING_KEY", "drupkjj9JHpGfnLIFkr0V0jdVaDBK8O0qkXIzKNHCEg")

from fastapi.testclient import TestClient                          # noqa: E402

from app import ratelimit                                          # noqa: E402
from app.billing import devices as device_lib                      # noqa: E402
from app.billing import licence as licence_lib                     # noqa: E402
from app.billing import seals as seal_lib                          # noqa: E402
from app.billing.repo import repo_for                              # noqa: E402
from app.main import create_app                                    # noqa: E402
from app.school.db import SchoolDb                                 # noqa: E402

KEY = os.environ["PLATFORM_ADMIN_KEY"]
passed = failed = 0


def ck(name, condition, extra=None):
    global passed, failed
    condition = bool(condition)
    passed += condition
    failed += (not condition)
    print(("✓" if condition else "✗") + " " + name)
    if not condition and extra is not None:
        print("    " + repr(extra))


def enrol(client, label):
    email = f"{label}-{uuid.uuid4().hex[:8]}@school.test"
    body = client.post("/api/v1/public/register", json={
        "school_name": f"{label.title()} School {uuid.uuid4().hex[:4]}",
        "full_name": "Head Teacher", "email": email,
        "password": "a-long-enough-password", "students": 80}).json()
    return {**body, "email": email, "password": "a-long-enough-password",
            "headers": {"Authorization": f'Bearer {body["token"]}'}}


def main():
    app = create_app()
    client = TestClient(app)
    store = app.state.store
    repo = repo_for(store)
    ratelimit.reset()

    ave = enrol(client, "ave")
    kofi = enrol(client, "kofi")

    # ══ 1. One school reaching another ══════════════════════════════════
    print("\nOne school reaching another")

    # The token is `<school>.<token>`. The obvious first try is editing the
    # half in front of the dot.
    forged = f'{kofi["school_id"]}.{ave["token"].split(".", 1)[1]}'
    r = client.get("/api/v1/school/students", headers={"Authorization": f"Bearer {forged}"})
    ck("a token re-addressed at another school is refused", r.status_code in (401, 403), r.status_code)

    # Asking for another school's billing with your own good token.
    mine = client.get("/api/v1/school/billing", headers=ave["headers"]).json()
    ck("billing answers about the caller's own school only",
       mine["school"]["id"] == ave["school_id"], mine.get("school"))

    # Naming another school in the body of a write.
    r = client.post("/api/v1/school/billing/plan", headers=ave["headers"],
                    json={"plan_id": "max", "school_id": kofi["school_id"]})
    after = client.get("/api/v1/school/billing", headers=kofi["headers"]).json()
    ck("a school_id in the body does not redirect a write",
       after["plan"]["plan_id"] != "max" or r.status_code >= 400,
       (r.status_code, after["plan"]["plan_id"]))

    # Deactivating a device that is not yours.
    device_lib.claim(store, repo, kofi["school_id"], "kofi-pc", label="Kofi PC")
    theirs = device_lib.list_devices(repo, kofi["school_id"])[0]
    r = client.request("DELETE", f'/api/v1/school/billing/devices/{theirs["id"]}',
                       headers=ave["headers"])
    ck("a school cannot deactivate another school's computer",
       r.status_code == 404 and device_lib.is_active(repo, kofi["school_id"], "kofi-pc"),
       r.status_code)

    # Spending another school's seals.
    drawn = seal_lib.draw(store, repo, kofi["school_id"], kind="receipt", count=2)
    stolen = drawn["seals"][0]["serial"]
    spent = seal_lib.spend(repo, ave["school_id"], stolen)
    ck("a school cannot spend another school's seal", not spent.get("ok"), spent)
    ck("...and is told 'no such seal', not 'not yours'",
       "No such seal" in str(spent.get("error")), spent.get("error"))

    # ══ 2. A school reaching the platform ═══════════════════════════════
    print("\nA school reaching the platform")

    for path in ("/api/v1/admin/schools", "/api/v1/admin/settings",
                 "/api/v1/admin/operators", "/api/v1/admin/audit"):
        ck(f"a school token opens nothing at {path}",
           client.get(path, headers=ave["headers"]).status_code in (401, 403),
           client.get(path, headers=ave["headers"]).status_code)

    # With no cron secret configured the routes are not there at all — a 404,
    # which is the stronger answer and what a half-configured service should
    # give. With one configured, the console's key must still not open them.
    ck("with nothing scheduled, the cron routes do not exist",
       client.post("/api/v1/admin/cron/billing-run",
                   headers={"x-platform-key": KEY}).status_code == 404)
    os.environ["BILLING_CRON_SECRET"] = "a-scheduler-secret-long-enough"
    try:
        ck("the cron routes need their OWN secret, not the console's",
           client.post("/api/v1/admin/cron/billing-run",
                       headers={"x-platform-key": KEY}).status_code == 401)
        ck("...and open to the scheduler's",
           client.post("/api/v1/admin/cron/reminders",
                       headers={"x-cron-key": "a-scheduler-secret-long-enough"}
                       ).status_code == 200)
    finally:
        os.environ.pop("BILLING_CRON_SECRET", None)

    # A school's own device token must not be an admin credential.
    activated = client.post("/api/v1/activate", json={
        "email": ave["email"], "password": ave["password"],
        "device": "ave-pc", "label": "Office", "build": "b1"}).json()
    ck("a device token is not a platform key",
       client.get("/api/v1/admin/schools",
                  headers={"x-platform-key": activated["device_token"]}).status_code
       in (401, 403, 404))

    # ══ 3. The licensing ════════════════════════════════════════════════
    print("\nThe licensing")

    lease = licence_lib.issue(store, repo, ave["school_id"], device="ave-pc")
    ck("a lease is signed", lease.get("signed"))

    # Lift a genuine lease onto another school.
    import base64
    import json
    body, _, signature = lease["token"].partition(".")
    payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    # Each value must DIFFER from what the lease already says, or the payload
    # re-serialises to the same bytes and the signature legitimately still
    # matches — which would be a test proving nothing.
    ck("the lease under test grants full access", payload["access"] == "full")
    for field, value in (("school_id", kofi["school_id"]),
                         ("access", "read_only"),
                         ("status", "SUSPENDED"),
                         ("device", "some-other-pc"),
                         ("build", "a-modified-build"),
                         ("not_after", "2099-01-01T00:00:00+00:00")):
        edited = dict(payload)
        edited[field] = value
        raw = json.dumps(edited, sort_keys=True, separators=(",", ":")).encode()
        token = base64.urlsafe_b64encode(raw).decode().rstrip("=") + "." + signature
        ck(f"a lease with {field} rewritten does not verify",
           not licence_lib.read(token).get("ok"))
        ck(f"...and rewriting {field} really did change the bytes",
           raw != base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))

    # The device token is the credential; a deactivated one must die at once.
    key = {"x-school-key": activated["device_token"]}
    ck("an activated device can renew", client.post(
        "/api/v1/licence", headers=key, json={"device": "ave-pc"}).status_code == 200)
    row = [d for d in device_lib.list_devices(repo, ave["school_id"])
           if d["device_id"] == "ave-pc"][0]
    client.request("DELETE", f'/api/v1/school/billing/devices/{row["id"]}',
                   headers=ave["headers"])
    ck("...and cannot the moment it is deactivated",
       client.post("/api/v1/licence", headers=key,
                   json={"device": "ave-pc"}).status_code == 401)

    # ══ 4. Injection, through the doors that take names ═════════════════
    print("\nInjection")

    ck("a column name is not something a caller can choose",
       _raises(lambda: SchoolDb.assignments(["surname", "x = 1; DROP TABLE students--"])))
    ck("...nor a quoted one", _raises(lambda: SchoolDb.assignments(['a"b'])))
    ck("...nor an empty set", _raises(lambda: SchoolDb.assignments([])))

    # A school name is used to build a Postgres schema identifier.
    nasty = client.post("/api/v1/public/register", json={
        "school_name": 'Bobby"; DROP SCHEMA public CASCADE; --',
        "full_name": "Bobby", "email": f"bobby-{uuid.uuid4().hex[:6]}@x.test",
        "password": "a-long-enough-password", "students": 10})
    ck("a school named after an injection is enrolled safely",
       nasty.status_code == 200 and nasty.json().get("ok"), nasty.status_code)
    if nasty.status_code == 200:
        ck("...under a sanitised identifier",
           all(c.isalnum() or c in "-_" for c in nasty.json()["school_id"]),
           nasty.json()["school_id"])
        ck("...and the database is still there",
           client.get("/api/v1/public/plans").status_code == 200)

    # ══ 5. What the public endpoints give away ══════════════════════════
    print("\nWhat is given away")

    unknown = client.post("/api/v1/public/login", json={
        "email": "nobody@nowhere.test", "password": "a-long-enough-password"})
    wrong = client.post("/api/v1/public/login", json={
        "email": ave["email"], "password": "wrong-but-long-enough"})
    ck("an unknown address and a wrong password answer alike",
       unknown.status_code == wrong.status_code
       and unknown.json().get("error") == wrong.json().get("error"),
       (unknown.json().get("error"), wrong.json().get("error")))

    checked = client.get(f'/api/v1/verify/{drawn["seals"][1]["serial"]}').json()
    ck("verifying a receipt says nothing about the pupil or the money",
       not (set(checked) & {"amount", "student", "student_id", "reference", "paid"}),
       sorted(checked))

    ck("a made-up verification code is refused by shape, before a lookup",
       not seal_lib.valid_code("NE-AAAA-AAAA-Z"))

    # ══ 6. Throttling ═══════════════════════════════════════════════════
    print("\nThrottling")
    ratelimit.reset()
    codes = [client.post("/api/v1/public/login", json={
        "email": ave["email"], "password": f"wrong-{n}"}).status_code
        for n in range(30)]
    ck("guessing a password is throttled", 429 in codes, codes[-1])
    ratelimit.reset()
    codes = [client.post("/api/v1/activate", json={
        "email": ave["email"], "password": f"wrong-{n}", "device": f"d{n}"}).status_code
        for n in range(30)]
    ck("...and so is guessing at the activation door", 429 in codes, codes[-1])
    ratelimit.reset()

    # ══ 7. Headers a browser needs ══════════════════════════════════════
    print("\nHeaders")
    head = client.get("/api/v1/health").headers
    ck("the console cannot be framed", head.get("X-Frame-Options") == "DENY")
    ck("...by modern browsers either",
       "frame-ancestors 'none'" in (head.get("Content-Security-Policy") or ""))
    ck("nothing is MIME-sniffed", head.get("X-Content-Type-Options") == "nosniff")
    ck("a school's address is not leaked onward",
       (head.get("Referrer-Policy") or "").startswith("strict-origin"))
    ck("HSTS is set behind TLS and not on plain http",
       client.get("/api/v1/health", headers={"x-forwarded-proto": "https"})
       .headers.get("Strict-Transport-Security")
       and not head.get("Strict-Transport-Security"))

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


def _raises(fn):
    try:
        fn()
        return False
    except Exception:
        return True


if __name__ == "__main__":
    sys.exit(main())
