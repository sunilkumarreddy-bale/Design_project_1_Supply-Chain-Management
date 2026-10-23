import { api } from './base';
import type {
  BatchAnalysis,
  CustomerOrder,
  GraphEdge,
  GraphNode,
  Page,
  ProductDependency,
  RecoveryAnalysis,
  RecoveryInput,
  RecoveryPlan,
  RedistributionPlan,
  Scenario,
  SimulationRun,
  StrategyName,
} from '../types';

export interface ScenarioInput {
  name?: string;
  type: 'supplier_stop' | 'supplier_delay' | 'component_stop';
  supplier?: string | null;
  product?: string | null;
  startDay: number;
  durationDays: number;
  horizonDays: number;
  backorders: boolean;
}

export const modulesApi = api.injectEndpoints({
  endpoints: (b) => ({
    analyzeRecovery: b.mutation<RecoveryAnalysis, RecoveryInput>({ query: (data) => ({ url: '/recovery/analyze', method: 'POST', data }) }),
    proposeRecovery: b.mutation<RecoveryPlan, { analysisInput: RecoveryInput; selectedOptionId: string }>({
      query: (data) => ({ url: '/recovery/plans', method: 'POST', data }),
      invalidatesTags: ['Recovery', 'Alert', 'Dashboard'],
    }),
    recoveryPlans: b.query<Page<RecoveryPlan>, { status?: string; page?: number }>({
      query: (params) => ({ url: '/recovery/plans', params }),
      providesTags: ['Recovery'],
    }),
    recoveryPlan: b.query<RecoveryPlan, string>({ query: (id) => `/recovery/plans/${id}`, providesTags: ['Recovery', 'Transfer', 'PO'] }),
    recoveryAction: b.mutation<RecoveryPlan, { id: string; action: 'approve' | 'reject' | 'cancel'; reason?: string }>({
      query: ({ id, action, reason }) => ({ url: `/recovery/plans/${id}/${action}`, method: 'POST', data: action === 'reject' ? { reason } : {} }),
      invalidatesTags: ['Recovery', 'Transfer', 'PO', 'Alert', 'Dashboard'],
    }),

    scanRedistribution: b.mutation<{ items: BatchAnalysis[]; total: number; scannedAt: string }, void>({
      query: () => ({ url: '/redistribution/scan', method: 'POST' }),
    }),
    analyzeBatch: b.mutation<BatchAnalysis, { stockLevelId: string; minShelfLifeDays?: number | null }>({
      query: (data) => ({ url: '/redistribution/analyze', method: 'POST', data }),
    }),
    proposeRedistribution: b.mutation<RedistributionPlan, { stockLevelId: string; minShelfLifeDays?: number | null }>({
      query: (data) => ({ url: '/redistribution/plans', method: 'POST', data }),
      invalidatesTags: ['Redistribution', 'Alert', 'Dashboard'],
    }),
    redistributionPlans: b.query<Page<RedistributionPlan>, { status?: string; page?: number }>({
      query: (params) => ({ url: '/redistribution/plans', params }),
      providesTags: ['Redistribution'],
    }),
    redistributionPlan: b.query<RedistributionPlan, string>({ query: (id) => `/redistribution/plans/${id}`, providesTags: ['Redistribution', 'Transfer'] }),
    redistributionAction: b.mutation<RedistributionPlan, { id: string; action: 'approve' | 'reject' | 'cancel'; reason?: string }>({
      query: ({ id, action, reason }) => ({ url: `/redistribution/plans/${id}/${action}`, method: 'POST', data: action === 'reject' ? { reason } : {} }),
      invalidatesTags: ['Redistribution', 'Transfer', 'Alert', 'Dashboard'],
    }),

    customerOrders: b.query<Page<CustomerOrder>, { status?: string; warehouse?: string; page?: number }>({
      query: (params) => ({ url: '/customer-orders', params }),
      providesTags: ['Order'],
    }),
    createOrder: b.mutation<CustomerOrder, Record<string, unknown>>({
      query: (data) => ({ url: '/customer-orders', method: 'POST', data }),
      invalidatesTags: ['Order'],
    }),
    updateOrder: b.mutation<CustomerOrder, { id: string; data: Record<string, unknown> }>({
      query: ({ id, data }) => ({ url: `/customer-orders/${id}`, method: 'PATCH', data }),
      invalidatesTags: ['Order'],
    }),
    deleteOrder: b.mutation<{ ok: true }, string>({
      query: (id) => ({ url: `/customer-orders/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Order'],
    }),
    dependencies: b.query<Page<ProductDependency>, void>({ query: () => '/product-dependencies', providesTags: ['Dependency'] }),
    createDependency: b.mutation<ProductDependency, { componentProduct: string; finishedProduct: string; quantityPer: number }>({
      query: (data) => ({ url: '/product-dependencies', method: 'POST', data }),
      invalidatesTags: ['Dependency'],
    }),
    deleteDependency: b.mutation<{ ok: true }, string>({
      query: (id) => ({ url: `/product-dependencies/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Dependency'],
    }),

    simGraph: b.query<{ graph: { nodes: GraphNode[]; edges: GraphEdge[] }; affectedNodeIds: string[] }, { supplier?: string; product?: string }>({
      query: (params) => ({ url: '/simulation/graph', params }),
    }),
    scenarios: b.query<Page<Scenario>, void>({ query: () => '/simulation/scenarios', providesTags: ['Scenario'] }),
    createScenario: b.mutation<Scenario, ScenarioInput>({
      query: (data) => ({ url: '/simulation/scenarios', method: 'POST', data }),
      invalidatesTags: ['Scenario'],
    }),
    runSimulation: b.mutation<SimulationRun, { scenario: string | ScenarioInput; strategies?: StrategyName[]; sweep?: boolean; safetyStockMultiplier?: number }>({
      query: (data) => ({ url: '/simulation/run', method: 'POST', data }),
      invalidatesTags: ['Run'],
    }),
    runs: b.query<Page<SimulationRun>, { page?: number }>({ query: (params) => ({ url: '/simulation/runs', params }), providesTags: ['Run'] }),
    run: b.query<SimulationRun, string>({ query: (id) => `/simulation/runs/${id}`, providesTags: ['Run'] }),
    planFromRun: b.mutation<RecoveryPlan, { id: string; strategy: StrategyName; positionKey: string }>({
      query: ({ id, ...data }) => ({ url: `/simulation/runs/${id}/create-recovery-plan`, method: 'POST', data }),
      invalidatesTags: ['Recovery', 'Alert'],
    }),
  }),
});

export const {
  useAnalyzeRecoveryMutation,
  useProposeRecoveryMutation,
  useRecoveryPlansQuery,
  useRecoveryPlanQuery,
  useRecoveryActionMutation,
  useScanRedistributionMutation,
  useAnalyzeBatchMutation,
  useProposeRedistributionMutation,
  useRedistributionPlansQuery,
  useRedistributionPlanQuery,
  useRedistributionActionMutation,
  useCustomerOrdersQuery,
  useCreateOrderMutation,
  useUpdateOrderMutation,
  useDeleteOrderMutation,
  useDependenciesQuery,
  useCreateDependencyMutation,
  useDeleteDependencyMutation,
  useSimGraphQuery,
  useScenariosQuery,
  useCreateScenarioMutation,
  useRunSimulationMutation,
  useRunsQuery,
  useRunQuery,
  usePlanFromRunMutation,
} = modulesApi;
