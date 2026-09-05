// Nickland Edusoft — The register of what has been taken.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every receipt written, whatever it was for, in one list. This is the screen
// a bursar balances the drawer against at four o'clock and the one a proprietor
// opens to see what came in this week — which is why it counts school fees,
// books, the canteen and the bus together rather than making somebody add up
// four modules.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { useOfficeClasses } from '../../pickers';
import { cedis, shortDate } from '../../office';
import {
  Select, SearchField, DataTable, Muted, Badge, Button, ErrorNote, Loading, Field,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { printHtml } from '../../print';
import { ReceiptView } from './receipt';
import { colors, spacing, type } from '../../theme';

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' },
  { id: 'all', label: 'Everything' },
  { id: 'custom', label: 'Between dates' },
];

function rangeDates(id) {
  if (id === 'today') return [todayISO(), todayISO()];
  if (id === 'week') return [daysAgo(6), todayISO()];
  if (id === 'month') return [daysAgo(29), todayISO()];
  if (id === 'all') return [null, null];
  return null;
}

export default function PaymentRegister() {
  const { token } = useAuth();
  const { classes } = useOfficeClasses(token);

  const [config, setConfig] = useState({ purposes: [], methods: [] });
  const [range, setRange] = useState('today');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [purposes, setPurposes] = useState([]);
  const [classId, setClassId] = useState('');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    api.paymentPurposes(token).then(r => r && r.ok && setConfig(r)).catch(() => {});
  }, [token]);

  useEffect(() => {
    const d = rangeDates(range);
    if (d) { setFrom(d[0]); setTo(d[1]); }
  }, [range]);

  useEffect(() => {
    let live = true;
    const id = setTimeout(async () => {
      try {
        const r = await api.paymentRegister(token, {
          from: from || undefined, to: to || undefined,
          purposes: purposes.length ? purposes.join(',') : undefined,
          classId: classId || undefined,
          method: method || undefined,
          q: q.trim() || undefined,
        });
        if (live) setData(r);
      } catch (e) { if (live) { setError(e.message); setData({ payments: [], total: 0, count: 0 }); } }
    }, 200);
    return () => { live = false; clearTimeout(id); };
  }, [token, from, to, purposes.join(','), classId, method, q]);

  const rows = data?.payments || [];

  // The drawer, split by how the money arrived — the split that matters when
  // you are counting notes against a screen.
  const byMethod = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const k = r.payment_method || 'Cash';
      map.set(k, (map.get(k) || 0) + (Number(r.amount) || 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  async function openReceipt(row) {
    try {
      const r = await api.paymentReceipt(token, row.source, row.id);
      setReceipt(r.receipt);
    } catch (e) { setError(e.message); }
  }

  async function print() {
    if (!receipt) return;
    setPrinting(true);
    try {
      const doc = await api.receiptHtml(token, receipt.source, receipt.payment_id,
        { purpose: receipt.purpose });
      await printHtml(doc);
    } catch (e) { setError(e.message); }
    finally { setPrinting(false); }
  }

  if (receipt) {
    return (
      <Panel>
        <ReceiptView receipt={receipt} busy={printing} onPrint={print}
                     onClose={() => setReceipt(null)} />
      </Panel>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorNote message={error} />

      <StatRow>
        <Stat index={0} label="Taken" icon="wallet" tone="success"
              value={cedis(data?.total || 0)}
              note={from || to ? `${from || 'the beginning'} → ${to || 'today'}`
                : 'every payment on record'} />
        <Stat index={1} label="Receipts" icon="check" tone="primary"
              value={String(data?.count || 0)}
              note={rows.length >= 400 ? 'showing the most recent 400' : 'every one in the range'} />
        <Stat index={2} label="Cash" icon="wallet" tone="data"
              value={cedis((byMethod.find(([m]) => m === 'Cash') || [null, 0])[1])}
              note="what should be in the drawer" />
        <Stat index={3} label="Sent in" icon="trend" tone="primary"
              value={cedis(byMethod.filter(([m]) => m !== 'Cash')
                .reduce((n, [, v]) => n + v, 0))}
              note="mobile money, bank and cheque" />
      </StatRow>

      <Panel padded={false} title="Every receipt written"
             subtitle="School fees, books, the canteen and the bus together">
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Bar left={<>
            <View style={{ minWidth: 160 }}>
              <Select label="" value={range} onChange={setRange}
                      options={RANGES.map(r => ({ label: r.label, value: r.id }))} />
            </View>
            {range === 'custom' ? (
              <>
                <View style={{ minWidth: 140 }}>
                  <Field label="" value={from || ''} onChangeText={setFrom} placeholder="From (YYYY-MM-DD)" />
                </View>
                <View style={{ minWidth: 140 }}>
                  <Field label="" value={to || ''} onChangeText={setTo} placeholder="To (YYYY-MM-DD)" />
                </View>
              </>
            ) : null}
            <View style={{ minWidth: 160 }}>
              <Select label="" value={classId} onChange={setClassId} placeholder="Every class"
                      options={[{ label: 'Every class', value: '' },
                                ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
            </View>
            <View style={{ minWidth: 160 }}>
              <Select label="" value={method} onChange={setMethod} placeholder="Any method"
                      options={[{ label: 'Any method', value: '' },
                                ...config.methods.map(m => ({ label: m, value: m }))]} />
            </View>
            <View style={{ minWidth: 200, flex: 1 }}>
              <SearchField value={q} onChangeText={setQ}
                           placeholder="Name, admission number or receipt" />
            </View>
          </>} />

          {/* Which purposes are counted. Off means all of them, which is what
              a proprietor asking "what came in" means. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <Muted>Paid for:</Muted>
            {config.purposes.map(p => {
              const on = purposes.includes(p.key);
              return (
                <Button key={p.key} title={p.label} size="sm" full={false}
                        variant={on ? 'primary' : 'outline'}
                        onPress={() => setPurposes(list =>
                          (on ? list.filter(k => k !== p.key) : [...list, p.key]))} />
              );
            })}
            {purposes.length ? (
              <Button title="All of them" size="sm" variant="ghost" full={false}
                      onPress={() => setPurposes([])} />
            ) : null}
          </View>

          {data === null ? <Loading label="Reading the register…" /> : (
            <DataTable
              keyExtractor={(r) => `${r.source}-${r.id}`}
              empty="Nothing taken in that range. Widen the dates, or clear a filter."
              onRowPress={openReceipt}
              columns={[
                { key: 'receipt_number', label: 'Receipt', width: 140 },
                { key: 'name', label: 'Pupil',
                  render: (r) => (
                    <View style={{ minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                        {`${r.surname || ''} ${r.first_name || ''}`.trim()}
                      </Text>
                      <Muted numberOfLines={1}>{[r.index_number, r.class_name].filter(Boolean).join(' · ')}</Muted>
                    </View>
                  ) },
                { key: 'source', label: 'Paid for', width: 130,
                  render: (r) => <Badge tone="data" label={sourceLabel(r.source)} /> },
                { key: 'payment_date', label: 'Date', width: 110,
                  render: (r) => shortDate(r.payment_date) },
                { key: 'payment_method', label: 'How', width: 150,
                  render: (r) => (
                    <View style={{ minWidth: 0 }}>
                      <Text style={{ ...type.small, color: colors.text }}>{r.payment_method}</Text>
                      {r.reference ? <Muted numberOfLines={1}>{r.reference}</Muted> : null}
                    </View>
                  ) },
                { key: 'received_by_name', label: 'Taken by', width: 150 },
                { key: 'amount', label: 'Amount', align: 'right', width: 120,
                  render: (r) => (
                    <Text style={{
                      ...type.small, fontWeight: '700', color: '#15803D',
                      fontVariant: ['tabular-nums'],
                    }}>{cedis(r.amount)}</Text>
                  ) },
              ]}
              rows={rows} />
          )}
        </View>
      </Panel>
    </View>
  );
}

function sourceLabel(source) {
  return { fees: 'School fees', books: 'Books', canteen: 'Canteen', transport: 'Transport' }[source] || source;
}
