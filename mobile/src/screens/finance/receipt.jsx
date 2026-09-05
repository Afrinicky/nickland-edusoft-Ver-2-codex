// Nickland Edusoft — The receipt, on the screen.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A parent who has just handed over money watches the counter until they are
// given something. Producing a PDF and opening a preview takes long enough for
// that pause to become a conversation, so the receipt is drawn here, at once,
// at the real width of the paper it will print on — because a receipt previewed
// at page width and printed on an 80mm roll is two different documents, and the
// difference is always discovered by a parent holding one cut in half.
//
// Same content, same order, same wording as the installed application's
// receipt. Somebody who takes a payment at the office PC in the morning and in
// a browser in the afternoon is handing out one document, not two.

import React from 'react';
import { View, Text, Image, Platform } from 'react-native';
import { Button, Muted } from '../../ui';
import { colors, spacing, type } from '../../theme';
import { cedis } from '../../office';

const PAPER = {
  roll80: { width: 80, roll: true, label: '80 mm thermal roll' },
  roll58: { width: 58, roll: true, label: '58 mm thermal roll' },
  A4: { width: 210, roll: false, label: 'A4' },
  A5: { width: 148, roll: false, label: 'A5' },
  Letter: { width: 216, roll: false, label: 'Letter' },
};

// One millimetre is 96/25.4 ≈ 3.78 CSS pixels, so the preview is drawn at the
// paper's true size rather than at some width that merely looks about right.
const MM = 96 / 25.4;

