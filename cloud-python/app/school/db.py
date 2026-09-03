"""One school's database, online.

The offline system keeps a school in a SQLite file on one PC. The online system
keeps the SAME school — same 81 tables, same columns, same constraints — in its
own Postgres SCHEMA, rendered from the offline definition by
``scripts/schema-to-postgres.mjs``.

Why a schema per school rather than a ``school_id`` column on every table:

  * The offline schema has no ``school_id`` and does not need one. Reusing it
    verbatim is what keeps the two systems the same product; adding a column to
    eighty-one tables would have been a rewrite, and a rewrite drifts.
  * A query cannot reach across two schools by forgetting a WHERE clause,
    because two schools are never in the same table. The isolation is
    structural rather than remembered — which is the only kind that holds at
    four in the morning six months from now.
  * A school can be exported, restored or deleted as a unit: one schema.

Every connection this module hands out has its ``search_path`` pinned to one
school's schema and to nothing else — not even ``public`` — so a query that
names a table it should not know about fails rather than finding one.
"""
import os
import re
import threading

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_SCHEMA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "schema")
_SAFE_ID = re.compile(r"[^a-z0-9_]")

_pool = None
_pool_lock = threading.Lock()


def schema_name(school_id):
    """The Postgres schema holding one school.

    Sanitised rather than quoted-and-trusted: a schema name is interpolated
    into DDL that cannot take a parameter, so the only safe input is one that
    cannot contain anything but letters, digits and underscores.
    """
    cleaned = _SAFE_ID.sub("_", str(school_id or "").strip().lower())
    if not cleaned:
        raise ValueError("A school id is required.")
    return f"school_{cleaned[:48]}"


def pool():
    """The shared connection pool, opened on first use.

    ``min_size=0`` so a scaled-to-zero Neon database never blocks boot, matching
    what the thin-cloud store already does.
    """
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is None:
            dsn = os.environ.get("DATABASE_URL")
            if not dsn:
                raise RuntimeError(
                    "DATABASE_URL is not set. The online system keeps every school's "
                    "database in Postgres; without it there is nothing to serve."
                )
            _pool = ConnectionPool(dsn, min_size=0, max_size=12, open=True,
                                   kwargs={"autocommit": True, "row_factory": dict_row})
    return _pool


def _read(name):
    with open(os.path.join(_SCHEMA_DIR, name), encoding="utf-8") as fh:
        return fh.read()


