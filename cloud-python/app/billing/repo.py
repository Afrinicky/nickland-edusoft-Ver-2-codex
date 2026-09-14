"""Where the platform's billing rows live.

The service already has a storage abstraction — ``app/store.py`` — with one
hand-written method per question, twice over, once for Postgres and once for
the in-memory store the tests run on. That shape is right for a dozen methods.
The billing tables would have added something like eighty, and eighty methods
written twice is eighty chances for the two to disagree about something nobody
notices until a test passes on memory and production does something else.

So the billing tables get a repository instead: one small vocabulary —
``insert``, ``get``, ``find``, ``update``, ``delete``, ``count`` — implemented
exactly twice, with the tables themselves described as data in ``TABLES``. Add
a column and it goes in the SQL and in the spec, and every backend has it.

Two properties this buys that matter more than the line count:

  * **No identifier ever comes from a caller.** Table and column names are
    looked up in ``TABLES`` and rejected if they are not there, so the SQL
    builder cannot be handed a name to interpolate. Values are always
    parameters.
  * **Both backends answer in the same shapes.** Postgres hands back
    ``Decimal`` and ``datetime``; the memory store has neither. Rows are
    normalised on the way out — money as ``float``, timestamps as ISO-8601
    UTC strings — so a module written against one backend behaves the same on
    the other, and so the JSON a route returns needs no encoder of its own.

Filters are equality by default, with a small comparison vocabulary for the
handful of questions billing actually asks::

    repo.find("invoices", {"school_id": sid, "status": ("in", ["OPEN", "PAST_DUE"])})
    repo.find("subscriptions", {"current_period_end": ("<", now_iso())})

Anything more than that belongs in Python, over a result set that is a few
hundred rows on the largest deployment this product will ever have. A reporting
query nobody can read is a worse trade than a loop.
"""
import datetime
import decimal
import json
import threading


