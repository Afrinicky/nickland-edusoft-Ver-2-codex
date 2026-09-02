// Nickland Edusoft — one build, every screen size.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The browser app is opened on a 320px Android phone, a 6.7-inch iPhone, a
// 10-inch tablet in a staffroom and a 24-inch desktop in the office — from one
// bundle. This is the single place that decides which of those it is, so a
// screen asks `layout.isDesktop` rather than measuring the window itself and
// picking its own thresholds.
//
// Three shapes, not a continuum:
//
//   phone    < 768   one column, bottom navigation, full-bleed cards
//   tablet   768+    two columns, a rail of icons down the side
//   desktop  1180+   two or three columns, a labelled sidebar, a content
//                    column that stops widening so a table row does not run
//                    the width of a cinema screen
//
// `useLayout()` re-renders on rotation and on a browser window being dragged,
// because `useWindowDimensions` is subscribed to both.

import { useWindowDimensions, Platform } from 'react-native';
import { breakpoints, spacing } from './theme';

// Above this, extra width becomes margin rather than line length. Reading a
// register is a column of names; stretching it to 2500px helps nobody.
const CONTENT_MAX = 1240;
const READING_MAX = 760;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';

  const isDesktop = width >= breakpoints.desktop;
  const isTablet = !isDesktop && width >= breakpoints.tablet;
  const isPhone = !isDesktop && !isTablet;
  const isCompact = width < 380;           // the small Android handsets

  // The side navigation is a browser affordance. A phone-sized browser window
  // gets the bottom bar, exactly as the phone app does.
  const nav = isDesktop ? 'sidebar' : isTablet ? 'rail' : 'bottom';

  return {
    width, height, isWeb,
    isPhone, isTablet, isDesktop, isCompact,
    nav,
    sidebarWidth: isDesktop ? (width >= breakpoints.wide ? 268 : 236) : isTablet ? 76 : 0,
    // Page gutters grow with the window; a 16px margin on a desktop looks like
    // a phone screenshot that has been stretched.
    gutter: isDesktop ? spacing.xl : isTablet ? spacing.lg + 4 : spacing.lg,
    contentMax: isDesktop ? CONTENT_MAX : null,
    readingMax: isDesktop ? READING_MAX : null,
    // How many cards fit across: metrics, quick actions, pupil tiles.
    columns: isDesktop ? 4 : isTablet ? 3 : isCompact ? 1 : 2,
    // Wide enough to show a real table rather than stacked rows.
    canTable: width >= breakpoints.tablet,
  };
}

// The width a centred page body should take. Used by Screen; exported so a
// screen that lays its own body out (a full-bleed table, a chat thread) can
// match it.
export function pageWidth(layout, variant = 'page') {
  if (!layout.contentMax) return { width: '100%' };
  const max = variant === 'reading' ? (layout.readingMax || layout.contentMax) : layout.contentMax;
  return { width: '100%', maxWidth: max, marginHorizontal: 'auto' };
}

export default useLayout;
