// Sign in — one box, whoever you are.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The old screen asked "parent or staff?" before it asked who you were. Nobody
// answers that question at a school gate, and choosing the wrong tab came back
// as "invalid username or password" — which reads as a forgotten password, not
// a wrong tab. The credential decides now: the server matches a staff username
// first, then a parent's phone or email, and the app goes where the account
// belongs.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth';
import { api, setRole } from '../src/api';
import {
  Card, Title, Heading, Body, Muted, Micro, Field, Button, ErrorNote, InfoNote,
  Gradient, IconTile, Badge,
} from '../src/ui';
import { Icon } from '../src/icons';
import { useLayout } from '../src/responsive';
import { colors, palette, gradients, spacing, radius, shadow, type } from '../src/theme';

// Shown in the desktop's paired-devices list, so it should read like the thing
// the person is actually holding.
const DEVICE = Platform.OS === 'web' ? 'web browser' : Platform.OS + ' app';

export default function Login() {
  const { host, mode: conn, signIn } = useAuth();
  const layout = useLayout();
  const isCloud = conn === 'cloud';

  // 'signin' | 'register' | 'forgot' | 'claim'
  const [stage, setStage] = useState('signin');
  const [form, setForm] = useState({ identifier: '', password: '', full_name: '', phone: '', email: '' });
  const [reset, setReset] = useState({ username: '', reason: '', code: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reveal, setReveal] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const setR = (k, v) => setReset(p => ({ ...p, [k]: v }));
  const goto = (next) => { setError(null); setNotice(null); setStage(next); };

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = stage === 'register'
        ? await api.parentRegister({
            full_name: form.full_name, phone: form.phone, email: form.email,
            password: form.password, device: DEVICE,
          })
        : await api.signIn(form.identifier, form.password, DEVICE);

      // Over the internet, staff and parents have separate `me` endpoints and
      // the token does not say which it is. Set the role from what the sign-in
      // just told us, before asking — otherwise a teacher's token is presented
      // to the parent endpoint and comes back 401, which reads as a bad
      // password all over again.
      const role = stage === 'register' ? 'parent' : (res.role === 'staff' ? 'staff' : 'parent');
      setRole(role);
      const me = await api.me(res.token);
      await signIn(res.token, me);

      // An account on a password somebody else chose stops here, exactly as
      // the desktop does. Letting it through would leave a temporary password
      // working forever on the one device nobody supervises.
      router.replace(
        me.role === 'parent' ? '/parent'
          : me.must_change_password ? '/staff/account?changePassword=1'
          : '/staff');
    } catch (e) {
      setError(e.message || 'Sign in failed.');
    } finally { setBusy(false); }
  }

  async function askForReset() {
    if (!reset.username.trim()) { setError('Enter your staff username.'); return; }
    setBusy(true); setError(null);
    try {
      await api.requestPasswordReset({ username: reset.username.trim(), reason: reset.reason });
      setNotice(isCloud
        ? 'Request sent. It reaches the school when its computer next syncs. An Administrator approves it and gives you a 6-digit code — come back here with it.'
        : 'Request sent. An Administrator or Proprietor approves it and gives you a 6-digit code.');
      setStage('claim');
    } catch (e) { setError(e.message || 'Could not send the request.'); }
    finally { setBusy(false); }
  }

  async function redeemCode() {
    if (!reset.username.trim()) { setError('Enter your staff username.'); return; }
    if (!reset.code.trim()) { setError('Enter the approval code.'); return; }
    if (reset.next.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (reset.next !== reset.confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError(null);
    try {
      await api.completePasswordReset({
        username: reset.username.trim(), code: reset.code.trim(), newPassword: reset.next,
      });
      setReset({ username: reset.username, reason: '', code: '', next: '', confirm: '' });
      set('identifier', reset.username);
      set('password', '');
      setStage('signin');
      setNotice('Your password has been changed. Sign in with it now.');
    } catch (e) { setError(e.message || 'Could not reset the password.'); }
    finally { setBusy(false); }
  }

  const panel = (
    <View style={{ gap: spacing.md }}>
      {stage === 'signin' && (
        <>
          <View>
            <Title>Sign in</Title>
            <Muted style={{ marginTop: 2 }}>Staff, teachers and parents — the same box.</Muted>
          </View>
          <InfoNote message={notice} />
          <Field
            label="Username, phone or email"
            value={form.identifier}
            onChangeText={v => set('identifier', v)}
            placeholder="Staff username, or 0244…"
            icon="user"
            autoComplete="username"
            returnKeyType="next"
          />
          <Field
            label="Password"
            value={form.password}
            onChangeText={v => set('password', v)}
            secureTextEntry={!reveal}
            placeholder="Your password"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={submit}
            right={(
              <TouchableOpacity onPress={() => setReveal(r => !r)} accessibilityRole="button"
                accessibilityLabel={reveal ? 'Hide password' : 'Show password'}>
                <Micro style={{ color: colors.primary }}>{reveal ? 'HIDE' : 'SHOW'}</Micro>
              </TouchableOpacity>
            )}
          />
          <ErrorNote message={error} />
          <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} busy={busy} size="lg" iconRight="chevron" />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <TouchableOpacity onPress={() => goto('forgot')}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13.5 }}>Forgot your password?</Text>
            </TouchableOpacity>
            {!isCloud && (
              <TouchableOpacity onPress={() => goto('register')}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13.5 }}>Parent? Register</Text>
              </TouchableOpacity>
            )}
          </View>
          {isCloud && (
            <Muted style={{ marginTop: 4 }}>
              Signing in over the internet. Registers, marks, class work, homework, lesson notes,
              the canteen and your payslips all work; anything you write reaches the school when
              its computer next syncs.
            </Muted>
          )}
        </>
      )}

      {stage === 'register' && (
        <>
          <View>
            <Title>Create a parent account</Title>
            <Muted style={{ marginTop: 2 }}>Your phone or email must match the one the school has for your child.</Muted>
          </View>
          <Field label="Your name" value={form.full_name} onChangeText={v => set('full_name', v)} autoCapitalize="words" icon="user" />
          <Field label="Phone" value={form.phone} onChangeText={v => set('phone', v)} keyboardType="phone-pad" placeholder="0244…" icon="phone" />
          <Field label="Email (optional)" value={form.email} onChangeText={v => set('email', v)} keyboardType="email-address" icon="mail" />
          <Field label="Choose a password" value={form.password} onChangeText={v => set('password', v)} secureTextEntry placeholder="At least 6 characters" />
          <ErrorNote message={error} />
          <Button title={busy ? 'Please wait…' : 'Create account'} onPress={submit} busy={busy} size="lg" />
          <TouchableOpacity onPress={() => goto('signin')} style={{ alignItems: 'center', marginTop: 8 }}>
            <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 13.5 }}>← Back to sign in</Text>
          </TouchableOpacity>
        </>
      )}

      {(stage === 'forgot' || stage === 'claim') && (
        <>
          <View>
            <Title>{stage === 'forgot' ? 'Reset your password' : 'Set your new password'}</Title>
            <Muted style={{ marginTop: 2 }}>
              For staff accounts. An Administrator at the school approves the request and hands you a code.
            </Muted>
          </View>
          <InfoNote message={notice} />
          <Field label="Staff username" value={reset.username} onChangeText={v => setR('username', v)} placeholder="Your staff username" icon="user" />
          {stage === 'forgot' ? (
            <Field label="Note for the approver (optional)" value={reset.reason} onChangeText={v => setR('reason', v)}
              placeholder="e.g. forgot it over the holidays" />
          ) : (
            <>
              <Field label="Approval code" value={reset.code} onChangeText={v => setR('code', v)}
                placeholder="6-digit code from your Administrator" keyboardType="number-pad" maxLength={6} />
              <Field label="New password" value={reset.next} onChangeText={v => setR('next', v)} secureTextEntry placeholder="At least 6 characters" />
              <Field label="Confirm new password" value={reset.confirm} onChangeText={v => setR('confirm', v)} secureTextEntry placeholder="Type it again" />
            </>
          )}
          <ErrorNote message={error} />
          <Button
            title={busy ? 'Please wait…' : stage === 'forgot' ? 'Send request' : 'Set new password'}
            onPress={stage === 'forgot' ? askForReset : redeemCode} busy={busy} size="lg"
          />
          <TouchableOpacity onPress={() => goto(stage === 'forgot' ? 'claim' : 'forgot')} style={{ alignItems: 'center', marginTop: 10 }}>
            <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13.5 }}>
              {stage === 'forgot' ? 'I already have a code' : "I haven't asked for a reset yet"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => goto('signin')} style={{ alignItems: 'center', marginTop: 8 }}>
            <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 13.5 }}>← Back to sign in</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  // On a wide window the sign-in card sits beside the school's identity rather
  // than alone in the middle of a grey field.
  const split = layout.isDesktop;

  return (
    <View style={{ flex: 1, flexDirection: split ? 'row' : 'column', backgroundColor: colors.bg }}>
      <Gradient colors={gradients.chrome} angle={150} style={split ? { flex: 1.05, padding: 56, justifyContent: 'center' } : { padding: 24, paddingTop: 40, paddingBottom: 28 }}>
        <View style={{ maxWidth: 460, gap: split ? spacing.lg : spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{
              width: split ? 52 : 42, height: split ? 52 : 42, borderRadius: 16,
              backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="school" size={split ? 28 : 22} color={palette.gold400} />
            </View>
            <View>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: split ? 22 : 18, letterSpacing: -0.4 }}>
                Nickland Edusoft
              </Text>
              <Text style={{ color: colors.onChromeMuted, fontSize: 12, fontWeight: '600' }}>
                {isCloud ? 'School portal' : 'School network'}
              </Text>
            </View>
          </View>

          {split && (
            <>
              <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: -0.8, lineHeight: 42 }}>
                Your classroom,{'\n'}wherever you are.
              </Text>
              <Text style={{ color: colors.onChromeMuted, fontSize: 15, lineHeight: 23, maxWidth: 400 }}>
                Take the register, enter class work and exam marks, write lesson notes, set and mark
                homework, collect canteen money, answer parents and check your own payslip — from a
                phone on the school Wi-Fi or a laptop at home.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {['Register', 'Class work', 'Results', 'Lesson notes', 'Homework', 'Payslips'].map(t => (
                  <View key={t} style={{
                    paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill,
                    backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
                  }}>
                    <Text style={{ color: 'rgba(255,255,255,0.86)', fontSize: 12, fontWeight: '700' }}>{t}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {host ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: split ? spacing.lg : 10 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.cyan300 }} />
              <Text numberOfLines={1} style={{ color: colors.onChromeMuted, fontSize: 12, fontWeight: '600', flex: 1 }}>
                {host}
              </Text>
            </View>
          ) : null}
        </View>
      </Gradient>

      <View style={{ flex: split ? 1 : 1, justifyContent: 'center', padding: split ? 48 : 20 }}>
        <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center' }}>
          <Card style={split ? shadow.raised : null}>{panel}</Card>
          <TouchableOpacity onPress={() => router.push('/connect')} style={{ alignItems: 'center', marginTop: 14 }}>
            <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12.5 }}>Change school or address</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
