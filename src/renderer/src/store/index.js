// Nickland Edusoft — Global Store (Zustand)
import { create } from 'zustand';

export const useStore = create((set, get) => ({
  // ── Auth ─────────────────────────────────────────────
  currentUser: null,
  isAuthenticated: false,
  permissions: {},   // { module: { canView, canCreate, canEdit, canDelete } }
  assignments: [],   // [{ class_group_id, subject_id, ... }] — for teachers

  login: async (user) => {
    // Fetch effective permissions and assignments after login
    let perms = {};
    let assigns = [];
    try {
      perms = await window.api.auth.effectivePermissions(user.id);
      assigns = await window.api.auth.listUserAssignments(user.id);
    } catch (e) { /* default to nothing */ }
    set({ currentUser: user, isAuthenticated: true, permissions: perms, assignments: assigns });
    // The class list is fetched once at start-up, before anybody has signed
    // in, so it is the whole school's. Now that we know who this is, read it
    // again: a teacher's pickers should hold their own classes, and an
    // administrator's should hold all of them.
    try { await get().loadClassesAndTerms(); } catch (_) { /* keep the start-up list */ }
  },
  logout: () => {
    const user = get().currentUser;
    if (user) {
      try { window.api.auth.logout(user.id); } catch (e) {}
    }
    set({ currentUser: null, isAuthenticated: false, permissions: {}, assignments: [] });
    // Whoever signs in next gets their own list rather than the last person's.
    get().loadClassesAndTerms().catch(() => {});
  },

  // Reload permissions (after an admin changes them) without re-logging in
  reloadPermissions: async () => {
    const user = get().currentUser;
    if (!user) return;
    try {
      const perms = await window.api.auth.effectivePermissions(user.id);
      const assigns = await window.api.auth.listUserAssignments(user.id);
      set({ permissions: perms, assignments: assigns });
    } catch (e) {}
  },

  // can('payroll', 'view') | can('finance', 'edit')
  // Levels: view < create < edit < delete (each implies all lower? No — they are independent)
  can: (module, action = 'view') => {
    // An administrator or proprietor runs the school and is held back nowhere.
    // Checked before the map is consulted, so a permission set that came back
    // empty — a failed load, an account whose designation row went missing —
    // cannot hide the app from the person who owns it.
    const designation = get().currentUser?.designation;
    if (['Proprietor', 'Administrator'].includes(designation)) return true;
    const perms = get().permissions || {};
    const p = perms[module];
    if (!p) return false;
    const map = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };
    return !!p[map[action] || 'canView'];
  },

  // Legacy hasPermission — kept for backwards compatibility, now delegates to can()
  hasPermission: (module, level = 'view') => {
    return get().can(module, level);
  },

  // ── Assignment scope ──────────────────────────────────
  // Mirrors electron/ipc/_scope.js. That file is the enforcement; this is so
  // the screens do not offer what it would refuse. The two must agree, so the
  // shape of the rules is deliberately identical:
  //
  //   class only     → the whole class, every subject in it
  //   class+subject  → that subject in that class, nothing else in it
  //   subject only   → that subject wherever it is taught
  //
  // and they combine, because a teacher can hold a class AND take a subject
  // in two others.
  //
  // Proprietor, Administrator and Head Teacher are unrestricted: a head who
  // could see only their own class could not check anybody's marks.
  isUnrestricted: () => {
    const d = get().currentUser?.designation;
    return ['Proprietor', 'Administrator', 'Head Teacher'].includes(d);
  },

  // Has this teacher been assigned to this class — as its teacher, or by
  // taking a subject in it?
  isAssignedToClass: (classGroupId) => {
    if (get().isUnrestricted()) return true;
    const cid = Number(classGroupId);
    if (!cid) return false;
    return (get().assignments || []).some(a =>
      Number(a.class_group_id) === cid || (a.class_group_id == null && a.subject_id != null)
    );
  },

  // Has this teacher been assigned to this subject in this class?
  isAssignedToSubject: (classGroupId, subjectId) => {
    if (get().isUnrestricted()) return true;
    const cid = Number(classGroupId);
    const sid = Number(subjectId);
    if (!cid || !sid) return false;
    const rows = get().assignments || [];
    // The class held outright carries every subject in it.
    if (rows.some(a => Number(a.class_group_id) === cid && a.subject_id == null)) return true;
    // A subject taught across the school.
    if (rows.some(a => a.class_group_id == null && Number(a.subject_id) === sid)) return true;
    return rows.some(a => Number(a.class_group_id) === cid && Number(a.subject_id) === sid);
  },

  // The one member of staff answerable for a class: the register, the canteen
  // sheet, the end-of-term summary.
  isClassTeacherOf: (classGroupId) => {
    if (get().isUnrestricted()) return true;
    const cid = Number(classGroupId);
    return (get().assignments || []).some(a =>
      Number(a.class_group_id) === cid && a.is_class_teacher
    );
  },

  // Does this account hold any class outright? Used to decide whether to show
  // whole-class tools at all.
  hasAnyClassTeacherRole: () => {
    if (get().isUnrestricted()) return true;
    return (get().assignments || []).some(a => a.is_class_teacher);
  },

  // ── Settings & Theme ─────────────────────────────────
  settings: {},
  // The system's own defaults, in the same values as
  // src/renderer/src/styles/index.css and mobile/src/theme.js. A school that
  // has chosen its own colours overrides them below; a school that has not
  // gets the product's, which are these.
  //
  // `fontFamily` is a KEY, not a font name: the fonts are resolved by
  // FONT_STACKS at the bottom of this file and every one of them ends in a
  // system sans. Nothing here may be fetched over a network.
  theme: {
    primary: '#5B3FE0',
    accent: '#C99A25',
    background: '#F5F4FB',
    foreground: '#14142B',
    fgMode: 'dark',
    themeMode: 'light',
    fontFamily: 'system',
    fontSize: 14,
  },

  loadSettings: async () => {
    const settings = await window.api.settings.getAll();
    const branding = settings.branding || {};
    const theme = {
      primary:    branding.school_color_primary    || '#5B3FE0',
      accent:     branding.school_color_accent     || '#C99A25',
      background: branding.school_color_background || '#F5F4FB',
      foreground: branding.school_color_foreground || '#14142B',
      fgMode:     branding.ui_foreground_mode      || 'dark',
      themeMode:  branding.ui_theme_mode           || 'light',
      fontFamily: branding.ui_font_family          || 'system',
      fontSize:   parseInt(branding.ui_font_size_base || '14', 10),
    };
    applyTheme(theme);
    set({ settings, theme });
  },

  updateSetting: async (key, value) => {
    await window.api.settings.set(key, value);
    const settings = await window.api.settings.getAll();
    set({ settings });
  },

  updateTheme: async (patch) => {
    const next = { ...get().theme, ...patch };
    applyTheme(next);
    set({ theme: next });
    const map = {
      primary: 'school_color_primary', accent: 'school_color_accent',
      background: 'school_color_background', foreground: 'school_color_foreground',
      fgMode: 'ui_foreground_mode', themeMode: 'ui_theme_mode',
      fontFamily: 'ui_font_family', fontSize: 'ui_font_size_base',
    };
    for (const [k, v] of Object.entries(patch)) {
      if (map[k]) await window.api.settings.set(map[k], String(v));
    }
  },

  // ── Academic Context ──────────────────────────────────
  currentTerm: null,
  currentAcademicYear: null,
  classes: [],
  subjects: [],

  loadClassesAndTerms: async () => {
    const [classes, terms, subjects] = await Promise.all([
      window.api.settings.listClasses(),
      window.api.settings.listTerms(),
      window.api.settings.listSubjects(),
    ]);
    const currentTerm = terms.find(t => t.is_current) || terms[0] || null;
    const currentAcademicYear = currentTerm
      ? terms.find(t => t.is_current)?.year_label || null
      : null;
    set({ classes, subjects, currentTerm, currentAcademicYear });
  },

  setCurrentTerm: (term) => set({ currentTerm: term }),

  // ── Toast ─────────────────────────────────────────────
  toast: null,
  showToast: (message, type = 'success') => {
    set({ toast: { message, type, id: Date.now() } });
    setTimeout(() => set({ toast: null }), 3500);
  },
  clearToast: () => set({ toast: null }),
}));

