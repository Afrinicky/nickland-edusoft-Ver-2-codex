"""The school at a glance, and the system behind it.

Two things live here:

  * The OVERVIEW reads every portal opens on — the dashboard
    (``electron/ipc/dashboard.js``), and the administration summary.
  * The SYSTEM: user accounts, the access ladder, the audit trail and the
    school's settings (``electron/ipc/auth.js``, ``access.js``, ``settings.js``,
    ``audit_log.js``).

The system half is the Super Admin's alone, and the online system is stricter
about it than the desktop is, deliberately:

  * A secret is written and never read back. Settings answer whether a gateway
    key is configured, never what it is.
  * Deactivating an account or changing its role revokes every session it
    holds, at once. On a desktop in a locked office a stale session is a
    theoretical problem; over the internet it is somebody else's phone.
  * The last administrator cannot be deactivated or demoted, and nobody can do
    either to the account they are signed in with. Locking a school out of its
    own system from a phone is a support call nobody enjoys.
  * Approving a password reset is NOT here and should not be added. The whole
    point of the code an administrator reads out is that the person asking is
    standing in front of them.
"""
import datetime

from . import access, security, session
from .billing import round2

# The settings a portal may read and write. A whitelist, not a filter: the
# settings table also holds counters, gateway secrets and sync keys, and a
# blanket "everything except…" is one forgotten key away from serving one.
SETTINGS_READABLE = [
    "school_name", "school_abbreviation", "school_motto", "school_type", "school_address",
    "school_location", "school_digital_address", "school_phone_1", "school_phone_2",
    "school_email", "school_website", "school_whatsapp",
    "payment_currency", "canteen_daily_rate", "vacation_date", "reopening_date",
    "current_exam_title", "class_score_weight_pct", "exam_weight_pct",
    "ssnit_worker_pct", "ssnit_employer_pct", "feature_ssnit_enabled", "feature_paye_enabled",
    "school_ssnit_number", "school_tin",
    "payment_gateway", "paystack_public_key", "paystack_base_url", "paystack_callback_url",
    "online_payments_enabled", "online_payment_min", "online_payment_max",
    "online_token_ttl_days",
    # Appearance. The same six keys the desktop's Settings -> Appearance writes
    # and its stylesheet reads through CSS custom properties. They are here so a
    # school can set its colours from the browser as well as from the PC in the
    # office, and so the app can read back what was set.
    "school_color_primary", "school_color_accent",
    "school_color_background", "school_color_foreground",
    "ui_font_family", "ui_font_size_base",
    # The switches that decide whether a whole module exists. The desktop hides
    # the canteen outright for a school that does not run one; the app reads the
    # same flags, so the two agree about what this school is.
    "feature_canteen_enabled", "feature_notifications_enabled",
    "feature_leave_management_enabled", "feature_transport_enabled",
    "staff_clockin_enabled",
    # Grading and the academic calendar, which the settings screens edit.
    "grading_scheme", "pass_mark", "attendance_required_pct",
]
# Written, but never read back. A secret a screen can display is a secret a
# screenshot can carry out of the building.
SETTINGS_WRITE_ONLY = ["paystack_secret_key"]
SETTINGS_WRITABLE = set(SETTINGS_READABLE) | set(SETTINGS_WRITE_ONLY)


def _today():
    return datetime.date.today().isoformat()


# ── the school this morning ─────────────────────────────────────────────────

