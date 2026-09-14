"""The subscription and billing engine — what a school is charged, and why.

    DATABASE_URL=... ALLOW_DEV_SECRET=1 ALLOW_MEMORY_STORE=1 \
        python3 cloud-python/tests/test_billing.py

Most of it runs on the in-memory store, because the arithmetic, the lifecycle
and the entitlement rules have nothing to do with which database is underneath.
The parts that genuinely need Postgres — registering a school, which creates a
tenant schema, and the enforcement that happens inside one — are skipped where
there is none, exactly as the other suites do.

What this guards, in order of how expensive it would be to get wrong:

  1. **An exemption is not a discount.** They are separate figures on the
     invoice, separate lines in the revenue report, and an exempt school is
     never counted as a school that has not paid.
  2. **An invoice does not move.** Repricing a plan in March must not change
     what January's invoice says.
  3. **Nobody is billed twice.** One subscription per school, one invoice per
     period, one settlement per provider reference.
  4. **Nobody is locked out by our mistakes.** A school that has never had a
     subscription keeps working; a platform whose billing tables cannot be
     read lets everybody in rather than nobody.
  5. **The fence is the backend.** A plan that does not include Payroll refuses
     Payroll, whatever the app draws.
"""
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ.setdefault("ALLOW_MEMORY_STORE", "1")
os.environ["PLATFORM_ADMIN_KEY"] = "pk_test_" + ("x" * 32)
os.environ.setdefault("PORTAL_BASE_DOMAIN", "edusoft.gh")
os.environ["EDUSOFT_QUIET_BOOT"] = "1"

from fastapi.testclient import TestClient                       # noqa: E402

from app import billing                                          # noqa: E402
from app import ratelimit                                        # noqa: E402
from app.billing import adjustments, defaults, engine            # noqa: E402
from app.billing import entitlements, invoices as invoice_lib    # noqa: E402
from app.billing import plans as plan_lib                        # noqa: E402
from app.billing import provider as billing_provider             # noqa: E402
from app.billing import repo as repo_lib                         # noqa: E402
from app.billing import settings as platform_settings            # noqa: E402
from app.billing import subscriptions as subs                    # noqa: E402
from app.main import create_app                                  # noqa: E402
from app.store import MemoryStore                                # noqa: E402

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


def platform(schools=("ave-maria",)):
    """A store with the defaults seeded and some schools enrolled."""
    store = MemoryStore()
    billing.bootstrap(store)
    for school_id in schools:
        store.create_school(name=school_id.replace("-", " ").title(), school_id=school_id)
    entitlements.invalidate()
    platform_settings.invalidate()
    return store, repo_lib.repo_for(store)


