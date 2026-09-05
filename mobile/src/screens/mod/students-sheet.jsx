// Nickland Edusoft — The Students Sheet.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A whole class on one screen, corrected in place — the way an office actually
// works through a pile of admission forms, rather than opening four hundred
// records one at a time. The installed application's sheet, column for column.
//
// ── What was different, and why it mattered ─────────────────────────────────
//
// The browser's sheet showed twelve of the desktop's thirty-nine columns and
// edited them through the ordinary update route, so it could not correct the
// status, the admission number, the address, the guardian's email or any of
// the medical facts — most of what an admission form asks for. It also had no
// idea which columns were dates and which were a fixed list of choices, so a
// bad value was accepted into the box and refused on save, one row at a time.
//
// It now reads the SAME rows and the SAME column rules the desktop's sheet
// uses. The server says which columns are dates, which are a list, and what
// that list contains, so the sheet draws a picker where there is a picker and
// refuses a bad value in the cell rather than at the end.
//
// ── Saving ──────────────────────────────────────────────────────────────────
//
// A cell is saved when it is left, exactly as at the office PC — an office
// correcting a pile of forms should not have to remember to press anything,
// and a sheet with an unsaved buffer is a sheet somebody closes and loses.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useOfficeClasses } from '../../pickers';
import { useOffice, OfficeScreen } from '../../office';
import {
  Select, SearchField, Button, Badge, Muted, EmptyState, ErrorNote,
} from '../../ui';
import { Panel, Bar } from '../../desk';
import { useLayout } from '../../responsive';
import { colors, spacing, type } from '../../theme';

// The desktop's columns, in the desktop's order and at the desktop's widths.
// `sticky` are the three that stay put while the rest scroll: without them a
// row scrolled sideways is an anonymous line of text.
const COLUMNS = [
  { field: 'index_number', label: 'Index No.', width: 130, sticky: true },
  { field: 'surname', label: 'Surname', width: 130, sticky: true },
  { field: 'first_name', label: 'First Name', width: 130, sticky: true },
  { field: 'other_names', label: 'Other Names', width: 130 },
  { field: 'current_class_id', label: 'Class', width: 130, kind: 'class' },
  { field: 'gender', label: 'Sex', width: 80 },
  { field: 'date_of_birth', label: 'Date of Birth', width: 130 },
  { field: 'age_computed', label: 'Age', width: 60, readonly: true },
  { field: 'denomination', label: 'Denomination', width: 130 },
  { field: 'place_of_birth', label: 'Place of Birth', width: 150 },
  { field: 'hometown', label: 'Hometown', width: 140 },
  { field: 'nationality', label: 'Nationality', width: 120 },
  { field: 'place_of_residence', label: 'Residence', width: 150 },
  { field: 'street_address', label: 'Street', width: 150 },
  { field: 'house_number', label: 'House No.', width: 100 },
  { field: 'digital_address', label: 'Digital Addr.', width: 140 },
  { field: 'nhis_number', label: 'NHIS No.', width: 120 },
  { field: 'previous_school', label: 'Previous School', width: 170 },
  { field: 'father_name', label: "Father's Name", width: 170 },
  { field: 'father_contact', label: "Father's Contact", width: 140 },
  { field: 'father_email', label: "Father's Email", width: 180 },
  { field: 'mother_name', label: "Mother's Name", width: 170 },
  { field: 'mother_contact', label: "Mother's Contact", width: 140 },
  { field: 'mother_email', label: "Mother's Email", width: 180 },
  { field: 'guardian_name', label: 'Guardian Name', width: 170 },
  { field: 'guardian_relationship', label: 'Relationship', width: 130 },
  { field: 'guardian_contact', label: 'Guardian Cont.', width: 140 },
  { field: 'guardian_email', label: 'Guardian Email', width: 180 },
  { field: 'lives_with', label: 'Lives With', width: 130 },
  { field: 'emergency_contact_name', label: 'Emergency Contact', width: 170 },
  { field: 'emergency_contact_phone', label: 'Emergency No.', width: 140 },
  { field: 'blood_group', label: 'Blood', width: 90 },
  { field: 'allergies', label: 'Allergies', width: 160 },
  { field: 'medical_notes', label: 'Medical Notes', width: 200 },
  { field: 'special_needs', label: 'Special Needs', width: 170 },
  { field: 'status', label: 'Status', width: 130 },
  { field: 'inactive_reason', label: 'Reason', width: 150 },
  { field: 'admission_date', label: 'Admission Date', width: 130 },
  { field: 'notes', label: 'Notes', width: 220 },
];

