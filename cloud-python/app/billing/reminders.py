"""Telling a school its subscription is about to end, before it ends.

Modelled on how a consumer subscription does it, because that is what schools
are used to and it is what works: told early, told again nearer the time, told
on the day, and told once more when it has actually lapsed. Never nagged daily.
Every message carries the one button that fixes it.

    14 days   "Your Edusoft subscription renews on the 3rd."
     7 days   "…renews in a week."
     3 days   "…in three days."
     1 day    "…tomorrow."
     0        "Your subscription has ended. You have N days to renew."
    grace     "Access will be limited on the 17th unless this is settled."
    suspended "Your subscription is suspended. Nothing has been deleted."

Three channels, and the same words in each: the application itself (a banner
and a notice list), email, and SMS. A school that never opens the portal still
gets the text message; a school that changed its phone number still gets the
email; and neither is a different message from the other, so a bursar reading
one and a head teacher reading the other are looking at the same fact.

**Sent once.** `billing_reminders` has a UNIQUE over (school, stage, channel,
period) and every send is written there BEFORE it is attempted. A run that is
retried, or two workers racing, produces one message. This matters more than it
sounds: an SMS sent twice is charged twice and reads as a broken system.

**Never sent about something that is not true.** The schedule is derived from
the subscription's own dates on each run, not from a queue written earlier — so
a school that paid yesterday gets no "you are about to lapse" today, because
the row it would have been derived from no longer says that.
"""
from . import audit as billing_audit
from . import licence as licence_lib
from . import settings as platform_settings
from . import subscriptions as subs
from .repo import now_iso, parse_iso

# The stages, in the order a school meets them.
BEFORE = "before"        # before_14, before_7 … from `reminder_days_before`
EXPIRED = "expired"
GRACE = "grace"
SUSPENDED = "suspended"

CHANNELS = ("inapp", "email", "sms")


def enabled(repo):
    return platform_settings.get_bool(repo, "reminders_enabled", True)


def channels(repo):
    wanted = platform_settings.get_list(repo, "reminder_channels", CHANNELS)
    return [c for c in wanted if c in CHANNELS]


def schedule(repo):
    """The days-before marks, nearest first.

    Ascending, because the question each run asks is "which is the NEAREST mark
    this school has now passed" — and answering it with the furthest one means
    every school gets `before_14` on every day of the fortnight, and therefore
    exactly one reminder ever.

    Zero is always a mark whether it was configured or not: the day a
    subscription actually ends is the day a school most needs to be told, and
    leaving it out would fold it into the previous mark and say nothing.
    """
    days = platform_settings.get_ints(repo, "reminder_days_before", [14, 7, 3, 1])
    return sorted({max(0, int(d)) for d in days} | {0})


# ── What, if anything, should a school be told today ────────────────────────
def due_for(repo, subscription, at=None):
    """The stage this subscription is at, or None when there is nothing to say.

    One stage at a time, deliberately. A school that has just lapsed is told it
    has lapsed; it is not also sent the "3 days left" it never got because
    nobody ran the cron over the weekend. Catching up on missed reminders is
    telling somebody about a deadline that has already passed.
    """
    at = at or now_iso()
    when = parse_iso(at)
    status = subscription.get("status")

    if status == subs.SUSPENDED:
        return {"stage": SUSPENDED, "period_end": _period(subscription), "days": 0}

    if status in (subs.PAST_DUE, subs.GRACE_PERIOD):
        ends = parse_iso(subscription.get("grace_ends_at"))
        left = (ends - when).days if ends else None
        return {"stage": GRACE, "period_end": _period(subscription),
                "days": left, "grace_ends_at": subscription.get("grace_ends_at") or ""}

    # A trial counts down to its own end; anything else to the end of the paid
    # period. Both are "the day this stops", which is the only thing a school
    # reading the message cares about.
    end_field = ("trial_ends_at" if status == subs.TRIALING else "current_period_end")
    ends = parse_iso(subscription.get(end_field))
    if not ends:
        return None
    left = (ends - when).days

    if left < 0:
        return {"stage": EXPIRED, "period_end": _period(subscription), "days": left}

    for mark in schedule(repo):
        if left <= mark:
            # The NEAREST mark this school has reached. On day 6 of a 14/7/3/1
            # schedule that is `before_7` — which was already sent on day 7, so
            # days 6, 5 and 4 say nothing at all. That silence is the feature:
            # it is the difference between four reminders and a fortnight of
            # daily nagging that a school stops reading by the third morning.
            return {"stage": f"{BEFORE}_{mark}", "period_end": _period(subscription),
                    "days": left, "ends_at": subscription.get(end_field) or ""}
    return None


def _period(subscription):
    """What makes this term's reminders different from next term's."""
    return str(subscription.get("current_period_end")
               or subscription.get("trial_ends_at") or "")[:10]


