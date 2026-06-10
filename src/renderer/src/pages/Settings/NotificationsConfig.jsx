import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

export default function NotificationsConfig() {
  const settings = useStore(s => s.settings);
  const loadSettings = useStore(s => s.loadSettings);
  const showToast = useStore(s => s.showToast);
  const [data, setData] = useState({});

  useEffect(() => {
    setData(settings.notifications || {});
  }, [settings]);

  function set(k, v) { setData(prev => ({ ...prev, [k]: v })); }

  async function save() {
    for (const [k, v] of Object.entries(data)) {
      await window.api.settings.set(k, v);
    }
    await loadSettings();
    showToast('Notification settings saved');
  }

  return (
    <div>
      <div className="card mb-4">
        <h3 className="card-title">SMS provider</h3>
        <p className="text-muted text-sm mb-3">If left blank, SMS is run in simulation mode (logged, not sent).</p>
        <div className="form-row">
          <Field label="Provider">
            <select className="select" value={data.sms_provider || 'arkesel'}
              onChange={e => set('sms_provider', e.target.value)}>
              <option value="arkesel">Arkesel</option>
              <option value="hubtel">Hubtel</option>
              <option value="mnotify">mNotify</option>
            </select>
          </Field>
          <Field label="Sender ID">
            <input className="input" value={data.sms_sender_id || ''} onChange={e => set('sms_sender_id', e.target.value)} />
          </Field>
        </div>
        <Field label="API key">
          <input className="input" type="password" value={data.sms_api_key || ''} onChange={e => set('sms_api_key', e.target.value)} />
        </Field>
      </div>

      <div className="card mb-4">
        <h3 className="card-title">Email (SMTP)</h3>
        <div className="form-row">
          <Field label="SMTP host">
            <input className="input" value={data.email_smtp_host || ''} onChange={e => set('email_smtp_host', e.target.value)} />
          </Field>
          <Field label="SMTP port">
            <input className="input" value={data.email_smtp_port || '587'} onChange={e => set('email_smtp_port', e.target.value)} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="SMTP user">
            <input className="input" value={data.email_smtp_user || ''} onChange={e => set('email_smtp_user', e.target.value)} />
          </Field>
          <Field label="SMTP password">
            <input className="input" type="password" value={data.email_smtp_pass || ''} onChange={e => set('email_smtp_pass', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="card-title">WhatsApp Business</h3>
        <div className="form-row">
          <Field label="API token">
            <input className="input" type="password" value={data.whatsapp_api_token || ''} onChange={e => set('whatsapp_api_token', e.target.value)} />
          </Field>
          <Field label="Phone ID">
            <input className="input" value={data.whatsapp_phone_id || ''} onChange={e => set('whatsapp_phone_id', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div className="form-group"><label className="label">{label}</label>{children}</div>;
}
