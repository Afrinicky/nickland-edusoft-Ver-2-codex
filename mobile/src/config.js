// Build-time configuration.
//
// Expo inlines `process.env.EXPO_PUBLIC_*` into the bundle at build time, so
// these are baked into whatever artefact is produced — the Vercel web build,
// the APK, the copy the desktop installer ships. Nothing here is a secret;
// they are addresses a user would otherwise have to type.
//
//   EXPO_PUBLIC_PORTAL_URL  the hosted portal/API base, e.g. https://api.nickland.app
//                           Used when the app is not being served by a server
//                           that answers for itself — the phone app, and a web
//                           build hosted apart from its API.
//   EXPO_PUBLIC_SCHOOL_ID   pin a single school, for a build made for one
//                           school. Omitted, the portal's schools are listed
//                           and one is picked (auto-picked when there is one).

const clean = (v) => {
  const s = String(v || '').trim().replace(/\/+$/, '');
  return s && s !== 'undefined' && s !== 'null' ? s : null;
};

export const DEFAULT_PORTAL_URL = clean(process.env.EXPO_PUBLIC_PORTAL_URL);
export const DEFAULT_SCHOOL_ID = clean(process.env.EXPO_PUBLIC_SCHOOL_ID);
