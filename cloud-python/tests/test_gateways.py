"""Payment providers — the adapter layer, and the rule that keeps it safe.

    DATABASE_URL=... ALLOW_DEV_SECRET=1 \\
        python3 cloud-python/tests/test_gateways.py

A school in Ghana banks where it banks, so the platform takes whichever
provider the school already has. That only works if two things hold, and this
suite is about both of them.

**The registry has no favourites.** Nothing outside `app/gateways/` names a
provider. Adding one is a file; the fee module, the parent app, the webhook
routes and the subscription engine are untouched. The test for that is
mechanical and it is the first one below: grep the codebase.

**A gateway goes live only after it has answered.** A wrong key, a sandbox key
in a live deployment, a merchant number with a typo — all of them are caught by
a Test button, at setup, by the person who typed them. Not by a parent at ten
at night, and not by an adapter written against a provider's documentation that
has since moved. Every one of the credential and lifecycle rules here exists to
make that unbypassable.

The providers are never actually called: a fake stands in for the HTTP layer,
so this suite can say "the provider says no" and check what the platform does
with that, which is the part worth testing.
"""
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

os.environ.setdefault("ALLOW_DEV_SECRET", "1")
# Licences are signed in every suite, so the service boots exactly as it does in
# production rather than down a path only tests take. A FIXED key: a generated
# one would make every run sign differently and a failure impossible to repeat.
os.environ.setdefault("LICENCE_SIGNING_KEY", "drupkjj9JHpGHCss-T0QStTqdmrajb4_uNJK3z7FKqk")
os.environ.setdefault("ALLOW_MEMORY_STORE", "1")
os.environ["PLATFORM_ADMIN_KEY"] = "pk_test_" + ("x" * 32)
os.environ["EDUSOFT_QUIET_BOOT"] = "1"
os.environ.pop("PLATFORM_PAYSTACK_SECRET", None)

from fastapi.testclient import TestClient                        # noqa: E402

from app import billing, gateways, ratelimit                     # noqa: E402
from app.billing import provider as billing_provider             # noqa: E402
from app.billing import repo as repo_lib                         # noqa: E402
from app.gateways import sms as sms_lib                          # noqa: E402
from app.main import create_app                                  # noqa: E402
from app.store import MemoryStore                                # noqa: E402

KEY = os.environ["PLATFORM_ADMIN_KEY"]
passed = failed = 0
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app"))


def ck(name, condition, extra=None):
    global passed, failed
    condition = bool(condition)
    passed += condition
    failed += (not condition)
    print(("✓" if condition else "✗") + " " + name)
    if not condition and extra is not None:
        print("    " + repr(extra))


# ── a provider that answers whatever the test wants ─────────────────────────
ANSWER = {"ping": True, "checkout": True, "paid": True, "amount": 200.0}
CALLS = []


def last_call(fragment):
    """The most recent request whose URL contains `fragment`, or None."""
    for call in reversed(CALLS):
        if fragment in call["url"]:
            return call
    return None


def fake_http(url, method="GET", headers=None, body=None, timeout=25):
    CALLS.append({"method": method, "url": url, "body": body or {}})
    if not ANSWER["ping"] and ("/transaction?" in url or "/transactions?" in url
                               or "/status?" in url or "query.php" in url
                               or "balance-details" in url):
        return {"status": 401, "json": {"message": "Invalid key"}}
    if "/transaction/initialize" in url or url.endswith("/payments") or "items/initiate" in url:
        if not ANSWER["checkout"]:
            return {"status": 400, "json": {"status": False, "message": "declined"}}
        return {"status": 200, "json": {"status": "success", "data": {
            "authorization_url": "https://checkout.example/x",
            "link": "https://checkout.example/x",
            "checkoutDirectUrl": "https://checkout.example/x",
            "reference": (body or {}).get("reference") or "ref"}}}
    if "/transaction/verify/" in url or "verify_by_reference" in url:
        return {"status": 200, "json": {"status": "success", "data": {
            "status": "success" if ANSWER["paid"] else "abandoned",
            "amount": int(ANSWER["amount"] * 100), "currency": "GHS",
            "authorization": {"authorization_code": "AUTH_x", "last4": "4242",
                              "brand": "visa", "reusable": True},
            "customer": {"customer_code": "CUS_1", "email": "a@b.test"}}}}
    if "balance-details" in url:
        # The shape Arkesel v2 actually answers with.
        return {"status": 200, "json": {"status": "success",
                                        "data": {"sms_balance": 482}}}
    return {"status": 200, "json": {"status": True, "data": []}}