def overview(db, actor):
    """What a person is shown when they open their portal.

    Every section is present only if the account may see the module behind it.
    A head teacher without finance is shown a school with no money section, not
    one with zeroes in it — a zero is a claim, and it would be a false one.
    """
    term = db.one("SELECT * FROM terms WHERE is_current = 1")
    today = _today()
    out = {
        "ok": True, "date": today,
        "term": {"id": term["id"], "label": term["label"],
                 "start_date": term["start_date"], "end_date": term["end_date"]} if term else None,
        "school": {"name": db.get_setting("school_name", "School"),
                   "currency": db.get_setting("payment_currency", "GHS")},
        "may": {m: security.can(actor, m, "view") for m in access.MODULE_KEYS},
    }

    if security.can(actor, "students", "view"):
        out["enrolment"] = db.one("""
          SELECT count(*) AS total,
                 count(*) FILTER (WHERE gender = 'Male') AS boys,
                 count(*) FILTER (WHERE gender = 'Female') AS girls
            FROM students WHERE status = 'Active'""")
        out["by_class"] = db.all("""
          SELECT c.id, c.name, c.short_code, count(s.id) AS pupils
            FROM class_groups c
            LEFT JOIN students s ON s.current_class_id = c.id AND s.status = 'Active'
           GROUP BY c.id, c.name, c.short_code, c.level_order
           ORDER BY c.level_order, c.name""")
        att = db.one("""
          SELECT count(*) FILTER (WHERE a.status = 'present') AS present,
                 count(*) FILTER (WHERE a.status = 'absent') AS absent,
                 count(DISTINCT s.current_class_id) AS classes_marked
            FROM student_attendance a JOIN students s ON s.id = a.student_id
           WHERE a.date = %s""", (today,))
        marked = (att["present"] or 0) + (att["absent"] or 0)
        out["attendance"] = {
            **att,
            "classes_total": sum(1 for c in out["by_class"] if c["pupils"]),
            "rate": round((att["present"] or 0) / marked * 100) if marked else None,
        }

    if security.can(actor, "staff", "view"):
        st = db.one("""
          SELECT count(*) AS total, count(*) FILTER (WHERE role ILIKE %s) AS teaching
            FROM staff WHERE status = 'Active'""", ("%each%",))
        st["clocked_in"] = db.value(
            "SELECT count(*) FROM staff_attendance WHERE date = %s AND status = 'present'",
            (today,), 0)
        out["staff"] = st
        out.setdefault("approvals", {})["leave"] = db.value(
            "SELECT count(*) FROM leave_requests WHERE status = 'pending'", (), 0)

    if security.can(actor, "academics", "view"):
        out.setdefault("approvals", {})["lesson_notes"] = db.value(
            "SELECT count(*) FROM lesson_notes WHERE COALESCE(status,'draft') = 'submitted'", (), 0)

    if term and security.can(actor, "fees", "view"):
        f = db.one("""
          SELECT COALESCE(SUM(total_billed),0) AS billed, COALESCE(SUM(balance),0) AS outstanding
            FROM student_bills WHERE term_id = %s AND COALESCE(status,'active') = 'active'""",
                   (term["id"],))
        collected = db.value(
            "SELECT COALESCE(SUM(amount),0) FROM payments WHERE term_id = %s AND is_reversed = 0",
            (term["id"],), 0)
        out["fees"] = {
            "billed": round2(f["billed"]), "collected": round2(collected),
            "outstanding": round2(f["outstanding"]),
            "collection_rate": round(collected / f["billed"] * 100) if f["billed"] else 0,
        }

    if security.can(actor, "finance", "view") and term:
        income = db.value("""SELECT COALESCE(SUM(amount),0) FROM income_records
                              WHERE COALESCE(transaction_date, date) BETWEEN %s AND %s""",
                          (term["start_date"] or "1970-01-01", term["end_date"] or "2099-12-31"), 0)
        expense = db.value("""SELECT COALESCE(SUM(amount),0) FROM expense_records
                               WHERE COALESCE(transaction_date, date) BETWEEN %s AND %s""",
                           (term["start_date"] or "1970-01-01", term["end_date"] or "2099-12-31"), 0)
        out["ledger"] = {"income": round2(income), "expense": round2(expense),
                         "net": round2(income - expense)}

    if security.can(actor, "payroll", "view"):
        now = datetime.date.today()
        row = db.one("""
          SELECT count(*) AS n, COALESCE(SUM(net_salary),0) AS net,
                 count(*) FILTER (WHERE is_paid = 1) AS paid,
                 COALESCE(SUM(CASE WHEN is_paid = 1 THEN actual_amount_paid ELSE 0 END),0) AS paid_total
            FROM staff_salaries WHERE month = %s AND year = %s""", (now.month, now.year))
        out["payroll"] = {
            "month": now.month, "year": now.year, "staff": row["n"],
            "net": round2(row["net"]), "paid": row["paid"],
            "paid_total": round2(row["paid_total"]),
            "outstanding": max(0.0, round2(row["net"] - row["paid_total"])),
        }

    return out


