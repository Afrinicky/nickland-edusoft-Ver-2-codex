"""What a fresh platform opens on — and nothing more than that.

Three plans, sixteen features, the grid saying which plan holds which, and the
platform's own settings. Every one of them is a ROW, seeded once and then the
Superadmin's to change. Nothing in this file is consulted at runtime after the
seed: the pricing page, the checkout, the invoice and the entitlement check all
read the tables, so a price changed in the console is the price everywhere,
immediately, with no deployment.

That is the whole point of §6 and §16 of the brief, and it is worth being blunt
about what it forbids: there must be no ``if plan == "pro"`` anywhere in this
codebase. Grep for one before adding anything to this file.

Seeding is insert-if-absent. A restart never overwrites what an operator has
since changed — the alternative is a deployment that silently resets Pro's
price back to three cedis on a Tuesday afternoon.
"""

# ── The features ────────────────────────────────────────────────────────────
# The first ten keys ARE the application's modules (app/school/access.py
# MODULES), deliberately: permission and entitlement then speak one vocabulary,
# and the enforcement point can ask both questions about the same word. The
# rest are platform capabilities that were never modules.
#
# `core` means the feature cannot be withheld from any plan. Signing in, seeing
# your own school, and paying your bill are not upsells, and a plan that could
# switch them off would be a plan that can lock a school out of the screen it
# needs to give Nickland money.
FEATURES = [
    {"feature_key": "dashboard", "name": "Dashboard", "category": "Core", "is_core": True,
     "description": "Home dashboard, summaries and charts."},
    {"feature_key": "students", "name": "Student Management", "category": "Academics", "is_core": True,
     "description": "Student records, admissions and profiles."},
    {"feature_key": "academics", "name": "Academics", "category": "Academics", "is_core": False,
     "description": "Scores, report cards, attendance, homework and the timetable."},
    {"feature_key": "staff", "name": "Teacher & Staff", "category": "People", "is_core": False,
     "description": "Staff records, attendance and HR."},
    {"feature_key": "canteen", "name": "Canteen", "category": "Money", "is_core": False,
     "description": "Daily canteen collection and canteen debtors."},
    {"feature_key": "fees", "name": "Fees & Bills", "category": "Money", "is_core": False,
     "description": "Bills, fee payments, templates and debtors."},
    {"feature_key": "finance", "name": "Finance & Inventory", "category": "Money", "is_core": False,
     "description": "Income, expenses, transport, inventory and the finance audit."},
    {"feature_key": "payroll", "name": "Payroll", "category": "Money", "is_core": False,
     "description": "Staff salaries, SSNIT/PAYE and payslips."},
    {"feature_key": "notifications", "name": "Notifications", "category": "People", "is_core": False,
     "description": "Messages to parents and staff."},
    {"feature_key": "settings", "name": "Settings & Users", "category": "Core", "is_core": True,
     "description": "School setup, user accounts and access control."},
    {"feature_key": "parent_portal", "name": "Parent Portal", "category": "Platform", "is_core": False,
     "description": "Parents see results, bills and receipts online."},
    {"feature_key": "online_payments", "name": "Online Payments", "category": "Platform", "is_core": False,
     "description": "Parents settle school fees over the internet."},
    {"feature_key": "sms", "name": "SMS", "category": "Platform", "is_core": False,
     "description": "Text messages to parents, from the school."},
    {"feature_key": "advanced_reports", "name": "Advanced Reports", "category": "Platform", "is_core": False,
     "description": "The full reporting set, exportable."},
    {"feature_key": "analytics", "name": "Analytics", "category": "Platform", "is_core": False,
     "description": "Trends across terms, classes and collections."},
    {"feature_key": "ai_assistant", "name": "AI Assistant", "category": "Platform", "is_core": False,
     "description": "Written help with reports, remarks and letters."},
]

