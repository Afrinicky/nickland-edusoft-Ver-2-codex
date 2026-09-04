// Lesson notes — the one teacher duty the app carried nothing of.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop has had a full lesson-note form since the first release; the
// phone had no trace of it, so a teacher who does not get the desktop could
// not write one at all. The whole form is here — objectives, RPK, TLMs, the
// four stages of delivery, evaluation and the assignment — because a partial
// lesson note is not a lesson note, and a head teacher reviewing them needs
// the same fields whichever machine wrote them.
//
// A note stays a draft until it is submitted, and once a head teacher has
// approved it, it stops being the teacher's to rewrite.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import {
  Screen, Card, Section, Heading, Muted, Micro, Button, Badge, Sheet, Field, TextArea,
  Flash, InfoNote, Skeleton, EmptyState, ListRow, Fab, SegmentedControl,
  Grid, StatCard, KeyValue, Divider, PendingBadge, Select,
} from '../../ui';
import { ClassPicker, SubjectPicker, useClasses, useSubjects, todayISO } from '../../pickers';
import { useLayout } from '../../responsive';
import { colors, spacing, type } from '../../theme';

const STATUS_TONE = { draft: 'neutral', submitted: 'info', approved: 'success', returned: 'warning', rejected: 'danger' };

const BLANK = {
  id: null, classId: null, subjectId: null, weekNumber: '', lessonDate: '',
  durationMinutes: '', topic: '', subTopic: '', objectives: '', rpk: '', tlms: '',
  references: '', introduction: '', presentation: '', activity: '', evaluation: '',
  closure: '', assignment: '', remarks: '', status: 'draft',
};

