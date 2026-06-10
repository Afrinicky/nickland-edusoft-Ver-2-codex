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
  },
  logout: () => {
    const user = get().currentUser;
    if (user) {
      try { window.api.auth.logout(user.id); } catch (e) {}
    }
    set({ currentUser: null, isAuthenticated: false, permissions: {}, assignments: [] });
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

  // Has this teacher been assigned to this class? (used to gate class-specific data)
  isAssignedToClass: (classGroupId) => {
    if (!classGroupId) return false;
    return (get().assignments || []).some(a => a.class_group_id === classGroupId);
  },

  // Has this teacher been assigned to this subject in this class?
  isAssignedToSubject: (classGroupId, subjectId) => {
    return (get().assignments || []).some(a =>
      a.class_group_id === classGroupId && a.subject_id === subjectId
    );
  },

  // ── Settings & Theme ─────────────────────────────────
  settings: {},
  theme: {
    primary: '#1B3A6B',
    accent: '#C9961A',
    background: '#FFFFFF',
    foreground: '#0F172A',
    fgMode: 'dark',
    themeMode: 'light',
    fontFamily: 'Inter',
    fontSize: 14,
  },

  loadSettings: async () => {
    const settings = await window.api.settings.getAll();
    const branding = settings.branding || {};
    const theme = {
      primary:    branding.school_color_primary    || '#1B3A6B',
      accent:     branding.school_color_accent     || '#C9961A',
      background: branding.school_color_background || '#FFFFFF',
      foreground: branding.school_color_foreground || '#0F172A',
      fgMode:     branding.ui_foreground_mode      || 'dark',
      themeMode:  branding.ui_theme_mode           || 'light',
      fontFamily: branding.ui_font_family          || 'Inter',
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
  root.style.setProperty('--primary',     theme.primary);
  root.style.setProperty('--primary-50',  lighten(theme.primary, 0.92));
  root.style.setProperty('--primary-100', lighten(theme.primary, 0.85));
  root.style.setProperty('--primary-700', darken(theme.primary, 0.15));
  root.style.setProperty('--primary-900', darken(theme.primary, 0.3));
  root.style.setProperty('--accent',      theme.accent);
  root.style.setProperty('--accent-50',   lighten(theme.accent, 0.88));
  root.style.setProperty('--accent-700',  darken(theme.accent, 0.18));
  root.style.setProperty('--bg',          theme.background);
  root.style.setProperty('--fg',          theme.foreground);
  root.style.setProperty('--font-family', `'${theme.fontFamily}', 'Cambria', Georgia, serif`);
  root.style.setProperty('--font-size-base', `${theme.fontSize}px`);
  root.setAttribute('data-fg',    theme.fgMode === 'light' ? 'light' : 'dark');
  root.setAttribute('data-theme', theme.themeMode === 'dark' ? 'dark' : 'light');
}

function hexToRgb(hex) {
  const m = hex.replace('#','').match(/.{2}/g);
  return m ? m.map(x => parseInt(x,16)) : [0,0,0];
}
function rgbToHex([r,g,b]) {
  return '#'+[r,g,b].map(x=>Math.round(x).toString(16).padStart(2,'0')).join('');
}
function lighten(hex, a) { const [r,g,b]=hexToRgb(hex); return rgbToHex([r+(255-r)*a,g+(255-g)*a,b+(255-b)*a]); }
function darken(hex, a)  { const [r,g,b]=hexToRgb(hex); return rgbToHex([r*(1-a),g*(1-a),b*(1-a)]); }
