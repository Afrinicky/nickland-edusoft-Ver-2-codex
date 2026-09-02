// Nickland Edusoft — URLs for the school's own uploaded files.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Photos, logos and signatures are stored outside the app bundle, under
// %APPDATA%/NicklandEdusoft/uploads. Pointing an <img> at `file://<path>` does
// not work: in development the page comes from http://localhost:5173 and the
// browser refuses a file:// subresource, so every uploaded picture rendered as
// a broken image. `nes-media://` is served by the main process from an
// allowlist of directories (electron/main.js) and behaves the same either way.
const SCHEME = 'nes-media://local/';

export function mediaUrl(absolutePath, version) {
  if (!absolutePath) return null;
  // Backslashes are not path separators in a URL.
  const normalised = String(absolutePath).replace(/\\/g, '/');
  const url = SCHEME + encodeURIComponent(normalised);
  // A replacement photo can land on the path its predecessor occupied, and the
  // renderer would keep showing the old face until a reload.
  return version != null ? `${url}?v=${version}` : url;
}
