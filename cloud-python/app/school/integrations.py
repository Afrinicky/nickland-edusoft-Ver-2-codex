"""A school's own integrations: who takes its money, who sends its messages.

The whole of this module exists to make one screen possible, and the screen has
to be finishable by a bursar in a few minutes without ringing anybody:

    1. Choose your provider.
    2. Paste the two or three things it gave you.
    3. Press Test.
    4. Switch it on.

Step 3 is not decoration. **A gateway cannot be switched on until a test against
the real provider has passed.** A wrong key, a sandbox key pasted into a live
deployment, a merchant number with a typo in it — all of them fail at step 3,
in front of the person who can fix them, rather than at ten at night in front of
a parent whose money has gone somewhere nobody can find. Changing a credential
clears the pass, so the rule cannot be walked around by testing once.

── Where the credentials live ──────────────────────────────────────────────
In the school's own schema, in its own `settings` table, beside the ones the
desktop has always used. Not in a platform table: what a school pays its
provider, and what its provider charges it, is the school's business, and a
Ghanaian school's Paystack key has no reason to sit in a table keyed by every
school on the platform.

The legacy keys (`paystack_secret_key`, `paystack_public_key`) are still
written whenever the chosen gateway is Paystack, so a school that has been
running for two years keeps working, its desktop keeps working, and the
existing fee-payment path keeps working unchanged. New providers use
`gateway_credentials`, which is JSON, because Hubtel wants three fields and
ExpressPay wants two and a table with a column per provider per field is a
migration every time a school asks for the bank it already uses.

Nothing here is ever served back. A screen that needs to show which key is in
use gets `••••` and the last four characters.
"""
import datetime
import json

from .. import gateways
from ..gateways import sms as sms_lib
from . import security

# The settings keys this module owns, named once so a typo is a NameError here
# rather than a setting that silently never reads back.
GATEWAY_KEY = "payment_gateway"
CREDENTIALS_KEY = "gateway_credentials"
ENABLED_KEY = "online_payments_enabled"
CURRENCY_KEY = "payment_currency"
VERIFIED_AT_KEY = "payment_verified_at"
VERIFIED_DETAIL_KEY = "payment_verified_detail"

SMS_PROVIDER_KEY = "sms_provider"
SMS_VERIFIED_AT_KEY = "sms_verified_at"
SMS_VERIFIED_DETAIL_KEY = "sms_verified_detail"
# Arkesel's own fields map onto the keys the desktop already uses, so a school
# that set SMS up offline needs to do nothing at all here.
SMS_FIELD_KEYS = {"api_key": "sms_api_key", "sender_id": "sms_sender_id",
                  "base_url": "sms_base_url"}


def _now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


# ── Reading ─────────────────────────────────────────────────────────────────
def stored_credentials(db):
    """The school's gateway credentials, from wherever they actually are.

    New-style JSON first; then the legacy Paystack keys, which is what a school
    configured before this screen existed has. Reading both means an upgrade
    needs no migration and no school has to re-enter anything.
    """
    raw = db.get_setting(CREDENTIALS_KEY, "")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and parsed:
                return parsed
        except ValueError:
            pass
    legacy = {}
    for key, setting in (("secret_key", "paystack_secret_key"),
                         ("public_key", "paystack_public_key"),
                         ("base_url", "paystack_base_url")):
        value = db.get_setting(setting, "")
        if value:
            legacy[key] = value
    return legacy


def gateway_id(db):
    return str(db.get_setting(GATEWAY_KEY, "none") or "none").strip().lower()


def configured_here(db):
    """Was this gateway set up on the Integrations screen, or before it existed?

    The screen writes `gateway_credentials`; nothing else ever has. A school
    whose only credentials are the old `paystack_secret_key` settings was set
    up by its desktop, possibly two years ago, and has been taking money ever
    since — which is the whole of why the test rule does not apply to it.
    """
    return bool(db.get_setting(CREDENTIALS_KEY, ""))


