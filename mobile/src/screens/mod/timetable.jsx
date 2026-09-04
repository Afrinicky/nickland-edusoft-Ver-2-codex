// The timetable — reading one, and setting one.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The web app could show a timetable and not make one, which meant every school
// still had to walk to the office PC to move a lesson. This is the editor.
//
// ── The grid ────────────────────────────────────────────────────────────────
//
// Periods down the side, weekdays across. That is the shape a Ghanaian school's
// timetable is drawn in on the staff-room wall, and reproducing it means nobody
// has to translate between the paper and the screen while copying one into the
// other.
//
// A cell holds a subject and, optionally, who teaches it. Choosing a subject is
// the whole interaction: click the cell, pick from the list, done. Breaks are
// drawn as full-width bands and cannot hold a lesson, because a school that
// rings a bell for break does not teach through it.
//
// ── Why it saves the whole week at once ─────────────────────────────────────
//
// Cell-at-a-time would be less code and worse. A timetable is edited in one
// sitting — an hour, forty cells, a lot of second-guessing — and each cell
// saved on the spot is a request that can fail on its own, leaving a grid the
// screen shows and the database does not. Whole-week saves match what both
// servers already do and mean "Save" is a decision rather than an accident.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useClasses, useSubjects } from '../../pickers';
import { OfficeScreen, useOffice } from '../../office';
import {
  Select, Button, Muted, Badge, EmptyState, ErrorNote, SuccessNote, Sheet,
  Field, SegmentedControl, DataTable, Divider,
} from '../../ui';
import { Panel, Bar } from '../../desk';
import { useLayout } from '../../responsive';
import { colors, spacing, type, radius } from '../../theme';

const DAYS = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
];

export default function TimetableTab() {
  const { token, profile } = useAuth();
  const [view, setView] = useState('mine');
  const mayEdit = can(profile, 'academics', 'edit');

  return (
    <View style={{ gap: spacing.md }}>
      <Bar left={
        <View style={{ minWidth: 300 }}>
          <SegmentedControl
            value={view} onChange={setView}
            options={[
              { label: 'My week', value: 'mine' },
              { label: 'A class', value: 'class' },
              ...(mayEdit ? [{ label: 'Bell schedule', value: 'periods' }] : []),
            ]} />
        </View>
      } />
      {view === 'mine' ? <MyWeek token={token} /> : null}
      {view === 'class' ? <ClassWeek token={token} mayEdit={mayEdit} /> : null}
      {view === 'periods' && mayEdit ? <BellSchedule token={token} /> : null}
    </View>
  );
}

// ── one teacher's own week ──────────────────────────────────────────────────

function MyWeek({ token }) {
  const state = useOffice((t) => api.myTimetable(t));
  const d = state.data;
  const today = new Date().getDay();

  return (
    <OfficeScreen state={state} skeleton={4}>
      {d && d.has_staff === false ? (
        <EmptyState icon="badge" title="Your account has no staff record"
                    message="A timetable belongs to a member of staff. Ask the office to link your login to your staff record." />
      ) : null}
      {d && d.days ? (
        (d.days.some(day => (day.periods || []).length)) ? (
          d.days.map(day => (
            <Panel key={day.value}
                   title={day.label}
                   right={day.value === today ? <Badge tone="primary" label="Today" /> : null}>
              {(day.periods || []).filter(p => !p.is_break).length === 0 ? (
                <Muted>Nothing timetabled.</Muted>
              ) : (
                <DataTable
                  keyExtractor={(r, i) => `${day.value}-${i}`}
                  columns={[
                    { key: 'period_label', label: 'Period', width: 150 },
                    { key: 'time', label: 'Time', width: 140,
                      render: (r) => `${r.start_time || ''}–${r.end_time || ''}` },
                    { key: 'class_name', label: 'Class', width: 170 },
                    { key: 'subject_name', label: 'Subject' },
                  ]}
                  rows={(day.periods || []).filter(p => !p.is_break)} />
              )}
            </Panel>
          ))
        ) : (
          <EmptyState icon="calendar" title="Nothing on your timetable yet"
                      message="Once the office sets the school's timetable, your week appears here." />
        )
      ) : null}
    </OfficeScreen>
  );
}

// ── a class's week, and setting it ──────────────────────────────────────────

