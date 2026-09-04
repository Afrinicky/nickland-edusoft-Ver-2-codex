// Nickland Edusoft — Access Control.
//
// "Who can do what", modelled on SECH_LIMS: pick a role or one person, then set
// how far along the ladder they sit for each area of the app. Levels build on
// each other — View reads, Contribute adds, Manage edits, Full also deletes —
// and anything set to No access is hidden entirely rather than greyed out.
//
// Two tabs:
//   • Roles       — the default access for everyone with that job (Accountant,
//                   Class Teacher…). This is where most schools set things once.
//   • Individuals — a per-person override on top of their role, for the school
//                   with no accountant that wants to give one teacher limited
//                   Finance access without making them an accountant.
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import LevelPills from '../../components/LevelPills.jsx';
import Modal from '../../components/Modal.jsx';

export default function AccessControl() {
  const showToast = useStore(s => s.showToast);
  const [params] = useSearchParams();
  const [catalogue, setCatalogue] = useState(null);
  // The Users list links here with ?tab=individuals&user=<id> for one person.
  const [tab, setTab] = useState(params.get('tab') === 'individuals' ? 'individuals' : 'roles');
  const initialUser = params.get('user') || '';

  useEffect(() => {
    window.api.access.catalogue().then(setCatalogue).catch(() => {});
  }, []);

  if (!catalogue) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  const canManage = catalogue.can_manage;

  return (
    <div className="access-control">
      <div className="card" style={{ background: 'var(--info-bg)', borderLeft: '3px solid var(--info)' }}>
        <strong>Who can do what</strong>
        <div className="text-sm" style={{ marginTop: 6, lineHeight: 1.6 }}>
          Pick a role or one person, then set how much access they have in each area.
          Levels build on each other: <b>View</b> reads, <b>Contribute</b> adds,
          <b> Manage</b> edits, <b>Full</b> also deletes. Anything set to
          <b> No access</b> is hidden entirely, not greyed out.
          {!canManage && <div style={{ marginTop: 6, color: 'var(--warning)' }}>
            You can view this, but only the Super Admin or the Proprietor can make changes.
          </div>}
        </div>
      </div>

      <div className="tabs" style={{ marginTop: 14 }}>
        <button className={'tab' + (tab === 'roles' ? ' active' : '')} onClick={() => setTab('roles')}>Roles</button>
        <button className={'tab' + (tab === 'individuals' ? ' active' : '')} onClick={() => setTab('individuals')}>Individuals</button>
      </div>

      {tab === 'roles'
        ? <RolesTab catalogue={catalogue} canManage={canManage} showToast={showToast} />
        : <IndividualsTab catalogue={catalogue} canManage={canManage} showToast={showToast} initialUser={initialUser} />}
    </div>
  );
}

