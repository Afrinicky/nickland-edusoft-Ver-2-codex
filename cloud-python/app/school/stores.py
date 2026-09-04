"""Inventory, transport and books — a translation of ``electron/ipc/inventory.js``,
``transport.js`` and the books half of ``fees_extra.js``.

Three small modules that share one shape: a thing a school owns or provides, a
charge attached to it, and a movement or a payment against that charge. Kept
together because separating them would be three files of forty lines each that
all say the same thing in three ways.

Everything that takes money here goes through ``app/school/ledger.py``, so a
book payment, a transport fare and a fee payment all reach the school's books
by the same road.
"""
import datetime

from . import idgen, ledger, security
from .billing import round2


def _today():
    return datetime.date.today().isoformat()


# ── inventory ───────────────────────────────────────────────────────────────

def items(db, actor, category=None, low_stock=False):
    sql = "SELECT * FROM inventory_items WHERE 1=1"
    params = []
    if category:
        sql += " AND category = %s"
        params.append(category)
    if low_stock:
        sql += " AND reorder_level IS NOT NULL AND quantity_on_hand <= reorder_level"
    sql += " ORDER BY name"
    rows = db.all(sql, tuple(params))
    return {"ok": True, "items": rows,
            "value": round2(sum((r["quantity_on_hand"] or 0) * (r["unit_cost"] or 0) for r in rows)),
            "low_stock": sum(1 for r in rows
                             if r["reorder_level"] is not None
                             and (r["quantity_on_hand"] or 0) <= r["reorder_level"]),
            "may_edit": security.can(actor, "finance", "edit")}


def save_item(db, actor, data):
    name = str(data.get("name") or "").strip()
    if not name:
        return {"ok": False, "status": 400, "error": "Give the item a name."}
    row = {k: data[k] for k in ("category", "unit", "unit_cost", "reorder_level",
                                "location", "notes") if k in data}
    row["name"] = name[:120]
    item_id = data.get("id")
    if item_id:
        sets = ", ".join(f'"{k}" = %s' for k in row)
        db.run(f"UPDATE inventory_items SET {sets} WHERE id = %s", tuple(row.values()) + (item_id,))
    else:
        row.setdefault("quantity_on_hand", 0)
        item_id = db.insert("inventory_items", row)
    security.audit(db, actor, "inventory_item", item_id, "save_item", name)
    return {"ok": True, "id": item_id}


def move_stock(db, actor, data):
    """Stock in or out, with the running quantity kept in step.

    The movement and the new quantity are one transaction: a receipt recorded
    without the quantity moving is a store room that does not match its book,
    which is the whole thing an inventory exists to prevent.
    """
    item_id = data.get("item_id") or data.get("inventory_item_id")
    item = db.one("SELECT * FROM inventory_items WHERE id = %s", (item_id,)) if item_id else None
    if not item:
        return {"ok": False, "status": 404, "error": "No such item."}
    try:
        quantity = float(data.get("quantity"))
    except (TypeError, ValueError):
        quantity = 0
    if quantity <= 0:
        return {"ok": False, "status": 400, "error": "Enter a quantity greater than zero."}

    movement = data.get("movement_type") or data.get("type") or "in"
    if movement not in ("in", "out", "adjustment", "damage"):
        return {"ok": False, "status": 400, "error": "That is not a kind of movement."}
    delta = quantity if movement == "in" else -quantity
    if delta < 0 and (item["quantity_on_hand"] or 0) + delta < 0:
        return {"ok": False, "status": 400,
                "error": f'There are only {item["quantity_on_hand"]:g} left.'}

    unit_cost = data.get("unit_cost") if data.get("unit_cost") is not None else item["unit_cost"]
    with db.tx() as tx:
        move_id = tx.insert("inventory_movements", {
            "inventory_item_id": item_id, "movement_type": movement, "quantity": quantity,
            "unit_cost": unit_cost, "total_cost": round2((unit_cost or 0) * quantity),
            "movement_date": data.get("date") or _today(),
            "reference": data.get("reference"), "recorded_by": actor["user_id"],
            "notes": data.get("notes"),
        })
        tx.run("""UPDATE inventory_items
                     SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + %s,
                         unit_cost = COALESCE(%s, unit_cost),
                         updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
                   WHERE id = %s""", (delta, unit_cost, item_id))
    security.audit(db, actor, "inventory_movement", move_id, f"stock_{movement}",
                   f'{quantity:g} × {item["name"]}')
    return {"ok": True, "id": move_id,
            "quantity_on_hand": round2((item["quantity_on_hand"] or 0) + delta)}


