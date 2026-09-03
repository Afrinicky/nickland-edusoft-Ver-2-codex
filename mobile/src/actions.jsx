// Nickland Edusoft — talking to the school, and printing what it holds.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Two things every screen in both portals now needs, and neither existed:
//
//   A way to reach the school. A parent who has a question is handed to
//   WhatsApp — with the child, the class and the figures already written into
//   the message — or to the phone, or to email.
//
//   A way to settle a balance. Where the school has switched a gateway on, the
//   parent pays on the gateway's own page and the school is told by the
//   gateway, not by the phone. Where it has not, they are handed to the office
//   the way they always were — and either way they can say what they already
//   paid at the bank, which is a message and not a payment.
//
//   A way to print. A report card, a pupil's profile, a teacher's own record.
//   The browser app prints properly; the phone app says where to go instead of
//   offering a button that quietly does nothing.
//
// Both live here rather than in each screen so the wording, the ordering of the
// channels and the "not on a phone" message are the same everywhere.

import React, { useState } from 'react';
import { View, Text, Linking } from 'react-native';
import { useBranding } from './brand';
import { useAuth } from './auth';
import { api, money } from './api';
import { channels as channelsFor, hrefFor, open as openLink, settleMessage, generalMessage } from './contact';
import { printHtml, printFromSchool } from './print';
import {
  Button, IconButton, Sheet, Muted, Micro, ListRow, InfoNote, Flash, Badge, Card,
  Field, ErrorNote,
} from './ui';
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
 * The button a parent presses when they owe something.
 *
 * It asks the school what it can offer before it offers anything, because the
 * answer differs per school and per connection:
 *
 *   • A gateway is configured and switched on → pay now. The parent goes to
 *     the gateway's own page; the school is told by the GATEWAY when the money
 *     arrives, not by the phone when the button was pressed. Closing the tab
 *     costs nothing.
 *   • Paid at the bank already → tell the office. That is a message with a
 *     reference on it and it changes no figure until somebody in the office
 *     finds it on the school's statement.
 *   • Neither → the school's own channels, with the child, the class and the
 *     figures already written into the message.
 */
