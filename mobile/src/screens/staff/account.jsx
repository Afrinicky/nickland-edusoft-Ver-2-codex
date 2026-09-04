// Settings — the account, and everything about how the app behaves.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The settings screen in the reference is a single column of labelled rows
// with a chevron, and that shape is right for a reason: every item here is a
// destination or a switch, none of them is data, and a person arriving is
// looking for one specific thing by its name. Cards with headings and prose
// would make them hunt.
//
// Rows that open a panel do it in place rather than pushing a new screen —
// changing a password is four fields and does not deserve a route of its own.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../auth';
import { api } from '../../api';
import {
  Screen, Card, Section, Heading, Body, Muted, Micro, Button, Badge, Field,
  ErrorNote, InfoNote, SuccessNote, Flash, Grid, StatCard, Avatar, KeyValue, Divider,
  MenuRow, Sheet, Toolbar, Crest,
} from '../../ui';
import { useBranding } from '../../brand';
import { ContactSchool, PrintButton } from '../../actions';
import { Appear } from '../../motion';
import { colors, palette, gradients, spacing, radius, shadow, type } from '../../theme';
import { Gradient } from '../../ui';

export default function Account() {
  const { profile, host, mode, token, signOut, forgetConnection } = useAuth();
  const brand = useBranding();
  const [signingOut, setSigningOut] = useState(false);
  const params = useLocalSearchParams();
  const u = profile?.user || {};
  const perms = profile?.permissions || {};
  const allowed = Object.keys(perms).filter(k => perms[k]?.canView);
  const online = mode === 'cloud';

  // Arrives set when sign-in found a password an administrator had chosen. The
  // panel opens on its own and says why, rather than leaving the teacher to
  // find it.
  const forced = String(params.changePassword || '') === '1' || !!profile?.must_change_password;
  const [changing, setChanging] = useState(forced);
  const [permsOpen, setPermsOpen] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwDone, setPwDone] = useState(null);
  const setP = (k, v) => setPw(p => ({ ...p, [k]: v }));

  async function savePassword() {
    setPwError(null);
    if (!pw.current) { setPwError('Enter your current password.'); return; }
    if (pw.next.length < 6) { setPwError('New password must be at least 6 characters.'); return; }
    if (pw.next !== pw.confirm) { setPwError('The two new passwords do not match.'); return; }
    setPwBusy(true);
    try {
      await api.changePassword(token, { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setPwDone(online
        ? 'Password changed. It works here straight away and reaches the school at the next sync.'
        : 'Password changed.');
      setChanging(false);
    } catch (e) {
      setPwError(e.message || 'Could not change your password.');
    } finally { setPwBusy(false); }
  }

  // Signed in over the internet, work is queued rather than saved outright.
  // A teacher who has just marked a register deserves to be told plainly
  // whether it has reached the school — not left to wonder.
  const [waiting, setWaiting] = useState(null);
  useEffect(() => {
    let live = true;
    if (!online || !token) return undefined;
    api.staffPending(token)
      .then(r => { if (live) setWaiting(r.pending || 0); })
      .catch(() => {});
    return () => { live = false; };
  }, [online, token]);

  // A module map is not a sentence. "Students, Academics, Canteen" reads as a
  // list of what this account can open, which is the question being asked.
  const MODULE_NAMES = {
    dashboard: 'Overview', students: 'Students', academics: 'Academics',
    fees: 'Fees', canteen: 'Canteen', staff: 'Staff', payroll: 'Payroll',
    finance: 'Finance', notifications: 'Messages & notices', settings: 'Settings',
  };

  return (
    <Screen variant="reading">
      {/* The reference puts a person's own face on a coloured header and their
          settings underneath it. It reads as "this is yours" in a way a white
          card with an avatar in the corner does not. */}
      <Appear distance={12}>
        <Gradient colors={gradients.brand} angle={128} style={[styles.head, shadow.raised]}>
          <View pointerEvents="none" style={styles.headGlow} />
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            <Avatar name={u.full_name} photo={profile?.photo} size={78} tone="chrome" ring />
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text numberOfLines={2} style={{ ...type.title, color: '#fff', textAlign: 'center' }}>
                {u.full_name || 'Staff'}
              </Text>
              <Text numberOfLines={1} style={{ ...type.small, color: 'rgba(255,255,255,0.76)', fontWeight: '600' }}>
                {u.username ? `@${u.username}` : (profile?.designation || 'Staff')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Badge tone="chrome" label={profile?.designation || 'Staff'} />
              {profile?.is_admin ? <Badge tone="chrome" icon="crown" label="Administrator" /> : null}
              <Badge tone="chrome" icon={online ? 'refresh' : 'tick'}
                label={online ? 'Over the internet' : 'On the school network'} />
            </View>
          </View>
        </Gradient>
      </Appear>


      <Section title="Your account" icon="badge" padded>
        <MenuRow icon="badge" label="My work and my record" hint="Employment, attendance, leave, payslips"
          onPress={() => router.push('/app/me')} />
        <MenuRow icon="lock" label="Change your password" iconTone="violet"
          hint={forced ? 'Set by an administrator — choose your own' : 'The password you sign in with'}
          onPress={() => { setChanging(true); setPwDone(null); }} />
        <MenuRow icon="grid" label="What you can open" iconTone="data"
          hint={profile?.is_admin ? 'Full access' : `${allowed.length} module${allowed.length === 1 ? '' : 's'}`}
          onPress={() => setPermsOpen(true)} last />
      </Section>

      <Section title="Your school" icon="school">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md }}>
          <Crest logo={brand.logo} size={46} tone="light" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Heading numberOfLines={2}>{brand.school?.name || profile?.school?.name || 'Your school'}</Heading>
            {brand.school?.motto ? <Muted numberOfLines={1}>{brand.school.motto}</Muted> : null}
          </View>
        </View>
        <KeyValue items={[
          { label: 'Address', value: brand.school?.address },
          { label: online ? 'Connected to' : 'This machine', value: online ? 'The school portal, over the internet' : host },
        ]} />
        <View style={{ marginTop: spacing.md }}>
          <ContactSchool variant="subtle" title="Message the school office" icon="whatsapp" full />
        </View>
      </Section>

      {online && (
        <Section title="Reaching the school" icon="refresh">
          {waiting === null ? (
            <Muted>Checking…</Muted>
          ) : waiting === 0 ? (
            <SuccessNote message="Everything you have entered has reached the school." />
          ) : (
            <InfoNote message={`${waiting} ${waiting === 1 ? 'entry is' : 'entries are'} waiting for the school's computer.`} />
          )}
          <Muted style={{ marginTop: spacing.sm }}>
            Your work is saved the moment you enter it and lands in the school's records the next
            time its computer syncs. Taking a fee payment is the one thing that needs the school
            itself, because receipts are numbered there.
          </Muted>
        </Section>
      )}

      <Section title="Leaving" icon="logout">
        <MenuRow icon="logout" label="Sign out" danger
          hint="You will need your password to come back in"
          onPress={async () => { setSigningOut(true); await signOut(); router.replace('/login'); }} />
        <MenuRow icon="pin" label="Change school or address" iconTone="neutral"
          hint="Point this app at a different school" last
          onPress={async () => { await forgetConnection(); router.replace('/connect'); }} />
      </Section>

      <Muted style={{ textAlign: 'center', paddingVertical: spacing.md }}>
        Nickland Edusoft · Nickland Sales
      </Muted>

      <Sheet visible={permsOpen} onClose={() => setPermsOpen(false)} title="What you can open" width={460}>
        <Body style={{ marginBottom: spacing.sm }}>
          The school decides what each account may reach. What you may not open, you do not see —
          and the school's own system checks every request regardless of what the app draws.
        </Body>
        {profile?.is_admin ? (
          <InfoNote message="Full access — an administrator is not restricted anywhere." />
        ) : allowed.length === 0 ? (
          <Muted>No modules are enabled for your account. Ask the school office.</Muted>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {allowed.map(k => <Badge key={k} tone="primary" label={MODULE_NAMES[k] || k} />)}
          </View>
        )}
      </Sheet>

      <Sheet
        visible={changing} onClose={() => { if (!forced) { setChanging(false); setPwError(null); } }}
        title="Change your password" width={460}
        footer={<>
          {!forced ? <Button variant="outline" title="Cancel" full={false} onPress={() => { setChanging(false); setPwError(null); }} /> : null}
          <Button title={pwBusy ? 'Saving…' : 'Change password'} onPress={savePassword} busy={pwBusy} full={false} />
        </>}
      >
        {forced ? (
          <InfoNote message="Your password was set by an administrator. Choose your own before carrying on." />
        ) : null}
        <Field label="Current password" value={pw.current} onChangeText={v => setP('current', v)}
          secureTextEntry icon="lock" placeholder="The one you signed in with" />
        <Field label="New password" value={pw.next} onChangeText={v => setP('next', v)}
          secureTextEntry icon="lock" placeholder="At least 6 characters" />
        <Field label="Confirm new password" value={pw.confirm} onChangeText={v => setP('confirm', v)}
          secureTextEntry icon="lock" placeholder="Type it again" />
        <Flash error={pwError} success={pwDone} onClear={() => setPwDone(null)} style={{ marginBottom: 0 }} />
      </Sheet>

    </Screen>
  );
}

const styles = {
  head: { borderRadius: radius.lg, padding: spacing.xl, overflow: 'hidden' },
  headGlow: {
    position: 'absolute', right: -70, top: -90, width: 250, height: 250,
    borderRadius: 125, backgroundColor: 'rgba(255,255,255,0.08)',
  },
};
