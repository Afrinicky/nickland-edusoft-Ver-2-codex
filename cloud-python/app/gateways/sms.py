"""Sending a text message, from the cloud.

The offline system has done this for two releases through Arkesel
(`electron/ipc/_transport.js`), and this is the same API called the same way —
`api-key` header, `POST /api/v2/sms/send`, `{sender, message, recipients[]}` —
so a school that already has an Arkesel key pastes the same key here and it
works. Nothing about the school's existing setup has to change.

Two things learned from the desktop's version are kept, because both were bugs
somebody had to diagnose from a bursar's description:

  * **A sender ID longer than 11 characters is rejected outright by Arkesel**,
    and the school sees "failed" rather than "your school's name is too long".
    It is trimmed here.
  * **Arkesel answers 200 with a failure inside the body.** The HTTP status is
    not the answer; `status` in the JSON is.

Same registry shape as the payment gateways, for the same reason: when the next
provider is wanted, it is one file.
"""
import re

from .base import Field, http_json, ok

ARKESEL_BASE = "https://sms.arkesel.com/api/v2"
MAX_SENDER = 11


class SmsProvider:
    id = ""
    name = ""
    tagline = ""
    docs_url = ""
    fields = ()
    verified = False

    def spec(self):
        return {"id": self.id, "name": self.name, "tagline": self.tagline,
                "docs_url": self.docs_url, "verified": self.verified,
                "fields": [f.spec() for f in self.fields]}

    def send(self, cfg, to, message):
        raise NotImplementedError

    def ping(self, cfg):
        raise NotImplementedError


def msisdn(raw):
    """A Ghanaian number as Arkesel wants it: 233XXXXXXXXX.

    Written once here and once in `electron/ipc/_transport.js`, deliberately
    identically — a number normalised one way offline and another way online
    would deliver to two different phones.
    """
    text = re.sub(r"[^\d+]", "", str(raw or ""))
    if not text:
        return ""
    if text.startswith("+"):
        text = text[1:]
    if text.startswith("00"):
        text = text[2:]
    if text.startswith("0"):
        return "233" + text[1:]
    if text.startswith("233"):
        return text
    if len(text) == 9:
        return "233" + text
    return text


def _succeeded(payload):
    """Arkesel's own idea of success, in the two shapes it comes in.

    The v2 API answers `{"status": "success"}`; some endpoints answer a bare
    boolean, and an empty body on a 200 is a success too. Read once here rather
    than compared as a string in two places, which is how a `True` came to be
    read as the word "true" and treated as a failure.
    """
    state = payload.get("status")
    if state in (None, ""):
        return True
    if isinstance(state, bool):
        return state
    return str(state).strip().lower() in ("success", "ok", "true")


class Arkesel(SmsProvider):
    id = "arkesel"
    name = "Arkesel"
    tagline = "Text messages to parents. Ghanaian, and buyable in cedis."
    docs_url = "https://developers.arkesel.com/"
    verified = True

    fields = (
        Field("api_key", "API key", kind="password", secret=True,
              hint="Arkesel dashboard → Settings → API Keys."),
        Field("sender_id", "Sender ID", default="EduSoft",
              placeholder="ST MARYS",
              hint="What a parent sees the message as coming from. At most 11 "
                   "characters, and Arkesel must have approved it first."),
        Field("base_url", "API address", kind="url", required=False, default=ARKESEL_BASE,
              hint="Leave blank unless Arkesel has told you otherwise."),
    )

    def _headers(self, cfg):
        return {"api-key": cfg.cred("api_key")}

    def sender(self, cfg):
        return (cfg.cred("sender_id", "EduSoft") or "EduSoft").strip()[:MAX_SENDER]

    def send(self, cfg, to, message):
        number = msisdn(to)
        if not number:
            return {"ok": False, "error": "That is not a phone number."}
        if not cfg.cred("api_key"):
            return {"ok": False, "error": "No Arkesel API key has been set."}
        response = http_json(f'{cfg.base(ARKESEL_BASE)}/sms/send', "POST", self._headers(cfg),
                             {"sender": self.sender(cfg), "message": str(message or ""),
                              "recipients": [number]})
        payload = response.get("json") or {}
        # 200 is not the answer. Arkesel returns a failure inside a 200 body.
        if ok(response) and _succeeded(payload):
            return {"ok": True, "to": number,
                    "detail": str(payload.get("message") or "Sent.")}
        return {"ok": False, "to": number,
                "error": str(payload.get("message") or payload.get("status") or "")
                         or f'Arkesel refused the message ({response.get("status")}).'}

    def ping(self, cfg):
        """The balance endpoint: needs a real key, sends nothing, costs nothing.

        A school testing its SMS setup should not have to receive a text to
        find out whether the key works, and should certainly not be charged a
        credit for the privilege.
        """
        if not cfg.cred("api_key"):
            return {"ok": False, "error": "Enter the API key first."}
        response = http_json(f'{cfg.base(ARKESEL_BASE)}/clients/balance-details', "GET",
                             self._headers(cfg))
        payload = response.get("json") or {}
        data = payload.get("data") or {}
        if ok(response) and _succeeded(payload):
            balance = data.get("sms_balance") or data.get("balance")
            return {"ok": True,
                    "detail": (f"Arkesel accepted the key — {balance} SMS credits."
                               if balance is not None else "Arkesel accepted the key."),
                    "balance": balance}
        if int(response.get("status") or 0) in (401, 403):
            return {"ok": False, "error": "Arkesel refused that API key."}
        return {"ok": False,
                "error": str(payload.get("message") or "")
                         or f'Arkesel refused the key ({response.get("status")}).'}


PROVIDERS = {p.id: p for p in (Arkesel(),)}


def provider(provider_id):
    return PROVIDERS.get(str(provider_id or "").strip().lower())


def catalogue():
    return [p.spec() for p in PROVIDERS.values()]
