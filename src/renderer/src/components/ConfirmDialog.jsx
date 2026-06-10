import React from 'react';
import Modal from './Modal.jsx';

export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <Modal
      title={title || 'Are you sure?'}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 14 }}>{message}</p>
    </Modal>
  );
}
