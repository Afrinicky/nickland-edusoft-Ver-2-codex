"""Attaching a picture, online.

The offline equivalent is ``electron/server/uploads_api.js``; the difference is
where the bytes end up, and only that. See ``media.py`` for why a service with
no durable disk keeps the picture in the column the desktop keeps a path in.

Everything else is the same rule the desktop applies:

  * The type is decided by the declared MIME and never by a client filename.
  * Your own face is yours to set; anybody else's is a staff record.
  * A document row can be deleted; on the desktop the file is deliberately left
    behind, and here there is no file to leave — the row IS the document, so
    deleting it is audited at high severity.
"""
from . import media, security


def _denied():
    return {"ok": False, "status": 403, "error": "Access denied."}


def _bad(msg):
    return {"ok": False, "status": 400, "error": msg}


def _missing(msg):
    return {"ok": False, "status": 404, "error": msg}


def student_photo(db, actor, student_id, value):
    if not security.can(actor, "students", "edit"):
        return _denied()
    if not db.one("SELECT id FROM students WHERE id = %s", (int(student_id),)):
        return _missing("No such pupil.")
    uri, error = media.check_data_uri(value)
    if error:
        return _bad(error)
    db.run("UPDATE students SET photo_path = %s WHERE id = %s", (uri, int(student_id)))
    security.audit(db, actor, "student", int(student_id), "upload_photo",
                   media.size_note(uri), "normal")
    # Straight back, so the screen can show the face that was just attached
    # without asking for it again.
    return {"ok": True, "photo": uri}


def staff_photo(db, actor, staff_id, value):
    staff_id = int(staff_id)
    own = actor.get("staff_id") is not None and int(actor["staff_id"]) == staff_id
    if not own and not security.can(actor, "staff", "edit"):
        return _denied()
    if not db.one("SELECT id FROM staff WHERE id = %s", (staff_id,)):
        return _missing("No such member of staff.")
    uri, error = media.check_data_uri(value)
    if error:
        return _bad(error)
    db.run("UPDATE staff SET photo_path = %s WHERE id = %s", (uri, staff_id))
    security.audit(db, actor, "staff", staff_id, "upload_photo",
                   "own photograph" if own else media.size_note(uri), "normal")
    return {"ok": True, "photo": uri}


def documents(db, actor, staff_id):
    staff_id = int(staff_id)
    own = actor.get("staff_id") is not None and int(actor["staff_id"]) == staff_id
    if not own and not security.can(actor, "staff", "view"):
        return _denied()
    return {
        "ok": True,
        "documents": db.all("""
          SELECT id, title, doc_type, expiry_date, uploaded_at
            FROM staff_documents WHERE staff_id = %s
           ORDER BY COALESCE(expiry_date, uploaded_at) DESC""", (staff_id,)),
        "may_edit": security.can(actor, "staff", "edit"),
    }


def save_document(db, actor, staff_id, data):
    if not security.can(actor, "staff", "edit"):
        return _denied()
    staff_id = int(staff_id)
    if not db.one("SELECT id FROM staff WHERE id = %s", (staff_id,)):
        return _missing("No such member of staff.")
    title = str(data.get("title") or "").strip()
    if not title:
        return _bad("What is this document called?")
    uri, error = media.check_data_uri(data.get("file"), media.DOC_TYPES)
    if error:
        return _bad(error)
    expiry = str(data.get("expiryDate") or "")[:10] or None
    if expiry and not _is_iso(expiry):
        return _bad("Use YYYY-MM-DD for the expiry.")
    doc_id = db.insert("staff_documents", {
        "staff_id": staff_id, "title": title,
        "doc_type": str(data.get("docType") or "Other")[:60],
        "file_path": uri, "expiry_date": expiry,
    })
    security.audit(db, actor, "staff_document", doc_id, "upload_document", title, "normal")
    return {"ok": True, "id": doc_id, "title": title, "expiry_date": expiry}


def delete_document(db, actor, doc_id):
    if not (security.can(actor, "staff", "delete") or security.can(actor, "staff", "edit")):
        return _denied()
    row = db.one("SELECT * FROM staff_documents WHERE id = %s", (int(doc_id),))
    if not row:
        return _missing("No such document.")
    # Offline the row goes and the file stays, because a record deleted by
    # mistake is recoverable from the folder. Here the row IS the document, so
    # there is nothing to recover it from — hence 'high'.
    db.run("DELETE FROM staff_documents WHERE id = %s", (int(doc_id),))
    security.audit(db, actor, "staff_document", int(doc_id), "delete_document",
                   row.get("title") or "", "high")
    return {"ok": True}


def logo(db, actor, value):
    if not security.can(actor, "settings", "edit"):
        return _denied()
    uri, error = media.check_data_uri(value)
    if error:
        return _bad(error)
    db.set_setting("school_logo_path", uri, "branding")
    security.audit(db, actor, "settings", None, "upload_logo", media.size_note(uri), "normal")
    return {"ok": True, "logo": uri}


SIGNATURE_ROLES = ("proprietor", "headmaster")


def signature(db, actor, role, value, name=None):
    if not security.can(actor, "settings", "edit"):
        return _denied()
    role = str(role or "")
    if role not in SIGNATURE_ROLES:
        return _bad("A signature belongs to the proprietor or the headmaster.")
    uri, error = media.check_data_uri(value)
    if error:
        return _bad(error)
    db.set_setting(f"{role}_signature_path", uri, "branding")
    if name:
        db.set_setting(f"{role}_name", str(name)[:120], "branding")
    security.audit(db, actor, "settings", None, "upload_signature", role, "high")
    return {"ok": True, "role": role, "signature": uri}


def _is_iso(text):
    import datetime
    try:
        datetime.date.fromisoformat(text)
        return True
    except ValueError:
        return False
