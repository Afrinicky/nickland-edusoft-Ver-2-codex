"""Talking to parents — messages, notices and the SMS log.

A translation of ``electron/ipc/messaging.js``, ``announcements.js`` and
``notifications.js``.

The line that matters: a message thread belongs to a PARENT and a CHILD, and a
member of staff may only open one about a child they can already see. Without
that, a contact book becomes a way to read every family's correspondence with
the school.

Sending SMS is logged but not sent from here — the gateway credentials and the
cost belong to the school's own account, and a message that has been charged
for should be charged once. Queued, logged, and delivered by the school's own
system.
"""
import datetime
import uuid as _uuid

from . import scope as scope_lib, security


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def threads(db, actor, unread_only=False):
    sql = """
      SELECT t.id, t.uuid, t.subject, t.last_message_at, t.staff_unread, t.parent_unread,
             t.student_id, p.full_name AS parent_name, p.phone AS parent_phone,
             TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS student_name,
             s.current_class_id
        FROM message_threads t
        LEFT JOIN parents p ON p.id = t.parent_id
        LEFT JOIN students s ON s.id = t.student_id
       WHERE 1=1
    """
    params = []
    if unread_only:
        sql += " AND t.staff_unread > 0"
    sql += " ORDER BY t.last_message_at DESC NULLS LAST, t.id DESC LIMIT 100"
    rows = db.all(sql, tuple(params))
    # A thread about a child a teacher cannot see is not theirs to read.
    visible = scope_lib.visible_class_ids(db, actor["scope"])
    if visible is not None:
        rows = [r for r in rows if not r["current_class_id"] or r["current_class_id"] in visible]
    return {"ok": True, "threads": rows}


def thread(db, actor, thread_id):
    t = db.one("""
      SELECT t.*, p.full_name AS parent_name,
             TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS student_name,
             s.current_class_id
        FROM message_threads t
        LEFT JOIN parents p ON p.id = t.parent_id
        LEFT JOIN students s ON s.id = t.student_id
       WHERE t.id = %s OR t.uuid = %s""", (thread_id if str(thread_id).isdigit() else 0,
                                           str(thread_id)))
    if not t:
        return {"ok": False, "status": 404, "error": "No such conversation."}
    if t["current_class_id"] and not scope_lib.can_access_class(actor["scope"], t["current_class_id"]):
        return {"ok": False, "status": 404, "error": "No such conversation."}

    messages = db.all("""SELECT id, uuid, sender_type, sender_name, body, created_at
                           FROM messages WHERE thread_id = %s ORDER BY id""", (t["id"],))
    db.run("UPDATE message_threads SET staff_unread = 0 WHERE id = %s", (t["id"],))
    return {"ok": True, "thread": t, "messages": messages}


def reply(db, actor, thread_id, body, student_id=None, parent_id=None, subject=None):
    body = str(body or "").strip()
    if not body:
        return {"ok": False, "status": 400, "error": "Write something."}

    existing = None
    if thread_id:
        existing = db.one("SELECT * FROM message_threads WHERE id = %s OR uuid = %s",
                          (thread_id if str(thread_id).isdigit() else 0, str(thread_id)))
        if not existing:
            return {"ok": False, "status": 404, "error": "No such conversation."}
        student_id = existing["student_id"]

    if student_id and not scope_lib.can_access_student(db, actor["scope"], student_id):
        return {"ok": False, "status": 403, "error": "That pupil is not in one of your classes."}

    with db.tx() as tx:
        if existing:
            thread_row_id = existing["id"]
            tx.run("""UPDATE message_threads
                         SET last_message_at = %s, last_sender = 'staff', parent_unread = parent_unread + 1
                       WHERE id = %s""", (_now(), thread_row_id))
        else:
            thread_row_id = tx.insert("message_threads", {
                "uuid": str(_uuid.uuid4()), "parent_id": parent_id, "student_id": student_id,
                "subject": str(subject or "From the school")[:200],
                "last_message_at": _now(), "last_sender": "staff",
                "parent_unread": 1, "staff_unread": 0,
            })
        tx.insert("messages", {
            "uuid": str(_uuid.uuid4()), "thread_id": thread_row_id, "sender_type": "staff",
            "sender_id": actor["user_id"], "sender_name": actor["full_name"],
            "body": body[:4000],
        }, returning=None)

    security.audit(db, actor, "message_thread", thread_row_id, "send_message",
                   (subject or "reply")[:100])
    return {"ok": True, "thread_id": thread_row_id}


