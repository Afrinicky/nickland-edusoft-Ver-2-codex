// Nickland Edusoft — the icon set, drawn rather than fetched.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every icon here is built from plain Views: rounded rectangles, rings, bars
// and border-trick triangles. That is a deliberate choice over two easier ones.
//
//   Emoji — what the app used — are somebody else's artwork. They differ on
//   Android, iOS and every desktop browser, they carry their own colour, and a
//   navigation bar of them reads as a chat message rather than as a school's
//   system.
//
//   An SVG library would draw these in a tenth of the code, but it is a native
//   dependency, and this project ships one bundle to a phone APK, a desktop
//   installer and a Vercel deploy. A geometric set costs nothing at runtime,
//   renders identically everywhere, and inherits `color` like text does.
//
// Each icon is drawn inside a square of `size`, so a caller only ever sets
// `size` and `color`. Stroke weight scales with the box, so a 16px icon in a
// pill and a 26px icon in the sidebar both look drawn by the same hand.

import React from 'react';
import { View } from 'react-native';

const S = (size) => Math.max(1.4, Math.round(size / 12));   // stroke weight

function Box({ size, children, style }) {
  return <View style={[{ width: size, height: size }, style]}>{children}</View>;
}

// An absolutely-placed rounded rectangle, in fractions of the box.
function R({ x, y, w, h, size, color, fill, radius = 0.16, opacity = 1, rotate }) {
  const s = S(size);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x * size, top: y * size, width: w * size, height: h * size,
        borderRadius: radius * size,
        borderWidth: fill ? 0 : s,
        borderColor: color,
        backgroundColor: fill ? color : 'transparent',
        opacity,
        transform: rotate ? [{ rotate: `${rotate}deg` }] : undefined,
      }}
    />
  );
}

// A bar — a filled rectangle whose thickness follows the stroke weight.
function Bar({ x, y, w, size, color, opacity = 1, rotate, thickness }) {
  const s = thickness || S(size);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x * size, top: y * size, width: w * size, height: s,
        borderRadius: s, backgroundColor: color, opacity,
        transform: rotate ? [{ rotate: `${rotate}deg` }] : undefined,
      }}
    />
  );
}

function Ring({ cx, cy, r, size, color, fill, opacity = 1 }) {
  const s = S(size);
  const d = r * 2 * size;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (cx - r) * size, top: (cy - r) * size, width: d, height: d,
        borderRadius: d / 2,
        borderWidth: fill ? 0 : s,
        borderColor: color,
        backgroundColor: fill ? color : 'transparent',
        opacity,
      }}
    />
  );
}

// Triangles have no primitive, so they are drawn with the border trick: a
// zero-sized box whose two side borders are transparent.
function Tri({ x, y, w, h, size, color, rotate = 0, opacity = 1 }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x * size, top: y * size,
        width: 0, height: 0,
        borderLeftWidth: (w * size) / 2, borderRightWidth: (w * size) / 2,
        borderBottomWidth: h * size,
        borderLeftColor: 'transparent', borderRightColor: 'transparent',
        borderBottomColor: color,
        opacity,
        transform: rotate ? [{ rotate: `${rotate}deg` }] : undefined,
      }}
    />
  );
}