def academic_overview(db, actor, term_id=None):
    """Class by class, how the school is doing. The same averages the
    broadsheet shows, one level up — so a head teacher can see which class is
    behind before the term ends rather than after the reports are printed."""
    term = (db.one("SELECT * FROM terms WHERE id = %s", (term_id,)) if term_id
            else db.one("SELECT * FROM terms WHERE is_current = 1"))
    if not term:
        return {"ok": True, "term": None, "classes": []}
    classes = db.all("""
      SELECT c.id, c.name, c.short_code, count(s.id) AS pupils
        FROM class_groups c
        LEFT JOIN students s ON s.current_class_id = c.id AND s.status = 'Active'
       GROUP BY c.id, c.name, c.short_code, c.level_order ORDER BY c.level_order, c.name""")
    marks = {r["class_id"]: r for r in db.all("""
      SELECT s.current_class_id AS class_id, count(*) AS entries,
             round(avg(sc.total_score)::numeric, 1) AS average,
             count(*) FILTER (WHERE sc.total_score >= 50) AS passes
        FROM scores sc JOIN students s ON s.id = sc.student_id
       WHERE sc.term_id = %s AND s.status = 'Active' AND sc.total_score IS NOT NULL
       GROUP BY s.current_class_id""", (term["id"],))}
    attendance = {r["class_id"]: r for r in db.all("""
      SELECT s.current_class_id AS class_id,
             count(*) FILTER (WHERE a.status = 'present') AS present, count(*) AS marked
        FROM student_attendance a JOIN students s ON s.id = a.student_id
       WHERE a.date BETWEEN %s AND %s GROUP BY s.current_class_id""",
                                                   (term["start_date"] or "1970-01-01",
                                                    term["end_date"] or "2099-12-31"))}
    rows = []
    for c in classes:
        m = marks.get(c["id"], {})
        a = attendance.get(c["id"], {})
        rows.append({
            **c,
            "entries": m.get("entries", 0),
            "average": float(m["average"]) if m.get("average") is not None else None,
            "pass_rate": round(m["passes"] / m["entries"] * 100) if m.get("entries") else None,
            "attendance_rate": round(a["present"] / a["marked"] * 100) if a.get("marked") else None,
        })
    return {"ok": True, "term": {"id": term["id"], "label": term["label"]}, "classes": rows}


# ── the system ──────────────────────────────────────────────────────────────

def system_overview(db, actor):
    gateway = db.get_setting("payment_gateway", "none")
    return {
        "ok": True,
        "counts": {
            "users": db.value("SELECT count(*) FROM users WHERE is_active = 1", (), 0),
            "users_inactive": db.value("SELECT count(*) FROM users WHERE is_active = 0", (), 0),
            "designations": db.value("SELECT count(*) FROM designations", (), 0),
            "students": db.value("SELECT count(*) FROM students WHERE status = 'Active'", (), 0),
            "staff": db.value("SELECT count(*) FROM staff WHERE status = 'Active'", (), 0),
            "parents": db.value("SELECT count(*) FROM parents", (), 0),
        },
        "sessions": {
            "live": db.value("""SELECT count(*) FROM api_tokens
                                 WHERE revoked = 0 AND (expires_at IS NULL OR expires_at > %s)""",
                             (datetime.datetime.now(datetime.timezone.utc).isoformat(),), 0),
        },
        "payments": {
            "gateway": gateway,
            "configured": gateway != "none" and bool(db.get_setting("paystack_secret_key", "")),
            "online_enabled": db.get_setting("online_payments_enabled", "false") == "true",
        },
        "security": {
            "denials_7d": db.value("""SELECT count(*) FROM audit_log
                                       WHERE action = 'permission_denied'
                                         AND left(created_at, 10) >= %s""",
                                   ((datetime.date.today() - datetime.timedelta(days=7)).isoformat(),), 0),
            "failed_logins_7d": db.value("""SELECT count(*) FROM audit_log
                                             WHERE action = 'login_failed'
                                               AND left(created_at, 10) >= %s""",
                                         ((datetime.date.today() - datetime.timedelta(days=7)).isoformat(),), 0),
        },
        # Raised from a phone or a browser and waiting for somebody to approve
        # them face to face. Shown here so an administrator knows to go and do
        # it — never approved here.
        "password_requests": db.value(
            "SELECT count(*) FROM password_reset_requests WHERE status = 'pending'", (), 0),
    }


