// Notices — the one thing the office writes that everybody outside it reads.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { OfficeScreen, shortDate, useOffice } from '../../office';
import {
  Card, Section, Muted, Button, Sheet, Field, TextArea, ErrorNote, EmptyState, Badge, InfoNote,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

export default function Notices() {
  const { token, profile } = useAuth();
  const state = useOffice((t) => api.announcements(t));

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const mayPost = can(profile, 'notifications', 'edit') || can(profile, 'notifications', 'create');
  const d = state.data;

  async function post() {
    setError(null);
    if (!title.trim() || !body.trim()) return setError('A notice needs a title and something to say.');
    setBusy(true);
    try {
      // `api.postAnnouncement` dispatches on the connection mode itself, so
      // there is nothing for this screen to decide. It used to pick between
      // `api.school.postAnnouncement` and this one, and `api.school` is not a
      // thing — the online branch was a TypeError waiting for somebody to
      // post a notice from the internet.
      await api.postAnnouncement(token, { title: title.trim(), body: body.trim(), audience: 'all' });
      setOpen(false); setTitle(''); setBody('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={4}>
      <ErrorNote message={error} />
      {mayPost ? (
        <Card>
          <Button label="Post a notice" icon="plus" onPress={() => { setError(null); setOpen(true); }} />
          <Muted style={{ marginTop: 6 }}>
            Every parent's app and every teacher's shows it. Write it as they will read it.
          </Muted>
        </Card>
      ) : (
        <InfoNote message="This account can read the school's notices but not post one." />
      )}

      {d ? (
        (d.announcements || []).length === 0 ? (
          <Card><EmptyState icon="bell" title="No notices"
            message="Nothing has been posted to parents or staff." /></Card>
        ) : (
          <Section title="Notices" icon="bell" subtitle="Newest first.">
            {d.announcements.map((a) => (
              <Card key={a.id}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ ...type.body, fontWeight: '800', color: colors.text }}>{a.title}</Text>
                    <Text style={{ ...type.small, color: colors.textSoft, marginTop: 4 }}>{a.body}</Text>
                    <Muted style={{ marginTop: 6 }}>
                      {[a.created_by_name, shortDate(a.created_at)].filter(Boolean).join(' · ')}
                    </Muted>
                  </View>
                  <Badge label={a.audience === 'student' ? (a.student_name || 'One pupil') : 'Everybody'}
                    tone={a.audience === 'student' ? 'data' : 'primary'} />
                </View>
              </Card>
            ))}
          </Section>
        )
      ) : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Post a notice">
        <ErrorNote message={error} />
        <Field label="Title" value={title} onChangeText={setTitle}
          hint="What it is about, in a few words." />
        <TextArea label="The notice" value={body} onChangeText={setBody}
          hint="Parents read this on a phone, at the gate. Short sentences." />
        <Button label={busy ? 'Posting…' : 'Post it'} disabled={busy} onPress={post} icon="check" />
      </Sheet>
    </OfficeScreen>
  );
}
