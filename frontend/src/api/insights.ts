import { api } from './base';
import type { Alert, AuditEntry, Insights, Overview, Page, PendingApprovals, RebalanceSuggestion, Transfer, VerifyResult } from '../types';

export const insightsApi = api.injectEndpoints({
  endpoints: (b) => ({
    alerts: b.query<Page<Alert>, { resolved?: string; warehouse?: string; type?: string; page?: number; limit?: number }>({
      query: (params) => ({ url: '/alerts', params }),
      providesTags: ['Alert'],
    }),
    resolveAlert: b.mutation<Alert, string>({
      query: (id) => ({ url: `/alerts/${id}/resolve`, method: 'POST' }),
      invalidatesTags: ['Alert', 'Dashboard'],
    }),
    sweepExpiry: b.mutation<{ expiry: { checked: number; created: number; updated: number; resolved: number }; overdue: { overdue: number; raised: number } }, { warehouse?: string }>({
      query: (data) => ({ url: '/alerts/sweep-expiry', method: 'POST', data }),
      invalidatesTags: ['Alert', 'Dashboard'],
    }),

    overview: b.query<Overview, { warehouse?: string }>({ query: (params) => ({ url: '/dashboard/overview', params }), providesTags: ['Dashboard'] }),
    stockByValue: b.query<{ items: { productId: string; sku: string; name: string; units: number; value: number }[] }, { warehouse?: string }>({
      query: (params) => ({ url: '/dashboard/stock-by-value', params }),
      providesTags: ['Dashboard'],
    }),
    poFunnel: b.query<{ items: { status: string; count: number }[] }, { warehouse?: string }>({
      query: (params) => ({ url: '/dashboard/po-funnel', params }),
      providesTags: ['Dashboard', 'PO'],
    }),
    pending: b.query<PendingApprovals, void>({ query: () => '/dashboard/pending', providesTags: ['Dashboard', 'PO', 'Recovery', 'Redistribution', 'Transfer'] }),

    insights: b.query<Insights, { warehouse?: string }>({ query: (params) => ({ url: '/analytics/insights', params }), providesTags: ['Insights'] }),
    rebalance: b.query<{ items: RebalanceSuggestion[]; total: number }, void>({ query: () => '/analytics/rebalance', providesTags: ['Insights', 'Stock'] }),
    executeRebalance: b.mutation<{ mode: 'instant' | 'tracked'; transfer: Transfer }, { product: string; from: string; to: string; quantity: number }>({
      query: (data) => ({ url: '/analytics/rebalance/execute', method: 'POST', data }),
      invalidatesTags: ['Insights', 'Stock', 'Transfer', 'Dashboard'],
    }),

    audit: b.query<Page<AuditEntry>, { entityType?: string; action?: string; actor?: string; page?: number; limit?: number }>({
      query: (params) => ({ url: '/audit', params }),
      providesTags: ['Audit'],
    }),
    verifyAudit: b.mutation<VerifyResult, void>({ query: () => ({ url: '/audit/verify' }) }),
  }),
});

export const {
  useAlertsQuery,
  useResolveAlertMutation,
  useSweepExpiryMutation,
  useOverviewQuery,
  useStockByValueQuery,
  usePoFunnelQuery,
  usePendingQuery,
  useInsightsQuery,
  useRebalanceQuery,
  useExecuteRebalanceMutation,
  useAuditQuery,
  useVerifyAuditMutation,
} = insightsApi;
