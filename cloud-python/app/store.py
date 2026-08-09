"""Storage abstraction — in-memory for dev/tests, Postgres/Neon for production.
Same interface either way, so the API layer is storage-agnostic."""
import os
import secrets
import datetime
from . import auth


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class MemoryStore:
    kind = "memory"

    def __init__(self):
        self._schools = {}    # school_id -> {name, key_hash}
        self._snaps = {}      # school_id -> {entity_key: record}
        self._changes = {}    # school_id -> {"seq": int, "items": [ {id,type,payload} ]}
        self._sid = 1

    def _ensure(self, sid):
        self._snaps.setdefault(sid, {})
        self._changes.setdefault(sid, {"seq": 0, "items": []})

    def create_school(self, name=None, school_id=None):
        sid = school_id or f"sch_{self._sid}"
        self._sid += 1
        key = auth.gen_key()
        self._schools[sid] = {"name": name or sid, "key_hash": auth.hash_key(key)}
        self._ensure(sid)
        return {"school_id": sid, "api_key": key}

    def add_school(self, school_id, name, api_key):
        """Register a school with a caller-supplied key (seeding / migration)."""
        self._schools[school_id] = {"name": name or school_id, "key_hash": auth.hash_key(api_key)}
        self._ensure(school_id)
        return {"school_id": school_id, "name": name or school_id}

    def get_school_by_key(self, key):
        h = auth.hash_key(key)
        for sid, s in self._schools.items():
            if s["key_hash"] == h:
                return {"school_id": sid, "name": s["name"]}
        return None

    def get_school(self, sid):
        s = self._schools.get(sid)
        return {"school_id": sid, "name": s["name"]} if s else None

    def list_schools(self):
        return [{"school_id": sid, "name": s["name"]} for sid, s in self._schools.items()]

    def upsert_snapshot(self, sid, rec):
        self._ensure(sid)
        m = self._snaps[sid]
        existing = m.get(rec["entity_key"])
        if existing and (existing.get("version") or 0) > (rec.get("version") or 0):
            return True
        m[rec["entity_key"]] = {
            "uuid": rec.get("uuid"), "entity_type": rec["entity_type"], "entity_key": rec["entity_key"],
            "op": rec.get("op", "upsert"), "version": rec.get("version", 1),
            "payload": rec.get("payload"), "updated_at": _now_iso(),
        }
        return True

    def list_snapshots(self, sid, entity_type=None):
        m = self._snaps.get(sid, {})
        return [r for r in m.values() if not entity_type or r["entity_type"] == entity_type]

    def enqueue_change(self, sid, ch):
        self._ensure(sid)
        c = self._changes[sid]
        c["seq"] += 1
        c["items"].append({"id": c["seq"], "type": ch["type"], "payload": ch.get("payload", {})})
        return c["seq"]

    def changes_since(self, sid, cursor):
        c = self._changes.get(sid, {"items": []})
        cur = int(cursor or 0)
        items = [i for i in c["items"] if i["id"] > cur]
        nxt = items[-1]["id"] if items else cur
        return {"changes": [{"type": i["type"], "payload": i["payload"]} for i in items], "cursor": nxt}


class PgStore:
    """Postgres/Neon store. Requires psycopg (lazily imported). Run schema.sql once."""
    kind = "pg"

    def __init__(self, dsn):
        import psycopg  # noqa: F401
        from psycopg_pool import ConnectionPool
        self._pool = ConnectionPool(dsn, min_size=1, max_size=8, kwargs={"autocommit": True})

    def _q(self, sql, params=(), fetch=None):
        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                if fetch == "one":
                    return cur.fetchone()
                if fetch == "all":
                    return cur.fetchall()
        return None

    def create_school(self, name=None, school_id=None):
        sid = school_id or ("sch_" + secrets.token_hex(4))
        key = auth.gen_key()
        self._q("INSERT INTO schools (school_id, name, key_hash) VALUES (%s,%s,%s)",
                (sid, name or sid, auth.hash_key(key)))
        return {"school_id": sid, "api_key": key}

    def get_school_by_key(self, key):
        row = self._q("SELECT school_id, name FROM schools WHERE key_hash=%s", (auth.hash_key(key),), "one")
        return {"school_id": row[0], "name": row[1]} if row else None

    def get_school(self, sid):
        row = self._q("SELECT school_id, name FROM schools WHERE school_id=%s", (sid,), "one")
        return {"school_id": row[0], "name": row[1]} if row else None

    def list_schools(self):
        rows = self._q("SELECT school_id, name FROM schools ORDER BY name", (), "all") or []
        return [{"school_id": r[0], "name": r[1]} for r in rows]

    def upsert_snapshot(self, sid, rec):
        import json
        self._q(
            """INSERT INTO snapshots (school_id, entity_type, entity_key, uuid, op, version, payload, updated_at)
                 VALUES (%s,%s,%s,%s,%s,%s,%s, now())
               ON CONFLICT (school_id, entity_key) DO UPDATE
                 SET uuid=EXCLUDED.uuid, op=EXCLUDED.op, version=EXCLUDED.version,
                     payload=EXCLUDED.payload, updated_at=now()
                 WHERE snapshots.version <= EXCLUDED.version""",
            (sid, rec["entity_type"], rec["entity_key"], rec.get("uuid"), rec.get("op", "upsert"),
             rec.get("version", 1), json.dumps(rec.get("payload"))))
        return True

    def list_snapshots(self, sid, entity_type=None):
        if entity_type:
            rows = self._q("SELECT entity_type, entity_key, uuid, op, version, payload, updated_at FROM snapshots WHERE school_id=%s AND entity_type=%s", (sid, entity_type), "all")
        else:
            rows = self._q("SELECT entity_type, entity_key, uuid, op, version, payload, updated_at FROM snapshots WHERE school_id=%s", (sid,), "all")
        return [{"entity_type": r[0], "entity_key": r[1], "uuid": r[2], "op": r[3], "version": r[4], "payload": r[5], "updated_at": str(r[6])} for r in (rows or [])]

    def enqueue_change(self, sid, ch):
        import json
        row = self._q("INSERT INTO cloud_changes (school_id, type, payload) VALUES (%s,%s,%s) RETURNING id",
                      (sid, ch["type"], json.dumps(ch.get("payload", {}))), "one")
        return row[0]

    def changes_since(self, sid, cursor):
        cur = int(cursor or 0)
        rows = self._q("SELECT id, type, payload FROM cloud_changes WHERE school_id=%s AND id > %s ORDER BY id ASC LIMIT 500", (sid, cur), "all") or []
        nxt = rows[-1][0] if rows else cur
        return {"changes": [{"type": r[1], "payload": r[2]} for r in rows], "cursor": nxt}


def create_store():
    dsn = os.environ.get("DATABASE_URL")
    return PgStore(dsn) if dsn else MemoryStore()
