// Nickland Edusoft — choosing a file, where there is no file dialog.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The installed application attaches a photograph by opening the operating
// system's file dialog and copying the file off the disk. A browser cannot do
// that, and a phone has no disk to speak of — so this is the other half: the
// file is read in the page, shrunk, and sent to the school as bytes.
//
// ── Why it shrinks the picture ─────────────────────────────────────────────
//
// A photograph off any phone made in the last five years is three to eight
// megabytes, and a school pays for its connection by the megabyte. What the
// picture is FOR is a face on a register, a report card and a receipt — 800
// pixels on the long edge is more than any of those can print. So it is
// resized in the browser before it ever goes near the network, which turns a
// six-megabyte upload on a rural connection into about eighty kilobytes.
//
// The resize is done with a canvas, which is a web thing. On a handset the
// picker is not drawn at all: the phone app has no file input, and offering a
// button that cannot open anything is worse than not offering it.

import React, { useRef, useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { Button, Muted, ErrorNote } from './ui';
import { colors, spacing, type, radius } from './theme';

const IS_WEB = Platform.OS === 'web';

/** Whether this build can choose a file at all. */
export const canPickFiles = IS_WEB && typeof document !== 'undefined';

/**
 * Read a File into a data URI, shrinking an image on the way through.
 *
 * `maxEdge` is the long edge in pixels; anything already smaller is left
 * alone rather than re-encoded, because re-encoding a small JPEG only makes
 * it worse. A PDF is passed through untouched — there is nothing to resize
 * and a canvas cannot read one.
 */
export function readFile(file, { maxEdge = 800, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file chosen.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const uri = String(reader.result || '');
      if (!/^data:image\//i.test(uri)) return resolve(uri);      // a PDF, or a scan
      const img = new Image();
      img.onerror = () => resolve(uri);                          // not decodable — send it as it is
      img.onload = () => {
        const long = Math.max(img.width, img.height);
        if (!long || long <= maxEdge) return resolve(uri);
        const scale = maxEdge / long;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // Always JPEG on the way out: a photograph as a PNG is four times
          // the size for no gain, and the school pays for the difference.
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (_) { resolve(uri); }
      };
      img.src = uri;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * A button that opens the file dialog and hands back a data URI.
 *
 * @param {string}   accept    the input's accept list, e.g. 'image/*'
 * @param {function} onPick    (dataUri, file) => Promise | void
 * @param {string}   label     what the button says
 */
export function FilePicker({
  label = 'Choose a file', accept = 'image/*', onPick, disabled,
  hint, maxEdge = 800, variant = 'outline', size = 'sm', full = false,
}) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!canPickFiles) {
    // Said once, plainly, rather than drawn as a button that does nothing.
    return <Muted>{'Attaching a file is done in a browser or on the office computer.'}</Muted>;
  }

  async function chosen(e) {
    const file = e.target.files && e.target.files[0];
    // Cleared immediately so choosing the SAME file twice fires again —
    // otherwise a failed upload cannot be retried without picking a different
    // picture, which is a maddening thing to discover at a counter.
    e.target.value = '';
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const uri = await readFile(file, { maxEdge });
      if (onPick) await onPick(uri, file);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <View>
      {React.createElement('input', {
        ref, type: 'file', accept, onChange: chosen,
        style: { display: 'none' },
      })}
      <Button
        title={busy ? 'Working…' : label} busy={busy} disabled={disabled || busy}
        icon="plus" variant={variant} size={size} full={full}
        onPress={() => ref.current && ref.current.click()}
      />
      {hint ? <Muted style={{ marginTop: 4 }}>{hint}</Muted> : null}
      <ErrorNote message={error} />
    </View>
  );
}

/**
 * A face, with a button under it to replace it.
 *
 * Shows what is there now rather than only offering to change it — somebody
 * about to replace a photograph wants to see the one they are replacing.
 */
export function PhotoPicker({ photo, onPick, disabled, size = 96, label = 'Change photograph' }) {
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm }}>
      <View style={{
        width: size, height: size, borderRadius: radius.md, overflow: 'hidden',
        backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {photo && IS_WEB
          ? React.createElement('img', {
            src: photo, alt: '',
            style: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' },
          })
          : <Text style={{ ...type.small, color: colors.faint }}>No photograph</Text>}
      </View>
      <FilePicker label={label} accept="image/*" onPick={onPick} disabled={disabled} />
    </View>
  );
}

export default FilePicker;