def movements(db, actor, item_id=None, limit=200):
    sql = """
      SELECT m.*, i.name AS item_name, i.unit, u.full_name AS recorded_by_name
        FROM inventory_movements m
        JOIN inventory_items i ON i.id = m.inventory_item_id
        LEFT JOIN users u ON u.id = m.recorded_by WHERE 1=1
    """
    params = []
    if item_id:
        sql += " AND m.inventory_item_id = %s"
        params.append(item_id)
    sql += " ORDER BY m.id DESC LIMIT %s"
    params.append(min(int(limit or 200), 500))
    return {"ok": True, "movements": db.all(sql, tuple(params))}


# ── transport ───────────────────────────────────────────────────────────────

def routes(db, actor):
    rows = db.all("""
      SELECT r.*, (SELECT count(*) FROM student_transport st
                    WHERE st.route_id = r.id AND st.is_active = 1) AS riders,
             (SELECT count(*) FROM transport_stops s WHERE s.route_id = r.id) AS stops
        FROM transport_routes r WHERE r.is_active = 1 ORDER BY r.name""")
    return {"ok": True, "routes": rows, "may_edit": security.can(actor, "finance", "edit")}


def route(db, actor, route_id):
    r = db.one("SELECT * FROM transport_routes WHERE id = %s", (route_id,))
    if not r:
        return {"ok": False, "status": 404, "error": "No such route."}
    r["stops"] = db.all("""SELECT id, name, pickup_time, dropoff_time, display_order
                             FROM transport_stops WHERE route_id = %s
                            ORDER BY display_order, id""", (route_id,))
    r["riders"] = db.all("""
      SELECT st.id, st.student_id, st.direction, st.fee_override, st.start_date,
             TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS student_name,
             s.index_number, c.name AS class_name, stop.name AS stop_name
        FROM student_transport st
        JOIN students s ON s.id = st.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        LEFT JOIN transport_stops stop ON stop.id = st.stop_id
       WHERE st.route_id = %s AND st.is_active = 1
       ORDER BY s.surname, s.first_name""", (route_id,))
    return {"ok": True, "route": r}


def save_route(db, actor, data):
    name = str(data.get("name") or "").strip()
    if not name:
        return {"ok": False, "status": 400, "error": "Give the route a name."}
    row = {k: data[k] for k in ("description", "vehicle_number", "driver_name", "driver_phone",
                                "capacity", "fee_per_term") if k in data}
    row["name"] = name[:120]
    route_id = data.get("id")
    if route_id:
        sets = ", ".join(f'"{k}" = %s' for k in row)
        db.run(f"UPDATE transport_routes SET {sets} WHERE id = %s", tuple(row.values()) + (route_id,))
    else:
        row["is_active"] = 1
        route_id = db.insert("transport_routes", row)
    security.audit(db, actor, "transport_route", route_id, "save_route", name)
    return {"ok": True, "id": route_id}


def assign_rider(db, actor, student_id, route_id, stop_id=None, direction="both", fee_override=None):
    if not db.one("SELECT id FROM students WHERE id = %s", (student_id,)):
        return {"ok": False, "status": 404, "error": "That pupil is not on the roll."}
    if not db.one("SELECT id FROM transport_routes WHERE id = %s", (route_id,)):
        return {"ok": False, "status": 404, "error": "No such route."}
    db.run("UPDATE student_transport SET is_active = 0 WHERE student_id = %s", (student_id,))
    row_id = db.insert("student_transport", {
        "student_id": student_id, "route_id": route_id, "stop_id": stop_id,
        "direction": direction if direction in ("both", "morning", "afternoon") else "both",
        "fee_override": fee_override, "start_date": _today(), "is_active": 1,
    })
    security.audit(db, actor, "student_transport", row_id, "assign_transport",
                   f"Pupil {student_id} → route {route_id}")
    return {"ok": True, "id": row_id}


