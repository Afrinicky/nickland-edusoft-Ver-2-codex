// Settings — the school's own setup, from a browser.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop's Settings area, which the app had none of. Identity, appearance,
// terms, classes, subjects, grading, the switches that decide which modules
// exist, and the accounts and access levels behind all of it.
//
// ── Appearance ──────────────────────────────────────────────────────────────
//
// The one that changes how everything else looks. It writes the same six keys
// the desktop writes — `school_color_primary`, `school_color_accent`, the two
// page colours and the font — and the app re-skins itself the moment they are
// saved, because src/theme.js reads every token through a CSS variable and
// src/skin.js writes them. A school that matched its crest on the office PC in
// 2024 sees that work here for the first time.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { useAuth } from '../../auth';
import { useBranding } from '../../brand';
import { api } from '../../api';
import { FilePicker } from '../../filepick';
import { can } from '../../guard';
import { isSuperAdmin } from '../../modules';
import { OfficeScreen, shortDate, useOffice } from '../../office';
import {
  Select, DataTable, Muted, Badge, EmptyState, ErrorNote, SuccessNote, Button,
  Field, TextArea, Sheet, SearchField, Divider, CheckRow, Loading, InfoNote,
  SegmentedControl, Crest,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { deriveTokens, isHex, readableOn, SKINS } from '../../skin';
import { colors, spacing, type, radius } from '../../theme';

// ── a small shared editor for a group of settings keys ──────────────────────
//
// Nine of these screens are the same screen: read /system/settings, show some
// of its keys as fields, write the ones that changed. Written once.

function SettingsForm({ title, subtitle, fields, note, children }) {
  const { token, profile } = useAuth();
  const brand = useBranding();
  const state = useOffice((t) => api.systemSettings(t));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const may = can(profile, 'settings', 'edit');

  const settings = state.data?.settings;
  useEffect(() => {
    if (settings && draft === null) {
      setDraft(Object.fromEntries(fields.map(f => [f.key, settings[f.key] ?? ''])));
    }
  }, [settings, draft, fields]);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api.systemSaveSettings(token, draft);
      setSaved(true);
      // The crest and the colours are read from /branding, not from here, so
      // the provider is asked again rather than left a version behind.
      if (brand.reload) brand.reload();
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={4}>
      <ErrorNote message={error} />
      {saved ? <SuccessNote message="Saved." /> : null}
      {!may ? <InfoNote message="You can read these settings but not change them." /> : null}

      <Panel title={title} subtitle={subtitle}
             right={may ? <Button title={busy ? 'Saving…' : 'Save'} busy={busy} disabled={busy || !draft}
                                  size="sm" full={false} icon="check" onPress={save} /> : null}>
        {!draft ? <Loading label="Reading the settings…" /> : (
          <View style={styles.grid}>
            {fields.map(f => (
              <View key={f.key} style={[styles.cell, f.wide && { flexBasis: '100%' }]}>
                {f.options ? (
                  <Select label={f.label} value={String(draft[f.key] ?? '')}
                          onChange={may ? (v) => setDraft(d => ({ ...d, [f.key]: v })) : undefined}
                          hint={f.hint} options={f.options} disabled={!may} />
                ) : f.multiline ? (
                  <TextArea label={f.label} value={String(draft[f.key] ?? '')}
                            onChangeText={may ? (v) => setDraft(d => ({ ...d, [f.key]: v })) : undefined}
                            hint={f.hint} />
                ) : (
                  <Field label={f.label} value={String(draft[f.key] ?? '')}
                         onChangeText={may ? (v) => setDraft(d => ({ ...d, [f.key]: v })) : undefined}
                         hint={f.hint} />
                )}
              </View>
            ))}
          </View>
        )}
        {note ? <Muted style={{ marginTop: spacing.md }}>{note}</Muted> : null}
      </Panel>
      {typeof children === 'function' ? children({ draft, setDraft, may, settings }) : children}
    </OfficeScreen>
  );
}

// ── School identity ─────────────────────────────────────────────────────────

