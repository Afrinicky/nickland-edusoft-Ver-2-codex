// Nickland Edusoft — the root of the phone app and the browser app.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The signed-in areas draw their own chrome (src/shell.jsx), which is how one
// build fits a handset and a desktop browser, so the navigator's own header is
// off everywhere. What is left here is the session provider and the status bar.
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth';
import { BrandingProvider } from '../src/brand';
import { colors } from '../src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Branded />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

// The school's crest and its contact numbers, fetched once the connection is
// known and before anyone signs in — so the login screen shows the parent
// their own school rather than a generic blue page, and every "Message the
// school" button in either portal has a number to dial.
function Branded() {
  const { host } = useAuth();
  return (
    <BrandingProvider host={host}>
      {/* The app's chrome is white, so the phone's own status bar carries dark
          content over it. The splash is the one dark screen and it sets its
          own; see app/index.jsx. */}
      <StatusBar style="dark" />
      <Stack screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'fade',
      }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="connect" />
        <Stack.Screen name="login" />
        <Stack.Screen name="parent" />
        <Stack.Screen name="staff" />
      </Stack>
    </BrandingProvider>
  );
}
