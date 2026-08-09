"""Provision a tenant (school) and print its API key.
  python scripts/create_school.py "Ave Maria School"            (memory — dev)
  DATABASE_URL=… python scripts/create_school.py "Ave Maria School"
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
