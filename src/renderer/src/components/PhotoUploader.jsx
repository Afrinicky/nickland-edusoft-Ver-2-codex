// Nickland Edusoft — Photo Uploader Component
// Drop into any form. Handles upload, preview, and removal.
import React, { useState } from 'react';
import { useStore } from '../store/index.js';

export default function PhotoUploader({
  entityType,        // 'students' | 'staff' | 'users'
  entityId,          // required: the record's id
  currentPath,       // existing photo_path from the record
  onChange,          // callback(newPath) after upload/remove
  size = 120,        // display size in pixels
  shape = 'square',  // 'square' | 'circle'
  label = 'Photo',
}) {
  const showToast = useStore(s => s.showToast);
  const [uploading, setUploading] = useState(false);

  async function selectAndUpload() {
    if (!entityId) {
      showToast('Save the record first, then add the photo', 'warning');
      return;
    }
    const result = await window.api.app.showOpenDialog({
      title: `Choose ${label}`,
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    setUploading(true);
    const res = await window.api.photos.upload({
      entityType,
      entityId,
      sourcePath: result.filePaths[0],
    });
    setUploading(false);
    if (res.ok) {
      showToast('Photo updated', 'success');
      if (onChange) onChange(res.path);
    } else {
      showToast(res.error || 'Upload failed', 'error');
    }
  }

  async function remove() {
    if (!entityId) return;
    if (!confirm('Remove this photo?')) return;
    const res = await window.api.photos.remove({ entityType, entityId });
    if (res.ok) {
      showToast('Photo removed', 'success');
      if (onChange) onChange(null);
    }
  }

  const radius = shape === 'circle' ? '50%' : '8px';
  const hasPhoto = !!currentPath;

  return (
    <div className="photo-uploader" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        className="photo-uploader-thumb"
        style={{
          width: size, height: size,
          borderRadius: radius,
          border: '2px solid var(--border)',
          background: hasPhoto ? 'transparent' : 'var(--surface-2)',
          backgroundImage: hasPhoto ? `url("file://${currentPath}")` : 'none',
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
        <div className="text-xs text-muted" style={{ maxWidth: 200 }}>
          {hasPhoto ? 'Photo on file' : entityId ? 'No photo uploaded' : 'Save first, then add photo'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={selectAndUpload}
            disabled={!entityId || uploading}
          >
            {uploading ? 'Uploading…' : hasPhoto ? 'Change' : '+ Upload'}
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
