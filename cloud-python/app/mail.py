"""Sending an email, from the platform.

Only the platform sends email — a renewal reminder, an invoice, a receipt for a
subscription payment. A school's messages to its own parents go by SMS through
that school's own Arkesel key (`app/gateways/sms.py`), which is a different
thing with a different payer and is deliberately not mixed in here.

Plain SMTP, configured in the console. Not an API client for one provider,
because every mail service on earth speaks SMTP and a school's own IT person
can point this at whatever the school already pays for. Gmail, Zoho, Brevo,
Mailgun, a university relay — all the same five settings.

Two rules, both learned the same way:

  * **Not configured is not an error.** A deployment that has not set SMTP up
    yet still registers schools, still bills them, still shows every reminder
    in the application. It just cannot post the letter, and says so in the
    result rather than raising into whatever was calling.
  * **A send never raises.** It is called from a billing run that is halfway
    through a hundred schools, and one bad address must not end the run for the
    ninety-nine after it.
"""
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from .billing import settings as platform_settings

TIMEOUT = 20


def config(repo):
    """The five settings, plus who the letter is from."""
    host = str(platform_settings.get(repo, "smtp_host", "") or "").strip()
    sender = str(platform_settings.get(repo, "smtp_from", "") or "").strip()
    return {
        "host": host,
        "port": platform_settings.get_int(repo, "smtp_port", 587) or 587,
        "user": str(platform_settings.get(repo, "smtp_user", "") or "").strip(),
        "password": str(platform_settings.get(repo, "smtp_password", "") or ""),
        "from": sender or str(platform_settings.get(repo, "support_email", "") or "").strip(),
        "from_name": str(platform_settings.get(repo, "smtp_from_name", "") or "").strip()
                     or str(platform_settings.get(repo, "company_name", "") or "").strip(),
        "starttls": platform_settings.get_bool(repo, "smtp_starttls", True),
    }


def configured(repo):
    cfg = config(repo)
    return bool(cfg["host"] and cfg["from"])


def _message(cfg, to, subject, text, html=None, reply_to=""):
    message = EmailMessage()
    message["Subject"] = str(subject or "")[:200]
    message["From"] = formataddr((cfg["from_name"] or None, cfg["from"]))
    message["To"] = to
    message["Message-ID"] = make_msgid()
    if reply_to:
        message["Reply-To"] = reply_to
    message.set_content(text or "")
    if html:
        message.add_alternative(html, subtype="html")
    return message


def send(repo, to, subject, text, html=None, reply_to=""):
    """One email. Returns why it did not go rather than raising."""
    address = str(to or "").strip()
    if "@" not in address:
        return {"ok": False, "error": "That is not an email address."}
    cfg = config(repo)
    if not (cfg["host"] and cfg["from"]):
        return {"ok": False, "error": "No mail server is configured.",
                "not_configured": True}

    message = _message(cfg, address, subject, text, html, reply_to)
    try:
        # Port 465 is implicit TLS from the first byte; 587 and 25 start plain
        # and are upgraded. Getting this the wrong way round is the commonest
        # SMTP misconfiguration there is, so it is decided from the port rather
        # than left to a setting somebody has to understand.
        if int(cfg["port"]) == 465:
            with smtplib.SMTP_SSL(cfg["host"], int(cfg["port"]), timeout=TIMEOUT,
                                  context=ssl.create_default_context()) as server:
                _deliver(server, cfg, message)
        else:
            with smtplib.SMTP(cfg["host"], int(cfg["port"]), timeout=TIMEOUT) as server:
                if cfg["starttls"]:
                    server.starttls(context=ssl.create_default_context())
                _deliver(server, cfg, message)
    except smtplib.SMTPAuthenticationError:
        return {"ok": False, "error": "The mail server refused the username and password."}
    except smtplib.SMTPRecipientsRefused:
        return {"ok": False, "error": "The mail server would not accept that address."}
    except Exception as exc:
        return {"ok": False, "error": f"The mail server could not be reached "
                                      f"({exc.__class__.__name__})."}
    return {"ok": True, "to": address}


def _deliver(server, cfg, message):
    if cfg["user"]:
        server.login(cfg["user"], cfg["password"])
    server.send_message(message)


def test(repo, to):
    """What the console's Test button calls."""
    if not configured(repo):
        return {"ok": False, "error": "Fill in the mail server settings first."}
    company = platform_settings.get(repo, "company_name", "Nickland Sales")
    return send(repo, to, f"{company} — test message",
                "This is a test from your Edusoft console.\n\n"
                "If you are reading it, renewal reminders and invoices will reach "
                "your schools.\n")
