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
import { Select, Muted, Button, Field, InfoNote } from './ui';
import { spacing } from './theme';

/** The classes this teacher may open, loaded once per screen. */
export function useClasses(token) {
  const [classes, setClasses] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    api.classes(token)
      .then(r => { if (live) setClasses(r.classes || []); })
      .catch(e => { if (live) { setError(e.message); setClasses([]); } });
    return () => { live = false; };
  }, [token]);
  return { classes, error };
}

/** The subjects this teacher may touch in `classId`. */
export function useSubjects(token, classId) {
  const [subjects, setSubjects] = useState(null);
  useEffect(() => {
    if (!classId) { setSubjects(null); return undefined; }
    let live = true;
    setSubjects(null);
    api.scoreSubjects(token, classId)
      .then(r => { if (live) setSubjects(r.subjects || []); })
      .catch(() => { if (live) setSubjects([]); });
    return () => { live = false; };
  }, [token, classId]);
  return subjects;
}

export function ClassPicker({ classes, value, onChange, label = 'Class', hint }) {
  if (classes === null) return <Muted>Loading your classes…</Muted>;
  if (classes.length === 0) {
    return (
      <InfoNote message="No classes are assigned to you yet. Ask the school office to set your teaching assignments — until then there is nothing here for you to open." />
    );
  }
  return (
    <Select
      label={label} value={value} onChange={onChange} hint={hint}
      options={classes.map(c => ({
        value: c.id,
        label: c.name,
        note: c.is_class_teacher ? 'Class teacher' : undefined,
      }))}
    />
  );
}

export function SubjectPicker({ subjects, value, onChange, label = 'Subject' }) {
  if (subjects === null) return null;
  return (
    <Select
      label={label} value={value} onChange={onChange}
      options={subjects.map(s => ({ value: s.id, label: s.name, note: s.code || undefined }))}
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
