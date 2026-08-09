"""Real-browser smoke test of the parent portal SPA (Chromium via Playwright).
Boots the FastAPI app in-process, seeds a tenant + parent + child + receipt,
then drives the actual UI: login -> child detail -> receipts -> account edit."""
import glob
import os
import sys
import threading
import time


def find_chromium():
    if os.environ.get("PW_CHROMIUM"):
        return os.environ["PW_CHROMIUM"]
    for pat in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome",
                os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux/chrome")):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return None  # let Playwright use its own download

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import uvicorn
from playwright.sync_api import sync_playwright
from app.main import create_app
from app.store import MemoryStore
from app import portal_auth as pauth

passed = failed = 0
def ck(name, cond):
    global passed, failed
    cond = bool(cond); passed += cond; failed += (not cond)
    print(("✓" if cond else "✗") + " " + name)

def main():
    store = MemoryStore()
    sch = store.create_school(name="Ave Maria School")
    sid = sch["school_id"]
    store.upsert_snapshot(sid, {"entity_type": "parent_auth", "entity_key": "parent:1", "uuid": "u1", "version": 1,
        "payload": {"parent_id": 1, "full_name": "Papa", "phone": "233244123456", "email": "papa@mail.com",
                    "password_hash": pauth.hash_password("pass12"), "is_active": 1, "student_keys": ["student:1"]}})
    store.upsert_snapshot(sid, {"entity_type": "student_snapshot", "entity_key": "student:1", "uuid": "u2", "version": 1,
        "payload": {"student_id": 1, "name": "ANSU MONALISA", "index_number": "AVE/17/00001", "class_name": "Basic 5",
                    "term": "Third Term", "fees": {"billed": 410, "paid": 150, "balance": 260},
                    "canteen": {"unpaid_days": 3, "amount_owed": 15},
                    "attendance": {"present": 40, "absent": 2, "total": 42},
                    "report": {"term": "Third Term", "subjects": [{"subject": "Mathematics", "total": 82, "grade": "Advanced"}],
                               "average": 78.5, "rank": 3, "number_on_roll": 30, "remarks": "Excellent term"},
                    "updated_at": "2026-07-30T00:00:00Z"}})
    store.upsert_snapshot(sid, {"entity_type": "receipt", "entity_key": "receipt:FE/26/00001", "uuid": "u3", "version": 1,
        "payload": {"receipt_number": "FE/26/00001", "student_id": 1, "amount": 150, "payment_method": "Cash", "date": "2026-07-30"}})

    app = create_app(store)
    port = 8799
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True); t.start()
    for _ in range(40):
        if server.started: break
        time.sleep(0.1)

    base = f"http://127.0.0.1:{port}/"
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=find_chromium())
            page = browser.new_page(viewport={"width": 390, "height": 780})
            page.goto(base)

            page.wait_for_selector("#school")
            ck("login screen renders", "Parent Portal" in page.content())
            page.select_option("#school", sid)
            page.fill("#ident", "0244123456")
            page.fill("#pw", "pass12")
            page.click("text=Sign in")

            page.wait_for_selector("text=Total outstanding", timeout=5000)
            ck("home shows outstanding total", "GHS 275.00" in page.content())  # 260 fees + 15 canteen
            ck("home lists the child", "ANSU MONALISA" in page.content())

            page.click("text=ANSU MONALISA")
            page.wait_for_selector("text=School fees", timeout=5000)
            ck("child detail shows fees balance", "GHS 260.00" in page.content())
            ck("child detail shows attendance rate", "Attendance" in page.content() and "95%" in page.content())  # 40/42
            ck("child detail shows performance", "Performance" in page.content() and "Mathematics" in page.content() and "Excellent term" in page.content())
            ck("child detail shows receipt", "FE/26/00001" in page.content())

            page.click("#backBtn")
            page.wait_for_selector("text=Total outstanding")
            page.click("text=Account & details")
            page.wait_for_selector("#pname", timeout=5000)
            page.fill("#pname", "Papa Ansu")
            page.click("text=Save changes")
            page.wait_for_selector("text=Saved", timeout=5000)
            ck("account edit saves", "Saved" in page.content())
            ck("desktop change queued", any(c["type"] == "parent_update" and c["payload"].get("full_name") == "Papa Ansu"
                                            for c in store.changes_since(sid, "0")["changes"]))
            browser.close()
    finally:
        server.should_exit = True

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
