// Set homework — pick a class + subject, add a title, details and due date.
// Also lists the class's current homework.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
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
  const [list, setList] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);

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
      await api.saveHomework(token, { classId, subjectId, title, description: desc, dueDate: due });
      setTitle(''); setDesc(''); setDue(''); setSaved('Homework set.');
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
          </View>
          <Button title={saving ? 'Saving…' : 'Set homework'} onPress={save} disabled={saving} />
        </Card>
      )}

      {classId && (
        <Card>
          <H2>Current homework</H2>
          {list.length === 0 ? <Muted>None set for this class.</Muted> : list.map(h => (
            <Row key={h.id}
              left={<><Text style={{ fontWeight: '600' }}>{h.title}</Text><Muted>{h.subject_name || ''}</Muted></>}
              right={<Muted>{h.due_date ? `Due ${h.due_date}` : ''}</Muted>} />
          ))}
        </Card>
      )}
    </Screen>
  );
}
