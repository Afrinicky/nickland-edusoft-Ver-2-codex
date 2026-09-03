// Exam marks — the raw paper score, out of 100, for a class and subject.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The school weights this against the class work (see Class work) using the
// same figures the desktop does, so the screen shows what the weighting will
// make of a mark rather than leaving a teacher to wonder why 80 became 48.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, RefreshControl } from 'react-native';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api } from '../../src/api';
import {
  Screen, Card, Section, Heading, Muted, Micro, Button, Badge, Grid, StatCard,
  ErrorNote, Flash, Skeleton, EmptyState, PendingBadge,
} from '../../src/ui';
import { ClassPicker, SubjectPicker, useClasses, useSubjects } from '../../src/pickers';
import { useLayout } from '../../src/responsive';
import { colors, spacing, radius, type } from '../../src/theme';

function ScoresScreen() {
  const { token, mode } = useAuth();
  const layout = useLayout();
  const { classes, error: classError } = useClasses(token);

  const [classId, setClassId] = useState(null);
  const [subjectId, setSubjectId] = useState(null);
  const subjects = useSubjects(token, classId);

  const [sheet, setSheet] = useState(null);
  const [values, setValues] = useState({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (classId == null && classes && classes.length === 1) setClassId(classes[0].id);
  }, [classes, classId]);
  useEffect(() => { setSubjectId(null); setSheet(null); }, [classId]);
  useEffect(() => {
    if (subjectId == null && subjects && subjects.length === 1) setSubjectId(subjects[0].id);
  }, [subjects, subjectId]);

  const load = useCallback(async () => {
    if (!classId || !subjectId) return;
    setSheet(null); setError(null); setSaved(null); setDirty(false);
    try {
      const r = await api.scoreSheet(token, classId, subjectId);
      setSheet(r);
      setValues(Object.fromEntries((r.students || []).map(s => [s.id, s.exam_score == null ? '' : String(s.exam_score)])));
    } catch (e) { setError(e.message); setSheet({ students: [] }); }
  }, [token, classId, subjectId]);

  useEffect(() => { load(); }, [load]);

  const entered = useMemo(() => Object.values(values).filter(v => v !== '' && v != null).length, [values]);
  const numbers = useMemo(() => Object.values(values).map(Number).filter(n => Number.isFinite(n)), [values]);
  const average = numbers.length ? Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 10) / 10 : null;

  // A mark that cannot be saved should say so while the teacher is still
  // looking at it, not after they press Save on thirty of them.
  const invalid = useMemo(() => Object.entries(values)
    .filter(([, v]) => v !== '' && v != null)
    .filter(([, v]) => { const n = Number(v); return !Number.isFinite(n) || n < 0 || n > 100; })
    .map(([id]) => id), [values]);

  async function save() {
    if (invalid.length) { setError('Exam marks must be between 0 and 100.'); return; }
    setSaving(true); setError(null); setSaved(null);
    try {
      const marks = Object.entries(values)
        .filter(([, v]) => v !== '' && v != null)
        .map(([student_id, v]) => ({ student_id: Number(student_id), exam_score: Number(v) }));
      const r = await api.saveScores(token, subjectId, marks);
      setSaved(mode === 'cloud'
        ? `${marks.length} mark${marks.length === 1 ? '' : 's'} saved and queued — they reach the school when its computer next syncs.`
        : `Saved ${r.saved} mark${r.saved === 1 ? '' : 's'}.`);
      setDirty(false);
      if (mode !== 'cloud') load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const rows = sheet?.students || [];

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      {/* Only what is wrong with the whole screen belongs up here. What
          went right or wrong with a save sits against the Save button. */}
      <ErrorNote message={classError} />

      <Card>
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
        {classId ? <SubjectPicker subjects={subjects} value={subjectId} onChange={setSubjectId} /> : null}
      </Card>

      {!classId || !subjectId ? (
        <Card>
          <EmptyState
            icon="chart" title="Choose a class and subject"
            message="Exam marks are entered one subject at a time, for the current term."
          />
        </Card>
      ) : sheet === null ? (
        <Card><Skeleton rows={7} height={44} /></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon="users" title="Nobody on this roll" message="There are no active pupils in this class." /></Card>
      ) : (
        <>
          <Grid min={150}>
            <StatCard label="Entered" value={`${entered}/${rows.length}`} icon="check" />
            <StatCard label="Class average" value={average == null ? '—' : `${average}`} tone="data" icon="chart" />
            {sheet.term ? <StatCard label="Term" value={sheet.term.label} icon="calendar" /> : null}
          </Grid>

          <Section
            title="Exam marks"
            subtitle="Out of 100. Leave a box empty for a pupil who has not sat the paper."
            icon="chart"
            action={dirty ? <Badge tone="warning" label="Unsaved" /> : null}
          >
            {rows.map(s => {
              const bad = invalid.includes(String(s.id));
              return (
                <View key={s.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                  paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
                }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text }}>{s.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Muted>{s.index_number}</Muted>
                      {s.total_score != null ? <Badge tone="neutral" label={`Total ${s.total_score}`} /> : null}
                      {s.pending ? <PendingBadge /> : null}
                    </View>
                  </View>
                  <TextInput
                    accessibilityLabel={`Exam mark for ${s.name}`}
                    value={values[s.id] ?? ''}
                    onChangeText={v => { setValues(m => ({ ...m, [s.id]: v.replace(/[^0-9.]/g, '') })); setDirty(true); }}
                    keyboardType="numeric" placeholder="—" placeholderTextColor={colors.faint}
                    maxLength={5}
                    style={{
                      width: layout.isPhone ? 76 : 92, textAlign: 'center',
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1, borderColor: bad ? colors.danger : colors.border,
                      borderRadius: radius.sm, paddingVertical: 10,
                      fontSize: 16, fontWeight: '700', color: bad ? colors.danger : colors.text,
                    }}
                  />
                </View>
              );
            })}
            <Flash
              error={error} success={saved} onClear={() => setSaved(null)}
              style={{ marginTop: spacing.md, marginBottom: 0 }}
            />
            <Button
              title={saving ? 'Saving…' : 'Save exam marks'} onPress={save}
              busy={saving} disabled={invalid.length > 0} size="lg" style={{ marginTop: spacing.sm }}
            />
            {invalid.length > 0 ? <Muted style={{ color: colors.danger, marginTop: 6 }}>
              {invalid.length} mark{invalid.length === 1 ? ' is' : 's are'} outside 0–100.
            </Muted> : null}
          </Section>
        </>
      )}
    </Screen>
  );
}

// Reachable by URL in the browser build, so the screen guards itself rather
// than relying on the navigation having hidden it.
export default function Scores() {
  return (
    <RequireModule modules={[['academics', 'view']]}>
      <ScoresScreen />
    </RequireModule>
  );
}
