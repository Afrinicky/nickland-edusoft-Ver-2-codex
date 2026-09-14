"""Serving the two hand-written interfaces: the website and the console.

One deployment, four addresses (§2):

    www.edusoft.<domain>        the public website      → cloud-python/site
    <domain>                    likewise, bare
    admin.edusoft.<domain>      the Superadmin console  → cloud-python/console
    app.edusoft.<domain>        the school application  → the built web app
    <school>.edusoft.<domain>   likewise, one school
    api.edusoft.<domain>        the API alone

`/api/v1/*` answers identically on every one of them — there is one backend and
one database, and which hostname a request arrived on changes only which HTML
is served (§29). That is why this module is fifty lines and not a routing
framework: the interfaces differ, the platform does not.

**A deployment that has configured no base domain keeps exactly the behaviour
it had.** The school application stays at `/`, and the website and the console
are reachable at `/welcome` and `/console`. That matters because there are
already services running this code on a single Render or Fly hostname, and
"the upgrade moved your parents' app to a marketing page" would be a bad
morning for somebody.

The files themselves are plain HTML, CSS and JavaScript with no build step.
Deliberate: the school application is a large Expo build that takes minutes to
compile, and a marketing site that cannot be edited without running Metro is a
marketing site that does not get edited.
"""
import os
import posixpath
from urllib.parse import unquote

from . import platform_api
from .webapp import TYPES

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


def interface_for(host):
    """Which interface a hostname is asking for.

    `"site"`, `"console"`, or None meaning "the school application", which is
    what every address that is not one of the platform's own is asking for —
    including every school's own subdomain and every deployment that has
    configured no domain at all.
    """
    roots = platform_api.portal_base_domains()
    if not roots:
        return None
    name = str(host or "").strip().lower()
    if not name:
        return None
    name = name.split(",")[0].strip()
    name = name.rsplit(":", 1)[0] if name.count(":") == 1 else name
    name = name.rstrip(".")

    for root in roots:
        if name == root or name == f"www.{root}":
            return "site"
        if name == f"admin.{root}":
            return "console"
        # `app.` and `api.` and every school's own subdomain are the
        # application's; `platform_api.school_id_from_host` already refuses the
        # reserved names, and this is the other half of that same decision.
        if name.endswith(f".{root}"):
            return None
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
