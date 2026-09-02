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
import { AuthProvider } from '../src/auth';
import { colors } from '../src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="connect" />
          <Stack.Screen name="login" />
          <Stack.Screen name="parent" />
          <Stack.Screen name="staff" />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
