// Notifications — reaching parents and staff.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Two different things, deliberately kept apart:
//
//   A NOTICE goes on the app. Every parent and every member of staff sees it
//   next time they open it, it costs nothing, and it can be withdrawn.
//   An SMS goes to a telephone. It costs money per message, it reaches the
//   people who never open the app, and it cannot be recalled.
//
// The desktop makes the same distinction and so does this. The compose screen
// asks which one you mean before it asks anything else, because sending four
// hundred text messages when you meant to post a notice is a mistake worth
// designing against.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useOfficeClasses } from '../../pickers';
import { OfficeScreen, shortDate, useOffice } from '../../office';
import {
  Select, DataTable, Muted, Badge, EmptyState, ErrorNote, SuccessNote, Button,
  Field, TextArea, SegmentedControl, Sheet, ChoiceRow, InfoNote, WarningNote,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { colors, spacing, type } from '../../theme';

// ── Compose ─────────────────────────────────────────────────────────────────

export function Compose() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const [channel, setChannel] = useState('notice');
  const [audience, setAudience] = useState('parents');
  const [classId, setClassId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const may = can(profile, 'notifications', 'create');

  if (!may) {
    return <EmptyState icon="lock" title="Sending is not yours"
                       message="You can read the school's notices but not post one." />;
  }

  async function send() {
    setBusy(true); setError(null); setDone(null);
    try {
      if (channel === 'notice') {
        await api.postAnnouncement(token, {
          title: title.trim(), body: body.trim(),
          audience, classId: classId ? Number(classId) : undefined,
        });
        setDone('Posted. Every parent and every member of staff it is for sees it now.');
      } else {
        const r = await api.sendNotification(token, {
          channel: 'sms', audience, classId: classId ? Number(classId) : undefined,
          message: body.trim(), subject: title.trim() || undefined,
        });
        setDone(`Sent to ${r.sent ?? r.count ?? 'the'} recipient${(r.sent ?? 0) === 1 ? '' : 's'}.`);
      }
      setTitle(''); setBody('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const characters = body.trim().length;
  const messages = Math.max(1, Math.ceil(characters / 160));

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorNote message={error} />
      {done ? <SuccessNote message={done} /> : null}

      <Panel title="What kind of message" subtitle="The two behave very differently. Choose first.">
        <ChoiceRow selected={channel === 'notice'} onSelect={() => setChannel('notice')}
                   title="A notice in the app"
                   subtitle="Free, reaches everybody who opens the app, and can be withdrawn." />
        <ChoiceRow selected={channel === 'sms'} onSelect={() => setChannel('sms')}
                   title="A text message"
                   subtitle="Costs money per message, reaches every phone, and cannot be recalled." />
      </Panel>

      <Panel title="Who it goes to">
        <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
          <View style={{ minWidth: 300 }}>
            <SegmentedControl value={audience} onChange={setAudience}
                              options={[{ label: 'Parents', value: 'parents' },
                                        { label: 'Staff', value: 'staff' },
                                        { label: 'Everybody', value: 'all' }]} />
          </View>
          {audience !== 'staff' ? (
            <View style={{ minWidth: 220, flex: 1 }}>
              <Select label="Class" value={classId} onChange={setClassId}
                      placeholder="The whole school"
                      options={[{ label: 'The whole school', value: '' },
                                ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
            </View>
          ) : null}
        </View>
      </Panel>

      <Panel title="The message">
        {channel === 'notice' ? (
          <Field label="Heading" value={title} onChangeText={setTitle}
                 hint="What it is about, in a few words" />
        ) : null}
        <TextArea label={channel === 'notice' ? 'The notice' : 'The text'}
                  value={body} onChangeText={setBody}
                  hint={channel === 'sms'
                    ? 'Keep it short — a text is charged in 160-character parts.'
                    : 'Parents read this in the app, so it can be as long as it needs to be.'} />
        {channel === 'sms' ? (
          <WarningNote message={`${characters} characters — ${messages} message part${messages === 1 ? '' : 's'} per recipient. A text cannot be recalled once it is sent.`} />
        ) : (
          <InfoNote message="A notice can be withdrawn afterwards under Notices." />
        )}
        <Button title={busy ? 'Sending…' : channel === 'notice' ? 'Post the notice' : 'Send the text'}
                busy={busy} disabled={busy || !body.trim() || (channel === 'notice' && !title.trim())}
                variant={channel === 'sms' ? 'gold' : 'primary'}
                icon="send" onPress={send} />
      </Panel>
    </View>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

export function NotificationHistory() {
  const state = useOffice((t) => api.notificationLog(t));
  const rows = state.data?.notifications || state.data?.log || [];
  const delivered = rows.filter(r => r.delivery_status === 'sent' || r.delivery_status === 'delivered').length;
  const cost = rows.reduce((n, r) => n + (Number(r.cost) || 0), 0);

  return (
    <OfficeScreen state={state} skeleton={5}>
      <StatRow>
        <Stat index={0} label="Messages sent" icon="send" tone="primary" value={rows.length}
              note="Everything the school has despatched" />
        <Stat index={1} label="Delivered" icon="check"
              tone={delivered === rows.length ? 'success' : 'warning'}
              value={`${delivered} of ${rows.length}`}
              note={delivered === rows.length ? 'All confirmed' : 'Some are pending or failed' } />
        <Stat index={2} label="Spent on SMS" icon="wallet" tone="data"
              value={cost ? `GHS ${cost.toFixed(2)}` : '—'}
              note="What the gateway charged" />
      </StatRow>

      <Panel padded={false} title="What has been sent"
             subtitle="Every message, to whom, and whether it arrived. A record of what the school told people.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(r.id ?? i)}
            empty="Nothing has been sent yet."
            columns={[
              { key: 'sent_at', label: 'When', width: 120, render: (r) => shortDate(r.sent_at) },
              { key: 'channel', label: 'How', width: 100,
                render: (r) => <Badge tone={r.channel === 'sms' ? 'warning' : 'primary'}
                                      label={String(r.channel || '').toUpperCase()} /> },
              { key: 'recipient_name', label: 'To',
                render: (r) => r.recipient_name || r.recipient_contact || '—' },
              { key: 'message_body', label: 'Message',
                render: (r) => (
                  <Text numberOfLines={2} style={{ ...type.small, color: colors.textSoft }}>
                    {r.message_body}
                  </Text>
                ) },
              { key: 'delivery_status', label: 'Status', align: 'right', width: 130,
                render: (r) => <Badge
                  tone={r.delivery_status === 'failed' ? 'danger'
                        : r.delivery_status === 'pending' ? 'warning' : 'success'}
                  label={r.delivery_status || 'sent'} /> },
            ]}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}