export function SchoolIdentity() {
  return (
    <SettingsForm
      title="School identity"
      subtitle="What is printed on a receipt, a report card and the top of every screen."
      note="The crest is uploaded on the school's own system, where the image file is."
      fields={[
        { key: 'school_name', label: 'Name' },
        { key: 'school_abbreviation', label: 'Short name', hint: 'For receipts and admission numbers' },
        { key: 'school_motto', label: 'Motto' },
        { key: 'school_type', label: 'Type', hint: 'Basic, JHS, Preparatory…' },
        { key: 'school_address', label: 'Address', wide: true },
        { key: 'school_digital_address', label: 'Digital address', hint: 'Ghana Post GPS' },
        { key: 'school_location', label: 'Town' },
        { key: 'school_phone_1', label: 'Telephone' },
        { key: 'school_phone_2', label: 'Second telephone' },
        { key: 'school_whatsapp', label: 'WhatsApp', hint: 'What the "message the school" button dials' },
        { key: 'school_email', label: 'Email' },
        { key: 'school_website', label: 'Website' },
      ]} />
  );
}

// ── Appearance ──────────────────────────────────────────────────────────────

const FONTS = ['Inter', 'Segoe UI', 'Roboto', 'Georgia', 'Cambria', 'Times New Roman', 'Arial'];

