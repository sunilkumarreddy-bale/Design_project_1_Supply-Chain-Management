import { api } from './base';
import type { DisposalCause, DnaStats, DnaWrite, Genealogy, Gene, LotDetail, LotListItem, LotRequest, LotVerifyResult, Page, RecallTrace, ReconcileResult, StockLot } from '../types';

export interface LotListArgs {
  product?: string;
  warehouse?: string;
  supplier?: string;
  status?: string;
  alive?: 'true' | 'false';
  expiringInDays?: number;
  recalled?: 'true';
  q?: string;
  page?: number;
  limit?: number;
}

const WRITE_TAGS = ['Dna', 'Stock', 'Dashboard', 'Insights', 'Alert'] as const;

export const dnaApi = api.injectEndpoints({
  endpoints: (b) => ({
    lots: b.query<Page<LotListItem>, LotListArgs>({ query: (params) => ({ url: '/dna/lots', params: { ...params } }), providesTags: ['Dna'] }),
    lot: b.query<LotDetail, string>({ query: (id) => `/dna/lots/${id}`, providesTags: ['Dna'] }),
    timeline: b.query<{ lot: { _id: string; dnaCode: string; status: string }; items: Gene[]; total: number }, string>({
      query: (id) => `/dna/lots/${id}/timeline`,
      providesTags: ['Dna'],
    }),
    genealogy: b.query<Genealogy, string>({ query: (id) => `/dna/lots/${id}/genealogy`, providesTags: ['Dna'] }),
    dnaStats: b.query<DnaStats, void>({ query: () => '/dna/stats', providesTags: ['Dna', 'Dashboard'] }),
    lookupLot: b.mutation<{ _id: string; dnaCode: string; status: string }, { code?: string; sku?: string; batchNo?: string }>({
      query: (params) => ({ url: '/dna/lookup', params }),
    }),
    recallTrace: b.query<RecallTrace, { supplier?: string; product?: string; batchNo?: string }>({
      query: (params) => ({ url: '/dna/recall-trace', params }),
      providesTags: ['Dna'],
    }),
    verifyLot: b.mutation<LotVerifyResult, string>({ query: (id) => ({ url: `/dna/lots/${id}/verify`, method: 'POST' }), invalidatesTags: ['Dna'] }),
    lotFlag: b.mutation<DnaWrite, { id: string; action: 'hold' | 'release' | 'reject' | 'recall' | 'recall/clear'; reason: string }>({
      query: ({ id, action, reason }) => ({ url: `/dna/lots/${id}/${action}`, method: 'POST', data: { reason } }),
      invalidatesTags: [...WRITE_TAGS],
    }),
    disposeLot: b.mutation<DnaWrite, { id: string; warehouse: string; quantity: number; cause: DisposalCause; reason: string; evidence?: string[] }>({
      query: ({ id, ...data }) => ({ url: `/dna/lots/${id}/dispose`, method: 'POST', data }),
      invalidatesTags: [...WRITE_TAGS],
    }),
    returnLot: b.mutation<DnaWrite, { id: string; warehouse: string; quantity: number; reason: string }>({
      query: ({ id, ...data }) => ({ url: `/dna/lots/${id}/return-to-supplier`, method: 'POST', data }),
      invalidatesTags: [...WRITE_TAGS],
    }),
    damageLot: b.mutation<DnaWrite, { id: string; warehouse: string; quantity: number; reason: string }>({
      query: ({ id, ...data }) => ({ url: `/dna/lots/${id}/damage`, method: 'POST', data }),
      invalidatesTags: [...WRITE_TAGS],
    }),
    acceptReturn: b.mutation<DnaWrite & { parent: string }, { id: string; warehouse: string; quantity: number; reason: string; customerOrder?: string }>({
      query: ({ id, ...data }) => ({ url: `/dna/lots/${id}/accept-return`, method: 'POST', data }),
      invalidatesTags: [...WRITE_TAGS],
    }),
    decideRequest: b.mutation<{ lot: StockLot; request?: LotRequest }, { id: string; requestId: string; decision: 'approve' | 'reject'; note?: string }>({
      query: ({ id, requestId, decision, note }) => ({ url: `/dna/lots/${id}/requests/${requestId}/${decision}`, method: 'POST', data: { note } }),
      invalidatesTags: [...WRITE_TAGS],
    }),
    reconcileDna: b.mutation<ReconcileResult, void>({ query: () => ({ url: '/dna/reconcile', method: 'POST' }) }),
    runExpiryJob: b.mutation<{ checked: number; expired: number; warned: number }, void>({
      query: () => ({ url: '/dna/jobs/expiry', method: 'POST' }),
      invalidatesTags: [...WRITE_TAGS],
    }),
  }),
});

export const {
  useLotsQuery,
  useLotQuery,
  useTimelineQuery,
  useGenealogyQuery,
  useDnaStatsQuery,
  useLookupLotMutation,
  useRecallTraceQuery,
  useLazyRecallTraceQuery,
  useVerifyLotMutation,
  useLotFlagMutation,
  useDisposeLotMutation,
  useReturnLotMutation,
  useDamageLotMutation,
  useAcceptReturnMutation,
  useDecideRequestMutation,
  useReconcileDnaMutation,
  useRunExpiryJobMutation,
} = dnaApi;
