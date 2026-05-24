import { apiSlice } from '@/lib/api-slice';
import { apiClient } from '@/lib/api-client';
import type { Notification } from './notifications.types';

export const notificationsApiSlice = apiSlice.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    myNotifications: builder.query<{ data: Notification[]; total: number }, void>({
      queryFn: () =>
        apiClient
          .get<{ data: Notification[]; total: number }>('/notifications/me')
          .then((data) => ({ data })),
      providesTags: ['Notification'],
    }),

    markNotificationRead: builder.mutation<{ success: true }, string>({
      queryFn: (id) =>
        apiClient
          .patch<{ success: true }>(`/notifications/${id}/read`, {})
          .then((data) => ({ data })),
      invalidatesTags: ['Notification'],
    }),

    markAllNotificationsRead: builder.mutation<{ success: true }, void>({
      queryFn: () =>
        apiClient
          .patch<{ success: true }>('/notifications/read-all', {})
          .then((data) => ({ data })),
      invalidatesTags: ['Notification'],
    }),
  }),
});

export const {
  useMyNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} = notificationsApiSlice;