export function SettleBalance({ child, owed, term, parentName, variant = 'primary', full = true, size = 'md' }) {
  const { school, contact } = useBranding();
  const { token, mode } = useAuth();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(null);
  const [stage, setStage] = useState('choose');   // choose | pay | declare | waiting | done
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const list = channelsFor(contact || {});
  const total = (owed?.fees || 0) + (owed?.canteen || 0);
  if (total <= 0) return null;

  const message = settleMessage({
    school: school?.name, child, owed, term,
    parent: parentName ? `— ${parentName}` : null,
  });

  // Asked when the sheet opens, not on every render of a screen: whether this
  // school takes payment in the app at all is a question about the school, and
  // a school with no gateway still has a bursar and a WhatsApp number.
  async function start() {
    setError(null); setStage('choose'); setOpen(true);
    setAmount(String(owed?.fees || total));
    try { setOptions(await api.paymentOptions(token, child?.id)); }
    catch (_) { setOptions({ online: { available: false }, offline: { declare: false } }); }
  }

  async function pay() {
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) return setError('Enter an amount.');
    setBusy(true);
    try {
      const r = await api.startPayment(token, child.id, value);
      // The gateway's own page. Everything about the card or the wallet
      // happens there, on their certificate, and this app never sees it.
      await Linking.openURL(r.authorization_url);
      setStage('waiting');
      setReference(r.reference);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  // After the gateway, ask OUR server what actually settled — it asks the
  // gateway. A phone that never comes back costs nothing either: the webhook
  // settles it regardless, and this only ever reports what already is.
  async function check() {
    setError(null); setBusy(true);
    try {
      const r = await api.paymentStatus(token, reference);
      const p = r.payment || {};
      if (p.receipt_number) { setNote(`Received. Receipt ${p.receipt_number}.`); setStage('done'); }
      else if (p.status === 'acknowledged' || p.status === 'paid') {
        setNote('Received. The receipt follows shortly.'); setStage('done');
      } else setError('The gateway has not confirmed it yet. Give it a moment and check again.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function declare() {
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) return setError('Enter the amount you paid.');
    if (!reference.trim()) return setError('Enter the reference on the slip, so the office can find it.');
    setBusy(true);
    try {
      const r = await api.declarePayment(token, child.id, {
        amount: value, channel: 'bank', reference: reference.trim(),
      });
      setNote(r.message || 'The office has it.');
      setStage('done');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const canPayOnline = !!options?.online?.available;
  const canDeclare = !!options?.offline?.declare;

  return (
    <>
      <Button
        variant={variant} size={size} full={full}
        icon={canPayOnline ? 'wallet' : 'whatsapp'}
        title="Settle this balance"
        onPress={start}
      />

      <Sheet visible={open} onClose={() => setOpen(false)} title="Settle this balance">
        {error ? <ErrorNote message={error} /> : null}
        {note ? <Card tone="success"><Text style={{ ...type.body, fontWeight: '700' }}>{note}</Text></Card> : null}

        {stage === 'choose' ? (
          <>
            <Card tone="primary">
              <Muted>{child?.name}</Muted>
              <Text style={{ ...type.title, color: colors.text, fontSize: 22 }}>
                {money(total)}
              </Text>
              <Muted>{term?.label || 'This term'}</Muted>
            </Card>

            {canPayOnline ? (
              <Button title="Pay now" icon="wallet" full onPress={() => setStage('pay')} />
            ) : null}
            {canDeclare ? (
              <Button title="I have already paid at the bank" variant="outline" full
                onPress={() => { setReference(''); setStage('declare'); }} />
            ) : null}
            {list.length ? (
              <Button title="Message the school" variant="outline" icon="whatsapp" full
                onPress={() => setStage('contact')} />
            ) : null}
            {!canPayOnline ? (
              <Muted>
                This school takes payment at the office. Choose how to reach them and they will
                confirm the amount and how to pay it.
              </Muted>
            ) : null}
          </>
        ) : null}

        {stage === 'pay' ? (
          <>
            <Muted>
              {`You will be taken to ${options.online.gateway} to pay. The school is told when the money arrives — not when you press the button.`}
            </Muted>
            <Field label="How much" value={amount} onChangeText={setAmount} keyboardType="decimal-pad"
              hint={`Owing ${money(total)}.`} />
            <Button title={busy ? 'Opening…' : 'Continue to pay'} disabled={busy} full onPress={pay} />
            <Button title="Back" variant="ghost" full onPress={() => setStage('choose')} />
          </>
        ) : null}

        {stage === 'waiting' ? (
          <>
            <Muted>
              Finish the payment in the page that opened, then come back and check. If you close it
              by accident, nothing is lost — the school is told either way.
            </Muted>
            <Button title={busy ? 'Checking…' : 'I have paid — check'} disabled={busy} full onPress={check} />
            <Button title="Close" variant="ghost" full onPress={() => setOpen(false)} />
          </>
        ) : null}

        {stage === 'declare' ? (
          <>
            <Muted>
              This tells the office what to look for. Nothing changes on your account until they
              find it on the school's statement.
            </Muted>
            <Field label="How much you paid" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            <Field label="The reference on the slip" value={reference} onChangeText={setReference}
              hint="The deposit or transfer reference. Without it the office cannot match the payment." />
            <Button title={busy ? 'Sending…' : 'Tell the office'} disabled={busy} full onPress={declare} />
            <Button title="Back" variant="ghost" full onPress={() => setStage('choose')} />
          </>
        ) : null}

        {stage === 'done' ? (
          <Button title="Done" full onPress={() => setOpen(false)} />
        ) : null}
      </Sheet>

      <ContactSheet
        visible={stage === 'contact' && open} onClose={() => setStage('choose')}
        channels={list} school={school} message={message}
        subject={`Payment for ${child?.name || 'my child'}`}
        note="The office will confirm the amount and how to pay it."
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
