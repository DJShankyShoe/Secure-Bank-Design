import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/api';

// Customer notification bell (FR-10). Shows an unread badge; opening the panel
// lists alerts newest-first and marks them read (history is kept, never deleted).
const CATEGORY_ICON = {
  account_locked: '🔒',
  user_suspended: '⛔',
  user_reactivated: '✅',
  account_suspended: '❄️',
  account_unsuspended: '✅',
  account_closed: '🚫',
  request_approved: '✔️',
  request_rejected: '✖️',
};

const timeAgo = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour12: false });
};

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState(null);
  const wrapperRef = useRef(null);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getNotifications();
      setItems(res.items || []);
      setUnread(res.unread_count || 0);
    } catch {
      // Non-fatal: the bell just stays empty if the fetch fails.
    }
  }, []);

  // Initial load + light polling so alerts appear without a page refresh.
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  // Close the panel when clicking outside it — checks both the trigger button
  // and the panel itself, since the panel is portaled to document.body (see
  // toggle()) and is no longer a DOM descendant of wrapperRef.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      const inTrigger = wrapperRef.current && wrapperRef.current.contains(e.target);
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inTrigger && !inPanel) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    if (next && btnRef.current) {
      // Portaled to document.body (see render below), so position is computed
      // from the trigger's viewport rect rather than relying on CSS `position:
      // relative` on a parent — the panel is no longer that parent's descendant.
      const rect = btnRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    setOpen(next);
    // Opening clears the unread badge (mark-as-read); the list stays as history.
    if (next && unread > 0) {
      try {
        await api.markAllNotificationsRead();
        setUnread(0);
        setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      } catch {
        // Leave the badge if the mark-read call fails; next open retries.
      }
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="Notifications"
        title="Notifications"
        style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.35rem', lineHeight: 1, padding: '4px' }}
      >
        <span role="img" aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span style={{ position: 'absolute', top: '-2px', right: '-2px', minWidth: '18px', height: '18px', padding: '0 4px', borderRadius: '9px', background: '#E32636', color: '#fff', fontSize: '0.7rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Portaled to document.body: the topbar's `backdrop-filter: blur(10px)`
          (styles.css .topbar) creates a compositing context that Chromium/WebKit
          fails to paint correctly for a `position: absolute` descendant with its
          own opaque background + box-shadow — the panel rendered as an invisible
          ghost even though its DOM/inline styles were exactly right. Moving it
          out of that ancestor's subtree via a portal sidesteps the bug instead of
          giving up the header's frosted-glass look. */}
      {open && panelPos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: panelPos.top, right: panelPos.right, width: '360px', maxHeight: '440px', overflowY: 'auto', background: '#fff', color: '#111827', border: '1px solid #E5E7EB', borderRadius: '10px', boxShadow: '0 12px 32px rgba(0,0,0,0.18)', zIndex: 1000 }}
        >
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E7EB', fontWeight: 700 }}>
            Notifications
          </div>
          {items.length === 0 ? (
            <div style={{ padding: '24px 16px', color: '#6B7280', textAlign: 'center' }}>
              You're all caught up.
            </div>
          ) : (
            items.map((n) => (
              <div key={n.notification_id} style={{ display: 'flex', gap: '10px', padding: '12px 16px', borderBottom: '1px solid #F3F4F6', background: n.read ? '#fff' : '#F5F8FF' }}>
                <div style={{ fontSize: '1.1rem', lineHeight: 1.4 }} aria-hidden="true">
                  {CATEGORY_ICON[n.category] || '🔔'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{n.title}</div>
                  <div style={{ fontSize: '0.85rem', color: '#4B5563', marginTop: '2px' }}>{n.body}</div>
                  <div style={{ fontSize: '0.72rem', color: '#9CA3AF', marginTop: '4px' }}>{timeAgo(n.created_at)}</div>
                </div>
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
