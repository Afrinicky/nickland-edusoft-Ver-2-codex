"""Taking money over the internet, into the school's own books.

The offline system takes payment at a counter. This takes it from a parent's
phone at ten at night, and the difference is entirely about what may be
believed:

  • A CHECKOUT is started by the school's server, with the school's own key.
    The phone never sees the key and never names the amount that will settle.
  • Only a SIGNED WEBHOOK may say a payment succeeded. The signature is checked
    over the raw bytes before the body is believed about anything, including
    which gateway it claims to be from.
  • The AMOUNT IS NEVER READ FROM THE WEBHOOK. Settlement asks the gateway
    directly, over the school's own authenticated connection, and what IT
    reports is what the school's books record. That is the one thing an
    attacker who can post to the webhook cannot forge.
  • SETTLING TWICE IS NOT TWO PAYMENTS. A gateway retrying a delivery and a
    parent refreshing their app are both normal, and both resolve to the one
    receipt.

Where this improves on the offline system rather than copying it:

  • The offline build's "tell the school what you paid" form created a pending
    intent somebody reconciled by hand, and the two paths — real gateway money
    and a typed claim — looked identical in the office. Here they are different
    things with different names: a PAYMENT settles itself and is receipted; a
    DECLARATION is a message with a number on it and posts nothing until a
    person with `fees: edit` confirms it against the school's statement.
  • An amount is bounded per school, and bounded again by what is actually
    owed plus an advance the school allows, so a mistyped extra zero is
    refused before it reaches the gateway rather than refunded afterwards.
  • Every gateway conversation is written to the school's own audit log, so a
    dispute is answerable from the school's records and not only the gateway's.
"""
import datetime
import hashlib
import hmac
import json
import secrets
import urllib.error
import urllib.request

from . import fees, security
from .billing import round2

MIN_DEFAULT = 1.0
MAX_DEFAULT = 10000.0


# ── configuration ───────────────────────────────────────────────────────────

def config(db):
    """The school's gateway, or None.

    Two conditions, both required: a key, and the school having switched
    internet payments on. A school that has pasted a test key while trying it
    out is not live.
    """
    if db.get_setting("online_payments_enabled", "false") != "true":
        return None
    gateway = db.get_setting("payment_gateway", "none")
    secret = db.get_setting("paystack_secret_key", "")
    if gateway == "none" or not secret:
        return None
    return {
        "gateway": gateway, "secret": secret,
        "public_key": db.get_setting("paystack_public_key", ""),
        "base_url": db.get_setting("paystack_base_url", "https://api.paystack.co")
                    or "https://api.paystack.co",
        "currency": db.get_setting("payment_currency", "GHS") or "GHS",
        "callback_url": db.get_setting("paystack_callback_url", ""),
    }


def bounds(db):
    def number(key, fallback):
        try:
            return float(db.get_setting(key, str(fallback)) or fallback)
        except (TypeError, ValueError):
            return fallback
    return number("online_payment_min", MIN_DEFAULT), number("online_payment_max", MAX_DEFAULT)


def availability(db):
    """What a parent's app may be told. Never the secret; only that there is one."""
    cfg = config(db)
    lo, hi = bounds(db)
    if not cfg:
        return {"available": False, "gateway": None, "min": lo, "max": hi,
                "currency": db.get_setting("payment_currency", "GHS")}
    return {"available": True, "gateway": cfg["gateway"],
            "public_key": cfg["public_key"] or None,
            "currency": cfg["currency"], "min": lo, "max": hi}


# ── the gateway ─────────────────────────────────────────────────────────────

