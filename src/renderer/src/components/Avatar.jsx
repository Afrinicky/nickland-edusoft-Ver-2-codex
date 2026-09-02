// Nickland Edusoft — one avatar, everywhere.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every list and profile that shows a person used to render initials and
// nothing else, so an uploaded photo was stored, kept and never displayed —
// the staff profile included. Initials are the FALLBACK here, not the design.
import React, { useState } from 'react';
import { initials } from '../lib/format.js';
import { mediaUrl } from '../lib/media.js';

export default function Avatar({
  person,            // { surname, first_name, photo_path }
  size = 'md',       // 'sm' | 'md' | 'lg' | a number of pixels
  className = '',
  alt,
}) {
  // A photo can be deleted from disk while the path lingers on the record. The
  // face falling back to initials is right; a broken-image icon is not.
  const [failed, setFailed] = useState(false);

  const photo = person && person.photo_path;
  const cls = typeof size === 'number'
    ? `avatar ${className}`.trim()
    : `avatar${size === 'md' ? '' : ` avatar-${size}`} ${className}`.trim();
  const style = typeof size === 'number' ? { width: size, height: size } : undefined;

  if (photo && !failed) {
    return (
      <img
        className={`${cls} avatar-photo`}
        style={style}
        src={mediaUrl(photo)}
        alt={alt || initials(person)}
        onError={() => setFailed(true)}
      />
    );
  }
  return <div className={cls} style={style}>{initials(person)}</div>;
}
