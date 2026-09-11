"""Enrolling a school — Nickland's own admin surface.

What this guards is the gap onboarding actually had: `create_school.py` wrote
the registry row and stopped, so an enrolled school could sync and could not be
opened on the web, and nothing said so. A school is two halves and has to be
provisioned, listed and reported on as one thing.

The half that needs Postgres (the school's own 81-table schema) is skipped
where there is none, exactly as the other suites do — but the auth, the tenant
ids, the reconciliation and the subdomain rules are all reachable without it
and are the half that decides who can create a school at all.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

os.environ.setdefault("ALLOW_DEV_SECRET", "1")
os.environ.setdefault("ALLOW_MEMORY_STORE", "1")
os.environ["PLATFORM_ADMIN_KEY"] = "pk_test_" + ("x" * 32)
os.environ["PORTAL_BASE_DOMAIN"] = "nickland.edu.gh"

from fastapi.testclient import TestClient
from app.main import create_app
from app.store import MemoryStore
from app import platform_api

KEY = os.environ["PLATFORM_ADMIN_KEY"]
passed = failed = 0


def ck(name, cond, extra=None):
    global passed, failed
    cond = bool(cond)
    passed += cond
    failed += (not cond)
    print(("✓" if cond else "✗") + " " + name)
    if not cond and extra is not None:
        print("    " + repr(extra))


def main():
    # ── Who may create a school ────────────────────────────────────────
    print("\nWho is allowed to enrol a school")
    store = MemoryStore()
    client = TestClient(create_app(store), raise_server_exceptions=False)

    r = client.get("/api/v1/platform/schools")
    ck("no key at all is refused", r.status_code == 401, r.status_code)
    r = client.get("/api/v1/platform/schools", headers={"x-platform-key": "wrong"})
    ck("a wrong key is refused", r.status_code == 401, r.status_code)

    # A SCHOOL's key is not a platform key. This is the whole reason the two
    # are separate: otherwise every desktop in the country holds one.
    sch = store.create_school(name="Some Other School")
    r = client.get("/api/v1/platform/schools", headers={"x-platform-key": sch["api_key"]})
    ck("a school's own key cannot enrol schools", r.status_code == 401, r.status_code)

    r = client.get("/api/v1/platform/schools", headers={"x-platform-key": KEY})
    ck("the operator's key is accepted", r.status_code == 200, r.status_code)

    # A service with none configured must refuse rather than fall open.
    saved = os.environ.pop("PLATFORM_ADMIN_KEY")
    try:
        bare = TestClient(create_app(MemoryStore()), raise_server_exceptions=False)
        r = bare.get("/api/v1/platform/schools", headers={"x-platform-key": "anything"})
        ck("with no operator key configured, the surface is not there at all",
           r.status_code == 404, r.status_code)
        ck("and an empty key does not open it either",
           bare.get("/api/v1/platform/schools").status_code in (401, 404))
    finally:
        os.environ["PLATFORM_ADMIN_KEY"] = saved
    ck("a key that is too short is treated as none",
       not platform_api.check_key("short"))

    # ── The tenant id ──────────────────────────────────────────────────
    print("\nThe identifier a school keeps for good")
    ck("a name becomes an address", platform_api.slugify("Ave Maria School") == "ave-maria-school")
    ck("punctuation and spacing collapse", platform_api.slugify("  St. Peter's  R/C  JHS ") == "st-peter-s-r-c-jhs")
    ck("a very long name is trimmed to fit a Postgres identifier",
       len(platform_api.slugify("x" * 200)) <= platform_api.MAX_SLUG)

    s2 = MemoryStore()
    a = platform_api.allocate_school_id(s2, "Ave Maria School")
    s2.create_school(name="Ave Maria School", school_id=a)
    b = platform_api.allocate_school_id(s2, "Ave Maria School")
    ck("two schools of the same name get different ids", a != b, (a, b))
    ck("and the second is still readable down a telephone", b == a + "-2", b)
    ck("a name that would shadow the service is pushed aside",
       platform_api.allocate_school_id(MemoryStore(), "API") == "api-school")
    ck("a name with nothing usable in it still yields an id",
       bool(platform_api.allocate_school_id(MemoryStore(), "!!! ???")))

    # ── The school's own address ───────────────────────────────────────
    print("\nTurning a hostname back into a school")
    f = platform_api.school_id_from_host
    ck("a school's subdomain resolves", f("ave-maria.nickland.edu.gh") == "ave-maria")
    ck("a port does not change it", f("ave-maria.nickland.edu.gh:8080") == "ave-maria")
    ck("case and a trailing dot do not either", f("AVE-MARIA.Nickland.Edu.GH.") == "ave-maria")
    ck("the bare domain is not a school", f("nickland.edu.gh") is None)
    ck("a reserved name is not a school", f("www.nickland.edu.gh") is None)
    ck("a deeper name is not a school", f("a.b.nickland.edu.gh") is None)
    ck("ANOTHER DOMAIN ENTIRELY IS NOT A SCHOOL", f("ave-maria.evil.com") is None)
    ck("...not even one that ends in something similar", f("ave-maria.notnickland.edu.gh") is None)
    # The condition that matters is the deployment having no base domain at
    # all, not a caller passing an empty one — an empty argument means "not
    # specified" here, the same as it does for portal_host.
    _saved_domain = os.environ.pop("PORTAL_BASE_DOMAIN")
    try:
        ck("with no base domain configured anywhere, nothing resolves",
           f("ave-maria.nickland.edu.gh") is None)
        ck("...and no school is told it has a portal address",
           platform_api.portal_host("ave-maria") is None)
    finally:
        os.environ["PORTAL_BASE_DOMAIN"] = _saved_domain
    ck("once it is configured again, it resolves as before",
       f("ave-maria.nickland.edu.gh") == "ave-maria")

    # ── More than one domain at a time ─────────────────────────────────
    # A deployment genuinely has several: a product domain and a vendor domain
    # during a rename, a short one for typing and a long one for print, and
    # localhost while developing. None of them belongs in the code.
    print("\nA deployment with several domains")
    many = "edusoft.gh, nickland.edu.gh  localhost"
    ck("they are read as a list, however they are separated",
       platform_api.portal_base_domains(many) == ["edusoft.gh", "nickland.edu.gh", "localhost"],
       platform_api.portal_base_domains(many))
    ck("a school resolves under the first", f("ave-maria.edusoft.gh", base=many) == "ave-maria")
    ck("...and under the second", f("ave-maria.nickland.edu.gh", base=many) == "ave-maria")
    ck("...and under a bare one used in development",
       f("ave-maria.localhost:5173", base=many) == "ave-maria")
    ck("the FIRST is the address the school is given",
       platform_api.portal_host("ave-maria", base=many) == "ave-maria.edusoft.gh")
    ck("but it is told every address it answers to",
       platform_api.portal_hosts("ave-maria", base=many) ==
       ["ave-maria.edusoft.gh", "ave-maria.nickland.edu.gh", "ave-maria.localhost"])
    ck("a domain that is not on the list is still refused",
       f("ave-maria.evil.com", base=many) is None)
    ck("and a reserved name is refused under every one of them",
       all(f(f"www.{d}", base=many) is None for d in ["edusoft.gh", "nickland.edu.gh"]))
    ck("a single domain still works exactly as before",
       f("ave-maria.edusoft.gh", base="edusoft.gh") == "ave-maria")
    ck("and stray commas or dots in the setting are ignored",
       platform_api.portal_base_domains(" , .edusoft.gh. ,, ") == ["edusoft.gh"],
       platform_api.portal_base_domains(" , .edusoft.gh. ,, "))

    # ── Half a school ──────────────────────────────────────────────────
    # The state onboarding could silently leave the platform in, and the one
    # the listing has to name rather than hide.
    print("\nA school that is only half there")
    s3 = MemoryStore()
    s3.create_school(name="Registered Only", school_id="registered-only")
    rows = {r["school_id"]: r for r in platform_api.list_schools(s3)}
    row = rows.get("registered-only")
    ck("a school with no database is listed, not hidden", row is not None)
    ck("...and is not reported as complete", row and row["complete"] is False, row)
    ck("...and says which half is missing, in words",
       row and row["problem"] and "no database" in row["problem"], row and row["problem"])
    ck("...while still showing where its portal would be",
       row and row["portal_host"] == "registered-only.nickland.edu.gh", row)

    # ── Rotating a key ─────────────────────────────────────────────────
    print("\nReissuing a school's sync key")
    s4 = MemoryStore()
    made = s4.create_school(name="Rotate Me", school_id="rotate-me")
    old_key = made["api_key"]
    ck("the original key opens the school", s4.get_school_by_key(old_key) is not None)
    res = platform_api.rotate_key(s4, "rotate-me")
    ck("a fresh key is issued", res["ok"] and res["api_key"] != old_key)
    ck("THE OLD KEY NO LONGER OPENS IT", s4.get_school_by_key(old_key) is None)
    ck("and the new one does", s4.get_school_by_key(res["api_key"])["school_id"] == "rotate-me")
    ck("the school's data is untouched", s4.get_school("rotate-me")["name"] == "Rotate Me")
    ck("an unknown school cannot be rotated",
       platform_api.rotate_key(s4, "nobody")["status"] == 404)

    # ── Provisioning, where there is a database to provision into ──────
    print("\nEnrolling a school for real")
    if not os.environ.get("DATABASE_URL"):
        print("  (skipped — DATABASE_URL is not set, so there is no schema to create.)")
    else:
        from app.school import db as sdb
        store2 = MemoryStore()
        app2 = TestClient(create_app(store2), raise_server_exceptions=False)
        r = app2.post("/api/v1/platform/schools",
                      headers={"x-platform-key": KEY}, json={"name": "Ave Maria School"})
        body = r.json()
        ck("a school is enrolled in one call", r.status_code == 200 and body.get("ok"), body)
        sid = body.get("school_id")
        try:
            ck("its id is a slug of its name", sid == "ave-maria-school", sid)
            ck("it is handed a sync key, once", bool(body.get("api_key")))
            ck("and told where its portal lives",
               body.get("portal_host") == f"{sid}.nickland.edu.gh", body.get("portal_host"))
            ck("the key actually opens it",
               store2.get_school_by_key(body["api_key"])["school_id"] == sid)
            ck("IT HAS A DATABASE, not just a registry row", sdb.SchoolDb(sid).exists())
            ck("which knows the school's own name",
               sdb.SchoolDb(sid).get_setting("school_name") == "Ave Maria School")
            ck("and is seeded, so it opens on a working school",
               (sdb.SchoolDb(sid).value("SELECT COUNT(*) FROM class_groups") or 0) > 0)

            listed = {x["school_id"]: x for x in platform_api.list_schools(store2)}
            ck("the listing reports it complete", listed[sid]["complete"] is True, listed.get(sid))
            ck("with no problem against it", listed[sid]["problem"] is None)

            again = app2.post("/api/v1/platform/schools",
                              headers={"x-platform-key": KEY},
                              json={"name": "Ave Maria School", "school_id": sid})
            ck("enrolling the same id twice is refused rather than duplicated",
               again.status_code == 409, again.status_code)
        finally:
            try: sdb.drop(sid)
            except Exception: pass

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