def fake_form(url, fields, method="POST", headers=None, timeout=25):
    CALLS.append({"method": method, "url": url, "body": dict(fields or {})})
    if not ANSWER["ping"]:
        return {"status": 200, "json": {"result": 4, "result-text": "Invalid api-key"}}
    if "submit.php" in url:
        return {"status": 200, "json": {"status": 1, "token": "TKN123"}}
    return {"status": 200, "json": {"result": 1, "result-text": "Approved", "amount": 200.0}}


def install_fakes():
    """Stand in for the HTTP layer on every adapter that imported it by name."""
    from app.gateways import expresspay, flutterwave, hubtel, paystack
    for module in (paystack, flutterwave, hubtel, sms_lib):
        module.http_json = fake_http
    expresspay.http_form = fake_form


def school_with(store, credentials, gateway="paystack"):
    sid = "gw-" + uuid.uuid4().hex[:8]
    store.create_school(name="Gateway School", school_id=sid)
    store.set_payment_config(sid, {"gateway": gateway, "credentials": credentials,
                                   "currency": "GHS"})
    return sid


def main():
    install_fakes()

    # ══ Nothing outside app/gateways knows a provider's name ════════════
    print("\nThe registry has no favourites")

    # Every place outside `app/gateways/` that names a provider, and why it is
    # allowed to. Pinned rather than waved through: an exception that is written
    # down stays an exception, and a new one fails this test until somebody has
    # decided it is worth having.
    ALLOWED = {
        ("billing/provider.py", "paystack"):
            "PLATFORM_PAYSTACK_* predate the registry and still work; and Paystack "
            "is the only one of the four with a refund API.",
        ("payments.py", "paystack"):
            "A desktop that pushed the old Paystack-shaped fields is read as Paystack.",
        ("payments.py", "expresspay"):
            "ExpressPay alone identifies a payment by a token it mints.",
        ("school/payments.py", "paystack"): "As above.",
        ("school/payments.py", "expresspay"): "As above.",
        ("school/integrations.py", "paystack"):
            "The legacy paystack_secret_key settings are kept in step so a school "
            "set up before this screen existed keeps working.",
    }

    offenders = []
    for folder, _dirs, files in os.walk(ROOT):
        if os.path.basename(folder) == "gateways":
            continue
        for name in sorted(files):
            if not name.endswith(".py"):
                continue
            path = os.path.join(folder, name)
            relative = os.path.relpath(path, ROOT).replace(os.sep, "/")
            with open(path, encoding="utf-8") as handle:
                source = handle.read()
            # Comments and docstrings may name a provider — explaining WHY a
            # rule exists usually needs to. Code may not branch on one.
            code = "\n".join(line.split("#")[0] for line in source.splitlines())
            for provider in ("paystack", "flutterwave", "hubtel", "expresspay"):
                if re.search(rf'["\']{provider}["\']', code) and (relative, provider) not in ALLOWED:
                    offenders.append((relative, provider))

    ck("no module outside app/gateways branches on a provider we did not sanction",
       not offenders, offenders)
    ck("...and every sanctioned exception is still real",
       all(os.path.isfile(os.path.join(ROOT, path)) for path, _ in ALLOWED))
    ck("...and there are only a handful of them", len(ALLOWED) <= 8, len(ALLOWED))

    # ══ The catalogue ═══════════════════════════════════════════════════
    print("\nWhat a school can choose from")
    catalogue = gateways.catalogue()
    ck("four providers are offered", len(catalogue) == 4, [g["id"] for g in catalogue])
    ck("each declares the fields its setup form needs",
       all(g["fields"] and all(f["label"] and f["key"] for f in g["fields"]) for g in catalogue))
    ck("each says whether it can charge a saved card — a subscription needs that",
       {g["id"] for g in catalogue if g["supports_stored_charge"]} == {"paystack", "flutterwave"},
       {g["id"]: g["supports_stored_charge"] for g in catalogue})
    ck("each says whether it signs its callbacks, honestly",
       {g["id"] for g in catalogue if not g["signed_callbacks"]} == {"hubtel", "expresspay"})
    ck("an adapter never tested against a live account says so",
       {g["id"] for g in catalogue if g["verified"]} == {"paystack"},
       {g["id"]: g["verified"] for g in catalogue})
    ck("every provider takes cedis", all("GHS" in g["currencies"] for g in catalogue))
    ck("an unknown provider is not one", gateways.get("moneybags") is None)

    # ══ Credentials ═════════════════════════════════════════════════════
    print("\nWhat happens to a key on its way in and out")
    credentials, problems = gateways.clean("hubtel", {
        "client_id": "ID-123456", "client_secret": "SECRET-987654",
        "merchant_account": "2019204", "rm": "rf", "is_active": True})
    ck("a field the adapter did not declare is dropped, not stored",
       "rm" not in credentials and "is_active" not in credentials, credentials)
    ck("defaults are filled in", credentials["base_url"].startswith("https://"))
    ck("a missing required field is refused",
       "required" in " ".join(gateways.clean("paystack", {})[1]).lower())

    shown = gateways.redact("hubtel", credentials)
    ck("a secret comes back masked", shown["client_secret"] == "••••7654", shown)
    ck("...and a non-secret comes back whole", shown["merchant_account"] == "2019204")
    ck("the real secret is nowhere in what a screen is given",
       "SECRET-987654" not in str(shown))

    kept, _ = gateways.clean("hubtel", {**shown, "merchant_account": "999"}, credentials)
    ck("re-posting the mask means 'keep the key I cannot see'",
       kept["client_secret"] == "SECRET-987654" and kept["merchant_account"] == "999", kept)

    # ══ A school setting itself up ══════════════════════════════════════
    print("\nA school setting its own provider up")
    store = MemoryStore()
    billing.bootstrap(store)
    client = TestClient(create_app(store), raise_server_exceptions=False)
    ratelimit.reset()

    sid = school_with(store, {"secret_key": "sk_live_abcd1234"})
    stored = store.get_payment_config(sid)
    ck("the credentials are stored", stored["credentials"]["secret_key"] == "sk_live_abcd1234")
    ck("...and start out untested", stored.get("verified_at") is None)

    cfg = __import__("app.payments", fromlist=["config"]).config(store, sid)
    ck("the thin cloud resolves them to an adapter", cfg and cfg["gateway"] == "paystack")
    ck("...and never hands the secret to a parent's app",
       "sk_live_abcd1234" not in str(__import__("app.payments", fromlist=["availability"])
                                     .availability(store, sid)))

    print("\nA desktop that pushed the old Paystack-shaped fields still works")
    legacy = "legacy-" + uuid.uuid4().hex[:8]
    store.create_school(name="Legacy", school_id=legacy)
    store.set_payment_config(legacy, {"gateway": "paystack", "secret": "sk_old_9999",
                                      "public_key": "pk_old", "currency": "GHS"})
    old_cfg = __import__("app.payments", fromlist=["config"]).config(store, legacy)
    ck("a configuration from before multi-gateway is read as Paystack",
       old_cfg and old_cfg["gateway"] == "paystack", old_cfg)
    ck("...with its key intact", old_cfg["settings"].cred("secret_key") == "sk_old_9999")

    print("\nChanging a key un-tests it")
    store.mark_payment_verified(sid, "Paystack accepted the key.")
    ck("a passed test is recorded", store.get_payment_config(sid)["verified_at"])
    store.set_payment_config(sid, {"gateway": "paystack",
                                   "credentials": {"secret_key": "sk_live_DIFFERENT"},
                                   "currency": "GHS"})
    ck("...and replacing the key clears it",
       store.get_payment_config(sid).get("verified_at") is None)

    # ══ The Test button ═════════════════════════════════════════════════
    print("\nThe Test button, against each provider")
    for gateway_id, credentials in (
            ("paystack", {"secret_key": "sk_test_x"}),
            ("flutterwave", {"secret_key": "FLWSECK-x"}),
            ("hubtel", {"client_id": "a", "client_secret": "b", "merchant_account": "2019204"}),
            ("expresspay", {"merchant_id": "m", "api_key": "k"})):
        adapter = gateways.get(gateway_id)
        settings = gateways.config_for(gateway_id, credentials)
        ANSWER["ping"] = True
        good = adapter.ping(settings)
        ANSWER["ping"] = False
        bad = adapter.ping(settings)
        ck(f"{adapter.name}: a real key passes and a wrong one fails",
           good.get("ok") and not bad.get("ok"), (good, bad))
        ck(f"...and the failure says something a bursar can act on",
           len(str(bad.get("error") or "")) > 10, bad)
    ANSWER["ping"] = True

    ck("a merchant account that is not digits is caught before Hubtel is called",
       not gateways.get("hubtel").ping(gateways.config_for(
           "hubtel", {"client_id": "a", "client_secret": "b",
                      "merchant_account": "not-a-number"})).get("ok"))

    # ══ Checkout and settlement ═════════════════════════════════════════
    print("\nStarting a payment, at each provider")
    for gateway_id, credentials in (
            ("paystack", {"secret_key": "sk_test_x"}),
            ("flutterwave", {"secret_key": "FLWSECK-x"}),
            ("hubtel", {"client_id": "a", "client_secret": "b", "merchant_account": "2019204"}),
            ("expresspay", {"merchant_id": "m", "api_key": "k"})):
        adapter = gateways.get(gateway_id)
        settings = gateways.config_for(gateway_id, credentials)
        started = adapter.checkout(settings, 200, "REF-1", email="a@b.test")
        ck(f"{adapter.name}: hands back somewhere to send the payer",
           started.get("ok") and str(started.get("authorization_url", "")).startswith("https://"),
           started)

    print("\nExpressPay's token survives the round trip")
    from app.gateways.expresspay import token_from_url
    settings = gateways.config_for("expresspay", {"merchant_id": "m", "api_key": "k"})
    started = gateways.get("expresspay").checkout(settings, 200, "REF-2")
    ck("the checkout address carries it", "token=TKN123" in started["authorization_url"])
    ck("...and it can be read back out without a column of its own",
       token_from_url(started["authorization_url"]) == "TKN123")
    ck("asking about an ExpressPay payment without one says so rather than failing oddly",
       gateways.get("expresspay").verify(settings, "REF-2").get("needs_token") is True)
    ck("...and with one, it answers",
       gateways.get("expresspay").verify(settings, "REF-2", token="TKN123").get("paid") is True)

    # ══ Webhooks ════════════════════════════════════════════════════════
    print("\nWhat a delivery from each provider is worth")
    import hashlib
    import hmac
    import json

    paystack = gateways.get("paystack")
    settings = gateways.config_for("paystack", {"secret_key": "sk_test_x"})
    body = json.dumps({"event": "charge.success", "data": {"id": 1, "reference": "R1"}})
    signature = hmac.new(b"sk_test_x", body.encode(), hashlib.sha512).hexdigest()
    ck("Paystack: a correct signature is accepted",
       paystack.verify_webhook(settings, body, {"x-paystack-signature": signature}))
    ck("...a wrong one is not",
       not paystack.verify_webhook(settings, body, {"x-paystack-signature": "nope"}))
    ck("...and none at all is not", not paystack.verify_webhook(settings, body, {}))
    ck("...and it reads as a success",
       paystack.read_webhook(settings, body, {}).get("status") == "succeeded")

    flutterwave = gateways.get("flutterwave")
    fw = gateways.config_for("flutterwave", {"secret_key": "k", "secret_hash": "SHH"})
    ck("Flutterwave: the dashboard's hash is what is compared",
       flutterwave.verify_webhook(fw, "{}", {"verif-hash": "SHH"})
       and not flutterwave.verify_webhook(fw, "{}", {"verif-hash": "other"}))
    ck("...and with no hash configured, nothing is believed",
       not flutterwave.verify_webhook(
           gateways.config_for("flutterwave", {"secret_key": "k"}), "{}", {"verif-hash": "x"}))

    hubtel = gateways.get("hubtel")
    hb = gateways.config_for("hubtel", {"client_id": "a", "client_secret": "b",
                                        "merchant_account": "1"})
    ck("Hubtel: a callback is never a signature, because Hubtel does not sign",
       not hubtel.verify_webhook(hb, "{}", {"anything": "at all"}))
    read = hubtel.read_webhook(hb, json.dumps({"Data": {"ClientReference": "R9",
                                                        "Status": "Success"}}), {})
    ck("...so the most a Hubtel callback can say is 'go and look'",
       read["status"] == "check" and read["reference"] == "R9", read)

    expresspay = gateways.get("expresspay")
    ep = gateways.config_for("expresspay", {"merchant_id": "m", "api_key": "k"})
    ck("ExpressPay: likewise unsigned",
       not expresspay.verify_webhook(ep, "token=T&order-id=R", {}))
    read = expresspay.read_webhook(ep, "token=TKN&order-id=R7", {})
    ck("...and its form-encoded callback is understood anyway",
       read["status"] == "check" and read["token"] == "TKN" and read["reference"] == "R7", read)

    # ══ Nickland's own gateway ══════════════════════════════════════════
    print("\nThe platform charging a school, through the same adapters")
    repo = repo_lib.repo_for(store)
    ck("with nothing configured, the platform takes no cards",
       not billing_provider.configured(repo))

    ops = {"x-platform-key": KEY}
    saved = client.post("/api/v1/admin/gateways", headers=ops, json={
        "gateway": "flutterwave", "credentials": {"secret_key": "FLWSECK-abcd1234"}})
    ck("an operator can store Nickland's credentials", saved.json().get("ok"), saved.text)
    activate = client.post("/api/v1/admin/gateways/flutterwave/activate", headers=ops)
    ck("...and cannot make them live untested",
       activate.status_code == 400 and "Test" in activate.json()["error"], activate.text)

    tested = client.post("/api/v1/admin/gateways/flutterwave/test", headers=ops)
    ck("a passing test unlocks it", tested.json().get("ok"), tested.text)
    ck("...and then it can be made live",
       client.post("/api/v1/admin/gateways/flutterwave/activate", headers=ops).json().get("ok"))
    ck("...and the platform now has a gateway", billing_provider.configured(repo))
    ck("...which the public config names without its secret",
       billing_provider.public_config(repo)["provider"] == "flutterwave"
       and "FLWSECK-abcd1234" not in str(billing_provider.public_config(repo)))

    listed = client.get("/api/v1/admin/gateways", headers=ops).json()
    ck("the console never shows Nickland's secret back either",
       "FLWSECK-abcd1234" not in str(listed), listed["configured"])

    print("\nOnly one provider is live at a time")
    client.post("/api/v1/admin/gateways", headers=ops, json={
        "gateway": "paystack", "credentials": {"secret_key": "sk_live_zzzz"}})
    client.post("/api/v1/admin/gateways/paystack/test", headers=ops)
    client.post("/api/v1/admin/gateways/paystack/activate", headers=ops)
    live = [row for row in client.get("/api/v1/admin/gateways", headers=ops).json()["configured"]
            if row["is_active"]]
    ck("switching provider stands the last one down",
       len(live) == 1 and live[0]["gateway"] == "paystack", live)

    print("\nA provider that cannot renew says so before month end")
    client.post("/api/v1/admin/gateways", headers=ops, json={
        "gateway": "hubtel", "credentials": {"client_id": "a", "client_secret": "b",
                                             "merchant_account": "2019204"}})
    client.post("/api/v1/admin/gateways/hubtel/test", headers=ops)
    client.post("/api/v1/admin/gateways/hubtel/activate", headers=ops)
    result = billing_provider.charge_stored_method(store, repo, sid, 100)
    ck("Hubtel cannot charge a saved card, and the error says what to do instead",
       not result["ok"] and "invoice" in result["error"].lower(), result)

    # ══ SMS ═════════════════════════════════════════════════════════════
    print("\nText messages")
    arkesel = sms_lib.provider("arkesel")
    ck("Arkesel is the provider", arkesel and arkesel.verified)
    ck("a local number becomes an international one",
       sms_lib.msisdn("0244000111") == "233244000111")
    ck("...and one that is already international is left alone",
       sms_lib.msisdn("+233244000111") == "233244000111")
    ck("...and nonsense is not a number", sms_lib.msisdn("") == "")

    sms_cfg = gateways.config_for("arkesel", {"api_key": "key", "sender_id": "A VERY LONG NAME"})
    ck("a sender ID over eleven characters is trimmed, not rejected by Arkesel later",
       len(arkesel.sender(sms_cfg)) == 11, arkesel.sender(sms_cfg))
    ANSWER["ping"] = True
    checked = arkesel.ping(sms_cfg)
    ck("checking the key spends no credit", checked.get("ok"), checked)
    ck("...and tells the school how many messages it has left",
       checked.get("balance") == 482 and "482" in str(checked.get("detail")), checked)
    ANSWER["ping"] = False
    ck("...and a wrong key is refused clearly",
       "key" in str(arkesel.ping(sms_cfg).get("error") or "").lower())
    ANSWER["ping"] = True
    ck("sending with no key is refused before the network",
       not arkesel.send(gateways.config_for("arkesel", {}), "0244000111", "hi").get("ok"))

    # ══ Visa and Mastercard, and what a renewal can be charged to ═══════
    print("\nCards")

    for spec in gateways.catalogue():
        if "card" in spec["channels"]:
            # A provider that takes cards and will not say which networks
            # leaves the website with nothing true to print, so it prints
            # nothing — which reads as "cards not accepted".
            ck(f"{spec['id']} names the card networks it takes",
               "visa" in spec["card_brands"] and "mastercard" in spec["card_brands"],
               spec["card_brands"])
        ck(f"{spec['id']} says a card is what can be charged again",
           spec["reusable_channels"] == ["card"], spec["reusable_channels"])

    # A mobile-money collection is a one-off. A trial set up on one leaves
    # nothing to charge when the trial ends, and the school finds out at month
    # end — so the setup step asks for a card and is told to.
    store = MemoryStore()
    repo = repo_lib.repo_for(store)
    os.environ["PLATFORM_PAYSTACK_SECRET"] = "sk_test_platform"
    try:
        sid = "card-" + uuid.uuid4().hex[:8]
        store.create_school(name="Card School", school_id=sid)

        CALLS.clear()
        started = billing_provider.start_checkout(store, repo, sid, "head@x.test", 0,
                                                  kind="setup")
        ck("a trial's card check starts", started.get("ok"), started)
        asked = last_call("/transaction/initialize")
        ck("...and asks Paystack for a card, not for every channel",
           asked and asked["body"].get("channels") == ["card"], asked)
        ck("...and says so to whoever called it",
           started.get("channels") == ["card"], started.get("channels"))
        ck("...naming the networks the school may use",
           "visa" in (started.get("card_brands") or []), started.get("card_brands"))

        # Settling one invoice is a different thing: there is nothing to charge
        # later, so the payer's own preference is the only thing that matters.
        CALLS.clear()
        paid = billing_provider.start_checkout(store, repo, sid, "head@x.test", 250,
                                               kind="subscription")
        asked = last_call("/transaction/initialize")
        ck("a one-off invoice is not narrowed to a card",
           paid.get("ok") and asked and "channels" not in asked["body"], asked)
        ck("...and mobile money is among what the school is offered",
           "mobile_money" in (paid.get("channels") or []), paid.get("channels"))

        # The caller may still ask for something specific.
        CALLS.clear()
        billing_provider.start_checkout(store, repo, sid, "head@x.test", 250,
                                        kind="subscription", channels=["mobile_money"])
        asked = last_call("/transaction/initialize")
        ck("an explicit channel is passed through",
           asked and asked["body"].get("channels") == ["mobile_money"], asked)

        # A channel the provider does not have is dropped rather than sent:
        # Paystack refuses an unknown channel outright, which would turn a
        # caller's typo into a school that cannot pay at all.
        CALLS.clear()
        billing_provider.start_checkout(store, repo, sid, "head@x.test", 250,
                                        kind="subscription", channels=["carrier_pigeon"])
        asked = last_call("/transaction/initialize")
        ck("a channel the provider does not have is dropped, not sent",
           asked and "channels" not in asked["body"], asked)

        # What the browser is told, so the website can print it.
        public = billing_provider.public_config(repo)
        ck("the website is told which cards are accepted",
           "visa" in public.get("card_brands", []) and
           "mastercard" in public.get("card_brands", []), public)
        ck("...and which channel a renewal can use",
           public.get("renewal_channels") == ["card"], public)

        # Filed under the provider that actually issued it. This said
        # "paystack" unconditionally, from when Paystack was the only one.
        settled = billing_provider.settle(store, repo, sid, "edu-sub-x-000001",
                                          amount=250.0,
                                          method={"reference": "AUTH_x", "brand": "visa",
                                                  "last4": "4242", "kind": "card",
                                                  "reusable": True},
                                          customer_id="CUS_1")
        ck("a settled payment records which provider took it",
           settled.get("payment", {}).get("provider") == "paystack", settled.get("payment"))
        stored = billing_provider.methods_for(repo, sid)
        ck("a stored card keeps its network and last four",
           stored and stored[0]["brand"] == "visa" and stored[0]["last4"] == "4242", stored)
        ck("...and the provider that issued it",
           stored and stored[0]["provider"] == "paystack", stored)

        # Mobile money is never filed as a payment method: the handle cannot be
        # charged, and a billing page showing one that silently fails at
        # renewal is worse than a billing page showing none.
        none_stored = billing_provider.remember_method(
            repo, sid, {"reference": "MOMO_1", "kind": "mobile_money", "reusable": False})
        ck("an instrument that cannot be charged again is not filed as one",
           none_stored is None)
    finally:
        os.environ.pop("PLATFORM_PAYSTACK_SECRET", None)

    # Flutterwave spells its channels differently, and an unrecognised spelling
    # is ignored rather than refused — which would silently give back the
    # unrestricted checkout this exists to avoid.
    flw = gateways.get("flutterwave")
    CALLS.clear()
    flw.checkout(gateways.config_for("flutterwave", {"secret_key": "FLWSECK-x"}),
                 100, "ref-1", channels=["card"])
    asked = last_call("/payments")
    ck("Flutterwave is asked in its own spelling",
       asked and asked["body"].get("payment_options") == "card", asked)
    CALLS.clear()
    flw.checkout(gateways.config_for("flutterwave", {"secret_key": "FLWSECK-x"}),
                 100, "ref-2", channels=["mobile_money"])
    asked = last_call("/payments")
    ck("...including for mobile money, which it calls something else entirely",
       asked and asked["body"].get("payment_options") == "mobilemoneyghana", asked)
    CALLS.clear()
    flw.checkout(gateways.config_for("flutterwave", {"secret_key": "FLWSECK-x"}), 100, "ref-3")
    asked = last_call("/payments")
    ck("...and asking for nothing restricts nothing",
       asked and "payment_options" not in asked["body"], asked)

    # The two that cannot be told take the argument anyway, so a caller never
    # has to know which kind of provider it holds.
    for gid in ("hubtel", "expresspay"):
        adapter = gateways.get(gid)
        creds = {"client_id": "a", "client_secret": "b", "merchant_account": "2019204",
                 "merchant_id": "M", "api_key": "K"}
        result = adapter.checkout(gateways.config_for(gid, creds), 50, f"ref-{gid}",
                                  channels=["card"])
        ck(f"{gid} accepts a channel it cannot act on rather than failing",
           result.get("ok"), result)

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
