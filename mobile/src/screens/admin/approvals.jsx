// What is waiting on somebody.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Leave and lesson notes. Both are decisions with a person on the other end of
// them, so a rejection asks for a reason and the reason travels with it.
//
// Neither can be decided by the person who raised it. That is not a formality:
// approving your own leave is not a decision, it is a holiday.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { OfficeScreen, shortDate, useOffice } from '../../office';
import {
  Card, Section, Muted, Button, Sheet, Field, ErrorNote, EmptyState, Badge, InfoNote,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

export default function Approvals() {
  const { token } = useAuth();
  const state = useOffice((t) => api.adminApprovals(t));
  const [acting, setActing] = useState(null);   // { kind, row, decision }
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const d = state.data;

  async function decide() {
    setError(null);
    if (acting.decision === 'rejected' && notes.trim().length < 3) {
      return setError('Say why — the person is told.');
    }
    setBusy(true);
    try {
      if (acting.kind === 'leave') {
        await api.adminDecideLeave(token, acting.row.id, acting.decision, notes.trim() || undefined);
      } else {
        await api.adminDecideNote(token, acting.row.id, acting.decision, notes.trim() || undefined);
      }
      setActing(null); setNotes('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const leave = d?.leave || d?.requests || [];
  const notesList = d?.lesson_notes || d?.notes || [];
  const mayLeave = d?.may_decide?.leave ?? d?.may_decide ?? true;
  const mayNotes = d?.may_decide?.lesson_notes ?? d?.may_decide ?? true;

  return (
    <OfficeScreen state={state} skeleton={4}>
      <ErrorNote message={error} />
      {d ? (
        <>
          {leave.length === 0 && notesList.length === 0 ? (
            <Card><EmptyState icon="check" title="Nothing waiting"
              message="Every leave request and lesson note has been dealt with." /></Card>
          ) : null}

          {leave.length ? (
            <Section title="Leave" icon="badge" subtitle="Somebody wants time off.">
              {leave.map((r) => (
                <Card key={r.id}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ ...type.body, fontWeight: '800', color: colors.text }}>
                        {r.staff_name}
                      </Text>
                      <Muted numberOfLines={1}>{[r.staff_number, r.role].filter(Boolean).join(' · ')}</Muted>
                      <Text style={{ ...type.small, color: colors.textSoft, marginTop: 6 }}>
                        {`${r.leave_type} · ${shortDate(r.start_date)} to ${shortDate(r.end_date)}`}
                      </Text>
                      <Muted numberOfLines={3}>{r.justification}</Muted>
                    </View>
                    <Badge label={`${r.days_requested} day${r.days_requested === 1 ? '' : 's'}`} tone="data" />
                  </View>
                  {mayLeave ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                      <Button label="Approve" size="sm" icon="check"
                        onPress={() => { setError(null); setNotes(''); setActing({ kind: 'leave', row: r, decision: 'approved' }); }} />
                      <Button label="Reject" size="sm" tone="ghost"
                        onPress={() => { setError(null); setNotes(''); setActing({ kind: 'leave', row: r, decision: 'rejected' }); }} />
                    </View>
                  ) : null}
                </Card>
              ))}
            </Section>
          ) : null}

          {notesList.length ? (
            <Section title="Lesson notes" icon="note" subtitle="Submitted for sign-off.">
              {notesList.map((n) => (
                <Card key={n.id}>
                  <Text numberOfLines={2} style={{ ...type.body, fontWeight: '800', color: colors.text }}>
                    {n.title || n.topic}
                  </Text>
                  <Muted numberOfLines={1}>
                    {[n.teacher_name, n.class_name, n.subject_name,
                      n.week_number ? `Week ${n.week_number}` : null].filter(Boolean).join(' · ')}
                  </Muted>
                  {mayNotes ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                      <Button label="Approve" size="sm" icon="check"
                        onPress={() => { setError(null); setNotes(''); setActing({ kind: 'note', row: n, decision: 'approved' }); }} />
                      <Button label="Send back" size="sm" tone="ghost"
                        onPress={() => { setError(null); setNotes(''); setActing({ kind: 'note', row: n, decision: 'rejected' }); }} />
                    </View>
                  ) : null}
                </Card>
              ))}
            </Section>
          ) : null}

          {!mayLeave && !mayNotes ? (
            <InfoNote message="This account can see what is waiting but not decide it." />
          ) : null}
        </>
      ) : null}

      <Sheet visible={!!acting} onClose={() => setActing(null)}
        title={acting?.decision === 'approved' ? 'Approve it' : 'Send it back'}>
        <ErrorNote message={error} />
        {acting ? (
          <>
            <Muted>
              {acting.decision === 'approved'
                ? 'A note is optional; they will see it either way.'
                : 'Say why. They see the reason, so write it for them.'}
            </Muted>
            <Field label={acting.decision === 'approved' ? 'Note' : 'Why'} value={notes}
              onChangeText={setNotes} />
            <Button
              label={busy ? 'Saving…' : (acting.decision === 'approved' ? 'Approve' : 'Send it back')}
              tone={acting.decision === 'approved' ? 'primary' : 'danger'}
              disabled={busy} onPress={decide} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}