# ── Saying it ───────────────────────────────────────────────────────────────
def compose(repo, store, school_id, subscription, due):
    """The words, once, for all three channels.

    Written here rather than per channel so that the SMS is a shortened version
    of the email and not a different message — the commonest way a reminder
    system loses a customer's trust is by saying two different things.
    """
    school = _school(store, school_id)
    name = (school or {}).get("name") or "your school"
    product = platform_settings.get(repo, "product_name", "Nickland Edusoft")
    link = licence_lib.renewal_url(repo, school_id)
    days = due.get("days")
    stage = due["stage"]

    if stage == SUSPENDED:
        subject = f"{product}: {name}'s subscription is suspended"
        body = (f"{name}'s {product} subscription is suspended because the "
                f"subscription is unpaid.\n\n"
                f"Nothing has been deleted. Every pupil, mark and receipt is "
                f"still there, and everything comes back the moment the "
                f"outstanding invoice is settled.")
        short = f"{product}: {name}'s subscription is suspended. Nothing is lost. Renew: {link}"
    elif stage == GRACE:
        ends = str(due.get("grace_ends_at") or "")[:10]
        subject = f"{product}: {name}'s subscription is unpaid"
        body = (f"{name}'s {product} subscription has not been paid.\n\n"
                + (f"Access will be limited after {ends} unless it is settled. "
                   if ends else "Access will be limited shortly unless it is settled. ")
                + "Nothing will be deleted at any point.")
        short = (f"{product}: {name}'s subscription is unpaid"
                 + (f" and access is limited after {ends}." if ends else ".")
                 + f" Renew: {link}")
    elif stage == EXPIRED:
        subject = f"{product}: {name}'s subscription has ended"
        body = (f"{name}'s {product} subscription has ended.\n\n"
                f"Renew it to keep using the system. Nothing has been deleted, "
                f"and there is a grace period before anything is limited.")
        short = f"{product}: {name}'s subscription has ended. Renew: {link}"
    else:
        when = ("today" if days == 0 else "tomorrow" if days == 1
                else f"in {days} days")
        subject = f"{product}: {name}'s subscription renews {when}"
        body = (f"{name}'s {product} subscription renews {when}"
                + (f" ({str(due.get('ends_at') or '')[:10]})." if due.get("ends_at") else ".")
                + "\n\nYou can renew it yourself — by mobile money or card — from "
                  "the Billing page.")
        short = f"{product}: {name}'s subscription renews {when}. Renew: {link}"

    if link:
        body += f"\n\nRenew here: {link}\n"
    support = platform_settings.get(repo, "support_email", "")
    if support:
        body += f"\nIf something is wrong, reply to this or write to {support}.\n"

    return {"subject": subject, "body": body, "sms": short[:320], "link": link}


def _school(store, school_id):
    try:
        return store.get_school(school_id)
    except Exception:
        return None


def recipients(store, school_id):
    """Who to tell: the people who signed this school up, and its own contacts.

    Both, because they are often not the same person — the head teacher
    registered and the bursar pays — and a reminder that reaches only one of
    them is a reminder that gets forgotten on the day that one is away.
    """
    from .. import identity
    emails, phones = [], []
    try:
        for row in identity.directory_entry(store, school_id) or []:
            if row.get("email"):
                emails.append(row["email"])
    except Exception:
        pass
    school = _school(store, school_id) or {}
    for key in ("contact_email", "email"):
        if school.get(key):
            emails.append(school[key])
    for key in ("contact_phone", "phone"):
        if school.get(key):
            phones.append(school[key])
    # Ordered, de-duplicated, case-insensitive on the address.
    seen, out_emails = set(), []
    for address in emails:
        low = str(address).strip().lower()
        if low and low not in seen:
            seen.add(low)
            out_emails.append(str(address).strip())
    seen, out_phones = set(), []
    for phone in phones:
        digits = "".join(c for c in str(phone) if c.isdigit())
        if digits and digits not in seen:
            seen.add(digits)
            out_phones.append(str(phone).strip())
    return {"emails": out_emails[:5], "phones": out_phones[:3]}


def already_sent(repo, school_id, stage, channel, period_end):
    return bool(repo.find_one("billing_reminders", {
        "school_id": school_id, "stage": stage,
        "channel": channel, "period_end": period_end}))


def _claim(repo, school_id, subscription, stage, channel, period_end, recipient):
    """Write the row BEFORE sending.

    The UNIQUE index is what makes two runs safe: the second insert loses and
    the message is not sent twice. Claiming after a successful send would leave
    a window in which a crash means a school is told the same thing again.
    """
    if already_sent(repo, school_id, stage, channel, period_end):
        return None
    try:
        return repo.insert("billing_reminders", {
            "school_id": school_id,
            "subscription_id": subscription.get("id"),
            "stage": stage, "channel": channel, "period_end": period_end,
            "recipient": str(recipient or "")[:200],
            "status": "sending", "sent_at": now_iso(), "created_at": now_iso(),
        })
    except Exception:
        # The unique index refused it: somebody else claimed it first.
        return None