// ── Roles ──────────────────────────────────────────────────────────────
function RolesTab({ catalogue, canManage, showToast }) {
  const [roles, setRoles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [roleModal, setRoleModal] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh(keepId) {
    const list = await window.api.access.roleMatrix();
    setRoles(list);
    setSelectedId(prev => keepId ?? prev ?? (list[0] && list[0].id));
  }
  useEffect(() => { refresh(); }, []);

  const selected = roles.find(r => r.id === selectedId) || null;

  async function setLevel(module, level) {
    if (!selected) return;
    // Optimistic — the pill flips immediately, reverts on failure.
    setRoles(rs => rs.map(r => r.id === selected.id ? { ...r, levels: { ...r.levels, [module]: level } } : r));
    const res = await window.api.access.setRoleLevel({ designationId: selected.id, module, level });
    if (!res.ok) { showToast(res.error, 'error'); refresh(selected.id); }
    else refresh(selected.id);
  }

  async function setAll(level) {
    if (!selected) return;
    setBusy(true);
    const res = await window.api.access.setRoleAll({ designationId: selected.id, level });
    setBusy(false);
    if (!res.ok) return showToast(res.error, 'error');
    showToast(`Every area set to "${labelFor(catalogue.levels, level)}"`, 'success');
    refresh(selected.id);
  }

  async function removeRole() {
    if (!selected) return;
    const msg = selected.user_count > 0
      ? `Delete the role "${selected.name}"?\n\n${selected.user_count} user(s) currently have it — they will be left with NO role (no access) until you give them a new one.`
      : `Delete the role "${selected.name}"?`;
    if (!window.confirm(msg)) return;
    const res = await window.api.access.deleteRole({ designationId: selected.id });
    if (!res.ok) return showToast(res.error, 'error');
    showToast('Role deleted', 'success');
    setSelectedId(null); refresh(null);
  }

  return (
    <div className="access-split">
      {/* Role list */}
      <div className="access-list">
        {roles.map(r => (
          <button key={r.id}
            className={'access-role-card' + (r.id === selectedId ? ' active' : '')}
            onClick={() => setSelectedId(r.id)}>
            <div className="access-role-name">
              {r.name}
              {r.is_system && <span className="badge badge-muted" style={{ marginLeft: 6, fontSize: 9 }}>built-in</span>}
            </div>
            {r.description && <div className="access-role-desc">{r.description}</div>}
            <div className="access-role-meta">
              {r.always_full
                ? 'Full access to everything'
                : `${r.granted_count} of ${r.module_count} areas · ${r.user_count} user(s)`}
            </div>
          </button>
        ))}
        {canManage && (
          <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }}
            onClick={() => setRoleModal({ mode: 'create' })}>+ New role</button>
        )}
      </div>

      {/* Selected role detail */}
      <div className="access-detail">
        {!selected ? <div className="empty-state"><p>Select a role.</p></div> : (
          <>
            <div className="access-detail-head">
              <div>
                <div className="access-detail-title">{selected.name}</div>
                <div className="text-sm text-muted">{selected.description || 'No description'}</div>
              </div>
              {canManage && !selected.always_full && (
                <div className="row gap-2">
                  {!selected.is_system && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setRoleModal({ mode: 'edit', role: selected })}>Rename</button>
                  )}
                  {selected.is_system && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setRoleModal({ mode: 'edit', role: selected })}>Edit description</button>
                  )}
                  {!selected.is_system && (
                    <button className="btn btn-ghost btn-sm" onClick={removeRole}>Delete</button>
                  )}
                </div>
              )}
            </div>

            {selected.always_full ? (
              <div className="card" style={{ background: 'var(--warning-bg, #FEF3C7)', borderLeft: '3px solid var(--warning)' }}>
                <strong>{selected.name} always has full access to everything.</strong>
                <div className="text-sm" style={{ marginTop: 4 }}>
                  This is by design and cannot be reduced — every school needs at least one
                  account that can never be locked out. To limit someone, give them a
                  different role.
                </div>
              </div>
            ) : (
              <>
                {canManage && (
                  <div className="access-setall">
                    <span className="text-sm text-muted">Set every area to:</span>
                    <LevelPills levels={catalogue.levels} value={null} size="sm"
                      onChange={setAll} disabled={busy} />
                  </div>
                )}
                <ModuleGrid catalogue={catalogue} levels={selected.levels}
                  disabled={!canManage} onChange={setLevel} />
              </>
            )}
          </>
        )}
      </div>

      {roleModal && (
        <RoleModal modal={roleModal} roles={roles}
          onClose={() => setRoleModal(null)}
          onDone={(id) => { setRoleModal(null); refresh(id); }}
          showToast={showToast} />
      )}
    </div>
  );
}

// ── Individuals ────────────────────────────────────────────────────────
function IndividualsTab({ catalogue, canManage, showToast, initialUser }) {
  const currentUser = useStore(s => s.currentUser);
  const reloadPermissions = useStore(s => s.reloadPermissions);
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(initialUser || '');
  const [access, setAccess] = useState(null);

  useEffect(() => { window.api.auth.listUsers().then(u => setUsers(u.filter(x => x.is_active))); }, []);

  async function load(id) {
    if (!id) { setAccess(null); return; }
    const res = await window.api.access.userAccess(parseInt(id));
    setAccess(res.ok ? res : null);
  }
  useEffect(() => { load(userId); }, [userId]);

  async function setLevel(module, level) {
    const res = await window.api.access.setUserLevel({ userId: parseInt(userId), module, level });
    if (!res.ok) return showToast(res.error, 'error');
    await load(userId);
    if (parseInt(userId) === currentUser?.id) reloadPermissions?.();
  }

  async function resetAll() {
    if (!window.confirm('Remove all individual overrides for this person, so they go back to exactly their role?')) return;
    const res = await window.api.access.resetUser({ userId: parseInt(userId) });
    if (!res.ok) return showToast(res.error, 'error');
    showToast(res.cleared ? `Cleared ${res.cleared} override(s)` : 'No overrides to clear', 'success');
    await load(userId);
    if (parseInt(userId) === currentUser?.id) reloadPermissions?.();
  }

  const overrideCount = access ? access.rows.filter(r => r.override_level != null).length : 0;

  return (
    <div>
      <div className="access-setall" style={{ justifyContent: 'space-between' }}>
        <div className="row gap-2">
          <span className="text-sm text-muted">Person:</span>
          <select className="select" value={userId} onChange={e => setUserId(e.target.value)} style={{ minWidth: 240 }}>
            <option value="">— Choose a user —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name} — {u.designation_name || 'no role'}</option>)}
          </select>
        </div>
        {access && overrideCount > 0 && canManage && (
          <button className="btn btn-ghost btn-sm" onClick={resetAll}>Reset to role ({overrideCount} override{overrideCount === 1 ? '' : 's'})</button>
        )}
      </div>

      {!access ? (
        <div className="card"><div className="empty-state"><p>Choose a person to see and adjust their access.</p></div></div>
      ) : access.always_full ? (
        <div className="card" style={{ background: 'var(--warning-bg, #FEF3C7)', borderLeft: '3px solid var(--warning)' }}>
          <strong>{access.user.full_name} is {access.user.designation_name} — always full access.</strong>
          <div className="text-sm" style={{ marginTop: 4 }}>
            Overrides do not apply to this account. Change their role to limit them.
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="text-sm text-muted" style={{ marginBottom: 10 }}>
            Role: <b>{access.user.designation_name || 'no role'}</b>. Each area starts at the
            role's level; set a different level to override it just for this person.
            This is how you give, say, a teacher limited Finance access at a school with
            no accountant — without changing their role.
          </div>
          <ModuleGrid catalogue={catalogue} individual
            rows={access.rows} disabled={!canManage} onChange={setLevel} />
        </div>
      )}
    </div>
  );
}

