"""Enrol a school — both halves of it.

  DATABASE_URL="postgres://…?sslmode=require" \
  PORTAL_BASE_DOMAIN="edusoft.gh" \
  python scripts/create_school.py "Ave Maria School"

This used to write the row in `schools` and stop, which is half the job: the
school's own database — the tables the hosted office application reads — was
never created, so an enrolled school could sync and could not be opened on the
web, and nothing said so. It now goes through the same `provision_school` the
platform API does, so the command line and the API cannot drift apart.

DATABASE_URL is required. A school provisioned into the in-memory store would
print an api_key that stops existing the moment this process ends; set
ALLOW_MEMORY_STORE=1 as well if you really do want a throwaway dev run, and
expect no school database from it.
"""
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.store import create_store
from app import platform_api

name = " ".join(sys.argv[1:]) or "New School"
store = create_store()
res = platform_api.provision_school(store, name)

if not res.get("ok"):
    print("Could not enrol the school:")
    print("  " + str(res.get("error")))
    sys.exit(1)

print("School enrolled:")
print("  name:      ", res["name"])
print("  school_id: ", res["school_id"])
print("  api_key:   ", res["api_key"])
print("  database:  ", res.get("schema") or "(none — memory store)")
for host in platform_api.portal_hosts(res["school_id"]) or []:
    print("  portal:    ", host)
if not platform_api.portal_base_domains():
    print("  portal:     (set PORTAL_BASE_DOMAIN to give the school an address)")
print("\nEnter the id and key on the desktop under Settings → Cloud Sync.")
print("The key is shown once; it is stored only as a hash. A lost key is")
print("reissued with the platform API's rotate-key, never recovered.")
if store.kind == "memory":
    print("\n(NOTE: memory store — set DATABASE_URL to persist.)")
