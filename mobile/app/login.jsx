// Sign in — one box, whoever you are.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The old screen asked "parent or staff?" before it asked who you were. Nobody
// answers that question at a school gate, and choosing the wrong tab came back
// as "invalid username or password" — which reads as a forgotten password, not
// a wrong tab. The credential decides now: the server matches a staff username
// first, then a parent's phone or email, and the app goes where the account
// belongs.
//
// This screen used to carry a dark panel down one side with the product's
// pitch on it: a headline, a paragraph about everything the app does, and eight
// chips naming its features. None of that was for the person in front of it. A
// teacher opening this at 6am already owns the software; a parent following a
// link from the school does not need to be sold it. It is gone, and with it the
// "or" divider, the two secondary buttons, the help sheet and the paragraph of
// small print underneath. What is left is a crest, a name, two boxes and a
// button — plus one quiet line for the two people the button cannot help: the
// teacher who has forgotten a password, and the parent who has no account yet.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth';
import { api, setRole } from '../src/api';
import {
  Card, Title, Muted, Field, Button, IconButton, ErrorNote, InfoNote, Crest,
} from '../src/ui';
import { Appear } from '../src/motion';
import { useBranding } from '../src/brand';
import { useLayout } from '../src/responsive';
import { colors, spacing, shadow, type } from '../src/theme';

// Shown in the desktop's paired-devices list, so it should read like the thing
// the person is actually holding.
const DEVICE = Platform.OS === 'web' ? 'web browser' : Platform.OS + ' app';

export default function Login() {
  const { mode: conn, signIn } = useAuth();
  const layout = useLayout();
  const brand = useBranding();
  const isCloud = conn === 'cloud';
  // Whose sign-in page this is. A parent opening a link should recognise their
  // child's school immediately; falling back to the product's own name is for
  // the first run, before a connection has been made.
  const schoolName = brand.school?.name || 'Nickland Edusoft';

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
      setNotice('Request sent. An Administrator approves it and gives you a 6-digit code.');
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{
        flex: 1, justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: spacing.xl,
      }}>
        <View style={{ width: '100%', maxWidth: 400 }}>

          {/* The school, quietly. A crest and a name — no motto, no address,
              no strapline. The person already knows where they are. */}
          <View style={{ alignItems: 'center', marginBottom: spacing.lg, gap: 10 }}>
            <Crest logo={brand.logo} size={56} />
            <Text numberOfLines={2} style={{
              ...type.heading, color: colors.text, textAlign: 'center',
            }}>{schoolName}</Text>
          </View>

          <Appear distance={12}>
            <Card style={layout.isDesktop ? shadow.raised : null}>
              <View style={{ gap: spacing.md }}>

                {stage === 'signin' && (
                  <>
                    <Title style={{ fontSize: 24 }}>Welcome back</Title>
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
                      icon="lock"
                      right={(
                        <IconButton
                          name="eye" size={30} tone="plain"
                          color={reveal ? colors.primary : colors.faint}
                          onPress={() => setReveal(r => !r)}
                          label={reveal ? 'Hide the password' : 'Show the password'}
                        />
                      )}
                    />
                    <ErrorNote message={error} />
                    <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} busy={busy} size="lg" />

                    {/* The two people the button cannot help, on one line and
                        in small type. Everything else that used to live here —
                        a second row of buttons, a help sheet, a paragraph of
                        small print — has gone. */}
                    <View style={{
                      flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
                      gap: spacing.md, marginTop: 2,
                    }}>
                      <TouchableOpacity onPress={() => goto('forgot')} accessibilityRole="button">
                        <Text style={{ ...type.small, color: colors.textSoft, fontWeight: '600' }}>
                          Forgot password
                        </Text>
                      </TouchableOpacity>
                      {!isCloud && (
                        <>
                          <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: colors.faint }} />
                          <TouchableOpacity onPress={() => goto('register')} accessibilityRole="button">
                            <Text style={{ ...type.small, color: colors.textSoft, fontWeight: '600' }}>
                              New parent
                            </Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </>
                )}

                {stage === 'register' && (
                  <>
                    <Title style={{ fontSize: 24 }}>New parent</Title>
                    <Muted>Use the phone number the school has for your child.</Muted>
                    <Field label="Your name" value={form.full_name} onChangeText={v => set('full_name', v)} autoCapitalize="words" icon="user" />
                    <Field label="Phone" value={form.phone} onChangeText={v => set('phone', v)} keyboardType="phone-pad" placeholder="0244…" icon="phone" />
                    <Field label="Email (optional)" value={form.email} onChangeText={v => set('email', v)} keyboardType="email-address" icon="mail" />
                    <Field label="Choose a password" value={form.password} onChangeText={v => set('password', v)} secureTextEntry placeholder="At least 6 characters" icon="lock" />
                    <ErrorNote message={error} />
                    <Button title={busy ? 'Please wait…' : 'Create account'} onPress={submit} busy={busy} size="lg" />
                    <BackToSignIn onPress={() => goto('signin')} />
                  </>
                )}

                {(stage === 'forgot' || stage === 'claim') && (
                  <>
                    <Title style={{ fontSize: 24 }}>
                      {stage === 'forgot' ? 'Forgot password' : 'New password'}
                    </Title>
                    <Muted>
                      {stage === 'forgot'
                        ? 'For staff. The school approves it and gives you a code.'
                        : 'Enter the code the school gave you.'}
                    </Muted>
                    <InfoNote message={notice} />
                    <Field label="Staff username" value={reset.username} onChangeText={v => setR('username', v)} placeholder="Your staff username" icon="user" />
                    {stage === 'forgot' ? null : (
                      <>
                        <Field label="Code" value={reset.code} onChangeText={v => setR('code', v)}
                          placeholder="6 digits" keyboardType="number-pad" maxLength={6} />
                        <Field label="New password" value={reset.next} onChangeText={v => setR('next', v)} secureTextEntry placeholder="At least 6 characters" icon="lock" />
                        <Field label="Type it again" value={reset.confirm} onChangeText={v => setR('confirm', v)} secureTextEntry icon="lock" />
                      </>
                    )}
                    <ErrorNote message={error} />
                    <Button
                      title={busy ? 'Please wait…' : stage === 'forgot' ? 'Send request' : 'Save password'}
                      onPress={stage === 'forgot' ? askForReset : redeemCode} busy={busy} size="lg"
                    />
                    <View style={{ alignItems: 'center' }}>
                      <TouchableOpacity onPress={() => goto(stage === 'forgot' ? 'claim' : 'forgot')} accessibilityRole="button">
                        <Text style={{ ...type.small, color: colors.textSoft, fontWeight: '600' }}>
                          {stage === 'forgot' ? 'I already have a code' : 'I need a code'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <BackToSignIn onPress={() => goto('signin')} />
                  </>
                )}

              </View>
            </Card>
          </Appear>
        </View>
      </View>
    </View>
  );
}

function BackToSignIn({ onPress }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <TouchableOpacity onPress={onPress} accessibilityRole="button">
        <Text style={{ ...type.small, color: colors.muted, fontWeight: '600' }}>Back to sign in</Text>
      </TouchableOpacity>
    </View>
  );
}
