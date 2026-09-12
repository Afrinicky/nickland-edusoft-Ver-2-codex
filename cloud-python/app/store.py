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
        self._schools = {}    # school_id -> {name, key_hash, applied_cursor}
        self._snaps = {}      # school_id -> {entity_key: record}
        self._changes = {}    # school_id -> {"seq": int, "items": [ {id,type,payload} ]}
        # Gateway credentials, kept OUT of the snapshot table on purpose.
        # Snapshots are what the staff and parent endpoints read from; a secret
        # kept among them is one forgotten filter away from being served.
        self._payments = {}   # school_id -> {gateway, secret, public_key, ...}
        # Outside every tenant on purpose — see platform_audit in schema.sql.
        self._audit = []
        self._sid = 1

    def _ensure(self, sid):
        self._snaps.setdefault(sid, {})
        self._changes.setdefault(sid, {"seq": 0, "items": []})

    def create_school(self, name=None, school_id=None):
        sid = school_id or f"sch_{self._sid}"
        self._sid += 1
        key = auth.gen_key()
        self._schools[sid] = {"name": name or sid, "key_hash": auth.hash_key(key), "applied_cursor": 0}
        self._ensure(sid)
        return {"school_id": sid, "api_key": key}

    def add_school(self, school_id, name, api_key):
        """Register a school with a caller-supplied key (seeding / migration)."""
        self._schools[school_id] = {"name": name or school_id, "key_hash": auth.hash_key(api_key), "applied_cursor": 0}
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

    def set_school_key(self, sid, api_key):
        """Replace a school's sync key. Only the hash is kept, here as in
        Postgres, so this is a rotation and never a recovery."""
        s = self._schools.get(sid)
        if not s:
            return False
        s["key_hash"] = auth.hash_key(api_key)
        return True

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

    def set_payment_config(self, sid, cfg):
        """Write-mostly. Set by the school's own desktop through the
        school-key admin route; read only by the code that calls the gateway.
        No endpoint returns ``secret``, and none should ever be added."""
        if not cfg or cfg.get("gateway") == "none":
            self._payments.pop(sid, None)
            return True
        self._payments[sid] = {**cfg, "updated_at": _now_iso()}
        return True

    def get_payment_config(self, sid):
        return self._payments.get(sid)

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
        # The desktop asking for everything after `cur` is its receipt for
        # everything up to it — see set_applied_cursor.
        self.set_applied_cursor(sid, cur)
        return {"changes": [{"type": i["type"], "payload": i["payload"]} for i in items], "cursor": nxt}

    def prune_changes(self, sid):
        """The in-memory store lives for one process, so there is nothing to
        reclaim. Present so the two stores answer the same calls."""
        return True

    # ── the platform's own audit trail ──────────────────────────────────
    def record_audit(self, entry):
        self._audit.append({"id": len(self._audit) + 1, "at": _now_iso(), **entry})
        return True

    def list_audit(self, limit=200, school_id=None, refused_only=False):
        rows = list(reversed(self._audit))
        if school_id:
            rows = [r for r in rows if r.get("school_id") == school_id]
        if refused_only:
            rows = [r for r in rows if r.get("outcome") != "ok"]
        return rows[: max(1, min(1000, int(limit or 200)))]

    def set_applied_cursor(self, sid, cursor):
        """How far the desktop has consumed the change queue.

        Recorded on every pull, and the only way the service can tell a
        teacher's write that is still waiting from one the school has already
        applied — which is what lets a teacher who marked a register last night
        see their marks this morning rather than a blank sheet.
        """
        s = self._schools.get(sid)
        n = int(cursor or 0)
        if s and n > s.get("applied_cursor", 0):
            s["applied_cursor"] = n
        return True

    def applied_cursor(self, sid):
        return self._schools.get(sid, {}).get("applied_cursor", 0)

    def pending_changes(self, sid, types=None, limit=500):
        """Changes the desktop has not taken yet, oldest first."""
        c = self._changes.get(sid, {"items": []})
        cur = self.applied_cursor(sid)
        out = [i for i in c["items"] if i["id"] > cur and (not types or i["type"] in types)]
        return [{"id": i["id"], "type": i["type"], "payload": i["payload"]} for i in out[-limit:]]


