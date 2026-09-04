"""Money coming in from outside the school.

    DATABASE_URL=... python3 cloud-python/tests/test_payments.py

The checkout is easy to write and easy to get wrong, so nearly everything here
is a refusal: an unsigned webhook, a wrongly signed one, another family's
child, a figure larger than the bill, a declaration with no reference, and the
same reference declared twice.

The gateway itself is not called. A fake HTTP layer stands in for it, which is
the point — the test is about what this service believes and when, not about
Paystack's uptime.
"""
import hashlib
import hmac
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ.setdefault("ALLOW_MEMORY_STORE", "1")

from fastapi.testclient import TestClient          # noqa: E402

from app import ratelimit                          # noqa: E402
from app.main import create_app                    # noqa: E402
from app.school import db as sdb, parents, payments, session  # noqa: E402

PASS = FAIL = 0
SECRET = "sk_test_supersecret"


def ck(name, condition):
    global PASS, FAIL
    if condition:
        PASS += 1
        print("✓ " + name)
    else:
        FAIL += 1
        print("✗ " + name)


# ── a gateway that does what we tell it ─────────────────────────────────────
# Substituted for the real HTTP call so the test can say "the gateway confirms
# 200" or "the gateway says it never happened" and check what the service does
# with each answer.
GATEWAY = {"paid": True, "amount": 200.0, "initialize_ok": True}
STARTED = []


def fake_http(url, method="GET", headers=None, body=None, timeout=20):
    if "/transaction/initialize" in url:
        if not GATEWAY["initialize_ok"]:
            return {"status": 400, "json": {"status": False, "message": "declined"}}
        STARTED.append(body)
        return {"status": 200, "json": {"status": True, "data": {
            "authorization_url": "https://checkout.example/x",
            "reference": body["reference"]}}}
    if "/transaction/verify/" in url:
        return {"status": 200, "json": {"data": {
            "status": "success" if GATEWAY["paid"] else "abandoned",
            # The gateway's figure, deliberately different from the one asked
            # for, so the test can prove which one reaches the books.
            "amount": int(GATEWAY["amount"] * 100), "currency": "GHS"}}}
    return {"status": 404, "json": {}}