class SchoolDb:
    """A handle on one school's database.

    Deliberately small: ``one``, ``all``, ``run`` and a transaction. The ported
    modules read like the offline ones they came from — the offline system uses
    ``db.prepare(sql).get()`` / ``.all()`` / ``.run()`` and these are the same
    three things — so a reviewer can hold the two side by side.
    """

    def __init__(self, school_id):
        self.school_id = school_id
        self.schema = schema_name(school_id)

    # ── connections ─────────────────────────────────────────────────────────
    def _conn(self):
        """A connection pinned to this school and nothing else.

        `search_path` is set to the school's schema alone. Omitting `public` is
        deliberate: an unqualified table name that is not this school's fails
        loudly instead of silently resolving somewhere shared.
        """
        cm = pool().connection()
        conn = cm.__enter__()
        try:
            conn.execute(f'SET search_path TO "{self.schema}"')
        except Exception:
            cm.__exit__(None, None, None)
            raise
        return cm, conn

    def all(self, sql, params=()):
        cm, conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.fetchall()
        finally:
            cm.__exit__(None, None, None)

    def one(self, sql, params=()):
        rows = self.all(sql, params)
        return rows[0] if rows else None

    def value(self, sql, params=(), default=None):
        """The first column of the first row — for the COUNT and SUM reads the
        offline modules are full of."""
        row = self.one(sql, params)
        if not row:
            return default
        first = next(iter(row.values()))
        return default if first is None else first

    def run(self, sql, params=()):
        """A write. Returns the row when the statement RETURNs one, else the
        number of rows affected."""
        cm, conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                if cur.description:
                    row = cur.fetchone()
                    return row
                return cur.rowcount
        finally:
            cm.__exit__(None, None, None)

    def insert(self, table, data, returning="id"):
        """One row, and the id it was given.

        The offline modules write ``INSERT ... VALUES`` by hand and read
        ``lastInsertRowid``; this is the same thing said once instead of ninety
        times, and it keeps column names out of f-strings that take values.
        """
        cols = list(data.keys())
        placeholders = ", ".join(["%s"] * len(cols))
        names = ", ".join(f'"{c}"' for c in cols)
        sql = f'INSERT INTO "{table}" ({names}) VALUES ({placeholders})'
        if returning:
            sql += f' RETURNING "{returning}"'
        row = self.run(sql, tuple(data.values()))
        return row[returning] if (returning and isinstance(row, dict)) else None

    class _Tx:
        def __init__(self, db):
            self.db = db
            self._cm = None
            self.conn = None

        def __enter__(self):
            self._cm, self.conn = self.db._conn()
            self.conn.autocommit = False
            return self

        def all(self, sql, params=()):
            with self.conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.fetchall()

        def one(self, sql, params=()):
            rows = self.all(sql, params)
            return rows[0] if rows else None

        def run(self, sql, params=()):
            with self.conn.cursor() as cur:
                cur.execute(sql, params)
                if cur.description:
                    return cur.fetchone()
                return cur.rowcount

        def insert(self, table, data, returning="id"):
            cols = list(data.keys())
            placeholders = ", ".join(["%s"] * len(cols))
            names = ", ".join(f'"{c}"' for c in cols)
            sql = f'INSERT INTO "{table}" ({names}) VALUES ({placeholders})'
            if returning:
                sql += f' RETURNING "{returning}"'
            row = self.run(sql, tuple(data.values()))
            return row[returning] if (returning and isinstance(row, dict)) else None

        def __exit__(self, exc_type, exc, tb):
            try:
                if exc_type is None:
                    self.conn.commit()
                else:
                    self.conn.rollback()
            finally:
                try:
                    self.conn.autocommit = True
                finally:
                    self._cm.__exit__(exc_type, exc, tb)
            return False

    def tx(self):
        """A transaction, for the writes that are one act in two tables.

        Money needs this and needs it exactly: a payment that recorded itself
        but failed to reduce the bill is worse than one that did not record.
        """
        return SchoolDb._Tx(self)

    # ── settings ────────────────────────────────────────────────────────────
    # The offline system reaches for these constantly (utils/idgen.js), so they
    # are here rather than in a module something has to remember to import.
    def get_setting(self, key, fallback=""):
        row = self.one("SELECT value FROM settings WHERE key = %s", (key,))
        return fallback if row is None or row["value"] is None else row["value"]

    def set_setting(self, key, value, category="system"):
        self.run(
            """INSERT INTO settings (key, value, category) VALUES (%s, %s, %s)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
            (key, "" if value is None else str(value), category))
        return True

    def exists(self):
        with pool().connection() as conn:
            row = conn.execute(
                "SELECT 1 FROM information_schema.schemata WHERE schema_name = %s",
                (self.schema,)).fetchone()
            return bool(row)


def provision(school_id, seed=True):
    """Create a school's database.

    The schema and the seed are both generated from the offline system, so a
    school provisioned here opens on exactly the designations, classes,
    subjects, grading bands and settings a school provisioned on a desktop
    does. Re-running is harmless: every statement is ``IF NOT EXISTS`` or
    ``ON CONFLICT DO NOTHING``.
    """
    name = schema_name(school_id)
    with pool().connection() as conn:
        conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{name}"')
        conn.execute(f'SET search_path TO "{name}"')
        conn.execute(_read("school.sql"))
        if seed:
            conn.execute(_read("seed.sql"))
    return name


def provisioned():
    """Every school this service holds, with the name each calls itself.

    The connect screen needs it: a parent has to pick their school before they
    can sign in, and asking them to type an identifier nobody gave them is not
    a thing to ship. It lists ids and names and nothing else — the same shape
    the thin cloud has always answered with.
    """
    out = []
    with pool().connection() as conn:
        rows = conn.execute(
            """SELECT schema_name FROM information_schema.schemata
                WHERE schema_name LIKE 'school\\_%' ESCAPE '\\'
                ORDER BY schema_name""").fetchall()
        for row in rows:
            name = row["schema_name"]
            school_id = name[len("school_"):]
            try:
                conn.execute(f'SET search_path TO "{name}"')
                found = conn.execute(
                    "SELECT value FROM settings WHERE key = 'school_name'").fetchone()
                out.append({"school_id": school_id,
                            "name": (found or {}).get("value") or school_id})
            except Exception:
                # A schema that is not a school, or one half-provisioned. Skip
                # it rather than failing the whole list.
                continue
    return out


def drop(school_id):
    """Remove a school entirely. Used by tests and by an operator retiring a
    tenant; there is no route that reaches it."""
    name = schema_name(school_id)
    with pool().connection() as conn:
        conn.execute(f'DROP SCHEMA IF EXISTS "{name}" CASCADE')
    return name
