// Money that arrived without anybody at the counter.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Two different things share this screen and the difference is the whole
// point:
//
//   A GATEWAY PAYMENT settled itself. The gateway confirmed it, the school's
//   system recorded it and issued the receipt, and nobody in the office
//   decided anything. It appears here as history. If one is stuck, the office
//   can ask the gateway again — and it settles only if the gateway says the
//   money arrived, never because somebody pressed a button.
//
//   A DECLARATION is a parent saying they paid at the bank. It is a message
//   with a number on it and it has moved nothing. Somebody checks it against
//   the school's statement and either confirms it — which issues the receipt —
//   or rejects it with a reason the parent is told.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { OfficeScreen, cedis, shortDate, useOffice } from '../../office';
import {
  Card, Section, Muted, Badge, Button, Sheet, Field, ErrorNote, InfoNote,
  EmptyState, ListRow, SegmentedControl, Grid, StatCard,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

export default function OnlinePayments() {
  const { token, profile } = useAuth();
  const [status, setStatus] = useState('pending');
  const state = useOffice((t) => api.financeOnline(t, status), [status]);

  const [acting, setActing] = useState(null);   // { intent, kind: 'confirm' | 'reject' }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const mayAct = can(profile, 'fees', 'edit');
  const d = state.data;

  async function act() {
    setError(null);
    setBusy(true);
    try {
      if (acting.kind === 'confirm') {
        const r = await api.financeAcknowledge(token, acting.intent.id);
        setDone(`Confirmed. Receipt ${r.receipt_number}.`);
      } else {
        if (reason.trim().length < 3) { setBusy(false); return setError('Say why — the parent is told.'); }
        await api.financeReject(token, acting.intent.id, reason.trim());
        setDone('Rejected. The parent will see the reason.');
      }
      setActing(null); setReason('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function verify(intent) {
    setError(null);
    try {
      const r = await api.school.verifyIntent(token, intent.id);
      setDone(r.receipt_number ? `The gateway confirmed it. Receipt ${r.receipt_number}.` : 'Settled.');
      state.reload();
    } catch (e) { setError(e.message); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {done ? <Card tone="success"><Text style={{ ...type.body, fontWeight: '700' }}>{done}</Text>
        <Button label="Done" tone="ghost" size="sm" onPress={() => setDone(null)} /></Card> : null}

      {d ? (
        <>
          {d.gateway ? (
            <Card tone={d.gateway.live ? 'success' : 'neutral'}>
              <Muted>{d.gateway.live
                ? `Taking payments online through ${d.gateway.id}.`
                : 'This school is not taking payments online. Parents can still say what they paid at the bank.'}</Muted>
            </Card>
          ) : null}

          {d.counts ? (
            <Grid min={150}>
              <StatCard label="Waiting on you" value={d.counts.pending}
                tone={d.counts.pending ? 'warning' : 'success'} icon="alert" />
              <StatCard label="Confirmed" value={d.counts.acknowledged} tone="success" icon="check" />
              <StatCard label="Rejected" value={d.counts.rejected} tone="neutral" icon="close" />
            </Grid>
          ) : null}

          <Card>
            <SegmentedControl value={status} onChange={setStatus} options={[
              { label: 'Waiting', value: 'pending' },
              { label: 'Confirmed', value: 'acknowledged' },
              { label: 'Rejected', value: 'rejected' },
            ]} />
          </Card>

          {(d.intents || []).length === 0 ? (
            <Card><EmptyState icon="check"
              title={status === 'pending' ? 'Nothing waiting' : 'Nothing here'}
              message={status === 'pending'
                ? 'Every payment parents have declared has been dealt with.'
                : 'No payment is in this state.'} /></Card>
          ) : (
            <Section title={status === 'pending' ? 'To check' : 'History'} icon="wallet">
              {d.intents.map((it) => {
                const gateway = !!it.gateway_reference;
                return (
                  <Card key={it.id}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ ...type.body, fontWeight: '800', color: colors.text }}>
                          {it.student_name}
                        </Text>
                        <Muted numberOfLines={1}>
                          {[it.class_name, it.parent_name, it.parent_phone].filter(Boolean).join(' · ')}
                        </Muted>
                        <Text style={{ ...type.small, marginTop: 6, color: colors.textSoft }}>
                          {gateway
                            ? `Paid through ${it.gateway} · ${it.gateway_reference}`
                            : `Says they paid by ${String(it.channel || 'bank').replace(/_/g, ' ')} · reference ${it.reference || '—'}`}
                        </Text>
                        {it.notes ? <Muted numberOfLines={2}>{it.notes}</Muted> : null}
                        <Muted>{shortDate(it.created_at)}</Muted>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={{ ...type.body, fontWeight: '800', fontVariant: ['tabular-nums'],
                                       color: colors.text }}>{cedis(it.amount)}</Text>
                        <Badge label={gateway ? 'Gateway' : 'Declared'} tone={gateway ? 'success' : 'warning'} />
                        {it.receipt_number ? <Muted>{it.receipt_number}</Muted> : null}
                      </View>
                    </View>

                    {status === 'pending' && mayAct ? (
                      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                        {gateway ? (
                          <Button label="Ask the gateway again" size="sm" tone="ghost"
                            onPress={() => verify(it)} />
                        ) : (
                          <>
                            <Button label="Confirm it" size="sm" icon="check"
                              onPress={() => { setError(null); setActing({ intent: it, kind: 'confirm' }); }} />
                            <Button label="Reject" size="sm" tone="ghost"
                              onPress={() => { setError(null); setActing({ intent: it, kind: 'reject' }); }} />
                          </>
                        )}
                      </View>
                    ) : null}

                    {status === 'pending' && gateway ? (
                      <Muted style={{ marginTop: 6 }}>
                        A gateway payment is never confirmed by hand. It settles when the gateway
                        says the money arrived.
                      </Muted>
                    ) : null}
                  </Card>
                );
              })}
            </Section>
          )}

          {!mayAct ? (
            <InfoNote message="This account can read what parents have declared but not confirm it." />
          ) : null}
        </>
      ) : null}

      <Sheet visible={!!acting} onClose={() => setActing(null)}
        title={acting?.kind === 'confirm' ? 'Confirm the payment' : 'Reject it'}>
        <ErrorNote message={error} />
        {acting ? (
          acting.kind === 'confirm' ? (
            <>
              <Muted>
                {`Check ${cedis(acting.intent.amount)} against the school's statement before you confirm. `}
                Confirming issues a receipt and reduces the bill.
              </Muted>
              <Button label={busy ? 'Confirming…' : 'It is on the statement — confirm'}
                disabled={busy} onPress={act} icon="check" />
            </>
          ) : (
            <>
              <Muted>The parent is told the reason, so write it for them.</Muted>
              <Field label="Why" value={reason} onChangeText={setReason}
                hint="For example: nothing matching that reference has reached the account." />
              <Button label={busy ? 'Rejecting…' : 'Reject it'} tone="danger"
                disabled={busy} onPress={act} />
            </>
          )
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}
