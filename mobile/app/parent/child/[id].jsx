// Child detail — fees, canteen, attendance, and academic performance (report).
import React, { useCallback, useState } from 'react';
import { View, Text, Modal, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/auth';
import { api, money } from '../../../src/api';
import { Screen, Card, H2, Muted, Row, Loading, ErrorNote, Button, Field } from '../../../src/ui';
import { colors } from '../../../src/theme';

export default function ChildDetail() {
  const { id } = useLocalSearchParams();
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [intents, setIntents] = useState([]);
  const [error, setError] = useState(null);
  const [payOpen, setPayOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, r, it] = await Promise.all([
        api.child(token, id),
        api.childReport(token, id).catch(() => null),
        api.childIntents(token, id).catch(() => ({ intents: [] })),
      ]);
      setData(d); setReport(r); setIntents(it.intents || []);
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
        <Button title="Make a payment" onPress={() => setPayOpen(true)} />
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

      <PayModal open={payOpen} onClose={() => setPayOpen(false)} token={token} childId={id}
        balance={c.fees.balance} onDone={() => { setPayOpen(false); load(); }} />
    </Screen>
  );
}

function PayModal({ open, onClose, token, childId, balance, onDone }) {
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : '');
  const [channel, setChannel] = useState('mobile');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function submit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.pay(token, childId, { amount: amt, channel, reference });
      setDone(r.message || 'Payment submitted.');
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
              <Muted style={{ marginTop: 4, marginBottom: 8 }}>
                Submit your payment. The school confirms it and you get a receipt by SMS/email.
              </Muted>
              <Field label="Amount (GHS)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
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
              <Button title={busy ? 'Submitting…' : 'Submit payment'} onPress={submit} disabled={busy} />
              <Button title="Cancel" variant="ghost" onPress={onClose} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
