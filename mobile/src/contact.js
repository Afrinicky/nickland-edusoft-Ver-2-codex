// Nickland Edusoft — reaching the school.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// No money moves through this app. A parent sees what is owed and, when they
// want to settle it, is handed over to the school: WhatsApp first, because that
// is how Ghanaian schools and parents actually talk, then a phone call, then
// email. The same handover is what the "Message the school" button does for a
// teacher who needs the office.
//
// Everything here is a link. The app never asks for a card, never asks for a
// mobile-money PIN, and never records a payment on a parent's word — which is
// the whole point: a school that takes money in person cannot be defrauded by
// something typed into a phone.

import { Linking, Platform } from 'react-native';

// Ghana numbers are written half a dozen ways — 024…, 0244…, +233 24…,
// 233-24-… — and wa.me accepts exactly one of them: digits, country code
// included, nothing else. This is the same normalisation the desktop applies
// when it matches a guardian's contact, kept in step deliberately.
export function waNumber(raw) {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('0')) s = '233' + s.slice(1);
  else if (s.length === 9) s = '233' + s;
  return s;
}

export function telHref(raw) {
  const s = String(raw || '').replace(/[^\d+]/g, '');
  return s ? `tel:${s}` : null;
}

export function whatsappHref(raw, message) {
  const n = waNumber(raw);
  if (!n) return null;
  const q = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${n}${q}`;
}

export function mailHref(address, subject, body) {
  const a = String(address || '').trim();
  if (!a) return null;
  const q = [
    subject ? `subject=${encodeURIComponent(subject)}` : '',
    body ? `body=${encodeURIComponent(body)}` : '',
  ].filter(Boolean).join('&');
  return `mailto:${a}${q ? `?${q}` : ''}`;
}

// Open a link without ever letting a bad URL crash a screen. On the web a
// WhatsApp link has to open in a NEW tab: replacing the current one throws the
// parent out of the app, and coming back means signing in again on a phone
// browser that has dropped the page.
export async function open(href) {
  if (!href) return false;
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const external = /^https?:/i.test(href);
      window.open(href, external ? '_blank' : '_self', external ? 'noopener,noreferrer' : undefined);
      return true;
    }
    await Linking.openURL(href);
    return true;
  } catch (_) {
    return false;
  }
}

// The ways this school can be reached, in the order worth trying, from whatever
// the branding endpoint gave us. A school that filled in only a phone number
// still gets a working WhatsApp button, because the server falls back to it.
export function channels(contact = {}) {
  const out = [];
  if (contact.whatsapp) out.push({ key: 'whatsapp', label: 'WhatsApp', icon: 'chat', value: contact.whatsapp });
  if (contact.phone) out.push({ key: 'phone', label: 'Call', icon: 'phone', value: contact.phone });
  if (contact.phone_alt && contact.phone_alt !== contact.phone) {
    out.push({ key: 'phone_alt', label: 'Call (2)', icon: 'phone', value: contact.phone_alt });
  }
  if (contact.email) out.push({ key: 'email', label: 'Email', icon: 'mail', value: contact.email });
  return out;
}

export function hrefFor(channel, { subject, message } = {}) {
  if (!channel) return null;
  if (channel.key === 'whatsapp') return whatsappHref(channel.value, message);
  if (channel.key === 'email') return mailHref(channel.value, subject, message);
  return telHref(channel.value);
}

const money = (n) => `GHS ${(Number(n) || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The message a parent sends when they tap "Settle this balance". Written for
// them, with the child, the class and the figures already in it, so the office
// can answer without three rounds of "which child?".
export function settleMessage({ school, child, owed, term, parent }) {
  const lines = [`Good day${school ? ` ${school}` : ''},`, ''];
  lines.push(`I would like to arrange payment for ${child?.name || 'my child'}${child?.class_name ? ` (${child.class_name})` : ''}${child?.index_number ? `, index ${child.index_number}` : ''}.`);
  if (term?.label) lines.push(`Term: ${term.label}`);
  lines.push('');
  if (owed?.fees > 0) lines.push(`School fees outstanding: ${money(owed.fees)}`);
  if (owed?.canteen > 0) lines.push(`Canteen outstanding: ${money(owed.canteen)}`);
  if (owed?.books > 0) lines.push(`Books outstanding: ${money(owed.books)}`);
  lines.push('');
  lines.push('Please let me know how to make the payment.');
  if (parent) lines.push('', parent);
  return lines.join('\n');
}

// The message a teacher or parent sends from the plain "Message the school"
// button, where there is no balance in question.
export function generalMessage({ school, from, role }) {
  const who = [from, role].filter(Boolean).join(', ');
  return `Good day${school ? ` ${school}` : ''},\n\n${who ? `${who} here. ` : ''}I would like to speak to someone at the school.`;
}

export default { waNumber, telHref, whatsappHref, mailHref, open, channels, hrefFor, settleMessage, generalMessage };