export function Appearance() {
  const { token, profile } = useAuth();
  const brand = useBranding();
  const state = useOffice((t) => api.systemSettings(t));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [logoSaved, setLogoSaved] = useState(false);
  const [signSaved, setSignSaved] = useState(false);
  const may = can(profile, 'settings', 'edit');

  const settings = state.data?.settings;
  const KEYS = ['school_color_primary', 'school_color_accent', 'school_color_background',
                'school_color_foreground', 'ui_font_family', 'ui_font_size_base'];

  useEffect(() => {
    if (settings && draft === null) {
      setDraft(Object.fromEntries(KEYS.map(k => [k, settings[k] ?? ''])));
    }
  }, [settings, draft]);

  // What the school would look like with what is currently typed in. Computed
  // from the same function that writes the real thing, so the preview cannot
  // disagree with the result.
  const preview = useMemo(() => deriveTokens('desk', draft || {}), [draft]);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api.systemSaveSettings(token, draft);
      setSaved(true);
      if (brand.reload) brand.reload();      // re-skins the app immediately
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function reset() {
    setDraft(Object.fromEntries(KEYS.map(k => [k, ''])));
  }

  return (
    <OfficeScreen state={state} skeleton={4}>
      <ErrorNote message={error} />
      {saved ? <SuccessNote message="Saved. The school's colours are in use everywhere — here, on the phone, and on the office PC." /> : null}
      {!may ? <InfoNote message="You can see the school's colours but not change them." /> : null}

      <Panel title="The school's colours"
             subtitle="The same two colours the desktop uses. Set them once and every screen follows."
             right={may ? <>
               <Button title={busy ? 'Saving…' : 'Save'} busy={busy} disabled={busy || !draft}
                       size="sm" full={false} icon="check" onPress={save} />
             </> : null}>
        {!draft ? <Loading label="Reading the settings…" /> : (
          <>
            <View style={styles.grid}>
              <View style={styles.cell}>
                <ColourField label="Primary colour" value={draft.school_color_primary}
                             placeholder={SKINS.desk.primary} disabled={!may}
                             onChange={(v) => setDraft(d => ({ ...d, school_color_primary: v }))} />
              </View>
              <View style={styles.cell}>
                <ColourField label="Accent colour" value={draft.school_color_accent}
                             placeholder={SKINS.desk.accent} disabled={!may}
                             onChange={(v) => setDraft(d => ({ ...d, school_color_accent: v }))} />
              </View>
              <View style={styles.cell}>
                <Select label="Typeface" value={draft.ui_font_family || ''}
                        onChange={may ? (v) => setDraft(d => ({ ...d, ui_font_family: v })) : undefined}
                        placeholder="The system typeface"
                        options={[{ label: 'The system typeface', value: '' },
                                  ...FONTS.map(f => ({ label: f, value: f }))]} />
              </View>
              <View style={styles.cell}>
                <Field label="Base text size" value={String(draft.ui_font_size_base || '')}
                       onChangeText={may ? (v) => setDraft(d => ({ ...d, ui_font_size_base: v })) : undefined}
                       hint="14 is the default. Between 10 and 22." />
              </View>
            </View>

            <Preview tokens={preview} />

            {may ? (
              <Button title="Back to the default colours" variant="ghost" full={false} onPress={reset} />
            ) : null}
          </>
        )}
      </Panel>

      {/* The crest heads every screen, every receipt and every report card.
          Setting it needed the office PC, which meant a school could rebrand
          everything except from the machine most of them actually sit at. */}
      <Panel title="The school's crest"
             subtitle="What heads every screen, every receipt and every report card.">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, flexWrap: 'wrap' }}>
          <Crest logo={brand.logo} size={72} />
          <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
            {logoSaved ? <SuccessNote message="The crest is in use everywhere — here, on the phone and on the office PC." /> : null}
            {may ? (
              <FilePicker
                label={brand.logo ? 'Replace the crest' : 'Upload a crest'}
                accept="image/*" maxEdge={512}
                hint="A square PNG or JPEG. It is shrunk to 512 pixels before it is stored."
                onPick={async (uri) => {
                  await api.uploadLogo(token, uri);
                  setLogoSaved(true);
                  if (brand.reload) brand.reload();
                }} />
            ) : <Muted>You can see the crest but not change it.</Muted>}
          </View>
        </View>
      </Panel>

      {/* The two signatures that go on a report card, an attestation and a
          statutory schedule. Uploading one needed the office PC — so a school
          could print a report card from the browser with nobody's name under
          it, and had to walk to the machine in the corner to fix that. */}
      <Panel title="Signatures"
             subtitle="What goes under a report card, an attestation and a printed schedule.">
        {signSaved ? <SuccessNote message="Saved. It will appear on documents the assigned signer prints." /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
          {[['proprietor', "The proprietor's signature",
             'Official documents, attestations, testimonials and financial reports.'],
            ['headmaster', "The head teacher's signature",
             'Report cards, end of term reports and academic correspondence.']].map(
            ([role, label, why]) => (
              <View key={role} style={{ flex: 1, minWidth: 260, gap: 6 }}>
                <Text style={{ ...type.label }}>{label}</Text>
                <Muted>{why}</Muted>
                {may ? (
                  <FilePicker
                    label={`Upload the ${role === 'proprietor' ? "proprietor's" : "head teacher's"} signature`}
                    accept="image/*" maxEdge={600}
                    hint="A PNG with a transparent background prints best."
                    onPick={async (uri) => {
                      await api.uploadSignature(token, { role, file: uri });
                      setSignSaved(true);
                      state.reload();
                    }} />
                ) : <Muted>You can see this setting but not change it.</Muted>}
              </View>
            ))}
        </View>
      </Panel>

      <Panel title="Where these apply"
             subtitle="One setting, three surfaces.">
        <Muted>
          The installed application on the office PC, the browser on a laptop, and the phone app all
          read these same six values. A colour picked here is the school's colour everywhere — on a
          receipt printed in the office and on a parent's handset. The phone app that a school has
          already installed picks them up the next time it fetches the school's details.
        </Muted>
      </Panel>
    </OfficeScreen>
  );
}

function ColourField({ label, value, placeholder, onChange, disabled }) {
  const shown = isHex(value) ? value : placeholder;
  return (
    <View>
      <Field label={label} value={value ?? ''} onChangeText={disabled ? undefined : onChange}
             hint={`A hex colour, like ${placeholder}. Empty means the default.`} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <View style={[styles.swatch, { backgroundColor: shown }]} />
        <Muted>{isHex(value) ? value : `Default — ${placeholder}`}</Muted>
      </View>
    </View>
  );
}

/**
 * What the school will look like. A row of the actual chrome, drawn from the
 * derived tokens rather than from a picture of them, so nothing here can be a
 * flattering lie.
 */
