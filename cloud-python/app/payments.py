"""Taking fees over the internet.

The Python twin of ``cloud/src/payments.js``. What it is for: a parent settling
a bill at ten at night, from another region, with the school's computer
switched off in a locked office. The desktop cannot answer, so the service
has to — and that means holding the school's gateway key, which is a real cost
and worth stating plainly rather than burying.

How the cost is contained:

  * The key is OPT-IN. A school that has not switched internet payments on has
    no key here and this module answers "not available". Payments taken on the
    school's own network never send it.
  * It is stored outside the snapshot table, in ``school_payments``, which no
    read endpoint touches. There is no route that returns it.
  * It is pushed by the school's own desktop over the school-key channel.
    Nothing a parent, a teacher or a portal session does can write it.

And the rules that hold whether or not the desktop is up:

  * Only a signed webhook may say a payment succeeded, checked over raw bytes.
  * The amount is re-read from the gateway, never taken from the webhook.
  * Settlement records nothing here — the service has no receipt counter and no
    ledger. It queues a ``fee_payment`` change and the school's desktop records
    it through the same function the counter uses.
  * The queued change carries the gateway reference, and the desktop
    de-duplicates on it, so a retried delivery cannot become a second payment.
"""
import datetime
import hashlib
import hmac
import json
import secrets
import urllib.error
import urllib.request

MIN_DEFAULT = 1
MAX_DEFAULT = 10000


def config(store, sid):
    if not hasattr(store, "get_payment_config"):
        return None
    try:
        c = store.get_payment_config(sid)
    except Exception:                                   # pragma: no cover
        return None
    if not c or not c.get("secret") or c.get("enabled") is False:
        return None
    return c


def availability(store, sid):
    """What a parent's app may be told: never the secret, only whether there is one."""
    c = config(store, sid)
    if not c:
        return {"available": False, "gateway": None, "min": MIN_DEFAULT,
                "max": MAX_DEFAULT, "currency": "GHS"}
    return {
        "available": True,
        "gateway": c.get("gateway"),
        "public_key": c.get("public_key") or None,
        "currency": c.get("currency") or "GHS",
        "min": float(c.get("min_amount") or MIN_DEFAULT),
        "max": float(c.get("max_amount") or MAX_DEFAULT),
    }


