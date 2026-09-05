// Examinations — papers, and the bank they are built from.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Two halves, and the second is the one that matters over years.
//
//   Papers        an end-of-term paper for one class and one subject: a title,
//                 a duration, the instructions on the front, and the questions.
//   Question bank every question the school has ever written, tagged by class,
//                 subject, type and difficulty. Three years of these is an
//                 asset; a paper is a Tuesday.
//
// Putting a bank question onto a paper COPIES it. A question used this term has
// to still be in the bank next term, and a paper that is edited afterwards must
// not silently rewrite the bank's copy of it.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useOfficeClasses, useSubjects } from '../../pickers';
import {
  Select, SearchField, DataTable, Muted, Badge, EmptyState, ErrorNote, SuccessNote,
  Button, Sheet, Field, TextArea, SegmentedControl, CheckRow, Loading,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { colors, spacing, type } from '../../theme';

const TYPES = [
  { label: 'Essay', value: 'essay' },
  { label: 'Multiple choice', value: 'multiple_choice' },
  { label: 'Short answer', value: 'short_answer' },
  { label: 'True or false', value: 'true_false' },
];
const DIFFICULTY = [
  { label: 'Easy', value: 'easy' },
  { label: 'Medium', value: 'medium' },
  { label: 'Hard', value: 'hard' },
];

export default function Examinations() {
  const [half, setHalf] = useState('papers');
  return (
    <View style={{ gap: spacing.md }}>
      <Bar left={<View style={{ minWidth: 280 }}>
        <SegmentedControl value={half} onChange={setHalf}
                          options={[{ label: 'Exam Papers', value: 'papers' },
                                    { label: 'Question Bank', value: 'bank' }]} />
      </View>} />
      {half === 'papers' ? <Papers /> : <Bank />}
    </View>
  );
}

// ── papers ──────────────────────────────────────────────────────────────────

function Papers() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const [classId, setClassId] = useState('');
  const subjects = useSubjects(token, classId || null);
  const [papers, setPapers] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  const mayCreate = can(profile, 'academics', 'create');
  const mayDelete = can(profile, 'academics', 'delete');

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.examPapers(token, { classId: classId || undefined });
      setPapers(r.papers || []);
    } catch (e) { setError(e.message); setPapers([]); }
  }, [token, classId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.saveExamPaper(token, {
        id: editing.id || undefined,
        title: editing.title,
        class_group_id: editing.class_group_id ? Number(editing.class_group_id) : null,
        subject_id: editing.subject_id ? Number(editing.subject_id) : null,
        exam_type: editing.exam_type || 'end_of_term',
        total_marks: editing.total_marks ? Number(editing.total_marks) : null,
        duration_minutes: editing.duration_minutes ? Number(editing.duration_minutes) : null,
        instructions: editing.instructions || null,
        status: editing.status || 'draft',
      });
      setSaved(editing.title);
      setEditing(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function remove(paper) {
    setBusy(true); setError(null);
    try { await api.deleteExamPaper(token, paper.id); setOpen(null); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const published = (papers || []).filter(p => p.status === 'published').length;

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorNote message={error} />
      {saved ? <SuccessNote message={`“${saved}” saved.`} /> : null}

      <StatRow>
        <Stat index={0} label="Exam Papers" icon="note" tone="primary" value={papers ? papers.length : '—'}
              note={papers ? `${published} published, ${papers.length - published} drafts` : ''} />
        <Stat index={1} label="Questions on them" icon="layers" tone="data"
              value={(papers || []).reduce((n, p) => n + (Number(p.question_count) || 0), 0)}
              note="Across every paper" />
      </StatRow>

      <Bar
        left={<View style={{ minWidth: 240 }}>
          <Select label="Class" value={classId} onChange={setClassId} placeholder="Every class"
                  options={[{ label: 'Every class', value: '' },
                            ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
        </View>}
        right={mayCreate ? (
          <Button title="Write a paper" icon="plus" full={false}
                  onPress={() => setEditing({ status: 'draft', exam_type: 'end_of_term',
                                              class_group_id: classId })} />
        ) : null}
      />

      {papers === null ? <Loading label="Reading the papers…" />
        : papers.length === 0 ? (
          <EmptyState icon="note" title="No papers yet"
                      message="A paper is a title, a class, a subject and the questions on it. The question bank fills the last part." />
        ) : (
          <Panel padded={false}>
            <View style={{ padding: spacing.lg }}>
              <DataTable
                keyExtractor={(r) => String(r.id)}
                onRowPress={(r) => setOpen(r)}
                columns={[
                  { key: 'title', label: 'Paper', render: (r) => (
                    <View style={{ minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                        {r.title}
                      </Text>
                      <Muted numberOfLines={1}>{[r.class_name, r.subject_name].filter(Boolean).join(' · ')}</Muted>
                    </View>
                  ) },
                  { key: 'question_count', label: 'Questions', align: 'right', width: 100 },
                  { key: 'total_marks', label: 'Marks', align: 'right', width: 90,
                    render: (r) => (r.total_marks == null ? '—' : String(r.total_marks)) },
                  { key: 'duration_minutes', label: 'Time', align: 'right', width: 90,
                    render: (r) => (r.duration_minutes ? `${r.duration_minutes} min` : '—') },
                  { key: 'status', label: 'Status', align: 'right', width: 120,
                    render: (r) => <Badge tone={r.status === 'published' ? 'success' : 'neutral'}
                                          label={r.status === 'published' ? 'Published' : 'Draft'} /> },
                ]}
                rows={papers} />
            </View>
          </Panel>
        )}

      <Sheet visible={!!editing} onClose={() => setEditing(null)}
             title={editing && editing.id ? 'Change the paper' : 'Write a paper'}>
        {editing ? (
          <>
            <Field label="Title" value={editing.title || ''}
                   onChangeText={(v) => setEditing(e => ({ ...e, title: v }))}
                   hint="What is printed across the top" />
            <Select label="Class" value={String(editing.class_group_id || '')}
                    onChange={(v) => setEditing(e => ({ ...e, class_group_id: v }))}
                    options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
            <Select label="Subject" value={String(editing.subject_id || '')}
                    onChange={(v) => setEditing(e => ({ ...e, subject_id: v }))}
                    options={(subjects || []).map(s => ({ label: s.name, value: String(s.id) }))} />
            <Field label="Total marks" value={String(editing.total_marks || '')}
                   onChangeText={(v) => setEditing(e => ({ ...e, total_marks: v }))} />
            <Field label="Duration in minutes" value={String(editing.duration_minutes || '')}
                   onChangeText={(v) => setEditing(e => ({ ...e, duration_minutes: v }))} />
            <TextArea label="Instructions" value={editing.instructions || ''}
                      onChangeText={(v) => setEditing(e => ({ ...e, instructions: v }))}
                      hint="Answer all questions in Section A…" />
            <Select label="Status" value={editing.status || 'draft'}
                    onChange={(v) => setEditing(e => ({ ...e, status: v }))}
                    options={[{ label: 'Draft — still being written', value: 'draft' },
                              { label: 'Published — ready to sit', value: 'published' }]} />
            <Button title={busy ? 'Saving…' : 'Save the paper'} busy={busy} disabled={busy} onPress={save} />
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open ? open.title : ''}>
        {open ? <PaperDetail paper={open} onEdit={() => { setEditing(open); setOpen(null); }}
                             onDelete={mayDelete ? () => remove(open) : null} busy={busy} /> : null}
      </Sheet>
    </View>
  );
}

function PaperDetail({ paper, onEdit, onDelete, busy }) {
  const { token } = useAuth();
  const [full, setFull] = useState(null);
  useEffect(() => {
    let live = true;
    api.examPaper(token, paper.id)
      .then(r => { if (live) setFull(r.paper || r); })
      .catch(() => { if (live) setFull({ questions: [] }); });
    return () => { live = false; };
  }, [token, paper.id]);

  return (
    <>
      <Muted>{[paper.class_name, paper.subject_name, paper.term_label].filter(Boolean).join(' · ')}</Muted>
      {paper.instructions ? (
        <Text style={{ ...type.body, color: colors.textSoft, marginTop: spacing.sm }}>{paper.instructions}</Text>
      ) : null}

      {!full ? <Loading label="Opening…" /> : (
        (full.questions || []).length === 0 ? (
          <EmptyState icon="note" title="No questions on it yet"
                      message="Take some from the question bank, or write them here." />
        ) : (
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            {full.questions.map((q, i) => (
              <View key={q.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
                <Text style={{ ...type.small, color: colors.text }}>
                  <Text style={{ fontWeight: '800' }}>{i + 1}. </Text>{q.question_text}
                </Text>
                <Muted>{`${q.marks || 1} mark${(q.marks || 1) === 1 ? '' : 's'} · ${q.question_type.replace('_', ' ')}`}</Muted>
              </View>
            ))}
          </View>
        )
      )}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
        <Button title="Change it" variant="outline" full={false} onPress={onEdit} />
        {onDelete ? (
          <Button title="Delete" variant="danger" full={false} disabled={busy} onPress={onDelete} />
        ) : null}
      </View>
    </>
  );
}

// ── the question bank ───────────────────────────────────────────────────────

function Bank() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const [classId, setClassId] = useState('');
  const subjects = useSubjects(token, classId || null);
  const [subjectId, setSubjectId] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [search, setSearch] = useState('');
  const [questions, setQuestions] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState({});
  const [papers, setPapers] = useState([]);
  const [target, setTarget] = useState('');
  const [copied, setCopied] = useState(0);

  const mayCreate = can(profile, 'academics', 'create');
  const mayDelete = can(profile, 'academics', 'delete');

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.examQuestions(token, {
        inBank: 1,
        classId: classId || undefined,
        subjectId: subjectId || undefined,
        difficulty: difficulty || undefined,
        search: search.trim() || undefined,
      });
      setQuestions(r.questions || []);
    } catch (e) { setError(e.message); setQuestions([]); }
  }, [token, classId, subjectId, difficulty, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let live = true;
    api.examPapers(token, {}).then(r => { if (live) setPapers(r.papers || []); }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  const chosen = Object.keys(picked).filter(k => picked[k]);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.saveExamQuestion(token, {
        id: editing.id || undefined,
        question_text: editing.question_text,
        question_type: editing.question_type || 'essay',
        marks: editing.marks ? Number(editing.marks) : 1,
        difficulty: editing.difficulty || 'medium',
        class_group_id: editing.class_group_id ? Number(editing.class_group_id) : null,
        subject_id: editing.subject_id ? Number(editing.subject_id) : null,
        option_a: editing.option_a || null, option_b: editing.option_b || null,
        option_c: editing.option_c || null, option_d: editing.option_d || null,
        correct_option: editing.correct_option || null,
        model_answer: editing.model_answer || null,
        in_question_bank: 1,
      });
      setEditing(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function copyToPaper() {
    setBusy(true); setError(null); setCopied(0);
    try {
      const r = await api.examFromBank(token, Number(target), null, chosen.map(Number));
      setCopied(r.copied || chosen.length);
      setPicked({});
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorNote message={error} />
      {copied ? <SuccessNote message={`${copied} question${copied === 1 ? '' : 's'} copied onto the paper.`} /> : null}

      <Bar
        left={<>
          <View style={{ minWidth: 190 }}>
            <Select label="Class" value={classId} onChange={setClassId} placeholder="Any class"
                    options={[{ label: 'Any class', value: '' },
                              ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
          </View>
          <View style={{ minWidth: 190 }}>
            <Select label="Subject" value={subjectId} onChange={setSubjectId} placeholder="Any subject"
                    options={[{ label: 'Any subject', value: '' },
                              ...(subjects || []).map(s => ({ label: s.name, value: String(s.id) }))]} />
          </View>
          <View style={{ minWidth: 170 }}>
            <Select label="Difficulty" value={difficulty} onChange={setDifficulty} placeholder="Any"
                    options={[{ label: 'Any', value: '' }, ...DIFFICULTY]} />
          </View>
          <View style={{ minWidth: 220, flex: 1 }}>
            <SearchField value={search} onChangeText={setSearch} placeholder="Search the wording" />
          </View>
        </>}
        right={mayCreate ? (
          <Button title="Add a question" icon="plus" full={false}
                  onPress={() => setEditing({ question_type: 'essay', difficulty: 'medium', marks: 1,
                                              class_group_id: classId, subject_id: subjectId })} />
        ) : null}
      />

      {chosen.length ? (
        <Panel title={`${chosen.length} chosen`} subtitle="Copied onto the paper, and left in the bank.">
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <View style={{ minWidth: 260, flex: 1 }}>
              <Select label="Onto which paper?" value={target} onChange={setTarget}
                      placeholder="Choose a paper"
                      options={papers.map(p => ({ label: p.title, value: String(p.id),
                                                  note: [p.class_name, p.subject_name].filter(Boolean).join(' · ') }))} />
            </View>
            <Button title={busy ? 'Copying…' : 'Copy them over'} busy={busy}
                    disabled={busy || !target} full={false} onPress={copyToPaper} />
            <Button title="Clear" variant="ghost" full={false} onPress={() => setPicked({})} />
          </View>
        </Panel>
      ) : null}

      {questions === null ? <Loading label="Reading the bank…" />
        : questions.length === 0 ? (
          <EmptyState icon="layers" title="The bank is empty"
                      message="Every question added here stays for next term and the term after. It is the part of an exam that is worth writing down." />
        ) : (
          <Panel padded={false} title={`${questions.length} questions`}>
            <View style={{ padding: spacing.lg, gap: 4 }}>
              {questions.map((q) => (
                <CheckRow
                  key={q.id}
                  checked={!!picked[q.id]}
                  onToggle={() => setPicked(p => ({ ...p, [q.id]: !p[q.id] }))}
                  title={q.question_text}
                  subtitle={[q.class_name, q.subject_name,
                             `${q.marks || 1} mark${(q.marks || 1) === 1 ? '' : 's'}`,
                             q.difficulty].filter(Boolean).join(' · ')}
                  right={mayCreate ? (
                    <Button title="Edit" size="sm" variant="ghost" full={false}
                            onPress={() => setEditing({ ...q })} />
                  ) : null} />
              ))}
            </View>
          </Panel>
        )}

      <Sheet visible={!!editing} onClose={() => setEditing(null)}
             title={editing && editing.id ? 'Change the question' : 'Add a question'}>
        {editing ? (
          <>
            <TextArea label="The question" value={editing.question_text || ''}
                      onChangeText={(v) => setEditing(e => ({ ...e, question_text: v }))} />
            <Select label="Type" value={editing.question_type || 'essay'}
                    onChange={(v) => setEditing(e => ({ ...e, question_type: v }))} options={TYPES} />
            {editing.question_type === 'multiple_choice' ? (
              <>
                {['a', 'b', 'c', 'd'].map(letter => (
                  <Field key={letter} label={`Option ${letter.toUpperCase()}`}
                         value={editing[`option_${letter}`] || ''}
                         onChangeText={(v) => setEditing(e => ({ ...e, [`option_${letter}`]: v }))} />
                ))}
                <Select label="The right answer" value={editing.correct_option || ''}
                        onChange={(v) => setEditing(e => ({ ...e, correct_option: v }))}
                        options={['A', 'B', 'C', 'D'].map(l => ({ label: l, value: l }))} />
              </>
            ) : (
              <TextArea label="Model answer" value={editing.model_answer || ''}
                        onChangeText={(v) => setEditing(e => ({ ...e, model_answer: v }))}
                        hint="What a full-mark answer contains. Not shown to pupils." />
            )}
            <Field label="Marks" value={String(editing.marks || '')}
                   onChangeText={(v) => setEditing(e => ({ ...e, marks: v }))} />
            <Select label="Difficulty" value={editing.difficulty || 'medium'}
                    onChange={(v) => setEditing(e => ({ ...e, difficulty: v }))} options={DIFFICULTY} />
            <Select label="Class" value={String(editing.class_group_id || '')}
                    onChange={(v) => setEditing(e => ({ ...e, class_group_id: v }))}
                    options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
            <Select label="Subject" value={String(editing.subject_id || '')}
                    onChange={(v) => setEditing(e => ({ ...e, subject_id: v }))}
                    options={(subjects || []).map(s => ({ label: s.name, value: String(s.id) }))} />
            <Button title={busy ? 'Saving…' : 'Save it to the bank'} busy={busy} disabled={busy} onPress={save} />
            {editing.id && mayDelete ? (
              <Button title="Delete this question" variant="danger" disabled={busy}
                      onPress={async () => {
                        setBusy(true);
                        try { await api.deleteExamQuestion(token, editing.id); setEditing(null); await load(); }
                        catch (e) { setError(e.message); }
                        finally { setBusy(false); }
                      }} />
            ) : null}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