# ── The plans ───────────────────────────────────────────────────────────────
# Prices are per pupil per month, in cedis, and are a starting point. The Free
# plan is the trial: it costs nothing, it is capped at a hundred pupils, and it
# lands on Pro when it ends.
PLANS = [
    {
        "plan_id": "free", "name": "Free", "sort_order": 1,
        "tagline": "Try the whole system",
        "description": "A full-featured trial of Edusoft for a limited period, "
                       "for schools up to a hundred pupils.",
        "currency": "GHS", "billing_interval": "monthly",
        "base_price": 0, "price_per_student": 0, "included_students": 0,
        "max_students": 100,
        "trial_enabled": True, "trial_days": 30, "trial_to_plan": "pro",
        "requires_payment_method": True,
        "is_active": True, "is_public": True,
        "limits": {"sms_credits": 0},
    },
    {
        "plan_id": "pro", "name": "Pro", "sort_order": 2,
        "tagline": "For the school that is running",
        "description": "Everything a school needs day to day — pupils, academics, "
                       "fees, payroll and the parent portal — billed per pupil.",
        "currency": "GHS", "billing_interval": "monthly",
        "base_price": 0, "price_per_student": 3.00, "included_students": 0,
        "max_students": None,
        "trial_enabled": True, "trial_days": 30, "trial_to_plan": "pro",
        "requires_payment_method": True,
        "is_active": True, "is_public": True,
        "limits": {"sms_credits": 200},
    },
    {
        "plan_id": "max", "name": "Max", "sort_order": 3,
        "tagline": "The complete platform",
        "description": "Every module, every report, and the analytics and "
                       "assistance that come with them.",
        "currency": "GHS", "billing_interval": "monthly",
        "base_price": 0, "price_per_student": 5.00, "included_students": 0,
        "max_students": None,
        "trial_enabled": True, "trial_days": 30, "trial_to_plan": "max",
        "requires_payment_method": True,
        "is_active": True, "is_public": True,
        "limits": {"sms_credits": 1000},
    },
]

# Which plan holds which feature. Anything a plan does not list is off for it —
# except a core feature, which is on everywhere whatever this says.
PLAN_FEATURES = {
    "free": ["dashboard", "students", "academics", "staff", "canteen", "fees",
             "notifications", "settings", "parent_portal"],
    "pro":  ["dashboard", "students", "academics", "staff", "canteen", "fees",
             "finance", "payroll", "notifications", "settings", "parent_portal",
             "online_payments", "sms"],
    "max":  [f["feature_key"] for f in FEATURES],
}

