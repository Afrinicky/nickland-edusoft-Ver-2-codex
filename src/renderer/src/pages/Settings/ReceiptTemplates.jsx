// Nickland Edusoft — Receipt Templates Settings
// User uploads .docx templates with merge tags; the app substitutes them at print time
// Full MS Word formatting preserved (tables, letterheads, fonts, colors, watermarks, pictures)
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtDate } from '../../lib/format.js';

const TEMPLATE_TYPES = [
  { id: 'fees',    label: 'School Fees Receipt' },
  { id: 'books',   label: 'Books Receipt' },
  { id: 'canteen', label: 'Canteen Receipt' },
  { id: 'general', label: 'General Receipt' },
];

export default function ReceiptTemplates() {
  const { currentUser } = useStore();
  const showToast = useStore(s => s.showToast);
  const [templates, setTemplates] = useState([]);
  const [activeType, setActiveType] = useState('fees');
  const [availableTags, setAvailableTags] = useState([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const [list, tags] = await Promise.all([
      window.api.receipts.listTemplates({ templateType: activeType }),
      window.api.receipts.availableTags(activeType),
    ]);
    setTemplates(list);
    setAvailableTags(tags);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [activeType]);

  async function uploadNew() {
    const res = await window.api.app.showOpenDialog({
      title: 'Choose Word Template',
      properties: ['openFile'],
      filters: [{ name: 'Word Documents', extensions: ['docx'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return;

    const name = prompt('Give this template a name (e.g., "Standard Receipt with Letterhead"):');
    if (!name) return;

    const isFirst = templates.length === 0;
    const result = await window.api.receipts.uploadTemplate({
      template_type: activeType,
      name,
      sourcePath: res.filePaths[0],
      is_default: isFirst,
      uploaded_by: currentUser?.id,
    });
    if (result.ok) {
      showToast('Template uploaded' + (isFirst ? ' and set as default' : ''), 'success');
      refresh();
    } else {
      showToast(result.error, 'error');
    }
  }

  async function setDefault(id) {
    await window.api.receipts.setDefault({ id, templateType: activeType });
    showToast('Default template updated', 'success');
    refresh();
  }

  async function deleteTemplate(id) {
    if (!confirm('Delete this template? The file will be removed permanently.')) return;
    await window.api.receipts.deleteTemplate(id);
    showToast('Template deleted', 'success');
    refresh();
  }

  return (
    <div className="receipt-templates-settings">
      <div className="card" style={{ background: 'var(--info-bg)', borderLeft: '3px solid var(--info)' }}>
        <strong>How receipt templates work</strong>
        <div className="text-sm" style={{ marginTop: 8, lineHeight: 1.6 }}>
          <ol style={{ marginLeft: 20 }}>
            <li>Design your receipt in Microsoft Word with whatever formatting you want — letterheads, tables, fonts, colors, watermarks, pictures, page sizes — anything Word supports.</li>
            <li>Wherever you want dynamic data, type a merge tag like <code>{`{{student_name}}`}</code>, <code>{`{{amount}}`}</code>, <code>{`{{date}}`}</code>. The app will fill these in at print time.</li>
            <li>Save as <strong>.docx</strong> and upload it here. The app preserves <em>all</em> your Word formatting.</li>
            <li>Set one template per receipt type as <strong>default</strong> — that's the one used for printing.</li>
          </ol>
        </div>
      </div>

      {/* Type selector */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="sub-tabs">
          {TEMPLATE_TYPES.map(t => (
            <button key={t.id}
              className={'sub-tab' + (activeType === t.id ? ' active' : '')}
              onClick={() => setActiveType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Available merge tags */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Available Merge Tags for {TEMPLATE_TYPES.find(t => t.id === activeType)?.label}</div>
        <p className="text-sm text-muted" style={{ marginTop: 4 }}>
          Copy any of these into your Word template. The app will replace them with real values when printing.
        </p>
        <div className="merge-tags-grid">
          {availableTags.map(tag => (
            <code key={tag} className="merge-tag-chip"
              onClick={() => {
                navigator.clipboard?.writeText(`{{${tag}}}`);
                showToast(`Copied: {{${tag}}}`, 'info');
              }}
              title="Click to copy">
              {`{{${tag}}}`}
            </code>
          ))}
        </div>
      </div>

      {/* Upload + Templates list */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <div className="section-title">Uploaded Templates</div>
          <button className="btn btn-primary" onClick={uploadNew}>+ Upload Word Template</button>
        </div>
        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : templates.length === 0
            ? <div className="empty-state">
                No templates uploaded yet for {TEMPLATE_TYPES.find(t => t.id === activeType)?.label.toLowerCase()}.
                <br />Upload a Word document to start printing receipts.
              </div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Name</th><th>Uploaded By</th><th>Uploaded On</th><th>Status</th><th></th></tr>
                  </thead>
                  <tbody>
                    {templates.map(t => (
                      <tr key={t.id}>
                        <td>
                          <strong>{t.name}</strong>
                          {t.description && <div className="text-xs text-muted">{t.description}</div>}
                        </td>
                        <td className="text-sm">{t.uploaded_by_name || '—'}</td>
                        <td className="text-sm">{fmtDate(t.created_at)}</td>
                        <td>
                          {t.is_default
                            ? <span className="badge badge-success">★ Default</span>
                            : <span className="badge badge-muted">Available</span>}
                        </td>
                        <td>
                          {!t.is_default && (
                            <button className="btn btn-ghost btn-sm" onClick={() => setDefault(t.id)}>Set as Default</button>
                          )}
                          <button className="btn btn-ghost btn-sm" onClick={() => deleteTemplate(t.id)}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
        }
      </div>

      <div className="card" style={{ marginTop: 16, background: 'var(--surface-2)' }}>
        <div style={{ fontSize: 13 }}>
          <strong>Example template content (paste into Word, then format however you like):</strong>
          <pre style={{
            background: 'var(--surface-1)',
            padding: 12, borderRadius: 6, marginTop: 8,
            fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap',
            lineHeight: 1.6,
          }}>{`{{school_name}}
{{school_address}}
{{school_phone}}

OFFICIAL FEE RECEIPT

Receipt No: {{receipt_number}}
Date: {{date_long}}

Received from: {{student_name}}
Index No: {{student_index}}
Class: {{student_class}}
Term: {{term}} · Academic Year: {{academic_year}}

The sum of: {{amount_words}}
                                Amount: GHS {{amount}}

Payment Method: {{payment_method}}
Reference: {{reference}}

Balance Remaining: GHS {{balance}}

_________________________
Received by: {{received_by}}`}
          </pre>
        </div>
      </div>
    </div>
  );
}