def gateway_config(db):
    """The school's gateway as an adapter wants it, or None.

    None whenever the school could not actually take a payment — no provider
    chosen, no adapter for the one that is, required fields missing, never
    tested, or simply switched off. Every one of those is a real state and the
    caller treats them the same: there is no online payment here today.
    """
    chosen = gateway_id(db)
    adapter = gateways.get(chosen)
    if not adapter:
        return None
    config = gateways.config_for(
        chosen, stored_credentials(db),
        currency=db.get_setting(CURRENCY_KEY, "GHS") or "GHS",
        callback_url=db.get_setting("payment_callback_url", ""))
    if adapter.missing(config):
        return None
    if db.get_setting(ENABLED_KEY, "false") != "true":
        return None
    # The test rule — but only for a gateway set up on the Integrations screen.
    #
    # A school that configured Paystack from its desktop before this screen
    # existed has been taking fees for two years and has never pressed a Test
    # button, because there was not one. Switching it off on the morning of an
    # upgrade would be this platform breaking a working school to enforce a
    # rule about its own newer paperwork. So the rule applies where it can be
    # met, and the screen invites the school to confirm the old setup rather
    # than demanding it.
    if configured_here(db) and not db.get_setting(VERIFIED_AT_KEY, ""):
        return None
    return config


def active_adapter(db):
    """`(adapter, config)` when the school can take money, `(None, None)` when
    it cannot. One call, so no caller has to remember to check both."""
    config = gateway_config(db)
    return (gateways.get(config.gateway), config) if config else (None, None)


def sms_config(db):
    """The school's SMS provider as the sender wants it, or None."""
    provider = sms_lib.provider(db.get_setting(SMS_PROVIDER_KEY, "arkesel"))
    if not provider:
        return None, None
    credentials = {key: db.get_setting(setting, "")
                   for key, setting in SMS_FIELD_KEYS.items()}
    if not credentials.get("api_key"):
        return None, None
    return provider, gateways.config_for(provider.id, credentials)


def overview(db, actor=None):
    """Everything the Integrations screen draws, in one call."""
    chosen = gateway_id(db)
    adapter = gateways.get(chosen)
    credentials = stored_credentials(db)
    config = gateways.config_for(chosen, credentials,
                                 currency=db.get_setting(CURRENCY_KEY, "GHS") or "GHS")
    verified_at = db.get_setting(VERIFIED_AT_KEY, "")
    enabled = db.get_setting(ENABLED_KEY, "false") == "true"
    missing = adapter.missing(config) if adapter else []
    legacy = bool(adapter) and not configured_here(db)

    sms_provider = str(db.get_setting(SMS_PROVIDER_KEY, "arkesel") or "arkesel")
    sms_spec = sms_lib.provider(sms_provider)
    sms_credentials = {key: db.get_setting(setting, "")
                       for key, setting in SMS_FIELD_KEYS.items()}

    return {
        "ok": True,
        "payments": {
            "gateway": chosen if adapter else "none",
            "gateway_name": adapter.name if adapter else None,
            "credentials": gateways.redact(chosen, credentials) if adapter else {},
            "currency": config.currency,
            "enabled": enabled,
            "verified": bool(verified_at),
            "verified_at": verified_at or None,
            "verified_detail": db.get_setting(VERIFIED_DETAIL_KEY, ""),
            "missing": missing,
            # The one sentence the screen shows above the switch. Worked out
            # here rather than in the interface, so the app, the console and
            # any future client all say the same thing about the same state.
            "legacy": legacy,
            "state": _state(adapter, missing, bool(verified_at), enabled, legacy),
            "can_enable": bool(adapter) and not missing and (bool(verified_at) or legacy),
            "min": _number(db, "online_payment_min", 1),
            "max": _number(db, "online_payment_max", 10000),
        },
        "sms": {
            "provider": sms_provider,
            "provider_name": sms_spec.name if sms_spec else None,
            "credentials": (gateways.redact_fields(sms_spec.fields, sms_credentials)
                            if sms_spec else {}),
            "verified": bool(db.get_setting(SMS_VERIFIED_AT_KEY, "")),
            "verified_at": db.get_setting(SMS_VERIFIED_AT_KEY, "") or None,
            "verified_detail": db.get_setting(SMS_VERIFIED_DETAIL_KEY, ""),
            "configured": bool(sms_credentials.get("api_key")),
            "missing": [f.label for f in (sms_spec.fields if sms_spec else ())
                        if f.required and not sms_credentials.get(f.key)],
        },
        "catalogue": gateways.catalogue(),
        "sms_catalogue": sms_lib.catalogue(),
    }


def _state(adapter, missing, verified, enabled, legacy=False):
    if not adapter:
        return {"key": "off", "label": "Not set up",
                "detail": "Parents pay at the office. Choose a provider to take "
                          "fees over the internet."}
    if missing:
        return {"key": "incomplete", "label": "Not finished",
                "detail": "Still needed: " + ", ".join(missing) + "."}
    if legacy and not verified:
        return {"key": "live" if enabled else "ready",
                "label": "Live — set up earlier" if enabled else "Set up earlier, switched off",
                "detail": "This was set up before this screen existed and is left "
                          "working exactly as it was. Press Test connection when "
                          "convenient, to confirm the key is still good."}
    if not verified:
        return {"key": "untested", "label": "Not tested",
                "detail": "Press Test connection. Until it passes, this cannot "
                          "be switched on — which is what stops a wrong key "
                          "being found by a parent instead of by you."}
    if not enabled:
        return {"key": "ready", "label": "Tested, switched off",
                "detail": "Everything works. Switch it on when you are ready for "
                          "parents to use it."}
    return {"key": "live", "label": "Live",
            "detail": "Parents can pay their fees over the internet."}