# ── The platform's own rules ────────────────────────────────────────────────
# Read through app/billing/settings.py, which gives each one a type and a
# fallback so a row somebody emptied by hand cannot take the service down.
SETTINGS = {
    "currency": "GHS",
    "tax_rate": "0",
    "tax_label": "VAT",
    "trial_enabled": "1",
    "default_plan": "pro",
    # How long a school keeps working after a payment fails. PAST_DUE is the
    # first week — nothing changes, the school is simply told. GRACE_PERIOD is
    # the fortnight after that, when the warnings get louder. Only then is
    # anything withheld.
    "past_due_days": "7",
    "grace_period_days": "14",
    "invoice_due_days": "7",
    "invoice_prefix": "NE",
    # Which pupils are billable. Comma-separated `students.status` values; the
    # default counts the ones who are there and nobody who has left.
    "billable_student_statuses": "Active",
    # §28: a school enrolled before any of this existed must not lose access on
    # the day billing ships. It keeps working, on the plan named below, until
    # somebody deliberately subscribes it. Defaults ON, and the day it is
    # turned off is a decision an operator makes with their eyes open.
    "grandfather_existing": "1",
    "grandfather_plan": "max",
    # What a SUSPENDED school may still do. `read_only` lets them in to see
    # their own records and settle the bill; `blocked` shuts the door. Never
    # anything that deletes: suspension does not destroy data, ever.
    "suspended_access": "read_only",
    # ── The offline licence (app/billing/licence.py) ──
    # How long a desktop may run on one lease before it has to ask again, and
    # how long it may keep running while asking is failing. The first is the
    # answer to "how long can a school that stopped paying keep working"; the
    # second is the answer to "how long can a school with no internet keep
    # working", and they are different questions with different right answers.
    "licence_lease_days": "14",
    "licence_lease_grace_days": "7",
    "licence_signing_key": "",
    # What a desktop does when both have run out. `read_only` leaves every
    # record readable, printable and exportable and refuses every write, which
    # is what §11's "suspension never deletes data" means on a machine we do
    # not control. `blocked` shuts the door.
    "licence_expired_access": "read_only",

    # ── Renewal reminders (app/billing/reminders.py) ──
    # Days before the subscription ends on which a school is reminded. Claude's
    # own subscription reminders are the model: told early, told again nearer,
    # told on the day, and told once more when it has lapsed — never nagged
    # daily, and every message carries the button that fixes it.
    "reminder_days_before": "14,7,3,1",
    "reminders_enabled": "1",
    "reminder_channels": "inapp,email,sms",
    # Where the Renew button in a reminder points. Blank means "work it out
    # from the school's own subdomain", which is right for a normal deployment.
    "portal_url": "",
    # The PLATFORM's own SMS key, for telling a school its subscription is
    # ending. Deliberately not the school's: a school being told it has lapsed
    # must not pay for the message, and a suspended school may have no credit
    # left to send it with.
    # ── Downloads (§: the installers the website hands out) ──
    # The SAME file for everybody. There are no per-customer builds: a build
    # that has to be kept secret is a build that leaks once and is then
    # worthless forever, which is why Adobe, Wondershare and everyone else
    # licenses at RUN time by sign-in instead. The download is free and inert;
    # the account is what is worth something.
    "download_desktop_windows": "",
    "download_desktop_mac": "",
    "download_android": "",
    "download_version": "",
    "download_notes": "",
    # How many machines a school may activate when its plan does not say.
    "default_device_seats": "5",

    "platform_sms_provider": "arkesel",
    "platform_sms_key": "",
    "platform_sms_sender": "",

    # ── Sending email (app/mail.py) ──
    "smtp_host": "",
    "smtp_port": "587",
    "smtp_user": "",
    "smtp_password": "",
    "smtp_from": "",
    "smtp_from_name": "",
    "smtp_starttls": "1",

    "support_email": "support@nicklandedusoft.com",
    "support_phone": "",
    "company_name": "Nickland Sales",
    "product_name": "Nickland Edusoft",
}


def seed(repo):
    """Put the defaults in, where they are not already.

    Idempotent and cheap — a handful of reads on a table with tens of rows —
    so it runs at boot on every worker rather than being a deployment step
    somebody has to remember. Returns what it actually created, which is what
    the boot report prints.
    """
    made = {"plans": 0, "features": 0, "plan_features": 0, "settings": 0}

    existing_features = {f["feature_key"] for f in repo.find("features")}
    for order, feature in enumerate(FEATURES, start=1):
        if feature["feature_key"] in existing_features:
            continue
        repo.insert("features", {**feature, "sort_order": order})
        made["features"] += 1

    existing_plans = {p["plan_id"] for p in repo.find("subscription_plans")}
    for plan in PLANS:
        if plan["plan_id"] in existing_plans:
            continue
        repo.insert("subscription_plans", dict(plan))
        made["plans"] += 1

    held = {(pf["plan_id"], pf["feature_key"]) for pf in repo.find("plan_features")}
    for plan_id, keys in PLAN_FEATURES.items():
        granted = set(keys)
        for feature in FEATURES:
            key = feature["feature_key"]
            if (plan_id, key) in held:
                continue
            repo.insert("plan_features", {
                "plan_id": plan_id, "feature_key": key,
                "enabled": key in granted, "limit_value": None})
            made["plan_features"] += 1

    existing_settings = {s["key"] for s in repo.find("platform_settings")}
    for key, value in SETTINGS.items():
        if key in existing_settings:
            continue
        repo.insert("platform_settings", {"key": key, "value": str(value)})
        made["settings"] += 1

    return made