// ── Shared module grid ─────────────────────────────────────────────────
function ModuleGrid({ catalogue, levels, rows, individual, disabled, onChange }) {
  // Group modules the way the catalogue does (Money / Academics / …).
  const groups = useMemo(() => {
    const g = {};
    for (const m of catalogue.modules) { (g[m.group] = g[m.group] || []).push(m); }
    return g;
  }, [catalogue]);

  const rowFor = (key) => (rows ? rows.find(r => r.module === key) : null);

  return (
    <div className="access-grid">
      {Object.entries(groups).map(([group, mods]) => (
        <div key={group} className="access-group">
          <div className="access-group-title">{group}</div>
          {mods.map(m => {
            const row = rowFor(m.key);
            const value = individual
              ? (row ? row.override_level : null)   // null → "Same as role"
              : (levels ? levels[m.key] : 'no');
            return (
              <div key={m.key} className="access-row">
                <div className="access-row-label">
                  <div className="access-module-name">
                    {m.label}
                    {m.sensitive && <span className="access-sensitive" title="Handles money or system settings">•</span>}
                  </div>
                  <div className="access-module-desc">{m.description}</div>
                  {individual && row && (
                    <div className="access-role-baseline">
                      Role gives: <b>{labelFor(catalogue.levels, row.role_level)}</b>
                      {row.override_level != null && row.override_level !== row.role_level && (
                        <span className="badge badge-warning" style={{ marginLeft: 6, fontSize: 9 }}>overridden</span>
                      )}
                    </div>
                  )}
                </div>
                <LevelPills levels={catalogue.levels} value={value} size="sm"
                  disabled={disabled} onChange={(lvl) => onChange(m.key, lvl)}
                  allowInherit={!!individual} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function RoleModal({ modal, roles, onClose, onDone, showToast }) {
  const isEdit = modal.mode === 'edit';
  const role = modal.role;
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [copyFromId, setCopyFromId] = useState('');
  const [busy, setBusy] = useState(false);
  const systemLocked = isEdit && role?.is_system;

  async function save() {
    setBusy(true);
    let res;
    if (isEdit) res = await window.api.access.updateRole({ designationId: role.id, name, description });
    else res = await window.api.access.createRole({ name, description, copyFromId: copyFromId || undefined });
    setBusy(false);
    if (!res.ok) return showToast(res.error, 'error');
    showToast(isEdit ? 'Role updated' : 'Role created', 'success');
    onDone(res.id || role.id);
  }

  return (
    <Modal title={isEdit ? `Edit ${role.name}` : 'New role'} onClose={onClose} size="sm"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="form-group">
        <label className="label">Role name</label>
        <input className="input" value={name} disabled={systemLocked}
          onChange={e => setName(e.target.value)} placeholder="e.g. Bursar" />
        {systemLocked && <div className="text-xs text-muted">Built-in role names can't change, but you can reword the description.</div>}
      </div>
      <div className="form-group">
        <label className="label">Description</label>
        <textarea className="input" rows={2} value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What this role is for" />
      </div>
      {!isEdit && (
        <div className="form-group">
          <label className="label">Start from (optional)</label>
          <select className="select" value={copyFromId} onChange={e => setCopyFromId(e.target.value)}>
            <option value="">— No access anywhere —</option>
            {roles.filter(r => !r.always_full).map(r => <option key={r.id} value={r.id}>Copy “{r.name}”</option>)}
          </select>
          <div className="text-xs text-muted">Copy another role's access, then adjust — quicker than starting blank.</div>
        </div>
      )}
    </Modal>
  );
}

function labelFor(levels, key) {
  const l = levels.find(x => x.key === key);
  return l ? l.label : key;
}
