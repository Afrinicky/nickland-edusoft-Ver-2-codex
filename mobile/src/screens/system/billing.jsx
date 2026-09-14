// The school's own subscription — what it costs, and how to keep it.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// This is the page every reminder points at. An email, a text message and the
// banner inside the application all end at the same Renew button, because a
// school that has been told three times and cannot find the button has been
// told nothing.
//
// Two things it does differently from the rest of the application:
//
//   * **It is never locked.** A suspended school reaches this screen when it
//     can reach nothing else — the backend serves it from a separate router
//     that the entitlement gate does not cover (app/billing_api.py). A school
//     locked out of the page that explains why it is locked out has no way
//     back, and would be entitled to be angry about it.
//   * **It takes mobile money.** The card-only rule applies to putting an
//     instrument on file for a subscription that renews ITSELF. A bursar
//     renewing by hand needs no such thing, and in Ghana that bursar pays by
//     MoMo. Refusing it here would be a reminder whose button does not work.
import React, { useEffect, useState } from 'react';
import { View, Text, Linking } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { OfficeScreen, useOffice } from '../../office';
import {
  Card, Section, Muted, Micro, Button, ErrorNote, InfoNote, Badge, Divider,
  ChoiceRow, KeyValue,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

const TONE = {
  ACTIVE: 'success', TRIALING: 'primary', PAST_DUE: 'warning',
  GRACE_PERIOD: 'warning', SUSPENDED: 'danger', CANCELLED: 'neutral',
  TERMINATED: 'neutral',
};

function money(amount, currency) {
  const n = Number(amount || 0);
  return `${currency || 'GHS'} ${n.toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(value) {
  const text = String(value || '').slice(0, 10);
  if (!text) return '—';
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? text
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Billing() {
  const { token } = useAuth();
  const state = useOffice((t) => api.billing(t));
  const d = state.data;

  const [view, setView] = useState(null);
  const [plans, setPlans] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [good, setGood] = useState(null);
  const [showPlans, setShowPlans] = useState(false);

  const current = view || d;

  useEffect(() => { if (d) setView(d); }, [d]);

  // Marking the reminders read is what stops the banner shouting on every
  // screen. Done on arrival, because arriving here IS having read them.
  useEffect(() => {
    if (d && (d.reminders || []).some((r) => !r.read_at)) {
      api.billingRemindersRead(token).catch(() => {});
    }
  }, [d, token]);

  async function run(what, fn, message) {
    setBusy(what); setError(null); setGood(null);
    try {
      const result = await fn();
      // A checkout hands back somewhere to send the payer. Opened rather than
      // navigated to: the provider's page is not ours and does not belong
      // inside our shell.
      if (result?.authorization_url) {
        Linking.openURL(result.authorization_url);
        setGood('Opening the payment page. Come back here when you are done — '
                + 'this page updates once the payment lands.');
      } else {
        setGood(result?.detail || message);
      }
      setView(await api.billing(token));
    } catch (e) {
      setError(e.message || 'That did not work.');
    } finally { setBusy(''); }
  }

  async function openPlans() {
    setShowPlans(true);
    if (plans) return;
    try { setPlans((await api.billingPlans(token)).plans || []); }
    catch (e) { setError(e.message); }
  }

  const renew = current?.renew || {};
  const sub = current?.subscription;
  const canManage = current?.can_manage;
  const cards = current?.payment_channels?.card_brands || [];
  const channels = current?.payment_channels?.channels || [];

  return (
    <OfficeScreen state={state} skeleton={3}>
      {current ? (
        <>
          {error ? <ErrorNote message={error} /> : null}
          {good ? <InfoNote message={good} /> : null}

          {/* ── Where this school stands ──────────────────────────── */}
          <Section
            title="Your subscription"
            icon="card"
            subtitle={current.plan?.name ? `${current.plan.name} plan` : ''}
            action={<Badge label={current.status_label || '—'}
                           tone={TONE[current.status] || 'neutral'} />}
          >
            {current.notice ? (
              <Card tone={current.notice_level === 'blocked' ? 'danger'
                        : current.notice_level === 'warn' ? 'warning' : undefined}>
                <Muted>{current.notice}</Muted>
              </Card>
            ) : null}

            <KeyValue items={[
              { label: 'Plan', value: current.plan?.name || '—' },
              { label: 'Pupils billed for',
                value: String(current.usage?.billable_students ?? '—') },
              { label: current.status === 'TRIALING' ? 'Trial ends' : 'Next payment due',
                value: when(current.status === 'TRIALING'
                  ? sub?.trial_ends_at : current.next_billing_date) },
              current.quote
                ? { label: 'Each period',
                    value: money(current.quote.total_amount, current.currency) } : null,
              current.outstanding?.count
                ? { label: 'Outstanding',
                    value: money(current.outstanding.amount, current.currency) } : null,
            ].filter(Boolean)} />
          </Section>

          {/* ── Renewing ──────────────────────────────────────────── */}
          {canManage && renew.available ? (
            <Section
              title={renew.settles_arrears ? 'Settle what is owed' : 'Renew early'}
              icon="wallet"
              subtitle={renew.settles_arrears
                ? 'This clears the outstanding invoice and restores full access.'
                : 'Pay for the next period now. Your renewal date does not move earlier.'}
            >
              <Card>
                <Text style={{ ...type.title, color: colors.text }}>
                  {money(renew.amount, renew.currency || current.currency)}
                </Text>
                <Muted style={{ marginTop: spacing.xs }}>
                  {channels.includes('mobile_money')
                    ? `Pay by mobile money${cards.length ? `, or by ${cards.map(
                        (c) => c === 'visa' ? 'Visa' : c === 'mastercard' ? 'Mastercard'
                             : c.charAt(0).toUpperCase() + c.slice(1)).join(' or ')}` : ''}.`
                    : 'Pay by card.'}
                </Muted>
              </Card>
              {current.payments_available ? (
                <Button
                  label={renew.settles_arrears ? 'Pay now' : 'Renew now'}
                  tone="primary" busy={busy === 'renew'}
                  onPress={() => run('renew', () => api.billingRenew(token, {}),
                                     'Payment started.')}
                />
              ) : (
                <Muted>
                  Online payment is not switched on for this platform yet. Please
                  contact support to settle this.
                </Muted>
              )}
            </Section>
          ) : null}

          {/* ── Changing plan ─────────────────────────────────────── */}
          {canManage ? (
            <Section title="Your plan" icon="layers"
                     subtitle="Move up for more, or down to pay less. Takes effect immediately.">
              {!showPlans ? (
                <Button label="Change plan" tone="ghost" onPress={openPlans} />
              ) : !plans ? (
                <Muted>Loading the plans…</Muted>
              ) : (
                <>
                  {plans.map((p) => (
                    <ChoiceRow
                      key={p.plan_id}
                      selected={p.plan_id === current.plan?.plan_id}
                      disabled={p.plan_id === current.plan?.plan_id}
                      onSelect={() => run('plan',
                        () => api.billingChangePlan(token, p.plan_id),
                        `You are now on ${p.name}.`)}
                      title={p.name}
                      subtitle={p.tagline || p.description || ''}
                      right={
                        <Text style={{ ...type.body, color: colors.text }}>
                          {p.estimate ? money(p.estimate.total_amount, current.currency) : ''}
                        </Text>
                      }
                      badge={p.plan_id === current.plan?.plan_id
                        ? <Badge label="Current" tone="success" /> : null}
                    />
                  ))}
                  <Muted style={{ marginTop: spacing.sm }}>
                    Prices are for your {current.usage?.billable_students ?? 0} pupils.
                  </Muted>
                </>
              )}
            </Section>
          ) : null}

          {/* ── What we have told you ─────────────────────────────── */}
          {(current.reminders || []).length ? (
            <Section title="Reminders we sent" icon="bell"
                     subtitle="The same notices that went to your email and phone.">
              {current.reminders.map((r) => (
                <View key={r.id} style={{ paddingVertical: spacing.sm }}>
                  <Text style={{ ...type.body, color: colors.text }}>
                    {r.detail || r.stage}
                  </Text>
                  <Micro>{when(r.sent_at)}</Micro>
                </View>
              ))}
            </Section>
          ) : null}

          {/* ── Invoices ──────────────────────────────────────────── */}
          <Section title="Invoices" icon="receipt"
                   subtitle="Every bill, with what it was for. These never change.">
            {(current.invoices || []).length ? current.invoices.slice(0, 12).map((i) => (
              <View key={i.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between',
                               alignItems: 'center', paddingVertical: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.body, color: colors.text }}>
                      {i.invoice_number || `#${i.id}`}
                    </Text>
                    <Micro>{when(i.issued_at)}</Micro>
                  </View>
                  <Text style={{ ...type.body, color: colors.text, marginRight: spacing.sm }}>
                    {money(i.total_amount, current.currency)}
                  </Text>
                  <Badge label={i.status} tone={i.status === 'PAID' ? 'success'
                    : i.status === 'EXEMPT' ? 'neutral' : 'warning'} />
                </View>
                <Divider />
              </View>
            )) : <Muted>No invoices yet.</Muted>}
          </Section>

          <Card>
            <Micro>Your data is yours</Micro>
            <Muted style={{ marginTop: spacing.xs }}>
              {'Nothing here is ever deleted for non-payment. If a subscription '
               + 'lapses the system becomes read-only — every pupil, mark, receipt '
               + 'and report stays exactly where it is, and everything comes back '
               + 'the moment the bill is settled.'}
            </Muted>
          </Card>
        </>
      ) : null}
    </OfficeScreen>
  );
}
