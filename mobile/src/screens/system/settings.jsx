// The school's own settings.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A gateway secret is written here and never read back. The screen offers the
// field and is told only whether one is stored — a secret a screen can display
// is a secret a screenshot can carry out of the building, and the audit row
// that records the change does not quote it either.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { OfficeScreen, useOffice } from '../../office';
import {
  Card, Section, Muted, Button, Field, Select, ErrorNote, Badge, InfoNote, Divider, Micro,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

const IDENTITY = [
  ['school_name', 'School name'],
  ['school_abbreviation', 'Short code', 'Used at the front of every admission number.'],
  ['school_motto', 'Motto'],
  ['school_phone_1', 'Telephone'],
  ['school_whatsapp', 'WhatsApp', 'Where "message the school" goes.'],
  ['school_email', 'Email'],
  ['school_address', 'Address'],
];

const MONEY = [
  ['payment_currency', 'Currency'],
  ['canteen_daily_rate', 'Canteen, per day'],
  ['online_payment_min', 'Smallest online payment'],
  ['online_payment_max', 'Largest online payment'],
];

const MARKS = [
  ['class_score_weight_pct', 'Class work counts for (%)'],
  ['exam_weight_pct', 'The exam counts for (%)'],
];

export default function Settings() {
  const { token } = useAuth();
  const state = useOffice((t) => api.systemSettings(t));
  const [draft, setDraft] = useState({});
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const d = state.data;
  useEffect(() => { if (d?.settings) setDraft(d.settings); }, [d]);

  const set = (k) => (v) => { setDraft(prev => ({ ...prev, [k]: v })); setSaved(false); };

  async function save(extra) {
    setError(null);
    setBusy(true);
    try {
      await api.systemSaveSettings(token, { ...draft, ...(extra || {}) });
      setSaved(true);
      setSecret('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const gatewayStored = (d?.secrets || []).some(s => s.key === 'paystack_secret_key' && s.configured);

  return (
    <OfficeScreen state={state} skeleton={6}>
      <ErrorNote message={error} />
      {saved ? <Card tone="success"><Text style={{ ...type.small, fontWeight: '700' }}>Saved.</Text></Card> : null}

      {d ? (
        <>
          <Section title="The school" icon="book" subtitle="What appears on every document it prints.">
            <Card>
              {IDENTITY.map(([key, label, hint]) => (
                <Field key={key} label={label} hint={hint}
                  value={draft[key] ?? ''} onChangeText={set(key)} />
              ))}
            </Card>
          </Section>

          <Section title="Money" icon="wallet">
            <Card>
              {MONEY.map(([key, label, hint]) => (
                <Field key={key} label={label} hint={hint}
                  value={draft[key] ?? ''} onChangeText={set(key)} keyboardType="decimal-pad" />
              ))}
            </Card>
          </Section>

          <Section title="Marks" icon="chart"
            subtitle="How a class score and an exam combine into a subject total.">
            <Card>
              {MARKS.map(([key, label]) => (
                <Field key={key} label={label} value={draft[key] ?? ''}
                  onChangeText={set(key)} keyboardType="number-pad" />
              ))}
              <Muted>
                They should add to 100. A report card is read against these, so changing them
                changes what a mark already entered is worth.
              </Muted>
            </Card>
          </Section>

          <Section title="Taking payment online" icon="lock">
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Micro>Gateway key</Micro>
                <Badge label={gatewayStored ? 'Stored' : 'Not set'}
                  tone={gatewayStored ? 'success' : 'neutral'} />
              </View>
              <Muted>
                Written and never read back. If you have lost it, get a new one from the gateway
                and enter that — there is no way to see the stored one, by design.
              </Muted>
              <Field label="Secret key" value={secret} onChangeText={setSecret} secureTextEntry
                autoCapitalize="none" hint="Leave blank to keep the one already stored." />
              <Field label="Public key" value={draft.paystack_public_key ?? ''}
                onChangeText={set('paystack_public_key')} autoCapitalize="none" />
              <Select label="Gateway" value={draft.payment_gateway ?? 'none'}
                onChange={set('payment_gateway')}
                options={[{ label: 'None', value: 'none' }, { label: 'Paystack', value: 'paystack' }]} />
              <Select label="Take payments in the app" value={draft.online_payments_enabled ?? 'false'}
                onChange={set('online_payments_enabled')}
                options={[{ label: 'No', value: 'false' }, { label: 'Yes', value: 'true' }]} />
              <InfoNote message="Both are needed: a key, and switching it on. A school trying a test key is not live." />
            </Card>
          </Section>

          <Button label={busy ? 'Saving…' : 'Save the settings'} disabled={busy}
            icon="check"
            onPress={() => save(secret ? { paystack_secret_key: secret } : undefined)} />
        </>
      ) : null}
    </OfficeScreen>
  );
}
