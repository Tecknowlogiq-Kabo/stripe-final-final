'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { useMyNotifications, useMarkAllNotificationsRead } from '@/features/notifications/notifications.hooks';
import type { Notification } from '@/features/notifications/notifications.types';

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function TypeIcon({ type }: { type: string }) {
  if (type === 'payment_failed') {
    return (
      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500/20 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3 text-red-400">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-500/20 shrink-0">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3 text-green-400">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </span>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError } = useMyNotifications(undefined, { pollingInterval: 30000 });
  const [markAll] = useMarkAllNotificationsRead();

  const notifications = data?.data ?? [];
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const recent = notifications.slice(0, 5);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const badgeCount = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        aria-label="Notifications"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {!isLoading && !isError && unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
            {badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-full top-0 ml-2 w-80 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-sm font-semibold text-zinc-100">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-xs text-zinc-500">{unreadCount} unread</span>
            )}
          </div>

          <div className="divide-y divide-zinc-800/60">
            {recent.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">No notifications yet</p>
            ) : (
              recent.map((n: Notification) => (
                <div
                  key={n.id}
                  className={`flex gap-3 px-4 py-3 ${!n.isRead ? 'border-l-2 border-indigo-500 bg-indigo-500/5' : ''}`}
                >
                  <TypeIcon type={n.type} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-100 truncate">{n.title}</p>
                    <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-xs text-zinc-600 mt-1">{relativeTime(n.createdAt)}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between gap-2">
            <button
              onClick={() => { markAll(); }}
              className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              Mark all read
            </button>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
            >
              View all →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
