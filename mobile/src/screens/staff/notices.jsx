// Notices — what the school is telling parents, and posting one.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Reading is open to anyone with the notifications module; posting needs the
// right to edit it, which is how the desktop has always had it. The form is
// hidden rather than shown-and-refused for an account that cannot post.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useAuth } from '../../auth';
import { RequireModule } from '../../guard';
import { api } from '../../api';
import {
  Screen, Card, Section, Muted, Micro, Button, Badge, Sheet, Field, TextArea,
  Flash, Skeleton, EmptyState, Fab, Grid, StatCard, PendingBadge,
} from '../../ui';
import { useLayout } from '../../responsive';
import { colors, spacing, type } from '../../theme';

function stamp(v) {
  if (!v) return '';
  const d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d) ? String(v).slice(0, 10) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function NoticesScreen() {
  const { token, mode, profile } = useAuth();
  const layout = useLayout();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.announcements(token); setRows(r.announcements || []); }
    catch (e) { setError(e.message); setRows([]); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function post() {
    if (!form.title.trim() || !form.body.trim()) { setError('A notice needs a title and a message.'); return; }
    setSaving(true); setError(null); setSaved(null);
    try {
      await api.postAnnouncement(token, { title: form.title.trim(), body: form.body.trim(), audience: 'all' });
      setForm({ title: '', body: '' });
      setComposing(false);
      setSaved(mode === 'cloud'
        ? 'Notice saved and queued — it reaches parents when the school next syncs.'
        : 'Notice posted. Parents see it in the app and on the portal.');
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const canPost = profile?.is_admin || profile?.permissions?.notifications?.canEdit;

  return (
    <Screen variant="reading" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Flash success={saved} onClear={() => setSaved(null)} />

      {rows === null ? <Card><Skeleton rows={4} height={78} /></Card> : (
        <>
          <Grid min={150}>
            <StatCard label="Active notices" value={rows.length} icon="bell" />
          </Grid>

          <Section
            title="School notices" icon="bell"
            subtitle="What parents see in the app and on the portal."
            action={canPost && !layout.isPhone
              ? <Button size="sm" title="Post a notice" icon="plus" onPress={() => setComposing(true)} full={false} />
              : null}
          >
            {rows.length === 0 ? (
              <EmptyState
                icon="bell" title="No notices" message="Nothing has been posted to parents."
                action={canPost ? <Button title="Post a notice" icon="plus" onPress={() => setComposing(true)} full={false} /> : null}
              />
            ) : rows.map((a, i) => (
              <View key={a.id ?? `queued-${i}`} style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ ...type.heading, color: colors.text, flex: 1 }}>{a.title}</Text>
                  {a.pending ? <PendingBadge /> : null}
                  {a.audience === 'student' ? <Badge tone="info" label={a.student_name || 'One pupil'} /> : <Badge tone="neutral" label="Everyone" />}
                </View>
                <Text style={{ ...type.body, color: colors.textSoft, marginTop: 6 }}>{a.body}</Text>
                <Muted style={{ marginTop: 6 }}>
                  {[a.created_by_name, stamp(a.created_at)].filter(Boolean).join(' · ')}
                </Muted>
              </View>
            ))}
          </Section>
        </>
      )}

      {canPost ? <Fab label="Post" onPress={() => setComposing(true)} /> : null}

      <Sheet
        visible={composing} onClose={() => setComposing(false)} title="Post a notice"
        footer={<>
          <Button variant="outline" title="Cancel" onPress={() => setComposing(false)} full={false} />
          <Button title={saving ? 'Posting…' : 'Post to parents'} onPress={post} busy={saving} full={false} />
        </>}
      >
        <Muted>Every parent with the app or the portal sees this.</Muted>
        <Field label="Title" value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))}
          placeholder="e.g. Mid-term break" autoCapitalize="sentences" />
        <TextArea label="Message" value={form.body} onChangeText={v => setForm(f => ({ ...f, body: v }))}
          numberOfLines={6} placeholder="What parents need to know" />
        <Flash error={error} style={{ marginTop: spacing.sm, marginBottom: 0 }} />
      </Sheet>
    </Screen>
  );
}

export default function Notices() {
  return (
    <RequireModule modules={[['notifications', 'view']]}>
      <NoticesScreen />
    </RequireModule>
  );
}