def _number(db, key, fallback):
    try:
        return float(db.get_setting(key, str(fallback)) or fallback)
    except (TypeError, ValueError):
        return float(fallback)


# ── Writing ─────────────────────────────────────────────────────────────────
def save_payment(db, actor, data):
    """Choose a gateway and store its credentials. Never switches it on."""
    chosen = str(data.get("gateway") or "none").strip().lower()
    if chosen in ("none", ""):
        db.set_setting(GATEWAY_KEY, "none", "payments")
        db.set_setting(ENABLED_KEY, "false", "payments")
        db.set_setting(CREDENTIALS_KEY, "", "payments")
        _clear_verification(db)
        security.audit(db, actor, "settings", None, "payment_gateway_cleared",
                       "Internet payments switched off", "high")
        return {"ok": True, **overview(db, actor)}

    adapter = gateways.get(chosen)
    if not adapter:
        return {"ok": False, "status": 400, "error": "That is not a payment provider we support."}

    existing = stored_credentials(db) if gateway_id(db) == chosen else {}
    credentials, problems = gateways.clean(chosen, data.get("credentials"), existing)
    if problems:
        return {"ok": False, "status": 400, "error": " ".join(problems)}

    currency = str(data.get("currency") or db.get_setting(CURRENCY_KEY, "GHS") or "GHS").upper()
    if currency not in adapter.currencies:
        return {"ok": False, "status": 400,
                "error": f"{adapter.name} does not take {currency}. "
                         f"It takes: {', '.join(adapter.currencies)}."}

    changed = (gateway_id(db) != chosen or stored_credentials(db) != credentials)
    db.set_setting(GATEWAY_KEY, chosen, "payments")
    db.set_setting(CREDENTIALS_KEY, json.dumps(credentials), "payments")
    db.set_setting(CURRENCY_KEY, currency, "payments")

    # Paystack's own settings are kept in step, so the school's desktop and the
    # fee-payment path that predates this screen both keep reading what they
    # have always read. A school switching AWAY from Paystack has them cleared,
    # or the old key would go on working somewhere nobody was looking.
    db.set_setting("paystack_secret_key",
                   credentials.get("secret_key", "") if chosen == "paystack" else "", "payments")
    db.set_setting("paystack_public_key",
                   credentials.get("public_key", "") if chosen == "paystack" else "", "payments")

    if changed:
        # New credentials are untested credentials, and untested credentials
        # cannot be live. Switching it off is not punishment: it is the same
        # rule as "a gateway goes live only after a test has passed", applied
        # at the only other moment it could be broken.
        _clear_verification(db)
        db.set_setting(ENABLED_KEY, "false", "payments")

    security.audit(db, actor, "settings", None, "payment_gateway_saved",
                   f"{adapter.name}" + (" (credentials changed)" if changed else ""), "high")
    return {"ok": True, **overview(db, actor)}


def test_payment(db, actor):
    """Ask the provider whether these credentials are real.

    Costs nothing and moves no money — every adapter's `ping` is a read. A pass
    is what unlocks the switch.
    """
    chosen = gateway_id(db)
    adapter = gateways.get(chosen)
    if not adapter:
        return {"ok": False, "status": 400, "error": "Choose a payment provider first."}
    config = gateways.config_for(chosen, stored_credentials(db),
                                 currency=db.get_setting(CURRENCY_KEY, "GHS") or "GHS")
    missing = adapter.missing(config)
    if missing:
        return {"ok": False, "status": 400, "error": "Still needed: " + ", ".join(missing) + "."}

    try:
        result = adapter.ping(config)
    except Exception as exc:                       # a provider being strange
        result = {"ok": False, "error": f"{adapter.name} could not be reached ({exc.__class__.__name__})."}

    if result.get("ok"):
        db.set_setting(VERIFIED_AT_KEY, _now(), "payments")
        db.set_setting(VERIFIED_DETAIL_KEY, str(result.get("detail") or "")[:300], "payments")
        security.audit(db, actor, "settings", None, "payment_gateway_tested",
                       f"{adapter.name}: passed")
        return {"ok": True, "detail": result.get("detail") or f"{adapter.name} accepted it.",
                **overview(db, actor)}

    _clear_verification(db)
    db.set_setting(ENABLED_KEY, "false", "payments")
    security.audit(db, actor, "settings", None, "payment_gateway_tested",
                   f"{adapter.name}: failed — {result.get('error')}", "high")
    return {"ok": False, "status": 400,
            "error": result.get("error") or f"{adapter.name} refused the credentials."}


