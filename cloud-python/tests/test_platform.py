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

    # ── The platform's own audit trail ─────────────────────────────────
    # PRD §1. Isolation here is structural — a key resolves to exactly one
    # school and a connection is pinned to one schema — but "it cannot happen"
    # and "we would know if it did" are different properties, and only the
    # second survives being wrong.
    print("\nWhat the platform writes down")
    s5 = MemoryStore()
    app5 = TestClient(create_app(s5), raise_server_exceptions=False)

    def entries(**kw):
        return s5.list_audit(**kw)

    ck("it starts empty", entries() == [])

    # A key that belongs to nobody.
    app5.get("/api/v1/admin/snapshots", headers={"x-school-key": "sk_not_a_real_key"})
    refused = [e for e in entries() if e["action"] == "key_refused"]
    ck("a school key that belongs to no school is written down", len(refused) == 1, entries())
    ck("...as a refusal, not as ordinary traffic", refused and refused[0]["outcome"] == "refused")
    ck("...belonging to NO school, so a victim's log is not an attacker's diary",
       refused and refused[0].get("school_id") is None, refused)
    ck("...and the key itself is never recorded",
       refused and "sk_not_a_real_key" not in str(refused[0]), refused)

    # A platform key that belongs to nobody — the one that would matter most.
    app5.get("/api/v1/platform/schools", headers={"x-platform-key": "pk_wrong"})
    pk = [e for e in entries() if e["action"] == "platform_key_refused"]
    ck("a refused platform key is written down too", len(pk) == 1, entries())

    # Enrolment and rotation, on the memory store (no schema to create).
    s6 = MemoryStore()
    s6.create_school(name="Audit Me", school_id="audit-me")
    platform_api.rotate_key(s6, "audit-me")
    rot = [e for e in s6.list_audit() if e["action"] == "key_rotated"]
    ck("reissuing a key is written down", len(rot) == 1, s6.list_audit())
    ck("...against the school it was for", rot and rot[0]["school_id"] == "audit-me")
    ck("...without the new key in it",
       rot and "sk_" not in str(rot[0].get("detail") or ""), rot)
    platform_api.rotate_key(s6, "nobody-at-all")
    ck("rotating a key for a school that does not exist is written down as a refusal",
       any(e["action"] == "key_rotate_refused" and e["outcome"] == "refused"
           for e in s6.list_audit()), s6.list_audit())

    # Reading it back is the platform's alone.
    ck("a school cannot read the platform's log",
       app5.get("/api/v1/platform/audit",
                headers={"x-platform-key": sch["api_key"]}).status_code == 401)
    r = app5.get("/api/v1/platform/audit", headers={"x-platform-key": KEY})
    ck("the operator can", r.status_code == 200 and r.json().get("ok"), r.status_code)
    ck("and reading it does not bury the refusals it was opened to find",
       len([e for e in r.json()["audit"] if e["outcome"] != "ok"]) >= 2, r.json()["audit"])
    only = app5.get("/api/v1/platform/audit?refused=true", headers={"x-platform-key": KEY}).json()
    ck("which can be narrowed to refusals alone",
       only["audit"] and all(e["outcome"] != "ok" for e in only["audit"]), only["audit"])

    # ── The address, as a request actually arrives ─────────────────────
    # Resolving a hostname was tested above and was called by nothing, which
    # made the whole subdomain design a helper function: a parent opening
    # their school's address got every school on the platform and a picker.
    #
    # The list is read from /portal/schools rather than /info because /info
    # answers from the PROVISIONED schemas when this suite is run with a real
    # DATABASE_URL — a different register, and not the one under test here.
    print("\nA school's own address, asked over HTTP")
    s7 = MemoryStore()
    s7.add_school("ave-maria", "Ave Maria School", "sk_ave")
    s7.add_school("st-johns", "St John's School", "sk_john")
    app7 = TestClient(create_app(s7), raise_server_exceptions=False)

    def ids_at(host, header="host"):
        return sorted(s["school_id"] for s in
                      app7.get("/api/v1/portal/schools", headers={header: host}).json()["schools"])

    ck("a school's address answers with that school alone",
       ids_at("ave-maria.nickland.edu.gh") == ["ave-maria"], ids_at("ave-maria.nickland.edu.gh"))
    ck("...and /info says which school it resolved to, so curl can show it",
       app7.get("/api/v1/info", headers={"host": "ave-maria.nickland.edu.gh"})
          .json().get("school_id") == "ave-maria")
    ck("...while the bare domain names no school",
       "school_id" not in app7.get("/api/v1/info",
                                   headers={"host": "nickland.edu.gh"}).json())
    ck("the edge's forwarded host wins over the internal Host it replaced,\n"
       "  because TLS ends at the edge and Host by then is the platform's own",
       ids_at("st-johns.nickland.edu.gh", header="x-forwarded-host") == ["st-johns"])
    ck("the bare domain still lists every school, for the picker",
       ids_at("nickland.edu.gh") == ["ave-maria", "st-johns"])
    ck("an address under no configured domain lists them too",
       ids_at("ave-maria.evil.com") == ["ave-maria", "st-johns"])
    ck("an address for a school that is not enrolled lists NOBODY",
       ids_at("not-a-school.nickland.edu.gh") == [],
       "a typo must not hand a parent somebody else's school")
    ck("...and says so as an answer, not as an error",
       app7.get("/api/v1/portal/schools",
                headers={"host": "not-a-school.nickland.edu.gh"}).status_code == 200)

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
