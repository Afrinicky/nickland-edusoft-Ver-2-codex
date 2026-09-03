// Access levels — who may do what, as a ladder rather than four ticks.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   No access → View → Contribute → Manage → Full
//
// Each rung builds on the one below it, which is how a school owner actually
// thinks about this. "Does an Accountant need create AND edit AND delete on
// finance?" is not a question anybody should have to answer with four
// checkboxes.
//
// Changing a level takes effect on the holder's very next request — no signing
// out, no waiting. And the Proprietor and the Administrator cannot be weakened
// from here at all: an account that can lock the school out of its own system
// is a support call nobody enjoys.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { OfficeScreen, useOffice } from '../../src/office';
import {
  Card, Section, Muted, Badge, Button, Sheet, ErrorNote, EmptyState, ListRow,
  SegmentedControl, InfoNote, Micro,
} from '../../src/ui';
import { colors, spacing, radius, type } from '../../src/theme';

const TONE = { no: 'neutral', view: 'data', contribute: 'primary', manage: 'warning', full: 'success' };

export default function Access() {
  const { token } = useAuth();
  const state = useOffice((t) => api.systemAccess(t));
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const d = state.data;
  const role = open ? (d.designations || []).find(x => x.id === open.id) : null;

  async function setLevel(module, level) {
    setError(null);
    setBusy(true);
    try {
      await api.systemSetAccess(token, role.id, { [module]: level });
      await state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {d ? (
        <>
          <Card>
            <Micro>The ladder</Micro>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {(d.levels || []).map(l => (
                <Badge key={l.key} label={l.label} tone={TONE[l.key]} />
              ))}
            </View>
            <Muted style={{ marginTop: 8 }}>
              Each builds on the one before it. Nothing here grants a portal — a portal is what an
              account can already do, drawn as a place to go.
            </Muted>
          </Card>

          <Section title="Roles" icon="gear" subtitle="Tap one to change what it may do.">
            <Card padded={false}>
              {(d.designations || []).map((x, i, arr) => {
                const granted = Object.values(x.levels || {}).filter(v => v && v !== 'no').length;
                return (
                  <ListRow key={x.id}
                    title={x.name}
                    subtitle={x.locked
                      ? 'Always full access — change the person’s role instead'
                      : `${granted} of ${(d.modules || []).length} areas granted`}
                    right={x.locked ? <Badge label="Locked" tone="success" /> : null}
                    onPress={x.locked ? undefined : () => { setError(null); setOpen(x); }}
                    last={i === arr.length - 1} />
                );
              })}
            </Card>
          </Section>

          <InfoNote message="A change takes effect on that person's very next tap. Nobody has to sign out." />
        </>
      ) : null}

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={role ? role.name : 'Role'}>
        <ErrorNote message={error} />
        {role ? (
          <>
            {role.description ? <Muted>{role.description}</Muted> : null}
            {(d.modules || []).map((m) => (
              <View key={m.key} style={{ marginTop: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ ...type.small, fontWeight: '800', color: colors.text }}>{m.label}</Text>
                  {m.sensitive ? <Badge label="Sensitive" tone="warning" /> : null}
                </View>
                <Muted>{m.description}</Muted>
                <SegmentedControl
                  value={role.levels?.[m.key] || 'no'}
                  onChange={(v) => setLevel(m.key, v)}
                  options={(d.levels || []).map(l => ({ label: l.short, value: l.key }))} />
              </View>
            ))}
            {busy ? <Muted style={{ marginTop: spacing.sm }}>Saving…</Muted> : null}
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}
