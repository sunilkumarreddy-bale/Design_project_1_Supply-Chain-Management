import { Request, Response } from 'express';
import { z } from 'zod';
import { DisruptionScenario, SimulationRun } from '../models';
import { ApiError } from '../utils/apiError';
import { currentUser } from '../middleware/auth';
import { objectId, pageOf, paging } from '../middleware/validate';
import * as svc from '../services/simulation';
import { sendPage } from './helpers';

const strategy = z.enum(['none', 'transfers', 'alternative_supplier', 'combined']);
const idOrNull = z.union([objectId, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

export const scenarioSchema = z.object({
  name: z.string().trim().max(120).optional().default(''),
  type: z.enum(['supplier_stop', 'supplier_delay', 'component_stop']),
  supplier: idOrNull,
  product: idOrNull,
  startDay: z.coerce.number().int().min(0).max(365).default(0),
  durationDays: z.coerce.number().int().min(1, 'must be at least 1').max(365),
  horizonDays: z.coerce.number().int().min(1).max(180).default(30),
  backorders: z.boolean().default(false),
});

export const runSchema = z
  .object({
    scenario: z.union([objectId, scenarioSchema]),
    strategies: z.array(strategy).optional(),
    sweep: z.boolean().default(false),
    safetyStockMultiplier: z.coerce.number().min(0).max(5).default(1),
  })
  .superRefine((v, ctx) => {
    if (typeof v.scenario === 'object') {
      const s = v.scenario;
      if (s.type !== 'component_stop' && !s.supplier) ctx.addIssue({ code: 'custom', path: ['scenario', 'supplier'], message: 'is required' });
      if (s.type === 'component_stop' && !s.product) ctx.addIssue({ code: 'custom', path: ['scenario', 'product'], message: 'is required' });
    }
  });

export const graphQuery = z.object({ supplier: objectId.optional(), product: objectId.optional() });
export const listRunsQuery = z.object({ ...paging });
export const fromRunSchema = z.object({ strategy, positionKey: z.string().regex(/^[0-9a-f]{24}:[0-9a-f]{24}$/, 'must be warehouseId:productId') });

export async function graph(req: Request, res: Response) {
  const q = req.query as z.infer<typeof graphQuery>;
  res.json(await svc.dependencyGraph(q.supplier ?? null, q.product ?? null));
}

export async function createScenario(req: Request, res: Response) {
  res.status(201).json(await svc.createScenario(req.body, currentUser(req)));
}

export async function listScenarios(_req: Request, res: Response) {
  const items = await DisruptionScenario.find().populate('supplier', 'name').populate('product', 'sku name').sort({ createdAt: -1 }).lean();
  res.json({ items, total: items.length, page: 1, limit: items.length });
}

export async function run(req: Request, res: Response) {
  const b = req.body as z.infer<typeof runSchema>;
  const r = await svc.runSimulation(
    {
      scenario: typeof b.scenario === 'string' ? b.scenario : null,
      inline: typeof b.scenario === 'object' ? b.scenario : null,
      strategies: b.strategies,
      sweep: b.sweep,
      safetyStockMultiplier: b.safetyStockMultiplier,
    },
    currentUser(req),
  );
  res.status(201).json(r.toJSON());
}

export async function listRuns(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listRunsQuery>;
  const { page, limit, skip } = pageOf(q, 20);
  const [items, total] = await Promise.all([
    SimulationRun.find()
      .select('scenario scenarioSnapshot ranAt ranBy parameters baseline.metrics strategies.name strategies.metrics')
      .populate('ranBy', 'name')
      .sort({ ranAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SimulationRun.countDocuments(),
  ]);
  sendPage(res, items, total, page, limit);
}

export async function getRun(req: Request, res: Response) {
  const r = await SimulationRun.findById(req.params.id).populate('ranBy', 'name').lean();
  if (!r) throw ApiError.notFound('Simulation run not found');
  res.json(r);
}

export async function createRecoveryPlanFromRun(req: Request, res: Response) {
  const plan = await svc.createRecoveryPlanFromRun(req.params.id, req.body, currentUser(req));
  res.status(201).json(plan);
}
