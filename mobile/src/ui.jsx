// Small shared UI primitives so screens stay short and consistent.
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView, Platform } from 'react-native';
import { colors, spacing, radius } from './theme';

// These screens are laid out for a phone. Left alone in a desktop browser they
// stretch a fee row across 1900 pixels, with the amount somewhere near Accra
// and the label near Kumasi. Capping the column keeps a teacher's laptop
// reading like the phone it was designed for.
const WEB_MAX_WIDTH = 640;
const webColumn = Platform.OS === 'web'
  ? { maxWidth: WEB_MAX_WIDTH, width: '100%', marginHorizontal: 'auto' }
  : null;

export function Screen({ children, scroll = true, refreshControl }) {
  const Body = scroll ? ScrollView : View;
  const content = [styles.screenContent, webColumn];
  const props = scroll
    ? { contentContainerStyle: content, refreshControl }
    : { style: content };
  return <Body style={styles.screen} {...props}>{children}</Body>;
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H1({ children }) { return <Text style={styles.h1}>{children}</Text>; }
export function H2({ children, style }) { return <Text style={[styles.h2, style]}>{children}</Text>; }
export function Muted({ children, style }) { return <Text style={[styles.muted, style]}>{children}</Text>; }

export function Button({ title, onPress, disabled, variant = 'primary' }) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : 'transparent';
  const fg = variant === 'ghost' ? colors.primary : '#fff';
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled}
      style={[styles.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1, borderWidth: variant === 'ghost' ? 1 : 0, borderColor: colors.border }]}>
      <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
    </TouchableOpacity>
  );
}

export function Field({ label, value, onChangeText, ...rest }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput style={styles.input} value={value} onChangeText={onChangeText}
        placeholderTextColor={colors.muted} autoCapitalize="none" {...rest} />
    </View>
  );
}

export function Row({ left, right }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>{left}</View>
      <View style={{ alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function Loading({ label }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Muted style={{ marginTop: spacing.sm }}>{label}</Muted> : null}
    </View>
  );
}

export function ErrorNote({ message }) {
  if (!message) return null;
  return <View style={styles.errorBox}><Text style={{ color: colors.danger }}>{message}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  label: { color: colors.muted, fontSize: 12, marginBottom: 4, fontWeight: '600' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text },
  btn: { paddingVertical: 13, borderRadius: radius.sm, alignItems: 'center', marginTop: spacing.sm },
  btnText: { fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorBox: { backgroundColor: '#FEF2F2', borderRadius: radius.sm, padding: spacing.md, borderWidth: 1, borderColor: '#FECACA' },
});
