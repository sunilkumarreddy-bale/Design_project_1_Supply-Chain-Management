import { api } from './base';
import type {
  Allocation,
  Discrepancy,
  Page,
  Product,
  ReorderExplanation,
  StockCount,
  StockLine,
  StockPolicy,
  Transfer,
  TransferRoute,
  Warehouse,
} from '../types';

export interface ProductInput {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit?: string;
  unitCost: number;
  unitPrice: number;
  primarySupplier?: string | null;
  avgDailyDemand?: number;
  demandStdDev?: number;
  leadTimeDaysOverride?: number | null;
  serviceLevelZ?: number;
  orderCost?: number;
  holdingCostPerUnitYear?: number;
  isPerishable?: boolean;
  shelfLifeDays?: number | null;
  minShelfLifeDays?: number;
}

export interface ProductDetail extends Product {
  stock: { warehouse: { _id: string; code: string; name: string }; quantity: number; batches: number; nearestExpiry: string | null }[];
  lines: StockLine[];
}

export const inventoryApi = api.injectEndpoints({
  endpoints: (b) => ({
    warehouses: b.query<Page<Warehouse>, void>({ query: () => '/warehouses', providesTags: ['Warehouse'] }),
    createWarehouse: b.mutation<Warehouse, Record<string, unknown>>({
      query: (data) => ({ url: '/warehouses', method: 'POST', data }),
      invalidatesTags: ['Warehouse'],
    }),
    updateWarehouse: b.mutation<Warehouse, { id: string; data: Record<string, unknown> }>({
      query: ({ id, data }) => ({ url: `/warehouses/${id}`, method: 'PATCH', data }),
      invalidatesTags: ['Warehouse'],
    }),

    products: b.query<Page<Product>, { q?: string; page?: number; limit?: number; includeInactive?: boolean } | void>({
      query: (p) => ({ url: '/products', params: { ...(p ?? {}), includeInactive: p?.includeInactive ? 'true' : undefined } }),
      providesTags: ['Product'],
    }),
    product: b.query<ProductDetail, string>({ query: (id) => `/products/${id}`, providesTags: ['Product', 'Stock'] }),
    createProduct: b.mutation<Product, ProductInput>({
      query: (data) => ({ url: '/products', method: 'POST', data }),
      invalidatesTags: ['Product', 'Insights'],
    }),
    updateProduct: b.mutation<Product, { id: string; data: Partial<ProductInput> & { isActive?: boolean } }>({
      query: ({ id, data }) => ({ url: `/products/${id}`, method: 'PATCH', data }),
      invalidatesTags: ['Product', 'Insights'],
    }),
    uploadProductImage: b.mutation<{ imageUrl: string; driver: string }, { id: string; file: File }>({
      query: ({ id, file }) => {
        const data = new FormData();
        data.append('image', file);
        return { url: `/products/${id}/image`, method: 'POST', data };
      },
      invalidatesTags: ['Product'],
    }),
    productQr: b.query<{ payload: string; sku: string; name: string; dataUrl: string }, string>({ query: (id) => `/products/${id}/qr` }),
    scanProduct: b.mutation<{ product: Product; lines: StockLine[] }, string>({
      query: (payload) => ({ url: '/products/scan', method: 'POST', data: { payload } }),
    }),
    explain: b.query<
      { product: { _id: string; sku: string; name: string }; warehouse: string | null; onHand: number; onOrder: number; explanation: ReorderExplanation },
      { id: string; warehouse?: string | null }
    >({
      query: ({ id, warehouse }) => ({ url: `/products/${id}/explain`, params: { warehouse: warehouse ?? undefined } }),
      providesTags: ['Stock', 'Insights'],
    }),

    stock: b.query<Page<StockLine>, { warehouse?: string; product?: string; page?: number; limit?: number }>({
      query: (params) => ({ url: '/stock', params }),
      providesTags: ['Stock'],
    }),
    receiveStock: b.mutation<StockLine, { product: string; warehouse: string; quantity: number; bin?: string; batchNo?: string; expiryDate?: string | null }>({
      query: (data) => ({ url: '/stock/receive', method: 'POST', data }),
      invalidatesTags: ['Stock', 'Dashboard', 'Insights', 'Alert', 'Product'],
    }),
    dispatchStock: b.mutation<{ allocations: Allocation[]; quantity: number }, { product: string; warehouse: string; quantity: number; bin?: string; batchNo?: string }>({
      query: (data) => ({ url: '/stock/dispatch', method: 'POST', data }),
      invalidatesTags: ['Stock', 'Dashboard', 'Insights', 'Alert', 'Product'],
    }),
    transferStock: b.mutation<
      Transfer,
      { product: string; fromWarehouse: string; toWarehouse: string; quantity: number; batchNo?: string; notes?: string; mode: 'instant' | 'tracked' }
    >({
      query: (data) => ({ url: '/stock/transfer', method: 'POST', data }),
      invalidatesTags: ['Stock', 'Transfer', 'Dashboard', 'Insights', 'Alert'],
    }),

    transfers: b.query<Page<Transfer>, { status?: string; warehouse?: string; page?: number; limit?: number }>({
      query: (params) => ({ url: '/stock/transfers', params }),
      providesTags: ['Transfer'],
    }),
    transfer: b.query<Transfer, string>({ query: (id) => `/transfers/${id}`, providesTags: ['Transfer'] }),
    transferAction: b.mutation<Transfer, { id: string; action: 'approve' | 'reject' | 'dispatch' | 'receive' | 'cancel'; reason?: string; bin?: string }>({
      query: ({ id, action, reason, bin }) => ({ url: `/transfers/${id}/${action}`, method: 'POST', data: action === 'reject' ? { reason } : action === 'receive' ? { bin } : {} }),
      invalidatesTags: ['Transfer', 'Stock', 'Dashboard', 'Recovery', 'Redistribution', 'Insights'],
    }),

    counts: b.query<Page<StockCount>, { warehouse?: string; status?: string; page?: number }>({
      query: (params) => ({ url: '/stock-counts', params }),
      providesTags: ['Count'],
    }),
    count: b.query<StockCount, string>({ query: (id) => `/stock-counts/${id}`, providesTags: ['Count'] }),
    createCount: b.mutation<StockCount, { warehouse: string; product?: string; bin?: string }>({
      query: (data) => ({ url: '/stock-counts', method: 'POST', data }),
      invalidatesTags: ['Count'],
    }),
    updateCount: b.mutation<StockCount, { id: string; lines: { _id: string; countedQty: number | null; reason?: string }[] }>({
      query: ({ id, lines }) => ({ url: `/stock-counts/${id}`, method: 'PATCH', data: { lines } }),
      invalidatesTags: ['Count'],
    }),
    countAction: b.mutation<StockCount | { count: StockCount; adjustments: { lineId: string; from: number; to: number; variance: number }[] }, { id: string; action: 'submit' | 'reconcile' }>({
      query: ({ id, action }) => ({ url: `/stock-counts/${id}/${action}`, method: 'POST' }),
      invalidatesTags: ['Count', 'Stock', 'Alert', 'Dashboard'],
    }),

    discrepancies: b.query<Page<Discrepancy>, { status?: string; warehouse?: string; purchaseOrder?: string }>({
      query: (params) => ({ url: '/discrepancies', params }),
      providesTags: ['Discrepancy'],
    }),
    createDiscrepancy: b.mutation<Discrepancy, Record<string, unknown>>({
      query: (data) => ({ url: '/discrepancies', method: 'POST', data }),
      invalidatesTags: ['Discrepancy', 'Alert'],
    }),
    updateDiscrepancy: b.mutation<Discrepancy, { id: string; data: { status?: string; resolution?: string; notes?: string } }>({
      query: ({ id, data }) => ({ url: `/discrepancies/${id}`, method: 'PATCH', data }),
      invalidatesTags: ['Discrepancy', 'Alert'],
    }),
    uploadEvidence: b.mutation<Discrepancy, { id: string; file: File }>({
      query: ({ id, file }) => {
        const data = new FormData();
        data.append('file', file);
        return { url: `/discrepancies/${id}/evidence`, method: 'POST', data };
      },
      invalidatesTags: ['Discrepancy'],
    }),

    policies: b.query<Page<StockPolicy>, { product?: string; warehouse?: string }>({
      query: (params) => ({ url: '/stock-policies', params }),
      providesTags: ['Policy'],
    }),
    putPolicy: b.mutation<StockPolicy, { product: string; warehouse: string; minStock: number | null; maxStock: number | null }>({
      query: (data) => ({ url: '/stock-policies', method: 'PUT', data }),
      invalidatesTags: ['Policy', 'Insights'],
    }),
    routes: b.query<Page<TransferRoute>, void>({ query: () => '/transfer-routes', providesTags: ['Route'] }),
    putRoute: b.mutation<TransferRoute, { fromWarehouse: string; toWarehouse: string; leadTimeDays: number; costPerUnit: number }>({
      query: (data) => ({ url: '/transfer-routes', method: 'PUT', data }),
      invalidatesTags: ['Route'],
    }),
    estimateRoute: b.mutation<{ distanceKm: number; leadTimeDays: number; costPerUnit: number; saved: boolean; note?: string }, { fromWarehouse: string; toWarehouse: string }>({
      query: (data) => ({ url: '/transfer-routes/estimate', method: 'POST', data }),
      invalidatesTags: ['Route'],
    }),
  }),
});

export const {
  useWarehousesQuery,
  useCreateWarehouseMutation,
  useUpdateWarehouseMutation,
  useProductsQuery,
  useProductQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useUploadProductImageMutation,
  useProductQrQuery,
  useScanProductMutation,
  useExplainQuery,
  useStockQuery,
  useReceiveStockMutation,
  useDispatchStockMutation,
  useTransferStockMutation,
  useTransfersQuery,
  useTransferQuery,
  useTransferActionMutation,
  useCountsQuery,
  useCountQuery,
  useCreateCountMutation,
  useUpdateCountMutation,
  useCountActionMutation,
  useDiscrepanciesQuery,
  useCreateDiscrepancyMutation,
  useUpdateDiscrepancyMutation,
  useUploadEvidenceMutation,
  usePoliciesQuery,
  usePutPolicyMutation,
  useRoutesQuery,
  usePutRouteMutation,
  useEstimateRouteMutation,
} = inventoryApi;
