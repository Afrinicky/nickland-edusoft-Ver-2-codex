"""The access ladder — a translation of ``electron/ipc/_access.js``.

The permission tables store four independent booleans per (role/user, module):
can_view / can_create / can_edit / can_delete. That is precise but unreadable to
a school owner, so the whole system is presented as ONE ladder of levels that
build on each other:

    No access → View → Contribute → Manage → Full

The ladder maps onto the same four booleans, so nothing about enforcement
changes: a level is a friendlier name for a canonical combination. Reads
tolerate any legacy combination by reducing it to the highest *contiguous*
level, which never over-reports access.

Kept literal against the original. If one changes, both change.
"""

LEVELS = [
    {"key": "no", "order": 0, "label": "No access", "short": "None",
     "description": "Hidden entirely — the module does not appear for this person."},
    {"key": "view", "order": 1, "label": "View", "short": "View",
     "description": "Can open and read, but not change anything."},
    {"key": "contribute", "order": 2, "label": "Contribute", "short": "Add",
     "description": "View, plus add new entries (record a payment, enter marks)."},
    {"key": "manage", "order": 3, "label": "Manage", "short": "Edit",
     "description": "Contribute, plus edit or correct existing entries."},
    {"key": "full", "order": 4, "label": "Full", "short": "Full",
     "description": "Manage, plus delete — full control of the module."},
]
LEVEL_KEYS = [l["key"] for l in LEVELS]

MODULES = [
    {"key": "dashboard", "label": "Dashboard", "group": "Overview",
     "description": "Home dashboard, summaries and charts."},
    {"key": "students", "label": "Students", "group": "Academics",
     "description": "Student records, admissions and profiles."},
    {"key": "academics", "label": "Academics", "group": "Academics",
     "description": "Scores, report cards, attendance, homework and the timetable."},
    {"key": "canteen", "label": "Canteen", "group": "Money",
     "description": "Daily canteen collection and canteen debtors."},
    {"key": "fees", "label": "Fees & Bills", "group": "Money", "sensitive": True,
     "description": "Bills, fee payments, templates and debtors."},
    {"key": "payroll", "label": "Payroll", "group": "Money", "sensitive": True,
     "description": "Staff salaries, SSNIT/PAYE and payslips."},
    {"key": "finance", "label": "Finance & Inventory", "group": "Money", "sensitive": True,
     "description": "Income, expenses, transport, inventory and the finance audit."},
    {"key": "staff", "label": "Staff / HR", "group": "People",
     "description": "Staff records, attendance and HR."},
    {"key": "notifications", "label": "Notifications", "group": "People",
     "description": "SMS and email to parents and staff."},
    {"key": "settings", "label": "Settings & Users", "group": "System", "sensitive": True,
     "description": "School setup, user accounts and this access-control screen."},
]
MODULE_KEYS = [m["key"] for m in MODULES]

# Designations always granted everything, whatever the stored rows say.
ALWAYS_FULL = ["Proprietor", "Administrator"]

_ORDER = {l["key"]: l["order"] for l in LEVELS}


def level_to_perms(level):
    o = _ORDER.get(level, 0)
    return {
        "can_view": 1 if o >= 1 else 0,
        "can_create": 1 if o >= 2 else 0,
        "can_edit": 1 if o >= 3 else 0,
        "can_delete": 1 if o >= 4 else 0,
    }


def perms_to_level(p):
    """Four booleans → the highest CONTIGUOUS level.

    A non-ladder combination (view+delete but not create/edit, which the old
    checkbox UI allowed) reduces to the last level whose every rung is present,
    so access is never over-reported.
    """
    if not p or not p.get("can_view"):
        return "no"
    if not p.get("can_create"):
        return "view"
    if not p.get("can_edit"):
        return "contribute"
    if not p.get("can_delete"):
        return "manage"
    return "full"


def granted_count(level_map):
    return sum(1 for m in MODULE_KEYS if level_map.get(m) and level_map[m] != "no")


def is_valid_level(level):
    return level in LEVEL_KEYS