def now_iso():
    """One clock, one format, everywhere in billing.

    Seconds-resolution UTC with an explicit offset, so the same string sorts
    correctly, compares correctly against a Postgres ``timestamptz``, and is
    the same thing a browser's ``Date`` parses.
    """
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def parse_iso(value):
    """An ISO timestamp from either backend, as a datetime. None when unusable."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime.datetime):
        return value if value.tzinfo else value.replace(tzinfo=datetime.timezone.utc)
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        return None


def shift(value, days=0):
    """A timestamp moved by whole days, as ISO. The billing calendar is days —
    trial length, grace period, invoice due date — and never smaller."""
    base = parse_iso(value) or datetime.datetime.now(datetime.timezone.utc)
    return (base + datetime.timedelta(days=int(days))).replace(microsecond=0).isoformat()


class Table:
    """One table, described well enough to build safe SQL for it."""

    def __init__(self, name, pk, columns, auto_pk=True, json_columns=(), defaults=None):
        self.name = name
        self.pk = pk
        self.columns = list(columns)
        self.auto_pk = auto_pk
        self.json_columns = set(json_columns)
        self.defaults = dict(defaults or {})
        missing = [c for c in ([pk] if pk else []) if c not in self.columns]
        if missing:                                     # pragma: no cover — a typo in this file
            raise ValueError(f"{name}: primary key {missing} is not among its columns")


# ── The tables, as data ─────────────────────────────────────────────────────
# Column lists mirror `schema-saas.sql`. `tests/test_billing.py` parses that
# file and asserts the two agree, so a column added to one and forgotten in the
# other is a failing test rather than a KeyError on a Tuesday.
TABLES = {t.name: t for t in [
    Table("subscription_plans", "plan_id", [
        "plan_id", "name", "description", "tagline", "currency", "billing_interval",
        "base_price", "price_per_student", "included_students", "max_students",
        "trial_enabled", "trial_days", "trial_to_plan", "requires_payment_method",
        "is_active", "is_public", "sort_order", "limits", "created_at", "updated_at",
    ], auto_pk=False, json_columns=["limits"]),

    Table("features", "feature_key", [
        "feature_key", "name", "description", "category", "is_core", "sort_order",
        "created_at",
    ], auto_pk=False),

    # The only table with a composite key. It is addressed by `find` and
    # `upsert_plan_feature` rather than by `get`, so it declares no single pk.
    Table("plan_features", None, [
        "plan_id", "feature_key", "enabled", "limit_value",
    ]),

    Table("subscriptions", "id", [
        "id", "school_id", "plan_id", "status", "currency", "billing_interval",
        "base_price_override", "price_per_student_override", "trial_ends_at",
        "current_period_start", "current_period_end", "grace_ends_at",
        "cancel_at_period_end", "cancelled_at", "ended_at", "provider",
        "provider_customer_id", "provider_subscription_id", "notes",
        "created_at", "updated_at",
    ]),

    Table("subscription_events", "id", [
        "id", "subscription_id", "school_id", "at", "event", "from_status",
        "to_status", "detail", "actor",
    ]),

    Table("school_discounts", "id", [
        "id", "school_id", "kind", "value", "label", "reason", "starts_at",
        "ends_at", "cycles", "cycles_used", "is_active", "created_by",
        "created_at", "revoked_at", "revoked_by",
    ]),

    Table("payment_exemptions", "id", [
        "id", "school_id", "percent", "reason", "starts_at", "ends_at",
        "is_active", "created_by", "created_at", "revoked_at", "revoked_by",
    ]),

    Table("payment_methods", "id", [
        "id", "school_id", "provider", "provider_customer_id", "provider_method_ref",
        "kind", "brand", "last4", "exp_month", "exp_year", "email", "is_default",
        "status", "created_at",
    ]),

    Table("invoices", "id", [
        "id", "invoice_number", "school_id", "school_name", "subscription_id",
        "plan_id", "plan_name", "status", "currency", "period_start", "period_end",
        "student_count", "price_per_student", "base_amount", "gross_amount",
        "discount_amount", "discount_detail", "exemption_amount", "exemption_detail",
        "tax_rate", "tax_amount", "total_amount", "amount_paid", "issued_at",
        "due_at", "paid_at", "voided_at", "notes", "created_at",
    ]),

    Table("invoice_items", "id", [
        "id", "invoice_id", "school_id", "kind", "description", "quantity",
        "unit_amount", "amount", "sort_order",
    ]),

    Table("platform_payments", "id", [
        "id", "school_id", "invoice_id", "subscription_id", "provider",
        "provider_reference", "amount", "currency", "status", "kind",
        "failure_reason", "gateway_status", "attempted_at", "settled_at",
        "refunded_at", "created_at",
    ]),

    Table("billing_webhook_events", "event_id", [
        "event_id", "provider", "event", "received_at",
    ], auto_pk=False),

    Table("usage_snapshots", "id", [
        "id", "school_id", "captured_at", "plan_id", "billable_students",
        "total_students", "staff_count", "detail",
    ], json_columns=["detail"]),

    # Nickland's OWN gateway credentials. A school's live in the school's own
    # schema; these are the other direction of money and are kept apart from
    # them on purpose — see `schema-saas.sql`.
    Table("platform_gateways", "gateway", [
        "gateway", "credentials", "currency", "callback_url", "is_active",
        "verified_at", "verified_detail", "updated_at",
    ], auto_pk=False, json_columns=["credentials"]),

    Table("platform_settings", "key", [
        "key", "value", "updated_at",
    ], auto_pk=False),

    Table("platform_users", "id", [
        "id", "email", "full_name", "password_hash", "role", "is_active",
        "created_at", "last_login_at",
    ]),

    Table("platform_identities", "id", [
        "id", "email", "school_id", "username", "role", "created_at",
    ]),
]}

# Money is NUMERIC in Postgres and therefore Decimal in Python, which is right
# for arithmetic and wrong for JSON. Rounded to the currency's minor unit and
# handed out as float, once, here — so no route has to remember an encoder and
# no two routes can round differently.
_MONEY_PLACES = decimal.Decimal("0.01")


def money(value):
    """A money amount, rounded half-up to two places. Half-up rather than
    Python's banker's rounding because that is what a bursar checking an
    invoice with a calculator will do."""
    if value in (None, ""):
        return 0.0
    try:
        d = decimal.Decimal(str(value)).quantize(_MONEY_PLACES, rounding=decimal.ROUND_HALF_UP)
    except (decimal.InvalidOperation, ValueError):
        return 0.0
    return float(d)


def _normalise(table, row):
    """One row, in the shapes the rest of the service expects."""
    if row is None:
        return None
    out = {}
    for key, value in dict(row).items():
        if isinstance(value, decimal.Decimal):
            out[key] = float(value)
        elif isinstance(value, datetime.datetime):
            out[key] = value.astimezone(datetime.timezone.utc).replace(microsecond=0).isoformat()
        elif isinstance(value, datetime.date):
            out[key] = value.isoformat()
        elif key in table.json_columns and isinstance(value, str):
            try:
                out[key] = json.loads(value or "{}")
            except ValueError:
                out[key] = {}
        else:
            out[key] = value
    return out


class _Filter:
    """A ``where`` mapping, checked once and then usable by either backend."""

    OPERATORS = {"=", "!=", "<", "<=", ">", ">=", "in", "not in", "is null", "is not null"}

    def __init__(self, table, where):
        self.clauses = []
        for column, condition in (where or {}).items():
            if column not in table.columns:
                raise KeyError(f"{table.name} has no column {column!r}")
            if isinstance(condition, tuple) and len(condition) == 2:
                operator, value = condition
                operator = str(operator).lower().strip()
            elif condition is None:
                operator, value = "is null", None
            else:
                operator, value = "=", condition
            if operator not in self.OPERATORS:
                raise ValueError(f"unsupported comparison {operator!r}")
            self.clauses.append((column, operator, value))

    def matches(self, row):
        for column, operator, value in self.clauses:
            if not _compare(row.get(column), operator, value):
                return False
        return True

    def sql(self):
        parts, params = [], []
        for column, operator, value in self.clauses:
            quoted = f'"{column}"'
            if operator == "is null":
                parts.append(f"{quoted} IS NULL")
            elif operator == "is not null":
                parts.append(f"{quoted} IS NOT NULL")
            elif operator in ("in", "not in"):
                items = list(value or [])
                if not items:
                    # An empty IN list matches nothing and an empty NOT IN
                    # matches everything. Said explicitly, because `IN ()` is
                    # not valid SQL and the alternative is a silent crash.
                    parts.append("false" if operator == "in" else "true")
                    continue
                parts.append(f"{quoted} {'IN' if operator == 'in' else 'NOT IN'} "
                             f"({', '.join(['%s'] * len(items))})")
                params.extend(items)
            else:
                parts.append(f"{quoted} {operator} %s")
                params.append(value)
        return (" AND ".join(parts) if parts else "true"), params


def _compare(left, operator, right):
    if operator == "is null":
        return left is None
    if operator == "is not null":
        return left is not None
    if operator == "in":
        return left in list(right or [])
    if operator == "not in":
        return left not in list(right or [])
    if operator == "=":
        return _eq(left, right)
    if operator == "!=":
        return not _eq(left, right)
    if left is None or right is None:
        # SQL's three-valued logic: a comparison against NULL is not true.
        return False
    try:
        if operator == "<":
            return left < right
        if operator == "<=":
            return left <= right
        if operator == ">":
            return left > right
        return left >= right
    except TypeError:
        return False


def _eq(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return bool(left) == bool(right)
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return float(left) == float(right)
    if left is None or right is None:
        return left is right
    return str(left) == str(right)


class MemoryRepo:
    """The in-memory backing. Tests and local runs only, exactly as MemoryStore."""

    kind = "memory"

    def __init__(self):
        self._rows = {name: {} for name in TABLES}
        self._next = {name: 1 for name in TABLES}
        self._lock = threading.RLock()

    # A table with no single-column key still needs somewhere to put its rows;
    # they are keyed by an internal counter and only ever found with `find`.
    def _key_for(self, table, row):
        return row[table.pk] if table.pk else row["__row_id"]

    def insert(self, table_name, values):
        table = TABLES[table_name]
        with self._lock:
            row = {c: None for c in table.columns}
            row.update(table.defaults)
            for column, value in (values or {}).items():
                if column not in table.columns:
                    raise KeyError(f"{table_name} has no column {column!r}")
                row[column] = value
            if table.pk and table.auto_pk and row.get(table.pk) is None:
                row[table.pk] = self._next[table_name]
            if "created_at" in table.columns and row.get("created_at") is None:
                row["created_at"] = now_iso()
            row["__row_id"] = self._next[table_name]
            self._next[table_name] += 1
            key = self._key_for(table, row)
            if key in self._rows[table_name]:
                raise ValueError(f"{table_name}: duplicate key {key!r}")
            self._rows[table_name][key] = row
            return _normalise(table, {k: v for k, v in row.items() if k != "__row_id"})

    def get(self, table_name, key):
        table = TABLES[table_name]
        row = self._rows[table_name].get(key)
        if row is None and key is not None:
            # Ids arrive as strings from a URL and as ints from a database.
            row = next((r for r in self._rows[table_name].values()
                        if table.pk and _eq(r.get(table.pk), key)), None)
        return _normalise(table, {k: v for k, v in row.items() if k != "__row_id"}) if row else None

    def find(self, table_name, where=None, order_by=None, desc=False, limit=None):
        table = TABLES[table_name]
        predicate = _Filter(table, where)
        rows = [r for r in self._rows[table_name].values() if predicate.matches(r)]
        if order_by:
            if order_by not in table.columns:
                raise KeyError(f"{table_name} has no column {order_by!r}")
            rows.sort(key=lambda r: _sort_key(r.get(order_by)), reverse=bool(desc))
        else:
            rows.sort(key=lambda r: r["__row_id"], reverse=bool(desc))
        if limit:
            rows = rows[: int(limit)]
        return [_normalise(table, {k: v for k, v in r.items() if k != "__row_id"}) for r in rows]

    def find_one(self, table_name, where=None, order_by=None, desc=False):
        found = self.find(table_name, where, order_by, desc, limit=1)
        return found[0] if found else None

    def update(self, table_name, key, patch):
        table = TABLES[table_name]
        with self._lock:
            row = self._rows[table_name].get(key)
            if row is None:
                row = next((r for r in self._rows[table_name].values()
                            if table.pk and _eq(r.get(table.pk), key)), None)
            if row is None:
                return None
            for column, value in (patch or {}).items():
                if column not in table.columns:
                    raise KeyError(f"{table_name} has no column {column!r}")
                row[column] = value
            if "updated_at" in table.columns and "updated_at" not in (patch or {}):
                row["updated_at"] = now_iso()
            return _normalise(table, {k: v for k, v in row.items() if k != "__row_id"})

    def update_where(self, table_name, where, patch):
        table = TABLES[table_name]
        predicate = _Filter(table, where)
        changed = []
        with self._lock:
            for row in list(self._rows[table_name].values()):
                if predicate.matches(row):
                    for column, value in (patch or {}).items():
                        if column not in table.columns:
                            raise KeyError(f"{table_name} has no column {column!r}")
                        row[column] = value
                    if "updated_at" in table.columns and "updated_at" not in (patch or {}):
                        row["updated_at"] = now_iso()
                    changed.append(_normalise(table, {k: v for k, v in row.items()
                                                      if k != "__row_id"}))
        return changed

    def delete(self, table_name, key):
        with self._lock:
            table = TABLES[table_name]
            if key in self._rows[table_name]:
                self._rows[table_name].pop(key)
                return True
            match = next((k for k, r in self._rows[table_name].items()
                          if table.pk and _eq(r.get(table.pk), key)), None)
            if match is None:
                return False
            self._rows[table_name].pop(match)
            return True

    def delete_where(self, table_name, where):
        table = TABLES[table_name]
        predicate = _Filter(table, where)
        with self._lock:
            doomed = [k for k, r in self._rows[table_name].items() if predicate.matches(r)]
            for key in doomed:
                self._rows[table_name].pop(key)
            return len(doomed)

    def count(self, table_name, where=None):
        return len(self.find(table_name, where))


def _sort_key(value):
    """Order a column that may hold NULLs beside values. NULLs sort first,
    ascending, which is what ``ORDER BY … NULLS FIRST`` does and what a list of
    invoices with an unset ``paid_at`` should look like."""
    if value is None:
        return (0, "")
    if isinstance(value, bool):
        return (1, int(value))
    if isinstance(value, (int, float)):
        return (1, float(value))
    return (2, str(value))


class PgRepo:
    """The Postgres backing, over the store's existing pool."""

    kind = "pg"

    def __init__(self, store):
        # Borrowed rather than opened: one pool per process, and the store is
        # already holding it. A second pool against the same Neon database
        # would double this service's connection footprint for nothing.
        self._store = store

    def _q(self, sql, params=(), fetch=None):
        return self._store._q(sql, params, fetch)

    def _rows(self, table, sql, params):
        rows = self._q(sql, params, "all") or []
        return [_normalise(table, dict(zip(table.columns, r))) for r in rows]

    def _select(self, table):
        return ", ".join(f'"{c}"' for c in table.columns)

    def insert(self, table_name, values):
        table = TABLES[table_name]
        columns, params = [], []
        for column, value in (values or {}).items():
            if column not in table.columns:
                raise KeyError(f"{table_name} has no column {column!r}")
            columns.append(column)
            params.append(json.dumps(value) if column in table.json_columns else value)
        if not columns:
            raise ValueError(f"{table_name}: nothing to insert")
        names = ", ".join(f'"{c}"' for c in columns)
        marks = ", ".join(["%s"] * len(columns))
        sql = (f'INSERT INTO "{table_name}" ({names}) VALUES ({marks}) '
               f"RETURNING {self._select(table)}")
        row = self._q(sql, tuple(params), "one")
        return _normalise(table, dict(zip(table.columns, row))) if row else None

    def get(self, table_name, key):
        table = TABLES[table_name]
        if not table.pk:
            raise ValueError(f"{table_name} has no single-column key; use find()")
        row = self._q(f'SELECT {self._select(table)} FROM "{table_name}" WHERE "{table.pk}" = %s',
                      (key,), "one")
        return _normalise(table, dict(zip(table.columns, row))) if row else None

    def find(self, table_name, where=None, order_by=None, desc=False, limit=None):
        table = TABLES[table_name]
        clause, params = _Filter(table, where).sql()
        sql = f'SELECT {self._select(table)} FROM "{table_name}" WHERE {clause}'
        if order_by:
            if order_by not in table.columns:
                raise KeyError(f"{table_name} has no column {order_by!r}")
            sql += f' ORDER BY "{order_by}" {"DESC" if desc else "ASC"} NULLS FIRST'
        elif table.pk:
            sql += f' ORDER BY "{table.pk}" {"DESC" if desc else "ASC"}'
        if limit:
            sql += f" LIMIT {int(limit)}"
        return self._rows(table, sql, tuple(params))

    def find_one(self, table_name, where=None, order_by=None, desc=False):
        found = self.find(table_name, where, order_by, desc, limit=1)
        return found[0] if found else None

    def update(self, table_name, key, patch):
        table = TABLES[table_name]
        if not table.pk:
            raise ValueError(f"{table_name} has no single-column key; use update_where()")
        return (self.update_where(table_name, {table.pk: key}, patch) or [None])[0]

    def update_where(self, table_name, where, patch):
        table = TABLES[table_name]
        sets, params = [], []
        for column, value in (patch or {}).items():
            if column not in table.columns:
                raise KeyError(f"{table_name} has no column {column!r}")
            sets.append(f'"{column}" = %s')
            params.append(json.dumps(value) if column in table.json_columns else value)
        if not sets:
            return []
        # Stamped here only when the caller did not say. A caller that supplies
        # its own `updated_at` — the billing run backdating a period, a test
        # ageing a subscription — means it, and adding a second assignment to
        # the same column is not merely redundant: Postgres refuses the
        # statement outright.
        if "updated_at" in table.columns and "updated_at" not in (patch or {}):
            sets.append('"updated_at" = now()')
        clause, where_params = _Filter(table, where).sql()
        sql = (f'UPDATE "{table_name}" SET {", ".join(sets)} WHERE {clause} '
               f"RETURNING {self._select(table)}")
        return self._rows(table, sql, tuple(params + where_params))

    def delete(self, table_name, key):
        table = TABLES[table_name]
        if not table.pk:
            raise ValueError(f"{table_name} has no single-column key; use delete_where()")
        return self.delete_where(table_name, {table.pk: key}) > 0

    def delete_where(self, table_name, where):
        table = TABLES[table_name]
        clause, params = _Filter(table, where).sql()
        rows = self._q(f'DELETE FROM "{table_name}" WHERE {clause} RETURNING 1',
                       tuple(params), "all") or []
        return len(rows)

    def count(self, table_name, where=None):
        table = TABLES[table_name]
        clause, params = _Filter(table, where).sql()
        row = self._q(f'SELECT count(*) FROM "{table_name}" WHERE {clause}', tuple(params), "one")
        return int(row[0]) if row else 0


def repo_for(store):
    """The repository that matches a store, made once and kept on it.

    Attached to the store rather than held in a module global because the test
    suites build several services in one process, each with its own store, and
    a global would quietly give the second one the first one's rows.
    """
    existing = getattr(store, "_billing_repo", None)
    if existing is not None:
        return existing
    made = PgRepo(store) if getattr(store, "kind", "") == "pg" else MemoryRepo()
    try:
        store._billing_repo = made
    except AttributeError:                              # pragma: no cover
        pass
    return made
