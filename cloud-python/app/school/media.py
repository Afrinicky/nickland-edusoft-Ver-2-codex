"""Pictures, online — where there is no disk to put them on.

The installed application writes an uploaded photograph to a folder under its
userData directory and stores the ABSOLUTE PATH in ``photo_path``. That is the
right answer for a machine that owns its own disk, and the wrong one for a
service that does not: this runs on a container that is replaced on every
deploy, so a file written during admission would be gone by Thursday and the
row would point at nothing.

So online the column holds the PICTURE rather than a pointer to it — the same
``data:image/jpeg;base64,…`` string the browser sent, and the same string every
screen already knows how to draw. Both systems answer the question "where is
the face"; one answers with a place and one answers with the thing.

── Why this is not madness ────────────────────────────────────────────────

The browser shrinks a photograph to 800 pixels on the long edge and re-encodes
it as JPEG before it ever reaches the network (``mobile/src/filepick.jsx``), so
what arrives is about eighty kilobytes, not the eight megabytes that came off
the phone. A school of nine hundred pupils is therefore around seventy
megabytes of column — which Postgres stores out of line, in TOAST, compressed,
and never reads unless a query asks for the column.

The alternative is object storage: a bucket, a second set of credentials, a
signed-URL scheme, and a new way for a deploy to be half-configured. That is
the right answer at ten thousand pupils and the wrong one at nine hundred, and
it can be introduced later without changing a single screen — the routes here
return a data URI, and a signed URL would be returned in the same field.

The cap below is what keeps this honest. It is deliberately far below the
offline limit: offline the file goes on a disk the school owns, and here it
goes in a database the school is billed for.
"""
import base64
import re

# Roughly 1.5MB of DECODED bytes. A photograph the browser has already shrunk
# is around 80KB, so anything approaching this is a scan or an unresized
# upload from something that is not our client.
MAX_BYTES = 1_500_000

IMAGE_TYPES = {
    "image/png": "PNG", "image/jpeg": "JPEG", "image/jpg": "JPEG",
    "image/webp": "WebP", "image/gif": "GIF",
}
DOC_TYPES = {**IMAGE_TYPES, "application/pdf": "PDF"}

_DATA_URI = re.compile(r"^data:([a-z0-9.+/-]+);base64,(.*)$", re.I | re.S)


def check_data_uri(value, allowed=None):
    """Validate an uploaded data URI. Returns ``(uri, error)``.

    An error rather than an exception, so a route can say what was wrong with
    the file instead of answering 500 — which is what a person at a counter
    needs, and what the offline routes already do.

    The declared MIME type is what decides whether this is storable; a client
    filename is never consulted, because a client filename is a claim.
    """
    allowed = allowed or IMAGE_TYPES
    text = str(value or "")
    m = _DATA_URI.match(text)
    if not m:
        return None, "Send the file as a data URI (data:<type>;base64,…)."
    mime = m.group(1).lower()
    if mime not in allowed:
        kinds = ", ".join(sorted(set(allowed.values())))
        return None, f"A {mime} is not something this can store. Use {kinds}."
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except Exception:                                        # noqa: BLE001
        return None, "That file could not be read."
    if not raw:
        return None, "That file is empty."
    if len(raw) > MAX_BYTES:
        return None, (f"That file is {len(raw) / 1048576:.1f}MB. The limit is "
                      f"{MAX_BYTES / 1048576:.1f}MB — take the photograph again "
                      f"at a lower size.")
    # Stored as it arrived rather than re-encoded: re-encoding a JPEG only
    # makes it worse, and the bytes have already been checked.
    return text, None


def as_data_uri(stored):
    """What a screen should show for a stored value.

    Online the column holds the picture already. A value that is a filesystem
    path — a row restored from a desktop backup — is not something this service
    can read, so it answers nothing rather than a broken image.
    """
    text = str(stored or "")
    return text if text.startswith("data:") else None


def size_note(uri):
    """How big the stored picture is, for the audit line."""
    try:
        return f"{int(len(str(uri)) * 3 / 4) // 1024}KB"
    except Exception:                                        # noqa: BLE001
        return ""