def _http_json(url, method="GET", headers=None, body=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return {"status": res.status, "json": json.loads(res.read().decode() or "{}")}
    except urllib.error.HTTPError as e:                  # the gateway said no, and said why
        try:
            return {"status": e.code, "json": json.loads(e.read().decode() or "{}")}
        except Exception:
            return {"status": e.code, "json": None}
    except Exception as e:
        return {"status": 0, "error": str(e)}


def _base(c):
    return (c.get("base_url") or "https://api.paystack.co").rstrip("/")


def gateway_initialize(c, amount, email, reference, metadata):
    body = {
        "amount": int(round(float(amount) * 100)),      # minor units, as Paystack requires
        "email": email or "payments@nicklandedusoft.app",
        "reference": reference,
        "currency": c.get("currency") or "GHS",
        "metadata": metadata or {},
    }
    if c.get("callback_url"):
        body["callback_url"] = c["callback_url"]
    res = _http_json(f"{_base(c)}/transaction/initialize", "POST",
                     {"Authorization": f"Bearer {c['secret']}"}, body)
    j = res.get("json") or {}
    if 200 <= res.get("status", 0) < 300 and j.get("status") and j.get("data"):
        return {"ok": True, "authorization_url": j["data"].get("authorization_url"),
                "reference": j["data"].get("reference") or reference}
    return {"ok": False, "error": j.get("message") or res.get("error") or f"init_failed_{res.get('status')}"}


def gateway_verify(c, reference):
    res = _http_json(f"{_base(c)}/transaction/verify/{reference}", "GET",
                     {"Authorization": f"Bearer {c['secret']}"})
    j = res.get("json") or {}
    if 200 <= res.get("status", 0) < 300 and j.get("data"):
        d = j["data"]
        return {"ok": True, "paid": d.get("status") == "success",
                "amount": (float(d.get("amount") or 0)) / 100,
                "currency": d.get("currency"), "gateway_status": d.get("status")}
    return {"ok": False, "error": j.get("message") or res.get("error") or f"verify_failed_{res.get('status')}"}


def verify_webhook(secret, signature, raw_body):
    """HMAC-SHA512 of the raw body, compared in constant time."""
    if not secret or not signature:
        return False
    try:
        expected = hmac.new(secret.encode(), (raw_body or "").encode(), hashlib.sha512).hexdigest()
        return hmac.compare_digest(expected, str(signature))
    except Exception:                                   # pragma: no cover
        return False


# ── intents ─────────────────────────────────────────────────────────────────
# Kept as snapshots so the desktop sees them on its next pull and the parent's
# app can read back the status of a charge it started. They carry no secret.

def _key(reference):
    return f"cloud_payment:{reference}"


def save_intent(store, sid, intent):
    store.upsert_snapshot(sid, {
        "entity_type": "cloud_payment", "entity_key": _key(intent["reference"]),
        "op": "upsert", "version": intent.get("version", 1), "payload": intent,
    })
    return intent


def get_intent(store, sid, reference):
    for row in store.list_snapshots(sid, "cloud_payment"):
        if row.get("entity_key") == _key(reference):
            return {**(row.get("payload") or {}), "version": row.get("version", 1)}
    return None


def create_checkout(store, sid, parent_id, student_id, amount, email, student_keys):
    """Start a charge for one child.

    ``student_keys`` is the set of children the signed-in parent actually has —
    checked here rather than trusted from the request, because "which children
    are mine" is exactly the parameter an attacker would like to choose.
    """
    c = config(store, sid)
    if not c:
        return {"ok": False, "status": 400,
                "error": "This school does not take payments over the internet. Use the school’s own channels."}
    if f"student:{student_id}" not in student_keys:
        return {"ok": False, "status": 403, "error": "Not your child."}

    try:
        amt = float(amount)
    except (TypeError, ValueError):
        return {"ok": False, "status": 400, "error": "Enter an amount."}
    lo = float(c.get("min_amount") or MIN_DEFAULT)
    hi = float(c.get("max_amount") or MAX_DEFAULT)
    if amt < lo:
        return {"ok": False, "status": 400, "error": f"The smallest payment is {lo:g}."}
    if amt > hi:
        return {"ok": False, "status": 400, "error": f"The largest single payment is {hi:g}."}

    reference = f"NEC-{secrets.token_hex(8)}"
    init = gateway_initialize(c, amt, email, reference,
                              {"school_id": sid, "student_id": student_id,
                               "parent_id": parent_id, "source": "cloud"})
    if not init.get("ok"):
        return {"ok": False, "status": 502, "error": "Could not start the payment. Please try again."}

    save_intent(store, sid, {
        "reference": init["reference"], "gateway": c.get("gateway"),
        "student_id": student_id, "parent_id": parent_id,
        "amount": amt, "currency": c.get("currency") or "GHS",
        "status": "pending", "gateway_status": "initialised",
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    })
    return {"ok": True, "reference": init["reference"], "authorization_url": init.get("authorization_url")}


def settle(store, sid, reference):
    """Settle a reference, once the gateway itself confirms it.

    Idempotent by design and by necessity: a webhook delivery is retried, and a
    parent's app polls. The second call finds ``paid`` and returns it without
    queueing a second payment.
    """
    intent = get_intent(store, sid, reference)
    if not intent:
        return {"ok": False, "status": 404, "error": "No such payment."}
    if intent.get("status") == "paid":
        return {"ok": True, "already": True, "payment": intent}

    c = config(store, sid)
    if not c:
        return {"ok": False, "status": 400, "error": "Payments are not configured."}

    v = gateway_verify(c, reference)
    if not v.get("ok"):
        return {"ok": False, "status": 502, "error": "Could not confirm the payment with the gateway."}
    if not v.get("paid"):
        save_intent(store, sid, {**intent, "gateway_status": v.get("gateway_status") or "pending",
                                 "version": intent.get("version", 1) + 1})
        return {"ok": False, "status": 202, "pending": True, "error": "Payment not completed yet."}

    # The gateway's figure, not the one the phone asked for and not the one in
    # the webhook body. This is the only number that has been through anybody's
    # authenticated connection.
    settled = float(v.get("amount") or 0)
    paid = {**intent, "status": "paid", "gateway_status": "success", "amount": settled,
            "paid_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "version": intent.get("version", 1) + 1}
    save_intent(store, sid, paid)

    # The school records it, because the school owns the receipt numbers.
    store.enqueue_change(sid, {
        "type": "fee_payment",
        "payload": {
            "student_id": intent.get("student_id"), "parent_id": intent.get("parent_id"),
            "amount": settled, "currency": intent.get("currency") or "GHS",
            "gateway": intent.get("gateway"), "gateway_reference": reference,
            "paid_at": paid["paid_at"], "source": "cloud_gateway",
        },
    })
    return {"ok": True, "payment": paid}


def status(store, sid, reference, student_keys):
    """The status of one charge, for the parent's app after it comes back."""
    intent = get_intent(store, sid, reference)
    if not intent:
        return {"ok": False, "status": 404, "error": "No such payment."}
    if student_keys is not None and f"student:{intent.get('student_id')}" not in student_keys:
        return {"ok": False, "status": 403, "error": "Not your payment."}
    if intent.get("status") == "pending":
        s = settle(store, sid, reference)
        if s.get("ok"):
            return {"ok": True, "payment": s["payment"], "receipt_pending": True}
    now = get_intent(store, sid, reference)
    return {"ok": True, "payment": now, "receipt_pending": bool(now and now.get("status") == "paid")}
