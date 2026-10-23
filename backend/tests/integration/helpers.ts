import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../../src/app';
import { DemandHistory, Product, StockLevel, StockPolicy, Supplier, SupplierOffer, TransferRoute, User, Warehouse } from '../../src/models';
import { signToken } from '../../src/utils/jwt';
import { auditIdle } from '../../src/middleware/audit';
import { flushNotifications } from '../../src/services/notifications';
import { addDays, startOfUtcDay } from '../../src/utils/dates';

let replSet: MongoMemoryReplSet | null = null;
export const app = createApp();

/** Starts a single-node in-memory replica set (transactions need a replica set) and connects mongoose. */
export async function startDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'test' });
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

export async function stopDb() {
  await settle();
  await mongoose.disconnect();
  await replSet?.stop();
}

export async function clearDb() {
  await settle();
  const cols = await mongoose.connection.db!.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
}

/** Waits for queued audit entries and background notification deliveries. */
export async function settle() {
  await auditIdle();
  await flushNotifications();
}

export const PASSWORD = 'Password123!';

export async function makeUser(role: 'admin' | 'warehouse_manager' | 'staff' | 'supplier', extra: Record<string, unknown> = {}) {
  const email = `${role}-${new mongoose.Types.ObjectId().toHexString().slice(-6)}@test.local`;
  const user = await User.create({ name: `${role} user`, email, passwordHash: await bcrypt.hash(PASSWORD, 4), role, ...extra });
  return { user, token: signToken({ sub: user._id.toHexString(), role }), email };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export function api() {
  return request(app);
}

export function day(offset: number, from = new Date()) {
  return addDays(startOfUtcDay(from), offset);
}

/**
 * A small network: North, South, East warehouses; Acme (5 d), Globex (10 d), Initech (3 d);
 * products bracket (Acme), cable (Globex) and milk (perishable); users for every role.
 */
export async function makeWorld() {
  const [north, south, east] = await Warehouse.create([
    { code: 'WH-NORTH', name: 'Warehouse A', city: 'Bengaluru', location: { lat: 12.97, lng: 77.59 }, zones: [{ code: 'A', name: 'Zone A', bins: ['A1', 'A2', 'A3'] }] },
    { code: 'WH-SOUTH', name: 'Warehouse B', city: 'Chennai', location: { lat: 13.08, lng: 80.27 }, zones: [{ code: 'A', name: 'Zone A', bins: ['A1', 'A2'] }] },
    { code: 'WH-EAST', name: 'Warehouse C', city: 'Kolkata', location: { lat: 22.57, lng: 88.36 }, zones: [{ code: 'A', name: 'Zone A', bins: [] }] },
  ]);
  const [acme, globex, initech] = await Supplier.create([
    { name: 'Acme Components', email: 'acme@test.local', leadTimeDays: 5 },
    { name: 'Globex Traders', email: 'globex@test.local', leadTimeDays: 10 },
    { name: 'Initech Supplies', email: 'initech@test.local', leadTimeDays: 3 },
  ]);
  const [bracket, cable, milk] = await Product.create([
    { sku: 'SKU-STL-001', name: 'Steel Bracket', unitCost: 50, unitPrice: 80, primarySupplier: acme._id, avgDailyDemand: 10, demandStdDev: 2 },
    { sku: 'SKU-CBL-002', name: 'USB-C Cable', unitCost: 120, unitPrice: 250, primarySupplier: globex._id, avgDailyDemand: 20, demandStdDev: 4 },
    {
      sku: 'SKU-MLK-020',
      name: 'Fresh Milk Packet',
      unitCost: 25,
      unitPrice: 32,
      primarySupplier: initech._id,
      avgDailyDemand: 0,
      isPerishable: true,
      shelfLifeDays: 6,
      minShelfLifeDays: 1,
    },
  ]);
  const admin = await makeUser('admin');
  const manager = await makeUser('warehouse_manager', { warehouse: north._id });
  const staff = await makeUser('staff', { warehouse: north._id });
  const southManager = await makeUser('warehouse_manager', { warehouse: south._id });
  const supplier = await makeUser('supplier', { supplier: acme._id });
  const supplier2 = await makeUser('supplier', { supplier: initech._id });
  return { north, south, east, acme, globex, initech, bracket, cable, milk, admin, manager, staff, southManager, supplier, supplier2 };
}

export type World = Awaited<ReturnType<typeof makeWorld>>;

export async function seedDemand(product: unknown, warehouse: unknown, perDay: number, days = 30) {
  const today = startOfUtcDay(new Date());
  await DemandHistory.insertMany(
    Array.from({ length: days }, (_, i) => ({ product, warehouse, date: addDays(today, -(i + 1)), quantity: perDay, source: 'seed' })),
  );
}

export async function putStock(product: unknown, warehouse: unknown, quantity: number, extra: Record<string, unknown> = {}) {
  return StockLevel.create({ product, warehouse, quantity, bin: 'A1', batchNo: '', ...extra });
}

export { DemandHistory, StockPolicy, SupplierOffer, TransferRoute };