export default function LessonNotes() {
  const { token, mode } = useAuth();
  const layout = useLayout();
  const { classes } = useClasses(token);

  const [notes, setNotes] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [editing, setEditing] = useState(null);   // the form, or null
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);   // a note being read

  const subjects = useSubjects(token, editing?.classId);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.lessonNotes(token); setNotes(r.notes || []); }
    catch (e) { setError(e.message); setNotes([]); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function save(status) {
    if (!editing.topic.trim()) { setError('Give the lesson a topic.'); return; }
    setSaving(true); setError(null); setSaved(null);
    try {
      await api.saveLessonNote(token, { ...editing, status });
      setEditing(null);
      setSaved(mode === 'cloud'
        ? `Lesson note ${status === 'submitted' ? 'submitted' : 'saved'} and queued — it reaches the school when its computer next syncs.`
        : status === 'submitted' ? 'Lesson note submitted for review.' : 'Draft saved.');
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function remove(note) {
    setSaving(true);
    try { await api.deleteLessonNote(token, note.id); setSaved('Lesson note deleted.'); load(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  function open(note) {
    setEditing({
      ...BLANK,
      id: note.id,
      classId: note.class_group_id || null,
      subjectId: note.subject_id || null,
      weekNumber: note.week_number == null ? '' : String(note.week_number),
      lessonDate: note.lesson_date || '',
      durationMinutes: note.duration_minutes == null ? '' : String(note.duration_minutes),
      topic: note.topic || '',
      subTopic: note.sub_topic || '',
      objectives: note.objectives || '',
      rpk: note.rpk || '',
      tlms: note.tlms || '',
      references: note.references_text || '',
      introduction: note.introduction || '',
      presentation: note.presentation || '',
      activity: note.activity || '',
      evaluation: note.evaluation || '',
      closure: note.closure || '',
      assignment: note.assignment || '',
      remarks: note.remarks || '',
      status: note.status || 'draft',
    });
  }

  const rows = (notes || []).filter(n => filter === 'all' || (n.status || 'draft') === filter);
  const drafts = (notes || []).filter(n => (n.status || 'draft') === 'draft').length;
  const submitted = (notes || []).filter(n => n.status === 'submitted').length;
  const approved = (notes || []).filter(n => n.status === 'approved').length;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Flash success={saved} onClear={() => setSaved(null)} />

      {notes === null ? <Card><Skeleton rows={4} height={66} /></Card> : (
        <>
          <Grid min={140}>
            <StatCard label="Drafts" value={drafts} icon="note" />
            <StatCard label="Submitted" value={submitted} tone="data" icon="send" />
            <StatCard label="Approved" value={approved} tone="success" icon="tick" />
          </Grid>

          <Card>
            <SegmentedControl
              value={filter} onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'draft', label: 'Drafts' },
                { value: 'submitted', label: 'Submitted' },
                { value: 'approved', label: 'Approved' },
              ]}
            />
          </Card>

          <Section
            title="My lesson notes" icon="note"
            action={!layout.isPhone
              ? <Button size="sm" title="Write one" icon="plus" onPress={() => setEditing({ ...BLANK, lessonDate: todayISO() })} full={false} />
              : null}
          >
            {rows.length === 0 ? (
              <EmptyState
                icon="note"
                title={filter === 'all' ? 'No lesson notes yet' : `Nothing ${filter}`}
                message="Write a note for a lesson and submit it for review when it is ready."
                action={<Button title="Write one" icon="plus" onPress={() => setEditing({ ...BLANK, lessonDate: todayISO() })} full={false} />}
              />
            ) : rows.map((n, i) => (
              <ListRow
                key={n.id ?? `queued-${i}`}
                icon="note"
                iconTone={n.status === 'approved' ? 'success' : n.status === 'submitted' ? 'info' : 'primary'}
                title={n.topic}
                subtitle={[n.class_name, n.subject_name, n.lesson_date, n.week_number ? `Week ${n.week_number}` : null]
                  .filter(Boolean).join(' · ')}
                badge={n.pending ? <PendingBadge /> : <Badge tone={STATUS_TONE[n.status] || 'neutral'} label={n.status || 'draft'} />}
                onPress={() => setViewing(n)}
              />
            ))}
          </Section>
        </>
      )}

      <Fab label="Write a note" onPress={() => setEditing({ ...BLANK, lessonDate: todayISO() })} />

      {/* Reading one */}
      <Sheet
        visible={!!viewing} onClose={() => setViewing(null)} width={640}
        title={viewing ? viewing.topic : ''}
        footer={viewing && viewing.status !== 'approved' && viewing.id ? (
          <>
            <Button variant="ghost" title="Delete" onPress={() => { const n = viewing; setViewing(null); remove(n); }} full={false} />
            <Button title="Edit" icon="note" onPress={() => { const n = viewing; setViewing(null); open(n); }} full={false} />
          </>
        ) : null}
      >
        {viewing ? (
          <>
            <KeyValue items={[
              { label: 'Class', value: viewing.class_name },
              { label: 'Subject', value: viewing.subject_name },
              { label: 'Date', value: viewing.lesson_date },
              { label: 'Week', value: viewing.week_number },
              { label: 'Duration', value: viewing.duration_minutes ? `${viewing.duration_minutes} min` : null },
              { label: 'Status', value: viewing.status },
            ]} />
            {viewing.review_comments ? (
              <InfoNote message={`Reviewer: ${viewing.review_comments}`} />
            ) : null}
            <Divider />
            {[
              ['Sub-topic', viewing.sub_topic],
              ['Objectives', viewing.objectives],
              ['Relevant previous knowledge', viewing.rpk],
              ['Teaching and learning materials', viewing.tlms],
              ['References', viewing.references_text],
              ['Introduction', viewing.introduction],
              ['Presentation', viewing.presentation],
              ['Learner activity', viewing.activity],
              ['Evaluation', viewing.evaluation],
              ['Closure', viewing.closure],
              ['Assignment', viewing.assignment],
              ['Remarks', viewing.remarks],
            ].filter(([, v]) => v).map(([label, value]) => (
              <View key={label} style={{ marginBottom: spacing.md }}>
                <Micro>{label}</Micro>
                <Text style={{ ...type.body, color: colors.text, marginTop: 2 }}>{value}</Text>
              </View>
            ))}
          </>
        ) : null}
      </Sheet>

      {/* Writing one */}
      <Sheet
        visible={!!editing} onClose={() => setEditing(null)} width={720}
        title={editing?.id ? 'Edit lesson note' : 'New lesson note'}
        footer={<>
          <Button variant="outline" title="Save draft" onPress={() => save('draft')} busy={saving} full={false} />
          <Button title="Submit for review" icon="send" onPress={() => save('submitted')} busy={saving} full={false} />
        </>}
      >
        {editing ? (
          <>
            <ClassPicker classes={classes} value={editing.classId} onChange={v => setEditing(e => ({ ...e, classId: v, subjectId: null }))} />
            {editing.classId ? <SubjectPicker subjects={subjects} value={editing.subjectId} onChange={v => setEditing(e => ({ ...e, subjectId: v }))} /> : null}

            <View style={{ flexDirection: layout.isPhone ? 'column' : 'row', gap: spacing.md }}>
              <Field style={{ flex: 1 }} label="Lesson date" value={editing.lessonDate}
                onChangeText={v => setEditing(e => ({ ...e, lessonDate: v }))} placeholder="YYYY-MM-DD" icon="calendar" maxLength={10} />
              <Field style={{ flex: 1 }} label="Week" value={editing.weekNumber} keyboardType="numeric"
                onChangeText={v => setEditing(e => ({ ...e, weekNumber: v.replace(/[^0-9]/g, '') }))} placeholder="e.g. 4" />
              <Field style={{ flex: 1 }} label="Duration (min)" value={editing.durationMinutes} keyboardType="numeric"
                onChangeText={v => setEditing(e => ({ ...e, durationMinutes: v.replace(/[^0-9]/g, '') }))} placeholder="60" />
            </View>

            <Field label="Topic" value={editing.topic} autoCapitalize="sentences"
              onChangeText={v => setEditing(e => ({ ...e, topic: v }))} placeholder="What the lesson is about" />
            <Field label="Sub-topic" value={editing.subTopic} autoCapitalize="sentences"
              onChangeText={v => setEditing(e => ({ ...e, subTopic: v }))} />

            <TextArea label="Objectives" value={editing.objectives} numberOfLines={3}
              onChangeText={v => setEditing(e => ({ ...e, objectives: v }))}
              placeholder="By the end of the lesson the learner will be able to…" />
            <TextArea label="Relevant previous knowledge (RPK)" value={editing.rpk} numberOfLines={2}
              onChangeText={v => setEditing(e => ({ ...e, rpk: v }))} />
            <TextArea label="Teaching and learning materials" value={editing.tlms} numberOfLines={2}
              onChangeText={v => setEditing(e => ({ ...e, tlms: v }))} />
            <TextArea label="References" value={editing.references} numberOfLines={2}
              onChangeText={v => setEditing(e => ({ ...e, references: v }))} placeholder="Syllabus page, textbook, chapter" />

            <Divider />
            <Micro style={{ marginBottom: 4 }}>Delivery</Micro>
            <TextArea label="Introduction" value={editing.introduction} numberOfLines={3}
              onChangeText={v => setEditing(e => ({ ...e, introduction: v }))} />
            <TextArea label="Presentation" value={editing.presentation} numberOfLines={5}
              onChangeText={v => setEditing(e => ({ ...e, presentation: v }))} />
            <TextArea label="Learner activity" value={editing.activity} numberOfLines={3}
              onChangeText={v => setEditing(e => ({ ...e, activity: v }))} />
            <TextArea label="Evaluation" value={editing.evaluation} numberOfLines={3}
              onChangeText={v => setEditing(e => ({ ...e, evaluation: v }))} />
            <TextArea label="Closure" value={editing.closure} numberOfLines={2}
              onChangeText={v => setEditing(e => ({ ...e, closure: v }))} />
            <TextArea label="Assignment" value={editing.assignment} numberOfLines={2}
              onChangeText={v => setEditing(e => ({ ...e, assignment: v }))} />
            <TextArea label="Remarks" value={editing.remarks} numberOfLines={2}
              onChangeText={v => setEditing(e => ({ ...e, remarks: v }))}
              placeholder="How the lesson actually went" />
          </>
        ) : null}
        <Flash error={error} style={{ marginTop: spacing.sm, marginBottom: 0 }} />
      </Sheet>
    </Screen>
  );
}
