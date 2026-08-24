// Sign-in — parents (phone/email + password, with self-register) or staff.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth';
import { api } from '../src/api';
import { Screen, Card, H1, Muted, Field, Button, ErrorNote } from '../src/ui';
import { colors } from '../src/theme';

// Shown in the desktop's paired-devices list, so it should read like the
// thing the person is actually holding.
const DEVICE = Platform.OS === 'web' ? 'web browser' : Platform.OS + ' app';

export default function Login() {
  const { host, mode: conn, signIn } = useAuth();
  const isCloud = conn === 'cloud';
  const [mode, setMode] = useState('parent'); // 'parent' | 'staff'
  const [register, setRegister] = useState(false);
  const [form, setForm] = useState({ identifier: '', username: '', password: '', full_name: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

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
      const me = await api.me(res.token);
      await signIn(res.token, me);
      router.replace(me.role === 'parent' ? '/parent' : '/staff');
    } catch (e) {
      setError(e.message || 'Sign in failed.');
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginVertical: 16 }}>
        <H1>Welcome back</H1>
        <Muted>{host}</Muted>
      </View>

      {/* Staff features run on the school desktop, not the hosted portal, so
          cloud connections are parent-only. */}
      {!isCloud && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Tab label="Parent" active={mode === 'parent'} onPress={() => { setMode('parent'); setError(null); }} />
          <Tab label="Staff / Teacher" active={mode === 'staff'} onPress={() => { setMode('staff'); setError(null); }} />
        </View>
      )}
      {isCloud && (
        <Muted style={{ textAlign: 'center', marginBottom: 4 }}>
          Parent sign-in. Teachers: open the school address on the school Wi-Fi to mark
          registers and enter scores.
        </Muted>
      )}

      <Card>
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
        {mode === 'parent' && !isCloud && (
          <TouchableOpacity onPress={() => { setRegister(r => !r); setError(null); }} style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>
              {register ? 'I already have an account' : "First time? Register with your phone"}
            </Text>
          </TouchableOpacity>
        )}
        {mode === 'parent' && isCloud && (
          <Muted style={{ marginTop: 12, textAlign: 'center' }}>
            First time? Register in the school's mobile app on the school Wi-Fi, then sign in here.
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
