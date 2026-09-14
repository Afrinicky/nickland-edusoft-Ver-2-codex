"""How many pupils a school is billed for.

One question, asked from four places — the pricing estimate on the website, the
school's own billing page, the invoice run, and the Superadmin's usage screen —
and it has to give all four the same answer or somebody is going to be billed
for a number they cannot find on any screen.

**Which pupils count.** `billable_student_statuses` in the platform settings,
default `Active`. A pupil who has been withdrawn, has graduated, or whose
record is archived is still in the school's database — that is the point of a
school database — and is not somebody Nickland charges for.

**Where the count comes from.** A school on this platform is one of two shapes,
and both are real:

  * **Hosted.** The school's own Postgres schema is here, so the roll is
    counted with a `SELECT count(*)`. Authoritative.
  * **Desktop, syncing.** The school runs offline and pushes a thin read model
    up. There is no `students` table to count, so the pupil snapshots are
    counted instead. It is as good as the last sync, which is stated rather
    than hidden: `source` says which of the two answered, and `as_of` says when.

A school that is neither — enrolled a minute ago, no database, no sync yet —
counts zero, which is correct rather than an error.
"""
from . import settings as platform_settings
from .repo import now_iso


def billable_statuses(repo):
    return platform_settings.get_list(repo, "billable_student_statuses", ["Active"])


def count_students(store, repo, school_id):
    """The roll, and where the number came from.

    Never raises. This is called on the path that decides whether a school may
    open its register, and a database hiccup must not become a lockout — an
    unreachable tenant answers zero with `source: "unavailable"`, and the
    entitlement layer treats that as "do not enforce a pupil ceiling", not as
    "no pupils".
    """
    wanted = billable_statuses(repo)

    try:
        from ..school import db as sdb
        school_db = sdb.SchoolDb(school_id)
        if school_db.exists():
            marks = ", ".join(["%s"] * len(wanted)) or "''"
            billable = int(school_db.value(
                f"SELECT count(*) FROM students WHERE status IN ({marks})",
                tuple(wanted), 0) or 0)
            total = int(school_db.value("SELECT count(*) FROM students", (), 0) or 0)
            staff = int(school_db.value(
                "SELECT count(*) FROM staff WHERE status = 'Active'", (), 0) or 0)
            return {"billable_students": billable, "total_students": total,
                    "staff_count": staff, "source": "database", "as_of": now_iso()}
    except Exception:
        pass

    try:
        snapshots = store.list_snapshots(school_id, "student_snapshot")
        pupils = [s.get("payload") for s in snapshots if s.get("payload")]
        billable = sum(1 for p in pupils if str(p.get("status") or "Active") in wanted)
        newest = max([str(s.get("updated_at") or "") for s in snapshots] or [""])
        return {"billable_students": billable, "total_students": len(pupils),
                "staff_count": 0, "source": "sync", "as_of": newest or now_iso()}
    except Exception:
        pass

    return {"billable_students": 0, "total_students": 0, "staff_count": 0,
            "source": "unavailable", "as_of": now_iso()}


def snapshot(store, repo, school_id, plan_id=""):
    """Write the roll down, as it is now.

    An invoice dispute six months later asks what the roll WAS, and the live
    count will have moved on by then. Cheap enough to take on every billing run
    and on demand from the console.
    """
    counted = count_students(store, repo, school_id)
    return repo.insert("usage_snapshots", {
        "school_id": school_id,
        "captured_at": now_iso(),
        "plan_id": plan_id or "",
        "billable_students": counted["billable_students"],
        "total_students": counted["total_students"],
        "staff_count": counted["staff_count"],
        "detail": {"source": counted["source"]},
    })


def history(repo, school_id, limit=60):
    return repo.find("usage_snapshots", {"school_id": school_id},
                     order_by="captured_at", desc=True, limit=limit)