def set_enabled(db, actor, on):
    """The switch parents actually feel. Refuses to go on untested."""
    if on:
        chosen = gateway_id(db)
        adapter = gateways.get(chosen)
        if not adapter:
            return {"ok": False, "status": 400, "error": "Choose a payment provider first."}
        config = gateways.config_for(chosen, stored_credentials(db))
        missing = adapter.missing(config)
        if missing:
            return {"ok": False, "status": 400,
                    "error": "Still needed: " + ", ".join(missing) + "."}
        if not db.get_setting(VERIFIED_AT_KEY, "") and configured_here(db):
            return {"ok": False, "status": 400,
                    "error": "Press Test connection first. A provider that has not "
                             "answered cannot be switched on."}
    db.set_setting(ENABLED_KEY, "true" if on else "false", "payments")
    security.audit(db, actor, "settings", None,
                   "online_payments_enabled" if on else "online_payments_disabled",
                   "Parents can pay online" if on else "Online payment switched off", "high")
    return {"ok": True, **overview(db, actor)}


def save_sms(db, actor, data):
    provider = sms_lib.provider(data.get("provider") or db.get_setting(SMS_PROVIDER_KEY, "arkesel"))
    if not provider:
        return {"ok": False, "status": 400, "error": "That is not an SMS provider we support."}
    existing = {key: db.get_setting(setting, "") for key, setting in SMS_FIELD_KEYS.items()}
    # The same rules as a payment gateway, applied to this provider's own
    # declared fields — an SMS provider is not in the payment registry.
    credentials, problems = gateways.clean_fields(
        provider.fields, data.get("credentials"), existing)
    if problems:
        return {"ok": False, "status": 400, "error": " ".join(problems)}

    changed = credentials != existing
    db.set_setting(SMS_PROVIDER_KEY, provider.id, "notifications")
    for key, setting in SMS_FIELD_KEYS.items():
        db.set_setting(setting, credentials.get(key, ""), "notifications")
    if changed:
        db.set_setting(SMS_VERIFIED_AT_KEY, "", "notifications")
        db.set_setting(SMS_VERIFIED_DETAIL_KEY, "", "notifications")
    security.audit(db, actor, "settings", None, "sms_provider_saved", provider.name, "high")
    return {"ok": True, **overview(db, actor)}


def test_sms(db, actor, to=""):
    """Check the key, and optionally send one real message.

    Without a number this asks the provider for the account balance: no credit
    spent, no phone needed. With one it sends a single text, which is the only
    way to prove a sender ID has actually been approved.
    """
    provider, config = sms_config(db)
    if not provider:
        return {"ok": False, "status": 400,
                "error": "Enter the API key first, then test it."}

    try:
        result = provider.ping(config)
        if result.get("ok") and to:
            sent = provider.send(config, to,
                                 "Nickland Edusoft: your school's text messaging is "
                                 "working. No action needed.")
            if not sent.get("ok"):
                result = sent
    except Exception as exc:
        result = {"ok": False,
                  "error": f"{provider.name} could not be reached ({exc.__class__.__name__})."}

    if result.get("ok"):
        db.set_setting(SMS_VERIFIED_AT_KEY, _now(), "notifications")
        db.set_setting(SMS_VERIFIED_DETAIL_KEY, str(result.get("detail") or "")[:300],
                       "notifications")
        security.audit(db, actor, "settings", None, "sms_tested", f"{provider.name}: passed")
        return {"ok": True, "detail": result.get("detail") or "It works.",
                "balance": result.get("balance"), **overview(db, actor)}

    db.set_setting(SMS_VERIFIED_AT_KEY, "", "notifications")
    security.audit(db, actor, "settings", None, "sms_tested",
                   f"{provider.name}: failed — {result.get('error')}", "high")
    return {"ok": False, "status": 400,
            "error": result.get("error") or f"{provider.name} refused the key."}


def _clear_verification(db):
    db.set_setting(VERIFIED_AT_KEY, "", "payments")
    db.set_setting(VERIFIED_DETAIL_KEY, "", "payments")
