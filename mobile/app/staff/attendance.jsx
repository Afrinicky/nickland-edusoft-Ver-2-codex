// Attendance register — pick a class + date, mark each student, save.
// Writes to the desktop host, which is the source of truth (POST /attendance).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { Screen, Card, H2, Muted, Field, Button, Loading, ErrorNote } from '../../src/ui';
import { colors } from '../../src/theme';

const today = () => new Date().toISOString().slice(0, 10);
const STATUSES = [
  { key: 'present', label: 'Present', color: colors.success },
  { key: 'absent', label: 'Absent', color: colors.danger },
  { key: 'late', label: 'Late', color: colors.accent },
];

export default function Attendance() {
  const { token } = useAuth();
  const [classes, setClasses] = useState(null);
  const [classId, setClassId] = useState(null);
  const [date, setDate] = useState(today());
  const [roster, setRoster] = useState(null);
  const [marks, setMarks] = useState({}); // { studentId: status }
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    api.classes(token).then(r => setClasses(r.classes || [])).catch(e => { setError(e.message); setClasses([]); });
  }, [token]);

  const loadRoster = useCallback(async (cid, d) => {
    if (!cid || !d) return;
    setRoster(null); setError(null); setSaved(null);
    try {
      const r = await api.attendanceRoster(token, cid, d);
      setRoster(r.students || []);
      // Default anyone unmarked to "present" so a teacher only taps exceptions.
      const init = {};
      for (const s of (r.students || [])) init[s.id] = s.status || 'present';
      setMarks(init);
    } catch (e) { setError(e.message); setRoster([]); }
  }, [token]);

  useEffect(() => { if (classId) loadRoster(classId, date); }, [classId, date, loadRoster]);

  async function save() {
    setSaving(true); setError(null); setSaved(null);
    try {
      const payload = Object.entries(marks).map(([student_id, status]) => ({ student_id: Number(student_id), status }));
      const r = await api.markAttendance(token, date, payload);
      setSaved(`Saved ${r.saved} record(s).`);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (classes === null) return <Loading label="Loading classes…" />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Take Attendance' }} />
      <Card>
        <H2>Class</H2>
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
        <View style={{ marginTop: 12 }}>
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-08-13" />
        </View>
      </Card>

      <ErrorNote message={error} />
      {saved && <Card><Text style={{ color: colors.success, fontWeight: '700' }}>✓ {saved}</Text></Card>}

      {classId && roster === null && <Loading label="Loading students…" />}
      {roster && roster.length === 0 && classId && <Card><Muted>No active students in this class.</Muted></Card>}

      {roster && roster.length > 0 && (
        <>
          <Card>
            <H2>Register — {roster.length} student(s)</H2>
            <Muted>Everyone defaults to Present. Tap to change.</Muted>
            {roster.map(s => (
              <View key={s.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ fontWeight: '600', marginBottom: 6 }}>{s.name} <Muted>· {s.index_number}</Muted></Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {STATUSES.map(st => {
                    const active = marks[s.id] === st.key;
                    return (
                      <TouchableOpacity key={st.key} onPress={() => setMarks(m => ({ ...m, [s.id]: st.key }))}
                        style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                          backgroundColor: active ? st.color : '#fff', borderWidth: 1, borderColor: active ? st.color : colors.border }}>
                        <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600', fontSize: 13 }}>{st.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </Card>
          <Button title={saving ? 'Saving…' : 'Save attendance'} onPress={save} disabled={saving} />
        </>
      )}
    </Screen>
  );
}

export function ClassPicker({ classes, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {classes.map(c => {
          const active = value === c.id;
          return (
            <TouchableOpacity key={c.id} onPress={() => onChange(c.id)}
              style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
                backgroundColor: active ? colors.primary : '#fff', borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
              <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600' }}>{c.short_code || c.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}
