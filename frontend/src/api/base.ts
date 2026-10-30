import { createApi, BaseQueryFn } from '@reduxjs/toolkit/query/react';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { client } from './client';

export interface QueryArgs {
  url: string;
  method?: AxiosRequestConfig['method'];
  data?: unknown;
  params?: Record<string, unknown>;
}

const axiosBaseQuery: BaseQueryFn<QueryArgs | string, unknown, { status?: number | string; data?: unknown }> = async (args) => {
  const a = typeof args === 'string' ? { url: args } : args;
  try {
    const params = a.params ? Object.fromEntries(Object.entries(a.params).filter(([, v]) => v !== undefined && v !== '' && v !== null)) : undefined;
    const res = await client.request({ url: a.url, method: a.method ?? 'GET', data: a.data, params });
    return { data: res.data };
  } catch (e) {
    const err = e as AxiosError;
    return { error: { status: err.response?.status ?? 'FETCH_ERROR', data: err.response?.data ?? { error: { message: err.message } } } };
  }
};

export const TAGS = [
  'Me',
  'User',
  'Warehouse',
  'Supplier',
  'Offer',
  'Product',
  'Stock',
  'Transfer',
  'Count',
  'Discrepancy',
  'Policy',
  'Route',
  'PO',
  'Alert',
  'Dashboard',
  'Insights',
  'Audit',
  'Recovery',
  'Redistribution',
  'Order',
  'Dependency',
  'Scenario',
  'Run',
  'Notification',
  'Config',
  'Dna',
] as const;
export type Tag = (typeof TAGS)[number];

export const api = createApi({
  reducerPath: 'api',
  baseQuery: axiosBaseQuery,
  tagTypes: TAGS,
  refetchOnReconnect: true,
  endpoints: () => ({}),
});
