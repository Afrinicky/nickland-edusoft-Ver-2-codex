// Academics — the parts the web app was missing.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One pupil's academic record, the compilation of a whole class, and the
// end-of-term report. The register, the marks and the homework already existed
// as teaching screens and are reused as tabs rather than rewritten.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useOfficeClasses } from '../../pickers';
import { OfficeScreen, useOffice } from '../../office';
import {
  Select, SearchField, DataTable, Muted, Badge, EmptyState, ErrorNote, Button,
  Loading, ProgressBar, Divider, SuccessNote,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { printHtml } from '../../print';
import { useLayout } from '../../responsive';
import { colors, spacing, type } from '../../theme';

// ── One pupil's academic profile ────────────────────────────────────────────
//
// The desktop's "Student Academic Profile": pick a pupil, see every subject
// they sit, the class score and the exam score behind each total, the grade,
// and the position. It is the screen a head teacher opens when a parent is
// standing in the doorway asking why.

export function AcademicProfile() {
  const { token } = useAuth();
  const { classes } = useOfficeClasses(token);
  const [classId, setClassId] = useState('');
  const [q, setQ] = useState('');
  const [studentId, setStudentId] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const roll = useOffice(
    (t) => (classId ? api.adminStudents(t, { status: 'Active', classId }) : Promise.resolve({ ok: true, students: [] })),
    [classId]);

  const pupils = useMemo(() => {
    const list = roll.data?.students || [];
    const needle = q.trim().toLowerCase();
    return needle
      ? list.filter(r => `${r.name} ${r.index_number}`.toLowerCase().includes(needle))
      : list;
  }, [roll.data, q]);

  const open = useCallback(async (id) => {
    setStudentId(id); setReport(null); setError(null); setLoading(true);
    try { setReport(await api.studentReport(token, id)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [token]);

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorNote message={error} />
      <Bar left={<>
        <View style={{ minWidth: 220 }}>
          <Select label="Class" value={classId} onChange={(v) => { setClassId(v); setStudentId(null); setReport(null); }}
                  placeholder="Which class?"
                  options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
        </View>
        {classId ? (
          <View style={{ minWidth: 240, flex: 1 }}>
            <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" />
          </View>
        ) : null}
      </>} />

      {!classId ? (
        <EmptyState icon="award" title="Pick a class, then a pupil"
                    message="An academic profile is one pupil's whole term: every subject, both scores behind each total, the grade and the position." />
      ) : (
        <View style={{ flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' }}>
          <View style={{ minWidth: 280, flexGrow: 1, flexBasis: 300 }}>
            <Panel padded={false} title={`${pupils.length} pupils`}>
              <View style={{ padding: spacing.md }}>
                <DataTable
                  keyExtractor={(r) => String(r.id)}
                  empty="Nobody matches that."
                  onRowPress={(r) => open(r.id)}
                  columns={[
                    { key: 'name', label: 'Pupil' },
                    { key: 'go', label: '', width: 60, align: 'right',
                      render: (r) => (String(r.id) === String(studentId)
                        ? <Badge tone="primary" label="Open" /> : <Muted>→</Muted>) },
                  ]}
                  rows={pupils} />
              </View>
            </Panel>
          </View>

          <View style={{ minWidth: 320, flexGrow: 2, flexBasis: 460 }}>
            {loading ? <Loading label="Reading the record…" />
              : !report ? (
                <EmptyState icon="note" title="No pupil chosen"
                            message="Choose somebody on the left." />
              ) : <ProfileReport report={report} />}
          </View>
        </View>
      )}
    </View>
  );
}

function ProfileReport({ report }) {
  const r = report.report || report;
  const subjects = r.subjects || [];
  const name = r.student?.name || [r.student?.surname, r.student?.first_name].filter(Boolean).join(' ');

  return (
    <View style={{ gap: spacing.md }}>
      <StatRow>
        <Stat index={0} label="Pupil" value={name || '—'} icon="user" tone="primary"
              note={r.student?.class_name || ''} />
        <Stat index={1} label="Average" icon="chart" tone="data"
              value={r.average != null ? `${Math.round(r.average)}%` : '—'}
              note={r.position ? `Position ${r.position}${r.of ? ` of ${r.of}` : ''}` : 'Not ranked'} />
        <Stat index={2} label="Subjects" icon="book" tone="warning" value={subjects.length}
              note={r.term?.label || 'This term'} />
      </StatRow>

      <Panel title="Subject by subject"
             subtitle="The class score and the exam score behind each total.">
        <DataTable
          keyExtractor={(s, i) => String(s.subject_id ?? i)}
          empty="No marks have been entered for this pupil yet."
          columns={[
            { key: 'subject', label: 'Subject',
              render: (s) => s.subject || s.subject_name || '—' },
            { key: 'class_score', label: 'Class', align: 'right', width: 90,
              render: (s) => fmt(s.class_score) },
            { key: 'exam_score', label: 'Exam', align: 'right', width: 90,
              render: (s) => fmt(s.exam_score) },
            { key: 'total', label: 'Total', align: 'right', width: 90,
              render: (s) => fmt(s.total_score ?? s.total) },
            { key: 'grade', label: 'Grade', align: 'right', width: 90,
              render: (s) => s.grade || s.grade_remark || '—' },
          ]}
          rows={subjects} />
      </Panel>
    </View>
  );
}

const fmt = (v) => (v == null || v === '' ? '—' : String(Math.round(Number(v) * 10) / 10));

// ── Assessment compilation ──────────────────────────────────────────────────
//
// The whole class against every subject, on one sheet: what the desktop calls
// the compilation and what a class teacher fills in before a report card can
// be printed. Read-only here — marks are entered subject by subject under Class
// Scores and Exam Scores, where the sheet fits — but this is the view that
// shows what is still MISSING, which is the thing that holds a term up.

export function AssessmentCompilation() {
  const { token } = useAuth();
  const { classes } = useOfficeClasses(token);
  const [classId, setClassId] = useState('');
  const state = useOffice(
    (t) => (classId ? api.results(t, classId) : Promise.resolve({ ok: true, students: [] })),
    [classId]);
  const layout = useLayout();

  const d = state.data;
  const rows = d?.students || d?.results || [];
  const subjects = useMemo(() => {
    const seen = new Map();
    for (const r of rows) for (const s of (r.subjects || [])) {
      if (!seen.has(s.subject_id ?? s.subject)) seen.set(s.subject_id ?? s.subject, s.subject || s.subject_name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const missing = useMemo(() => rows.reduce((n, r) =>
    n + subjects.filter(s => !(r.subjects || []).some(x => (x.subject_id ?? x.subject) === s.id
      && x.total_score != null)).length, 0), [rows, subjects]);

  return (
    <OfficeScreen state={state} skeleton={5}>
      <Bar left={<View style={{ minWidth: 240 }}>
        <Select label="Class" value={classId} onChange={setClassId} placeholder="Which class?"
                options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
      </View>}
      right={classId && rows.length ? (
        missing ? <Badge tone="warning" label={`${missing} mark${missing === 1 ? '' : 's'} still missing`} />
                : <Badge tone="success" label="Every mark is in" />
      ) : null} />

      {!classId ? (
        <EmptyState icon="layers" title="Pick a class"
                    message="The compilation puts a whole class against every subject on one sheet, and shows what is still missing." />
      ) : rows.length === 0 ? (
        <EmptyState icon="note" title="Nothing to compile yet"
                    message="No marks have been entered for this class this term." />
      ) : !layout.canTable ? (
        <EmptyState icon="alert" title="The compilation needs a wider screen"
                    message="Thirteen subjects across four hundred pixels is not a sheet. Open it on a tablet or a PC." />
      ) : (
        <Panel padded={false} title={`${rows.length} pupils · ${subjects.length} subjects`}
               subtitle="A blank cell is a mark nobody has entered.">
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={compStyles.head}>
                <View style={[compStyles.cell, { width: 190 }]}><Text style={compStyles.headText}>Pupil</Text></View>
                {subjects.map(s => (
                  <View key={s.id} style={[compStyles.cell, { width: 92 }]}>
                    <Text numberOfLines={2} style={compStyles.headText}>{s.name}</Text>
                  </View>
                ))}
                <View style={[compStyles.cell, { width: 82 }]}><Text style={compStyles.headText}>Average</Text></View>
              </View>
              {rows.map((r, i) => (
                <View key={r.student_id ?? r.id ?? i} style={[compStyles.row, i % 2 ? compStyles.rowAlt : null]}>
                  <View style={[compStyles.cell, { width: 190 }]}>
                    <Text numberOfLines={1} style={compStyles.name}>{r.name || r.student_name}</Text>
                  </View>
                  {subjects.map(s => {
                    const hit = (r.subjects || []).find(x => (x.subject_id ?? x.subject) === s.id);
                    const v = hit ? (hit.total_score ?? hit.total) : null;
                    return (
                      <View key={s.id} style={[compStyles.cell, { width: 92 }]}>
                        <Text style={[compStyles.mark, v == null && compStyles.missing]}>
                          {v == null ? '—' : Math.round(Number(v))}
                        </Text>
                      </View>
                    );
                  })}
                  <View style={[compStyles.cell, { width: 82 }]}>
                    <Text style={compStyles.avg}>
                      {r.average == null ? '—' : `${Math.round(r.average)}%`}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </Panel>
      )}
    </OfficeScreen>
  );
}

const compStyles = {
  head: { flexDirection: 'row', backgroundColor: colors.surfaceAlt,
          borderBottomWidth: 1, borderBottomColor: colors.border },
  headText: { ...type.micro, color: colors.muted, fontSize: 10 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowAlt: { backgroundColor: colors.surfaceAlt },
  cell: { paddingHorizontal: 9, paddingVertical: 9, justifyContent: 'center' },
  name: { ...type.small, fontWeight: '700', color: colors.text, fontSize: 12.5 },
  mark: { ...type.small, color: colors.textSoft, fontSize: 12.5, textAlign: 'right' },
  missing: { color: colors.faint },
  avg: { ...type.small, fontWeight: '800', color: colors.primary, fontSize: 12.5, textAlign: 'right' },
};

// ── End-of-term reports ─────────────────────────────────────────────────────
//
// The report card itself, printed. The server renders exactly the document the
// desktop's own report generator produces — headed paper, grading scale,
// conduct, the lot — so a card printed from a browser and a card printed from
// the office PC are the same piece of paper.

export function EndOfTermReport() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const state = useOffice(
    (t) => (classId ? api.results(t, classId) : Promise.resolve({ ok: true, students: [] })),
    [classId]);
  const mayPrint = can(profile, 'academics', 'view');
  const rows = state.data?.students || state.data?.results || [];

  async function print(student) {
    setBusy(student.student_id ?? student.id); setError(null); setDone(null);
    try {
      const html = await api.reportCardDocument(token, student.student_id ?? student.id);
      await printHtml(html);
      setDone(student.name || student.student_name);
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {done ? <SuccessNote message={`${done}'s report card was sent to the printer.`} /> : null}

      <Bar left={<View style={{ minWidth: 240 }}>
        <Select label="Class" value={classId} onChange={setClassId} placeholder="Which class?"
                options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
      </View>}
      right={rows.length ? <Badge tone="data" label={`${rows.length} report cards`} /> : null} />

      {!classId ? (
        <EmptyState icon="print" title="Pick a class"
                    message="Report cards are printed a class at a time. Conduct and the teacher's remark are written under End of Term Results first." />
      ) : rows.length === 0 ? (
        <EmptyState icon="note" title="No results yet"
                    message="Nothing has been compiled for this class this term." />
      ) : (
        <Panel padded={false} title="Report cards"
               subtitle="The same document the office PC prints — headed paper, the grading scale, conduct and the remark.">
          <View style={{ padding: spacing.lg }}>
            <DataTable
              keyExtractor={(r, i) => String(r.student_id ?? r.id ?? i)}
              columns={[
                { key: 'name', label: 'Pupil', render: (r) => r.name || r.student_name },
                { key: 'average', label: 'Average', align: 'right', width: 100,
                  render: (r) => (r.average == null ? '—' : `${Math.round(r.average)}%`) },
                { key: 'position', label: 'Position', align: 'right', width: 100,
                  render: (r) => (r.position == null ? '—' : String(r.position)) },
                { key: 'print', label: '', align: 'right', width: 130,
                  render: (r) => (mayPrint ? (
                    <Button size="sm" variant="outline" full={false} icon="print"
                            title={busy === (r.student_id ?? r.id) ? 'Printing…' : 'Print'}
                            disabled={busy != null} onPress={() => print(r)} />
                  ) : null) },
              ]}
              rows={rows} />
          </View>
        </Panel>
      )}
    </OfficeScreen>
  );
}
