// Nickland Edusoft — choosing a class, a subject and a date.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Six screens begin the same way: which class, then which subject, then which
// day. Written six times that is six chances for one of them to offer a class
// the teacher cannot open — the exact fault F10 fixed on the desktop. This is
// the one implementation; the server filters the list to the teacher's own
// classes and this only draws what it is given.

import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from './api';
import { Select, Button, Field, InfoNote } from './ui';
import { spacing } from './theme';

/**
 * The classes this TEACHER may open — the register, the mark sheet, the
 * broadsheet. The server filters to their own assignments.
 */
export function useClasses(token) {
  return useClassList(token, api.classes);
}

/**
 * The classes the OFFICE may open — billing, the canteen collection, the roll,
 * a notice to a class, the timetable.
 *
 * Not the same question, and asking the teaching one was the fault behind
 * every empty picker in the browser: an accountant has no teaching
 * assignments, so "Nothing to choose from" was the honest answer to a question
 * nobody meant to ask. The server answers this one with every class the school
 * runs — or, for somebody who IS a teacher and holds nothing the office runs
 * on, with theirs.
 */
export function useOfficeClasses(token) {
  return useClassList(token, api.officeClasses);
}

function useClassList(token, load) {
  const [classes, setClasses] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    load(token)
      .then(r => { if (live) setClasses(r.classes || []); })
      .catch(e => { if (live) { setError(e.message); setClasses([]); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return { classes, error };
}

/**
 * The subjects this teacher may touch in `classId`.
 *
 * Three states, and the difference between the last two matters to the reader:
 *   undefined  no class has been chosen yet — nothing is being fetched
 *   null       a class has been chosen and the list is on its way
 *   array      the answer, possibly empty
 *
 * Collapsing "waiting for you" and "waiting for the server" into one `null`
 * is why the subject field used to say "Choose a class first" for a second
 * after a class had, in fact, been chosen.
 */
export function useSubjects(token, classId) {
  const [subjects, setSubjects] = useState(undefined);
  useEffect(() => {
    if (!classId) { setSubjects(undefined); return undefined; }
    let live = true;
    setSubjects(null);
    api.scoreSubjects(token, classId)
      .then(r => { if (live) setSubjects(r.subjects || []); })
      .catch(() => { if (live) setSubjects([]); });
    return () => { live = false; };
  }, [token, classId]);
  return subjects;
}

// A head teacher sees every class in the school; a class teacher sees one or
// two. Where the list is long enough to need it, the panel groups it the way
// the school itself talks about the school.
// The ladder a Ghanaian basic school actually climbs, with the spellings
// schools actually use — "basic" and "primary" are the same rung under two
// names, and a school that uses one never uses the other. Anything not listed
// sorts to the end rather than being dropped.
const LEVEL_ORDER = [
  'Creche', 'Pre-Nursery', 'Nursery', 'Kindergarten', 'KG',
  'Primary', 'Basic', 'JHS', 'Junior High',
];

function levelRank(category) {
  const key = String(category || '').trim().toLowerCase();
  const i = LEVEL_ORDER.findIndex(l => l.toLowerCase() === key);
  return i < 0 ? 99 : i;
}

// `level_category` is whatever the office typed into the desktop, so it arrives
// as "nursery" or "NURSERY" as readily as "Nursery". A tab strip reading
// "All nursery kindergarten basic" looks like a bug; capitalise for display and
// keep the raw value for matching.
function titleCase(s) {
  return String(s || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function levelGroups(classes) {
  const seen = [];
  for (const c of classes) {
    const g = c.level_category;
    if (g && !seen.includes(g)) seen.push(g);
  }
  seen.sort((a, b) => levelRank(a) - levelRank(b));
  return seen.map(g => ({ value: g, label: titleCase(g) }));
}

/**
 * Nursery before Kindergarten before Primary before JHS, and within a level
 * whatever order the server sent.
 *
 * The server sorts by `level_order`, which is a per-school number an office
 * can set to anything; a school that numbered Nursery 1 and Basic 1 both as 1
 * gets the two interleaved. The reader's mental order is the school's own
 * ladder, so the picker imposes it.
 */
function inSchoolOrder(classes) {
  return classes
    .map((c, i) => [c, i])
    .sort((a, b) => (levelRank(a[0].level_category) - levelRank(b[0].level_category)) || (a[1] - b[1]))
    .map(([c]) => c);
}

export function ClassPicker({ classes, value, onChange, label = 'Class', hint,
                              placeholder = 'Which class?', emptyMessage }) {
  // A field that says it is loading, rather than a line of text that is then
  // replaced by a field — the form keeps its height and nothing jumps.
  if (classes === null) {
    return <Select label={label} value={null} options={[]} onChange={onChange}
      icon="users" loading loadingLabel="Loading your classes…" />;
  }
  if (classes.length === 0) {
    return (
      <InfoNote message={emptyMessage
        || 'No classes are assigned to you yet. Ask the school office to set your teaching assignments — until then there is nothing here for you to open.'} />
    );
  }
  return (
    <Select
      label={label} value={value} onChange={onChange} hint={hint}
      icon="users" placeholder={placeholder} title="Choose a class"
      groups={levelGroups(classes)}
      options={inSchoolOrder(classes).map(c => ({
        value: c.id,
        label: c.name,
        // The school's own short code — B4, KG1, JHS2 — is what is written on
        // the classroom door and on the register, so it is what goes in the
        // marker rather than anything derived from the long name.
        mark: c.short_code || undefined,
        group: c.level_category || undefined,
        note: c.is_class_teacher ? 'Class teacher' : undefined,
      }))}
    />
  );
}

/**
 * The second half of the cascade. It is drawn disabled — not hidden — before a
 * class is chosen, so the shape of the form does not jump when one is, and so
 * a teacher can see there is a second step coming before taking the first.
 */
export function SubjectPicker({ subjects, value, onChange, label = 'Subject', hint }) {
  if (subjects === undefined) {
    return (
      <Select
        label={label} value={null} options={[]} onChange={onChange} hint={hint}
        icon="book" empty="Choose a class first."
      />
    );
  }
  if (subjects === null) {
    return (
      <Select
        label={label} value={null} options={[]} onChange={onChange} hint={hint}
        icon="book" loading loadingLabel="Finding your subjects…"
      />
    );
  }
  return (
    <Select
      label={label} value={value} onChange={onChange} hint={hint}
      icon="book" placeholder="Which subject?" title="Choose a subject"
      options={subjects.map(s => ({ value: s.id, label: s.name, mark: s.code || undefined, note: s.code || undefined }))}
      empty="You do not take a subject in this class."
    />
  );
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** A date with one-tap steps either side, because most edits are "yesterday". */
export function DateStepper({ label = 'Date', value, onChange }) {
  const shift = useCallback((days) => {
    const d = new Date(`${value}T12:00:00`);
    if (isNaN(d)) return;
    d.setDate(d.getDate() + days);
    onChange(d.toISOString().slice(0, 10));
  }, [value, onChange]);

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Field
        label={label} value={value} onChangeText={onChange}
        placeholder="YYYY-MM-DD" maxLength={10} icon="calendar" style={{ marginBottom: 8 }}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button size="sm" variant="outline" title="◀ Previous day" onPress={() => shift(-1)} />
        <Button size="sm" variant="outline" title="Today" onPress={() => onChange(todayISO())} />
        <Button size="sm" variant="outline" title="Next day ▶" onPress={() => shift(1)} />
      </View>
    </View>
  );
}
