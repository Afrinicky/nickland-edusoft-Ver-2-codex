// Child detail — fees, canteen, attendance, and academic performance (report).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/auth';
import { api, money } from '../../../src/api';
import { Screen, Card, H2, Muted, Row, Loading, ErrorNote, Button, Field } from '../../../src/ui';
import { colors } from '../../../src/theme';

export default function ChildDetail() {
  const { id } = useLocalSearchParams();
  const { token, mode } = useAuth();
  const canPay = mode !== 'cloud'; // payments run on the desktop host, not the cloud
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [intents, setIntents] = useState([]);
  const [timetable, setTimetable] = useState(null);
  const [homework, setHomework] = useState([]);
  const [transport, setTransport] = useState(null);
  const [error, setError] = useState(null);
  const [payOpen, setPayOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, r, it, tt, hw, tp] = await Promise.all([
        api.child(token, id),
        api.childReport(token, id).catch(() => null),
        api.childIntents(token, id).catch(() => ({ intents: [] })),
        api.childTimetable(token, id).catch(() => null),
        api.childHomework(token, id).catch(() => ({ homework: [] })),
        api.childTransport(token, id).catch(() => ({ transport: null })),
      ]);
      setData(d); setReport(r); setIntents(it.intents || []); setTimetable(tt); setHomework(hw.homework || []); setTransport(tp.transport);
    } catch (e) { setError(e.message); }
  }, [token, id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data && !error) return <Loading />;
  if (error) return <Screen><ErrorNote message={error} /></Screen>;

  const c = data.child;
  const pendingIntents = intents.filter(i => i.status === 'pending');
  return (
    <Screen>
      <Card>
        <H2>{c.name}</H2>
        <Muted>{c.class_name} · {c.index_number}</Muted>
      </Card>

      <Card>
        <H2>Fees — {c.term?.label || 'This term'}</H2>
        <Row left={<Muted>Billed</Muted>} right={<Text>{money(c.fees.billed)}</Text>} />
        <Row left={<Muted>Paid</Muted>} right={<Text style={{ color: colors.success }}>{money(c.fees.paid)}</Text>} />
        <Row left={<Text style={{ fontWeight: '700' }}>Balance</Text>} right={<Text style={{ fontWeight: '800', color: c.fees.balance > 0 ? colors.danger : colors.success }}>{money(c.fees.balance)}</Text>} />
        {canPay && <Button title="Make a payment" onPress={() => setPayOpen(true)} />}
        {pendingIntents.length > 0 && (
          <View style={{ marginTop: 10, padding: 10, backgroundColor: '#FFFBEB', borderRadius: 8 }}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>⏳ {pendingIntents.length} payment(s) awaiting school confirmation</Text>
            {pendingIntents.map(i => <Muted key={i.id}>{money(i.amount)} · {i.channel} · {i.reference || 'no ref'}</Muted>)}
          </View>
        )}
      </Card>

      <Card>
        <H2>Canteen</H2>
        <Row left={<Muted>Unpaid days</Muted>} right={<Text>{c.canteen.unpaid_days}</Text>} />
        <Row left={<Text style={{ fontWeight: '700' }}>Amount owed</Text>} right={<Text style={{ fontWeight: '800', color: c.canteen.amount_owed > 0 ? colors.danger : colors.success }}>{money(c.canteen.amount_owed)}</Text>} />
      </Card>

      <Card>
        <H2>Attendance</H2>
        <Row left={<Muted>Present</Muted>} right={<Text style={{ color: colors.success }}>{data.attendance?.present || 0}</Text>} />
        <Row left={<Muted>Absent</Muted>} right={<Text style={{ color: colors.danger }}>{data.attendance?.absent || 0}</Text>} />
      </Card>

      <Card>
        <H2>Performance {report?.term ? `— ${report.term.label}` : ''}</H2>
        {(!report || !report.subjects || report.subjects.length === 0)
          ? <Muted>No scores published yet.</Muted>
          : (<>
              {report.subjects.map((s, i) => (
                <Row key={i} left={<Text>{s.subject}</Text>}
                  right={<Text style={{ fontWeight: '700' }}>{Number(s.total_score || 0).toFixed(0)} · {s.grade_remark || ''}</Text>} />
              ))}
              {report.summary && (
                <View style={{ marginTop: 10, padding: 10, backgroundColor: colors.bg, borderRadius: 10 }}>
                  <Text style={{ fontWeight: '700' }}>Average: {Number(report.summary.average_score || 0).toFixed(1)}
                    {report.summary.class_rank ? `   ·   Position: ${report.summary.class_rank}/${report.summary.number_on_roll || '—'}` : ''}</Text>
                  {report.summary.teacher_remarks ? <Muted style={{ marginTop: 4 }}>{report.summary.teacher_remarks}</Muted> : null}
                </View>
              )}
            </>)
        }
      </Card>

      <TransportCard t={transport} />
      <HomeworkCard items={homework} />
      <TimetableCard tt={timetable} />

      <Card>
        <H2>Payments</H2>
        {(!data.payments || data.payments.length === 0)
          ? <Muted>No payments recorded yet.</Muted>
          : data.payments.map((p, i) => (
              <Row key={i}
                left={<><Text>{p.receipt_number || '—'}</Text><Muted>{p.payment_date} · {p.payment_method}</Muted></>}
                right={<Text style={{ fontWeight: '700', color: colors.success }}>{money(p.amount)}</Text>} />
            ))
        }
      </Card>

      {canPay && (
        <PayModal open={payOpen} onClose={() => setPayOpen(false)} token={token} childId={id}
          balance={c.fees.balance} onDone={() => { setPayOpen(false); load(); }} />
      )}
    </Screen>
  );
}

