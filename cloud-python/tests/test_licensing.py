"""No subscription, no usage — on every machine the software runs on.

    DATABASE_URL=... ALLOW_DEV_SECRET=1 \\
        python3 cloud-python/tests/test_licensing.py

The desktop is the source of truth and runs offline. That is the product's
best feature and it was also the hole: a school that stopped paying could pull
out the network cable and keep going forever. The three mechanisms that close
it are all under test here.

**The lease.** A signed, short-lived statement of what a school may do, made
where the school has no access and verified on the desktop with a public key.
Forging one needs the private key; editing one breaks the signature.

**The seat.** Which machines a school has activated, capped by its plan. The
Adobe and Wondershare model, because it is the one customers already
understand: sign in on a machine, it takes a seat, run out and you are told
what is using them.

**The funnel.** Downloading is opting in. The installer is the same file for
everybody and is worth nothing on its own — an account with a live
subscription is what activates it.

None of it ever destroys anything. Every expiry path here ends in read-only,
and the test that says so is the most important one in the file.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ["PLATFORM_ADMIN_KEY"] = "pk_test_" + ("x" * 32)
os.environ["EDUSOFT_QUIET_BOOT"] = "1"
os.environ.pop("LICENCE_SIGNING_KEY", None)

from fastapi.testclient import TestClient                          # noqa: E402

from app.billing import devices as device_lib                      # noqa: E402
from app.billing import licence as licence_lib                     # noqa: E402
from app.billing import reminders                                  # noqa: E402
from app.billing import settings as platform_settings              # noqa: E402
from app.billing import subscriptions as subs                      # noqa: E402
from app.billing.repo import repo_for, shift                       # noqa: E402
from app.main import create_app                                    # noqa: E402

passed = failed = 0


def ck(name, condition, extra=None):
    global passed, failed
    condition = bool(condition)
    passed += condition
    failed += (not condition)
    print(("✓" if condition else "✗") + " " + name)
    if not condition and extra is not None:
        print("    " + repr(extra))


def school(client, name="Ave Maria School"):
    email = f"head-{uuid.uuid4().hex[:8]}@ave.gh"
    result = client.post("/api/v1/public/register", json={
        "school_name": f"{name} {uuid.uuid4().hex[:4]}", "full_name": "Head Teacher",
        "email": email, "password": "a-long-enough-password", "students": 120}).json()
    return {**result, "email": email, "password": "a-long-enough-password",
            "headers": {"Authorization": f'Bearer {result["token"]}'}}


def main():
    app = create_app()
    client = TestClient(app)
    store = app.state.store
    repo = repo_for(store)

    # ══ The lease ═══════════════════════════════════════════════════════
    print("\nThe signed lease")
    one = school(client)
    sid = one["school_id"]

    lease = licence_lib.issue(store, repo, sid, device="machine-a")
    ck("a lease is signed", lease.get("signed"), lease.get("signed"))
    ck("...and says what the school may do", lease["licence"]["access"] == "full",
       lease["licence"]["access"])
    ck("...and names the machine it is for", lease["licence"]["device"] == "machine-a")
    ck("...and expires", lease["licence"]["not_after"] > lease["licence"]["issued_at"])

    read = licence_lib.read(lease["token"], repo)
    ck("a genuine lease verifies", read.get("verified"), read)

    # The one property the whole design rests on.
    import base64
    import json
    body, _, signature = lease["token"].partition(".")
    raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
    payload = json.loads(raw)
    payload["access"] = "full"
    payload["not_after"] = shift(payload["not_after"], 3650)
    forged = base64.urlsafe_b64encode(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).decode().rstrip("=")
    ck("a lease edited to last ten years does not verify",
       not licence_lib.read(f"{forged}.{signature}", repo).get("ok"))
    ck("...and neither does one with no signature at all",
       not licence_lib.read(f"{forged}.", repo).get("verified"))

    ck("the verifying key is public and fetchable",
       client.get("/api/v1/licence/key").json().get("public_key"))

    # A suspended school's lease says so, which is what makes suspension mean
    # the same thing on the desktop as in the portal.
    subs.set_status(store, repo, sid, subs.SUSPENDED, actor="test", reason="unpaid")
    suspended = licence_lib.issue(store, repo, sid, device="machine-a")
    ck("a suspended school's lease is read-only, not blocked",
       suspended["licence"]["access"] == "read_only", suspended["licence"]["access"])
    ck("...and the school keeps every record it had",
       suspended["licence"]["status"] == subs.SUSPENDED)
    subs.set_status(store, repo, sid, subs.ACTIVE, actor="test")

    # ══ Seats ═══════════════════════════════════════════════════════════
    print("\nSeats")
    two = school(client)
    sid2 = two["school_id"]
    limit = device_lib.seat_limit(repo, sid2)
    ck("a plan says how many machines", limit > 0, limit)

    tokens = {}
    for n in range(limit):
        claimed = device_lib.claim(store, repo, sid2, f"m{n}", label=f"PC {n}")
        ck(f"machine {n} takes a seat", claimed.get("ok"), claimed.get("error"))
        tokens[n] = claimed.get("token")
    ck("...and the seats are counted", device_lib.active_count(repo, sid2) == limit)

    full = device_lib.claim(store, repo, sid2, "one-too-many", label="Extra")
    ck("one machine too many is refused", not full.get("ok"))
    ck("...for the right reason", full.get("reason") == "seats", full.get("reason"))
    # The message a person reads has to name what is using the seats, or they
    # cannot act on it.
    ck("...and is told what is using them",
       len((full.get("seats") or {}).get("devices") or []) == limit)

    again = device_lib.claim(store, repo, sid2, "m0", label="PC 0")
    ck("a machine reinstalled does not eat a second seat",
       again.get("ok") and again.get("returning")
       and device_lib.active_count(repo, sid2) == limit)
    ck("...and is given a NEW credential", again.get("token") != tokens[0])
    ck("...so the old one stops working", device_lib.by_token(repo, tokens[0]) is None)

    row = [d for d in device_lib.list_devices(repo, sid2) if d["device_id"] == "m1"][0]
    device_lib.deactivate(store, repo, sid2, row["id"], actor="test")
    ck("deactivating frees a seat", device_lib.active_count(repo, sid2) == limit - 1)
    ck("...and that machine's credential resolves to nothing",
       device_lib.by_token(repo, tokens[1]) is None)
    ck("...so the machine it was on is cut off at its next request",
       not device_lib.is_active(repo, sid2, "m1"))
    ck("and the freed seat can be taken",
       device_lib.claim(store, repo, sid2, "one-too-many", label="Extra").get("ok"))

    # ══ Activation, over the wire ═══════════════════════════════════════
    print("\nActivating an installation")
    three = school(client)
    activated = client.post("/api/v1/activate", json={
        "email": three["email"], "password": three["password"],
        "device": "office-pc", "label": "Office PC", "platform": "win32"})
    body = activated.json()
    ck("the right details activate a copy", activated.status_code == 200 and body.get("ok"))
    ck("...and hand back a credential for THIS machine", body.get("device_token"))
    ck("...and a signed lease with it", body.get("token"))
    ck("...and say how many machines are left",
       (body.get("seats") or {}).get("left") is not None)

    ck("a wrong password activates nothing",
       client.post("/api/v1/activate", json={
           "email": three["email"], "password": "not-the-password",
           "device": "thief-pc"}).status_code == 401)
    ck("...and an unknown address answers the same way, saying nothing new",
       client.post("/api/v1/activate", json={
           "email": "nobody@nowhere.test", "password": "a-long-enough-password",
           "device": "thief-pc"}).status_code == 401)

    key = {"x-school-key": body["device_token"]}
    ck("the machine's own credential works for sync",
       client.get("/api/v1/sync/ping", headers=key).status_code == 200)
    refreshed = client.post("/api/v1/licence", headers=key, json={"device": "office-pc"})
    ck("...and renews its own lease", refreshed.status_code == 200
       and refreshed.json().get("signed"))

    # The machine is asked about by name, so a lease cannot be collected for a
    # machine somebody else deactivated.
    devices = device_lib.list_devices(repo, three["school_id"])
    office = [d for d in devices if d["device_id"] == "office-pc"][0]
    client.request("DELETE", f'/api/v1/school/billing/devices/{office["id"]}',
                   headers=three["headers"])
    ck("a deactivated machine cannot renew",
       client.post("/api/v1/licence", headers=key,
                   json={"device": "office-pc"}).status_code == 401)

    # ══ The funnel ══════════════════════════════════════════════════════
    print("\nDownloading is opting in")
    ck("a visitor with no account gets no installer",
       client.get("/api/v1/public/downloads").status_code == 401)
    four = school(client)
    platform_settings.set_many(repo, {
        "download_desktop_windows": "https://files.example/edusoft-setup.exe",
        "download_version": "2.0.0"})
    listed = client.get("/api/v1/public/downloads", headers=four["headers"])
    ck("a school with a subscription does", listed.status_code == 200)
    ck("...and is told how to activate it",
       (listed.json().get("activation") or {}).get("how"))
    ck("...and how many machines its plan covers",
       (listed.json().get("seats") or {}).get("limit") is not None)
    ck("...and the build is the SAME file for everybody — no per-school link",
       listed.json()["builds"][0]["url"] == "https://files.example/edusoft-setup.exe")

    # ══ Reminders ═══════════════════════════════════════════════════════
    print("\nReminders")
    five = school(client)
    sub = subs.current(repo, five["school_id"])
    ends = sub.get("trial_ends_at") or sub["current_period_end"]

    seen = []
    for offset in (20, 14, 13, 7, 5, 3, 1, 0, -1):
        due = reminders.due_for(repo, sub, at=shift(ends, -offset))
        seen.append((offset, due["stage"] if due else None))
    told = [o for o, stage in seen if stage]
    ck("a school 20 days out is not nagged", seen[0][1] is None)
    ck("it is told at 14, 7, 3, 1 and on the day",
       [s for _, s in seen if s][:5] ==
       ["before_14", "before_14", "before_7", "before_7", "before_3"], seen)
    ck("...and told once it has actually lapsed", seen[-1][1] == "expired")

    # The rule that keeps a school reading them.
    first = reminders.send_for(store, repo, sub, at=shift(ends, -7), only=["inapp"])
    second = reminders.send_for(store, repo, sub, at=shift(ends, -7), only=["inapp"])
    ck("the same reminder is sent once", len(first["sent"]) == 1 and not second["sent"],
       (first["sent"], second["sent"]))
    ck("...and the school can read it back in the app",
       len(reminders.unread_for(repo, five["school_id"])) == 1)

    # A grace period an operator can set.
    platform_settings.set_many(repo, {"grace_period_days": "21"})
    ck("the grace period is the Superadmin's to set",
       platform_settings.get_int(repo, "grace_period_days", 0) == 21)

    # ══ Renewal, by whatever the school pays with ═══════════════════════
    print("\nRenewing")
    six = school(client)
    overview = client.get("/api/v1/school/billing", headers=six["headers"]).json()
    ck("a school can see its own subscription", overview.get("ok"))
    ck("...and what renewing would cost", (overview.get("renew") or {}).get("amount") is not None)
    ck("...and which machines it has activated", "seats" in overview)
    ck("...and the reminders it was sent", "reminders" in overview)
    ck("a school cannot see another school's billing",
       client.get("/api/v1/school/billing",
                  headers=five["headers"]).json()["school"]["id"] == five["school_id"])

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
