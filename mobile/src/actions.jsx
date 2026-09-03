// Nickland Edusoft — talking to the school, and printing what it holds.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Two things every screen in both portals now needs, and neither existed:
//
//   A way to reach the school. A parent who has a question, or who wants to
//   settle a balance, is handed to WhatsApp — with the child, the class and the
//   figures already written into the message — or to the phone, or to email.
//   Nothing is ever paid inside the app.
//
//   A way to print. A report card, a pupil's profile, a teacher's own record.
//   The browser app prints properly; the phone app says where to go instead of
//   offering a button that quietly does nothing.
//
// Both live here rather than in each screen so the wording, the ordering of the
// channels and the "not on a phone" message are the same everywhere.

import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useBranding } from './brand';
import { channels as channelsFor, hrefFor, open as openLink, settleMessage, generalMessage } from './contact';
import { printHtml, printFromSchool } from './print';
import { Button, IconButton, Sheet, Muted, Micro, ListRow, InfoNote, Flash, Badge, Card } from './ui';
import { useLayout } from './responsive';
import { colors, spacing, radius, shadow, type } from './theme';
import { Icon } from './icons';

// ── the chat button ─────────────────────────────────────────────────────────
/**
 * "Message the school". Opens a sheet listing every way this school can be
 * reached, because a parent with no WhatsApp still has a phone, and a school
 * that filled in only an email address should still be reachable.
 *
 * `message` is what gets pre-written into WhatsApp or the email body.
 */
export function ContactSchool({
  variant = 'subtle', size = 'md', title = 'Message the school',
  message, subject, full = false, icon = 'chat', style,
}) {
  const { school, contact } = useBranding();
  const [open, setOpen] = useState(false);
  const list = channelsFor(contact || {});

  const body = message || generalMessage({ school: school?.name });

  return (
    <>
      <Button
        variant={variant} size={size} title={title} icon={icon} full={full} style={style}
        onPress={() => setOpen(true)}
      />
      <ContactSheet
        visible={open} onClose={() => setOpen(false)}
        channels={list} school={school} message={body} subject={subject}
      />
    </>
  );
}

/** The same thing as a floating button, for a screen whose header has no room. */
export function ContactFab({ message, subject, label = 'Message school' }) {
  const layout = useLayout();
  const { school, contact } = useBranding();
  const [open, setOpen] = useState(false);
  const list = channelsFor(contact || {});
  if (!list.length) return null;
  return (
    <>
      <View style={[styles.fabWrap, { bottom: layout.isPhone ? 84 : spacing.xl }]} pointerEvents="box-none">
        <Button
          variant="gold" title={layout.isCompact ? 'Chat' : label} icon="whatsapp" full={false}
          onPress={() => setOpen(true)} style={[styles.fab, shadow.floating]}
        />
      </View>
      <ContactSheet
        visible={open} onClose={() => setOpen(false)}
        channels={list} school={school}
        message={message || generalMessage({ school: school?.name })} subject={subject}
      />
    </>
  );
}

export function ContactSheet({ visible, onClose, channels, school, message, subject, note }) {
  const list = channels || [];
  return (
    <Sheet visible={visible} onClose={onClose} title={school?.name ? `Contact ${school.name}` : 'Contact the school'} width={480}>
      {note ? <InfoNote message={note} /> : null}
      {list.length === 0 ? (
        <Muted>
          The school has not recorded a phone number or an email address yet. Ask at the
          office and they can add one in Settings → School identity.
        </Muted>
      ) : list.map(c => (
        <ListRow
          key={c.key}
          icon={c.key === 'whatsapp' ? 'whatsapp' : c.icon}
          iconTone={c.key === 'whatsapp' ? 'success' : c.key === 'email' ? 'info' : 'primary'}
          title={c.label}
          subtitle={c.value}
          right={<Icon name="chevron" size={15} color={colors.faint} />}
          onPress={() => { openLink(hrefFor(c, { subject, message })); onClose && onClose(); }}
        />
      ))}
      {message ? (
        <View style={{ marginTop: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
          <Micro>What will be sent</Micro>
          <Text style={{ ...type.small, color: colors.textSoft, marginTop: 4 }}>{message}</Text>
        </View>
      ) : null}
    </Sheet>
  );
}

// ── settling a balance ──────────────────────────────────────────────────────
/**
 * The button a parent presses when they owe something. It does not take money
 * and does not pretend to: it opens the school's WhatsApp with the child's
 * name, class and outstanding figures already written out, so the office can
 * answer in one message instead of three.
 */
export function SettleBalance({ child, owed, term, parentName, variant = 'primary', full = true, size = 'md' }) {
  const { school, contact } = useBranding();
  const [open, setOpen] = useState(false);
  const list = channelsFor(contact || {});
  const total = (owed?.fees || 0) + (owed?.canteen || 0);
  if (total <= 0) return null;

  const message = settleMessage({
    school: school?.name, child, owed, term,
    parent: parentName ? `— ${parentName}` : null,
  });

  return (
    <>
      <Button
        variant={variant} size={size} full={full} icon="whatsapp"
        title="Settle this balance"
        onPress={() => setOpen(true)}
      />
      <ContactSheet
        visible={open} onClose={() => setOpen(false)}
        channels={list} school={school} message={message}
        subject={`Payment for ${child?.name || 'my child'}`}
        note="No payment is taken in the app. Choose how to reach the school and the office will confirm the amount and how to pay it."
      />
    </>
  );
}

// ── printing ────────────────────────────────────────────────────────────────
/**
 * `build` returns the HTML for the document. It is a function rather than a
 * string so a screen holding a large report does not rebuild the whole document
 * on every render of a button nobody has pressed.
 */
export function PrintButton({
  build, fetch: fetchDoc, title = 'Print', variant = 'outline', size = 'sm',
  full = false, icon = 'print', disabled,
}) {
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setNote(null);
    setBusy(true);
    try {
      // The school's own document — fetched from the desktop's report generator
      // so what comes out of the printer here is what comes out of the printer
      // in the office. It costs a round trip, hence the busy state.
      const r = fetchDoc
        ? await printFromSchool(fetchDoc)
        : await printHtml(typeof build === 'function' ? build() : build);
      if (!r.ok) setNote(r.error);
    } catch (e) {
      setNote((e && e.message) || 'Could not print that.');
    } finally { setBusy(false); }
  }

  // A print that failed says so under the button that failed, not in a modal
  // over the whole screen.
  return (
    <View>
      <Button
        variant={variant} size={size} title={busy ? 'Preparing…' : title} icon={icon}
        full={full} disabled={disabled} busy={busy} onPress={go}
      />
      <Flash error={note} style={{ marginTop: 8, marginBottom: 0 }} />
    </View>
  );
}

const styles = {
  fabWrap: { position: 'absolute', right: spacing.lg, alignItems: 'flex-end' },
  fab: { paddingVertical: 13, paddingHorizontal: 18, borderRadius: radius.md },
};

export default { ContactSchool, ContactFab, ContactSheet, SettleBalance, PrintButton };
