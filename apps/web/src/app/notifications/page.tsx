'use client';

import { useMyNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@/features/notifications/notifications.hooks';
import type { Notification } from '@/features/notifications/notifications.types';

function TypeIcon({ type }: { type: string }) {
  if (type === 'payment_failed') {
    return (
      <span className="flex items-center justify-center w-9 h-9 rounded-full bg-red-500/20 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-red-400">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex items-center justify-center w-9 h-9 rounded-full bg-green-500/20 shrink-0">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-green-400">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="card bg-zinc-900/50 animate-pulse flex items-center gap-4">
      <div className="w-9 h-9 rounded-full bg-zinc-800 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-zinc-800 rounded w-1/3" />
        <div className="h-3 bg-zinc-800 rounded w-2/3" />
        <div className="h-3 bg-zinc-800 rounded w-1/4" />
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificationsPage() {
  const { data, isLoading } = useMyNotifications();
  const [markRead] = useMarkNotificationRead();
  const [markAll, { isLoading: markingAll }] = useMarkAllNotificationsRead();

  const notifications: Notification[] = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">Payment alerts and billing events</p>
        </div>
        <button
          onClick={() => markAll()}
          disabled={markingAll || notifications.every((n) => n.isRead)}
          className="btn-primary shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {markingAll ? 'Marking…' : 'Mark all read'}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && notifications.length === 0 && (
        <div className="card bg-zinc-900/50 flex flex-col items-center justify-center py-16 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 text-zinc-700 mb-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <p className="text-zinc-400 font-medium">No notifications yet</p>
          <p className="text-zinc-600 text-sm mt-1">Payment events will appear here</p>
        </div>
      )}

      {/* Notification list */}
      {!isLoading && notifications.length > 0 && (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`card flex items-center gap-4 transition-colors ${
                n.isRead ? 'bg-zinc-900/50' : 'bg-zinc-800/50'
              }`}
            >
              <TypeIcon type={n.type} />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-100">{n.title}</p>
                <p className="text-sm text-zinc-400 mt-0.5">{n.message}</p>
                <p className="text-xs text-zinc-500 mt-1">{formatDate(n.createdAt)}</p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {!n.isRead && (
                  <span className="w-2 h-2 rounded-full bg-indigo-500" />
                )}
                {!n.isRead && (
                  <button
                    onClick={() => markRead(n.id)}
                    className="btn-ghost text-xs"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