def transport_payment(db, actor, student_id, amount, route_id=None, method="Cash", notes=None):
    amount = round2(amount)
    if amount <= 0:
        return {"ok": False, "status": 400, "error": "Enter an amount greater than zero."}
    term = db.one("SELECT id FROM terms WHERE is_current = 1")
    with db.tx() as tx:
        receipt = f"TR/{datetime.date.today().year % 100}/" \
                  f"{str(idgen.next_receipt_number(tx)).zfill(5)}"
        payment_id = tx.insert("transport_payments", {
            "student_id": student_id, "route_id": route_id,
            "term_id": term["id"] if term else None, "amount": amount,
            "payment_date": _today(), "payment_method": method,
            "received_by": actor["user_id"], "notes": notes, "receipt_number": receipt,
        })
        ledger.post_income(tx, {
            "receipt_number": receipt, "category": "transport", "amount": amount,
            "description": f"Transport fare — {receipt}", "payment_method": method,
            "date": _today(), "source": "transport_payment", "student_id": student_id,
            "term_id": term["id"] if term else None,
            "recorded_by": actor["user_id"], "is_auto": 1,
        })
    security.audit(db, actor, "transport_payment", payment_id, "transport_payment",
                   f"{receipt} — {amount}")
    return {"ok": True, "id": payment_id, "receipt_number": receipt}


# ── books ───────────────────────────────────────────────────────────────────

def books_account(db, actor, student_id, year_id=None):
    year = (db.one("SELECT id, label FROM academic_years WHERE id = %s", (year_id,)) if year_id
            else db.one("SELECT id, label FROM academic_years WHERE is_current = 1"))
    if not year:
        return {"ok": False, "status": 400, "error": "There is no current academic year."}
    account = db.one("""SELECT * FROM student_books
                          WHERE student_id = %s AND academic_year_id = %s""",
                     (student_id, year["id"]))
    items_rows = db.all("""SELECT title, amount, display_order FROM student_books_items
                             WHERE student_books_id = %s ORDER BY display_order, id""",
                        (account["id"],)) if account else []
    payments = db.all("""
      SELECT receipt_number, amount, payment_date, payment_method, reference, is_reversed
        FROM books_payments WHERE student_id = %s ORDER BY payment_date DESC, id DESC LIMIT 50""",
                     (student_id,))
    return {"ok": True, "year": year, "account": account, "items": items_rows,
            "payments": payments, "may_record": security.can(actor, "fees", "create")}


def save_books(db, actor, student_id, items_list, year_id=None):
    """Set what a pupil's books cost this year."""
    year = (db.one("SELECT id FROM academic_years WHERE id = %s", (year_id,)) if year_id
            else db.one("SELECT id FROM academic_years WHERE is_current = 1"))
    if not year:
        return {"ok": False, "status": 400, "error": "There is no current academic year."}
    total = round2(sum(float(i.get("amount") or 0) for i in items_list or []))

    with db.tx() as tx:
        existing = tx.one("""SELECT id, total_paid FROM student_books
                               WHERE student_id = %s AND academic_year_id = %s""",
                          (student_id, year["id"]))
        paid = round2((existing or {}).get("total_paid") or 0)
        if existing:
            books_id = existing["id"]
            tx.run("""UPDATE student_books SET total_amount = %s, balance = %s,
                             updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
                       WHERE id = %s""", (total, round2(total - paid), books_id))
            tx.run("DELETE FROM student_books_items WHERE student_books_id = %s", (books_id,))
        else:
            student = tx.one("SELECT current_class_id FROM students WHERE id = %s", (student_id,))
            books_id = tx.insert("student_books", {
                "student_id": student_id, "academic_year_id": year["id"],
                "class_group_id": (student or {}).get("current_class_id"),
                "total_amount": total, "total_paid": 0, "balance": total,
            })
        for n, item in enumerate(items_list or [], start=1):
            tx.run("""INSERT INTO student_books_items (student_books_id, title, amount, display_order)
                        VALUES (%s,%s,%s,%s)""",
                   (books_id, str(item.get("title") or "")[:200],
                    round2(item.get("amount")), n))

    security.audit(db, actor, "student_books", books_id, "save_books",
                   f"Pupil {student_id}, {total}")
    return {"ok": True, "id": books_id, "total": total}