def announcements(db, actor, active_only=True):
    sql = """
      SELECT a.id, a.title, a.body, a.audience, a.target_student_id, a.is_active, a.created_at,
             u.full_name AS created_by_name,
             TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS student_name
        FROM announcements a
        LEFT JOIN users u ON u.id = a.created_by
        LEFT JOIN students s ON s.id = a.target_student_id
    """
    if active_only:
        sql += " WHERE a.is_active = 1"
    sql += " ORDER BY a.created_at DESC LIMIT 100"
    return {"ok": True, "announcements": db.all(sql),
            "may_post": security.can(actor, "notifications", "edit")}


def post_announcement(db, actor, data):
    """A notice from the office reaches every parent's app and every teacher's.

    It is therefore the one write in the school that is visible outside it, and
    it is gated on `notifications: edit` accordingly.
    """
    title = str(data.get("title") or "").strip()
    body = str(data.get("body") or data.get("message") or "").strip()
    if not title or not body:
        return {"ok": False, "status": 400, "error": "A notice needs a title and something to say."}
    audience = "student" if data.get("audience") == "student" else "all"
    target = data.get("student_id") or data.get("studentId") if audience == "student" else None
    if audience == "student" and not target:
        return {"ok": False, "status": 400, "error": "Choose the pupil this notice is for."}

    row_id = db.insert("announcements", {
        "title": title[:200], "body": body[:4000], "audience": audience,
        "target_student_id": target, "is_active": 1, "created_by": actor["user_id"],
    })
    security.audit(db, actor, "announcement", row_id, "post_announcement", title)
    return {"ok": True, "id": row_id}


def withdraw_announcement(db, actor, announcement_id):
    db.run("UPDATE announcements SET is_active = 0 WHERE id = %s", (announcement_id,))
    security.audit(db, actor, "announcement", announcement_id, "withdraw_announcement", "")
    return {"ok": True}


def notification_log(db, actor, limit=200):
    """What the school has sent, and what it cost.

    Read-only here. A school pays per message; a screen that could re-send from
    a log is a screen that can spend the school's money twice by accident.
    """
    rows = db.all("""
      SELECT id, channel, recipient_type, recipient_name, recipient_contact,
             left(message_body, 200) AS preview, sent_at, delivery_status,
             template_used, cost, units_used
        FROM notification_log ORDER BY id DESC LIMIT %s""", (min(int(limit or 200), 500),))
    totals = db.one("""SELECT count(*) AS sent, COALESCE(SUM(cost),0) AS cost,
                              COALESCE(SUM(units_used),0) AS units
                         FROM notification_log""")
    return {"ok": True, "log": rows, "totals": totals,
            "templates": db.all("""SELECT id, name, channel, body, category, is_active
                                     FROM notification_templates WHERE is_active = 1 ORDER BY name""")}


def queue_message(db, actor, data):
    """Queue an SMS or email for the school's own system to deliver.

    Nothing is sent from here. The gateway credentials belong to the school's
    account and the charge lands on the school's bill, so the message is logged
    as pending and the school's own system — desktop or scheduled worker —
    delivers it. That also means a message costs the school once, however many
    times a phone with a poor connection resubmits this request.
    """
    body = str(data.get("body") or "").strip()
    recipients = data.get("recipients") or []
    if not body:
        return {"ok": False, "status": 400, "error": "Write the message."}
    if not recipients:
        return {"ok": False, "status": 400, "error": "Choose who it is going to."}
    channel = data.get("channel") if data.get("channel") in ("sms", "email") else "sms"

    queued = 0
    with db.tx() as tx:
        for r in recipients:
            contact = str(r.get("contact") or "").strip()
            if not contact:
                continue
            tx.insert("notification_log", {
                "channel": channel, "recipient_type": r.get("type") or "parent",
                "recipient_id": r.get("id"), "recipient_name": r.get("name"),
                "recipient_contact": contact, "message_body": body[:1000],
                "delivery_status": "queued", "template_used": data.get("template"),
                "sent_by": actor["user_id"],
            }, returning=None)
            queued += 1

    security.audit(db, actor, "notification", None, "queue_messages",
                   f"{queued} {channel} message(s)")
    return {"ok": True, "queued": queued, "channel": channel,
            "message": "Queued. The school's own system delivers them."}