// The child's bus route, stop, pickup time and transport-fee balance.
function TransportCard({ t }) {
  if (!t) return null;
  return (
    <Card>
      <H2>Transport</H2>
      <Row left={<Muted>Route</Muted>} right={<Text style={{ fontWeight: '600' }}>{t.route_name}</Text>} />
      {t.stop_name ? <Row left={<Muted>Stop</Muted>} right={<Text>{t.stop_name}{t.pickup_time ? ` · ${t.pickup_time}` : ''}</Text>} /> : null}
      {t.driver_name ? <Row left={<Muted>Driver</Muted>} right={<Text>{t.driver_name}{t.driver_phone ? ` · ${t.driver_phone}` : ''}</Text>} /> : null}
      <Row left={<Text style={{ fontWeight: '700' }}>Transport fee</Text>}
        right={<Text style={{ fontWeight: '800', color: t.balance > 0 ? colors.danger : colors.success }}>{money(t.balance)} {t.balance > 0 ? 'due' : 'paid'}</Text>} />
    </Card>
  );
}

// Upcoming homework for the child's class.
function HomeworkCard({ items }) {
  if (!items || !items.length) return null;
  return (
    <Card>
      <H2>Homework</H2>
      {items.map(h => (
        <View key={h.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '600', flex: 1 }}>{h.title}</Text>
            {h.due_date ? <Muted>Due {h.due_date}</Muted> : null}
          </View>
          {(h.subject_name || h.description) ? (
            <Muted style={{ marginTop: 2 }}>{[h.subject_name, h.description].filter(Boolean).join(' · ')}</Muted>
          ) : null}
          {/* The child's own submission status and mark, when the school has marked it. */}
          {(h.my_status || h.my_marks != null) && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'center' }}>
              {h.my_status && h.my_status !== 'pending' && (
                <Text style={{ fontSize: 12, fontWeight: '700',
                  color: h.my_status === 'missing' ? colors.danger : colors.success }}>
                  {h.my_status === 'missing' ? 'Not submitted' : h.my_status === 'late' ? 'Submitted late' : 'Submitted'}
                </Text>
              )}
              {h.my_marks != null && h.max_marks != null && (
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>
                  {h.my_marks}/{h.max_marks}
                </Text>
              )}
            </View>
          )}
        </View>
      ))}
    </Card>
  );
}

