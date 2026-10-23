import { api } from './base';
import type { NotifyPrefs, User } from '../types';

export const authApi = api.injectEndpoints({
  endpoints: (b) => ({
    login: b.mutation<{ token: string; user: User }, { email: string; password: string }>({
      query: (data) => ({ url: '/auth/login', method: 'POST', data }),
    }),
    register: b.mutation<{ token: string; user: User }, { name: string; email: string; password: string }>({
      query: (data) => ({ url: '/auth/register', method: 'POST', data }),
    }),
    me: b.query<User, void>({ query: () => '/auth/me', providesTags: ['Me'] }),
    updateMe: b.mutation<User, { name?: string; phone?: string; notify?: Partial<NotifyPrefs> }>({
      query: (data) => ({ url: '/auth/me', method: 'PATCH', data }),
      invalidatesTags: ['Me'],
    }),
    changePassword: b.mutation<{ ok: true }, { currentPassword: string; newPassword: string }>({
      query: (data) => ({ url: '/auth/change-password', method: 'POST', data }),
    }),
  }),
});

export const { useLoginMutation, useRegisterMutation, useMeQuery, useUpdateMeMutation, useChangePasswordMutation } = authApi;