def main():
    if not os.environ.get("DATABASE_URL"):
        print("DATABASE_URL is not set — the online system needs Postgres.")
        return 1

    payments._http_json = fake_http

    school_id = "p" + uuid.uuid4().hex[:10]
    sdb.provision(school_id)
    db = sdb.SchoolDb(school_id)
    client = TestClient(create_app())
    # A clean throttle, so a test that grows does not start failing on the
    # limit rather than on what it is checking.
    ratelimit.reset()

    # A school, a bursar, a pupil with a bill, and the pupil's mother.
    admin_id = db.insert("users", {
        "username": "adjei", "password_hash": session.hash_password("pass1234"),
        "full_name": "Ms Adjei", "is_active": 1,
        "designation_id": db.value("SELECT id FROM designations WHERE name = 'Super Admin'"),
    })
    b5 = db.value("SELECT id FROM class_groups WHERE short_code = 'BS5'")
    term = db.value("SELECT id FROM terms WHERE is_current = 1")
    mine = db.insert("students", {
        "index_number": "AVE/001", "surname": "ANSU", "first_name": "Monalisa",
        "current_class_id": b5, "status": "Active", "mother_contact": "0244111222",
        "mother_name": "Mrs Ansu",
    })
    theirs = db.insert("students", {
        "index_number": "AVE/002", "surname": "OTHER", "first_name": "Pupil",
        "current_class_id": b5, "status": "Active",
    })
    for sid in (mine, theirs):
        db.insert("student_bills", {"student_id": sid, "term_id": term, "total_billed": 600,
                                    "total_paid": 0, "balance": 600, "status": "active"})

    staff_token = client.post("/api/v1/school/signin", json={
        "school_id": school_id, "username": "adjei", "password": "pass1234"}).json()["token"]
    staff_auth = {"Authorization": "Bearer " + staff_token}

    # ── a parent registers against the record the school already holds ──────
    r = client.post("/api/v1/school/parent/register", json={
        "school_id": school_id, "full_name": "Mrs Ansu", "phone": "0244111222",
        "password": "parent1234"})
    ck("a parent registers because the school already has her number", r.json().get("linked") == 1)
    token = r.json()["token"]
    auth = {"Authorization": "Bearer " + token}

    r = client.post("/api/v1/school/parent/register", json={
        "school_id": school_id, "full_name": "Nobody", "phone": "0209999999",
        "password": "parent1234"})
    ck("...and somebody the school has never heard of cannot", r.status_code == 400)
    r = client.post("/api/v1/school/parent/register", json={
        "school_id": school_id, "full_name": "Mrs Ansu", "phone": "0244111222", "password": "1234"})
    ck("...and a four-character password is refused, which the offline system allows",
       r.status_code == 400)

    r = client.get("/api/v1/school/parent/children", headers=auth)
    ck("she sees her own child", len(r.json()["children"]) == 1)
    ck("...with the balance on it", r.json()["children"][0]["fees"]["balance"] == 600)
    r = client.get(f"/api/v1/school/parent/children/{theirs}", headers=auth)
    ck("...and not another family's", r.status_code == 403)

    r = client.get("/api/v1/school/parent/children", headers=staff_auth)
    ck("a staff token is not a parent token", r.status_code == 401)
    r = client.get("/api/v1/school/students", headers=auth)
    ck("...and a parent token opens nothing of the school's", r.status_code == 401)

    # ── a school with no gateway says so ────────────────────────────────────
    r = client.get(f"/api/v1/school/parent/children/{mine}/payment-options", headers=auth)
    ck("a school with no gateway offers its own channels instead",
       r.json()["online"]["available"] is False and r.json()["offline"]["declare"] is True)
    r = client.post(f"/api/v1/school/parent/children/{mine}/pay", headers=auth, json={"amount": 100})
    ck("...and refuses a checkout rather than starting one it cannot finish",
       r.status_code == 400)

    # ── a declaration is a message, not a payment ───────────────────────────
    before = db.value("SELECT count(*) FROM payments")
    r = client.post(f"/api/v1/school/parent/children/{mine}/declare-payment", headers=auth,
                    json={"amount": 150, "channel": "bank", "reference": "DEP-771"})
    ck("a parent can say they paid at the bank", r.json().get("ok"))
    ck("...and it posts nothing until the office confirms it",
       db.value("SELECT count(*) FROM payments") == before)
    ck("...and is filed as pending",
       db.value("SELECT count(*) FROM payment_intents WHERE status = 'pending'") == 1)
    r = client.post(f"/api/v1/school/parent/children/{mine}/declare-payment", headers=auth,
                    json={"amount": 150, "channel": "bank"})
    ck("a declaration with no reference is refused — the office must find it",
       r.status_code == 400)
    r = client.post(f"/api/v1/school/parent/children/{mine}/declare-payment", headers=auth,
                    json={"amount": 150, "channel": "bank", "reference": "DEP-771"})
    ck("...and the same reference twice is one declaration, not two",
       r.json().get("duplicate") is True)

    intent_id = db.value("SELECT id FROM payment_intents ORDER BY id DESC LIMIT 1")
    r = client.post(f"/api/v1/school/fees/online/{intent_id}/acknowledge", headers=staff_auth,
                    json={})
    ck("the office confirms it against the statement, and it becomes a receipt",
       r.json()["receipt_number"].startswith("FE/"))
    ck("...which reduces the bill",
       db.value("SELECT balance FROM student_bills WHERE student_id = %s AND term_id = %s",
                (mine, term)) == 450)

    # ── switching the gateway on ────────────────────────────────────────────
    client.post("/api/v1/school/system/settings", headers=staff_auth, json={"settings": {
        "paystack_secret_key": SECRET, "payment_gateway": "paystack",
        "online_payments_enabled": "true", "online_payment_max": "5000"}})
    r = client.get(f"/api/v1/school/parent/children/{mine}/payment-options", headers=auth)
    ck("with a gateway configured, the app is told it can pay",
       r.json()["online"]["available"] is True and r.json()["online"]["gateway"] == "paystack")
    ck("...and never sees the key", SECRET not in r.text)

    r = client.post(f"/api/v1/school/parent/children/{mine}/pay", headers=auth, json={"amount": 999999})
    ck("a figure past the school's ceiling is refused before the gateway is called",
       r.status_code == 400)
    r = client.post(f"/api/v1/school/parent/children/{mine}/pay", headers=auth, json={"amount": 4000})
    ck("...and so is one larger than the bill", r.status_code == 400)
    r = client.post(f"/api/v1/school/parent/children/{theirs}/pay", headers=auth, json={"amount": 100})
    ck("...and another family's child cannot be paid for at all", r.status_code == 403)

    r = client.post(f"/api/v1/school/parent/children/{mine}/pay", headers=auth, json={"amount": 200})
    ck("a checkout starts and hands back the gateway's own address",
       r.json()["authorization_url"].startswith("https://"))
    reference = r.json()["reference"]
    ck("...and nothing has been paid yet",
       db.value("SELECT status FROM payment_intents WHERE gateway_reference = %s",
                (reference,)) == "pending")

    # ── only a signed webhook may say it worked ─────────────────────────────
    body = json.dumps({"event": "charge.success", "data": {"reference": reference}})
    url = f"/api/v1/school/{school_id}/payments/webhook"
    r = client.post(url, content=body, headers={"Content-Type": "application/json"})
    ck("an unsigned webhook is not believed", r.status_code == 401)
    r = client.post(url, content=body, headers={"x-paystack-signature": "a" * 128})
    ck("a wrongly signed one is not believed either", r.status_code == 401)
    ck("...and both are recorded as security events",
       db.value("""SELECT count(*) FROM audit_log
                    WHERE action = 'webhook_rejected' AND severity = 'high'""") == 2)
    ck("...and nothing was settled",
       db.value("SELECT status FROM payment_intents WHERE gateway_reference = %s",
                (reference,)) == "pending")

    # The gateway confirms 175, not the 200 the phone asked for. The books must
    # record what the gateway confirmed.
    GATEWAY["amount"] = 175.0
    signature = hmac.new(SECRET.encode(), body.encode(), hashlib.sha512).hexdigest()
    r = client.post(url, content=body, headers={"x-paystack-signature": signature})
    ck("a correctly signed webhook settles the payment", r.status_code == 200)
    receipt = db.one("""SELECT p.amount, p.receipt_number, p.payment_method
                          FROM payments p JOIN payment_intents pi ON pi.payment_id = p.id
                         WHERE pi.gateway_reference = %s""", (reference,))
    ck("...and the books record the GATEWAY's figure, not the phone's",
       receipt and receipt["amount"] == 175.0)
    ck("...through the same receipt counter the counter uses",
       receipt["receipt_number"].startswith("FE/"))
    ck("...and the ledger has it once",
       db.value("""SELECT count(*) FROM income_records i JOIN payments p ON p.id = i.linked_payment_id
                    WHERE p.receipt_number = %s""", (receipt["receipt_number"],)) == 1)

    # ── a retried delivery is not a second payment ──────────────────────────
    payments_before = db.value("SELECT count(*) FROM payments")
    client.post(url, content=body, headers={"x-paystack-signature": signature})
    client.post(url, content=body, headers={"x-paystack-signature": signature})
    ck("a gateway retrying the delivery does not pay twice",
       db.value("SELECT count(*) FROM payments") == payments_before)
    r = client.get(f"/api/v1/school/parent/payments/{reference}", headers=auth)
    ck("...and a parent refreshing sees one receipt",
       r.json()["payment"]["status"] == "acknowledged" and r.json()["payment"]["receipt_number"])

    # ── a charge the gateway never confirmed ────────────────────────────────
    GATEWAY["paid"] = False
    r = client.post(f"/api/v1/school/parent/children/{mine}/pay", headers=auth, json={"amount": 50})
    abandoned = r.json()["reference"]
    r = client.get(f"/api/v1/school/parent/payments/{abandoned}", headers=auth)
    ck("an abandoned checkout stays pending however often it is polled",
       r.json()["payment"]["status"] == "pending")
    intent = db.value("SELECT id FROM payment_intents WHERE gateway_reference = %s", (abandoned,))
    r = client.post(f"/api/v1/school/fees/online/{intent}/verify", headers=staff_auth)
    ck("...and the office cannot settle it by pressing a button either",
       r.status_code != 200)

    r = client.post(f"/api/v1/school/fees/online/{intent}/acknowledge", headers=staff_auth, json={})
    ck("...nor by acknowledging it like a bank slip", r.status_code == 400)

    # ── a parent's session, revoked ─────────────────────────────────────────
    r = client.post("/api/v1/school/parent/password", headers=auth,
                    json={"current_password": "parent1234", "new_password": "newpass1234"})
    ck("a parent changes their own password", r.json().get("ok"))
    r = client.get("/api/v1/school/parent/children", headers=auth)
    ck("...and every device it was signed in on is signed out, including this one",
       r.status_code == 401)

    sdb.drop(school_id)
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
