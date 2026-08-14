// Set homework — pick a class + subject, add a title, details and due date.
// Also lists the class's current homework.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { Screen, Card, H2, Muted, Row, Field, Button, Loading, ErrorNote } from '../../src/ui';
import { colors } from '../../src/theme';
import { ClassPicker } from './attendance';

export default function Homework() {
  const { token } = useAuth();
  const [classes, setClasses] = useState(null);
  const [classId, setClassId] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [due, setDue] = useState('');
  const [maxMarks, setMaxMarks] = useState('');
  const [list, setList] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [marking, setMarking] = useState(null);

  useEffect(() => {
    api.classes(token).then(r => setClasses(r.classes || [])).catch(e => { setError(e.message); setClasses([]); });
  }, [token]);

  const loadClass = useCallback(async (cid) => {
    setSubjects([]); setSubjectId(null); setList([]); setSaved(null);
    try {
      const [subs, hw] = await Promise.all([api.scoreSubjects(token, cid), api.classHomework(token, cid)]);
      setSubjects(subs.subjects || []);
      setList(hw.homework || []);
    } catch (e) { setError(e.message); }
  }, [token]);

  useEffect(() => { if (classId) loadClass(classId); }, [classId, loadClass]);

  async function save() {
    if (!title.trim()) { setError('A title is required.'); return; }
    setSaving(true); setError(null); setSaved(null);
    try {
      await api.saveHomework(token, {
        classId, subjectId, title, description: desc, dueDate: due,
        maxMarks: maxMarks === '' ? null : Number(maxMarks),
      });
      setTitle(''); setDesc(''); setDue(''); setMaxMarks(''); setSaved('Homework set.');
      const hw = await api.classHomework(token, classId); setList(hw.homework || []);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (classes === null) return <Loading label="Loading classes…" />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Set Homework' }} />
      <Card>
        <H2>Class</H2>
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
        {classId && subjects.length > 0 && (
          <>
            <H2 style={{ marginTop: 12 }}>Subject (optional)</H2>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {subjects.map(s => {
                  const active = subjectId === s.id;
                  return (
                    <TouchableOpacity key={s.id} onPress={() => setSubjectId(active ? null : s.id)}
                      style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
                        backgroundColor: active ? colors.accent : '#fff', borderWidth: 1, borderColor: active ? colors.accent : colors.border }}>
                      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600' }}>{s.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </>
        )}
      </Card>

      <ErrorNote message={error} />
      {saved && <Card><Text style={{ color: colors.success, fontWeight: '700' }}>✓ {saved}</Text></Card>}

      {classId && (
        <Card>
          <H2>New homework</H2>
          <View style={{ marginTop: 8 }}>
            <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" placeholder="e.g. Maths exercise 4" />
            <Field label="Details (optional)" value={desc} onChangeText={setDesc} multiline numberOfLines={3} autoCapitalize="sentences" />
            <Field label="Due date (YYYY-MM-DD, optional)" value={due} onChangeText={setDue} placeholder="2026-08-20" />
            <Field label="Total marks (leave blank if not graded)" value={maxMarks}
              onChangeText={v => setMaxMarks(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="e.g. 10" />
            {maxMarks !== '' && !subjectId && (
              <Muted style={{ color: colors.danger }}>Choose a subject — graded homework counts towards its class score.</Muted>
            )}
          </View>
          <Button title={saving ? 'Saving…' : 'Set homework'} onPress={save} disabled={saving} />
        </Card>
      )}

      {classId && (
        <Card>
          <H2>Current homework</H2>
          {list.length === 0 ? <Muted>None set for this class.</Muted> : list.map(h => (
            <TouchableOpacity key={h.id} onPress={() => setMarking(h)}>
              <Row
                left={<>
                  <Text style={{ fontWeight: '600' }}>{h.title}</Text>
                  <Muted>{[h.subject_name, h.is_graded ? `out of ${h.max_marks}` : 'not graded'].filter(Boolean).join(' · ')}</Muted>
                </>}
                right={<>
                  <Muted>{h.due_date ? `Due ${h.due_date}` : ''}</Muted>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>{h.is_graded ? 'Mark ›' : 'Track ›'}</Text>
                </>} />
            </TouchableOpacity>
          ))}
        </Card>
      )}

      {marking && (
        <MarkSheet token={token} homework={marking}
          onClose={async () => { setMarking(null); const hw = await api.classHomework(token, classId); setList(hw.homework || []); }} />
      )}
    </Screen>
  );
}

// Marking sheet — record each pupil's status and mark. Graded marks are pushed
// into the class score on the host, so the report card stays in step.
function MarkSheet({ token, homework, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.homeworkSheet(token, homework.id)
      .then(r => setRows((r.students || []).map(s => ({ ...s }))))
      .catch(e => { setError(e.message); setRows([]); });
  }, [token, homework.id]);

  function setRow(id, patch) {
    setRows(rs => rs.map(r => (r.student_id === id ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true); setError(null); setDone(null);
    try {
      const r = await api.saveHomeworkMarks(token, homework.id, rows.map(r => ({
        student_id: r.student_id, status: r.status, marks: r.marks, remarks: r.remarks,
      })));
      setDone(r.linked_to_assessment ? 'Marks saved and added to the class score.' : 'Submissions saved.');
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (rows === null) return <Card><Muted>Loading marking sheet…</Muted></Card>;

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <H2>{homework.title}</H2>
        <TouchableOpacity onPress={onClose}><Text style={{ color: colors.primary, fontWeight: '700' }}>Close</Text></TouchableOpacity>
      </View>
      <Muted>{homework.is_graded ? `Out of ${homework.max_marks}` : 'Not graded — track submission only'}</Muted>
      <ErrorNote message={error} />
      {done && <Text style={{ color: colors.success, fontWeight: '700', marginTop: 6 }}>✓ {done}</Text>}

      {rows.map(r => (
        <View key={r.student_id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontWeight: '600' }}>{r.name}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' }}>
            {['submitted', 'late', 'missing'].map(st => {
              const active = r.status === st;
              return (
                <TouchableOpacity key={st} onPress={() => setRow(r.student_id, { status: st })}
                  style={{ flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center',
                    backgroundColor: active ? (st === 'missing' ? colors.danger : colors.primary) : '#fff',
                    borderWidth: 1, borderColor: active ? 'transparent' : colors.border }}>
                  <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600', fontSize: 12 }}>
                    {st === 'submitted' ? 'In' : st === 'late' ? 'Late' : 'Not in'}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {homework.is_graded && (
              <TextInput value={r.marks == null ? '' : String(r.marks)}
                onChangeText={v => setRow(r.student_id, { marks: v === '' ? null : v.replace(/[^0-9.]/g, '') })}
                keyboardType="numeric" placeholder="—" placeholderTextColor={colors.muted}
                style={{ width: 64, textAlign: 'center', backgroundColor: '#fff', borderWidth: 1,
                  borderColor: colors.border, borderRadius: 8, paddingVertical: 7, color: colors.text }} />
            )}
          </View>
        </View>
      ))}
      <Button title={saving ? 'Saving…' : 'Save marks'} onPress={save} disabled={saving} />
    </Card>
  );
}
