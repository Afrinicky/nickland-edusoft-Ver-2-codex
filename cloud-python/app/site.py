"""Serving the two hand-written interfaces: the website and the console.

Three domains, each configured on its own and none of them borrowing from
another:

    PORTAL_BASE_DOMAIN   the schools', and theirs alone
                         edusoft.gh, ave-maria.edusoft.gh, app.edusoft.gh …
    PUBLIC_SITE_DOMAIN   the public website        → cloud-python/site
    CONSOLE_DOMAIN       the Superadmin console    → cloud-python/console

The portal domain is not touched. Its bare name, its `www`, and every one of
its subdomains go to the school application exactly as they always have — which
is the point: parents and teachers have been given addresses under it, and a
marketing page appearing at one of them is a support call. The website and the
console get domains of their own, or they get nothing.

`/api/v1/*` answers identically on every one of them. There is one backend and
one database, and which hostname a request arrived on changes only which HTML
is served. That is why this module is a hundred lines and not a routing
framework: the interfaces differ, the platform does not.

Matching is EXACT — a domain and its `www`, and nothing else. Not "ends with",
which is what lets the three lists overlap without ambiguity: a deployment can
put the console at `admin.edusoft.com` while the website is `edusoft.com`, and
`admin.` is the console because it was named, not because of where it sits.

**A deployment that configures none of this keeps exactly the behaviour it
had.** Every address gets the school application, and the website and the
console are reached at `/welcome` and `/console`. Those paths also work on a
fully configured deployment, which is what makes local development possible —
on `localhost` every hostname is the same hostname.

The files themselves are plain HTML, CSS and JavaScript with no build step.
Deliberate: the school application is a large Expo build that takes minutes to
compile, and a marketing site that cannot be edited without running Metro is a
marketing site that does not get edited.
"""
import os
import posixpath
from urllib.parse import unquote

import re

from .webapp import TYPES

# Where the website and the console live. Read from the environment on every
# call rather than at import: the test suites set them per case, and a value
# captured once at import is a value a test cannot change.
ENV_SITE_DOMAIN = "PUBLIC_SITE_DOMAIN"
ENV_CONSOLE_DOMAIN = "CONSOLE_DOMAIN"

_HERE = os.path.dirname(os.path.abspath(__file__))

SITE_DIR = os.path.abspath(os.path.join(_HERE, "..", "site"))
CONSOLE_DIR = os.path.abspath(os.path.join(_HERE, "..", "console"))

# The path prefixes that reach an interface directly, whatever the hostname.
# A single-domain deployment needs these; so does anybody developing locally,
# where every host is `localhost`.
SITE_PREFIX = "/welcome"
CONSOLE_PREFIX = "/console"


def _root(kind):
    return {"site": SITE_DIR, "console": CONSOLE_DIR}.get(kind)


def available(kind):
    root = _root(kind)
    return bool(root and os.path.isfile(os.path.join(root, "index.html")))


def shell(kind):
    root = _root(kind)
    path = os.path.join(root, "index.html") if root else None
    return path if path and os.path.isfile(path) else None


def resolve(kind, url_path):
    """A URL path to a file inside one interface, or None.

    Anything that climbs out of the root — `..`, an absolute path, an encoded
    separator — resolves to None rather than to a file on the server.
    """
    root = _root(kind)
    if not root:
        return None
    rel = unquote(str(url_path or "/").split("?")[0].split("#")[0])
    if rel.endswith("/"):
        rel += "index.html"
    full = os.path.abspath(os.path.join(root, posixpath.normpath("/" + rel).lstrip("/")))
    if full != root and not full.startswith(root + os.sep):
        return None
    if os.path.isdir(full):
        full = os.path.join(full, "index.html")
    return full if os.path.isfile(full) else None


def content_type(path):
    return TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")


def cache_header(url_path):
    """The website and the console are small and hand-written, with no hashed
    filenames, so everything revalidates. The alternative is a school looking at
    last month's pricing because their browser kept the page."""
    if url_path.rsplit(".", 1)[-1].lower() in ("woff", "woff2", "ttf", "otf", "png", "jpg",
                                               "jpeg", "svg", "webp", "ico"):
        return "public, max-age=86400"
    return "no-cache"


def domains(env_key):
    """The domains one variable names. One or several, any separator.

        PUBLIC_SITE_DOMAIN="edusoft.com"
        PUBLIC_SITE_DOMAIN="edusoft.com, www.edusoft.com, edusoft.gh"

    Same shape as PORTAL_BASE_DOMAIN, which a deployment is already used to.
    """
    raw = os.environ.get(env_key, "")
    parts = re.split(r"[,;\s]+", str(raw or ""))
    return [p.strip().lstrip(".").rstrip(".").lower() for p in parts if p.strip().strip(".")]


def site_domains():
    return domains(ENV_SITE_DOMAIN)


def console_domains():
    return domains(ENV_CONSOLE_DOMAIN)


def normalise_host(host):
    """A Host header as a bare hostname — no port, no trailing dot, no list."""
    name = str(host or "").strip().lower()
    if not name:
        return ""
    name = name.split(",")[0].strip()          # a forwarded list; the first is the client's
    name = name.rsplit(":", 1)[0] if name.count(":") == 1 else name
    return name.rstrip(".")


def interface_for(host):
    """Which interface a hostname is asking for.

    `"site"`, `"console"`, or None meaning "the school application" — which is
    every address that has not been explicitly named as one of the other two,
    including the whole of the portal domain and every deployment that has
    configured nothing.

    The console is checked FIRST. Where somebody has set the console to a
    subdomain of the website's own domain, naming it explicitly is what decides,
    and checking in this order makes that true regardless of how the two lists
    were written.
    """
    name = normalise_host(host)
    if not name:
        return None
    for kind, roots in (("console", console_domains()), ("site", site_domains())):
        for root in roots:
            # Exact, plus `www.` of it. Never "ends with": a suffix match would
            # make every subdomain of the website's domain the website, and
            # there is no reason for this to guess when it can be told.
            if name == root or name == f"www.{root}":
                return kind
    return None


def interface_for_path(url_path):
    """The explicit way in, for a deployment with one hostname.

    Returns `(kind, path_within_that_interface)` or `(None, url_path)`.
    """
    path = str(url_path or "/")
    for kind, prefix in (("site", SITE_PREFIX), ("console", CONSOLE_PREFIX)):
        if path == prefix or path.startswith(prefix + "/"):
            return kind, path[len(prefix):] or "/"
    return None, path