def users(db, actor):
    return {
        "ok": True,
        "users": db.all("""
          SELECT u.id, u.username, u.full_name, u.is_active, u.must_change_password,
                 u.last_login, u.created_at, u.staff_id,
                 d.id AS designation_id, d.name AS designation,
                 (SELECT count(*) FROM api_tokens t
                   WHERE t.subject_type = 'user' AND t.subject_id = u.id AND t.revoked = 0) AS sessions
            FROM users u LEFT JOIN designations d ON d.id = u.designation_id
           ORDER BY u.is_active DESC, u.full_name"""),
        "designations": db.all(
            "SELECT id, name, description, is_system FROM designations ORDER BY name"),
    }


def create_user(db, actor, data):
    username = str(data.get("username") or "").strip().lower()
    full_name = str(data.get("full_name") or data.get("fullName") or "").strip()
    password = str(data.get("password") or "")
    import re
    if not re.fullmatch(r"[a-z0-9._-]{3,32}", username):
        return {"ok": False, "status": 400,
                "error": "A username is 3–32 letters, numbers, dot, dash or underscore."}
    if not full_name:
        return {"ok": False, "status": 400, "error": "Enter the person's name."}
    if len(password) < 8:
        return {"ok": False, "status": 400, "error": "A password must be at least 8 characters."}
    if db.one("SELECT id FROM users WHERE lower(username) = %s", (username,)):
        return {"ok": False, "status": 400, "error": "That username is taken."}

    designation_id = data.get("designation_id") or data.get("designationId")
    if designation_id and not db.one("SELECT id FROM designations WHERE id = %s", (designation_id,)):
        return {"ok": False, "status": 400, "error": "That role does not exist."}

    user_id = db.insert("users", {
        "username": username, "password_hash": session.hash_password(password),
        "full_name": full_name, "designation_id": designation_id,
        "staff_id": data.get("staff_id") or data.get("staffId"),
        "is_active": 1,
        # Whoever created it chose the password, so the person it belongs to
        # replaces it before they can do anything.
        "must_change_password": 1, "created_by": actor["user_id"],
    })
    security.audit(db, actor, "user", user_id, "create_user", f"{username} ({full_name})", "high")
    return {"ok": True, "id": user_id, "must_change_password": True}


def _would_orphan_school(db, user_id):
    """Is this the last account that can administer the school?"""
    # Both spellings count. A school mid-upgrade can hold accounts under the
    # old designation name, and refusing to see them would report the school as
    # already orphaned and block the very change that fixes it.
    return db.value("""
      SELECT count(*) FROM users u JOIN designations d ON d.id = u.designation_id
       WHERE u.is_active = 1 AND d.name IN (%s, %s) AND u.id <> %s""",
                    (security.SUPER_ADMIN, security.SUPER_ADMIN_LEGACY, user_id), 0) == 0


def set_user_status(db, actor, user_id, active):
    user = db.one("SELECT id, username, is_active FROM users WHERE id = %s", (user_id,))
    if not user:
        return {"ok": False, "status": 404, "error": "No such account."}
    if int(user_id) == int(actor["user_id"]) and not active:
        return {"ok": False, "status": 400,
                "error": "You cannot deactivate the account you are signed in with."}
    if not active and _would_orphan_school(db, user_id):
        return {"ok": False, "status": 400,
                "error": "That is the last Super Admin account. The school would be locked out."}

    db.run("UPDATE users SET is_active = %s WHERE id = %s", (1 if active else 0, user_id))
    if not active:
        # Not at the next token expiry — now.
        session.revoke_all_for_user(db, user_id)
    security.audit(db, actor, "user", user_id,
                   "activate_user" if active else "deactivate_user", user["username"], "high")
    return {"ok": True}


