"""Which of a school's settings are secrets, said once — the online half.

The mirror of ``electron/ipc/_secrets.js``, and it has to stay a mirror: the
offline system and this one share a settings table by construction (this
schema is generated from that one), so a credential that is write-only on the
school's own computer and readable here is readable, full stop.

The hole this closes was the same hole, in both implementations at once.
``settings:get-all`` returned every row of the ``settings`` table ungated —
declared with ``module=None``, which in ``school_api.require()`` means
authenticate and nothing further. A class teacher's token was enough to read
the school's Paystack secret, its Arkesel key and its cloud sync key. Offline
that needed somebody on the school Wi-Fi. Here it needed a browser.

``payment_gateway_credentials`` is on this list and not on the offline one
because only this side has it: ``school/integrations.py`` stores the whole
credential set as one JSON blob under that key, as well as keeping Paystack's
own two settings in step for the desktop's benefit. A list that caught the
individual keys and missed the blob would have caught nothing.
"""

# Written, never read back.
WRITE_ONLY = frozenset({
    # Payment gateways — the school's own money.
    "paystack_secret_key",
    "flutterwave_secret_key", "flutterwave_secret_hash",
    "hubtel_client_id", "hubtel_client_secret",
    "expresspay_api_key",
    # The whole credential set, as integrations.py stores it.
    "payment_gateway_credentials",
    # Talking to parents — the school's own voice, and its own credits.
    "sms_api_key",
    "resend_api_key",
    "email_smtp_pass",
    # Talking to the cloud — read and write access to the school's cloud data.
    "school_api_key",
})


def is_secret(key):
    return str(key or "") in WRITE_ONLY


def redact_grouped(grouped):
    """Empty every secret value; say separately which are set.

    Emptied rather than starred, for the reason the offline side gives: a
    screen prefills a password box from this, and `''` already means "the one
    already saved" to every screen that does. A row of bullets would be read
    back as a literal password by the next Save.
    """
    out = {}
    configured = {}
    for category, entries in (grouped or {}).items():
        if not isinstance(entries, dict):
            out[category] = entries
            continue
        copy = {}
        for key, value in entries.items():
            if is_secret(key):
                configured[key] = bool(value and str(value))
                copy[key] = ""
            else:
                copy[key] = value
        out[category] = copy
    out["_secrets_configured"] = configured
    return out


def keeps_existing(key, value):
    """True when this write should be ignored as "leave the saved one alone".

    An empty secret means the form was not filled in, not that the school wants
    the key that takes its money removed.
    """
    return is_secret(key) and not str(value or "")
