/**
 * Scripted demo steps (PART 4): disrupt Acme for 7 days, run the recovery analysis for Component X at
 * Warehouse A (Example A), scan batches for expiry redistribution (Example B) and run the Domino simulation.
 */
import { Product, StockLevel, Supplier, User, Warehouse } from '../models';
import type { AuthUser } from '../middleware/auth';
import { auditIdle } from '../middleware/audit';
import { analyze } from '../services/recovery';
import { scan } from '../services/redistribution';
import { runSimulation } from '../services/simulation';
import { declareDisruption } from '../services/suppliers';
import { flushNotifications } from '../services/notifications';

export interface Check {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface ScenarioResult {
  checks: Check[];
  lines: string[];
}

const check = (name: string, expected: unknown, actual: unknown): Check => ({
  name,
  expected: String(expected),
  actual: String(actual),
  passed: String(expected) === String(actual),
});

export async function runScenarios(): Promise<ScenarioResult> {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);
  const checks: Check[] = [];

  const adminDoc = await User.findOne({ email: 'admin@example.com' }).lean();
  if (!adminDoc) throw new Error('Seed data not found: run npm run seed first');
  const admin: AuthUser = {
    _id: adminDoc._id,
    id: adminDoc._id.toHexString(),
    name: adminDoc.name,
    email: adminDoc.email,
    role: 'admin',
    warehouse: null,
    supplier: null,
  };
  const acme = await Supplier.findOne({ name: 'Acme Components' });
  const compX = await Product.findOne({ sku: 'SKU-CMP-010' }).lean();
  const north = await Warehouse.findOne({ code: 'WH-NORTH' }).lean();
  if (!acme || !compX || !north) throw new Error('Seed data is incomplete');

  out('Step 1: declare Acme Components disrupted for 7 days');
  if (acme.status !== 'disrupted') {
    await declareDisruption(acme._id.toHexString(), { expectedDays: 7, reason: 'Fire at the Hosur Road plant (scripted demo)' }, admin);
  }
  out('  Acme status: disrupted; supplier_disruption alert raised; admins and managers notified');
  out();

  out('Step 2: recovery analysis for SKU-CMP-010 Critical Component X at Warehouse A (Example A)');
  const a = await analyze({ product: compX._id.toHexString(), warehouse: north._id.toHexString() });
  const c = a.result.context;
  out(`  on-hand ${c.onHand}, inbound ${c.inboundWithinHorizon}, demand ${c.dailyDemand}/day, minimum ${c.minStock}, horizon ${c.horizonDays} days`);
  out(`  required = ceil(${c.dailyDemand} x ${c.horizonDays}) + ${c.minStock} - (${c.onHand} + ${c.inboundWithinHorizon}) = ${c.requiredUnits}`);
  for (const o of a.result.options) {
    out(`  #${o.rank} ${o.label}: shortage left ${o.shortageLeft}, cost Rs ${o.totalCost.toLocaleString('en-IN')}, ETA ${o.etaDays} day(s)`);
    for (const e of o.explanation) out(`      ${e}`);
  }
  const top = a.result.options[0];
  checks.push(check('Example A required units', 300, c.requiredUnits));
  checks.push(
    check(
      'Example A top plan',
      'transfer 200 + purchase 100',
      top ? top.steps.map((s) => `${s.type} ${s.quantity}`).join(' + ') : 'none',
    ),
  );
  checks.push(check('Example A top plan shortage left', 0, top?.shortageLeft));
  checks.push(check('Example A top plan cost (Rs)', 6600, top?.totalCost));
  checks.push(check('Example A top plan ETA (days)', 3, top?.etaDays));
  checks.push(check('Example A rank 2 shortage (transfers only)', 100, a.result.options[1]?.shortageLeft));
  checks.push(check('Example A rank 3 shortage (supplier only)', 200, a.result.options[2]?.shortageLeft));
  out();

  out('Step 3: redistribution scan of dated batches (Example B)');
  const candidates = await scan();
  for (const cand of candidates) {
    out(`  ${cand.product.sku} batch ${cand.batchNo} at ${cand.source.name}: ${cand.quantity} units, ${cand.daysLeft} day(s) left, projected waste ${cand.projectedWaste}`);
  }
  const milkLine = await StockLevel.findOne({ batchNo: 'MLK-A-001' }).lean();
  const milk = candidates.find((x) => x.stockLevelId === milkLine?._id.toHexString());
  if (milk) {
    for (const e of milk.result.explanation) out(`      ${e}`);
  }
  checks.push(check('Example B shelf life left (days)', 6, milk?.result.shelfLifeDaysLeft));
  checks.push(check('Example B transfer to Warehouse B', 380, milk?.result.lines.find((l) => l.toWarehouseName === 'Warehouse B')?.quantity));
  checks.push(check('Example B residual at Warehouse A', 120, milk?.result.residualUnits));
  out();

  out('Step 4: Domino simulation, Acme stops for 5 days (30-day horizon, with sensitivity sweep)');
  const run = await runSimulation(
    { inline: { name: 'Acme stops 5 days (scripted demo)', type: 'supplier_stop', supplier: acme._id.toHexString(), durationDays: 5, horizonDays: 30 }, sweep: true },
    admin,
  );
  const strategies = run.strategies as { name: string; metrics: { shortageUnits: number; lateOrders: number; lostRevenue: number; serviceLevel: number } }[];
  for (const s of strategies) {
    out(
      `  ${s.name.padEnd(21)} shortage ${String(s.metrics.shortageUnits).padStart(7)}  late orders ${s.metrics.lateOrders}  lost revenue Rs ${s.metrics.lostRevenue.toLocaleString('en-IN')}  service ${(s.metrics.serviceLevel * 100).toFixed(1)}%`,
    );
  }
  const baseline = strategies.find((s) => s.name === 'none')!;
  const combined = strategies.find((s) => s.name === 'combined')!;
  checks.push(check('Domino baseline has a late order', true, baseline.metrics.lateOrders >= 1));
  checks.push(check('Domino combined shortage <= baseline', true, combined.metrics.shortageUnits <= baseline.metrics.shortageUnits));
  out(`  Saved run ${run._id}`);

  await auditIdle();
  await flushNotifications();
  return { checks, lines };
}
