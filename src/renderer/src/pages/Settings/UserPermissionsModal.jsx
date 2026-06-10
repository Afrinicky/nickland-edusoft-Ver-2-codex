// Nickland Edusoft — Per-User Permission Matrix
// Lets an Admin/Proprietor edit overrides for one user.
// Each module has 4 actions: View, Create, Edit, Delete.
// "(designation default)" indicates the inherited level if no override is set.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

const MODULES = [
  { key: 'dashboard',     label: 'Dashboard' },
  { key: 'students',      label: 'Students' },
  { key: 'academics',     label: 'Academics' },
  { key: 'fees',          label: 'Fees Management' },
  { key: 'canteen',       label: 'Canteen' },
  { key: 'staff',         label: 'Staff Management' },
  { key: 'payroll',       label: 'Payroll' },
  { key: 'finance',       label: 'Finance & Inventory' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'settings',      label: 'Settings & Users' },
];

const ACTIONS = [
  { key: 'can_view',   label: 'View' },
  { key: 'can_create', label: 'Create' },
  { key: 'can_edit',   label: 'Edit' },
  { key: 'can_delete', label: 'Delete' },
];

export default function UserPermissionsModal({ user, onClose }) {
  const showToast = useStore(s => s.showToast);
  const reloadPermissions = useStore(s => s.reloadPermissions);
  const currentUser = useStore(s => s.currentUser);
  const [designationPerms, setDesignationPerms] = useState({});  // designation defaults
  const [overrides, setOverrides] = useState({});                 // user-specific
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [desigDefaults, userOver] = await Promise.all([
      user.designation_id ? window.api.auth.getDesignationPermissions(user.designation_id) : [],
      window.api.auth.userOverrides(user.id),
    ]);
    const dMap = {}; for (const p of desigDefaults) dMap[p.module] = p;
    const oMap = {}; for (const o of userOver) oMap[o.module] = o;
    setDesignationPerms(dMap);
    setOverrides(oMap);
    setLoading(false);
  }
  useEffect(() => { load(); }, [user.id]);

  // Effective value for a (module, action): override if present, else designation default
  function getEffective(moduleKey, actionKey) {
    if (overrides[moduleKey]) return !!overrides[moduleKey][actionKey];
    if (designationPerms[moduleKey]) return !!designationPerms[moduleKey][actionKey];
    return false;
  }
  function isOverridden(moduleKey) {
    return !!overrides[moduleKey];
  }

  function toggleCheck(moduleKey, actionKey) {
    // Build a complete override row for this module (starting from defaults)
    const base = overrides[moduleKey]
      ? { ...overrides[moduleKey] }
      : (designationPerms[moduleKey]
          ? { ...designationPerms[moduleKey] }
          : { can_view: 0, can_create: 0, can_edit: 0, can_delete: 0 });
    base[actionKey] = base[actionKey] ? 0 : 1;
    setOverrides(prev => ({ ...prev, [moduleKey]: base }));
  }

  function clearOverride(moduleKey) {
    setOverrides(prev => { const n = { ...prev }; delete n[moduleKey]; return n; });
  }

  async function save() {
    setSaving(true);
    // Persist each override (one row per user × module via UPSERT in backend)
    for (const m of MODULES) {
      const o = overrides[m.key];
      if (o) {
        await window.api.auth.setPermissionOverride({
          userId: user.id,
          module: m.key,
          canView: o.can_view ? 1 : 0,
          canCreate: o.can_create ? 1 : 0,
          canEdit: o.can_edit ? 1 : 0,
          canDelete: o.can_delete ? 1 : 0,
        });
      }
    }
    setSaving(false);
    showToast('Permissions saved', 'success');
    // If editing self, reload my own permissions
    if (user.id === currentUser?.id) await reloadPermissions();
    onClose();
  }

  const isProprietorOrAdmin = ['Proprietor', 'Administrator'].includes(user.designation_name);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Permissions — {user.full_name}</div>
            <div className="text-sm text-muted">
              Role: <strong>{user.designation_name || '—'}</strong>. Overrides take precedence over the role defaults.
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {isProprietorOrAdmin && (
          <div className="card" style={{
            background: 'var(--warning-bg, #FEF3C7)',
            borderLeft: '3px solid var(--warning)',
            marginBottom: 14, padding: 14,
          }}>
            <strong>Note:</strong> {user.designation_name} accounts always have full access by design.
            Overrides on this user are ignored at runtime.
          </div>
        )}

        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : <div className="table-wrap">
              <table className="permissions-table">
                <thead>
                  <tr>
                    <th>Module</th>
                    {ACTIONS.map(a => <th key={a.key} className="text-center" style={{ width: 70 }}>{a.label}</th>)}
                    <th className="text-center" style={{ width: 90 }}>Source</th>
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map(m => {
                    const overridden = isOverridden(m.key);
                    return (
                      <tr key={m.key} className={overridden ? 'permission-row-overridden' : ''}>
                        <td><strong>{m.label}</strong></td>
                        {ACTIONS.map(a => (
                          <td key={a.key} className="text-center">
                            <input
                              type="checkbox"
                              checked={getEffective(m.key, a.key)}
                              onChange={() => toggleCheck(m.key, a.key)}
                            />
                          </td>
                        ))}
                        <td className="text-center">
                          {overridden
                            ? <span className="badge badge-warning" style={{ fontSize: 10 }}>Override</span>
                            : <span className="text-xs text-muted">Role default</span>
                          }
                        </td>
                        <td>
                          {overridden && (
                            <button className="btn btn-ghost btn-sm"
                              onClick={() => clearOverride(m.key)}
                              title="Remove override (revert to role default)">
                              ↺
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        }

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Permissions'}
          </button>
        </div>
      </div>
    </div>
  );
}