const DRAW = {
  // Overview
  // A pitched roof over a body — the front door of the app. The roof is a
  // triangle and the body a rounded rectangle tucked under it, so at 19px in a
  // sidebar it still reads as a house rather than as an arrow on a box.
  home: (p) => (<>
    <Tri {...p} x={0.50} y={0.14} w={0.84} h={0.34} />
    <R {...p} x={0.18} y={0.46} w={0.64} h={0.40} radius={0.06} />
    <R {...p} x={0.41} y={0.62} w={0.18} h={0.24} radius={0.03} fill />
  </>),
  grid: (p) => (<>
    <R {...p} x={0.10} y={0.10} w={0.33} h={0.33} radius={0.08} fill />
    <R {...p} x={0.57} y={0.10} w={0.33} h={0.33} radius={0.08} fill opacity={0.55} />
    <R {...p} x={0.10} y={0.57} w={0.33} h={0.33} radius={0.08} fill opacity={0.55} />
    <R {...p} x={0.57} y={0.57} w={0.33} h={0.33} radius={0.08} fill />
  </>),

  // People
  users: (p) => (<>
    <Ring {...p} cx={0.40} cy={0.30} r={0.17} fill />
    <R {...p} x={0.12} y={0.56} w={0.56} h={0.32} radius={0.16} fill />
    <Ring {...p} cx={0.76} cy={0.34} r={0.12} fill opacity={0.5} />
    <R {...p} x={0.64} y={0.60} w={0.28} h={0.26} radius={0.13} fill opacity={0.5} />
  </>),
  user: (p) => (<>
    <Ring {...p} cx={0.5} cy={0.31} r={0.18} fill />
    <R {...p} x={0.16} y={0.58} w={0.68} h={0.32} radius={0.16} fill />
  </>),

  // The register
  check: (p) => (<>
    <R {...p} x={0.08} y={0.10} w={0.84} h={0.80} radius={0.20} />
    <Bar {...p} x={0.24} y={0.52} w={0.20} rotate={45} />
    <Bar {...p} x={0.38} y={0.44} w={0.36} rotate={-45} />
  </>),
  tick: (p) => (<>
    <Bar {...p} x={0.14} y={0.55} w={0.26} rotate={45} />
    <Bar {...p} x={0.32} y={0.46} w={0.56} rotate={-45} />
  </>),

  // Marks and results
  chart: (p) => (<>
    <R {...p} x={0.10} y={0.60} w={0.18} h={0.30} radius={0.05} fill opacity={0.5} />
    <R {...p} x={0.41} y={0.38} w={0.18} h={0.52} radius={0.05} fill opacity={0.75} />
    <R {...p} x={0.72} y={0.16} w={0.18} h={0.74} radius={0.05} fill />
  </>),
  layers: (p) => (<>
    <R {...p} x={0.14} y={0.14} w={0.72} h={0.16} radius={0.07} fill />
    <R {...p} x={0.14} y={0.42} w={0.52} h={0.16} radius={0.07} fill opacity={0.7} />
    <R {...p} x={0.14} y={0.70} w={0.66} h={0.16} radius={0.07} fill opacity={0.45} />
  </>),
  award: (p) => (<>
    <Ring {...p} cx={0.5} cy={0.36} r={0.26} />
    <Bar {...p} x={0.20} y={0.76} w={0.26} rotate={-24} />
    <Bar {...p} x={0.54} y={0.76} w={0.26} rotate={24} />
  </>),

  // Work
  book: (p) => (<>
    <R {...p} x={0.14} y={0.10} w={0.72} h={0.80} radius={0.12} />
    <Bar {...p} x={0.30} y={0.34} w={0.40} />
    <Bar {...p} x={0.30} y={0.52} w={0.28} />
  </>),
  note: (p) => (<>
    <R {...p} x={0.16} y={0.08} w={0.68} h={0.84} radius={0.12} />
    <Bar {...p} x={0.30} y={0.32} w={0.40} />
    <Bar {...p} x={0.30} y={0.50} w={0.40} />
    <Bar {...p} x={0.30} y={0.68} w={0.22} />
  </>),
  calendar: (p) => (<>
    <R {...p} x={0.10} y={0.16} w={0.80} h={0.74} radius={0.14} />
    <Bar {...p} x={0.10} y={0.36} w={0.80} />
    <Bar {...p} x={0.28} y={0.06} w={0.001} thickness={S(p.size)} />
    <R {...p} x={0.28} y={0.60} w={0.12} h={0.12} radius={0.05} fill />
    <R {...p} x={0.60} y={0.60} w={0.12} h={0.12} radius={0.05} fill opacity={0.55} />
  </>),
  clock: (p) => (<>
    <Ring {...p} cx={0.5} cy={0.5} r={0.40} />
    <Bar {...p} x={0.50} y={0.50} w={0.22} rotate={-60} />
    <Bar {...p} x={0.50} y={0.50} w={0.28} rotate={10} />
  </>),

  // Money and food
  wallet: (p) => (<>
    <R {...p} x={0.08} y={0.22} w={0.84} h={0.58} radius={0.16} />
    <Ring {...p} cx={0.72} cy={0.51} r={0.09} fill />
  </>),
  // A school bus in side view: a body, a windscreen band and two wheels under
  // it. Transport is the one module whose subject is a vehicle, so it gets one.
  bus: (p) => (<>
    <R {...p} x={0.10} y={0.20} w={0.80} h={0.50} radius={0.12} />
    <Bar {...p} x={0.14} y={0.40} w={0.72} />
    <Ring {...p} cx={0.30} cy={0.78} r={0.10} fill />
    <Ring {...p} cx={0.70} cy={0.78} r={0.10} fill />
  </>),
  // A payslip: a sheet with a column rule down it and two ruled lines, which is
  // what a salary schedule looks like on paper in every school office.
  payroll: (p) => (<>
    <R {...p} x={0.12} y={0.14} w={0.76} h={0.72} radius={0.10} />
    <Bar {...p} x={0.12} y={0.36} w={0.76} />
    <Bar {...p} x={0.36} y={0.36} w={0.50} rotate={90} />
    <Bar {...p} x={0.52} y={0.52} w={0.28} />
    <Bar {...p} x={0.52} y={0.66} w={0.20} />
  </>),
  bowl: (p) => (<>
    <Bar {...p} x={0.14} y={0.36} w={0.72} />
    <View pointerEvents="none" style={{
      position: 'absolute', left: 0.16 * p.size, top: 0.44 * p.size,
      width: 0.68 * p.size, height: 0.34 * p.size,
      borderWidth: S(p.size), borderTopWidth: 0, borderColor: p.color,
      borderBottomLeftRadius: 0.34 * p.size, borderBottomRightRadius: 0.34 * p.size,
    }} />
  </>),

  // Talking
  chat: (p) => (<>
    <R {...p} x={0.08} y={0.14} w={0.84} h={0.58} radius={0.18} />
    <Tri {...p} x={0.24} y={0.66} w={0.22} h={0.22} rotate={180} />
    <Ring {...p} cx={0.34} cy={0.43} r={0.055} fill />
    <Ring {...p} cx={0.50} cy={0.43} r={0.055} fill />
    <Ring {...p} cx={0.66} cy={0.43} r={0.055} fill />
  </>),
  bell: (p) => (<>
    <View pointerEvents="none" style={{
      position: 'absolute', left: 0.18 * p.size, top: 0.14 * p.size,
      width: 0.64 * p.size, height: 0.50 * p.size,
      borderWidth: S(p.size), borderBottomWidth: 0, borderColor: p.color,
      borderTopLeftRadius: 0.32 * p.size, borderTopRightRadius: 0.32 * p.size,
    }} />
    <Bar {...p} x={0.10} y={0.64} w={0.80} />
    <Ring {...p} cx={0.5} cy={0.84} r={0.09} fill />
  </>),
  send: (p) => (<>
    <Tri {...p} x={0.20} y={0.10} w={0.60} h={0.62} rotate={90} />
  </>),

  // The teacher themselves
  badge: (p) => (<>
    <R {...p} x={0.12} y={0.12} w={0.76} h={0.76} radius={0.18} />
    <Ring {...p} cx={0.5} cy={0.40} r={0.12} fill />
    <Bar {...p} x={0.28} y={0.66} w={0.44} />
  </>),
  gear: (p) => (<>
    <Ring {...p} cx={0.5} cy={0.5} r={0.24} />
    <Bar {...p} x={0.46} y={0.04} w={0.001} thickness={S(p.size)} />
    <R {...p} x={0.44} y={0.02} w={0.12} h={0.16} radius={0.05} fill />
    <R {...p} x={0.44} y={0.82} w={0.12} h={0.16} radius={0.05} fill />
    <R {...p} x={0.02} y={0.44} w={0.16} h={0.12} radius={0.05} fill />
    <R {...p} x={0.82} y={0.44} w={0.16} h={0.12} radius={0.05} fill />
  </>),
  logout: (p) => (<>
    <View pointerEvents="none" style={{
      position: 'absolute', left: 0.08 * p.size, top: 0.12 * p.size,
      width: 0.46 * p.size, height: 0.76 * p.size,
      borderWidth: S(p.size), borderRightWidth: 0, borderColor: p.color,
      borderTopLeftRadius: 0.16 * p.size, borderBottomLeftRadius: 0.16 * p.size,
    }} />
    <Bar {...p} x={0.46} y={0.49} w={0.44} />
    <Bar {...p} x={0.70} y={0.36} w={0.20} rotate={45} />
    <Bar {...p} x={0.70} y={0.62} w={0.20} rotate={-45} />
  </>),

  // Utility
  search: (p) => (<>
    <Ring {...p} cx={0.43} cy={0.43} r={0.31} />
    <Bar {...p} x={0.63} y={0.74} w={0.26} rotate={45} />
  </>),
  plus: (p) => (<>
    <Bar {...p} x={0.16} y={0.49} w={0.68} />
    <Bar {...p} x={0.16} y={0.49} w={0.68} rotate={90} />
  </>),
  close: (p) => (<>
    <Bar {...p} x={0.14} y={0.49} w={0.72} rotate={45} />
    <Bar {...p} x={0.14} y={0.49} w={0.72} rotate={-45} />
  </>),
  chevron: (p) => (<>
    <Bar {...p} x={0.34} y={0.34} w={0.34} rotate={45} />
    <Bar {...p} x={0.34} y={0.64} w={0.34} rotate={-45} />
  </>),
  back: (p) => (<>
    <Bar {...p} x={0.14} y={0.49} w={0.72} />
    <Bar {...p} x={0.14} y={0.36} w={0.26} rotate={-45} />
    <Bar {...p} x={0.14} y={0.62} w={0.26} rotate={45} />
  </>),
  filter: (p) => (<>
    <Bar {...p} x={0.10} y={0.24} w={0.80} />
    <Bar {...p} x={0.22} y={0.49} w={0.56} />
    <Bar {...p} x={0.36} y={0.74} w={0.28} />
  </>),
  refresh: (p) => (<>
    <View pointerEvents="none" style={{
      position: 'absolute', left: 0.14 * p.size, top: 0.14 * p.size,
      width: 0.72 * p.size, height: 0.72 * p.size,
      borderRadius: 0.36 * p.size,
      borderWidth: S(p.size), borderColor: p.color, borderTopColor: 'transparent',
    }} />
    <Tri {...p} x={0.56} y={0.02} w={0.26} h={0.22} rotate={135} />
  </>),
  alert: (p) => (<>
    <Tri {...p} x={0.06} y={0.14} w={0.88} h={0.72} />
    <Bar {...p} x={0.47} y={0.45} w={0.001} thickness={S(p.size)} />
    <R {...p} x={0.455} y={0.42} w={0.09} h={0.24} radius={0.05} fill />
  </>),
  sparkle: (p) => (<>
    <R {...p} x={0.38} y={0.06} w={0.24} h={0.88} radius={0.12} fill />
    <R {...p} x={0.06} y={0.38} w={0.88} h={0.24} radius={0.12} fill />
  </>),
  school: (p) => (<>
    <Tri {...p} x={0.04} y={0.10} w={0.92} h={0.34} />
    <R {...p} x={0.16} y={0.46} w={0.68} h={0.44} radius={0.10} />
    <R {...p} x={0.42} y={0.64} w={0.16} h={0.26} radius={0.05} fill />
  </>),
  phone: (p) => (<>
    <R {...p} x={0.26} y={0.06} w={0.48} h={0.88} radius={0.16} />
    <Bar {...p} x={0.40} y={0.80} w={0.20} />
  </>),
  mail: (p) => (<>
    <R {...p} x={0.06} y={0.20} w={0.88} h={0.60} radius={0.14} />
    <Bar {...p} x={0.14} y={0.34} w={0.42} rotate={26} />
    <Bar {...p} x={0.46} y={0.34} w={0.42} rotate={-26} />
  </>),
  pin: (p) => (<>
    <Ring {...p} cx={0.5} cy={0.40} r={0.30} />
    <Ring {...p} cx={0.5} cy={0.40} r={0.10} fill />
    <Tri {...p} x={0.32} y={0.64} w={0.36} h={0.30} rotate={180} />
  </>),
  download: (p) => (<>
    <Bar {...p} x={0.49} y={0.10} w={0.46} rotate={90} />
    <Bar {...p} x={0.28} y={0.46} w={0.24} rotate={45} />
    <Bar {...p} x={0.48} y={0.46} w={0.24} rotate={-45} />
    <Bar {...p} x={0.14} y={0.84} w={0.72} />
  </>),

  // ── added for the report cards, the daily collection and the chat button ──
  // A printer: the paper going in at the top, the body, the sheet coming out.
  print: (p) => (<>
    <R {...p} x={0.28} y={0.08} w={0.44} h={0.20} radius={0.03} />
    <R {...p} x={0.12} y={0.30} w={0.76} h={0.36} radius={0.07} />
    <Ring {...p} cx={0.74} cy={0.42} r={0.045} fill />
    <R {...p} x={0.28} y={0.62} w={0.44} h={0.30} radius={0.03} />
  </>),
  // A speech bubble with a tail, distinct from `chat` so "message the school"
  // and "messages" are not the same mark doing two jobs.
  whatsapp: (p) => (<>
    <Ring {...p} cx={0.5} cy={0.47} r={0.36} />
    <Tri {...p} x={0.16} y={0.72} w={0.24} h={0.22} rotate={0} />
    <Bar {...p} x={0.34} y={0.40} w={0.32} />
    <Bar {...p} x={0.34} y={0.55} w={0.22} />
  </>),
  // A banknote — used where a figure is money rather than a mark.
  cash: (p) => (<>
    <R {...p} x={0.08} y={0.26} w={0.84} h={0.48} radius={0.06} />
    <Ring {...p} cx={0.5} cy={0.50} r={0.13} />
  </>),
  // A rising line: a trend, a term-on-term comparison.
  trend: (p) => (<>
    <Bar {...p} x={0.10} y={0.62} w={0.28} rotate={-28} />
    <Bar {...p} x={0.36} y={0.50} w={0.24} rotate={22} />
    <Bar {...p} x={0.56} y={0.40} w={0.32} rotate={-38} />
    <Ring {...p} cx={0.86} cy={0.22} r={0.075} fill />
  </>),
  // A ticked list — a register, a roll being marked.
  list: (p) => (<>
    <Bar {...p} x={0.36} y={0.24} w={0.52} />
    <Bar {...p} x={0.36} y={0.50} w={0.52} />
    <Bar {...p} x={0.36} y={0.76} w={0.52} />
    <Ring {...p} cx={0.18} cy={0.25} r={0.07} fill />
    <Ring {...p} cx={0.18} cy={0.51} r={0.07} fill />
    <Ring {...p} cx={0.18} cy={0.77} r={0.07} fill />
  </>),
  // A shield — conduct, standing, anything about character rather than marks.
  shield: (p) => (<>
    <R {...p} x={0.20} y={0.10} w={0.60} h={0.52} radius={0.06} />
    <Tri {...p} x={0.24} y={0.58} w={0.52} h={0.32} rotate={180} />
  </>),
  // An open box — nothing here yet, a cleared list.
  box: (p) => (<>
    <R {...p} x={0.12} y={0.32} w={0.76} h={0.52} radius={0.06} />
    <Bar {...p} x={0.12} y={0.46} w={0.76} />
  </>),

  // ── the drawer, the onboarding, the pupil's day ──
  // Three rules. The middle one is shorter, which is what stops it reading as
  // a stack of list items.
  menu: (p) => (<>
    <Bar {...p} x={0.16} y={0.28} w={0.68} />
    <Bar {...p} x={0.16} y={0.49} w={0.48} />
    <Bar {...p} x={0.16} y={0.70} w={0.68} />
  </>),
  // An arrow leading on — "Next", "Get started".
  arrow: (p) => (<>
    <Bar {...p} x={0.14} y={0.49} w={0.60} />
    <Bar {...p} x={0.56} y={0.34} w={0.26} rotate={45} />
    <Bar {...p} x={0.56} y={0.64} w={0.26} rotate={-45} />
  </>),
  // A crown — the school's own standing, a top place in class.
  crown: (p) => (<>
    <Tri {...p} x={0.08} y={0.24} w={0.28} h={0.30} />
    <Tri {...p} x={0.36} y={0.16} w={0.28} h={0.38} />
    <Tri {...p} x={0.64} y={0.24} w={0.28} h={0.30} />
    <R {...p} x={0.12} y={0.60} w={0.76} h={0.20} radius={0.04} fill />
  </>),
  // A padlock — a password field, anything held shut.
  lock: (p) => (<>
    <R {...p} x={0.18} y={0.44} w={0.64} h={0.42} radius={0.08} />
    <Ring {...p} cx={0.5} cy={0.34} r={0.20} />
    <R {...p} x={0.28} y={0.26} w={0.44} h={0.22} radius={0} fill opacity={0} />
  </>),
  // An open eye — reveal what was typed.
  eye: (p) => (<>
    <Ring {...p} cx={0.5} cy={0.5} r={0.20} />
    <Ring {...p} cx={0.5} cy={0.5} r={0.07} fill />
    <Bar {...p} x={0.06} y={0.36} w={0.24} rotate={26} />
    <Bar {...p} x={0.70} y={0.36} w={0.24} rotate={-26} />
    <Bar {...p} x={0.06} y={0.64} w={0.24} rotate={-26} />
    <Bar {...p} x={0.70} y={0.64} w={0.24} rotate={26} />
  </>),
  // A rosette — a school, an achievement, the app's own mark at rest.
  spark: (p) => (<>
    <Ring {...p} cx={0.5} cy={0.42} r={0.26} />
    <Ring {...p} cx={0.5} cy={0.42} r={0.10} fill />
    <Bar {...p} x={0.30} y={0.80} w={0.18} rotate={70} />
    <Bar {...p} x={0.52} y={0.80} w={0.18} rotate={-70} />
  </>),
};

/**
 * A single icon.
 *
 * @param {string} name   one of the keys in DRAW
 * @param {number} size   the square it is drawn in (default 22)
 * @param {string} color  inherited like text colour
 */
export function Icon({ name, size = 22, color = '#0B1220', style }) {
  const draw = DRAW[name];
  if (!draw) return <Box size={size} style={style} />;
  return <Box size={size} style={style}>{draw({ size, color })}</Box>;
}

export const iconNames = Object.keys(DRAW);
export default Icon;
