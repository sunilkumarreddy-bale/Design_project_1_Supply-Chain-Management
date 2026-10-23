import { api } from './base';
import type { AppConfig, Notification, Page, Role, User } from '../types';

export interface UserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  warehouse?: string | null;
  supplier?: string | null;
  phone?: string;
}

export const adminApi = api.injectEndpoints({
  endpoints: (b) => ({
    users: b.query<Page<User>, { role?: string; q?: string; page?: number; limit?: number }>({
      query: (params) => ({ url: '/users', params }),
      providesTags: ['User'],
    }),
    createUser: b.mutation<User, UserInput>({ query: (data) => ({ url: '/users', method: 'POST', data }), invalidatesTags: ['User'] }),
    updateUser: b.mutation<User, { id: string; data: Partial<Omit<UserInput, 'password'>> & { isActive?: boolean } }>({
      query: ({ id, data }) => ({ url: `/users/${id}`, method: 'PATCH', data }),
      invalidatesTags: ['User'],
    }),
    resetPassword: b.mutation<{ ok: true }, { id: string; newPassword: string }>({
      query: ({ id, newPassword }) => ({ url: `/users/${id}/reset-password`, method: 'POST', data: { newPassword } }),
    }),
    notifications: b.query<Page<Notification> & { unread: number }, { page?: number; limit?: number } | void>({
      query: (params) => ({ url: '/notifications', params: params ?? {} }),
      providesTags: ['Notification'],
    }),
    readNotification: b.mutation<Notification, string>({
      query: (id) => ({ url: `/notifications/${id}/read`, method: 'POST' }),
      invalidatesTags: ['Notification'],
    }),
    readAllNotifications: b.mutation<{ updated: number }, void>({
      query: () => ({ url: '/notifications/read-all', method: 'POST' }),
      invalidatesTags: ['Notification'],
    }),
    geocode: b.mutation<{ lat: number; lng: number; formattedAddress: string; driver: string }, { address: string }>({
      query: (data) => ({ url: '/maps/geocode', method: 'POST', data }),
    }),
    config: b.query<AppConfig, void>({ query: () => '/config', providesTags: ['Config'] }),
  }),
});

export const {
  useUsersQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useResetPasswordMutation,
  useNotificationsQuery,
  useReadNotificationMutation,
  useReadAllNotificationsMutation,
  useGeocodeMutation,
  useConfigQuery,
} = adminApi;
