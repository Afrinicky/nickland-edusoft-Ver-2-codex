"""Serving the web app from the cloud service.

The browser build of the mobile app (`mobile/dist-web`), served from the same
origin as /api/v1 so one URL is the whole product: parents open the portal
address and are in, with no CORS and nothing to install.

It is optional. The usual production shape puts the static build on a CDN
(Vercel) and this service behind it as the API, in which case no build is
installed here and the legacy portal page still answers at `/`. Copy a build
into `cloud-python/webapp/` — the Dockerfile does — or point WEBAPP_DIR at one,
and it takes over.
"""
import os
import posixpath
from urllib.parse import unquote

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
    ".txt": "text/plain; charset=utf-8",
}

_HERE = os.path.dirname(os.path.abspath(__file__))


def _candidates():
    return [
        os.environ.get("WEBAPP_DIR"),
        os.path.join(_HERE, "..", "webapp"),                            # what the Dockerfile fills
        os.path.join(_HERE, "..", "..", "mobile", "dist-web"),          # straight from a local build
    ]


def web_app_root():
    """The installed build directory, or None. Resolved once per process."""
    if not hasattr(web_app_root, "_cached"):
        found = None
        for d in _candidates():
            if not d:
                continue
            try:
                full = os.path.abspath(d)
                if os.path.isfile(os.path.join(full, "index.html")):
                    found = full
                    break
            except OSError:
                continue          # unreadable candidate — try the next
        web_app_root._cached = found
    return web_app_root._cached


def is_available():
    return web_app_root() is not None


def content_type(path):
    return TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")


def cache_header(url_path):
    """Hashed filenames can never be the wrong copy, so cache them hard. The
    shell and the service worker decide what everything else loads, so a stale
    one would pin users to an old build — always revalidate those."""
    if url_path.startswith("/_expo/static/") or url_path.startswith("/assets/"):
        return "public, max-age=31536000, immutable"
    return "no-cache"


def resolve(url_path):
    """Map a URL path to a file inside the build, or None.

    Anything that climbs out of the root — `..`, an absolute path, an encoded
    separator — resolves to None rather than to a file on the server.
    """
    root = web_app_root()
    if not root:
        return None
    rel = unquote(url_path.split("?")[0].split("#")[0])
    if rel.endswith("/"):
        rel += "index.html"
    full = os.path.abspath(os.path.join(root, posixpath.normpath("/" + rel).lstrip("/")))
    if full != root and not full.startswith(root + os.sep):
        return None
    if os.path.isdir(full):
        full = os.path.join(full, "index.html")
    return full if os.path.isfile(full) else None


def shell():
    """The single-page shell, for client-side routes that have no file."""
    root = web_app_root()
    return os.path.join(root, "index.html") if root else None