const STATUS_FILTERS = [
  { label: 'All Statuses', value: '' },
  { label: 'Active', value: 'Active' },
  { label: 'Suspended', value: 'Suspended' },
  { label: 'Withdrawn', value: 'Withdrawn' },
  { label: 'Transferred', value: 'Transferred' },
  { label: 'Graduated', value: 'Graduated' },
  { label: 'Inactive', value: 'Inactive' },
];

export default function StudentsSheet() {
  const { token, profile } = useAuth();
  const layout = useLayout();
  const { classes } = useOfficeClasses(token);
  const may = can(profile, 'students', 'edit');

  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const state = useOffice(
    (t) => api.studentsSheet(t, {
      classId: classId || undefined,
      status: status || undefined,
      search: debounced || undefined,
    }),
    [classId, status, debounced]);

  useEffect(() => { setRows(state.data?.rows || []); }, [state.data]);

  // The server says which columns are dates, which are a fixed list, and what
  // that list holds — so the sheet draws a picker where there is one instead
  // of guessing, and cannot offer a value the server will refuse.
  const spec = useMemo(() => {
    const map = {};
    for (const c of (state.data?.columns || [])) map[c.field] = c;
    return map;
  }, [state.data]);

  const save = useCallback(async (row, field, value) => {
    const current = row[field];
    const next = value === '' ? null : value;
    if (String(current ?? '') === String(next ?? '')) return;
    setSaving(true); setError(null);
    try {
      const r = await api.studentsSheetCell(token, { studentId: row.id, field, value: next });
      setRows(prev => prev.map(x => (x.id === row.id ? { ...x, ...r.row } : x)));
    } catch (e) {
      setError(e.message);
      // Put the cell back to what the record actually says, so the screen is
      // never showing a value the database refused.
      setRows(prev => prev.map(x => (x.id === row.id ? { ...x } : x)));
    } finally { setSaving(false); }
  }, [token]);

  if (!may) {
    return <EmptyState icon="lock" title="The sheet is read-only for your account"
                       message="You can see the roll under All Students. Correcting a record needs edit access to Students." />;
  }

  if (!layout.canTable) {
    return <EmptyState icon="alert" title="The sheet needs a wider screen"
                       message="Typing across thirty-nine columns on a handset is not a sheet. Open a pupil from All Students to correct one record, or use this on a tablet or a PC." />;
  }

  return (
    <OfficeScreen state={state} skeleton={6}>
      <ErrorNote message={error} />

      <Bar
        left={<>
          <View style={{ minWidth: 190 }}>
            <Select label="" value={classId} onChange={setClassId} placeholder="All Classes"
                    options={[{ label: 'All Classes', value: '' },
                              ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
          </View>
          <View style={{ minWidth: 170 }}>
            <Select label="" value={status} onChange={setStatus} options={STATUS_FILTERS} />
          </View>
          <View style={{ minWidth: 220, flex: 1 }}>
            <SearchField value={search} onChangeText={setSearch}
                         placeholder="Search by name or index no…" />
          </View>
        </>}
        right={<>
          <Text style={{ ...type.small, fontWeight: '800', color: colors.text }}>
            {`Number of records = ${rows.length}`}
          </Text>
          {saving ? <Badge tone="warning" label="Saving…" /> : null}
        </>} />

      <Panel padded={false}
             subtitle="Type into a cell and move on — each correction saves as you leave it, exactly as at the office PC.">
        <ScrollView horizontal showsHorizontalScrollIndicator style={{ width: '100%' }}>
          <View>
            <View style={styles.head}>
              <View style={[styles.cell, { width: 46 }]}>
                <Text style={styles.headText}>#</Text>
              </View>
              {COLUMNS.map(c => (
                <View key={c.field} style={[styles.cell, { width: c.width }]}>
                  <Text numberOfLines={1} style={styles.headText}>
                    {c.label}{c.readonly ? ' 🔒' : ''}
                  </Text>
                </View>
              ))}
            </View>

            {rows.length === 0 ? (
              <View style={{ padding: spacing.xl }}>
                <Muted>No students match the current filters</Muted>
              </View>
            ) : rows.map((row, i) => (
              <View key={row.id} style={[styles.row, i % 2 ? styles.rowAlt : null]}>
                <View style={[styles.cell, { width: 46 }]}>
                  <Text style={styles.rowNum}>{i + 1}</Text>
                </View>
                {COLUMNS.map(c => (
                  <Cell key={c.field} column={c} row={row} classes={classes}
                        spec={spec[c.field]} onSave={save} />
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </Panel>

      <Muted>
        Click a cell to correct it. A correction saves when you leave the cell. Age and
        the class name are worked out automatically; the admission number is checked for
        clashes before it is accepted.
      </Muted>
    </OfficeScreen>
  );
}

function Cell({ column, row, classes, spec, onSave }) {
  const value = row[column.field];
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [focus, setFocus] = useState(false);
  const touched = useRef(false);

  // The row is replaced by whatever the server wrote back, so the cell follows
  // it rather than holding a stale draft.
  useEffect(() => {
    if (!focus) setDraft(value == null ? '' : String(value));
  }, [value, focus]);

  if (column.readonly) {
    return (
      <View style={[styles.cell, { width: column.width }]}>
        <Text numberOfLines={1} style={styles.readonly}>{value ?? ''}</Text>
      </View>
    );
  }

  // A fixed list of choices, or a class — a picker, never a free-text box that
  // accepts a value the server will refuse.
  const choices = column.kind === 'class'
    ? (classes || []).map(c => ({ label: c.name, value: String(c.id) }))
    : (spec && spec.type === 'enum' && spec.values
      ? spec.values.map(v => ({ label: v, value: v }))
      : null);

  if (choices) {
    return (
      <View style={[styles.cell, { width: column.width }]}>
        <Select label="" value={value == null ? '' : String(value)}
                placeholder="—"
                options={[{ label: '—', value: '' }, ...choices]}
                onChange={(v) => onSave(row, column.field, v)} />
      </View>
    );
  }

  const isDate = spec && spec.type === 'date';

  return (
    <View style={[styles.cell, { width: column.width }]}>
      <TextInput
        value={draft}
        onChangeText={(v) => { touched.current = true; setDraft(v); }}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          if (touched.current) { touched.current = false; onSave(row, column.field, draft); }
        }}
        onSubmitEditing={() => {
          if (touched.current) { touched.current = false; onSave(row, column.field, draft); }
        }}
        placeholder={isDate ? 'YYYY-MM-DD' : ''}
        placeholderTextColor={colors.faint}
        accessibilityLabel={`${column.label}, ${row.surname || ''} ${row.first_name || ''}`}
        style={[styles.input, focus && styles.inputFocus]}
      />
    </View>
  );
}

const styles = {
  head: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  headText: {
    ...type.small, fontSize: 11, fontWeight: '800', color: colors.textSoft,
    textTransform: 'uppercase', letterSpacing: 0.2,
  },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowAlt: { backgroundColor: 'rgba(0,0,0,0.015)' },
  cell: { paddingHorizontal: 4, paddingVertical: 3, justifyContent: 'center' },
  rowNum: { ...type.small, fontSize: 11, color: colors.faint, textAlign: 'center' },
  readonly: { ...type.small, fontSize: 12, color: colors.muted, paddingHorizontal: 4 },
  input: {
    ...type.small, fontSize: 12, color: colors.text,
    paddingHorizontal: 6, paddingVertical: 5, borderRadius: 4,
    borderWidth: 1, borderColor: 'transparent', backgroundColor: 'transparent',
  },
  inputFocus: { borderColor: colors.primary, backgroundColor: '#fff' },
};