def set_user_role(db, actor, user_id, designation_id):
    user = db.one("""SELECT u.id, u.username, d.name AS designation FROM users u
                       LEFT JOIN designations d ON d.id = u.designation_id WHERE u.id = %s""",
                  (user_id,))
    if not user:
        return {"ok": False, "status": 404, "error": "No such account."}
    role = db.one("SELECT id, name FROM designations WHERE id = %s", (designation_id,))
    if not role:
        return {"ok": False, "status": 400, "error": "That role does not exist."}
    if int(user_id) == int(actor["user_id"]) and not security.is_super_admin_name(role["name"]):
        return {"ok": False, "status": 400,
                "error": "You cannot take the Super Admin role off the account you are signed in with."}
    if security.is_super_admin_name(user["designation"]) \
            and not security.is_super_admin_name(role["name"]) \
            and _would_orphan_school(db, user_id):
        return {"ok": False, "status": 400,
                "error": "That is the last Super Admin account. The school would be locked out."}

    db.run("UPDATE users SET designation_id = %s WHERE id = %s", (designation_id, user_id))
    # A changed role is a changed permission map and a changed teaching scope.
    # Every live session re-reads both on its next request, but a role taken
    # AWAY should not wait even that long.
    session.revoke_all_for_user(db, user_id)
    security.audit(db, actor, "user", user_id, "change_user_role",
                   f'{user["username"]}: {user["designation"] or "none"} → {role["name"]}', "high")
    return {"ok": True}


def reset_user_password(db, actor, user_id, new_password):
    """Set somebody else's password.

    Face to face on the desktop is one route; this is the other, and it is the
    Super Admin's alone. The account is flagged must_change_password so the
    person it belongs to replaces it, and every session it held is revoked —
    including any an attacker may be holding.
    """
    user = db.one("SELECT id, username FROM users WHERE id = %s", (user_id,))
    if not user:
        return {"ok": False, "status": 404, "error": "No such account."}
    if len(str(new_password or "")) < 8:
        return {"ok": False, "status": 400, "error": "A password must be at least 8 characters."}
    db.run("UPDATE users SET password_hash = %s, must_change_password = 1 WHERE id = %s",
           (session.hash_password(new_password), user_id))
    session.revoke_all_for_user(db, user_id)
    security.audit(db, actor, "user", user_id, "reset_user_password",
                   f'Password set for {user["username"]}; sessions revoked', "high")
    return {"ok": True}


def access_matrix(db, actor):
    """The ladder, read back as levels rather than four ticks."""
    designations = db.all("SELECT id, name, description, is_system FROM designations ORDER BY name")
    rows = db.all("SELECT * FROM designation_permissions")
    by_designation = {d["id"]: {} for d in designations}
    for r in rows:
        if r["designation_id"] in by_designation:
            by_designation[r["designation_id"]][r["module"]] = access.perms_to_level(r)

    out = []
    for d in designations:
        locked = d["name"] in access.ALWAYS_FULL
        out.append({
            **d, "locked": locked,
            "levels": ({m: "full" for m in access.MODULE_KEYS} if locked
                       else {m: by_designation[d["id"]].get(m, "no") for m in access.MODULE_KEYS}),
        })
    return {"ok": True, "levels": access.LEVELS, "modules": access.MODULES,
            "always_full": access.ALWAYS_FULL, "designations": out}


def set_access(db, actor, designation_id, levels):
    role = db.one("SELECT id, name FROM designations WHERE id = %s", (designation_id,))
    if not role:
        return {"ok": False, "status": 400, "error": "That role does not exist."}
    if role["name"] in access.ALWAYS_FULL:
        return {"ok": False, "status": 400,
                "error": f'{role["name"]} always has full access. Change the person\'s role instead.'}

    changes = []
    for module, level in (levels or {}).items():
        if module not in access.MODULE_KEYS:
            return {"ok": False, "status": 400, "error": f"Unknown module: {module}"}
        if not access.is_valid_level(level):
            return {"ok": False, "status": 400, "error": f"Unknown level: {level}"}
        changes.append((module, level))
    if not changes:
        return {"ok": False, "status": 400, "error": "Nothing to change."}

    with db.tx() as tx:
        for module, level in changes:
            p = access.level_to_perms(level)
            tx.run("""
              INSERT INTO designation_permissions
                     (designation_id, module, can_view, can_create, can_edit, can_delete)
                   VALUES (%s,%s,%s,%s,%s,%s)
              ON CONFLICT (designation_id, module) DO UPDATE
                 SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
                     can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete""",
                   (designation_id, module, p["can_view"], p["can_create"],
                    p["can_edit"], p["can_delete"]))

    security.audit(db, actor, "designation", designation_id, "change_access",
                   f'{role["name"]}: ' + ", ".join(f"{m}={l}" for m, l in changes), "high")
    # Live sessions resolve permissions on every request, so a withdrawal takes
    # effect on the holder's next tap without anybody being signed out.
    return {"ok": True, "changed": len(changes)}


