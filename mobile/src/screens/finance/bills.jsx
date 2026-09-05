// Bills — what a class is charged, and raising them.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A fee template is the school's price list for a class and a term. Raising a
// bill applies it, carries forward what is unpaid from previous terms, and
// applies any discount the owner granted — which is why a bill is generated
// rather than typed.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { OfficeScreen, cedis, termLabel, useOffice } from '../../office';
import {
  Card, Section, Muted, Button, Sheet, Field, Select, ErrorNote, InfoNote,
  EmptyState, ListRow, SearchField, Badge,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

export default function Bills() {
  const { token, profile } = useAuth();
  const router = useRouter();
  // `api.school` is not a thing — `school` is a separate export, the online
  // school's client, and reaching for it through `api` was a TypeError that
  // took this whole tab down with "Cannot read properties of undefined".
  // `api.feeTemplates` is the dispatching method and works in all three modes.
  const state = useOffice((t) => api.feeTemplates(t).catch(() => ({ ok: true, templates: [] })));
  // The OFFICE's classes, not the caller's teaching assignments: a bursar
  // raising a class's bills has no assignments and got an empty picker.
  const classes = useOffice((t) => api.officeClasses(t));

  const [raising, setRaising] = useState(false);
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);

  const mayRaise = can(profile, 'fees', 'create');

  async function search(text) {
    setQ(text);
    if (text.trim().length < 2) { setFound(null); return; }
    try { setFound((await api.financeStudents(token, { q: text.trim() })).students || []); }
    catch (e) { setError(e.message); }
  }

  async function raise() {
    setError(null);
    if (!classId) return setError('Choose the class.');
    setBusy(true);
    try {
      const r = await api.raiseBills(token, { classId: Number(classId) });
      // What actually happened, in the school's own words. A count of
      // failures is not an answer — "3 could not be" leaves an office
      // guessing between a missing template and a withdrawn bill — so the
      // reasons the server counted are read out.
      const n = Number(r.generated) || 0;
      const problems = r.problems || r.failed || [];
      setResult(`${n} bill${n === 1 ? '' : 's'} raised.`
        + (r.skipped ? ` ${r.skipped} left alone.` : '')
        + (problems.length ? ` ${problems.map(x => `${x.count}: ${x.reason}`).join(' ')}` : ''));
      setRaising(false);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const d = state.data;

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {result ? (
        <Card tone="success">
          <Text style={{ ...type.body, fontWeight: '700' }}>{result}</Text>
          <Button label="Done" tone="ghost" size="sm" onPress={() => setResult(null)} />
        </Card>
      ) : null}

      <Section title="A pupil's account" icon="search"
        subtitle="The bill line by line, and every receipt against it.">
        <Card>
          <SearchField value={q} onChangeText={search} placeholder="Surname, first name or admission number" />
          {(found || []).slice(0, 10).map((s, i) => (
            <ListRow key={s.id} title={s.name}
              subtitle={`${s.class_name || ''} · ${s.index_number || ''}`}
              right={<Text style={{ ...type.small, fontWeight: '700',
                                    color: s.balance > 0 ? colors.danger : colors.muted }}>
                {s.balance > 0 ? cedis(s.balance) : 'Settled'}</Text>}
              onPress={() => router.push(`/app/fees/${s.id}`)}
              last={i === Math.min(9, (found || []).length - 1)} />
          ))}
          {found && found.length === 0 ? <Muted>Nobody matches that.</Muted> : null}
        </Card>
      </Section>

      {mayRaise ? (
        <Card>
          <Button label="Raise a class's bills" icon="layers" onPress={() => { setError(null); setRaising(true); }} />
          <Muted style={{ marginTop: 6 }}>
            Applies the class's template, carries forward what is unpaid from previous terms, and
            applies any discount. Re-raising never discards money already received.
          </Muted>
        </Card>
      ) : null}

      <Section title="Fee templates" icon="book" subtitle="What each class is charged.">
        {(d?.templates || []).length === 0 ? (
          <Card><EmptyState icon="book" title="No templates yet"
            message="A bill is generated from a template. The school's own system sets them up." /></Card>
        ) : (
          <Card padded={false}>
            {d.templates.map((t, i) => (
              <ListRow key={t.id} title={t.name}
                subtitle={[t.class_name || 'Every class', termLabel(t, 'Every term'),
                           `${t.items} line${t.items === 1 ? '' : 's'}`].join(' · ')}
                right={<Text style={{ ...type.small, fontWeight: '800',
                                      fontVariant: ['tabular-nums'] }}>{cedis(t.total)}</Text>}
                last={i === d.templates.length - 1} />
            ))}
          </Card>
        )}
      </Section>

      <Sheet visible={raising} onClose={() => setRaising(false)} title="Raise a class's bills">
        <ErrorNote message={error} />
        <Select label="Class" value={classId} onChange={setClassId}
          options={(classes.data?.classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
        <Muted>
          Every active pupil in the class gets a bill. One pupil with no applicable template does
          not stop the rest.
        </Muted>
        <Button label={busy ? 'Raising…' : 'Raise them'} disabled={busy} onPress={raise} icon="check" />
      </Sheet>
    </OfficeScreen>
  );
}
