import { api } from './base';
import type { AutoDraftResult, Page, PurchaseOrder, Supplier, SupplierOffer } from '../types';

export interface SupplierInput {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  leadTimeDays?: number;
}

export interface OfferInput {
  supplier?: string | null;
  product?: string;
  capacityUnits: number;
  minOrderQty: number;
  leadTimeDays: number;
  unitCost: number;
  validUntil?: string | null;
  isActive?: boolean;
}

export interface POReceiveInput {
  receivedItems: { product: string; quantityReceived: number; batchNo?: string; expiryDate?: string | null; bin?: string }[];
  logDiscrepancy?: boolean;
  notes?: string;
}

export const procurementApi = api.injectEndpoints({
  endpoints: (b) => ({
    suppliers: b.query<Page<Supplier>, void>({ query: () => '/suppliers', providesTags: ['Supplier'] }),
    createSupplier: b.mutation<Supplier, SupplierInput>({
      query: (data) => ({ url: '/suppliers', method: 'POST', data }),
      invalidatesTags: ['Supplier', 'Me'],
    }),
    updateSupplier: b.mutation<Supplier, { id: string; data: Partial<SupplierInput> & { status?: 'active' | 'inactive' } }>({
      query: ({ id, data }) => ({ url: `/suppliers/${id}`, method: 'PATCH', data }),
      invalidatesTags: ['Supplier'],
    }),
    declareDisruption: b.mutation<Supplier, { id: string; expectedDays: number; reason: string }>({
      query: ({ id, ...data }) => ({ url: `/suppliers/${id}/disruption`, method: 'POST', data }),
      invalidatesTags: ['Supplier', 'Alert', 'Dashboard'],
    }),
    clearDisruption: b.mutation<Supplier, string>({
      query: (id) => ({ url: `/suppliers/${id}/disruption`, method: 'DELETE' }),
      invalidatesTags: ['Supplier', 'Alert', 'Dashboard'],
    }),
    offers: b.query<Page<SupplierOffer>, { supplier?: string; product?: string }>({
      query: (params) => ({ url: '/supplier-offers', params }),
      providesTags: ['Offer'],
    }),
    createOffer: b.mutation<SupplierOffer, OfferInput>({
      query: (data) => ({ url: '/supplier-offers', method: 'POST', data }),
      invalidatesTags: ['Offer'],
    }),
    updateOffer: b.mutation<SupplierOffer, { id: string; data: Partial<OfferInput> }>({
      query: ({ id, data }) => ({ url: `/supplier-offers/${id}`, method: 'PATCH', data }),
      invalidatesTags: ['Offer'],
    }),
    deleteOffer: b.mutation<{ ok: true }, string>({
      query: (id) => ({ url: `/supplier-offers/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Offer'],
    }),

    purchaseOrders: b.query<Page<PurchaseOrder>, { status?: string; supplier?: string; warehouse?: string; page?: number; limit?: number }>({
      query: (params) => ({ url: '/purchase-orders', params }),
      providesTags: ['PO'],
    }),
    purchaseOrder: b.query<PurchaseOrder, string>({ query: (id) => `/purchase-orders/${id}`, providesTags: ['PO'] }),
    createPO: b.mutation<
      PurchaseOrder,
      { supplier: string; warehouse: string; items: { product: string; quantityOrdered: number; unitCost?: number | null }[]; expectedDeliveryDate?: string | null; notes?: string; draft?: boolean }
    >({
      query: (data) => ({ url: '/purchase-orders', method: 'POST', data }),
      invalidatesTags: ['PO', 'Dashboard', 'Alert', 'Insights'],
    }),
    autoDraft: b.mutation<AutoDraftResult, { warehouse: string }>({
      query: (data) => ({ url: '/purchase-orders/auto-draft', method: 'POST', data }),
      invalidatesTags: ['PO', 'Dashboard', 'Alert', 'Insights'],
    }),
    poAction: b.mutation<PurchaseOrder, { id: string; action: 'approve' | 'reject' | 'cancel' | 'pay' | 'submit'; reason?: string }>({
      query: ({ id, action, reason }) => ({ url: `/purchase-orders/${id}/${action}`, method: 'POST', data: action === 'reject' ? { reason } : {} }),
      invalidatesTags: ['PO', 'Dashboard', 'Alert', 'Insights', 'Recovery'],
    }),
    confirmPO: b.mutation<PurchaseOrder, { id: string; confirmedQty: number; confirmedDate: string }>({
      query: ({ id, ...data }) => ({ url: `/purchase-orders/${id}/confirm`, method: 'POST', data }),
      invalidatesTags: ['PO'],
    }),
    dispatchPO: b.mutation<PurchaseOrder, { id: string; carrier: string; trackingNo: string; eta: string | null }>({
      query: ({ id, ...data }) => ({ url: `/purchase-orders/${id}/dispatch`, method: 'POST', data }),
      invalidatesTags: ['PO'],
    }),
    receivePO: b.mutation<
      { purchaseOrder: PurchaseOrder; shortLines: { product: string; outstanding: number; received: number }[]; discrepancies: unknown[]; leadTimeSample: { days: number; onTime: boolean } | null },
      { id: string } & POReceiveInput
    >({
      query: ({ id, ...data }) => ({ url: `/purchase-orders/${id}/receive`, method: 'POST', data }),
      invalidatesTags: ['PO', 'Stock', 'Dashboard', 'Alert', 'Insights', 'Supplier', 'Recovery', 'Discrepancy'],
    }),
  }),
});

export const {
  useSuppliersQuery,
  useCreateSupplierMutation,
  useUpdateSupplierMutation,
  useDeclareDisruptionMutation,
  useClearDisruptionMutation,
  useOffersQuery,
  useCreateOfferMutation,
  useUpdateOfferMutation,
  useDeleteOfferMutation,
  usePurchaseOrdersQuery,
  usePurchaseOrderQuery,
  useCreatePOMutation,
  useAutoDraftMutation,
  usePoActionMutation,
  useConfirmPOMutation,
  useDispatchPOMutation,
  useReceivePOMutation,
} = procurementApi;
