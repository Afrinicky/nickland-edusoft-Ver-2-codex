"""The gateway registry.

Adding a provider is one file and one line of this one. Nothing else in the
platform — not the fee module, not the parent app, not the subscription engine,
not a webhook route — mentions a provider by name, which is what makes that
true and what has to stay true.

    from app import gateways
    gateways.catalogue()          every gateway, as a setup screen needs it
    gateways.get("hubtel")        one adapter
    gateways.config_for(...)      credentials, as the adapter wants them

Two registries, same shape: payment gateways here, SMS providers in `sms.py`.
They are separate because a school may well use Hubtel for money and Arkesel
for messages, and most do.
"""
from .base import Config, Field, Gateway          # noqa: F401
from . import expresspay, flutterwave, hubtel, paystack
from . import sms                                  # noqa: F401

# Order is the order a school sees them in. Paystack first because it is the
# one this platform has actually taken money through; the rest alphabetically,
# because ranking providers by anything else would be an opinion the product
# has no business having.
_ADAPTERS = [paystack.gateway, expresspay.gateway, flutterwave.gateway, hubtel.gateway]
ADAPTERS = {adapter.id: adapter for adapter in _ADAPTERS}


def get(gateway_id):
    """One adapter, or None. `none` is a real answer meaning "switched off"."""
    return ADAPTERS.get(str(gateway_id or "").strip().lower())


def catalogue():
    """Every gateway, described well enough to draw a setup form."""
    return [adapter.spec() for adapter in _ADAPTERS]


def ids():
    return list(ADAPTERS)


def config_for(gateway_id, credentials, currency="GHS", callback_url=""):
    return Config(gateway_id, credentials, currency, callback_url)


# The two functions below take a FIELD LIST rather than a gateway id, because
# an SMS provider declares fields in exactly the same shape and needs exactly
# the same treatment — and a second copy of "how to redact a secret" is a
# second chance to get it wrong in only one of them.
MASK = "••••"


def redact_fields(fields, credentials):
    """Credentials as a screen may see them.

    Every field declared `secret` comes back as `••••` plus its last four
    characters — enough for a bursar to recognise which key is in there,
    useless to anybody who wants to spend money with it. Anything not declared
    at all is dropped rather than passed through, so a field somebody posted by
    hand cannot become a way to read a secret back out.
    """
    out = {}
    for field in fields or ():
        value = str((credentials or {}).get(field.key) or "")
        if not value:
            out[field.key] = ""
        elif field.secret:
            out[field.key] = MASK + value[-4:] if len(value) > 4 else MASK
        else:
            out[field.key] = value
    return out


def clean_fields(fields, submitted, existing=None):
    """What a setup form posted, made safe to store.

    Unknown keys are dropped, so stored credentials can only ever hold declared
    fields. A secret left at its redacted display value means "unchanged", so a
    school editing its sender ID does not have to retype a key it cannot see.
    """
    existing = existing or {}
    out, problems = {}, []
    for field in fields or ():
        value = str((submitted or {}).get(field.key) or "").strip()
        if field.secret and (not value or value.startswith(MASK)):
            value = str(existing.get(field.key) or "")
        if not value and field.default:
            value = field.default
        if field.required and not value:
            problems.append(f"{field.label} is required.")
        if field.kind == "select" and value and field.options:
            allowed = [o["value"] for o in field.options]
            if value not in allowed:
                problems.append(f"{field.label} is not one of the choices.")
        if value:
            out[field.key] = value
    return out, problems


def redact(gateway_id, credentials):
    adapter = get(gateway_id)
    return redact_fields(adapter.fields, credentials) if adapter else {}


def clean(gateway_id, submitted, existing=None):
    adapter = get(gateway_id)
    if not adapter:
        return {}, ["No such gateway."]
    return clean_fields(adapter.fields, submitted, existing)
