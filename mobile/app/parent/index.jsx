// Parent home — each child, and what they owe.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useCallback, useState } from 'react';
import { View, Text, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api, money, firstName } from '../../src/api';
import {
  Screen, Card, Section, Title, Heading, Body, Muted, Micro, Badge, Avatar,
  ErrorNote, Skeleton, EmptyState, Grid, StatCard, Gradient, ProgressBar,
  Hero, HeroStat, Crest, ListRow, Divider, Toolbar, Button,
} from '../../src/ui';
import { useBranding } from '../../src/brand';
import { ContactSchool, SettleBalance } from '../../src/actions';
import { Appear } from '../../src/motion';
import { Icon } from '../../src/icons';
import { useLayout } from '../../src/responsive';
import { colors, gradients, spacing, radius, shadow, type } from '../../src/theme';

export default function Children() {
  const { token, profile } = useAuth();
  const router = useRouter();
  const layout = useLayout();
  const brand = useBranding();
  const [children, setChildren] = useState(null);
  const [notices, setNotices] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, n] = await Promise.all([
        api.children(token),
        api.parentNotifications(token).catch(() => ({ notifications: [] })),
      ]);
      setChildren(r.children || []);
      setNotices(n.notifications || []);
    } catch (e) { setError(e.message); setChildren([]); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (children === null) return <Screen><Card><Skeleton rows={3} height={110} /></Card></Screen>;

  const owed = children.reduce((n, c) => n + (c.fees?.balance || 0) + (c.canteen?.amount_owed || 0), 0);
  const parentName = profile?.parent?.full_name;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />

      {children.length === 0 ? (
        <>
          <Card>
            <EmptyState
              icon="users" title="No children linked yet"
              message="Ask the school to link your child to this account. They match on the phone number or email you gave them."
              action={<ContactSchool title="Message the school" icon="whatsapp" full={false} />}
            />
          </Card>
        </>
      ) : (
        <>
          {/* Greeting on the page, the figure on the card. The reference does
              it this way and it is right: a slab of colour behind a person's
              name says nothing, while a slab of colour behind the amount they
              owe says exactly what it is for. */}
          <Appear distance={10}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: 2 }}>
              <Crest logo={brand.logo} size={44} tone="light" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ ...type.title, color: colors.text, fontSize: layout.isCompact ? 20 : 23 }}>
                  Hi, {firstName(parentName)}
                </Text>
                <Muted numberOfLines={1} style={{ marginTop: 2 }}>
                  {brand.school?.name || 'Your school'} · {children.length} {children.length === 1 ? 'child' : 'children'}
                </Muted>
              </View>
            </View>
          </Appear>

          <Appear distance={12} delay={60}>
            <Gradient colors={owed > 0 ? gradients.brand : gradients.success} angle={128} style={[styles.summary, shadow.raised]}>
              <View pointerEvents="none" style={styles.summaryGlow} />
              <Text style={{ ...type.micro, color: 'rgba(255,255,255,0.72)' }}>
                {owed > 0 ? 'OUTSTANDING' : 'EVERYTHING SETTLED'}
              </Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{
                ...type.display, color: '#fff', fontSize: layout.isCompact ? 27 : 31, marginTop: 4,
              }}>
                {owed > 0 ? money(owed) : 'Nothing owing'}
              </Text>
              <Text style={{ ...type.small, color: 'rgba(255,255,255,0.78)', fontWeight: '600', marginTop: 5 }}>
                {owed > 0
                  ? 'Across school fees and the canteen. No payment is taken in the app.'
                  : 'Fees and canteen are both clear this term.'}
              </Text>
            </Gradient>
          </Appear>

          {/* The school is one tap away from the first screen a parent opens.
              Before this the only way to reach it was to find the class
              teacher's thread, which most parents never had. */}
          <Card>
            <Toolbar>
              <ContactSchool variant="subtle" size="sm" title="Message the school" icon="whatsapp" />
              <Button
                variant="ghost" size="sm" icon="bell" title="Notices" full={false}
                onPress={() => router.push('/parent/notifications')}
              />
              <Button
                variant="ghost" size="sm" icon="chat" title="Conversations" full={false}
                onPress={() => router.push('/parent/messages')}
              />
            </Toolbar>
          </Card>

          <Grid min={260} columns={layout.isDesktop ? 2 : 1}>
            {children.map(c => {
              const feeBal = c.fees?.balance || 0;
              const canteen = c.canteen?.amount_owed || 0;
              const childOwed = { fees: feeBal, canteen, books: c.fees?.books_balance || 0, total: feeBal + canteen };
              return (
                <Card key={c.id} elevated>
                  <TouchableOpacity activeOpacity={0.8} onPress={() => router.push(`/parent/child/${c.id}`)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                      {/* The child's own photograph. The app has always been
                          sent one; it simply never drew it. */}
                      <Avatar name={c.name} photo={c.photo} size={54} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ ...type.heading, color: colors.text }}>{c.name}</Text>
                        <Muted numberOfLines={1}>{[c.class_name, c.index_number].filter(Boolean).join(' · ')}</Muted>
                        {c.class_teacher ? <Muted numberOfLines={1}>Class teacher: {c.class_teacher}</Muted> : null}
                      </View>
                      <Icon name="chevron" size={16} color={colors.faint} />
                    </View>

                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                      <Money label="School fees" value={feeBal} />
                      <Money label="Canteen" value={canteen} />
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
                  </TouchableOpacity>

                  {childOwed.total > 0 ? (
                    <View style={{ marginTop: spacing.md }}>
                      <SettleBalance
                        child={c} owed={childOwed} term={c.term}
                        parentName={parentName} variant="subtle" size="sm" full
                      />
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </Grid>

          {notices.length ? (
            <Section
              title="From the school" icon="bell"
              subtitle="The latest notices and messages."
              action={<Button size="sm" variant="ghost" title="All notices" full={false} onPress={() => router.push('/parent/notifications')} />}
            >
              {notices.slice(0, 4).map((n, i) => (
                <View key={n.id ?? i} style={{ paddingVertical: 8 }}>
                  {n.title ? <Text style={{ ...type.body, fontWeight: '700', color: colors.text }}>{n.title}</Text> : null}
                  <Muted numberOfLines={2} style={{ marginTop: 2 }}>{n.body || n.message_body}</Muted>
                  {n.at || n.sent_at ? <Micro style={{ marginTop: 3 }}>{String(n.at || n.sent_at).slice(0, 16).replace('T', ' ')}</Micro> : null}
                  {i < Math.min(3, notices.length - 1) ? <Divider /> : null}
                </View>
              ))}
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}

// A figure that is money, in the tile a parent's eye goes to first.
function Money({ label, value }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md }}>
      <Micro>{label}</Micro>
      <Text
        numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
        style={{
          ...type.body, fontWeight: '800', marginTop: 3, fontSize: 15,
          color: value > 0 ? colors.danger : colors.success, fontVariant: ['tabular-nums'],
        }}
      >{money(value)}</Text>
    </View>
  );
}

const styles = {
  summary: { borderRadius: radius.lg, padding: spacing.xl, overflow: 'hidden' },
  summaryGlow: {
    position: 'absolute', right: -60, top: -70, width: 210, height: 210,
    borderRadius: 105, backgroundColor: 'rgba(255,255,255,0.09)',
  },
};
