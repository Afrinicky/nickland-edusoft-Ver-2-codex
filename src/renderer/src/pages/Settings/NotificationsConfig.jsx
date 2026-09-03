import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

// Who the school talks to parents through.
//
// SMS is Arkesel. It is the gateway a Ghanaian school can actually buy credit
// for over the counter, and it is the only one `electron/ipc/_transport.js`
// implements — so it is the only one offered here. This list used to also
// carry Hubtel and mNotify; choosing either of them saved happily and then
// every message failed with `unsupported_sms_provider`, which the bursar saw
// as "the SMS just doesn't work".
//
// Email is a choice, because the two deployments have different problems.
// Resend is an HTTPS API: nothing to hand-shake, nothing for a host to block,
// and it is what the cloud copy of the portal should use. SMTP is for a school
// sending from its own mail account.

export default function NotificationsConfig() {
  const settings = useStore(s => s.settings);
  const loadSettings = useStore(s => s.loadSettings);
  const showToast = useStore(s => s.showToast);
  const [data, setData] = useState({});
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState('');
  const [result, setResult] = useState(null);

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

  // Send one real message to whoever is sitting at the desk. A school that has
  // mistyped an API key should find out here, not three weeks later when a
  // parent says they were never told about the PTA meeting.
  async function sendTest(channel) {
    const to = testTo.trim();
    if (!to) { showToast('Enter a number or an email address to test with'); return; }
    setTesting(channel);
    setResult(null);
    try {
      // Save first: the transport reads the settings from the database, not
      // from this form, so an untested edit would test the old key.
      for (const [k, v] of Object.entries(data)) await window.api.settings.set(k, v);
      await loadSettings();
      const res = await window.api.notifications.send({
        channel,
        recipient_type: 'staff',
        recipient_name: 'Test',
        recipient_contact: to,
        subject: 'Nickland Edusoft test message',
        message: 'This is a test message from Nickland Edusoft. If you are reading it, the settings are correct.',
      });
      setResult({ channel, ...res });
    } catch (e) {
      setResult({ channel, ok: false, error: (e && e.message) || String(e) });
    } finally {
      setTesting('');
    }
  }

  const emailProvider = data.email_provider || 'smtp';

  return (
    <div>
      <div className="card mb-4">
        <h3 className="card-title">SMS provider</h3>
        <p className="text-muted text-sm mb-3">
          With no API key, SMS runs in simulation mode — every message is written to the log and nothing leaves the building.
        </p>
        <div className="form-row">
          <Field label="Provider">
            <select className="select" value={data.sms_provider || 'arkesel'}
              onChange={e => set('sms_provider', e.target.value)}>
              <option value="arkesel">Arkesel</option>
            </select>
          </Field>
          <Field label="Sender ID">
            <input className="input" maxLength={11} value={data.sms_sender_id || ''}
              onChange={e => set('sms_sender_id', e.target.value)} placeholder="EduSoft" />
          </Field>
        </div>
        <Field label="API key">
          <input className="input" type="password" value={data.sms_api_key || ''}
            onChange={e => set('sms_api_key', e.target.value)} placeholder="From your Arkesel dashboard" />
        </Field>
        <div className="text-xs text-muted" style={{ marginTop: 4 }}>
          The sender ID is what a parent sees the message as coming from. Arkesel allows at most 11 characters
          and will not deliver a sender ID you have not registered with them.
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="card-title">Email</h3>
        <div className="form-row">
          <Field label="Send through">
            <select className="select" value={emailProvider}
              onChange={e => set('email_provider', e.target.value)}>
              <option value="smtp">The school's own mail account (SMTP)</option>
              <option value="resend">Resend</option>
            </select>
          </Field>
          <Field label="From address">
            <input className="input" type="email" value={data.email_from || ''}
              onChange={e => set('email_from', e.target.value)}
              placeholder={emailProvider === 'resend' ? 'office@yourschool.edu.gh' : 'Defaults to the SMTP user'} />
          </Field>
        </div>

        {emailProvider === 'resend' ? (
          <>
            <Field label="Resend API key">
              <input className="input" type="password" value={data.resend_api_key || ''}
                onChange={e => set('resend_api_key', e.target.value)} placeholder="re_..." />
            </Field>
            <div className="text-xs text-muted" style={{ marginTop: 4 }}>
              The From address has to be at a domain you have verified with Resend, or the message is rejected.
              Resend sends over HTTPS, so it keeps working where a host blocks the SMTP ports.
            </div>
          </>
        ) : (
          <>
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
            <div className="text-xs text-muted" style={{ marginTop: 4 }}>
              Port 465 uses implicit TLS; 587 and 25 use STARTTLS. Receipts and notices are sent from this account.
            </div>
          </>
        )}
      </div>

      <div className="card mb-4">
        <h3 className="card-title">Check it works</h3>
        <p className="text-muted text-sm mb-3">
          Sends one real message, using one real credit, to whoever you put here. Anything above is saved first.
        </p>
        <div className="form-row">
          <Field label="Send a test to">
            <input className="input" value={testTo} onChange={e => setTestTo(e.target.value)}
              placeholder="0244000000 for SMS, or you@yourschool.edu.gh for email" />
          </Field>
          <Field label="&nbsp;">
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-outline" disabled={!!testing} onClick={() => sendTest('sms')}>
                {testing === 'sms' ? 'Sending…' : 'Test SMS'}
              </button>
              <button className="btn btn-outline" disabled={!!testing} onClick={() => sendTest('email')}>
                {testing === 'email' ? 'Sending…' : 'Test email'}
              </button>
            </div>
          </Field>
        </div>
        {result ? <TestResult result={result} /> : null}
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

// What the transport actually reported back, in the words of the person who
// has to fix it. `simulated` means nothing was sent because nothing is
// configured, which is a different problem from a key being wrong.
const REASONS = {
  no_api_key: 'No Arkesel API key is set, so the message was only logged.',
  invalid_recipient: 'That is not a number this gateway can send to.',
  resend_not_configured: 'Resend needs both an API key and a From address.',
  smtp_not_configured: 'SMTP needs a host, a user and a password.',
  no_contact: 'No number or address was given.',
};

function TestResult({ result }) {
  const what = result.channel === 'sms' ? 'SMS' : 'Email';
  if (result.ok) {
    return (
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="badge badge-success">Sent</span>
        <span className="text-sm text-muted">{what} left the building. Check the handset or inbox to be sure it arrived.</span>
      </div>
    );
  }
  const reason = REASONS[result.error] || result.error || 'The gateway refused it.';
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <span className={`badge ${result.simulated ? 'badge-warning' : 'badge-danger'}`}>
        {result.simulated ? 'Not configured' : 'Failed'}
      </span>
      <span className="text-sm text-muted">{what}: {reason}</span>
    </div>
  );
}

function Field({ label, children }) {
  return <div className="form-group"><label className="label">{label}</label>{children}</div>;
}