# The platform's own tables, as SQL, next to this file.
SCHEMA_SQL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schema.sql")

# Advisory lock id for applying it. Arbitrary and constant: two workers booting
# against the same empty database must not both run the file, because
# `CREATE TABLE IF NOT EXISTS` run concurrently deadlocks rather than politely
# doing nothing.
_SCHEMA_LOCK = 0x6E69636B


class PgStore:
    """Postgres/Neon store. Requires psycopg (lazily imported).

    `schema.sql` is applied by the service itself the first time it finds the
    tables missing, so a deployment is one step and not two. It used to be a
    `psql` command in a document, and the failure when somebody skipped it was
    a 500 with a traceback about `relation "schools" does not exist` — from the
    parent portal, on the day the school went live. The file has always been
    written to be re-run (every statement is IF NOT EXISTS), which is what
    makes applying it automatically safe rather than clever.
    """
    kind = "pg"

    def __init__(self, dsn):
        import psycopg  # noqa: F401
        from psycopg_pool import ConnectionPool
        # min_size=0 so a scaled-to-zero Neon / temporarily-down DB never blocks
        # boot; connections open on first use. /health stays DB-independent.
        self._pool = ConnectionPool(dsn, min_size=0, max_size=8, open=True, kwargs={"autocommit": True})
        self._schema_applied = False

    def _run(self, sql, params=(), fetch=None):
        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                if fetch == "one":
                    return cur.fetchone()
                if fetch == "all":
                    return cur.fetchall()
        return None

    def _q(self, sql, params=(), fetch=None):
        """Every query goes through here, which is why the repair lives here.

        A missing table is not retried blindly: it is repaired once per process
        and the query is tried again exactly once. Anything else — a syntax
        error, a constraint, a database that is simply down — is raised as it
        always was.
        """
        try:
            return self._run(sql, params, fetch)
        except Exception as exc:
            if not self._repair_missing_tables(exc):
                raise
            return self._run(sql, params, fetch)

    def _repair_missing_tables(self, exc):
        """True when the error was a missing platform table and it has now been
        created. False for every other error, including a second attempt."""
        try:
            import psycopg
        except Exception:
            return False
        if not isinstance(exc, psycopg.errors.UndefinedTable) or self._schema_applied:
            return False
        self._schema_applied = True     # one attempt per process, success or not
        try:
            self.apply_schema()
            print("[edusoft] The platform tables were missing and have been created "
                  "from schema.sql.", flush=True)
            return True
        except Exception as err:
            print(f"[edusoft] Could not create the platform tables: {err}\n"
                  f"          Load them by hand with: psql \"$DATABASE_URL\" -f {SCHEMA_SQL}",
                  flush=True)
            return False

    def apply_schema(self):
        """Run schema.sql, once across every worker.

        The lock is held for the whole file rather than per statement: the
        point is that the second worker waits and then finds the tables there,
        not that it races through a file of IF NOT EXISTS statements alongside
        the first.
        """
        with open(SCHEMA_SQL, encoding="utf-8") as fh:
            sql = fh.read()
        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_lock(%s)", (_SCHEMA_LOCK,))
                try:
                    cur.execute(sql)
                finally:
                    cur.execute("SELECT pg_advisory_unlock(%s)", (_SCHEMA_LOCK,))
        return True

    def platform_tables_ready(self):
        """Whether the platform's own tables are there — asked at boot so the
        log says it then, rather than a parent finding out at the gate."""
        row = self._run("SELECT to_regclass('public.schools')", (), "one")
        return bool(row and row[0])

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

    def set_school_key(self, sid, api_key):
        """Replace a school's sync key. The column is a hash and always was,
        so the old key cannot be read back — this rotates, it does not recover.
        The school's data is untouched; only what its desktop signs in with
        changes, which is why the school has to be told first."""
        self._q("UPDATE schools SET key_hash=%s WHERE school_id=%s",
                (auth.hash_key(api_key), sid))
        return True

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

    def set_payment_config(self, sid, cfg):
        if not cfg or cfg.get("gateway") == "none":
            self._q("DELETE FROM school_payments WHERE school_id=%s", (sid,))
            return True
        self._q(
            """INSERT INTO school_payments (school_id, gateway, secret, public_key, base_url,
                     currency, callback_url, min_amount, max_amount, enabled, updated_at)
                 VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
               ON CONFLICT (school_id) DO UPDATE
                 SET gateway=EXCLUDED.gateway, secret=EXCLUDED.secret,
                     public_key=EXCLUDED.public_key, base_url=EXCLUDED.base_url,
                     currency=EXCLUDED.currency, callback_url=EXCLUDED.callback_url,
                     min_amount=EXCLUDED.min_amount, max_amount=EXCLUDED.max_amount,
                     enabled=EXCLUDED.enabled, updated_at=now()""",
            (sid, cfg["gateway"], cfg.get("secret", ""), cfg.get("public_key", ""),
             cfg.get("base_url", ""), cfg.get("currency", "GHS"), cfg.get("callback_url", ""),
             cfg.get("min_amount", 1), cfg.get("max_amount", 10000), cfg.get("enabled", True) is not False))
        return True

    def get_payment_config(self, sid):
        row = self._q(
            """SELECT gateway, secret, public_key, base_url, currency, callback_url,
                      min_amount, max_amount, enabled
                 FROM school_payments WHERE school_id=%s""", (sid,), "one")
        if not row:
            return None
        keys = ["gateway", "secret", "public_key", "base_url", "currency",
                "callback_url", "min_amount", "max_amount", "enabled"]
        return dict(zip(keys, row))

    def enqueue_change(self, sid, ch):
        import json
        row = self._q("INSERT INTO cloud_changes (school_id, type, payload) VALUES (%s,%s,%s) RETURNING id",
                      (sid, ch["type"], json.dumps(ch.get("payload", {}))), "one")
        return row[0]

    def changes_since(self, sid, cursor):
        cur = int(cursor or 0)
        rows = self._q("SELECT id, type, payload FROM cloud_changes WHERE school_id=%s AND id > %s ORDER BY id ASC LIMIT 500", (sid, cur), "all") or []
        nxt = rows[-1][0] if rows else cur
        # The desktop asking for everything after `cur` is its receipt for
        # everything up to it — see set_applied_cursor.
        if cur > 0:
            self.set_applied_cursor(sid, cur)
            self.prune_changes(sid)
        return {"changes": [{"type": r[1], "payload": r[2]} for r in rows], "cursor": nxt}

    # How long a change the school has already taken is kept before it is
    # cleared out. Not zero, and deliberately: a desktop restored from a backup
    # comes back with an older cursor, and a queue trimmed to the last receipt
    # would have nothing left to give it. Ninety days is longer than any school
    # holiday and longer than any repair.
    PRUNE_AFTER_DAYS = 90

    def prune_changes(self, sid):
        """Clear out changes the school has both taken and had time to keep.

        The queue used to grow without limit — the cursor simply advanced past
        rows that stayed forever. Not a correctness problem, since replays are
        already safe, but one school's year of registers and marks is a table
        nobody ever empties, on a database every school shares.

        Bounded by the applied cursor AND by age, so a row is only ever removed
        once the desktop has confirmed it has it and ninety days have passed.
        """
        try:
            self._q(
                "DELETE FROM cloud_changes WHERE school_id = %s AND id <= "
                "(SELECT COALESCE(applied_cursor, 0) FROM schools WHERE school_id = %s) "
                "AND created_at < now() - make_interval(days => %s)",
                (sid, sid, self.PRUNE_AFTER_DAYS))
        except Exception:
            # Housekeeping must never fail a teacher's pull.
            pass
        return True

    def set_applied_cursor(self, sid, cursor):
        """How far the desktop has consumed the change queue. GREATEST so an
        out-of-order or replayed pull cannot wind it backwards."""
        self._q("UPDATE schools SET applied_cursor = GREATEST(COALESCE(applied_cursor, 0), %s) WHERE school_id = %s",
                (int(cursor or 0), sid))
        return True

    def applied_cursor(self, sid):
        row = self._q("SELECT COALESCE(applied_cursor, 0) FROM schools WHERE school_id=%s", (sid,), "one")
        return int(row[0]) if row else 0

    # ── the platform's own audit trail ──────────────────────────────────
    def record_audit(self, entry):
        """Write one line to the platform's log.

        Never raises. An audit write that could fail a request would make the
        logging itself a way to break the service — and an operator who cannot
        enrol a school because the log is full is worse off than one with a gap
        in it. Failures here are swallowed deliberately.
        """
        try:
            self._q(
                """INSERT INTO platform_audit (action, school_id, actor, outcome, detail, remote_addr)
                     VALUES (%s,%s,%s,%s,%s,%s)""",
                (entry.get("action"), entry.get("school_id"), entry.get("actor"),
                 entry.get("outcome", "ok"), entry.get("detail"), entry.get("remote_addr")))
        except Exception:
            pass
        return True

    def list_audit(self, limit=200, school_id=None, refused_only=False):
        n = max(1, min(1000, int(limit or 200)))
        where, params = [], []
        if school_id:
            where.append("school_id = %s")
            params.append(school_id)
        if refused_only:
            where.append("outcome <> 'ok'")
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        rows = self._q(
            f"""SELECT id, at, action, school_id, actor, outcome, detail, remote_addr
                  FROM platform_audit {clause} ORDER BY at DESC, id DESC LIMIT {n}""",
            tuple(params), "all") or []
        keys = ["id", "at", "action", "school_id", "actor", "outcome", "detail", "remote_addr"]
        return [dict(zip(keys, (str(r[1]) if i == 1 else r[i] for i, _ in enumerate(keys)))) for r in rows]

    def pending_changes(self, sid, types=None, limit=500):
        cur = self.applied_cursor(sid)
        if types:
            rows = self._q("SELECT id, type, payload FROM cloud_changes WHERE school_id=%s AND id > %s AND type = ANY(%s) ORDER BY id ASC LIMIT %s",
                           (sid, cur, list(types), limit), "all") or []
        else:
            rows = self._q("SELECT id, type, payload FROM cloud_changes WHERE school_id=%s AND id > %s ORDER BY id ASC LIMIT %s",
                           (sid, cur, limit), "all") or []
        return [{"id": int(r[0]), "type": r[1], "payload": r[2]} for r in rows]


def create_store():
    """Pick the backing store.

    MemoryStore is for tests and local runs only. Deploying without
    DATABASE_URL used to fall back to it silently, which fails in two ways that
    look like random breakage rather than misconfiguration: every school,
    parent account and receipt disappears on each restart or redeploy, and
    because the image runs multiple uvicorn workers each worker keeps its own
    copy — so the same request succeeds or 401s depending on which worker
    answers it. Refuse to start instead, unless explicitly opted into.
    """
    dsn = os.environ.get("DATABASE_URL")
    if dsn:
        return PgStore(dsn)
    if os.environ.get("ALLOW_MEMORY_STORE") == "1":
        return MemoryStore()
    raise RuntimeError(
        "DATABASE_URL is not set. The cloud service needs Postgres/Neon — "
        "without it nothing is persisted and each worker process would serve "
        "different data. Set DATABASE_URL (with ?sslmode=require), or set "
        "ALLOW_MEMORY_STORE=1 for a throwaway local/test run."
    )
