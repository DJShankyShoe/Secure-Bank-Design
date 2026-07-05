/**
 * In-house notification kit — replaces the browser's alert()/confirm()/prompt()
 * with styled, non-blocking UI that matches the app's design tokens.
 *
 * Usage (import from anywhere):
 *   import { toast, confirm, promptReason } from '<...>/ui/notify';
 *   toast.success('Transfer initiated');
 *   toast.error(err.message);
 *   if (!(await confirm({ message: 'Approve closure?' }))) return;
 *   const reason = await promptReason({ message: 'Reason for rejection?' });
 *   if (reason === null) return;            // user cancelled
 *
 * Mount <NotificationHost /> exactly once near the app root.
 *
 * No external dependency: a tiny module-level pub/sub store drives a single host
 * component, so any module (not just components/hooks) can raise a notification.
 */
import React, { useEffect, useRef, useState } from 'react';

// --------------------------------------------------------------------------- //
// Module store
// --------------------------------------------------------------------------- //
let _toasts = [];
let _dialog = null; // { kind, ...opts, resolve } | null
let _seq = 0;
const _subs = new Set();

function _emit() {
  _subs.forEach((fn) => fn());
}

function _subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _dismiss(id) {
  _toasts = _toasts.filter((t) => t.id !== id);
  _emit();
}

function _pushToast(type, message, opts = {}) {
  const id = ++_seq;
  const duration = opts.duration ?? (type === 'error' ? 6000 : 4000);
  _toasts = [..._toasts, { id, type, message: String(message ?? '') }];
  _emit();
  if (duration > 0) {
    setTimeout(() => _dismiss(id), duration);
  }
  return id;
}

/** Fire-and-forget toast notifications. */
export const toast = {
  success: (message, opts) => _pushToast('success', message, opts),
  error: (message, opts) => _pushToast('error', message, opts),
  info: (message, opts) => _pushToast('info', message, opts),
};

/** Async replacement for window.confirm — resolves true/false. */
export function confirm({
  title = 'Please confirm',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    _dialog = { kind: 'confirm', title, message, confirmText, cancelText, danger, resolve };
    _emit();
  });
}

/** Async replacement for window.prompt — resolves the entered string, or null if cancelled. */
export function promptReason({
  title = 'Enter a reason',
  message = '',
  label = '',
  placeholder = '',
  confirmText = 'Submit',
  cancelText = 'Cancel',
  danger = false,
  required = true,
} = {}) {
  return new Promise((resolve) => {
    _dialog = {
      kind: 'prompt', title, message, label, placeholder,
      confirmText, cancelText, danger, required, resolve,
    };
    _emit();
  });
}

function _closeDialog(result) {
  const d = _dialog;
  _dialog = null;
  _emit();
  if (d) d.resolve(result);
}

// --------------------------------------------------------------------------- //
// Host component (mount once)
// --------------------------------------------------------------------------- //
const _ICONS = { success: '✓', error: '!', info: 'i' };

export function NotificationHost() {
  const [, force] = useState(0);
  useEffect(() => _subscribe(() => force((n) => n + 1)), []);

  return (
    <>
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {_toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast--${t.type}`}
            role="status"
            onClick={() => _dismiss(t.id)}
          >
            <span className="toast__icon" aria-hidden="true">{_ICONS[t.type] || 'i'}</span>
            <span className="toast__msg">{t.message}</span>
            <button
              type="button"
              className="toast__close"
              aria-label="Dismiss notification"
              onClick={(e) => { e.stopPropagation(); _dismiss(t.id); }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {_dialog && <DialogModal dialog={_dialog} />}
    </>
  );
}

function DialogModal({ dialog }) {
  const isPrompt = dialog.kind === 'prompt';
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isPrompt && inputRef.current) inputRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => _closeDialog(isPrompt ? null : false);
  const submit = () => {
    if (isPrompt) {
      const v = value.trim();
      if (dialog.required && !v) return; // block empty submissions
      _closeDialog(v);
    } else {
      _closeDialog(true);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={cancel}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title">{dialog.title}</h3>
        {dialog.message && <p className="modal-message">{dialog.message}</p>}
        {isPrompt && (
          <>
            {dialog.label && <label className="modal-label" htmlFor="notify-input">{dialog.label}</label>}
            <input
              id="notify-input"
              ref={inputRef}
              className="modal-input"
              type="text"
              value={value}
              placeholder={dialog.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={cancel}>
            {dialog.cancelText}
          </button>
          <button
            type="button"
            className={`modal-btn ${dialog.danger ? 'modal-btn--danger' : 'modal-btn--primary'}`}
            onClick={submit}
          >
            {dialog.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
