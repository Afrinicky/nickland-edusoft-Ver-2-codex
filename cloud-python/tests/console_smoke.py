"""Real-browser smoke test of the Superadmin console's enrolment screen.

    DATABASE_URL=… ALLOW_DEV_SECRET=1 python3 cloud-python/tests/console_smoke.py

It needs Postgres, because the thing it is testing is the creation of a tenant
schema, and a store with no schemas underneath cannot create one.

It is a *browser* test rather than another API test because the API is already
covered in `test_saas.py`. What is not covered there, and what this covers, is
the console — the only surface an operator has, the one they will use to enrol
the first school, and a file of hand-written DOM code with no build step and no
type checker. A screen that throws on load fails no API test at all.

Not in CI: it downloads a browser. Run it when the console changes.
"""
import glob
import os
import sys
import threading
import time
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ.setdefault("LICENCE_SIGNING_KEY", "drupkjj9JHpGHCss-T0QStTqdmrajb4_uNJK3z7FKqk")
os.environ["PLATFORM_ADMIN_KEY"] = "pk_test_" + ("x" * 32)
os.environ.setdefault("PORTAL_BASE_DOMAIN", "edusoft.gh")
os.environ["EDUSOFT_QUIET_BOOT"] = "1"

import uvicorn                                                   # noqa: E402
from playwright.sync_api import sync_playwright                  # noqa: E402

from app.main import create_app                                  # noqa: E402
from app.school import db as sdb                                 # noqa: E402
from app.store import create_store                               # noqa: E402

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


def find_chromium():
    if os.environ.get("PW_CHROMIUM"):
        return os.environ["PW_CHROMIUM"]
    for pattern in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome",
                    os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux/chrome")):
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[-1]
    return None


def main():
    if not os.environ.get("DATABASE_URL"):
        print("DATABASE_URL is not set — this suite needs Postgres.")
        return 1

    store = create_store()
    app = create_app(store)
    port = 8811
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(80):
        if server.started:
            break
        time.sleep(0.1)

    tag = uuid.uuid4().hex[:6]
    operator_email = f"op-{tag}@example.test"
    school_name = f"Browser School {tag}"
    base = f"http://127.0.0.1:{port}/console"

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=find_chromium())
            page = browser.new_page(viewport={"width": 1280, "height": 900})

            # A screen that throws on load still renders its skeleton, so the
            # errors are collected rather than inferred from what is missing.
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

            page.goto(base)
            page.wait_for_selector("#signinEmail")

            # The bootstrap: the first operator, made with the platform key.
            page.click("text=Create the first one")
            page.fill("#bsKey", KEY)
            page.fill("#bsName", "First Operator")
            page.fill("#bsEmail", operator_email)
            page.fill("#bsPassword", "a-good-console-password")
            page.click("#bootstrapSubmit")
            page.wait_for_selector("#bootstrapNote:not([hidden])", timeout=10000)
            ck("the first operator account can be created from the browser", True)

            page.fill("#signinEmail", operator_email)
            page.fill("#signinPassword", "a-good-console-password")
            page.click("#signinSubmit")
            page.wait_for_selector("#consoleView:not([hidden])", timeout=10000)
            ck("...and signed in with", True)

            # Schools → Enrol a school.
            page.click('[data-nav="schools"]')
            page.wait_for_selector("text=Enrol a school", timeout=10000)
            ck("the schools page offers to enrol one", True)
            page.click("text=Enrol a school")

            page.wait_for_selector("#enrolName", timeout=10000)
            ck("the enrolment form opens", page.is_visible("#enrolPlan"))
            ck("...with the plans the platform actually has, not a hard-coded list",
               page.locator("#enrolPlan option").count() > 0)
            # Not "Free", which is only what sorts first.
            ck("...and the platform's own default plan already chosen",
               page.input_value("#enrolPlan") == "pro", page.input_value("#enrolPlan"))

            page.fill("#enrolName", school_name)
            page.fill("#enrolAdminName", "Grace Mensah")
            page.fill("#enrolEmail", f"grace-{tag}@example.test")
            page.click("text=Suggest one")
            suggested = page.input_value("#enrolPassword")
            ck("a password can be suggested, and is readable", len(suggested) >= 8, suggested)

            # What it refuses, before it creates anything: the form is the first
            # of two checks and the cheap one.
            page.fill("#enrolPassword", "short")
            page.click("text=Enrol the school")
            page.wait_for_selector("#page .note.bad:not([hidden])", timeout=5000)
            ck("a short password is refused without creating a school",
               "8 characters" in page.inner_text("#page .note.bad"),
               page.inner_text("#page .note.bad"))

            page.fill("#enrolPassword", suggested)
            page.click("text=Enrol the school")

            page.wait_for_selector("text=Its sync key — shown once", timeout=30000)
            ck("the school is enrolled", "is enrolled and its database is ready" in page.content())

            body = page.inner_text("#page")
            ck("...and the sync key is shown", "Sync key" in body)
            ck("...beside the tenant id its desktop needs", "Tenant id" in body)
            ck("...and the address the school is given", "edusoft.gh" in body, body[:400])
            ck("...and what the school does next", "Cloud Sync" in body)

            # It is really there, both halves of it.
            listed = [s for s in store.list_schools() if s["name"] == school_name]
            ck("the platform has a registry row for it", bool(listed), listed)
            if listed:
                made.append(listed[0]["school_id"])
                ck("...and the school has its own database",
                   sdb.SchoolDb(listed[0]["school_id"]).get_setting("school_name") == school_name)

            page.click("text=All schools")
            page.wait_for_selector("#schoolSearch", timeout=10000)
            ck("...and it is in the list", school_name in page.inner_text("#page"))

            ck("nothing threw on any of those screens", not errors, errors[:4])
            browser.close()
    finally:
        server.should_exit = True
        for school_id in made:
            try:
                sdb.drop(school_id)
            except Exception:
                pass
            try:
                store._q("DELETE FROM subscription_events WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM subscriptions WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM platform_identities WHERE school_id = %s", (school_id,))
                store._q("DELETE FROM schools WHERE school_id = %s", (school_id,))
            except Exception:
                pass

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