def send_for(store, repo, subscription, at=None, only=None):
    """Remind one school, if there is anything to say. Returns what it did."""
    school_id = subscription["school_id"]
    due = due_for(repo, subscription, at=at)
    if not due:
        return {"ok": True, "sent": [], "stage": None}

    stage, period = due["stage"], due["period_end"]
    message = compose(repo, store, school_id, subscription, due)
    who = recipients(store, school_id)
    wanted = [c for c in channels(repo) if (only is None or c in only)]
    done = []

    for channel in wanted:
        if channel == "inapp":
            row = _claim(repo, school_id, subscription, stage, channel, period, "")
            if row:
                repo.update("billing_reminders", row["id"], {
                    "status": "sent", "detail": message["subject"]})
                done.append({"channel": channel, "ok": True})

        elif channel == "email":
            from .. import mail
            for address in who["emails"]:
                row = _claim(repo, school_id, subscription, stage, channel, period, address)
                if not row:
                    continue
                result = mail.send(repo, address, message["subject"], message["body"])
                repo.update("billing_reminders", row["id"], {
                    "status": "sent" if result.get("ok") else "failed",
                    "detail": str(result.get("error") or message["subject"])[:500]})
                done.append({"channel": channel, "to": address, "ok": bool(result.get("ok")),
                             "error": result.get("error")})

        elif channel == "sms":
            for phone in who["phones"]:
                row = _claim(repo, school_id, subscription, stage, channel, period, phone)
                if not row:
                    continue
                result = _sms(store, repo, school_id, phone, message["sms"])
                repo.update("billing_reminders", row["id"], {
                    "status": "sent" if result.get("ok") else "failed",
                    "detail": str(result.get("error") or "")[:500]})
                done.append({"channel": channel, "to": phone, "ok": bool(result.get("ok")),
                             "error": result.get("error")})

    if done:
        billing_audit.write(store, "reminder_sent", school_id=school_id, actor="system",
                            detail=f"{stage}: " + ", ".join(
                                f'{d["channel"]}{"" if d.get("ok") else " (failed)"}'
                                for d in done))
    return {"ok": True, "stage": stage, "days": due.get("days"), "sent": done}


def _sms(store, repo, school_id, phone, text):
    """Through the PLATFORM's own Arkesel key, not the school's.

    A school being told its subscription has lapsed must not be told using its
    own SMS credits — and a suspended school may well have none left. The
    platform's key is set in the console, beside the payment gateway.
    """
    from .. import gateways
    provider_id = platform_settings.get(repo, "platform_sms_provider", "arkesel")
    provider = gateways.sms.provider(provider_id)
    if not provider:
        return {"ok": False, "error": "No SMS provider is configured for the platform."}
    credentials = {
        "api_key": platform_settings.get(repo, "platform_sms_key", ""),
        "sender_id": platform_settings.get(repo, "platform_sms_sender", "")
                     or platform_settings.get(repo, "product_name", "EduSoft"),
    }
    if not credentials["api_key"]:
        return {"ok": False, "error": "No platform SMS key is configured."}
    return provider.send(gateways.config_for(provider_id, credentials), phone, text)


def run(store, repo, at=None, school_id=None, only=None):
    """Every live subscription that has something to hear. The cron's entry."""
    if not enabled(repo):
        return {"ok": True, "reminded": 0, "reason": "reminders are switched off"}
    scope = {"school_id": school_id} if school_id else {}
    results = []
    for subscription in repo.find("subscriptions",
                                  {**scope, "status": ("in", list(subs.LIVE))}):
        try:
            outcome = send_for(store, repo, subscription, at=at, only=only)
        except Exception as exc:
            # One school's bad phone number must not end the run for the rest.
            outcome = {"ok": False, "school_id": subscription["school_id"],
                       "error": f"{exc.__class__.__name__}"}
        if outcome.get("sent") or outcome.get("error"):
            results.append({"school_id": subscription["school_id"], **outcome})
    return {"ok": True, "reminded": len(results), "results": results}


# ── What the application shows ──────────────────────────────────────────────
def unread_for(repo, school_id, limit=20):
    """The school's own reminder list, newest first — the in-app half."""
    rows = repo.find("billing_reminders",
                     {"school_id": school_id, "channel": "inapp"},
                     order_by="id", desc=True)
    return rows[:limit]


def mark_read(repo, school_id, reminder_id=None):
    rows = ([repo.get("billing_reminders", reminder_id)] if reminder_id
            else unread_for(repo, school_id, limit=100))
    touched = 0
    for row in rows:
        if row and str(row.get("school_id")) == str(school_id) and not row.get("read_at"):
            repo.update("billing_reminders", row["id"], {"read_at": now_iso()})
            touched += 1
    return {"ok": True, "marked": touched}
