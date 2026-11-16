"""What is switched on in this release.

One place, so "is the parent portal on?" has an answer somebody can look up
rather than one they have to infer from four files.

── The parent/student portal is off for this release ────────────────────────

Off, not deleted. The distinction is the whole point of doing it this way:

  * The ``parents`` and ``parent_students`` tables keep every row. A school
    that has already provisioned parent accounts loses nothing.
  * Settings -> Mobile App still provisions them, so an office can prepare for
    the portal coming back.
  * The projection and the sync paths are untouched.

What is off is the SURFACE: a parent cannot sign in, the parent routes answer
404, and the portal page is not served. Turning it back on is this flag.

Deleting the code would have been smaller and is the one thing that cannot be
undone — a pilot school's parent accounts would have gone with it.

The teachers' and staff app is NOT affected. It ships from the same Expo
bundle as the parent app but from different routes (``mobile/app/app/*`` rather
than ``mobile/app/parent/*``), so switching the portal off leaves every
teacher's surface exactly as it was.
"""
import os


def _flag(name, default):
    """An environment override, for a deployment that needs the other answer.

    Read at call time rather than import time so a test can set it without
    reimporting the module.
    """
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def parent_portal_enabled():
    """False for this release. EDUSOFT_PARENT_PORTAL=1 turns it back on."""
    return _flag("EDUSOFT_PARENT_PORTAL", False)


def self_registration_enabled():
    """Whether a school can create ITSELF from the public website.

    False for this release. Schools are set up online by the Super Admin, who
    registers the school, does the initial configuration and hands the
    school's administrator their first credentials. The school then adds its
    own staff.

    That is a deliberate narrowing rather than a missing feature. Every school
    on the platform having been set up by somebody at Nickland is what makes
    "the desktop only ever connects to a setup that already exists" true — and
    that sentence is the whole reason the desktop no longer has to be able to
    create a school, which is the single largest simplification in this
    release.

    The machinery is untouched: identity.register still does the whole act, and
    the console calls it. What is off is the unauthenticated front door.
    EDUSOFT_SELF_REGISTRATION=1 reopens it.
    """
    return _flag("EDUSOFT_SELF_REGISTRATION", False)


def summary():
    """For the boot report, so a deployment says out loud what it is serving."""
    return {
        "parent_portal": parent_portal_enabled(),
        "self_registration": self_registration_enabled(),
    }
