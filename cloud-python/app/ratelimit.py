"""Sign-in throttle — the Python twin of cloud/src/ratelimit.js.

The desktop's own API throttles its login endpoint, for a reason that applies
far more strongly here: these endpoints are on the public internet, and one of
them now takes STAFF credentials — an account that can read a school's roster
and write its registers. Unthrottled, a school's teacher passwords are a
weekend's work for anyone who finds the service.

Keyed by source AND by the account being targeted, deliberately:

* IP alone lets an attacker rotate addresses, and locks out a whole school
  behind one NAT'd connection when the day's first parent mistypes a password.
* Account alone lets one attacker lock every teacher out by failing against
  each username in turn — but paired with the IP limit it is the thing that
  actually stops a slow distributed guess.

In-memory, per process. Render runs several uvicorn workers, so the real limit
is this times the worker count — still three orders of magnitude below what a
password guess needs, and without the operational weight of putting a shared
counter in Postgres on the login path.
"""
import time

WINDOW_SECONDS = 60
MAX_PER_WINDOW = 20

_attempts = {}


def client_ip(request):
    """Behind Render or Vercel the socket address is the proxy's, so the
    caller's address is the first entry of X-Forwarded-For. It is spoofable by
    anyone talking to the service directly — which is why the per-account limit
    exists and does not depend on it."""
    fwd = request.headers.get("x-forwarded-for") if request is not None else None
    if fwd:
        return fwd.split(",")[0].strip()
    client = getattr(request, "client", None) if request is not None else None
    return getattr(client, "host", "") or ""


def _sweep(now):
    if len(_attempts) < 1000:
        return
    for k in [k for k, v in _attempts.items() if now - v[1] > WINDOW_SECONDS]:
        _attempts.pop(k, None)


def _bump(key, now):
    count, started = _attempts.get(key, (0, now))
    if now - started > WINDOW_SECONDS:
        count, started = 0, now
    count += 1
    _attempts[key] = (count, started)
    return count > MAX_PER_WINDOW


def limited(request, scope, identifier=None):
    """True when this attempt should be refused. Call once per sign-in attempt."""
    now = time.monotonic()
    _sweep(now)
    hit = _bump(f"ip:{scope}:{client_ip(request)}", now)
    if identifier:
        hit = _bump(f"id:{scope}:{str(identifier).lower()[:120]}", now) or hit
    return hit


def reset():
    """Tests need a clean slate between cases."""
    _attempts.clear()
