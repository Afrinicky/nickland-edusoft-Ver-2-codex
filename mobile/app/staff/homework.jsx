// Homework — set it, see who has done it, and mark it.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Graded homework is backed by an assessment column, so a mark entered here
// feeds the weighted class score and the report card, exactly as one entered on
// the Class work sheet does. Marking needs an assignment the desktop has
// created, so over the internet the marking sheet says so rather than failing
// with a network error.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, RefreshControl } from 'react-native';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api } from '../../src/api';
import {
  Screen, Card, Section, Heading, Muted, Micro, Button, Badge, Sheet, Field, TextArea,
  ErrorNote, Flash, InfoNote, Skeleton, EmptyState, ListRow, Select, Fab,
  Grid, StatCard, SegmentedControl, PendingBadge,
} from '../../src/ui';
import { ClassPicker, SubjectPicker, useClasses, useSubjects, todayISO } from '../../src/pickers';
import { useLayout } from '../../src/responsive';
import { colors, palette, spacing, radius, type } from '../../src/theme';

const SUBMISSION = [
  { key: 'submitted', label: 'Done', tone: 'success' },
  { key: 'late', label: 'Late', tone: 'warning' },
  { key: 'missing', label: 'Not done', tone: 'danger' },
];

function HomeworkScreen() {
  const { token, mode, profile } = useAuth();
  const layout = useLayout();
  const { classes, error: classError } = useClasses(token);

  const [classId, setClassId] = useState(null);
  const subjects = useSubjects(token, classId);
  const [list, setList] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ subjectId: null, title: '', description: '', dueDate: '', maxMarks: '' });
  const [saving, setSaving] = useState(false);

  const [marking, setMarking] = useState(null);   // the assignment being marked
  const [sheet, setSheet] = useState(null);
  const [entries, setEntries] = useState({});

  useEffect(() => {
    if (classId == null && classes && classes.length === 1) setClassId(classes[0].id);
  }, [classes, classId]);

  const load = useCallback(async () => {
    if (!classId) return;
    setList(null); setError(null);
    try { const r = await api.classHomework(token, classId, showAll); setList(r.homework || []); }
    catch (e) { setError(e.message); setList([]); }
  }, [token, classId, showAll]);

  useEffect(() => { load(); }, [load]);

  async function setHomework() {
    if (!form.title.trim()) { setError('Give the assignment a title.'); return; }
    setSaving(true); setError(null); setSaved(null);
    try {
      await api.saveHomework(token, {
        classId, subjectId: form.subjectId,
        title: form.title, description: form.description, dueDate: form.dueDate,
        maxMarks: form.maxMarks === '' ? null : Number(form.maxMarks),
      });
      setForm({ subjectId: null, title: '', description: '', dueDate: '', maxMarks: '' });
      setComposing(false);
      setSaved(mode === 'cloud'
        ? 'Homework saved and queued — it reaches the class when the school next syncs.'
        : 'Homework set. The class can see it now.');
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const openMarking = useCallback(async (hw) => {
    setMarking(hw); setSheet(null);
    try {
      const r = await api.homeworkSheet(token, hw.id);
      setSheet(r);
      setEntries(Object.fromEntries((r.students || []).map(s => [
        s.student_id, { status: s.status || 'pending', marks: s.marks == null ? '' : String(s.marks) },
      ])));
    } catch (e) { setSheet({ error: e.message, students: [] }); }
  }, [token]);

  async function saveMarks() {
    setSaving(true);
    try {
      const payload = Object.entries(entries).map(([student_id, v]) => ({
        student_id: Number(student_id),
        status: v.status,
        marks: v.marks === '' ? null : Number(v.marks),
      }));
      await api.saveHomeworkMarks(token, marking.id, payload);
      setMarking(null);
      setSaved('Marks saved. They count towards the class score.');
      load();
    } catch (e) { setSheet(s => ({ ...s, error: e.message })); }
    finally { setSaving(false); }
  }

  async function withdraw(hw) {
    setSaving(true);
    try { await api.deleteHomework(token, hw.id); setSaved('Assignment withdrawn.'); load(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const canEdit = profile?.is_admin || profile?.permissions?.academics?.canEdit;
  const canDelete = profile?.is_admin || profile?.permissions?.academics?.canDelete;
  const rows = list || [];
  const overdue = rows.filter(h => h.due_date && h.due_date < todayISO()).length;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={classError} />
      <Flash success={saved} onClear={() => setSaved(null)} />

      <Card>
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
        {classId ? (
          <SegmentedControl
            value={showAll ? 'all' : 'current'} onChange={v => setShowAll(v === 'all')}
            options={[{ value: 'current', label: 'Current', icon: 'book' }, { value: 'all', label: 'Everything set', icon: 'layers' }]}
          />
        ) : null}
      </Card>

      {!classId ? (
        <Card><EmptyState icon="book" title="Choose a class" message="Homework is set for a whole class, optionally against one subject." /></Card>
      ) : list === null ? (
        <Card><Skeleton rows={4} height={66} /></Card>
      ) : (
        <>
          {rows.length > 0 && (
            <Grid min={150}>
              <StatCard label="Assignments" value={rows.length} icon="book" />
              <StatCard label="Past the due date" value={overdue} tone={overdue ? 'warning' : undefined} icon="calendar" />
            </Grid>
          )}

          <Section
            title={showAll ? 'Everything set this term' : 'Current homework'}
            icon="book"
            action={canEdit && !layout.isPhone
              ? <Button size="sm" title="Set homework" icon="plus" onPress={() => setComposing(true)} full={false} />
              : null}
          >
            {rows.length === 0 ? (
              <EmptyState
                icon="book" title="Nothing set" message="No homework is outstanding for this class."
                action={canEdit ? <Button title="Set homework" icon="plus" onPress={() => setComposing(true)} full={false} /> : null}
              />
            ) : rows.map((h, i) => (
              <ListRow
                key={h.id ?? `pending-${i}`}
                icon="book" iconTone={h.due_date && h.due_date < todayISO() ? 'warning' : 'primary'}
                title={h.title}
                subtitle={[h.subject_name, h.due_date ? `Due ${h.due_date}` : null, h.max_marks ? `${h.max_marks} marks` : null]
                  .filter(Boolean).join(' · ')}
                badge={h.pending ? <PendingBadge /> : null}
                right={h.id && canEdit ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button size="sm" variant="subtle" title="Mark" onPress={() => openMarking(h)} full={false} />
                    {canDelete ? <Button size="sm" variant="ghost" title="Withdraw" onPress={() => withdraw(h)} full={false} /> : null}
                  </View>
                ) : null}
                meta={(h.submitted_count || h.missing_count || h.marked_count) ? (
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    <Badge tone="success" label={`${h.submitted_count || 0} done`} />
                    <Badge tone="danger" label={`${h.missing_count || 0} not done`} />
                    {h.marked_count ? <Badge tone="info" label={`${h.marked_count} marked`} /> : null}
                    {h.average_mark != null ? <Badge tone="data" label={`avg ${h.average_mark}`} /> : null}
                  </View>
                ) : null}
              />
            ))}
          </Section>
        </>
      )}

      {canEdit && classId ? <Fab label="Set homework" onPress={() => setComposing(true)} /> : null}

      {/* Setting one */}
      <Sheet
        visible={composing} onClose={() => setComposing(false)} title="Set homework"
        footer={<>
          <Button variant="outline" title="Cancel" onPress={() => setComposing(false)} full={false} />
          <Button title={saving ? 'Saving…' : 'Set it'} onPress={setHomework} busy={saving} full={false} />
        </>}
      >
        <SubjectPicker subjects={subjects} value={form.subjectId} onChange={v => setForm(f => ({ ...f, subjectId: v }))} label="Subject (optional)" />
        <Field label="Title" value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))}
          placeholder="e.g. Fractions, exercise 4" autoCapitalize="sentences" />
        <TextArea label="What to do" value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))}
          placeholder="Instructions for the pupils" numberOfLines={4} />
        <Field label="Due date" value={form.dueDate} onChangeText={v => setForm(f => ({ ...f, dueDate: v }))}
          placeholder="YYYY-MM-DD" icon="calendar" maxLength={10} />
        <Field label="Total marks (optional)" value={form.maxMarks}
          onChangeText={v => setForm(f => ({ ...f, maxMarks: v.replace(/[^0-9]/g, '') }))}
          keyboardType="numeric" placeholder="Leave empty for ungraded"
          hint="Give it marks and it counts towards the class score, like any other assessment." />
        <Flash error={error} style={{ marginTop: spacing.sm, marginBottom: 0 }} />
      </Sheet>

      {/* Marking one */}
      <Sheet
        visible={!!marking} onClose={() => setMarking(null)} width={620}
        title={marking ? marking.title : 'Marking'}
        footer={sheet && !sheet.error ? (
          <>
            <Button variant="outline" title="Close" onPress={() => setMarking(null)} full={false} />
            <Button title={saving ? 'Saving…' : 'Save marks'} onPress={saveMarks} busy={saving} full={false} />
          </>
        ) : null}
      >
        {sheet === null ? <Skeleton rows={5} /> : sheet.error ? <ErrorNote message={sheet.error} /> : (
          <>
            <Muted>
              {marking?.max_marks
                ? `Out of ${marking.max_marks}. A pupil marked "not done" scores zero.`
                : 'Ungraded — record who handed it in.'}
            </Muted>
            {(sheet.students || []).map(s => {
              const e = entries[s.student_id] || { status: 'pending', marks: '' };
              return (
                <View key={s.student_id} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
                  <Text numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text }}>{s.name}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, alignItems: 'center' }}>
                    {SUBMISSION.map(st => {
                      const on = e.status === st.key;
                      return (
                        <Button
                          key={st.key} size="sm" full={false}
                          variant={on ? (st.tone === 'success' ? 'success' : st.tone === 'danger' ? 'danger' : 'gold') : 'outline'}
                          title={st.label}
                          onPress={() => setEntries(m => ({ ...m, [s.student_id]: { ...e, status: st.key } }))}
                        />
                      );
                    })}
                    {marking?.max_marks ? (
                      <TextInput
                        accessibilityLabel={`Mark for ${s.name}`}
                        value={e.marks}
                        onChangeText={v => setEntries(m => ({ ...m, [s.student_id]: { ...e, marks: v.replace(/[^0-9.]/g, '') } }))}
                        keyboardType="numeric" placeholder="—" placeholderTextColor={colors.faint} maxLength={6}
                        style={{
                          width: 70, textAlign: 'center', backgroundColor: colors.surfaceAlt,
                          borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
                          paddingVertical: 8, fontSize: 15, fontWeight: '700', color: colors.text,
                        }}
                      />
                    ) : null}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </Sheet>
    </Screen>
  );
}

export default function Homework() {
  return (
    <RequireModule modules={[['academics', 'view']]}>
      <HomeworkScreen />
    </RequireModule>
  );
}
