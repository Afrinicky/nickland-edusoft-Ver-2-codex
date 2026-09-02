// Canteen collection — pick a class, choose a student, take a payment. The
// host records it, marks the covered school days paid, posts to Finance, and
// generates + delivers a receipt (POST /canteen/collect → recordCanteenPayment).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api, money } from '../../src/api';
import { Screen, Card, H2, Muted, Row, Field, Button, Loading, ErrorNote } from '../../src/ui';
import { colors } from '../../src/theme';
import { ClassPicker } from './attendance';

const METHODS = ['Cash', 'Momo', 'Bank'];

function CanteenScreen() {
  const { token } = useAuth();
  const [classes, setClasses] = useState(null);
  const [classId, setClassId] = useState(null);
  const [students, setStudents] = useState(null);
  const [selected, setSelected] = useState(null); // canteenStudent payload
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.classes(token).then(r => setClasses(r.classes || [])).catch(e => { setError(e.message); setClasses([]); });
  }, [token]);

  const loadStudents = useCallback(async (cid) => {
    setStudents(null); setSelected(null); setDone(null); setError(null);
    try { const r = await api.students(token, cid); setStudents(r.students || []); }
    catch (e) { setError(e.message); setStudents([]); }
  }, [token]);

  useEffect(() => { if (classId) loadStudents(classId); }, [classId, loadStudents]);

  async function pick(studentId) {
    setSelected(null); setDone(null); setAmount(''); setError(null);
    try { setSelected(await api.canteenStudent(token, studentId)); }
    catch (e) { setError(e.message); }
  }

  async function collect() {
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await api.canteenCollect(token, {
        student_id: selected.student.id, amount: Number(amount), payment_method: method,
      });
      setDone(r);
      // Refresh the balance shown after collecting.
      try { setSelected(await api.canteenStudent(token, selected.student.id)); } catch (_) {}
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (classes === null) return <Loading label="Loading classes…" />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Collect Canteen' }} />
      <Card>
        <H2>Class</H2>
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
      </Card>

      <ErrorNote message={error} />

      {classId && !selected && (
        students === null ? <Loading label="Loading students…" /> : (
          <Card>
            <H2>Choose a student</H2>
            {students.length === 0 && <Muted>No active students in this class.</Muted>}
            {students.map(s => (
              <TouchableOpacity key={s.id} onPress={() => pick(s.id)}>
                <Row
                  left={<><Text style={{ fontWeight: '600' }}>{s.surname} {s.first_name}</Text><Muted>{s.index_number}</Muted></>}
                  right={<Text style={{ color: colors.primary, fontWeight: '700' }}>Collect ›</Text>} />
              </TouchableOpacity>
            ))}
          </Card>
        )
      )}

      {selected && (
        <>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <H2>{selected.student.name}</H2>
              <TouchableOpacity onPress={() => setSelected(null)}><Text style={{ color: colors.primary, fontWeight: '700' }}>‹ Back</Text></TouchableOpacity>
            </View>
            <Muted>{selected.student.class_name || ''}{selected.term ? ` · ${selected.term.label}` : ''}</Muted>
            <Row left={<Muted>Daily rate</Muted>} right={<Text>{money(selected.daily_rate)}</Text>} />
            <Row left={<Muted>Unpaid school days</Muted>} right={<Text style={{ fontWeight: '700' }}>{selected.unpaid_days}</Text>} />
            <Row left={<Text style={{ fontWeight: '700' }}>Amount owed</Text>}
              right={<Text style={{ fontWeight: '800', color: selected.amount_owed > 0 ? colors.danger : colors.success }}>{money(selected.amount_owed)}</Text>} />
          </Card>

          {done ? (
            <Card>
              <Text style={{ color: colors.success, fontWeight: '800', fontSize: 16 }}>✓ Payment collected</Text>
              <Muted style={{ marginTop: 4 }}>Covered {done.days_covered} day(s). A receipt has been generated{done.receipt_id ? ` (#${done.receipt_id})` : ''} and sent if a contact is on file.</Muted>
              <Button title="Collect another" variant="ghost" onPress={() => { setDone(null); setSelected(null); }} />
            </Card>
          ) : (
            <Card>
              <H2>Take payment</H2>
              <View style={{ marginTop: 8 }}>
                <Field label="Amount (GHS)" value={amount} onChangeText={v => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0.00" />
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Method</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {METHODS.map(mth => {
                  const active = method === mth;
                  return (
                    <TouchableOpacity key={mth} onPress={() => setMethod(mth)}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
                        backgroundColor: active ? colors.primary : '#fff', borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
                      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600' }}>{mth}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Button title={busy ? 'Collecting…' : 'Collect payment'} onPress={collect}
                disabled={busy || !(Number(amount) > 0)} />
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

// Reachable by URL in the browser build, so the screen guards itself rather
// than relying on the tab bar having hidden it. The server checks the same
// permissions on every request regardless.
export default function Canteen() {
  return (
    <RequireModule modules={[['canteen', 'view']]}>
      <CanteenScreen />
    </RequireModule>
  );
}