function ClassWeek({ token, mayEdit }) {
  const layout = useLayout();
  const { classes } = useClasses(token);
  const [classId, setClassId] = useState('');
  const subjects = useSubjects(token, classId || null);
  const [grid, setGrid] = useState(null);        // { periods, entries }
  const [draft, setDraft] = useState(null);      // "<day>:<period>" -> { subject_id, teacher_id }
  const [cell, setCell] = useState(null);
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!classId) { setGrid(null); setDraft(null); return; }
    setError(null); setGrid(null);
    try {
      const r = await api.classTimetable(token, classId);
      setGrid(r);
      setDraft(Object.fromEntries(Object.entries(r.entries || {}).map(([k, e]) => [k, {
        subject_id: e.subject_id, teacher_id: e.teacher_id,
        subject_name: e.subject_name, teacher_name: e.teacher_name,
      }])));
    } catch (e) { setError(e.message); setGrid({ periods: [], entries: {} }); }
  }, [token, classId]);

  useEffect(() => { load(); }, [load]);

  // Who could be put against a lesson. Only fetched when the account may edit,
  // because a read-only viewer never opens the picker.
  useEffect(() => {
    if (!mayEdit) return undefined;
    let live = true;
    api.adminStaff(token, 'Active')
      .then(r => { if (live) setStaff(r.staff || []); })
      .catch(() => { if (live) setStaff([]); });
    return () => { live = false; };
  }, [token, mayEdit]);

  const dirty = useMemo(() => {
    if (!grid || !draft) return false;
    const before = Object.entries(grid.entries || {})
      .filter(([, e]) => e && e.subject_id)
      .map(([k, e]) => `${k}=${e.subject_id}:${e.teacher_id || ''}`).sort().join('|');
    const after = Object.entries(draft)
      .filter(([, e]) => e && e.subject_id)
      .map(([k, e]) => `${k}=${e.subject_id}:${e.teacher_id || ''}`).sort().join('|');
    return before !== after;
  }, [grid, draft]);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      const entries = Object.entries(draft)
        .filter(([, e]) => e && e.subject_id)
        .map(([key, e]) => {
          const [day, period] = key.split(':');
          return {
            day_of_week: Number(day), period_id: Number(period),
            subject_id: Number(e.subject_id),
            teacher_id: e.teacher_id ? Number(e.teacher_id) : null,
          };
        });
      await api.saveClassTimetable(token, Number(classId), entries);
      setSaved(true);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const periods = grid?.periods || [];

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorNote message={error} />
      {saved ? <SuccessNote message="The timetable is set. Every teacher in it sees their own week update." /> : null}

      <Bar
        left={<View style={{ minWidth: 260 }}>
          <Select label="Class" value={classId} onChange={setClassId}
                  placeholder="Which class?"
                  options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
        </View>}
        right={mayEdit && classId ? <>
          {dirty ? <Badge tone="warning" label="Unsaved" /> : null}
          <Button title={busy ? 'Saving…' : 'Save the week'} busy={busy}
                  disabled={busy || !dirty} icon="check" full={false} onPress={save} />
          {dirty ? <Button title="Undo" variant="ghost" full={false} onPress={load} /> : null}
        </> : null}
      />

      {!classId ? (
        <EmptyState icon="calendar" title="Pick a class"
                    message="A timetable is set one class at a time." />
      ) : !grid ? null
        : periods.length === 0 ? (
          <EmptyState icon="clock" title="The school has no bell schedule yet"
                      message="Set the periods first — what time each lesson starts and ends — and the grid appears." />
        ) : !layout.canTable ? (
          <StackedWeek periods={periods} draft={draft || {}} />
        ) : (
          <Panel padded={false}
                 title={grid.class?.name || 'Class timetable'}
                 subtitle={mayEdit ? 'Tap a cell to set the subject. Nothing is written until you save.' : 'Read only.'}>
            <Grid periods={periods} draft={draft || {}} mayEdit={mayEdit}
                  onPick={(key) => setCell(key)} />
          </Panel>
        )}

      <Sheet visible={!!cell} onClose={() => setCell(null)} title="What is taught here?">
        {cell ? (
          <>
            <Muted>{cellName(cell, periods)}</Muted>
            <Select label="Subject" value={String(draft?.[cell]?.subject_id || '')}
                    onChange={(v) => setDraft(d => ({ ...d, [cell]: { ...(d[cell] || {}), subject_id: v || null,
                      subject_name: (subjects || []).find(s => String(s.id) === String(v))?.name } }))}
                    placeholder="Free period"
                    options={[{ label: 'Free period', value: '' },
                              ...(subjects || []).map(s => ({ label: s.name, value: String(s.id) }))]} />
            <Select label="Teacher" value={String(draft?.[cell]?.teacher_id || '')}
                    onChange={(v) => setDraft(d => ({ ...d, [cell]: { ...(d[cell] || {}), teacher_id: v || null,
                      teacher_name: staff.find(s => String(s.id) === String(v))?.name } }))}
                    placeholder="Whoever is assigned"
                    options={[{ label: 'Whoever is assigned', value: '' },
                              ...staff.map(s => ({ label: s.name || `${s.surname || ''} ${s.first_name || ''}`.trim(),
                                                   value: String(s.id) }))]} />
            <Button title="Done" onPress={() => setCell(null)} />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

function cellName(key, periods) {
  const [day, period] = key.split(':');
  const d = DAYS.find(x => String(x.value) === day);
  const p = periods.find(x => String(x.id) === period);
  return `${d ? d.label : ''} · ${p ? p.label : ''}${p && p.start_time ? ` (${p.start_time}–${p.end_time})` : ''}`;
}

function Grid({ periods, draft, mayEdit, onPick }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ minWidth: 700 }}>
        <View style={styles.row}>
          <View style={[styles.head, styles.timeCol]}><Text style={styles.headText}>Period</Text></View>
          {DAYS.map(d => (
            <View key={d.value} style={[styles.head, styles.dayCol]}>
              <Text style={styles.headText}>{d.label}</Text>
            </View>
          ))}
        </View>

        {periods.map((p) => (
          p.is_break ? (
            <View key={p.id} style={styles.breakRow}>
              <Text style={styles.breakText}>
                {p.label}{p.start_time ? `  ${p.start_time}–${p.end_time}` : ''}
              </Text>
            </View>
          ) : (
            <View key={p.id} style={styles.row}>
              <View style={[styles.cell, styles.timeCol]}>
                <Text numberOfLines={1} style={styles.periodLabel}>{p.label}</Text>
                <Text numberOfLines={1} style={styles.periodTime}>{p.start_time}–{p.end_time}</Text>
              </View>
              {DAYS.map(d => {
                const key = `${d.value}:${p.id}`;
                const e = draft[key];
                const filled = e && e.subject_id;
                return (
                  <Pressable key={key} disabled={!mayEdit} onPress={() => onPick(key)}
                             accessibilityRole={mayEdit ? 'button' : undefined}
                             accessibilityLabel={`${d.label}, ${p.label}${filled ? `: ${e.subject_name}` : ', free'}`}
                             style={[styles.cell, styles.dayCol, filled && styles.cellFilled,
                                     mayEdit && styles.cellEditable]}>
                    {filled ? (
                      <>
                        <Text numberOfLines={2} style={styles.subject}>{e.subject_name || 'Subject'}</Text>
                        {e.teacher_name ? (
                          <Text numberOfLines={1} style={styles.teacher}>{e.teacher_name}</Text>
                        ) : null}
                      </>
                    ) : (
                      <Text style={styles.free}>{mayEdit ? '+' : '—'}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )
        ))}
      </View>
    </ScrollView>
  );
}

// A handset gets the week as a list per day. A five-column grid at 360px is
// five columns of nothing.
function StackedWeek({ periods, draft }) {
  return (
    <View style={{ gap: spacing.md }}>
      {DAYS.map(d => {
        const lessons = periods.filter(p => !p.is_break)
          .map(p => ({ p, e: draft[`${d.value}:${p.id}`] }))
          .filter(x => x.e && x.e.subject_id);
        return (
          <Panel key={d.value} title={d.label}>
            {lessons.length === 0 ? <Muted>Nothing timetabled.</Muted> : lessons.map(({ p, e }) => (
              <View key={p.id} style={styles.stackRow}>
                <View style={{ width: 92 }}>
                  <Text style={styles.periodTime}>{p.start_time}</Text>
                  <Text style={styles.periodTime}>{p.end_time}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text }}>
                    {e.subject_name}
                  </Text>
                  {e.teacher_name ? <Muted numberOfLines={1}>{e.teacher_name}</Muted> : null}
                </View>
              </View>
            ))}
          </Panel>
        );
      })}
    </View>
  );
}

// ── the bell schedule ───────────────────────────────────────────────────────
//
// What time each period starts and ends, and which of them are breaks. One list
// for the whole school: a timetable where 2B's Period 3 is at a different time
// from 2A's is not a timetable, it is two.

function BellSchedule({ token }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.timetablePeriods(token);
      setRows((r.periods || []).map(p => ({ ...p })));
    } catch (e) { setError(e.message); setRows([]); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const set = (i, k) => (v) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setRows(rs => [...rs, {
    label: `Period ${rs.filter(r => !r.is_break).length + 1}`,
    start_time: '', end_time: '', is_break: 0, display_order: rs.length,
  }]);
  const remove = (i) => setRows(rs => rs.filter((_, j) => j !== i));

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api.saveTimetablePeriods(token, rows.map((r, i) => ({ ...r, display_order: i })));
      setSaved(true);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!rows) return null;

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorNote message={error} />
      {saved ? <SuccessNote message="The bell schedule is saved." /> : null}

      <Panel title="The school day"
             subtitle="Every class rings to the same bell. Removing a period removes the lessons in it."
             right={<Button title={busy ? 'Saving…' : 'Save'} busy={busy} disabled={busy}
                            size="sm" full={false} icon="check" onPress={save} />}>
        {rows.length === 0 ? (
          <Muted>No periods yet. Add the first one below.</Muted>
        ) : rows.map((r, i) => (
          <View key={r.id || `new-${i}`} style={styles.periodRow}>
            <View style={{ flex: 2, minWidth: 150 }}>
              <Field label={i === 0 ? 'Name' : ''} value={r.label || ''} onChangeText={set(i, 'label')} />
            </View>
            <View style={{ width: 120 }}>
              <Field label={i === 0 ? 'From' : ''} value={r.start_time || ''} onChangeText={set(i, 'start_time')} hint="08:00" />
            </View>
            <View style={{ width: 120 }}>
              <Field label={i === 0 ? 'To' : ''} value={r.end_time || ''} onChangeText={set(i, 'end_time')} hint="08:40" />
            </View>
            <Pressable onPress={() => set(i, 'is_break')(r.is_break ? 0 : 1)}
                       accessibilityRole="switch" accessibilityState={{ checked: !!r.is_break }}
                       style={[styles.breakToggle, r.is_break && styles.breakToggleOn]}>
              <Text style={[styles.breakToggleText, r.is_break && { color: '#fff' }]}>Break</Text>
            </Pressable>
            <Button title="Remove" variant="ghost" size="sm" full={false} onPress={() => remove(i)} />
          </View>
        ))}
        <Divider />
        <Button title="Add a period" variant="outline" icon="plus" full={false} onPress={add} />
      </Panel>
    </View>
  );
}

const styles = {
  row: { flexDirection: 'row' },
  head: {
    paddingVertical: 10, paddingHorizontal: 10,
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    borderRightWidth: 1, borderRightColor: colors.borderSoft,
  },
  headText: { ...type.micro, color: colors.muted, fontSize: 10.5 },
  timeCol: { width: 130 },
  dayCol: { flex: 1, minWidth: 112 },
  cell: {
    minHeight: 62, paddingVertical: 8, paddingHorizontal: 9, justifyContent: 'center',
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
    borderRightWidth: 1, borderRightColor: colors.borderSoft,
  },
  cellEditable: { cursor: 'pointer' },
  cellFilled: { backgroundColor: colors.primarySoft },
  periodLabel: { ...type.small, fontWeight: '700', color: colors.text, fontSize: 12.5 },
  periodTime: { ...type.small, color: colors.muted, fontSize: 11 },
  subject: { ...type.small, fontWeight: '700', color: colors.primary, fontSize: 12.5 },
  teacher: { ...type.small, color: colors.muted, fontSize: 11, marginTop: 1 },
  free: { ...type.small, color: colors.faint, textAlign: 'center' },

  breakRow: {
    paddingVertical: 7, paddingHorizontal: 12, backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  breakText: { ...type.micro, color: colors.muted, fontSize: 10.5 },

  stackRow: {
    flexDirection: 'row', gap: spacing.md, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },

  periodRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    flexWrap: 'wrap', marginBottom: spacing.sm,
  },
  breakToggle: {
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.control,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  breakToggleOn: { backgroundColor: colors.muted, borderColor: colors.muted },
  breakToggleText: { ...type.small, fontWeight: '700', color: colors.muted, fontSize: 12.5 },
};