def main():
    # ══ The tables and the spec agree ═══════════════════════════════════
    print("\nThe repository's table spec against the SQL that creates them")
    sql_path = os.path.join(os.path.dirname(__file__), "..", "schema-saas.sql")
    with open(sql_path, encoding="utf-8") as handle:
        sql = handle.read()

    def columns_in(table):
        match = re.search(r"CREATE TABLE IF NOT EXISTS " + table + r"\s*\((.*?)\n\);",
                          sql, re.S)
        if not match:
            return None
        found = []
        for line in match.group(1).splitlines():
            line = line.strip()
            if not line or line.startswith("--"):
                continue
            if re.match(r"(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b", line, re.I):
                continue
            name = line.split()[0].strip('"')
            if name:
                found.append(name)
        return found

    mismatched = []
    for name, table in repo_lib.TABLES.items():
        declared = columns_in(name)
        if declared is None:
            continue                    # `schools` columns come from schema.sql
        if sorted(declared) != sorted(table.columns):
            mismatched.append((name, sorted(set(declared) ^ set(table.columns))))
    ck("every billing table's columns match its spec exactly", not mismatched, mismatched)
    ck("...and there are tables to check", len(repo_lib.TABLES) >= 14, len(repo_lib.TABLES))

    # ══ What a fresh platform opens on ══════════════════════════════════
    print("\nWhat a fresh platform opens on")
    store, repo = platform()
    ck("three plans are seeded", len(plan_lib.list_plans(repo)) == 3)
    ck("...and seeding twice does not duplicate them",
       (billing.bootstrap(store), len(plan_lib.list_plans(repo)))[1] == 3)
    ck("every feature in the catalogue is a row",
       len(plan_lib.list_features(repo)) == len(defaults.FEATURES))
    ck("Max holds every feature",
       all(plan_lib.features_for_plan(repo, "max").values()))
    ck("Free does not hold payroll",
       plan_lib.features_for_plan(repo, "free")["payroll"] is False)
    ck("a core feature is held by every plan, whatever the grid says",
       all(plan_lib.features_for_plan(repo, p)["settings"] for p in ("free", "pro", "max")))
    ck("the seed never overwrites a price an operator has changed",
       (plan_lib.update_plan(repo, "pro", {"price_per_student": 9.5}),
        billing.bootstrap(store),
        repo.get("subscription_plans", "pro")["price_per_student"])[2] == 9.5)
    plan_lib.update_plan(repo, "pro", {"price_per_student": 3})

    # ══ The calculation ═════════════════════════════════════════════════
    print("\nThe waterfall — gross, discount, exemption, tax, total")
    store, repo = platform()
    max_plan = plan_lib.get_plan(repo, "max")

    quote = engine.quote(repo, "ave-maria", max_plan, 100)
    ck("100 pupils at GHS 5 is GHS 500 gross", quote["gross_amount"] == 500.0, quote)
    ck("...and nothing is taken off a school with no arrangement",
       quote["total_amount"] == 500.0 and quote["discount_amount"] == 0)

    adjustments.grant_discount(store, repo, "ave-maria",
                               {"kind": "percent", "value": 20, "label": "Founding school"})
    quote = engine.quote(repo, "ave-maria", max_plan, 100)
    ck("a 20% discount takes GHS 1,000 to GHS 800 — the brief's own example",
       engine.quote(repo, "ave-maria", max_plan, 200)["total_amount"] == 800.0)
    ck("...while the plan's own price is untouched",
       repo.get("subscription_plans", "max")["price_per_student"] == 5.0)
    ck("...and the school is told the normal price, the discount and the final",
       (quote["gross_amount"], quote["discount_amount"], quote["total_amount"]) == (500.0, 100.0, 400.0),
       quote)

    adjustments.grant_exemption(store, repo, "ave-maria",
                                {"percent": 100, "reason": "Pilot school"})
    quote = engine.quote(repo, "ave-maria", max_plan, 100)
    ck("a full exemption takes the payable amount to nothing",
       quote["total_amount"] == 0.0)
    ck("...WITHOUT collapsing into the discount — both are still on the quote",
       quote["discount_amount"] == 100.0 and quote["exemption_amount"] == 400.0, quote)
    ck("...and the quote says it is exempt rather than merely zero", quote["is_exempt"])

    store, repo = platform()
    platform_settings.set_many(repo, {"tax_rate": "15"})
    quote = engine.quote(repo, "ave-maria", plan_lib.get_plan(repo, "max"), 100)
    ck("tax is added to what is actually payable",
       quote["tax_amount"] == 75.0 and quote["total_amount"] == 575.0, quote)
    platform_settings.set_many(repo, {"tax_rate": "0"})

    print("\nWhat a discount may and may not be")
    store, repo = platform()
    ck("a discount of nothing is refused",
       not adjustments.grant_discount(store, repo, "ave-maria",
                                      {"kind": "percent", "value": 0})["ok"])
    ck("a percentage over 100 is refused",
       not adjustments.grant_discount(store, repo, "ave-maria",
                                      {"kind": "percent", "value": 120})["ok"])
    ck("a fixed discount never takes a bill below nothing",
       (adjustments.grant_discount(store, repo, "ave-maria",
                                   {"kind": "fixed", "value": 9999}),
        engine.quote(repo, "ave-maria", plan_lib.get_plan(repo, "max"), 10))[1]["total_amount"] == 0.0)

    store, repo = platform()
    granted = adjustments.grant_discount(store, repo, "ave-maria", {
        "kind": "percent", "value": 10, "cycles": 2})["discount"]
    ck("a discount limited to two cycles is in force at first",
       engine.active_discount(repo, "ave-maria") is not None)
    adjustments.consume_cycle(repo, granted["id"])
    ck("...still in force after one", engine.active_discount(repo, "ave-maria") is not None)
    adjustments.consume_cycle(repo, granted["id"])
    ck("...and gone after two", engine.active_discount(repo, "ave-maria") is None)

    store, repo = platform()
    adjustments.grant_discount(store, repo, "ave-maria",
                               {"kind": "percent", "value": 15, "ends_at": "2020-01-01"})
    ck("a discount that has expired is not applied",
       engine.active_discount(repo, "ave-maria") is None)
    adjustments.grant_discount(store, repo, "ave-maria", {
        "kind": "percent", "value": 15, "starts_at": "2099-01-01", "ends_at": "2099-06-01"})
    ck("...nor is one that has not started", engine.active_discount(repo, "ave-maria") is None)

    print("\nWhat an exemption is, and is not")
    store, repo = platform()
    ck("an exemption without a reason is refused — it goes on the record",
       not adjustments.grant_exemption(store, repo, "ave-maria", {"percent": 100})["ok"])
    adjustments.grant_exemption(store, repo, "ave-maria", {"percent": 100, "reason": "Partner"})
    ck("a second exemption is refused while one is in force",
       not adjustments.grant_exemption(store, repo, "ave-maria",
                                       {"percent": 50, "reason": "Another"})["ok"])
    exemption = adjustments.list_exemptions(repo, "ave-maria")[0]
    adjustments.revoke_exemption(store, repo, exemption["id"], reason="Pilot ended")
    ck("withdrawing one puts the school back to being billed normally",
       engine.active_exemption(repo, "ave-maria") is None)
    ck("...and the withdrawn record is kept rather than deleted",
       len(adjustments.list_exemptions(repo, "ave-maria")) == 1)
    ck("...and both acts are in the platform's audit trail",
       len([a for a in store.list_audit(limit=50)
            if a["action"] in ("exemption_granted", "exemption_revoked")]) == 2)

    # ══ Subscriptions ═══════════════════════════════════════════════════
    print("\nThe subscription lifecycle")
    store, repo = platform()
    started = subs.start(store, repo, "ave-maria", "max")
    ck("subscribing starts a trial", started["ok"] and started["subscription"]["status"] == subs.TRIALING)
    ck("...with an end date", started["subscription"]["trial_ends_at"])
    again = subs.start(store, repo, "ave-maria", "pro")
    ck("a second subscription for the same school is refused",
       not again["ok"] and again["status"] == 409, again)

    subscription = subs.current(repo, "ave-maria")
    repo.update("subscriptions", subscription["id"],
                {"trial_ends_at": repo_lib.shift(repo_lib.now_iso(), -1)})
    subs.advance(store, repo, "ave-maria")
    ck("a trial that has ended moves the school onto its paid plan",
       subs.current(repo, "ave-maria")["status"] == subs.ACTIVE)

    subscription = subs.current(repo, "ave-maria")
    subs.mark_past_due(store, repo, subscription, reason="The card was declined.")
    ck("a failed payment makes the subscription past due",
       subs.current(repo, "ave-maria")["status"] == subs.PAST_DUE)
    ck("...and nothing is withheld yet",
       entitlements.for_school(store, "ave-maria", fresh=True)["access"] == "full")

    subscription = subs.current(repo, "ave-maria")
    repo.update("subscriptions", subscription["id"],
                {"updated_at": repo_lib.shift(repo_lib.now_iso(), -30),
                 "grace_ends_at": repo_lib.shift(repo_lib.now_iso(), -1)})
    subs.advance(store, repo, "ave-maria")
    ck("a grace period that runs out suspends the school",
       subs.current(repo, "ave-maria")["status"] == subs.SUSPENDED)
    entitlements.invalidate()
    entitlement = entitlements.for_school(store, "ave-maria", fresh=True)
    ck("...which is read-only, not shut", entitlement["access"] == "read_only", entitlement["access"])
    ck("...so the school can still read its own records",
       entitlements.check(entitlement, "students", "view") is None)
    ck("...and cannot change anything",
       (entitlements.check(entitlement, "students", "edit") or {}).get("reason") == "subscription")
    ck("...and is told why, in words", "suspended" in (entitlement["notice"] or "").lower())

    subs.mark_paid(store, repo, subs.current(repo, "ave-maria"))
    entitlements.invalidate()
    ck("a payment brings a suspended school straight back",
       entitlements.for_school(store, "ave-maria", fresh=True)["access"] == "full")
    ck("...on a fresh billing period",
       subs.current(repo, "ave-maria")["current_period_end"] > repo_lib.now_iso())

    print("\nEvery change is written down")
    events = [e["event"] for e in subs.events(repo, "ave-maria")]
    for event in ("subscription_started", "trial_ended", "payment_failed", "suspended"):
        ck(f"...{event.replace('_', ' ')}", event in events, events)

    print("\nWhat an operator can override, and what it costs them")
    store, repo = platform()
    subs.start(store, repo, "ave-maria", "pro")
    result = subs.set_status(store, repo, "ave-maria", subs.SUSPENDED,
                             actor="operator:ama@nickland", reason="Non-payment, agreed by phone")
    ck("an operator can set a status by hand", result["ok"])
    ck("...and it is audited with their name on it",
       any(a["actor"] == "operator:ama@nickland" and a["action"] == "subscription_overridden"
           for a in store.list_audit(limit=20)))
    ck("a status that is not a status is refused",
       not subs.set_status(store, repo, "ave-maria", "MAYBE")["ok"])

    print("\nA negotiated price belongs to the school, not to the plan")
    store, repo = platform()
    subs.start(store, repo, "ave-maria", "max")
    subs.set_price_override(store, repo, "ave-maria", per_student=2.5, note="Group of three schools")
    quote = engine.quote(repo, "ave-maria", plan_lib.get_plan(repo, "max"), 100,
                         subscription=subs.current(repo, "ave-maria"))
    ck("the school is quoted its own price", quote["total_amount"] == 250.0, quote)
    ck("...and the plan's price has not moved",
       repo.get("subscription_plans", "max")["price_per_student"] == 5.0)

    # ══ Invoices ════════════════════════════════════════════════════════
    print("\nAn invoice is a record, not a view")
    store, repo = platform()
    subs.start(store, repo, "ave-maria", "max", with_trial=False)
    raised = invoice_lib.raise_invoice(store, repo, "ave-maria")
    ck("an invoice can be raised", raised["ok"], raised.get("error"))
    invoice = raised["invoice"]
    ck("...and it carries its number", invoice["invoice_number"].startswith("NE-"))
    ck("...and every figure it was made from",
       {"student_count", "price_per_student", "gross_amount", "discount_amount",
        "exemption_amount", "total_amount"} <= set(invoice))

    plan_lib.update_plan(repo, "max", {"price_per_student": 50})
    kept = invoice_lib.get_invoice(repo, invoice["id"])
    ck("repricing the plan does not move an invoice already raised",
       kept["price_per_student"] == invoice["price_per_student"], kept["price_per_student"])

    again = invoice_lib.raise_invoice(store, repo, "ave-maria")
    ck("raising the same period twice returns the same invoice",
       again.get("already") and again["invoice"]["id"] == invoice["id"])

    print("\nAn exempt school's invoice says EXEMPT, and never PAID")
    store, repo = platform(("ave-maria", "st-johns"))
    for school in ("ave-maria", "st-johns"):
        subs.start(store, repo, school, "max", with_trial=False)
    adjustments.grant_exemption(store, repo, "st-johns", {"percent": 100, "reason": "Mission school"})
    # Both schools have a roll; the memory store has no tenant database, so the
    # count is pushed in through the snapshot the desktop would have sent.
    for school in ("ave-maria", "st-johns"):
        for n in range(4):
            store.upsert_snapshot(school, {
                "entity_type": "student_snapshot", "entity_key": f"student:{n}",
                "payload": {"status": "Active"}})
    paying = invoice_lib.raise_invoice(store, repo, "ave-maria")["invoice"]
    exempt = invoice_lib.raise_invoice(store, repo, "st-johns")["invoice"]
    ck("the paying school's invoice is open", paying["status"] == invoice_lib.OPEN, paying["status"])
    ck("the exempt school's invoice is EXEMPT", exempt["status"] == invoice_lib.EXEMPT, exempt["status"])
    ck("...for the full amount, itemised", exempt["exemption_amount"] == exempt["gross_amount"])
    ck("...and nothing is owed on it", exempt["total_amount"] == 0.0)

    report = invoice_lib.revenue_report(repo)
    ck("the revenue report separates exemptions from what is owed",
       report["exemptions"] > 0 and report["outstanding"] == paying["total_amount"], report)
    ck("...and an exempt school is NOT counted as an unpaid one",
       report["overdue_invoices"] == 0 and report["exempt_invoices"] == 1, report)
    ck("...and the waterfall adds up",
       round(report["gross"] - report["discounts"] - report["exemptions"], 2)
       == round(report["net_billed"] - report["tax"], 2), report)

    print("\nA zero invoice is not an exemption")
    store, repo = platform()
    subs.start(store, repo, "ave-maria", "max", with_trial=False)
    empty = invoice_lib.raise_invoice(store, repo, "ave-maria")["invoice"]
    ck("a school with no pupils owes nothing and is marked paid, not exempt",
       empty["status"] == invoice_lib.PAID and empty["total_amount"] == 0.0, empty["status"])

    print("\nThe billing run")
    store, repo = platform(("ave-maria", "st-johns"))
    for school in ("ave-maria", "st-johns"):
        subs.start(store, repo, school, "max", with_trial=False)
        for n in range(10):
            store.upsert_snapshot(school, {
                "entity_type": "student_snapshot", "entity_key": f"student:{n}",
                "payload": {"status": "Active"}})
        subscription = subs.current(repo, school)
        repo.update("subscriptions", subscription["id"],
                    {"current_period_end": repo_lib.shift(repo_lib.now_iso(), -1)})
    first = invoice_lib.run_billing(store, repo)
    ck("a run invoices every school whose period has ended", len(first["invoiced"]) == 2, first)
    second = invoice_lib.run_billing(store, repo)
    ck("...and running it again invoices nobody twice", len(second["invoiced"]) == 0, second)

    # ══ Entitlements ════════════════════════════════════════════════════
    print("\nWhat a school may do today")
    store, repo = platform()
    grandfathered = entitlements.for_school(store, "ave-maria", fresh=True)
    ck("a school that has never had a subscription keeps full access",
       grandfathered["access"] == "full", grandfathered)
    ck("...and is told it is not on a subscription rather than shown an error",
       "not on a subscription" in (grandfathered["notice"] or ""))
    ck("...and every feature is open to it",
       entitlements.has_feature(grandfathered, "payroll"))

    platform_settings.set_many(repo, {"grandfather_existing": "0"})
    entitlements.invalidate()
    blocked = entitlements.for_school(store, "ave-maria", fresh=True)
    ck("switching grandfathering off blocks a school with no subscription",
       blocked["access"] == "blocked")
    platform_settings.set_many(repo, {"grandfather_existing": "1"})
    entitlements.invalidate()

    store, repo = platform()
    subs.start(store, repo, "ave-maria", "free")
    free = entitlements.for_school(store, "ave-maria", fresh=True)
    ck("a school on Free may open Students", entitlements.check(free, "students", "view") is None)
    refusal = entitlements.check(free, "payroll", "view")
    ck("...and may not open Payroll", refusal and refusal["reason"] == "feature", refusal)
    ck("...and is told which plan would", "Free" in (refusal or {}).get("message", ""))

    plan_lib.set_plan_feature(repo, "free", "payroll", True)
    entitlements.invalidate()
    ck("moving Payroll onto Free opens it, with no deployment",
       entitlements.check(entitlements.for_school(store, "ave-maria", fresh=True),
                          "payroll", "view") is None)
    ck("a core feature cannot be withheld from a plan",
       not plan_lib.set_plan_feature(repo, "free", "settings", False)["ok"])

    print("\nWhen the platform itself is broken, schools keep working")

    class Broken:
        kind = "broken"

        def list_schools(self):
            return []

        def get_school(self, _sid):
            return None

        def record_audit(self, _entry):
            return True

        def list_audit(self, **_kw):
            return []

    broken = Broken()
    broken._billing_repo = _Exploding()
    open_platform = entitlements.for_school(broken, "ave-maria", fresh=True)
    ck("a billing layer that cannot be read fails OPEN, not shut",
       open_platform["access"] == "full", open_platform)
    ck("...and says so rather than pretending nothing happened",
       "could not be read" in (open_platform["notice"] or ""))

    # ══ Payments ════════════════════════════════════════════════════════
    print("\nTaking the platform's own money")
    store, repo = platform()
    subs.start(store, repo, "ave-maria", "max", with_trial=False)
    for n in range(10):
        store.upsert_snapshot("ave-maria", {
            "entity_type": "student_snapshot", "entity_key": f"student:{n}",
            "payload": {"status": "Active"}})
    invoice = invoice_lib.raise_invoice(store, repo, "ave-maria")["invoice"]

    billing_provider.settle(store, repo, "ave-maria", "ref-1",
                            invoice_id=invoice["id"], amount=invoice["total_amount"])
    ck("a settled payment marks the invoice paid",
       invoice_lib.get_invoice(repo, invoice["id"])["status"] == invoice_lib.PAID)
    before = repo.count("platform_payments")
    billing_provider.settle(store, repo, "ave-maria", "ref-1",
                            invoice_id=invoice["id"], amount=invoice["total_amount"])
    ck("...and settling the same reference again records nothing new",
       repo.count("platform_payments") == before, repo.count("platform_payments"))

    ck("a webhook with no signature is refused",
       billing_provider.handle_webhook(store, repo, "{}", "")["status"] == 401)
    os.environ[billing_provider.ENV_SECRET] = "sk_test_platform_secret"
    try:
        import hashlib
        import hmac
        import json as jsonlib
        body = jsonlib.dumps({"event": "charge.failed",
                              "data": {"id": 77, "reference": "ref-2",
                                       "gateway_response": "Declined",
                                       "metadata": {"school_id": "ave-maria"}}})
        signature = hmac.new(b"sk_test_platform_secret", body.encode(), hashlib.sha512).hexdigest()
        ck("a webhook with a wrong signature is refused",
           billing_provider.handle_webhook(store, repo, body, "deadbeef")["status"] == 401)
        first = billing_provider.handle_webhook(store, repo, body, signature)
        ck("a signed webhook is acted on", first.get("failed") == "ref-2", first)
        repeat = billing_provider.handle_webhook(store, repo, body, signature)
        ck("...and the same delivery a second time is ignored", repeat.get("duplicate"), repeat)
        ck("...and the failure put the subscription past due",
           subs.current(repo, "ave-maria")["status"] == subs.PAST_DUE)
    finally:
        os.environ.pop(billing_provider.ENV_SECRET, None)

    # ══ The console ═════════════════════════════════════════════════════
    print("\nWho may open the Superadmin console")
    store, _repo = platform()
    client = TestClient(create_app(store), raise_server_exceptions=False)
    ratelimit.reset()
    ck("no credential at all is refused",
       client.get("/api/v1/admin/dashboard").status_code == 401)
    ck("a wrong platform key is refused",
       client.get("/api/v1/admin/dashboard",
                  headers={"x-platform-key": "wrong"}).status_code == 401)
    ck("the operator key opens it",
       client.get("/api/v1/admin/dashboard", headers={"x-platform-key": KEY}).status_code == 200)

    made = client.post("/api/v1/admin/operators", headers={"x-platform-key": KEY},
                       json={"email": "ama@nickland.test", "full_name": "Ama",
                             "password": "a-long-enough-password"})
    ck("the first operator account can be made with the platform key", made.status_code == 200, made.text)
    ck("...and it is marked as the first", made.json().get("first") is True)
    second = client.post("/api/v1/admin/operators",
                         json={"email": "kofi@nickland.test", "password": "another-long-one"})
    ck("...and a second one cannot be made without signing in", second.status_code in (401, 404))

    signed_in = client.post("/api/v1/admin/login",
                            json={"email": "ama@nickland.test", "password": "a-long-enough-password"})
    ck("an operator can sign in", signed_in.status_code == 200, signed_in.text)
    token = signed_in.json()["token"]
    ck("a wrong password is refused",
       client.post("/api/v1/admin/login",
                   json={"email": "ama@nickland.test", "password": "nope"}).status_code == 401)
    ck("the console session opens the console",
       client.get("/api/v1/admin/dashboard",
                  headers={"authorization": "Bearer " + token}).status_code == 200)

    # A school's own sync key is not a console credential. This is the same
    # separation platform_api draws, checked again because the console reaches
    # every school on the platform rather than one.
    school_key = store.create_school(name="Somebody Else")["api_key"]
    ck("a school's own key cannot open the console",
       client.get("/api/v1/admin/dashboard",
                  headers={"x-platform-key": school_key}).status_code == 401)

    print("\nWhat the console can do")
    ops = {"authorization": "Bearer " + token}
    ck("it lists the schools",
       client.get("/api/v1/admin/schools", headers=ops).json()["ok"])
    ck("it can reprice a plan",
       client.patch("/api/v1/admin/plans/pro", headers=ops,
                    json={"price_per_student": 4.25}).json()["plan"]["price_per_student"] == 4.25)
    ck("...and the public pricing page shows the new price at once",
       [p for p in client.get("/api/v1/public/plans").json()["plans"]
        if p["plan_id"] == "pro"][0]["price_per_student"] == 4.25)
    ck("a plan with a bad interval is refused",
       client.patch("/api/v1/admin/plans/pro", headers=ops,
                    json={"billing_interval": "fortnightly"}).status_code == 400)
    ck("a negative price is refused",
       client.patch("/api/v1/admin/plans/pro", headers=ops,
                    json={"price_per_student": -1}).status_code == 400)
    ck("it can grant a discount",
       client.post("/api/v1/admin/discounts", headers=ops,
                   json={"school_id": "ave-maria", "kind": "percent", "value": 25,
                         "label": "Group"}).json()["ok"])
    ck("...to a school that exists, and nobody else",
       client.post("/api/v1/admin/discounts", headers=ops,
                   json={"school_id": "no-such-school", "kind": "percent",
                         "value": 25}).status_code == 404)
    ck("it can exempt a school, with a reason",
       client.post("/api/v1/admin/exemptions", headers=ops,
                   json={"school_id": "ave-maria", "percent": 100,
                         "reason": "Pilot"}).json()["ok"])
    ck("a setting that is not a setting is refused",
       client.post("/api/v1/admin/settings", headers=ops,
                   json={"make_it_free": "1"}).status_code == 400)
    ck("a setting that is one is written",
       client.post("/api/v1/admin/settings", headers=ops,
                   json={"grace_period_days": "21"}).json()["ok"])
    ck("...and is read back", client.get("/api/v1/admin/settings",
                                         headers=ops).json()["settings"]["grace_period_days"] == "21")
    ck("the revenue report is the waterfall §27 asks for",
       {"gross", "discounts", "exemptions", "net_billed", "collected", "outstanding"}
       <= set(client.get("/api/v1/admin/reports/revenue", headers=ops).json()["totals"]))
    audit = client.get("/api/v1/admin/audit", headers=ops).json()["audit"]
    ck("every one of those acts is in the audit trail, with who did it",
       any(a["actor"] == "operator:ama@nickland.test" for a in audit), audit[:3])

    # ══ The public front door ═══════════════════════════════════════════
    print("\nThe public website's API")
    ck("the plans are public", client.get("/api/v1/public/plans").json()["ok"])
    ck("...priced for a roll when one is given",
       client.get("/api/v1/public/plans?students=100").json()["plans"][0]["estimate"]["students"] == 100)
    ck("the config never carries a gateway secret",
       "secret" not in str(client.get("/api/v1/public/config").json()).lower())
    ck("a login with nothing is refused",
       client.post("/api/v1/public/login", json={}).status_code in (400, 401, 429))
    ratelimit.reset()
    unknown = client.post("/api/v1/public/login",
                          json={"email": "nobody@example.com", "password": "guess"})
    ck("an unknown email gets the same answer as a wrong password",
       unknown.status_code == 401 and "did not match" in unknown.json()["error"], unknown.text)

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


class _Exploding:
    """A repository where every read fails — the platform having a bad morning."""

    kind = "broken"

    def __getattr__(self, _name):
        def boom(*_args, **_kwargs):
            raise RuntimeError("the billing tables are unreachable")
        return boom


if __name__ == "__main__":
    sys.exit(main())
