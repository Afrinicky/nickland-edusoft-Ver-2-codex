"""Provision a tenant (school) and print its API key.

  DATABASE_URL="postgres://…?sslmode=require" python scripts/create_school.py "Ave Maria School"

DATABASE_URL is required: a school provisioned into the in-memory store would
print an api_key that stops existing the moment this process ends. Set
ALLOW_MEMORY_STORE=1 as well if you really do want a throwaway dev run.
"""
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.store import create_store

name = " ".join(sys.argv[1:]) or "New School"
store = create_store()
res = store.create_school(name=name)
print("School created:")
print("  name:      ", name)
print("  school_id: ", res["school_id"])
print("  api_key:   ", res["api_key"])
print("\nEnter these on the desktop under Settings → Cloud Sync.")
if store.kind == "memory":
    print("\n(NOTE: memory store — set DATABASE_URL to persist to Neon.)")