// Class timetable, shown per weekday. Host mode only — the cloud snapshot
// doesn't carry the timetable yet, so this renders nothing over the internet.
function TimetableCard({ tt }) {
  if (!tt || !tt.periods || !tt.periods.length) return null;
  const days = tt.days || [];
  const byDay = days.map(d => {
    const lessons = tt.periods
      .filter(p => !p.is_break)
      .map(p => ({ p, cell: tt.entries[`${d.value}:${p.id}`] }))
      .filter(x => x.cell && (x.cell.subject_name || x.cell.teacher_name));
    return { ...d, lessons };
  }).filter(d => d.lessons.length > 0);
  if (byDay.length === 0) return null;

  return (
    <Card>
      <H2>Timetable{tt.class?.name ? ` — ${tt.class.name}` : ''}</H2>
      {byDay.map(d => (
        <View key={d.value} style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: '700', color: colors.primary }}>{d.label}</Text>
          {d.lessons.map(({ p, cell }, i) => (
            <Row key={i}
              left={<><Text>{cell.subject_name || 'Lesson'}</Text><Muted>{cell.teacher_name || ''}</Muted></>}
              right={<Muted>{p.start_time}–{p.end_time}</Muted>} />
          ))}
        </View>
      ))}
    </Card>
  );
}

function PayModal({ open, onClose, token, childId, balance, onDone }) {
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : '');
  const [channel, setChannel] = useState('mobile');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [online, setOnline] = useState(false);
  const [currency, setCurrency] = useState('GHS');

  useEffect(() => {
    if (!open) return;
    api.info().then(i => { setOnline(!!i.online_payments); setCurrency(i.payment_currency || 'GHS'); }).catch(() => {});
  }, [open]);

  function validAmount() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount.'); return null; }
    return amt;
  }

  // Manual channel (mobile money / bank / office) — school confirms later.
  async function submitManual() {
    const amt = validAmount(); if (!amt) return;
    setBusy(true); setError(null);
    try {
      const r = await api.pay(token, childId, { amount: amt, channel, reference });
      setDone(r.message || 'Payment submitted for confirmation.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  // Online checkout (Paystack) — pay now, auto-confirmed.
  async function payNow() {
    const amt = validAmount(); if (!amt) return;
    setBusy(true); setError(null);
    try {
      const r = await api.payOnline(token, childId, { amount: amt });
      const result = await WebBrowser.openBrowserAsync(r.authorization_url);
      // After the browser closes, verify (poll a few times for the gateway).
      let settled = null, pending = false;
      for (let i = 0; i < 5; i++) {
        try {
          const v = await api.verifyPayment(token, r.reference);
          if (v.ok) { settled = v; break; }
          pending = !!v.pending;
        } catch (_) { pending = true; }
        await new Promise(res => setTimeout(res, 2000));
      }
      if (settled) setDone(`Payment successful. Receipt ${settled.receipt_number || ''} is on its way.`);
      else if (pending) setDone('Payment is processing. Your receipt will arrive once it clears.');
      else setError('We could not confirm the payment. If you were charged, contact the school.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const CHANNELS = [['mobile', 'Mobile Money'], ['bank', 'Bank'], ['cash', 'At school office']];

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 }}>
          <H2>Make a payment</H2>
          {done ? (
            <>
              <View style={{ padding: 14, backgroundColor: '#ECFDF5', borderRadius: 10, marginTop: 12 }}>
                <Text style={{ color: colors.success, fontWeight: '700' }}>✓ {done}</Text>
              </View>
              <Button title="Done" onPress={onDone} />
            </>
          ) : (
            <>
              <Field label={`Amount (${currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />

              {online && (
                <View style={{ marginBottom: 12 }}>
                  <Button title={busy ? 'Please wait…' : '💳 Pay now (card / mobile money)'} onPress={payNow} disabled={busy} />
                  <Muted style={{ textAlign: 'center', marginTop: 6 }}>Instant — receipt sent automatically.</Muted>
                  <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 14 }} />
                  <Muted style={{ fontWeight: '700' }}>Or tell the school about a payment you already made:</Muted>
                </View>
              )}

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Method</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {CHANNELS.map(([v, label]) => (
                  <TouchableOpacity key={v} onPress={() => setChannel(v)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: channel === v ? colors.primary : '#fff', borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: channel === v ? '#fff' : colors.text, fontWeight: '600', fontSize: 12 }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Field label="Reference (transaction ID / slip no.)" value={reference} onChangeText={setReference} />
              <ErrorNote message={error} />
              <Button title={busy ? 'Submitting…' : 'Submit for confirmation'} onPress={submitManual} disabled={busy} variant="ghost" />
              <Button title="Cancel" variant="ghost" onPress={onClose} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
