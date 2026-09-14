"""The platform as one product — registration, the shared sign-in, enforcement.

    DATABASE_URL=... ALLOW_DEV_SECRET=1 \
        python3 cloud-python/tests/test_saas.py

This one needs Postgres and says so rather than pretending: everything it
checks happens across the boundary between the platform's tables and a school's
own schema, and a store with no schemas underneath cannot exercise any of it.

The three claims it is here to defend, from §17, §18, §24 and §29:

  1. **One account.** A school registers on the website and is signed in to the
     cloud application with the same credential. No second account, no second
     password, no second sign-in.
  2. **One tenant, isolated.** A school's billing is its own. A token from one
     school presented against another's billing reaches nothing, and a
     guessable invoice id does not leak an invoice.
  3. **The fence is the backend.** Feature entitlement and subscription status
     are enforced at the API, not in the interface. A plan without Payroll
     refuses Payroll to a head teacher who has every permission in the school.

It also exercises the Postgres repository against the same assertions the
in-memory one passes in `test_billing.py`, because "the tests pass on memory
and production does something else" is the failure the repository layer exists
to prevent.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ["PLATFORM_ADMIN_KEY"] = "pk_test_" + ("x" * 32)
os.environ.setdefault("PORTAL_BASE_DOMAIN", "edusoft.gh")
os.environ["EDUSOFT_QUIET_BOOT"] = "1"

from fastapi.testclient import TestClient                       # noqa: E402

from app import ratelimit                                        # noqa: E402
from app.billing import adjustments, entitlements               # noqa: E402
from app.billing import invoices as invoice_lib                 # noqa: E402
from app.billing import plans as plan_lib                       # noqa: E402
from app.billing import repo as repo_lib                        # noqa: E402
from app.billing import subscriptions as subs                   # noqa: E402
from app.main import create_app                                 # noqa: E402
from app.school import db as sdb, session as school_session     # noqa: E402
from app.store import create_store                              # noqa: E402

KEY = os.environ["PLATFORM_ADMIN_KEY"]
passed = failed = 0
made = []


def ck(name, condition, extra=None):
    global passed, failed
    condition = bool(condition)
    passed += condition
    failed += (not condition)
    print(("✓" if condition else "✗") + " " + name)
    if not condition and extra is not None:
        print("    " + repr(extra))


def register(client, suffix, plan_id="pro", **extra):
    """A school, registered exactly as the website registers one."""
    body = {
        "school_name": f"Test {suffix.title()} School {uuid.uuid4().hex[:5]}",
        "full_name": "Ama Mensah",
        "email": f"{suffix}-{uuid.uuid4().hex[:6]}@example.test",
        "password": "a-good-enough-password",
        "plan_id": plan_id,
    }
    body.update(extra)
    response = client.post("/api/v1/public/register", json=body)
    result = response.json()
    if result.get("ok"):
        made.append(result["school_id"])
    return body, result


def main():
    if not os.environ.get("DATABASE_URL"):
        print("DATABASE_URL is not set — this suite needs Postgres.")
        return 1

    store = create_store()
    client = TestClient(create_app(store), raise_server_exceptions=False)
    repo = repo_lib.repo_for(store)
    ratelimit.reset()
    school_session.reset_throttle()

    try:
        return run(client, store, repo)
    finally:
        for school_id in made:
            try:
                sdb.drop(school_id)
            except Exception:
                pass
            try:
                store._q("DELETE FROM subscription_events WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM subscriptions WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM invoice_items WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM invoices WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM platform_payments WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM school_discounts WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM payment_exemptions WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM payment_methods WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM usage_snapshots WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM platform_identities WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM schools WHERE school_id = %s", (school_id,))
            except Exception:
                pass


def run(client, store, repo):
    # ══ The Postgres repository answers like the in-memory one ══════════
    print("\nThe repository, against a real database")
    marker = "zz-repo-" + uuid.uuid4().hex[:8]
    row = repo.insert("usage_snapshots", {
        "school_id": marker, "billable_students": 42, "total_students": 50,
        "plan_id": "pro", "detail": {"source": "test"}})
    ck("a row comes back with its generated id", isinstance(row["id"], int))
    ck("...money and counts as numbers", row["billable_students"] == 42)
    ck("...a JSON column as a dict", row["detail"] == {"source": "test"})
    ck("...and a timestamp as an ISO string, not a datetime",
       isinstance(row["captured_at"], str) and "T" in row["captured_at"])
    ck("it is found by an equality filter",
       len(repo.find("usage_snapshots", {"school_id": marker})) == 1)
    ck("...and by a comparison",
       len(repo.find("usage_snapshots",
                     {"school_id": marker, "billable_students": (">", 40)})) == 1)
    ck("...and an IN list",
       len(repo.find("usage_snapshots", {"school_id": ("in", [marker, "nobody"])})) == 1)
    ck("an empty IN list matches nothing rather than failing",
       repo.find("usage_snapshots", {"school_id": ("in", [])}) == [])
    ck("an unknown column is refused rather than interpolated",
       _raises(lambda: repo.find("usage_snapshots", {"school_id; DROP TABLE x": 1})))
    ck("...including as an ordering",
       _raises(lambda: repo.find("usage_snapshots", order_by="1; DROP TABLE x")))
    repo.update("usage_snapshots", row["id"], {"billable_students": 43})
    ck("an update is applied", repo.get("usage_snapshots", row["id"])["billable_students"] == 43)
    repo.delete("usage_snapshots", row["id"])
    ck("...and a delete removes it", repo.get("usage_snapshots", row["id"]) is None)

    # ══ Registration ════════════════════════════════════════════════════
    print("\nRegistering a school from the public website")
    submitted, result = register(client, "ave")
    ck("a school can be registered", result.get("ok"), result)
    school_id = result["school_id"]
    ck("...and gets a readable address", school_id and " " not in school_id, school_id)
    ck("...under the platform's domain", (result.get("portal_host") or "").endswith(".edusoft.gh"))
    ck("...with its own database", sdb.SchoolDb(school_id).exists())
    ck("...enrolled in the registry", store.get_school(school_id) is not None)
    ck("...holding a sync key, shown once", bool(result.get("sync_key")))
    ck("...on a trial", result.get("trial") and result["subscription"]["status"] == subs.TRIALING)
    ck("...with a trial end date", bool(result.get("trial_ends_at")))
    ck("...and the school's own name inside its own database",
       sdb.SchoolDb(school_id).get_setting("school_name") == submitted["school_name"])

    print("\nOne account, not two")
    token = result["token"]
    ck("registration hands back a session", bool(token))
    me = client.get("/api/v1/school/me", headers={"authorization": "Bearer " + token})
    ck("...that opens the cloud application immediately", me.status_code == 200, me.text)
    ck("...as the person who registered",
       me.json()["user"]["full_name"] == submitted["full_name"])
    ck("...as a Super Admin", me.json()["designation"] == "Super Admin")
    ck("...without being asked to change the password they just chose",
       me.json()["must_change_password"] is False)
    ck("...and the app is told what the school's plan entitles it to",
       me.json()["entitlement"]["plan_id"] == "pro")

    signed_in = client.post("/api/v1/public/login",
                            json={"email": submitted["email"], "password": submitted["password"]})
    ck("the same email and password sign in again from the website",
       signed_in.status_code == 200 and signed_in.json()["ok"], signed_in.text)
    ck("...routed to the right school without being told which",
       signed_in.json()["school_id"] == school_id)
    ck("...and handed the cloud application's own credential",
       signed_in.json()["token"].startswith(school_id + "."))
    ck("...and where to go with it", signed_in.json()["app_url"].endswith(".edusoft.gh"))

    wrong = client.post("/api/v1/public/login",
                        json={"email": submitted["email"], "password": "not-it"})
    ck("a wrong password is refused", wrong.status_code == 401)
    ratelimit.reset()
    school_session.reset_throttle()

    duplicate = client.post("/api/v1/public/register", json={**submitted,
                                                             "school_name": "Another School"})
    ck("the same email cannot register a second school by accident",
       duplicate.status_code == 409, duplicate.status_code)

    print("\nWhat a registration will not accept")
    for label, patch, expect in (
        ("a school with no name", {"school_name": " "}, 400),
        ("an address that is not one", {"email": "not-an-email"}, 400),
        ("a password anybody could guess in a day", {"password": "short"}, 400),
        ("a plan that does not exist", {"plan_id": "platinum"}, 400),
    ):
        body = {**submitted, "email": f"x{uuid.uuid4().hex[:8]}@example.test", **patch}
        response = client.post("/api/v1/public/register", json=body)
        ck(f"...{label}", response.status_code == expect, response.status_code)

    # ══ The school's own billing page ═══════════════════════════════════
    print("\nA school's own billing section")
    headers = {"authorization": "Bearer " + token}
    billing_page = client.get("/api/v1/school/billing", headers=headers)
    ck("the school can open it", billing_page.status_code == 200, billing_page.text)
    page = billing_page.json()
    for key in ("plan", "subscription", "usage", "quote", "lines", "invoices",
                "payment_methods", "next_billing_date", "discount", "exemption"):
        ck(f"...it says its {key.replace('_', ' ')}", key in page)
    ck("...and whether this person may change the subscription", page["can_manage"] is True)
    ck("...and what the trial is doing", page["trial"] and page["trial"]["days_left"] >= 0)

    other_submitted, other = register(client, "johns")
    other_id, other_token = other["school_id"], other["token"]
    ck("a second school registers with its own id", other_id != school_id)

    adjustments.grant_discount(store, repo, school_id,
                               {"kind": "percent", "value": 20, "label": "Founding"})
    entitlements.invalidate(school_id)
    mine = client.get("/api/v1/school/billing", headers=headers).json()
    theirs = client.get("/api/v1/school/billing",
                        headers={"authorization": "Bearer " + other_token}).json()
    ck("a discount shows on the school it was granted to",
       mine["discount"] and mine["discount"]["value"] == 20.0)
    ck("...and not on anybody else's billing page", theirs["discount"] is None)
    ck("...and each school sees only its own invoices",
       all(i["school_id"] == other_id for i in theirs["invoices"]))

    invoice = invoice_lib.raise_invoice(store, repo, school_id, actor="test")["invoice"]
    ck("an invoice raised for one school is readable by that school",
       client.get(f"/api/v1/school/billing/invoices/{invoice['id']}",
                  headers=headers).status_code == 200)
    ck("...and not by another, even with its id in hand",
       client.get(f"/api/v1/school/billing/invoices/{invoice['id']}",
                  headers={"authorization": "Bearer " + other_token}).status_code == 404)
    ck("a token from one school does not open another's billing at all",
       client.get("/api/v1/school/billing",
                  headers={"authorization": "Bearer " + school_id + ".not-a-token"}
                  ).status_code == 401)

    # ══ Enforcement ═════════════════════════════════════════════════════
    print("\nThe fence is the backend, not the interface")
    subs.change_plan(store, repo, school_id, "free", actor="test")
    entitlements.invalidate(school_id)
    ck("a school on Free may still open Students",
       client.get("/api/v1/school/students", headers=headers).status_code == 200)
    refused = client.get("/api/v1/school/payroll", headers=headers)
    ck("...and may not open Payroll, which Free does not include",
       refused.status_code == 403, refused.status_code)
    ck("...with an answer the app can act on",
       refused.json().get("upgrade_required") is True, refused.json())
    ck("...and one a person can read",
       "plan" in refused.json().get("error", "").lower(), refused.json().get("error"))

    plan_lib.set_plan_feature(repo, "free", "payroll", True)
    entitlements.invalidate(school_id)
    ck("moving Payroll onto Free opens it for every school on Free, at once",
       client.get("/api/v1/school/payroll", headers=headers).status_code == 200)
    plan_lib.set_plan_feature(repo, "free", "payroll", False)
    entitlements.invalidate(school_id)

    print("\nA suspended school keeps everything and can do nothing")
    subs.suspend(store, repo, school_id, actor="test", reason="Test")
    entitlements.invalidate(school_id)
    ck("it can still read its own pupils",
       client.get("/api/v1/school/students", headers=headers).status_code == 200)
    blocked = client.post("/api/v1/school/students",
                          headers=headers, json={"surname": "Test", "first_name": "Pupil"})
    ck("...and cannot add one", blocked.status_code == 402, blocked.status_code)
    ck("...with the reason said plainly",
       blocked.json().get("subscription_required") is True, blocked.json())
    ck("...and its billing page still opens, so it can settle",
       client.get("/api/v1/school/billing", headers=headers).status_code == 200)
    ck("...and /me still answers, so the app can draw the notice",
       client.get("/api/v1/school/me", headers=headers).status_code == 200)

    subs.mark_paid(store, repo, subs.current(repo, school_id), actor="test")
    entitlements.invalidate(school_id)
    ck("paying restores it at once",
       client.post("/api/v1/school/students", headers=headers,
                   json={"surname": "Test", "first_name": "Pupil"}).status_code == 200)

    print("\nA school that was here before any of this keeps working")
    legacy = "legacy-" + uuid.uuid4().hex[:8]
    sdb.provision(legacy)
    made.append(legacy)
    store.create_school(name="Legacy School", school_id=legacy)
    entitlements.invalidate(legacy)
    entitlement = entitlements.for_school(store, legacy, fresh=True)
    ck("it has no subscription", subs.current(repo, legacy) is None)
    ck("...and full access anyway", entitlement["access"] == "full")
    ck("...to every module", entitlements.check(entitlement, "payroll", "edit") is None)

    print("\nUsage is counted from the school's own database")
    counted = client.get("/api/v1/school/billing/usage", headers=headers).json()
    ck("the roll is read from the school's own tables",
       counted["now"]["source"] == "database", counted["now"])
    ck("...and only billable pupils are counted",
       counted["billable_statuses"] == ["Active"], counted["billable_statuses"])
    before = counted["now"]["billable_students"]
    db = sdb.SchoolDb(school_id)
    db.insert("students", {"surname": "Left", "first_name": "Pupil", "status": "Withdrawn"})
    after = client.get("/api/v1/school/billing/usage", headers=headers).json()
    ck("a withdrawn pupil is in the school's database and is not billed for",
       after["now"]["billable_students"] == before
       and after["now"]["total_students"] > counted["now"]["total_students"], after["now"])

    # ══ The console over a real platform ════════════════════════════════
    print("\nThe console, over a real platform")
    ops = {"x-platform-key": KEY}
    schools = client.get("/api/v1/admin/schools", headers=ops).json()["schools"]
    listed = {s["school_id"]: s for s in schools}
    ck("both registered schools are listed", school_id in listed and other_id in listed)
    ck("...with their pupil counts", listed[school_id]["students"] >= 0)
    ck("...and their adjustments", listed[school_id]["has_discount"] is True)

    detail = client.get(f"/api/v1/admin/schools/{school_id}", headers=ops)
    ck("one school opens", detail.status_code == 200, detail.text)
    body = detail.json()
    ck("...showing who administers it",
       any(a["email"] == submitted["email"] for a in body["administrators"]))
    ck("...its usage, invoices, discounts and events",
       all(k in body for k in ("usage", "invoices", "discounts", "exemptions", "events")))
    ck("...and never its pupils' records",
       "students" not in body and "pupils" not in body)

    ck("the console can suspend a school",
       client.post(f"/api/v1/admin/schools/{school_id}/lifecycle", headers=ops,
                   json={"action": "suspend", "reason": "Test"}).json()["ok"])
    entitlements.invalidate(school_id)
    ck("...and the school feels it immediately",
       client.post("/api/v1/school/students", headers=headers,
                   json={"surname": "X", "first_name": "Y"}).status_code == 402)
    ck("the console can reactivate it",
       client.post(f"/api/v1/admin/schools/{school_id}/lifecycle", headers=ops,
                   json={"action": "reactivate"}).json()["ok"])
    entitlements.invalidate(school_id)
    ck("...and the school is back",
       client.post("/api/v1/school/students", headers=headers,
                   json={"surname": "X", "first_name": "Y"}).status_code == 200)

    run_report = client.post("/api/v1/admin/billing-run", headers=ops, json={}).json()
    ck("the billing run can be started by hand", run_report["ok"], run_report)
    ck("...and reports what it did",
       all(k in run_report["report"] for k in ("invoiced", "exempt", "advanced", "aged", "errors")))

    print("\nWhere the three interfaces are served from")
    ck("the console answers on admin.<domain>",
       b"Superadmin" in client.get("/", headers={"host": "admin.edusoft.gh"}).content)
    ck("the website answers on www.<domain>",
       b"Register your school" in client.get("/", headers={"host": "www.edusoft.gh"}).content)
    ck("...and on the bare domain",
       b"Register your school" in client.get("/", headers={"host": "edusoft.gh"}).content)
    ck("a school's own address gets the application, not the marketing site",
       b"Register your school" not in client.get(
           "/", headers={"host": f"{school_id}.edusoft.gh"}).content)
    ck("the console is also reachable by path, for a one-hostname deployment",
       b"Superadmin" in client.get("/console").content)
    ck("...as is the website", b"Register your school" in client.get("/welcome").content)
    ck("the API answers the same on every one of them",
       client.get("/api/v1/public/plans", headers={"host": "admin.edusoft.gh"}).json()["ok"]
       and client.get("/api/v1/public/plans", headers={"host": "www.edusoft.gh"}).json()["ok"])

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


def _raises(call):
    try:
        call()
        return False
    except Exception:
        return True


if __name__ == "__main__":
    sys.exit(main())