function Preview({ tokens }) {
  return (
    <View style={styles.preview}>
      <View style={[styles.previewSide, { backgroundColor: tokens.primary }]}>
        <View style={[styles.previewCrest, { backgroundColor: 'rgba(255,255,255,0.16)' }]} />
        <View style={[styles.previewItem, { backgroundColor: 'rgba(255,255,255,0.16)',
                                            borderLeftColor: tokens.accent, borderLeftWidth: 3 }]} />
        <View style={styles.previewItemOff} />
        <View style={styles.previewItemOff} />
      </View>
      <View style={{ flex: 1, padding: spacing.md, gap: 8 }}>
        <Text style={{ ...type.heading, color: tokens.primary }}>Your school</Text>
        <Text style={{ ...type.small, color: tokens.accent, fontWeight: '600' }}>Your motto here</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <View style={[styles.previewBtn, { backgroundColor: tokens.primary }]}>
            <Text style={{ ...type.small, color: readableOn(tokens.primary), fontWeight: '700' }}>
              Primary action
            </Text>
          </View>
          <View style={[styles.previewBtn, { backgroundColor: tokens.accent }]}>
            <Text style={{ ...type.small, color: readableOn(tokens.accent), fontWeight: '700' }}>
              Accent
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ── Terms, classes, subjects, grading ───────────────────────────────────────

export function Terms() {
  const state = useOffice((t) => api.terms(t));
  const rows = state.data?.terms || [];
  return (
    <OfficeScreen state={state} skeleton={4}>
      <Panel padded={false} title="Terms"
             subtitle="Which term is running decides what every figure in the system is about.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="No terms have been set up."
            columns={[
              { key: 'label', label: 'Term', render: (r) => (
                <View style={{ minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>{r.label}</Text>
                  <Muted numberOfLines={1}>{r.year_label || ''}</Muted>
                </View>
              ) },
              { key: 'start_date', label: 'Starts', width: 130, render: (r) => shortDate(r.start_date) },
              { key: 'end_date', label: 'Ends', width: 130, render: (r) => shortDate(r.end_date) },
              { key: 'is_current', label: '', align: 'right', width: 120,
                render: (r) => (r.is_current ? <Badge tone="success" label="Running" /> : null) },
            ]}
            rows={rows} />
        </View>
      </Panel>
      <Panel title="Changing a term"
             subtitle="A term's dates decide the school calendar, and the calendar decides canteen arrears.">
        <Muted>
          Creating a term and moving the school into it is done on the school's own system, where the
          promotion of every pupil into their next class happens at the same time. That is one
          operation, not two, and it is not one to run from a phone on a bus.
        </Muted>
      </Panel>
    </OfficeScreen>
  );
}

export function Classes() {
  const { token } = useAuth();
  const state = useOffice((t) => api.officeClasses(t));
  const rows = state.data?.classes || [];
  return (
    <OfficeScreen state={state} skeleton={4}>
      <Panel padded={false} title="Classes"
             subtitle="Every class the school runs, in the order pupils move through them.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="No classes have been set up."
            columns={[
              { key: 'name', label: 'Class' },
              { key: 'short_code', label: 'Short code', width: 140 },
              { key: 'level_category', label: 'Level', width: 160 },
              { key: 'is_class_teacher', label: '', align: 'right', width: 150,
                render: (r) => (r.is_class_teacher ? <Badge tone="primary" label="Yours" /> : null) },
            ]}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

export function Subjects() {
  const { token } = useAuth();
  const [classId, setClassId] = useState('');
  const classes = useOffice((t) => api.officeClasses(t));
  const state = useOffice(
    (t) => (classId ? api.subjects(t, classId) : api.subjects(t)),
    [classId]);
  const rows = state.data?.subjects || [];
  return (
    <OfficeScreen state={state} skeleton={4}>
      <Bar left={<View style={{ minWidth: 240 }}>
        <Select label="Class" value={classId} onChange={setClassId} placeholder="Every class"
                options={[{ label: 'Every class', value: '' },
                          ...(classes.data?.classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
      </View>} />
      <Panel padded={false} title="Subjects"
             subtitle="What each class sits. A subject with no class attached is offered to all of them.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="No subjects have been set up."
            columns={[
              { key: 'name', label: 'Subject' },
              { key: 'short_code', label: 'Short code', width: 150 },
              { key: 'is_core', label: 'Core', align: 'right', width: 100,
                render: (r) => (r.is_core ? <Badge tone="primary" label="Core" /> : <Muted>Elective</Muted>) },
            ]}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

export function Grading() {
  return (
    <SettingsForm
      title="Grading"
      subtitle="How a class score and an exam score become one mark, and what that mark is called."
      note="Changing the weighting changes every mark already entered this term, because a total is worked out when it is read rather than stored."
      fields={[
        { key: 'class_score_weight_pct', label: 'Class score weight (%)',
          hint: 'The Ghanaian standard is 30' },
        { key: 'exam_weight_pct', label: 'Exam weight (%)',
          hint: 'The Ghanaian standard is 70' },
        { key: 'pass_mark', label: 'Pass mark (%)' },
        { key: 'current_exam_title', label: 'What this term’s exam is called',
          hint: 'Printed on the report card' },
        { key: 'attendance_required_pct', label: 'Attendance expected (%)',
          hint: 'Below this, a pupil is flagged on their report' },
      ]} />
  );
}

// ── Canteen, payroll, payments, notifications ───────────────────────────────

export function CanteenSettings() {
  return (
    <SettingsForm
      title="Canteen"
      subtitle="One rate for the whole school, charged per school day."
      note="Every arrears figure in the canteen module is this rate times the number of school days a pupil has not paid for."
      fields={[
        { key: 'canteen_daily_rate', label: 'Daily rate', hint: 'In cedis, per pupil, per school day' },
        { key: 'feature_canteen_enabled', label: 'Run a canteen at all',
          options: [{ label: 'Yes', value: 'true' }, { label: 'No — hide the module', value: 'false' }] },
      ]} />
  );
}

export function PayrollSettings() {
  return (
    <SettingsForm
      title="Payroll"
      subtitle="The statutory rates, and the school's own numbers for filing."
      note="SSNIT is 5.5% from the worker and 13% from the school by law. They are settings only because a school with an exemption needs to be able to say so."
      fields={[
        { key: 'ssnit_worker_pct', label: "Worker's SSNIT (%)" },
        { key: 'ssnit_employer_pct', label: "School's SSNIT (%)" },
        { key: 'school_ssnit_number', label: "School's SSNIT number" },
        { key: 'school_tin', label: "School's TIN" },
        { key: 'feature_ssnit_enabled', label: 'Deduct SSNIT',
          options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        { key: 'feature_paye_enabled', label: 'Deduct PAYE',
          options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
      ]} />
  );
}

export function PaymentSettings() {
  return (
    <SettingsForm
      title="Online payments"
      subtitle="Whether parents can pay through the app, and through whom."
      note="The gateway's secret key is written on the school's own system and is never read back — a secret a screen can display is a secret a screenshot can carry out of the building."
      fields={[
        { key: 'online_payments_enabled', label: 'Take payments online',
          options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        { key: 'payment_gateway', label: 'Gateway',
          options: [{ label: 'Paystack', value: 'paystack' }, { label: 'None', value: '' }] },
        { key: 'paystack_public_key', label: 'Paystack public key', wide: true },
        { key: 'online_payment_min', label: 'Smallest payment allowed' },
        { key: 'online_payment_max', label: 'Largest payment allowed' },
        { key: 'payment_currency', label: 'Currency', hint: 'GHS' },
      ]} />
  );
}

export function NotificationSettings() {
  return (
    <SettingsForm
      title="Notifications"
      subtitle="Whether the school sends messages from the system, and how."
      fields={[
        { key: 'feature_notifications_enabled', label: 'Send notices and messages',
          options: [{ label: 'Yes', value: 'true' }, { label: 'No — hide the module', value: 'false' }] },
      ]}
      note="The SMS gateway's credentials are set on the school's own system, alongside the payment gateway's, and for the same reason." />
  );
}

// ── Advanced features ───────────────────────────────────────────────────────

export function Features() {
  return (
    <SettingsForm
      title="Advanced features"
      subtitle="Which parts of the system this school runs. A module switched off is hidden everywhere — the desktop, the browser and the phone."
      note="Switching a module off hides it; it does not delete anything. Switch it back on and the records are where they were."
      fields={[
        { key: 'feature_canteen_enabled', label: 'Canteen',
          options: yesNo(), hint: 'The daily collection and its arrears' },
        { key: 'feature_notifications_enabled', label: 'Notifications',
          options: yesNo(), hint: 'Notices and SMS' },
        { key: 'feature_transport_enabled', label: 'Transport',
          options: yesNo(), hint: 'Routes, riders and transport fees' },
        { key: 'feature_leave_management_enabled', label: 'Leave management',
          options: yesNo(), hint: 'Staff leave requests and approvals' },
        { key: 'staff_clockin_enabled', label: 'Staff clock-in',
          options: [{ label: 'On', value: 'true' }, { label: 'Off', value: 'false' }],
          hint: 'Off unless the school asks for it — a register of arrival times nobody asked for is surveillance that appeared by itself' },
        { key: 'feature_ssnit_enabled', label: 'SSNIT deductions', options: yesNo() },
        { key: 'feature_paye_enabled', label: 'PAYE deductions', options: yesNo() },
      ]} />
  );
}

const yesNo = () => ([{ label: 'On', value: 'true' }, { label: 'Off', value: 'false' }]);

// ── Users ───────────────────────────────────────────────────────────────────

export function Users() {
  const { token, profile } = useAuth();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const state = useOffice((t) => api.systemUsers(t));
  const access = useOffice((t) => api.systemAccess(t));

  const users = state.data?.users || [];
  const designations = access.data?.designations || [];
  const may = can(profile, 'settings', 'edit') || isSuperAdmin(profile);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? users.filter(u => `${u.full_name || ''} ${u.username || ''} ${u.designation || ''}`
          .toLowerCase().includes(needle))
      : users;
  }, [users, q]);

  async function create() {
    setBusy(true); setError(null); setDone(null);
    try {
      await api.systemCreateUser(token, {
        username: adding.username, fullName: adding.full_name,
        password: adding.password,
        designationId: adding.designation_id ? Number(adding.designation_id) : undefined,
      });
      setDone(`${adding.username} can now sign in. They will be asked to change the password.`);
      setAdding(null);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function setStatus(user, active) {
    setBusy(true); setError(null);
    try { await api.systemUserStatus(token, user.id, active); state.reload(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function setRole() {
    setBusy(true); setError(null);
    try {
      await api.systemUserRole(token, editing.id, Number(editing.designation_id));
      setEditing(null);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {done ? <SuccessNote message={done} /> : null}

      <Bar left={<View style={{ minWidth: 260, flex: 1 }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Find an account" />
      </View>}
      right={may ? <Button title="Create an account" icon="plus" full={false}
                           onPress={() => setAdding({})} /> : null} />

      <Panel padded={false} title="Accounts"
             subtitle="Who can sign in, and what role they hold. The role decides what they can open.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="No accounts."
            columns={[
              { key: 'full_name', label: 'Person', render: (r) => (
                <View style={{ minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                    {r.full_name}
                  </Text>
                  <Muted numberOfLines={1}>{r.username}</Muted>
                </View>
              ) },
              { key: 'designation', label: 'Role', width: 190,
                render: (r) => (
                  <Text numberOfLines={1} style={{ ...type.small, color: colors.textSoft, fontWeight: '600' }}>
                    {r.designation || 'None'}
                  </Text>
                ) },
              { key: 'last_login', label: 'Last signed in', width: 150,
                render: (r) => (r.last_login ? shortDate(r.last_login) : 'Never') },
              { key: 'is_active', label: 'Status', width: 120,
                render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'}
                                      label={r.is_active ? 'Active' : 'Disabled'} /> },
              { key: 'act', label: '', align: 'right', width: 190,
                render: (r) => (may ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button size="sm" variant="outline" full={false} title="Role"
                            onPress={() => setEditing({ ...r, designation_id: r.designation_id })} />
                    <Button size="sm" variant={r.is_active ? 'ghost' : 'outline'} full={false}
                            title={r.is_active ? 'Disable' : 'Enable'} disabled={busy}
                            onPress={() => setStatus(r, !r.is_active)} />
                  </View>
                ) : null) },
            ]}
            rows={rows} />
        </View>
      </Panel>

      <Sheet visible={!!adding} onClose={() => setAdding(null)} title="Create an account">
        {adding ? (
          <>
            <Muted>They sign in with the username and are made to change the password immediately.</Muted>
            <Field label="Full name" value={adding.full_name || ''}
                   onChangeText={(v) => setAdding(a => ({ ...a, full_name: v }))} />
            <Field label="Username" value={adding.username || ''}
                   onChangeText={(v) => setAdding(a => ({ ...a, username: v }))} />
            <Field label="First password" value={adding.password || ''}
                   onChangeText={(v) => setAdding(a => ({ ...a, password: v }))}
                   hint="At least six characters. They will be asked to change it." />
            <Select label="Role" value={String(adding.designation_id || '')}
                    onChange={(v) => setAdding(a => ({ ...a, designation_id: v }))}
                    options={designations.map(d => ({ label: d.name, value: String(d.id),
                                                      note: d.description }))} />
            <Button title={busy ? 'Creating…' : 'Create the account'} busy={busy} disabled={busy}
                    onPress={create} />
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!editing} onClose={() => setEditing(null)}
             title={editing ? `${editing.full_name} — role` : ''}>
        {editing ? (
          <>
            <Muted>A role decides what this person can open. Changing it takes effect on their next request.</Muted>
            <Select label="Role" value={String(editing.designation_id || '')}
                    onChange={(v) => setEditing(e => ({ ...e, designation_id: v }))}
                    options={designations.map(d => ({ label: d.name, value: String(d.id),
                                                      note: d.description }))} />
            <Button title={busy ? 'Saving…' : 'Change the role'} busy={busy}
                    disabled={busy || !editing.designation_id} onPress={setRole} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}

// ── Roles and access ────────────────────────────────────────────────────────
//
// The ladder, one module at a time. Deliberately NOT four checkboxes per
// module: "can create but not view" is not a thing anybody means, and a grid of
// forty checkboxes is a grid nobody reads before ticking.

export function AccessControl() {
  const { token, profile } = useAuth();
  const [chosen, setChosen] = useState(null);
  const [levels, setLevels] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const state = useOffice((t) => api.systemAccess(t));
  const may = isSuperAdmin(profile) || can(profile, 'settings', 'edit');

  const d = state.data;
  const designations = d?.designations || [];
  const modules = d?.modules || [];
  const ladder = d?.levels || [];

  useEffect(() => {
    if (!chosen && designations.length) {
      const first = designations.find(x => !x.locked) || designations[0];
      setChosen(first);
      setLevels({ ...(first.levels || {}) });
    }
  }, [designations, chosen]);

  function pick(role) {
    setChosen(role); setLevels({ ...(role.levels || {}) }); setSaved(false);
  }

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api.systemSetAccess(token, chosen.id, levels);
      setSaved(true);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {saved ? <SuccessNote message="Saved. Everybody holding this role sees the change on their next request." /> : null}

      <View style={{ flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' }}>
        <View style={{ minWidth: 240, flexGrow: 1, flexBasis: 260 }}>
          <Panel padded={false} title="Roles">
            <View style={{ padding: spacing.md }}>
              {designations.map(role => (
                <CheckRow key={role.id}
                          checked={chosen && chosen.id === role.id}
                          onToggle={() => pick(role)}
                          title={role.name}
                          subtitle={role.locked
                            ? 'Held back nowhere — cannot be reduced'
                            : `${role.granted ?? 0} of ${modules.length} modules`}
                          right={role.locked ? <Badge tone="primary" label="Full" /> : null} />
              ))}
            </View>
          </Panel>
        </View>

        <View style={{ minWidth: 320, flexGrow: 2, flexBasis: 460 }}>
          {!chosen ? (
            <EmptyState icon="lock" title="Pick a role" message="Choose one on the left." />
          ) : (
            <Panel title={chosen.name}
                   subtitle={chosen.locked
                     ? 'This role runs the school and is held back nowhere. Its access cannot be reduced.'
                     : 'What somebody holding this role can do, module by module.'}
                   right={may && !chosen.locked ? (
                     <Button title={busy ? 'Saving…' : 'Save'} busy={busy} disabled={busy}
                             size="sm" full={false} icon="check" onPress={save} />
                   ) : null}>
              {modules.map(m => (
                <View key={m.key} style={styles.accessRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text }}>
                      {m.label}
                    </Text>
                    <Muted numberOfLines={2}>{m.description}</Muted>
                  </View>
                  <View style={{ width: 190 }}>
                    <Select label="" value={chosen.locked ? 'full' : (levels[m.key] || 'no')}
                            onChange={may && !chosen.locked
                              ? (v) => setLevels(l => ({ ...l, [m.key]: v })) : undefined}
                            disabled={chosen.locked || !may}
                            options={ladder.map(l => ({ label: l.label, value: l.key, note: l.description }))} />
                  </View>
                </View>
              ))}
            </Panel>
          )}
        </View>
      </View>
    </OfficeScreen>
  );
}

// ── The audit trail ─────────────────────────────────────────────────────────

export function AuditTrail() {
  const [q, setQ] = useState('');
  const state = useOffice((t) => api.systemAudit(t, { limit: 200 }));
  const rows = useMemo(() => {
    const list = state.data?.entries || state.data?.audit || [];
    const needle = q.trim().toLowerCase();
    return needle
      ? list.filter(r => `${r.action || ''} ${r.user_name || ''} ${r.details || ''} ${r.entity_type || ''}`
          .toLowerCase().includes(needle))
      : list;
  }, [state.data, q]);

  return (
    <OfficeScreen state={state} skeleton={6}>
      <Bar left={<View style={{ minWidth: 280, flex: 1 }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Find an action, a person or a record" />
      </View>}
      right={<Muted>The last 200 entries, newest first.</Muted>} />

      <Panel padded={false} title="Audit trail"
             subtitle="What was done, by whom, and what was refused. Written by the system, never edited.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(r.id ?? i)}
            empty="Nothing has been recorded."
            columns={[
              { key: 'created_at', label: 'When', width: 140,
                render: (r) => shortDate(r.created_at || r.timestamp) },
              { key: 'user_name', label: 'Who', width: 170 },
              { key: 'action', label: 'What', width: 200 },
              { key: 'details', label: 'Detail',
                render: (r) => (
                  <Text numberOfLines={2} style={{ ...type.small, color: colors.textSoft }}>
                    {r.details || r.note || '—'}
                  </Text>
                ) },
              { key: 'severity', label: '', align: 'right', width: 110,
                render: (r) => (r.severity === 'high'
                  ? <Badge tone="danger" label="High" />
                  : r.severity === 'refused' ? <Badge tone="warning" label="Refused" /> : null) },
            ]}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

const styles = {
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  cell: { minWidth: 220, flexGrow: 1, flexBasis: 240 },

  swatch: { width: 34, height: 22, borderRadius: 6, borderWidth: 1, borderColor: colors.border },

  preview: {
    flexDirection: 'row', marginTop: spacing.md, marginBottom: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', minHeight: 132, backgroundColor: colors.card,
  },
  previewSide: { width: 92, padding: 10, gap: 7 },
  previewCrest: { height: 26, borderRadius: 7 },
  previewItem: { height: 16, borderRadius: 5 },
  previewItemOff: { height: 16, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.10)' },
  previewBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm },

  accessRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
    flexWrap: 'wrap',
  },
};
