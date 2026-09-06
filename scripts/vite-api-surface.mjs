// Nickland Edusoft — the one channel list, in a bundle.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// electron/api-surface.js names every call this application can make, once.
// The preload script requires it as CommonJS, because that is what a preload
// script is. Both Vite builds — the installed window's and the browser's —
// import it as a module.
//
// Rather than keep two copies of four hundred channels, which is exactly the
// duplication all of this exists to remove, the file is authored for the
// preload script and its single export line is rewritten on the way into a
// bundle.
//
// It stops the build rather than shrugging. If that line is ever edited, the
// alternative is an application whose every call is silently undefined, found
// by a school rather than by a build.

const EXPORT_LINE = 'module.exports = { buildApi };';

export function apiSurfaceAsModule() {
  return {
    name: 'edusoft-api-surface',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('electron/api-surface.js')) return null;
      if (!code.includes(EXPORT_LINE)) {
        this.error(
          `electron/api-surface.js no longer ends with "${EXPORT_LINE}". ` +
          'Both Vite builds rewrite that exact line into an ES export. ' +
          'Update scripts/vite-api-surface.mjs to match it.'
        );
      }
      return { code: code.replace(EXPORT_LINE, 'export { buildApi };'), map: null };
    },
  };
}

export { EXPORT_LINE };
