// Class work — the continuous assessment behind a report card.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The app could enter the end-of-term paper and nothing else, which meant a
// teacher could do a third of the marking from their phone and had to find a
// desktop for the rest. Assignments, quizzes and class tests are entered here,
// against the columns the class+subject has for the term, and the weighted
// class score is recomputed by the same function the desktop's Class Scores
// sheet calls.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, RefreshControl } from 'react-native';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api } from '../../src/api';
import {
  Screen, Card, Section, Heading, Muted, Micro, Button, Badge, Sheet, Field,
  ErrorNote, SuccessNote, InfoNote, Skeleton, EmptyState, Grid, StatCard, PendingBadge, Select,
} from '../../src/ui';
import { ClassPicker, SubjectPicker, useClasses, useSubjects } from '../../src/pickers';
import { useLayout, pageWidth } from '../../src/responsive';
import { colors, spacing, radius, type } from '../../src/theme';

const TYPES = ['Assignment', 'Class Test', 'Quiz', 'Project', 'Mid-Term'];

function AssessmentsScreen() {
  const { token, mode, profile } = useAuth();
  const layout = useLayout();
  const { classes, error: classError } = useClasses(token);

  const [classId, setClassId] = useState(null);
  const [subjectId, setSubjectId] = useState(null);
  const subjects = useSubjects(token, classId);

  const [sheet, setSheet] = useState(null);
  const [values, setValues] = useState({});      // { `${studentId}:${columnId}`: '8' }
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [column, setColumn] = useState({ assessmentType: 'Assignment', maxMarks: '10' });

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
      const r = await api.assessments(token, classId, subjectId);
      setSheet(r);
      const v = {};
      for (const s of r.students || []) {
        for (const [colId, mark] of Object.entries(s.marks || {})) v[`${s.id}:${colId}`] = String(mark);
      }
      setValues(v);
    } catch (e) { setError(e.message); setSheet({ columns: [], students: [] }); }
  }, [token, classId, subjectId]);

  useEffect(() => { load(); }, [load]);

  const columns = sheet?.columns || [];
  const rows = sheet?.students || [];
  const totalMax = columns.reduce((n, c) => n + (c.max_marks || 0), 0);

  const invalid = useMemo(() => {
    const bad = [];
    for (const c of columns) {
      for (const s of rows) {
        const raw = values[`${s.id}:${c.id}`];
        if (raw === '' || raw == null) continue;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > c.max_marks) bad.push(`${s.id}:${c.id}`);
      }
    }
    return bad;
  }, [values, columns, rows]);

  async function save() {
    if (invalid.length) { setError('Some marks are above what the assessment is out of.'); return; }
    setSaving(true); setError(null); setSaved(null);
    try {
      const marks = [];
      for (const c of columns) {
        for (const s of rows) {
          const key = `${s.id}:${c.id}`;
          if (!(key in values)) continue;
          marks.push({ student_id: s.id, column_id: c.id, marks: values[key] === '' ? null : Number(values[key]) });
        }
      }
      const r = await api.saveAssessments(token, { classId, subjectId, marks });
      setSaved(mode === 'cloud'
        ? 'Marks saved and queued — they reach the school when its computer next syncs.'
        : `Saved ${r.saved} mark${r.saved === 1 ? '' : 's'}. The class score has been recalculated.`);
      setDirty(false);
      if (mode !== 'cloud') load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function addColumn() {
    setSaving(true); setError(null);
    try {
      await api.addAssessmentColumn(token, {
        classId, subjectId,
        assessmentType: column.assessmentType,
        maxMarks: Number(column.maxMarks),
      });
      setAdding(false);
      setColumn({ assessmentType: 'Assignment', maxMarks: '10' });
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  // A pupil's running total across every column, out of the total available.
  const totalFor = (s) => columns.reduce((n, c) => {
    const raw = values[`${s.id}:${c.id}`];
    const v = raw === '' || raw == null ? 0 : Number(raw);
    return n + (Number.isFinite(v) ? v : 0);
  }, 0);

  const canCreate = profile?.is_admin || profile?.permissions?.academics?.canCreate;

  return (
    <Screen variant="full" padded={false} refreshControl={
      <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />
    }>
      <View style={[{ padding: layout.gutter, gap: spacing.md }, columns.length > 2 ? null : pageWidth(layout)]}>
        <ErrorNote message={classError || error} />

        <Card>
          <ClassPicker classes={classes} value={classId} onChange={setClassId} />
          {classId ? <SubjectPicker subjects={subjects} value={subjectId} onChange={setSubjectId} /> : null}
        </Card>

        {!classId || !subjectId ? (
          <Card>
            <EmptyState
              icon="layers" title="Choose a class and subject"
              message="Class work is marked per subject: each assignment, quiz or test is a column, and the marks are weighted into the class score."
            />
          </Card>
        ) : sheet === null ? (
          <Card><Skeleton rows={7} height={44} /></Card>
        ) : columns.length === 0 ? (
          <Card>
            <EmptyState
              icon="layers" title="No assessments set up yet"
              message={
                sheet.can_add_columns === false
                  ? "Assessment columns are created at the school. Add one on the school Wi-Fi, or on the desktop, and the marks can be entered from anywhere afterwards."
                  : "Add an assignment, quiz or class test to start marking. Each one has its own total."
              }
              action={canCreate && sheet.can_add_columns !== false
                ? <Button title="Add an assessment" icon="plus" onPress={() => setAdding(true)} full={false} />
                : null}
            />
          </Card>
        ) : (
          <>
            <SuccessNote message={saved} />
            <Grid min={150}>
              <StatCard label="Assessments" value={columns.length} icon="layers" />
              <StatCard label="Total marks" value={totalMax} icon="chart" />
              {sheet.weights ? <StatCard label="Class work weight" value={`${sheet.weights.classWeight}%`} tone="data" note={`Exam ${sheet.weights.examWeight}%`} /> : null}
              {sheet.term ? <StatCard label="Term" value={sheet.term.label} icon="calendar" /> : null}
            </Grid>

            <Section
              title="Marks" icon="layers"
              subtitle={`Each column is out of its own total. ${totalMax} marks in all.`}
              action={(
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  {dirty ? <Badge tone="warning" label="Unsaved" /> : null}
                  {canCreate && sheet.can_add_columns !== false
                    ? <Button size="sm" variant="subtle" title="Add" icon="plus" onPress={() => setAdding(true)} full={false} />
                    : null}
                </View>
              )}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
                <View style={{ minWidth: '100%' }}>
                  {/* Column heads: the assessment and what it is out of. */}
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <View style={{ width: layout.isPhone ? 150 : 240 }}><Micro>Pupil</Micro></View>
                    {columns.map(c => (
                      <View key={c.id} style={{ width: 86, alignItems: 'center' }}>
                        <Text numberOfLines={1} style={{ ...type.micro, color: colors.muted, textTransform: 'uppercase' }}>
                          {c.assessment_type}
                        </Text>
                        <Muted>/{c.max_marks}</Muted>
                      </View>
                    ))}
                    <View style={{ width: 78, alignItems: 'center' }}><Micro>Total</Micro></View>
                  </View>

                  {rows.map(s => (
                    <View key={s.id} style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
                    }}>
                      <View style={{ width: layout.isPhone ? 150 : 240, paddingRight: 8 }}>
                        <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>{s.name}</Text>
                        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                          <Muted numberOfLines={1}>{s.index_number}</Muted>
                          {s.pending ? <PendingBadge label="Queued" /> : null}
                        </View>
                      </View>
                      {columns.map(c => {
                        const key = `${s.id}:${c.id}`;
                        const bad = invalid.includes(key);
                        return (
                          <View key={c.id} style={{ width: 86, paddingHorizontal: 5 }}>
                            <TextInput
                              accessibilityLabel={`${c.assessment_type} mark for ${s.name}`}
                              value={values[key] ?? ''}
                              onChangeText={v => { setValues(m => ({ ...m, [key]: v.replace(/[^0-9.]/g, '') })); setDirty(true); }}
                              keyboardType="numeric" placeholder="—" placeholderTextColor={colors.faint} maxLength={6}
                              style={{
                                textAlign: 'center', backgroundColor: colors.surfaceAlt,
                                borderWidth: 1, borderColor: bad ? colors.danger : colors.border,
                                borderRadius: radius.sm, paddingVertical: 9,
                                fontSize: 15, fontWeight: '700', color: bad ? colors.danger : colors.text,
                              }}
                            />
                          </View>
                        );
                      })}
                      <View style={{ width: 78, alignItems: 'center' }}>
                        <Text style={{ ...type.small, fontWeight: '800', color: colors.primary, fontVariant: ['tabular-nums'] }}>
                          {totalFor(s)}/{totalMax}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>

              <Button
                title={saving ? 'Saving…' : 'Save class work marks'} onPress={save}
                busy={saving} disabled={invalid.length > 0} size="lg" style={{ marginTop: spacing.md }}
              />
              {invalid.length > 0 ? (
                <Muted style={{ color: colors.danger, marginTop: 6 }}>
                  {invalid.length} mark{invalid.length === 1 ? ' is' : 's are'} above what its assessment is out of.
                </Muted>
              ) : null}
            </Section>
          </>
        )}
      </View>

      <Sheet
        visible={adding} onClose={() => setAdding(false)} title="Add an assessment"
        footer={<>
          <Button variant="outline" title="Cancel" onPress={() => setAdding(false)} full={false} />
          <Button title="Add" onPress={addColumn} busy={saving} full={false} />
        </>}
      >
        <Muted>
          A column for this class and subject in the current term. Every pupil gets a box for it,
          and the marks are weighted into the class score alongside the exam.
        </Muted>
        <Select
          label="What kind of assessment" value={column.assessmentType}
          onChange={v => setColumn(c => ({ ...c, assessmentType: v }))}
          icon="note" title="Kind of assessment" placeholder="Choose a kind"
          options={TYPES.map(t => ({ value: t, label: t }))}
        />
        <Field
          label="Out of" value={column.maxMarks}
          onChangeText={v => setColumn(c => ({ ...c, maxMarks: v.replace(/[^0-9]/g, '') }))}
          keyboardType="numeric" placeholder="10" hint="The highest mark a pupil can score in it."
        />
      </Sheet>
    </Screen>
  );
}

export default function Assessments() {
  return (
    <RequireModule modules={[['academics', 'view']]}>
      <AssessmentsScreen />
    </RequireModule>
  );
}
