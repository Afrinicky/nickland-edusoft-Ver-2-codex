"""Actually delivering the messages a school has queued.

`communications.queue_message` writes rows to `notification_log` with a status
of `queued` and says the school's own system will deliver them. For a school
running the desktop that is true — `electron/ipc/_transport.js` drains the
queue. For a school that is hosted and has no desktop, it was not: the messages
sat in the table forever and nobody found out until a parent asked why they had
not been told about the PTA meeting.

This is the other half. It drains the same queue, through the school's own
Arkesel key, and writes back the same statuses the desktop writes, so a school
that later installs the desktop finds a log it recognises.

Two properties it has to have, because they are about a school's money:

  * **A message is claimed before it is sent.** The row goes to `sending` in
    one statement that only succeeds if it was still `queued`, so two workers,
    or one worker run twice, cannot both send it. An SMS sent twice is charged
    twice and read as a mistake by the parent.
  * **A failure is recorded, not retried forever.** A number that is not a
    number will never become one. It is marked `failed` with the reason, which
    is what the school's own notification screen already shows.
"""
import datetime

from . import integrations

# How many a single pass takes. A school announcing something to every parent
# queues several hundred; this keeps one school from holding the run for all of
# them, and the next pass picks up where it left off.
BATCH = 200


def _now_text():
    """The timestamp format the school's schema uses — SQLite's, kept so a row
    written online sorts beside one the desktop wrote."""
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def available(db):
    """Can this school send from the cloud at all?"""
    provider, config = integrations.sms_config(db)
    return bool(provider and config)


def pending(db, channel="sms"):
    return int(db.value(
        "SELECT count(*) FROM notification_log WHERE delivery_status = 'queued' "
        "AND channel = %s", (channel,), 0) or 0)


def drain(db, limit=BATCH):
    """Send what is waiting. Returns what happened, for the caller's report."""
    provider, config = integrations.sms_config(db)
    if not (provider and config):
        return {"ok": True, "sent": 0, "failed": 0, "skipped": pending(db),
                "reason": "no SMS provider configured for this school"}

    rows = db.all(
        """SELECT id, recipient_contact, message_body FROM notification_log
            WHERE delivery_status = 'queued' AND channel = 'sms'
            ORDER BY id ASC LIMIT %s""", (int(limit),))

    sent = failed = 0
    for row in rows:
        # Claim it. `WHERE delivery_status = 'queued'` is what makes this safe
        # to run twice at once: the second claim changes no rows and the row is
        # skipped rather than sent again.
        claimed = db.run(
            """UPDATE notification_log SET delivery_status = 'sending'
                WHERE id = %s AND delivery_status = 'queued'""", (row["id"],))
        if not claimed:
            continue

        try:
            result = provider.send(config, row["recipient_contact"], row["message_body"])
        except Exception as exc:                   # a provider being strange
            result = {"ok": False, "error": f"{provider.name} could not be reached "
                                            f"({exc.__class__.__name__})."}

        if result.get("ok"):
            sent += 1
            db.run("""UPDATE notification_log
                         SET delivery_status = 'sent', sent_at = %s, api_response = %s
                       WHERE id = %s""",
                   (_now_text(), str(result.get("detail") or "Sent.")[:300], row["id"]))
        else:
            failed += 1
            # `api_response` and not a new column: the school's schema is the
            # desktop's schema, and this is the column the desktop's own sender
            # writes its provider response into.
            db.run("""UPDATE notification_log
                         SET delivery_status = 'failed', api_response = %s
                       WHERE id = %s""", (str(result.get("error") or "")[:300], row["id"]))

    return {"ok": True, "sent": sent, "failed": failed, "skipped": 0,
            "remaining": pending(db)}


def drain_all(limit_per_school=BATCH):
    """Every hosted school, one pass each.

    What the scheduled run calls. One school's bad configuration must not stop
    the others, so a failure is recorded against that school and the loop goes
    on — the alternative is that the school with the expired Arkesel key stops
    messages going out for everybody else.
    """
    from . import db as sdb

    report = {"schools": 0, "sent": 0, "failed": 0, "errors": []}
    try:
        schools = sdb.provisioned()
    except Exception as exc:
        return {**report, "errors": [{"school_id": None, "error": str(exc)}]}

    for school in schools:
        school_id = school["school_id"]
        try:
            db = sdb.SchoolDb(school_id)
            if not available(db):
                continue
            result = drain(db, limit_per_school)
            report["schools"] += 1
            report["sent"] += result["sent"]
            report["failed"] += result["failed"]
        except Exception as exc:
            report["errors"].append({"school_id": school_id, "error": str(exc)})
    return report
