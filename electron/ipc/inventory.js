// Nickland Edusoft — Inventory IPC
// Lightweight purchase ledger: every "purchase-class" expense creates an
// inventory movement; quantity_on_hand is maintained on the parent item.
// Copyright © 2026 Nickland Sales. All rights reserved.

// Expense categories that flow into inventory automatically
const INVENTORY_CATEGORIES = ['supplies', 'canteen_supplies', 'construction', 'maintenance'];

function recordMovementInternal(db, data) {
  const totalCost = (data.quantity || 0) * (data.unit_cost || 0);
  const r = db.prepare(`
    INSERT INTO inventory_movements
      (inventory_item_id, movement_type, quantity, unit_cost, total_cost,
       movement_date, reference, linked_expense_id, recorded_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.inventory_item_id, data.movement_type,
    data.quantity, data.unit_cost || 0, totalCost,
    data.movement_date, data.reference || null,
    data.linked_expense_id || null, data.recorded_by || null,
    data.notes || null
  );

  // Adjust on-hand quantity
  const delta = data.movement_type === 'in' ? data.quantity : -data.quantity;
  db.prepare(`
    UPDATE inventory_items SET
      quantity_on_hand = quantity_on_hand + ?,
      unit_cost = CASE WHEN ? > 0 THEN ? ELSE unit_cost END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(delta, data.unit_cost || 0, data.unit_cost || 0, data.inventory_item_id);

  return r.lastInsertRowid;
}

module.exports = function registerInventoryHandlers(ipcMain, db) {

  // Items
  ipcMain.handle('inventory:list-items', (_e, filters = {}) => {
    let sql = `
      SELECT i.*,
             (SELECT COUNT(*) FROM inventory_movements WHERE inventory_item_id = i.id) AS movement_count
      FROM inventory_items i
      WHERE 1=1
    `;
    const params = [];
    if (filters.category) { sql += ' AND i.category = ?'; params.push(filters.category); }
    if (filters.search) {
      sql += ' AND i.name LIKE ?';
      params.push(`%${filters.search}%`);
    }
    if (filters.lowStock) sql += ' AND i.quantity_on_hand <= i.reorder_level AND i.reorder_level > 0';
    sql += ' ORDER BY i.name';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('inventory:get-item', (_e, id) => {
    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id);
    if (!item) return null;
    item.movements = db.prepare(`
      SELECT im.*, u.full_name AS recorded_by_name,
             e.transaction_number, e.description AS expense_description
      FROM inventory_movements im
      LEFT JOIN users u ON u.id = im.recorded_by
      LEFT JOIN expense_records e ON e.id = im.linked_expense_id
      WHERE im.inventory_item_id = ?
      ORDER BY im.movement_date DESC, im.id DESC
    `).all(id);
    return item;
  });

  ipcMain.handle('inventory:save-item', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE inventory_items SET
          name = ?, category = ?, unit = ?, unit_cost = ?,
          reorder_level = ?, location = ?, notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        data.name, data.category || null, data.unit || 'piece',
        data.unit_cost || 0, data.reorder_level || 0,
        data.location || null, data.notes || null, data.id
      );
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO inventory_items
          (name, category, unit, unit_cost, quantity_on_hand,
           reorder_level, location, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.name, data.category || null, data.unit || 'piece',
        data.unit_cost || 0, data.initial_quantity || 0,
        data.reorder_level || 0, data.location || null, data.notes || null
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  // Manual movement (stock-in or stock-out, not from an expense)
  ipcMain.handle('inventory:record-movement', (_e, data) => {
    if (!data.inventory_item_id || !data.quantity || data.quantity <= 0) {
      return { ok: false, error: 'item_id and positive quantity required' };
    }
    const id = recordMovementInternal(db, data);
    return { ok: true, id };
  });

  // Dashboard
  ipcMain.handle('inventory:dashboard', () => {
    const totalItems = db.prepare('SELECT COUNT(*) AS c FROM inventory_items').get().c;
    const totalValueRow = db.prepare(`
      SELECT COALESCE(SUM(quantity_on_hand * unit_cost), 0) AS total
      FROM inventory_items
    `).get();
    const lowStock = db.prepare(`
      SELECT id, name, quantity_on_hand, reorder_level, unit
      FROM inventory_items
      WHERE quantity_on_hand <= reorder_level AND reorder_level > 0
      ORDER BY (quantity_on_hand - reorder_level)
      LIMIT 10
    `).all();

    const byCategory = db.prepare(`
      SELECT category, COUNT(*) AS items, COALESCE(SUM(quantity_on_hand * unit_cost), 0) AS value
      FROM inventory_items
      WHERE category IS NOT NULL AND category != ''
      GROUP BY category
      ORDER BY value DESC
    `).all();

    const recentMovements = db.prepare(`
      SELECT im.*, i.name AS item_name, i.unit
      FROM inventory_movements im
      JOIN inventory_items i ON i.id = im.inventory_item_id
      ORDER BY im.movement_date DESC, im.id DESC
      LIMIT 10
    `).all();

    // Auto-recorded inventory items count (from expenses)
    const autoFromExpense = db.prepare(`
      SELECT COUNT(*) AS c FROM inventory_movements WHERE linked_expense_id IS NOT NULL
    `).get().c;

    return {
      metrics: {
        total_items: totalItems,
        total_value: Math.round(totalValueRow.total * 100) / 100,
        low_stock_count: lowStock.length,
        auto_records: autoFromExpense,
      },
      low_stock: lowStock,
      by_category: byCategory,
      recent_movements: recentMovements,
    };
  });

  // Auto-record an inventory movement from an expense
  // Called by the expense recording flow when category is in INVENTORY_CATEGORIES
  // Exposed so the finance.js handler can invoke it directly
  ipcMain.handle('inventory:auto-from-expense', (_e, { expenseId, itemName, quantity, unitCost, category, recordedBy }) => {
    if (!itemName || !itemName.trim()) {
      return { ok: false, error: 'item name required' };
    }
    // Find or create the item
    let item = db.prepare('SELECT * FROM inventory_items WHERE LOWER(name) = LOWER(?)').get(itemName.trim());
    if (!item) {
      const r = db.prepare(`
        INSERT INTO inventory_items (name, category, unit, unit_cost, quantity_on_hand)
        VALUES (?, ?, 'piece', ?, 0)
      `).run(itemName.trim(), category || null, unitCost || 0);
      item = { id: r.lastInsertRowid };
    }
    const id = recordMovementInternal(db, {
      inventory_item_id: item.id,
      movement_type: 'in',
      quantity: quantity || 1,
      unit_cost: unitCost || 0,
      movement_date: new Date().toISOString().slice(0, 10),
      linked_expense_id: expenseId,
      recorded_by: recordedBy || null,
      notes: 'Auto-created from expense',
    });
    return { ok: true, item_id: item.id, movement_id: id };
  });

  // Constants exposed for the UI
  ipcMain.handle('inventory:categories', () => INVENTORY_CATEGORIES);
};

module.exports.INVENTORY_CATEGORIES = INVENTORY_CATEGORIES;