def books_payment(db, actor, student_id, amount, method="Cash", reference=None, notes=None):
    amount = round2(amount)
    if amount <= 0:
        return {"ok": False, "status": 400, "error": "Enter an amount greater than zero."}
    year = db.one("SELECT id FROM academic_years WHERE is_current = 1")
    with db.tx() as tx:
        account = tx.one("""SELECT id, total_amount, total_paid FROM student_books
                              WHERE student_id = %s AND academic_year_id = %s""",
                         (student_id, (year or {}).get("id")))
        receipt = f"BK/{datetime.date.today().year % 100}/" \
                  f"{str(idgen.next_receipt_number(tx)).zfill(5)}"
        payment_id = tx.insert("books_payments", {
            "student_id": student_id, "student_books_id": (account or {}).get("id"),
            "amount": amount, "payment_date": _today(), "payment_method": method,
            "reference": reference, "receipt_number": receipt,
            "received_by": actor["user_id"], "notes": notes, "is_reversed": 0,
        })
        if account:
            paid = round2((account["total_paid"] or 0) + amount)
            tx.run("UPDATE student_books SET total_paid = %s, balance = %s WHERE id = %s",
                   (paid, round2((account["total_amount"] or 0) - paid), account["id"]))
        ledger.post_income(tx, {
            "receipt_number": receipt, "category": "books", "amount": amount,
            "description": f"Books payment — {receipt}", "payment_method": method,
            "reference": reference, "date": _today(), "source": "books_payment",
            "student_id": student_id, "recorded_by": actor["user_id"], "is_auto": 1,
        })
    security.audit(db, actor, "books_payment", payment_id, "books_payment", f"{receipt} — {amount}")
    return {"ok": True, "id": payment_id, "receipt_number": receipt}


# ── discounts ───────────────────────────────────────────────────────────────

def discounts(db, actor, student_id=None):
    sql = """
      SELECT d.*, TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS student_name,
             s.index_number, c.name AS class_name, u.full_name AS granted_by_name
        FROM student_discounts d
        JOIN students s ON s.id = d.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        LEFT JOIN users u ON u.id = d.granted_by
       WHERE d.is_active = 1
    """
    params = []
    if student_id:
        sql += " AND d.student_id = %s"
        params.append(student_id)
    sql += " ORDER BY s.surname, s.first_name"
    return {"ok": True, "discounts": db.all(sql, tuple(params))}


def grant_discount(db, actor, data):
    """A fee discount.

    Elevated only. A discount is money the school has decided not to collect,
    and the offline system holds the same line: a bursar records payments, an
    owner decides what a family is charged.
    """
    if not security.is_elevated(actor):
        return {"ok": False, "status": 403,
                "error": "Only the Super Admin or the Proprietor may grant a discount."}
    student_id = data.get("student_id") or data.get("studentId")
    reason = str(data.get("reason") or "").strip()
    if not student_id:
        return {"ok": False, "status": 400, "error": "Choose the pupil."}
    if len(reason) < 3:
        return {"ok": False, "status": 400, "error": "Give the reason the discount is granted."}
    discount_type = "percent" if data.get("discount_type") == "percent" else "fixed"
    try:
        value = float(data.get("discount_value"))
    except (TypeError, ValueError):
        value = 0
    if value <= 0 or (discount_type == "percent" and value > 100):
        return {"ok": False, "status": 400, "error": "That is not a usable discount."}

    db.run("UPDATE student_discounts SET is_active = 0 WHERE student_id = %s", (student_id,))
    row_id = db.insert("student_discounts", {
        "student_id": student_id, "discount_type": discount_type, "discount_value": value,
        "reason": reason[:300],
        "applies_to": data.get("applies_to") if data.get("applies_to") in ("fees", "books", "both")
                      else "fees",
        "is_active": 1, "granted_by": actor["user_id"],
    })
    security.audit(db, actor, "student_discount", row_id, "grant_discount",
                   f"Pupil {student_id}: {value}{'%' if discount_type == 'percent' else ''} — {reason}",
                   "high")
    return {"ok": True, "id": row_id,
            "message": "Granted. Regenerate the pupil's bill for it to take effect."}
