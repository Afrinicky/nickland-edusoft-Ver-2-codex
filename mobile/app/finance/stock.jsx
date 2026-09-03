// The store room — what the school owns and what is running out.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { can } from '../../src/guard';
import { OfficeScreen, cedis, useOffice } from '../../src/office';
import {
  Card, Section, Grid, StatCard, DataTable, Muted, EmptyState, Badge,
  Button, Sheet, Field, Select, ErrorNote, SegmentedControl,
} from '../../src/ui';
import { colors, type } from '../../src/theme';

export default function Stock() {
  const { token, profile } = useAuth();
  const state = useOffice((t) => api.school.inventory(t));
  const [moving, setMoving] = useState(null);
  const [direction, setDirection] = useState('in');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const mayMove = can(profile, 'finance', 'create');
  const d = state.data;

  async function move() {
    setError(null);
    if (!(Number(quantity) > 0)) return setError('Enter how many.');
    setBusy(true);
    try {
      await api.school.moveStock(token, {
        item_id: moving.id, type: direction, quantity: Number(quantity),
      });
      setMoving(null); setQuantity('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      {d ? (
        (d.items || []).length === 0 ? (
          <Card><EmptyState icon="bowl" title="Nothing on the shelves"
            message="No stock item has been set up yet." /></Card>
        ) : (
          <>
            <Grid min={162}>
              <StatCard label="Items" value={d.items.length} tone="neutral" icon="layers" />
              <StatCard label="What it is worth" value={cedis(d.value)} tone="data" icon="wallet" />
              <StatCard label="Running low" value={d.low_stock}
                tone={d.low_stock ? 'warning' : 'success'} icon="alert" />
            </Grid>

            <Section title="Stock" icon="bowl">
              <Card padded={false}>
                <DataTable keyExtractor={(r) => String(r.id)}
                  onRowPress={mayMove ? (r) => { setError(null); setMoving(r); setDirection('in'); } : undefined}
                  columns={[
                    { key: 'name', label: 'Item', render: (r) => (
                      <View>
                        <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                          {r.name}
                        </Text>
                        <Muted numberOfLines={1}>
                          {[r.category, r.location].filter(Boolean).join(' · ')}
                        </Muted>
                      </View>
                    ) },
                    { key: 'quantity_on_hand', label: 'On hand', align: 'right', width: 110,
                      render: (r) => {
                        const low = r.reorder_level != null && (r.quantity_on_hand || 0) <= r.reorder_level;
                        return (
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={{ ...type.small, fontWeight: '800', fontVariant: ['tabular-nums'],
                                           color: low ? colors.warning : colors.text }}>
                              {`${r.quantity_on_hand || 0}${r.unit ? ` ${r.unit}` : ''}`}
                            </Text>
                            {low ? <Badge label="Reorder" tone="warning" /> : null}
                          </View>
                        );
                      } },
                    { key: 'unit_cost', label: 'Each', align: 'right', width: 110,
                      render: (r) => <Text style={{ ...type.small, fontVariant: ['tabular-nums'] }}>
                        {r.unit_cost ? cedis(r.unit_cost) : '—'}</Text> },
                  ]}
                  rows={d.items} />
              </Card>
            </Section>
          </>
        )
      ) : null}

      <Sheet visible={!!moving} onClose={() => setMoving(null)}
        title={moving ? moving.name : 'Move stock'}>
        <ErrorNote message={error} />
        {moving ? (
          <>
            <Muted>{`${moving.quantity_on_hand || 0}${moving.unit ? ` ${moving.unit}` : ''} on hand.`}</Muted>
            <SegmentedControl value={direction} onChange={setDirection} options={[
              { label: 'Taking in', value: 'in' },
              { label: 'Issuing out', value: 'out' },
              { label: 'Damaged', value: 'damage' },
            ]} />
            <Field label="How many" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
            <Button label={busy ? 'Recording…' : 'Record it'} disabled={busy} onPress={move} icon="check" />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}
