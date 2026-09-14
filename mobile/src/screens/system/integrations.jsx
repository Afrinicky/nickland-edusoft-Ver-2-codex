// Setting up who takes the school's money, and who sends its messages.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The screen is four steps and it says so, because the school doing this is a
// bursar with a provider's dashboard open in another tab and twenty minutes
// before break:
//
//   1. Choose your provider.      2. Paste what it gave you.
//   3. Press Test.                4. Switch it on.
//
// Step 3 is the one that matters. The switch in step 4 does not work until the
// provider has answered, so a wrong key is found here — by the person who can
// fix it — and never by a parent at ten at night. That rule lives in the
// backend (`app/school/integrations.py`); this screen just refuses to pretend
// otherwise.
//
// No secret is ever displayed. A stored key comes back as ••••1234, and
// leaving that in the box means "keep the one you have", so editing a sender ID
// does not mean retyping a key nobody can see.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { OfficeScreen, useOffice } from '../../office';
import {
  Card, Section, Muted, Micro, Button, Field, Select, ErrorNote, InfoNote,
  Badge, Divider, ChoiceRow, StepNumber,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

const TONE = {
  live: 'success', ready: 'primary', untested: 'warning',
  incomplete: 'warning', off: 'neutral',
};

export default function Integrations() {
  const { token } = useAuth();
  const state = useOffice((t) => api.integrations(t));
  const d = state.data;

  const [gateway, setGateway] = useState('');
  const [creds, setCreds] = useState({});
  const [sms, setSms] = useState({});
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [good, setGood] = useState(null);

  // The server's answer is the source of truth for every screen state, so each
  // action replaces the whole view rather than patching a local copy of it.
  const [view, setView] = useState(null);
  const current = view || d;

  useEffect(() => {
    if (!d) return;
    setView(d);
    setGateway(d.payments.gateway === 'none' ? '' : d.payments.gateway);
    setCreds(d.payments.credentials || {});
    setSms(d.sms.credentials || {});
  }, [d]);

  const spec = (current?.catalogue || []).find((g) => g.id === gateway);
  const smsSpec = (current?.sms_catalogue || [])[0];

  function chooseGateway(id) {
    setGateway(id);
    setError(null); setGood(null);
    // Only carry the typed values across when it is the same provider — one
    // provider's "API key" is not another's.
    setCreds(id === current?.payments?.gateway ? (current.payments.credentials || {}) : {});
  }

  async function run(what, fn, message) {
    setBusy(what); setError(null); setGood(null);
    try {
      const result = await fn();
      if (result?.payments) setView(result);
      else setView(await api.integrations(token));
      setGood(result?.detail || message);
    } catch (e) {
      setError(e.message || 'That did not work.');
    } finally { setBusy(''); }
  }

  const pay = current?.payments;
  const state5 = pay?.state || {};

  return (
    <OfficeScreen state={state} skeleton={3}>
      {current ? (
        <>
          {error ? <ErrorNote message={error} /> : null}
          {good ? <InfoNote message={good} /> : null}

          {/* ── Taking fees over the internet ───────────────────────── */}
          <Section
            title="Taking fees online"
            icon="wallet"
            subtitle="Parents pay from their phones, into your own provider account."
            action={<Badge label={state5.label || '—'} tone={TONE[state5.key] || 'neutral'} />}
          >
            <Card tone={state5.key === 'live' ? 'success' : undefined}>
              <Muted>{state5.detail}</Muted>
              {pay?.verified_detail ? (
                <Muted style={{ marginTop: spacing.xs }}>{pay.verified_detail}</Muted>
              ) : null}
            </Card>

            {/* 1 — choose */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                           marginTop: spacing.md, marginBottom: spacing.xs }}>
              <StepNumber n={1} />
              <Text style={{ ...type.heading, color: colors.text }}>Choose your provider</Text>
            </View>
            {(current.catalogue || []).map((g) => (
              <ChoiceRow
                key={g.id}
                selected={gateway === g.id}
                onSelect={() => chooseGateway(g.id)}
                title={g.name}
                subtitle={g.tagline + (g.verified ? '' : '  ·  test before you rely on it')}
                badge={<Badge label={g.channels.includes('mobile_money') ? 'Mobile money' : 'Cards'}
                       tone={g.verified ? 'success' : 'neutral'} />}
              />
            ))}
            {gateway ? (
              <Button label="Not using any of these" tone="ghost" size="sm" full={false}
                onPress={() => run('clear',
                  () => api.integrationsSavePayments(token, { gateway: 'none' }),
                  'Online payment switched off. Parents pay at the office.')} />
            ) : null}

            {/* 2 — paste */}
            {spec ? (
              <>
                <Divider />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                               marginBottom: spacing.xs }}>
                  <StepNumber n={2} />
                  <Text style={{ ...type.heading, color: colors.text }}>
                    {`What ${spec.name} gave you`}
                  </Text>
                </View>
                {spec.docs_url ? (
                  <Muted style={{ marginBottom: spacing.sm }}>
                    {`Find these in your ${spec.name} dashboard — ${spec.docs_url}`}
                  </Muted>
                ) : null}

                {spec.fields.map((f) => (
                  f.kind === 'select' ? (
                    <Select
                      key={f.key} label={f.label} hint={f.hint}
                      value={creds[f.key] || f.default}
                      options={(f.options || []).map((o) => ({ value: o.value, label: o.label }))}
                      onChange={(v) => setCreds((p) => ({ ...p, [f.key]: v }))}
                    />
                  ) : (
                    <Field
                      key={f.key} label={f.label + (f.required ? '' : '  (optional)')}
                      hint={f.hint} placeholder={f.placeholder || f.default}
                      value={creds[f.key] ?? ''}
                      secureTextEntry={f.kind === 'password' && !String(creds[f.key] || '').startsWith('••')}
                      autoCapitalize="none" autoCorrect={false}
                      onChangeText={(v) => setCreds((p) => ({ ...p, [f.key]: v }))}
                    />
                  )
                ))}

                <Button
                  label="Save" tone="primary" busy={busy === 'save'}
                  onPress={() => run('save',
                    () => api.integrationsSavePayments(token, {
                      gateway, credentials: creds, currency: pay?.currency,
                    }), 'Saved. Now press Test connection.')}
                />

                {/* 3 — test */}
                <Divider />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                               marginBottom: spacing.xs }}>
                  <StepNumber n={3} tone={pay?.verified ? 'success' : 'warning'} />
                  <Text style={{ ...type.heading, color: colors.text }}>Test the connection</Text>
                </View>
                <Muted style={{ marginBottom: spacing.sm }}>
                  {`We ask ${spec.name} whether these details are real. No money moves, `
                   + 'and nothing is charged. Until this passes, the switch below stays off.'}
                </Muted>
                <Button
                  label={pay?.verified ? 'Test again' : 'Test connection'}
                  tone={pay?.verified ? 'ghost' : 'primary'}
                  busy={busy === 'test'}
                  onPress={() => run('test', () => api.integrationsTestPayments(token),
                                     'It works.')}
                />

                {/* 4 — switch on */}
                <Divider />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                               marginBottom: spacing.xs }}>
                  <StepNumber n={4} tone={pay?.enabled ? 'success' : 'primary'} />
                  <Text style={{ ...type.heading, color: colors.text }}>
                    {pay?.enabled ? 'Parents can pay' : 'Let parents pay'}
                  </Text>
                </View>
                {pay?.can_enable ? (
                  <Button
                    label={pay.enabled ? 'Switch off' : 'Switch on'}
                    tone={pay.enabled ? 'danger' : 'primary'}
                    busy={busy === 'enable'}
                    onPress={() => run('enable',
                      () => api.integrationsEnablePayments(token, !pay.enabled),
                      pay.enabled ? 'Switched off.' : 'Parents can now pay from the app.')}
                  />
                ) : (
                  <Muted>
                    {pay?.missing?.length
                      ? `Still needed: ${pay.missing.join(', ')}.`
                      : 'Press Test connection first.'}
                  </Muted>
                )}
              </>
            ) : null}
          </Section>

          {/* ── Text messages ───────────────────────────────────────── */}
          <Section
            title="Text messages to parents"
            icon="chat"
            subtitle={smsSpec ? smsSpec.tagline : ''}
            action={
              <Badge
                label={current.sms.verified ? 'Working'
                       : current.sms.configured ? 'Not tested' : 'Not set up'}
                tone={current.sms.verified ? 'success'
                      : current.sms.configured ? 'warning' : 'neutral'}
              />
            }
          >
            {smsSpec ? (
              <>
                {current.sms.verified_detail ? (
                  <Card><Muted>{current.sms.verified_detail}</Muted></Card>
                ) : null}
                {smsSpec.fields.map((f) => (
                  <Field
                    key={f.key} label={f.label + (f.required ? '' : '  (optional)')}
                    hint={f.hint} placeholder={f.placeholder || f.default}
                    value={sms[f.key] ?? ''}
                    secureTextEntry={f.kind === 'password' && !String(sms[f.key] || '').startsWith('••')}
                    autoCapitalize="none" autoCorrect={false}
                    onChangeText={(v) => setSms((p) => ({ ...p, [f.key]: v }))}
                  />
                ))}
                <Button
                  label="Save" tone="primary" busy={busy === 'sms'}
                  onPress={() => run('sms',
                    () => api.integrationsSaveSms(token, {
                      provider: smsSpec.id, credentials: sms,
                    }), 'Saved. Now test it.')}
                />
                <Divider />
                <Micro>Test it</Micro>
                <Muted style={{ marginBottom: spacing.sm }}>
                  {'Leave the number blank and we only check the key — no credit is '
                   + 'used. Put a number in and we send one real message to it, which '
                   + 'is the only way to prove your sender ID has been approved.'}
                </Muted>
                <Field
                  label="Send a test to  (optional)" placeholder="024 000 0000"
                  value={testTo} onChangeText={setTestTo} keyboardType="phone-pad"
                />
                <Button
                  label={testTo ? 'Send one test message' : 'Check the key'}
                  tone="ghost" busy={busy === 'smstest'}
                  onPress={() => run('smstest', () => api.integrationsTestSms(token, testTo),
                                     'It works.')}
                />
              </>
            ) : null}
          </Section>

          <Card>
            <Micro>Kept private</Micro>
            <Muted style={{ marginTop: spacing.xs }}>
              {'These keys are your school’s, held for your school alone, and never '
               + 'shown back to anyone — not on this screen, not to Nickland support. '
               + 'Money paid by your parents goes to your own provider account, not ours.'}
            </Muted>
          </Card>
        </>
      ) : null}
    </OfficeScreen>
  );
}
