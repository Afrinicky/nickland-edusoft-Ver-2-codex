// Score entry — pick a class + subject, enter each student's raw exam mark
// (0–100) for the current term. The host converts + totals it using the same
// WHONET weighting the desktop uses (POST /scores → saveExamMark).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api } from '../../src/api';
import { Screen, Card, H2, Muted, Button, Loading, ErrorNote } from '../../src/ui';
import { colors, radius } from '../../src/theme';
import { ClassPicker } from './attendance';

function ScoresScreen() {
  const { token } = useAuth();
  const [classes, setClasses] = useState(null);
  const [classId, setClassId] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState(null);
  const [term, setTerm] = useState(null);
  const [rows, setRows] = useState(null);
  const [values, setValues] = useState({}); // { studentId: '85' }
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    api.classes(token).then(r => setClasses(r.classes || [])).catch(e => { setError(e.message); setClasses([]); });
  }, [token]);

  const loadSubjects = useCallback(async (cid) => {
    setSubjects([]); setSubjectId(null); setRows(null); setSaved(null);
    try { const r = await api.scoreSubjects(token, cid); setSubjects(r.subjects || []); }
    catch (e) { setError(e.message); }
  }, [token]);

  useEffect(() => { if (classId) loadSubjects(classId); }, [classId, loadSubjects]);

  const loadSheet = useCallback(async (cid, sid) => {
    setRows(null); setError(null); setSaved(null);
    try {
      const r = await api.scoreSheet(token, cid, sid);
      setTerm(r.term);
      setRows(r.students || []);
      const init = {};
      for (const s of (r.students || [])) init[s.id] = s.exam_score == null ? '' : String(s.exam_score);
      setValues(init);
    } catch (e) { setError(e.message); setRows([]); }
  }, [token]);

  useEffect(() => { if (classId && subjectId) loadSheet(classId, subjectId); }, [classId, subjectId, loadSheet]);

  async function save() {
    setSaving(true); setError(null); setSaved(null);
    try {
      const marks = Object.entries(values)
        .filter(([, v]) => v !== '' && v != null)
        .map(([student_id, v]) => ({ student_id: Number(student_id), exam_score: Number(v) }));
      const r = await api.saveScores(token, subjectId, marks);
      setSaved(`Saved ${r.saved} mark(s).`);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (classes === null) return <Loading label="Loading classes…" />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Enter Scores' }} />
      <Card>
        <H2>Class</H2>
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
        {classId && (
          <>
            <H2 style={{ marginTop: 12 }}>Subject</H2>
            {subjects.length === 0 ? <Muted>No subjects mapped.</Muted> : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {subjects.map(s => {
                    const active = subjectId === s.id;
                    return (
                      <TouchableOpacity key={s.id} onPress={() => setSubjectId(s.id)}
                        style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
                          backgroundColor: active ? colors.accent : '#fff', borderWidth: 1, borderColor: active ? colors.accent : colors.border }}>
                        <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600' }}>{s.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </>
        )}
      </Card>

      <ErrorNote message={error} />
      {saved && <Card><Text style={{ color: colors.success, fontWeight: '700' }}>✓ {saved}</Text></Card>}

      {classId && subjectId && rows === null && <Loading label="Loading students…" />}
      {rows && rows.length === 0 && subjectId && <Card><Muted>No active students in this class.</Muted></Card>}

      {rows && rows.length > 0 && (
        <>
          <Card>
            <H2>Exam marks {term ? `— ${term.label}` : ''}</H2>
            <Muted>Enter each student's raw exam score out of 100.</Muted>
            {rows.map(s => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600' }}>{s.name}</Text>
                  <Muted>{s.index_number}{s.total_score != null ? ` · total: ${s.total_score}` : ''}</Muted>
                </View>
                <TextInput
                  value={values[s.id] ?? ''}
                  onChangeText={v => setValues(m => ({ ...m, [s.id]: v.replace(/[^0-9.]/g, '') }))}
                  keyboardType="numeric" placeholder="—" placeholderTextColor={colors.muted}
                  style={{ width: 72, textAlign: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 8, fontSize: 15, color: colors.text }}
                />
              </View>
            ))}
          </Card>
          <Button title={saving ? 'Saving…' : 'Save scores'} onPress={save} disabled={saving} />
        </>
      )}
    </Screen>
  );
}

// Reachable by URL in the browser build, so the screen guards itself rather
// than relying on the tab bar having hidden it. The server checks the same
// permissions on every request regardless.
export default function Scores() {
  return (
    <RequireModule modules={[['academics', 'view']]}>
      <ScoresScreen />
    </RequireModule>
  );
}
