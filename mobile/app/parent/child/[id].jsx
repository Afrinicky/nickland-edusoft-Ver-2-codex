// Child detail — fees, canteen, attendance, and academic performance (report).
import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/auth';
import { api, money } from '../../../src/api';
import { Screen, Card, H2, Muted, Row, Loading, ErrorNote } from '../../../src/ui';
import { colors } from '../../../src/theme';

export default function ChildDetail() {
  const { id } = useLocalSearchParams();
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, r] = await Promise.all([api.child(token, id), api.childReport(token, id).catch(() => null)]);
      setData(d); setReport(r);
    } catch (e) { setError(e.message); }
  }, [token, id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data && !error) return <Loading />;
  if (error) return <Screen><ErrorNote message={error} /></Screen>;

  const c = data.child;
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
    </Screen>
  );
}
