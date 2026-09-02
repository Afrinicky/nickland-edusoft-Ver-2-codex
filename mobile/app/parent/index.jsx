// Parent home — each child, and what they owe.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useCallback, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api, money } from '../../src/api';
import {
  Screen, Card, Section, Title, Heading, Muted, Micro, Badge, Avatar,
  ErrorNote, Skeleton, EmptyState, Grid, StatCard, Gradient, ProgressBar,
} from '../../src/ui';
import { Icon } from '../../src/icons';
import { useLayout } from '../../src/responsive';
import { colors, gradients, spacing, radius, shadow, type } from '../../src/theme';

export default function Children() {
  const { token, profile } = useAuth();
  const router = useRouter();
  const layout = useLayout();
  const [children, setChildren] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.children(token); setChildren(r.children || []); }
    catch (e) { setError(e.message); setChildren([]); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (children === null) return <Screen><Card><Skeleton rows={3} height={110} /></Card></Screen>;

  const owed = children.reduce((n, c) => n + (c.fees?.balance || 0) + (c.canteen?.amount_owed || 0), 0);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />

      {children.length === 0 ? (
        <Card>
          <EmptyState
            icon="users" title="No children linked yet"
            message="Ask the school to link your child to this account. They match on the phone number or email you gave them."
          />
        </Card>
      ) : (
        <>
          <Gradient colors={gradients.brand} angle={130} style={[{ borderRadius: radius.lg, padding: spacing.xl }, shadow.raised]}>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '700', letterSpacing: 0.4 }}>
              {String(profile?.parent?.full_name || 'WELCOME').toUpperCase()}
            </Text>
            <Text style={{ color: '#fff', fontSize: layout.isPhone ? 24 : 30, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 }}>
              {children.length} {children.length === 1 ? 'child' : 'children'} at school
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 14, fontWeight: '600', marginTop: 4 }}>
              {owed > 0 ? `${money(owed)} outstanding across fees and canteen` : 'Everything is settled — nothing owing'}
            </Text>
          </Gradient>

          <Grid min={220} columns={layout.isDesktop ? 2 : 1}>
            {children.map(c => {
              const feeBal = c.fees?.balance || 0;
              const canteen = c.canteen?.amount_owed || 0;
              return (
                <Card key={c.id} onPress={() => router.push(`/parent/child/${c.id}`)} elevated>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <Avatar name={c.name} size={46} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ ...type.heading, color: colors.text }}>{c.name}</Text>
                      <Muted numberOfLines={1}>{[c.class_name, c.index_number].filter(Boolean).join(' · ')}</Muted>
                    </View>
                    <Icon name="chevron" size={16} color={colors.faint} />
                  </View>

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md }}>
                      <Micro>School fees</Micro>
                      <Text style={{ ...type.body, fontWeight: '800', marginTop: 2, color: feeBal > 0 ? colors.danger : colors.success }}>
                        {money(feeBal)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md }}>
                      <Micro>Canteen</Micro>
                      <Text style={{ ...type.body, fontWeight: '800', marginTop: 2, color: canteen > 0 ? colors.danger : colors.success }}>
                        {money(canteen)}
                      </Text>
                    </View>
                  </View>

                  {c.fees?.billed ? (
                    <View style={{ marginTop: spacing.md }}>
                      <ProgressBar
                        value={c.fees.paid} max={c.fees.billed}
                        tone={feeBal > 0 ? 'warning' : 'success'}
                        label={`${money(c.fees.paid)} of ${money(c.fees.billed)} paid`}
                      />
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </Grid>
        </>
      )}
    </Screen>
  );
}