function applyTheme(theme) {
  const root = document.documentElement;
  // A setting the school never filled in leaves the stylesheet's own value in
  // place rather than overwriting it with nothing.
  const put = (name, value) => {
    if (value == null || value === '') return;
    root.style.setProperty(name, value);
  };
  root.style.setProperty('--primary',     isHex(theme.primary) ? theme.primary : '#5B3FE0');
  root.style.setProperty('--primary-50',  lighten(theme.primary, 0.92));
  root.style.setProperty('--primary-100', lighten(theme.primary, 0.85));
  root.style.setProperty('--primary-700', darken(theme.primary, 0.15));
  root.style.setProperty('--primary-900', darken(theme.primary, 0.3));
  put('--accent',      isHex(theme.accent) ? theme.accent : '#C99A25');
  root.style.setProperty('--accent-50',   lighten(theme.accent, 0.88));
  root.style.setProperty('--accent-700',  darken(theme.accent, 0.18));
  put('--bg',          isHex(theme.background) ? theme.background : '#F5F4FB');
  put('--fg',          isHex(theme.foreground) ? theme.foreground : '#14142B');
  root.style.setProperty('--font-family', fontStack(theme.fontFamily));
  root.style.setProperty('--font-size-base', `${theme.fontSize}px`);
  root.setAttribute('data-fg',    theme.fgMode === 'light' ? 'light' : 'dark');
  root.setAttribute('data-theme', theme.themeMode === 'dark' ? 'dark' : 'light');
}