def audit_trail(db, actor, severity=None, entity=None, action=None, user_id=None, limit=100):
    sql = """
      SELECT a.id, a.entity_type, a.entity_id, a.action, a.justification, a.severity,
             a.created_at, u.full_name AS user_name, u.username
        FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1
    """
    params = []
    for column, value in (("a.severity", severity), ("a.entity_type", entity),
                          ("a.action", action), ("a.user_id", user_id)):
        if value:
            sql += f" AND {column} = %s"
            params.append(value)
    sql += " ORDER BY a.id DESC LIMIT %s"
    params.append(min(int(limit or 100), 500))
    return {"ok": True, "entries": db.all(sql, tuple(params)),
            "severities": db.all("SELECT severity, count(*) AS c FROM audit_log GROUP BY severity")}


def settings(db, actor):
    return {
        "ok": True,
        "settings": {k: db.get_setting(k, "") for k in SETTINGS_READABLE},
        # Named, so the screen can offer the field — and answered as a yes or a
        # no, so nothing that reaches a browser can be read back out of it.
        "secrets": [{"key": k, "configured": bool(db.get_setting(k, ""))}
                    for k in SETTINGS_WRITE_ONLY],
    }


def save_settings(db, actor, patch):
    written = []
    for key, value in (patch or {}).items():
        if key not in SETTINGS_WRITABLE:
            continue
        db.set_setting(key, "" if value is None else str(value))
        written.append(key)
    if not written:
        return {"ok": False, "status": 400, "error": "Nothing there that can be changed from here."}
    # The values are not logged: one of them is a gateway secret, and an audit
    # trail that quotes secrets is a second place they can be read from.
    security.audit(db, actor, "settings", None, "change_settings", ", ".join(written), "high")
    return {"ok": True, "written": written}


def approvals(db, actor):
    """What is waiting to be decided, in one request.

    The browser used to ask for the two halves separately — the leave queue and
    the lesson-note queue — and an account holding one but not the other got a
    403 for the half it may not see. The client swallowed it, so the count was
    quietly short by however many lesson notes were waiting, and a refusal
    appeared in the console of every staff screen a bursar opened.

    Each half is reported only to an account that holds it, which is the rule
    ``overview`` already follows: a bursar is told about leave and not about
    lesson notes, rather than being told about neither or refused outright.
    """
    may_leave = security.can(actor, "staff", "view")
    may_notes = security.can(actor, "academics", "view")
    if not may_leave and not may_notes:
        return {"ok": False, "status": 403, "error": "Access denied."}

    leave = db.all("""
      SELECT lr.*, st.surname, st.first_name, st.staff_number, st.role
        FROM leave_requests lr JOIN staff st ON st.id = lr.staff_id
       WHERE lr.status = 'pending' ORDER BY lr.id DESC LIMIT 200""") if may_leave else []
    for r in leave:
        r["staff_name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()

    notes = db.all("""
      SELECT ln.id, ln.topic AS title, ln.sub_topic, ln.week_number, ln.lesson_date,
             ln.status, ln.created_at, ln.class_group_id,
             c.name AS class_name, s.name AS subject_name, st.surname, st.first_name
        FROM lesson_notes ln
        LEFT JOIN class_groups c ON c.id = ln.class_group_id
        LEFT JOIN subjects s ON s.id = ln.subject_id
        LEFT JOIN staff st ON st.id = ln.staff_id
       WHERE COALESCE(ln.status, 'draft') = 'submitted'
       ORDER BY ln.id DESC LIMIT 200""") if may_notes else []
    for r in notes:
        r["teacher_name"] = f"{r.get('surname') or ''} {r.get('first_name') or ''}".strip()

    return {
        "ok": True, "leave": leave, "lesson_notes": notes,
        # What this account may see at all, so a screen can hide a section
        # rather than draw an empty one that reads as "nothing waiting".
        "may_see": {"leave": may_leave, "lesson_notes": may_notes},
        "may_decide": {
            "leave": may_leave and security.can(actor, "staff", "edit"),
            "lesson_notes": may_notes and security.can(actor, "academics", "edit"),
        },
    }
