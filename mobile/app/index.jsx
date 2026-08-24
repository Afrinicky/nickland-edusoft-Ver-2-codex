// Entry gate: routes to connect → login → the correct role area.
import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth';
import { Loading } from '../src/ui';

export default function Index() {
  const { ready, host, mode, schoolId, token, profile } = useAuth();
  if (!ready) return <Loading label="Starting…" />;
  if (!host) return <Redirect href="/connect" />;
  // A portal connection is only usable once a school has been chosen.
  if (mode === 'cloud' && !schoolId) return <Redirect href="/connect" />;
  if (!token || !profile) return <Redirect href="/login" />;
  return <Redirect href={profile.role === 'parent' ? '/parent' : '/staff'} />;
}
