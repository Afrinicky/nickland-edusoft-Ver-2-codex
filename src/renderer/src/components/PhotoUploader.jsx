// Nickland Edusoft — Photo Uploader Component
// Drop into any form. Handles upload, preview, and removal.
//
// A photo can be added at any point, including before the record exists. When
// there is no id yet the file is staged on disk and the path handed back
// through onChange; the form saves it with everything else, and the record's
// own save call attaches it. Requiring "save first, then add the photo" put a
// dead control in front of anyone adding a member of staff.
//
// Everything is cropped to passport proportions and squeezed under 500KB in
// the main process (electron/ipc/photos.js), so what comes back here is
// already the right shape and size.
import React, { useState } from 'react';
import { useStore } from '../store/index.js';
import { mediaUrl } from '../lib/media.js';

export default function PhotoUploader({
  entityType,        // 'students' | 'staff' | 'users'
  entityId,          // the record's id — absent while it is still being created
  currentPath,       // existing photo_path from the record, or a staged path
  onChange,          // callback(newPath) after upload/remove
  size = 120,        // display size in pixels
  shape = 'square',  // 'square' | 'circle'
  label = 'Photo',
}) {
  const showToast = useStore(s => s.showToast);
  const [uploading, setUploading] = useState(false);
  // Cache-buster: a replacement photo can land on a path the renderer has
  // already cached, and the old face would stay on screen until a reload.
  const [version, setVersion] = useState(0);

  async function selectAndUpload() {
    const result = await window.api.app.showOpenDialog({
      title: `Choose ${label}`,
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
    });
    if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) return;

    setUploading(true);
    const res = await window.api.photos.upload({
      entityType,
      entityId: entityId || null,
      sourcePath: result.filePaths[0],
    });
    setUploading(false);

    if (!res.ok) { showToast(res.error || 'Upload failed', 'error'); return; }

    // Replacing a staged photo leaves the previous one orphaned on disk.
    if (res.staged && currentPath && currentPath !== res.path) {
      try { await window.api.photos.discard({ entityType, stagedPath: currentPath }); } catch (_) {}
    }
    setVersion(v => v + 1);
    showToast(res.staged ? 'Photo ready — it saves with the record' : 'Photo updated', 'success');
    if (onChange) onChange(res.path);
  }

  async function remove() {
    if (!currentPath) return;
    if (!confirm('Remove this photo?')) return;
    const res = await window.api.photos.remove({
      entityType,
      entityId: entityId || null,
      stagedPath: entityId ? null : currentPath,
    });
    if (res.ok) {
      setVersion(v => v + 1);
      showToast('Photo removed', 'success');
      if (onChange) onChange(null);
    } else {
      showToast(res.error || 'Could not remove the photo', 'error');
    }
  }

  const radius = shape === 'circle' ? '50%' : '8px';
  const hasPhoto = !!currentPath;
  const src = hasPhoto ? mediaUrl(currentPath, version) : null;

  return (
    <div className="photo-uploader" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        className="photo-uploader-thumb"
        style={{
          width: size, height: size,
          borderRadius: radius,
          border: '2px solid var(--border)',
          background: hasPhoto ? 'transparent' : 'var(--surface-2)',
          backgroundImage: hasPhoto ? `url("${src}")` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--muted)',
          fontSize: 32,
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {!hasPhoto && '📷'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{label}</div>
        <div className="text-xs text-muted" style={{ maxWidth: 220 }}>
          {hasPhoto
            ? (entityId ? 'Photo on file' : 'Ready — saves with the record')
            : 'Cropped to passport size automatically'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={selectAndUpload}
            disabled={uploading}
          >
            {uploading ? 'Processing…' : hasPhoto ? 'Change' : '+ Upload'}
          </button>
          {hasPhoto && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
