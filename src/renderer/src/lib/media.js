// Nickland Edusoft — URLs for the school's own uploaded files.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Photos, logos and signatures are stored outside the app bundle, under
// %APPDATA%/NicklandEdusoft/uploads, and the packaged renderer addresses them
// with a plain `file://` URL. That is what the app has always done and it
// works: the packaged window is itself loaded from file://, so an uploaded
// picture is same-scheme.
//
// A previous attempt routed these through a custom `nes-media://` protocol to
// make them load under `npm run dev` as well, where the renderer is served
// from http://localhost:5173 and a file:// subresource is blocked. It broke
// every image in the packaged app — the school logo included — so it is gone.
// Development is the case that does not work here, and a broken logo in the
// product is a far worse trade than a missing thumbnail on a developer's
// machine.
//
// One helper rather than a template literal per call site, so the scheme lives
// in one place if this is ever revisited.
export function mediaUrl(absolutePath, version) {
  if (!absolutePath) return null;
  const url = `file://${absolutePath}`;
  // A replacement photo can land on the path its predecessor occupied, and the
  // renderer would keep showing the old face until a reload.
  return version != null ? `${url}?v=${version}` : url;
}
