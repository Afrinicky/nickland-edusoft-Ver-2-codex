// Sign-in — parents (phone/email + password, with self-register) or staff.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth';
import { api, setRole } from '../src/api';
import { Screen, Card, H1, Muted, Field, Button, ErrorNote, InfoNote } from '../src/ui';
import { colors } from '../src/theme';

// Shown in the desktop's paired-devices list, so it should read like the
// thing the person is actually holding.
const DEVICE = Platform.OS === 'web' ? 'web browser' : Platform.OS + ' app';

export default function Login() {
  const { host, mode: conn, signIn } = useAuth();
  const isCloud = conn === 'cloud';
  const [mode, setMode] = useState('parent'); // 'parent' | 'staff'
  const [register, setRegister] = useState(false);
  // 'signin' | 'forgot' | 'claim' — the two extra screens are staff-only,
  // because a parent's password lives in a different table with its own rules.
  const [stage, setStage] = useState('signin');
  const [form, setForm] = useState({ identifier: '', username: '', password: '', full_name: '', phone: '', email: '' });
  const [reset, setReset] = useState({ reason: '', code: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const setR = (k, v) => setReset(p => ({ ...p, [k]: v }));

  function goto(next) { setError(null); setNotice(null); setStage(next); }

  async function askForReset() {
    if (!form.username.trim()) { setError('Enter your username.'); return; }
    setBusy(true); setError(null);
    try {
      await api.requestPasswordReset({ username: form.username.trim(), reason: reset.reason });
      setNotice(isCloud
        ? 'Request sent. It reaches the school when its computer next syncs. An Administrator approves it and gives you a 6-digit code — come back here with it.'
        : 'Request sent. An Administrator or Proprietor approves it and gives you a 6-digit code.');
      setStage('claim');
    } catch (e) {
      setError(e.message || 'Could not send the request.');
    } finally { setBusy(false); }
  }

  async function redeemCode() {
    if (!form.username.trim()) { setError('Enter your username.'); return; }
    if (!reset.code.trim()) { setError('Enter the approval code.'); return; }
    if (reset.next.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (reset.next !== reset.confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError(null);
    try {
      await api.completePasswordReset({
        username: form.username.trim(), code: reset.code.trim(), newPassword: reset.next,
      });
      setReset({ reason: '', code: '', next: '', confirm: '' });
      set('password', '');
      setMode('staff');
      setStage('signin');
      setNotice('Your password has been changed. Sign in with it now.');
    } catch (e) {
      setError(e.message || 'Could not reset the password.');
    } finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      let res;
      if (mode === 'staff') {
        res = await api.staffLogin(form.username, form.password, DEVICE);
      } else if (register) {
        res = await api.parentRegister({ full_name: form.full_name, phone: form.phone, email: form.email, password: form.password, device: DEVICE });
      } else {
        res = await api.parentLogin(form.identifier, form.password, DEVICE);
      }
      // Over the internet, staff and parents have separate `me` endpoints and
      // the token does not say which it is. Set the role from the sign-in we
      // just did, before asking — otherwise a teacher's token is presented to
      // the parent endpoint and comes back 401, which reads as a bad password.
      setRole(mode === 'staff' ? 'staff' : 'parent');
      const me = await api.me(res.token);
      await signIn(res.token, me);
      // The account is on a password somebody else chose. The desktop stops at
      // this point too; letting the phone through would leave a temporary
      // password working forever on the one device nobody supervises.
      router.replace(
        me.role === 'parent' ? '/parent'
          : me.must_change_password ? '/staff/account?changePassword=1'
          : '/staff');
    } catch (e) {
      setError(e.message || 'Sign in failed.');
    } finally { setBusy(false); }
  }

  // The reset screens stand on their own: mixing them into the sign-in card
  // put four password boxes on one screen and made it unclear which was which.
  if (stage !== 'signin') {
    const forgot = stage === 'forgot';
    return (
      <Screen>
        <View style={{ alignItems: 'center', marginVertical: 16 }}>
          <H1>{forgot ? 'Reset your password' : 'Set your new password'}</H1>
          <Muted>{host}</Muted>
        </View>
        <Card>
          <InfoNote message={notice} />
          <Field label="Username" value={form.username} onChangeText={v => set('username', v)}
            placeholder="Your staff username" />
          {forgot ? (
            <Field label="Note for the approver (optional)" value={reset.reason}
              onChangeText={v => setR('reason', v)} placeholder="e.g. forgot it over the holidays" />
          ) : (
            <>
              <Field label="Approval code" value={reset.code} onChangeText={v => setR('code', v)}
                placeholder="6-digit code from your Administrator" keyboardType="number-pad" maxLength={6} />
              <Field label="New password" value={reset.next} onChangeText={v => setR('next', v)}
                secureTextEntry placeholder="At least 6 characters" />
              <Field label="Confirm new password" value={reset.confirm} onChangeText={v => setR('confirm', v)}
                secureTextEntry placeholder="Type it again" />
            </>
          )}
          <ErrorNote message={error} />
          <Button title={busy ? 'Please wait…' : forgot ? 'Send request' : 'Set new password'}
            onPress={forgot ? askForReset : redeemCode} disabled={busy} />
          <TouchableOpacity onPress={() => goto(forgot ? 'claim' : 'forgot')}
            style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>
              {forgot ? 'I already have a code' : "I haven't asked for a reset yet"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => goto('signin')} style={{ marginTop: 10, alignItems: 'center' }}>
            <Text style={{ color: colors.muted, fontWeight: '600' }}>← Back to sign in</Text>
          </TouchableOpacity>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginVertical: 16 }}>
        <H1>Welcome back</H1>
        <Muted>{host}</Muted>
      </View>

      {/* Both roles sign in either way now. Over the internet a teacher gets
          the school's read model and their writes are queued for the desktop,
          so the tabs are the same whichever connection this is. */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Tab label="Parent" active={mode === 'parent'} onPress={() => { setMode('parent'); setError(null); }} />
        <Tab label="Staff / Teacher" active={mode === 'staff'} onPress={() => { setMode('staff'); setError(null); }} />
      </View>
      {isCloud && mode === 'staff' && (
        <Muted style={{ textAlign: 'center', marginTop: 4 }}>
          Signing in over the internet. Registers, scores, canteen and homework all work;
          they reach the school when its computer next syncs.
        </Muted>
      )}

      <Card>
        <InfoNote message={notice} />
        {mode === 'staff' ? (
          <>
            <Field label="Username" value={form.username} onChangeText={v => set('username', v)} />
            <Field label="Password" value={form.password} onChangeText={v => set('password', v)} secureTextEntry />
          </>
        ) : register ? (
          <>
            <Field label="Your name" value={form.full_name} onChangeText={v => set('full_name', v)} autoCapitalize="words" />
            <Field label="Phone" value={form.phone} onChangeText={v => set('phone', v)} keyboardType="phone-pad" placeholder="0244…" />
            <Field label="Email (optional)" value={form.email} onChangeText={v => set('email', v)} keyboardType="email-address" />
            <Field label="Choose a password" value={form.password} onChangeText={v => set('password', v)} secureTextEntry />
            <Muted>Your phone or email must match the one the school has for your child.</Muted>
          </>
        ) : (
          <>
            <Field label="Phone or email" value={form.identifier} onChangeText={v => set('identifier', v)} placeholder="0244… or you@email.com" />
            <Field label="Password" value={form.password} onChangeText={v => set('password', v)} secureTextEntry />
          </>
        )}
        <ErrorNote message={error} />
        <Button title={busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'} onPress={submit} disabled={busy} />
        {mode === 'staff' && (
          <TouchableOpacity onPress={() => goto('forgot')} style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Forgot your password?</Text>
          </TouchableOpacity>
        )}
        {mode === 'parent' && !isCloud && (
          <TouchableOpacity onPress={() => { setRegister(r => !r); setError(null); }} style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>
              {register ? 'I already have an account' : "First time? Register with your phone"}
            </Text>
          </TouchableOpacity>
        )}
        {mode === 'parent' && isCloud && (
          <Muted style={{ marginTop: 12, textAlign: 'center' }}>
            First time? Register once against your school's own address, then sign in here.
          </Muted>
        )}
      </Card>
    </Screen>
  );
}

function Tab({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress}
      style={{ flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: active ? colors.primary : '#fff', borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );
}