// ── Fonts ───────────────────────────────────────────────────────────────────
// Every stack ends in a system sans, and NOTHING here is fetched over a
// network. This used to append `'Cambria', Georgia, serif`, and the app used
// to pull six families from Google Fonts in index.html — so on a school PC
// with no internet at seven in the morning, every one of those requests failed
// and the entire product rendered in CAMBRIA, a serif. That is most of why it
// looked soft and unprofessional. A font that can fail to load has no business
// being the thing the interface depends on.
const SYSTEM_SANS = `system-ui, -apple-system, 'Roboto', 'Helvetica Neue', 'Liberation Sans', 'DejaVu Sans', 'Noto Sans', Arial, sans-serif`;

export const FONT_STACKS = {
  system:  `'Segoe UI Variable Text', 'Segoe UI', ${SYSTEM_SANS}`,
  segoe:   `'Segoe UI Variable Text', 'Segoe UI', ${SYSTEM_SANS}`,
  inter:   `'Inter', 'Segoe UI', ${SYSTEM_SANS}`,
  roboto:  `'Roboto', 'Segoe UI', ${SYSTEM_SANS}`,
  calibri: `'Calibri', 'Segoe UI', ${SYSTEM_SANS}`,
  tahoma:  `'Tahoma', 'Segoe UI', ${SYSTEM_SANS}`,
  verdana: `'Verdana', 'Segoe UI', ${SYSTEM_SANS}`,
};

export function fontStack(key) {
  const k = String(key || 'system').trim().toLowerCase();
  if (FONT_STACKS[k]) return FONT_STACKS[k];
  // A school that typed a family name of its own still gets a real fallback
  // rather than a serif — and a quote-mangling name cannot break the rule.
  const safe = k.replace(/["'<>;{}]/g, '').slice(0, 40);
  return safe ? `'${safe}', 'Segoe UI', ${SYSTEM_SANS}` : FONT_STACKS.system;
}

// A colour that is not a hex value — a token name, an empty setting — must not
// reach the maths below: it produces NaN, `rgb(NaN,NaN,NaN)`, and a CSS
// variable that resolves to nothing, which takes the whole palette with it.
function isHex(v) { return /^#?[0-9a-f]{6}$/i.test(String(v || '').trim()); }

function hexToRgb(hex) {
  if (!isHex(hex)) return [91, 63, 224];
  const m = hex.replace('#','').match(/.{2}/g);
  return m ? m.map(x => parseInt(x,16)) : [0,0,0];
}
function rgbToHex([r,g,b]) {
  return '#'+[r,g,b].map(x=>Math.round(x).toString(16).padStart(2,'0')).join('');
}
function lighten(hex, a) { const [r,g,b]=hexToRgb(hex); return rgbToHex([r+(255-r)*a,g+(255-g)*a,b+(255-b)*a]); }
function darken(hex, a)  { const [r,g,b]=hexToRgb(hex); return rgbToHex([r*(1-a),g*(1-a),b*(1-a)]); }
