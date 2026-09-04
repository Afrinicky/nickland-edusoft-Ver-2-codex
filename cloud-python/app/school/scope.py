"""What a member of staff may touch — a translation of ``electron/ipc/_scope.js``.

Permissions answer "may this person edit scores at all". This answers the
question that comes straight after: "whose scores". A Subject Teacher with
academics:edit is not thereby entitled to every class in the school.

The model, from ``staff_assignments``:

    class only     (class_group_id, subject_id NULL)
        The whole class. Every subject taught in it.
    class+subject  (class_group_id, subject_id)
        That subject, in that class, and nothing else in it.
    subject only   (class_group_id NULL, subject_id)
        That subject wherever it is taught — the French teacher who takes
        French in all six classes.

The forms combine. ``is_class_teacher`` marks the one member of staff
answerable for a class: the register, the canteen sheet, the report card.

UNRESTRICTED covers the people who run the school. A head teacher who could
only see their own class could not check anybody else's marks, which is most of
the job.
"""

from ..portals import ELEVATED_NAMES

UNRESTRICTED_DESIGNATIONS = [*ELEVATED_NAMES, "Head Teacher"]


def _empty():
    return {
        "unrestricted": False, "staff_id": None,
        "whole_classes": set(),      # class ids held outright
        "class_subjects": {},        # class id -> set of subject ids
        "any_class_subjects": set(), # subject ids taught wherever they occur
        "class_teacher_of": set(),
        "has_assignments": False,
    }


def scope_for(db, user_id, designation=None):
    """Build the scope for a user. Cheap enough to call per request: a handful
    of rows, and staff_assignments is small by construction."""
    scope = _empty()
    if not user_id:
        return scope

    if designation is None:
        row = db.one(
            """SELECT d.name AS designation FROM users u
                 LEFT JOIN designations d ON d.id = u.designation_id
                WHERE u.id = %s""", (user_id,))
        designation = row["designation"] if row else None
    if designation in UNRESTRICTED_DESIGNATIONS:
        scope["unrestricted"] = True
        return scope

    row = db.one("SELECT staff_id FROM users WHERE id = %s", (user_id,))
    staff_id = row["staff_id"] if row else None
    if not staff_id:
        return scope
    scope["staff_id"] = staff_id

    rows = db.all(
        """SELECT class_group_id, subject_id, is_class_teacher
             FROM staff_assignments WHERE staff_id = %s""", (staff_id,))
    scope["has_assignments"] = bool(rows)
    for r in rows:
        cid = r["class_group_id"]
        sid = r["subject_id"]
        if cid and not sid:
            scope["whole_classes"].add(int(cid))
        elif cid and sid:
            scope["class_subjects"].setdefault(int(cid), set()).add(int(sid))
        elif sid and not cid:
            scope["any_class_subjects"].add(int(sid))
        if cid and r["is_class_teacher"]:
            scope["class_teacher_of"].add(int(cid))
    return scope


def can_access_class(scope, class_id):
    if scope["unrestricted"]:
        return True
    try:
        cid = int(class_id)
    except (TypeError, ValueError):
        return False
    if cid in scope["whole_classes"] or cid in scope["class_subjects"]:
        return True
    # A subject taught across the school reaches a class only if the class
    # actually teaches it; that needs the database, so it is resolved by
    # can_access_subject. Seeing the class shell keeps a specialist's picker
    # usable and gives nothing away.
    return bool(scope["any_class_subjects"])


def can_access_subject(scope, class_id, subject_id):
    if scope["unrestricted"]:
        return True
    try:
        cid, sid = int(class_id), int(subject_id)
    except (TypeError, ValueError):
        return False
    if cid in scope["whole_classes"]:
        return True
    if sid in scope["any_class_subjects"]:
        return True
    return sid in scope["class_subjects"].get(cid, set())


def is_class_teacher_of(scope, class_id):
    """The register, the canteen sheet, the end-of-term report: things one
    person is answerable for, not everyone who teaches the class."""
    if scope["unrestricted"]:
        return True
    try:
        return int(class_id) in scope["class_teacher_of"]
    except (TypeError, ValueError):
        return False


def visible_class_ids(db, scope):
    """The class ids to show in a picker or filter a list by.

    ``None`` means no restriction — the caller should not filter at all.
    """
    if scope["unrestricted"]:
        return None
    ids = set(scope["whole_classes"]) | set(scope["class_subjects"].keys())
    if scope["any_class_subjects"]:
        rows = db.all(
            "SELECT DISTINCT class_group_id AS id FROM class_subjects WHERE subject_id = ANY(%s)",
            (list(scope["any_class_subjects"]),))
        for r in rows:
            if r["id"]:
                ids.add(int(r["id"]))
        if not rows:
            # A subject with no class mapping is taught everywhere, which is how
            # the offline reports module already reads it.
            for r in db.all("SELECT id FROM class_groups"):
                ids.add(int(r["id"]))
    return ids


def visible_subject_ids(db, scope, class_id):
    """The subject ids they may touch in one class, or None for no restriction."""
    if scope["unrestricted"]:
        return None
    try:
        cid = int(class_id)
    except (TypeError, ValueError):
        return set()
    if cid in scope["whole_classes"]:
        return None
    return set(scope["any_class_subjects"]) | set(scope["class_subjects"].get(cid, set()))


def can_access_student(db, scope, student_id):
    if scope["unrestricted"]:
        return True
    row = db.one("SELECT current_class_id FROM students WHERE id = %s", (student_id,))
    cid = row["current_class_id"] if row else None
    return can_access_class(scope, cid) if cid else False
