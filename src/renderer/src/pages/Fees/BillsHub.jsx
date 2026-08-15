// Nickland Edusoft — Bills hub.
//
// Everything that decides what a parent owes now lives behind one tab, in the
// order the work actually happens: set up the fee schedule, issue the bills,
// add anything that comes up during the term, handle books, and review what was
// withdrawn. Templates and Books used to be siblings of Bills in the top-level
// tab strip, which left no clue that a template is the thing a bill is made
// from — schools were generating bills before writing a schedule for the term.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi } from '../../lib/format.js';
import BillsTab from './BillsTab.jsx';
import TemplatesTab from './TemplatesTab.jsx';
import SupplementaryTab from './SupplementaryTab.jsx';
import BooksTab from './BooksTab.jsx';
import VoidedBillsTab from './VoidedBillsTab.jsx';

export default function BillsHub() {
  const currentTerm = useStore(s => s.currentTerm);
  const [sub, setSub] = useState('bills');
  const [overview, setOverview] = useState(null);
  const [perms, setPerms] = useState({ can_manage_issued_bills: false });

  async function refreshOverview() {
    if (!currentTerm) return;
    try {
      const [o, p] = await Promise.all([
        window.api.fees.billingOverview(currentTerm.id),
        window.api.fees.billingPermissions(),
      ]);
      setOverview(o && o.ok ? o : null);
      setPerms(p || { can_manage_issued_bills: false });
    } catch (_) { /* the sub-tabs still work without the summary strip */ }
  }
  useEffect(() => { refreshOverview(); }, [currentTerm, sub]);

  const SUBS = [
    { id: 'bills', label: 'Student Bills' },
    { id: 'templates', label: 'Fee Templates' },
    { id: 'extras', label: 'Extra Charges' },
    { id: 'books', label: 'Books' },
    // Withdrawn bills are a Proprietor/Administrator concern. Anyone else does
    // not get a tab that only ever shows them bills they cannot act on.
    ...(perms.can_manage_issued_bills ? [{ id: 'voided', label: 'Voided' }] : []),
  ];

  const counts = overview?.counts || {};
  const projected = overview?.projected || {};

  return (
    <div>
      {/* Where this term stands, so the numbers on the sub-tabs have context */}
      {overview && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row gap-2" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
            <Stat label="Billed this term" value={fmtCedi(projected.billed_total || 0)}
              sub={`${counts.active_bills || 0} bill${counts.active_bills === 1 ? '' : 's'} issued`} />
            <Stat label="Not yet billed" value={fmtCedi(projected.projected_total || 0)}
              sub={`${projected.projected_count || 0} pupil(s) still to bill`}
              tone={(projected.projected_count || 0) > 0 ? 'warn' : undefined} />
            <Stat label="Collected" value={fmtCedi(counts.collected || 0)} tone="good" />
            <Stat label="Outstanding" value={fmtCedi(counts.outstanding || 0)}
              tone={(counts.outstanding || 0) > 0 ? 'bad' : undefined} />
            {(counts.supplementary || 0) > 0 && (
              <Stat label="Extra charges" value={fmtCedi(counts.supplementary)}
                sub="raised during the term" />
            )}
          </div>

          {(overview.warnings || []).length > 0 && (
            <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
              {overview.warnings.map((w, i) => (
                <div key={i} className="text-sm"
                  style={{
                    padding: '6px 10px', borderRadius: 6,
                    background: w.level === 'error' ? 'var(--danger-bg, #fef2f2)' : 'var(--warning-bg, #fffbeb)',
                    color: w.level === 'error' ? 'var(--danger)' : 'var(--warning)',
                  }}>
                  {w.level === 'error' ? '⛔ ' : '⚠ '}{w.message}
                  {w.level === 'error' && (
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}
                      onClick={() => setSub('templates')}>Set up a template →</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="sub-tabs">
        {SUBS.map(s => (
          <button key={s.id} className={'sub-tab' + (sub === s.id ? ' active' : '')}
            onClick={() => setSub(s.id)}>
            {s.label}
            {s.id === 'voided' && (counts.voided_bills || 0) > 0 && (
              <span className="topbar-badge" style={{ marginLeft: 6 }}>{counts.voided_bills}</span>
            )}
          </button>
        ))}
      </div>

      {sub === 'bills' && (
        <BillsTab overview={overview} perms={perms} onChanged={refreshOverview}
          onGoToTemplates={() => setSub('templates')} />
      )}
      {sub === 'templates' && <TemplatesTab onChanged={refreshOverview} />}
      {sub === 'extras' && (
        <SupplementaryTab overview={overview} perms={perms} onChanged={refreshOverview}
          onGoToTemplates={() => setSub('templates')} />
      )}
      {sub === 'books' && <BooksTab />}
      {sub === 'voided' && <VoidedBillsTab perms={perms} onChanged={refreshOverview} />}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  const color = tone === 'good' ? 'var(--success)'
    : tone === 'bad' ? 'var(--danger)'
    : tone === 'warn' ? 'var(--warning)'
    : 'var(--fg)';
  return (
    <div style={{ flex: '1 1 160px', minWidth: 150 }}>
      <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div className="bold" style={{ fontSize: 19, color, lineHeight: 1.3 }}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
