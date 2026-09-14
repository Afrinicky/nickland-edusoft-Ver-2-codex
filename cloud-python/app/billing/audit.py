"""Writing down what the platform did about money.

§23 asks for an audit trail over plan changes, subscriptions, discounts,
exemptions, payments, invoices, trials, manual overrides, suspensions and
reactivations. The platform already has one — ``platform_audit`` in
``schema.sql``, written through ``store.record_audit`` — and billing writes to
that same table rather than starting a second one.

One table because the questions an operator asks cut across both: "what
happened to St Peter's" should not need two screens, and "who was doing things
at 3am on the 14th" should not be answerable only for half the system.

Never raises. An audit write that could fail a request would make the logging
itself a way to break the platform — an operator who cannot grant an exemption
because the log is full is worse off than one with a gap in it. The one thing
that is not tolerated is a SILENT gap, so a failure here prints.
"""


def write(store, action, school_id=None, actor="platform", outcome="ok",
          detail="", remote_addr=None):
    try:
        store.record_audit({
            "action": action,
            "school_id": school_id,
            "actor": str(actor or "platform")[:120],
            "outcome": outcome,
            "detail": str(detail or "")[:500],
            "remote_addr": remote_addr,
        })
    except Exception as exc:                            # pragma: no cover
        print(f"[edusoft] the billing audit trail could not be written: {exc}", flush=True)
    return True


def read(store, limit=200, school_id=None, refused_only=False):
    try:
        return store.list_audit(limit=limit, school_id=school_id, refused_only=refused_only)
    except Exception:                                   # pragma: no cover
        return []