export function ReceiptView({ receipt, onPrint, onClose, busy }) {
  if (!receipt) return null;
  const paper = PAPER[receipt.paper_size] || PAPER.roll80;
  const roll = paper.roll;
  const school = receipt.school || {};
  const ink = school.primary || colors.primary;
  const accent = school.accent || colors.accent || '#C9961A';
  const width = Math.round(paper.width * MM);

  const lines = (receipt.lines || [])
    .filter(([, v]) => v !== undefined && v !== null && v !== '');

  return (
    <View style={{ gap: spacing.md, alignItems: 'center', width: '100%' }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        width: '100%', flexWrap: 'wrap',
      }}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Text style={{ ...type.heading, color: colors.text }}>
            {`Receipt ${receipt.receipt_number || ''}`}
          </Text>
          <Muted>{`${paper.label} · ${receipt.date_long} ${receipt.time}`}</Muted>
        </View>
        <Button title="Print the receipt" icon="print" full={false} busy={busy}
                disabled={busy} onPress={onPrint} />
        {onClose ? <Button title="Done" variant="ghost" full={false} onPress={onClose} /> : null}
      </View>

      {/* The receipt itself. */}
      <View style={{
        width, maxWidth: '100%', backgroundColor: '#fff',
        padding: roll ? 11 : 38,
        borderWidth: 1, borderColor: colors.border, borderRadius: 4,
      }}>
        {/* Header */}
        <View style={{
          alignItems: roll ? 'center' : 'flex-start',
          borderBottomWidth: roll ? 1 : 2,
          borderBottomColor: roll ? '#999' : ink,
          borderStyle: roll ? 'dashed' : 'solid',
          paddingBottom: 6, marginBottom: 8,
          flexDirection: roll ? 'column' : 'row', gap: roll ? 2 : 12,
        }}>
          {school.logo ? (
            <Image source={{ uri: school.logo }}
                   style={{ width: roll ? 34 : 52, height: roll ? 34 : 52, resizeMode: 'contain' }} />
          ) : null}
          <View style={{ flexShrink: 1, alignItems: roll ? 'center' : 'flex-start' }}>
            <Text style={{
              fontWeight: '800', color: ink, fontSize: roll ? 12 : 17, letterSpacing: 0.3,
              textAlign: roll ? 'center' : 'left',
            }}>{school.name}</Text>
            {!roll && school.motto ? (
              <Text style={{ fontStyle: 'italic', color: accent, fontSize: 10 }}>
                {`“${school.motto}”`}
              </Text>
            ) : null}
            {!roll && school.address ? (
              <Text style={{ fontSize: 10, color: '#444' }}>{school.address}</Text>
            ) : null}
            <Text style={{ fontSize: roll ? 9 : 10, color: '#444' }}>
              {[school.phone, !roll ? school.email : null].filter(Boolean).join(' | ')}
            </Text>
          </View>
        </View>

        <View style={{
          backgroundColor: roll ? '#000' : ink, paddingVertical: 4, marginVertical: 6,
        }}>
          <Text style={{
            color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: roll ? 11 : 14,
          }}>{receipt.title}</Text>
        </View>

        <Kv roll={roll} k="Receipt No." v={receipt.receipt_number || '—'} strong color={accent} />
        <Kv roll={roll} k="Date" v={`${receipt.date_long} ${receipt.time}`} />
        <Kv roll={roll} k="Student" v={receipt.student_name} />
        <Kv roll={roll} k="Index No." v={receipt.student_index || ''} />
        {receipt.student_class ? <Kv roll={roll} k="Class" v={receipt.student_class} /> : null}
        {receipt.term
          ? <Kv roll={roll} k="Term" v={`${receipt.term} ${receipt.academic_year || ''}`.trim()} />
          : null}
        <Kv roll={roll} k="Paid For" v={receipt.purpose_label} strong />

        <View style={{ borderWidth: 1.5, borderColor: ink, marginTop: 8, padding: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: roll ? 10 : 12, color: '#111' }}>Amount Paid</Text>
            <Text style={{
              fontSize: roll ? 14 : 18, fontWeight: '800', color: ink,
              fontVariant: ['tabular-nums'],
            }}>{cedis(receipt.amount)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: roll ? 10 : 12, color: '#111' }}>Payment Method</Text>
            <Text style={{ fontSize: roll ? 10 : 12, color: '#111' }}>{receipt.payment_method}</Text>
          </View>
          {receipt.reference ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: roll ? 10 : 12, color: '#111' }}>Reference</Text>
              <Text style={{ fontSize: roll ? 10 : 12, color: '#111' }}>{receipt.reference}</Text>
            </View>
          ) : null}
        </View>

        <Text style={{
          fontStyle: 'italic', fontSize: roll ? 9 : 10, marginTop: 6, color: '#333',
        }}>{receipt.amount_in_words}</Text>

        {lines.length ? (
          <View style={{ marginTop: 8 }}>
            {lines.map(([k, v]) => (
              <Kv key={k} roll={roll} k={k} v={typeof v === 'number' ? cedis(v) : String(v)} />
            ))}
          </View>
        ) : null}

        {receipt.status ? (
          <View style={{
            alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 1,
            borderRadius: 10, backgroundColor: `${accent}22`,
          }}>
            <Text style={{ fontWeight: '700', fontSize: 10, color: accent }}>{receipt.status}</Text>
          </View>
        ) : null}

        <Text style={{ fontSize: roll ? 9 : 10, color: '#444', marginTop: 8 }}>
          {`Received by: ${receipt.received_by || '—'}`}
        </Text>
        {!roll ? (
          <Text style={{ marginTop: 28, textAlign: 'right', fontSize: 11, color: '#111' }}>
            {'_______________________\nAuthorised Signature'}
          </Text>
        ) : null}
        <Text style={{
          marginTop: 12, textAlign: 'center', fontSize: roll ? 9 : 10, color: '#555',
        }}>{school.footer}</Text>
      </View>
    </View>
  );
}

function Kv({ k, v, strong, color, roll }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 }}>
      <Text style={{ color: '#555', fontSize: roll ? 10 : 12, flex: 1 }}>{k}</Text>
      <Text style={{
        color: strong && color ? color : '#111', fontSize: roll ? 10 : 12,
        fontWeight: strong ? '800' : '400', textAlign: 'right', flex: 1,
      }}>{v}</Text>
    </View>
  );
}

/**
 * Print the receipt.
 *
 * On the web the browser's own print dialogue is the right answer — the page
 * is already showing the receipt at its true width, and a school with a
 * thermal printer has it set as the default. Elsewhere there is nothing to
 * print to, so the button says so rather than doing nothing.
 */
export function printReceipt() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.print) {
    window.print();
    return { ok: true };
  }
  return { ok: false, error: 'Printing is done from the browser or the office PC.' };
}

export default ReceiptView;