def _http_json(url, method="GET", headers=None, body=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        request.add_header(k, v)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as res:
            return {"status": res.status, "json": json.loads(res.read().decode() or "{}")}
    except urllib.error.HTTPError as e:
        try:
            return {"status": e.code, "json": json.loads(e.read().decode() or "{}")}
        except Exception:
            return {"status": e.code, "json": None}
    except Exception as e:
        return {"status": 0, "error": str(e)}


def _initialize(cfg, amount, email, reference, metadata):
    body = {
        "amount": int(round(float(amount) * 100)),     # minor units, as Paystack requires
        "email": email or "payments@nicklandedusoft.app",
        "reference": reference, "currency": cfg["currency"], "metadata": metadata or {},
    }
    if cfg["callback_url"]:
        body["callback_url"] = cfg["callback_url"]
    res = _http_json(f'{cfg["base_url"].rstrip("/")}/transaction/initialize', "POST",
                     {"Authorization": f'Bearer {cfg["secret"]}'}, body)
    j = res.get("json") or {}
    if 200 <= res.get("status", 0) < 300 and j.get("status") and j.get("data"):
        return {"ok": True, "authorization_url": j["data"].get("authorization_url"),
                "reference": j["data"].get("reference") or reference}
    return {"ok": False, "error": j.get("message") or res.get("error")
                                  or f'init_failed_{res.get("status")}'}


def _verify(cfg, reference):
    res = _http_json(f'{cfg["base_url"].rstrip("/")}/transaction/verify/{reference}', "GET",
                     {"Authorization": f'Bearer {cfg["secret"]}'})
    j = res.get("json") or {}
    if 200 <= res.get("status", 0) < 300 and j.get("data"):
        d = j["data"]
        return {"ok": True, "paid": d.get("status") == "success",
                "amount": float(d.get("amount") or 0) / 100,
                "currency": d.get("currency"), "gateway_status": d.get("status")}
    return {"ok": False, "error": j.get("message") or res.get("error")
                                  or f'verify_failed_{res.get("status")}'}


def verify_webhook(secret, signature, raw_body):
    """HMAC-SHA512 over the raw bytes, compared in constant time."""
    if not secret or not signature:
        return False
    try:
        expected = hmac.new(secret.encode(), (raw_body or "").encode(),
                            hashlib.sha512).hexdigest()
        return hmac.compare_digest(expected, str(signature))
    except Exception:
        return False


# ── what a parent may pay ───────────────────────────────────────────────────

def options(db, student_id):
    """How much is owed, and how this school takes money.

    A school with no gateway still has a bursar and a WhatsApp number, and that
    is what this returns rather than an empty screen.
    """
    term = db.one("SELECT id, label FROM terms WHERE is_current = 1")
    bill = db.one("""SELECT balance FROM student_bills
                      WHERE student_id = %s AND term_id = %s
                        AND COALESCE(status,'active') = 'active'""",
                  (student_id, term["id"])) if term else None
    return {
        "ok": True,
        "balance": round2((bill or {}).get("balance") or 0),
        "currency": db.get_setting("payment_currency", "GHS"),
        "online": availability(db),
        "offline": {
            "declare": True,
            "whatsapp": db.get_setting("school_whatsapp", "") or db.get_setting("school_phone_1", ""),
            "phone": db.get_setting("school_phone_1", ""),
            "momo": db.get_setting("school_momo_number", ""),
            "bank": {"name": db.get_setting("school_bank_name", ""),
                     "account": db.get_setting("school_bank_account", "")},
        },
    }


def _cap(db, student_id, amount):
    """Bound the amount by what is actually owed, plus whatever advance the
    school allows.

    The offline build let a parent name any figure and refunded the mistakes.
    A mistyped extra zero is cheaper to refuse than to refund, and a parent who
    genuinely wants to pay a term ahead is doing something the school can
    decide to allow (``online_payment_advance``, default one term's balance).
    """
    lo, hi = bounds(db)
    if amount < lo:
        return {"ok": False, "status": 400, "error": f"The smallest payment is {lo:g}."}
    if amount > hi:
        return {"ok": False, "status": 400,
                "error": f"The largest single payment is {hi:g}. Pay in parts, or see the office."}

    term = db.one("SELECT id FROM terms WHERE is_current = 1")
    balance = round2(db.value("""SELECT balance FROM student_bills
                                  WHERE student_id = %s AND term_id = %s
                                    AND COALESCE(status,'active') = 'active'""",
                              (student_id, term["id"] if term else None), 0) or 0)
    try:
        advance = float(db.get_setting("online_payment_advance", "") or 0)
    except (TypeError, ValueError):
        advance = 0
    ceiling = round2(max(balance, 0) + max(advance, 0))
    if ceiling > 0 and amount > ceiling:
        return {"ok": False, "status": 400,
                "error": f"That is more than the {ceiling:g} outstanding. Check the figure, or pay at the office."}
    return {"ok": True, "balance": balance}


def start_checkout(db, parent_actor, student_id, amount, email=None):
    """Begin a charge. Nothing is recorded against the child but a pending row:
    this can be called and abandoned all day without a penny moving."""
    cfg = config(db)
    if not cfg:
        return {"ok": False, "status": 400,
                "error": "This school does not take payments in the app. Use the school's own channels."}
    amount = round2(amount)
    capped = _cap(db, student_id, amount)
    if not capped.get("ok"):
        return capped

    reference = f"NE-{secrets.token_hex(8)}"
    init = _initialize(cfg, amount, email or parent_actor.get("email"), reference,
                       {"school": db.school_id, "student_id": student_id,
                        "parent_id": parent_actor["parent_id"]})
    if not init.get("ok"):
        security.audit(db, None, "payment_intent", None, "checkout_failed",
                       f'{reference}: {init.get("error")}', "high")
        return {"ok": False, "status": 502, "error": "Could not start the payment. Please try again."}

    term = db.one("SELECT id FROM terms WHERE is_current = 1")
    intent_id = db.insert("payment_intents", {
        "uuid": reference, "student_id": student_id, "parent_id": parent_actor["parent_id"],
        "term_id": term["id"] if term else None, "amount": amount,
        "channel": cfg["gateway"], "gateway": cfg["gateway"],
        "gateway_reference": init["reference"], "authorization_url": init["authorization_url"],
        "gateway_status": "initialised", "currency": cfg["currency"],
        "email": email or parent_actor.get("email"), "status": "pending",
        "notes": "Started in the app",
    })
    security.audit(db, None, "payment_intent", intent_id, "checkout_started",
                   f'Parent {parent_actor["parent_id"]} started {amount} for pupil {student_id}')
    return {"ok": True, "intent_id": intent_id, "reference": init["reference"],
            "authorization_url": init["authorization_url"]}


def settle(db, reference, actor=None):
    """Settle a reference, once the GATEWAY confirms it.

    Idempotent by design and by necessity. The receipt is issued through the
    same function the counter uses, so a payment taken online is posted,
    numbered and put in the books exactly like one taken at the desk.
    """
    intent = db.one("SELECT * FROM payment_intents WHERE gateway_reference = %s OR uuid = %s",
                    (reference, reference))
    if not intent:
        return {"ok": False, "status": 404, "error": "No such payment."}
    if intent["status"] == "acknowledged":
        payment = db.one("SELECT receipt_number FROM payments WHERE id = %s", (intent["payment_id"],))
        return {"ok": True, "already": True, "payment_id": intent["payment_id"],
                "receipt_number": (payment or {}).get("receipt_number")}

    cfg = config(db)
    if not cfg:
        return {"ok": False, "status": 400, "error": "Payments are not configured."}

    v = _verify(cfg, intent["gateway_reference"] or reference)
    if not v.get("ok"):
        return {"ok": False, "status": 502, "error": "Could not confirm the payment with the gateway."}
    if not v.get("paid"):
        db.run("UPDATE payment_intents SET gateway_status = %s WHERE id = %s",
               (v.get("gateway_status") or "pending", intent["id"]))
        return {"ok": False, "status": 202, "pending": True, "error": "Payment not completed yet."}

    # The gateway's figure, not the one the phone asked for.
    settled = round2(v.get("amount") or 0)
    result = fees.record_payment(db, actor or {"user_id": None}, {
        "student_id": intent["student_id"], "amount": settled,
        "payment_method": "Paystack" if cfg["gateway"] == "paystack" else "Mobile Money",
        "reference": intent["gateway_reference"],
        "notes": f'Paid online through {cfg["gateway"]}',
        "source": "online_payment", "term_id": intent["term_id"],
    })
    if not result.get("ok"):
        security.audit(db, None, "payment_intent", intent["id"], "settlement_failed",
                       f'{reference}: {result.get("error")}', "high")
        return result

    db.run("""UPDATE payment_intents
                 SET status = 'acknowledged', payment_id = %s, gateway_status = 'success',
                     acknowledged_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
               WHERE id = %s""", (result["payment_id"], intent["id"]))
    security.audit(db, actor, "payment_intent", intent["id"], "online_payment_settled",
                   f'{reference} → receipt {result["receipt_number"]}')
    return {"ok": True, "payment_id": result["payment_id"],
            "receipt_number": result["receipt_number"], "amount": settled}


def status(db, parent_actor, reference):
    """Where a charge got to, for the app after it comes back from the gateway.

    It does not take the app's word that the payment worked — it asks the
    gateway. A phone that never comes back therefore costs nothing: the webhook
    settles it anyway, and this only ever reports what already is.
    """
    intent = db.one("""SELECT * FROM payment_intents
                        WHERE gateway_reference = %s OR uuid = %s""", (reference, reference))
    if not intent:
        return {"ok": False, "status": 404, "error": "No such payment."}
    if intent["parent_id"] != parent_actor["parent_id"]:
        return {"ok": False, "status": 403, "error": "Not your payment."}
    if intent["status"] == "pending" and intent["gateway_reference"]:
        settle(db, intent["gateway_reference"])
    row = db.one("""
      SELECT pi.status, pi.amount, pi.gateway_status, pi.created_at, pi.acknowledged_at,
             p.receipt_number, p.payment_date
        FROM payment_intents pi LEFT JOIN payments p ON p.id = pi.payment_id
       WHERE pi.id = %s""", (intent["id"],))
    return {"ok": True, "payment": row}


def declare(db, parent_actor, student_id, amount, channel="bank", reference="", notes=""):
    """A payment made somewhere else, declared.

    Not a payment. A message with a number on it, which the office confirms
    against the school's own statement before a penny is posted — because a
    parent's word posting straight to the ledger is how a school's books stop
    being true.
    """
    amount = round2(amount)
    if amount <= 0:
        return {"ok": False, "status": 400, "error": "Enter the amount you paid."}
    reference = str(reference or "").strip()[:80]
    if not reference:
        return {"ok": False, "status": 400,
                "error": "Enter the transaction or deposit reference, so the office can find it."}
    # Declaring the same reference twice is a parent pressing a button twice,
    # not a second payment.
    if db.one("""SELECT id FROM payment_intents
                  WHERE student_id = %s AND reference = %s AND status = 'pending'""",
              (student_id, reference)):
        return {"ok": True, "duplicate": True,
                "message": "The office already has that reference."}

    term = db.one("SELECT id FROM terms WHERE is_current = 1")
    intent_id = db.insert("payment_intents", {
        "uuid": secrets.token_hex(8), "student_id": student_id,
        "parent_id": parent_actor["parent_id"], "term_id": term["id"] if term else None,
        "amount": amount,
        "channel": channel if channel in ("bank", "mobile_money", "cash") else "bank",
        "reference": reference, "notes": str(notes or "")[:300] or "Declared by the parent in the app",
        "status": "pending",
    })
    security.audit(db, None, "payment_intent", intent_id, "payment_declared",
                   f'Parent {parent_actor["parent_id"]} declared {amount} ({channel}, ref {reference})')
    return {"ok": True, "intent_id": intent_id,
            "message": "The office has it. Your account updates once they confirm it "
                       "against the school's statement."}


# ── the office's side ───────────────────────────────────────────────────────

def pending(db, actor, status_filter="pending", limit=200):
    rows = db.all("""
      SELECT pi.id, pi.uuid, pi.amount, pi.channel, pi.gateway, pi.gateway_reference,
             pi.gateway_status, pi.reference, pi.notes, pi.status, pi.created_at,
             pi.acknowledged_at, pi.payment_id, pi.currency,
             s.id AS student_id, s.index_number,
             TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS student_name,
             c.name AS class_name, p.full_name AS parent_name, p.phone AS parent_phone,
             pay.receipt_number
        FROM payment_intents pi
        JOIN students s ON s.id = pi.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        LEFT JOIN parents p ON p.id = pi.parent_id
        LEFT JOIN payments pay ON pay.id = pi.payment_id
       WHERE pi.status = %s ORDER BY pi.id DESC LIMIT %s""",
                  (status_filter, min(int(limit or 200), 500)))
    cfg = config(db)
    return {
        "ok": True, "status": status_filter, "intents": rows,
        "may_acknowledge": security.can(actor, "fees", "edit"),
        "gateway": {"id": db.get_setting("payment_gateway", "none"), "live": bool(cfg)},
        "counts": {
            state: db.value("SELECT count(*) FROM payment_intents WHERE status = %s", (state,), 0)
            for state in ("pending", "acknowledged", "rejected")
        },
    }


def acknowledge(db, actor, intent_id, method=None):
    """Confirm a declared payment and turn it into a receipt.

    Only for the declarations. A gateway charge settles itself and never waits
    for a person, because a person confirming money the gateway has not
    confirmed is the mistake this whole module is arranged to prevent.
    """
    intent = db.one("SELECT * FROM payment_intents WHERE id = %s", (intent_id,))
    if not intent:
        return {"ok": False, "status": 404, "error": "No such payment."}
    if intent["status"] != "pending":
        return {"ok": False, "status": 400, "error": f'That payment was already {intent["status"]}.'}
    if intent["gateway_reference"]:
        return {"ok": False, "status": 400,
                "error": "That one is a gateway payment. Verify it with the gateway rather than "
                         "acknowledging it by hand."}

    result = fees.record_payment(db, actor, {
        "student_id": intent["student_id"], "amount": intent["amount"],
        "term_id": intent["term_id"],
        "payment_method": method or {"bank": "Bank Transfer", "mobile_money": "Mobile Money",
                                     "cash": "Cash"}.get(intent["channel"], "Bank Transfer"),
        "reference": intent["reference"],
        "notes": f'Declared by the parent, confirmed by {actor["full_name"]}',
        "source": "declared_payment",
    })
    if not result.get("ok"):
        return result
    db.run("""UPDATE payment_intents
                 SET status = 'acknowledged', payment_id = %s, acknowledged_by = %s,
                     acknowledged_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
               WHERE id = %s""", (result["payment_id"], actor["user_id"], intent_id))
    security.audit(db, actor, "payment_intent", intent_id, "acknowledge_intent",
                   f'Confirmed as receipt {result["receipt_number"]}', "high")
    return result


def reject(db, actor, intent_id, reason):
    reason = str(reason or "").strip()
    if len(reason) < 3:
        return {"ok": False, "status": 400, "error": "Say why — the parent is told."}
    intent = db.one("SELECT status FROM payment_intents WHERE id = %s", (intent_id,))
    if not intent:
        return {"ok": False, "status": 404, "error": "No such payment."}
    if intent["status"] != "pending":
        return {"ok": False, "status": 400, "error": f'That payment was already {intent["status"]}.'}
    db.run("""UPDATE payment_intents
                 SET status = 'rejected', acknowledged_by = %s, reject_reason = %s,
                     acknowledged_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
               WHERE id = %s""", (actor["user_id"], reason, intent_id))
    security.audit(db, actor, "payment_intent", intent_id, "reject_intent", reason, "high")
    return {"ok": True}


def verify_one(db, actor, intent_id):
    """Ask the gateway again about a charge nobody heard back about.

    It settles only if the GATEWAY says the money arrived, never because
    somebody in the office pressed a button.
    """
    intent = db.one("SELECT gateway_reference FROM payment_intents WHERE id = %s", (intent_id,))
    if not intent:
        return {"ok": False, "status": 404, "error": "No such payment."}
    if not intent["gateway_reference"]:
        return {"ok": False, "status": 400, "error": "That payment did not go through the gateway."}
    return settle(db, intent["gateway_reference"], actor)
