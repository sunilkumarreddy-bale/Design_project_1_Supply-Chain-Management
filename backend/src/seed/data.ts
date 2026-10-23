/** Demo data set (PART 4). All amounts in INR. */
export const SEED_PASSWORD = 'Password123!';

export const WAREHOUSES = [
  {
    code: 'WH-NORTH',
    name: 'Warehouse A',
    address: 'Peenya Industrial Area',
    city: 'Bengaluru',
    location: { lat: 13.0285, lng: 77.5197 },
    zones: [
      { code: 'A', name: 'Fast movers', bins: ['A1', 'A2', 'A3'] },
      { code: 'B', name: 'Bulk', bins: ['B1', 'B2'] },
    ],
  },
  {
    code: 'WH-SOUTH',
    name: 'Warehouse B',
    address: 'Guindy Industrial Estate',
    city: 'Chennai',
    location: { lat: 13.0067, lng: 80.2206 },
    zones: [{ code: 'A', name: 'General', bins: ['A1', 'A2'] }],
  },
  {
    code: 'WH-EAST',
    name: 'Warehouse C',
    address: 'Salt Lake Sector V',
    city: 'Kolkata',
    location: { lat: 22.5697, lng: 88.4337 },
    zones: [{ code: 'A', name: 'General', bins: ['A1'] }],
  },
] as const;

export const SUPPLIERS = [
  {
    key: 'acme',
    name: 'Acme Components',
    contactName: 'Ravi Kumar',
    email: 'orders@acme.example.com',
    phone: '+919800000101',
    address: 'Hosur Road, Bengaluru',
    location: { lat: 12.8452, lng: 77.6602 },
    leadTimeDays: 5,
  },
  {
    key: 'globex',
    name: 'Globex Traders',
    contactName: 'Meera Shah',
    email: 'sales@globex.example.com',
    phone: '+919800000102',
    address: 'Bhiwandi, Mumbai',
    location: { lat: 19.2813, lng: 73.0483 },
    leadTimeDays: 10,
  },
  {
    key: 'initech',
    name: 'Initech Supplies',
    contactName: 'Arjun Nair',
    email: 'dispatch@initech.example.com',
    phone: '+919800000103',
    address: 'Ambattur, Chennai',
    location: { lat: 13.1143, lng: 80.1548 },
    leadTimeDays: 3,
  },
] as const;

/** Globex delivered six orders in 12, 14, 11, 15, 13 and 12 days against a 10-day promise. */
export const GLOBEX_HISTORY_DAYS = [12, 14, 11, 15, 13, 12];

export const PRODUCTS = [
  { sku: 'SKU-STL-001', name: 'Steel Bracket', category: 'Hardware', unit: 'pcs', unitCost: 45, unitPrice: 70, supplier: 'acme', avgDailyDemand: 20, demandStdDev: 0 },
  { sku: 'SKU-CBL-002', name: 'USB-C Cable', category: 'Electronics', unit: 'pcs', unitCost: 120, unitPrice: 249, supplier: 'globex', avgDailyDemand: 20, demandStdDev: 3 },
  { sku: 'SKU-BOX-003', name: 'Corrugated Box', category: 'Packaging', unit: 'pcs', unitCost: 15, unitPrice: 25, supplier: 'initech', avgDailyDemand: 60, demandStdDev: 8 },
  {
    sku: 'SKU-BAT-004',
    name: 'Li-ion Battery Pack',
    category: 'Electronics',
    unit: 'pcs',
    unitCost: 900,
    unitPrice: 1400,
    supplier: 'acme',
    avgDailyDemand: 4,
    demandStdDev: 1,
    isPerishable: true,
    shelfLifeDays: 540,
    minShelfLifeDays: 30,
  },
  {
    sku: 'SKU-THP-005',
    name: 'Thermal Paste',
    category: 'Consumables',
    unit: 'tube',
    unitCost: 8,
    unitPrice: 20,
    supplier: 'globex',
    avgDailyDemand: 0.5,
    demandStdDev: 1.2,
    isPerishable: true,
    shelfLifeDays: 365,
    minShelfLifeDays: 5,
  },
  { sku: 'SKU-CMP-010', name: 'Critical Component X', category: 'Components', unit: 'pcs', unitCost: 80, unitPrice: 150, supplier: 'acme', avgDailyDemand: 30, demandStdDev: 0 },
  { sku: 'SKU-ASM-030', name: 'Assembled Unit', category: 'Finished goods', unit: 'pcs', unitCost: 300, unitPrice: 550, supplier: null, avgDailyDemand: 2, demandStdDev: 0 },
  {
    sku: 'SKU-MLK-020',
    name: 'Fresh Milk Packet',
    category: 'Dairy',
    unit: 'packet',
    unitCost: 25,
    unitPrice: 32,
    supplier: 'initech',
    avgDailyDemand: 0,
    demandStdDev: 0,
    isPerishable: true,
    shelfLifeDays: 6,
    minShelfLifeDays: 1,
  },
] as const;

export type Sku = (typeof PRODUCTS)[number]['sku'];
export type WhCode = (typeof WAREHOUSES)[number]['code'];

/**
 * 30 days of demand per (product, warehouse). "constant" keeps the worked examples exact; "varied" uses a
 * deterministic pattern so ABC-XYZ shows realistic classes.
 */
export const DEMAND: { sku: Sku; wh: WhCode; mean: number; pattern: 'constant' | 'varied' | 'erratic' }[] = [
  { sku: 'SKU-STL-001', wh: 'WH-NORTH', mean: 20, pattern: 'constant' },
  { sku: 'SKU-STL-001', wh: 'WH-SOUTH', mean: 20, pattern: 'constant' },
  { sku: 'SKU-CBL-002', wh: 'WH-NORTH', mean: 20, pattern: 'varied' },
  { sku: 'SKU-CBL-002', wh: 'WH-SOUTH', mean: 12, pattern: 'varied' },
  { sku: 'SKU-BOX-003', wh: 'WH-NORTH', mean: 60, pattern: 'varied' },
  { sku: 'SKU-BOX-003', wh: 'WH-SOUTH', mean: 40, pattern: 'varied' },
  { sku: 'SKU-BOX-003', wh: 'WH-EAST', mean: 25, pattern: 'varied' },
  { sku: 'SKU-BAT-004', wh: 'WH-NORTH', mean: 4, pattern: 'varied' },
  { sku: 'SKU-THP-005', wh: 'WH-NORTH', mean: 0.5, pattern: 'erratic' },
  { sku: 'SKU-CMP-010', wh: 'WH-NORTH', mean: 30, pattern: 'constant' },
  { sku: 'SKU-CMP-010', wh: 'WH-SOUTH', mean: 5, pattern: 'constant' },
  { sku: 'SKU-ASM-030', wh: 'WH-NORTH', mean: 2, pattern: 'constant' },
  { sku: 'SKU-ASM-030', wh: 'WH-SOUTH', mean: 2, pattern: 'constant' },
  { sku: 'SKU-MLK-020', wh: 'WH-NORTH', mean: 0, pattern: 'constant' },
  { sku: 'SKU-MLK-020', wh: 'WH-SOUTH', mean: 120, pattern: 'constant' },
];

/** Stock lines: expiresInDays is relative to seeding time (fractional to keep whole-day shelf life stable). */
export const STOCK: { sku: Sku; wh: WhCode; qty: number; bin: string; batchNo?: string; expiresInDays?: number }[] = [
  { sku: 'SKU-STL-001', wh: 'WH-NORTH', qty: 400, bin: 'B1' },
  { sku: 'SKU-STL-001', wh: 'WH-SOUTH', qty: 40, bin: 'A1' },
  { sku: 'SKU-CBL-002', wh: 'WH-NORTH', qty: 150, bin: 'A2' },
  { sku: 'SKU-CBL-002', wh: 'WH-SOUTH', qty: 200, bin: 'A2' },
  { sku: 'SKU-BOX-003', wh: 'WH-NORTH', qty: 800, bin: 'B2' },
  { sku: 'SKU-BOX-003', wh: 'WH-SOUTH', qty: 300, bin: 'A1' },
  { sku: 'SKU-BOX-003', wh: 'WH-EAST', qty: 200, bin: 'A1' },
  { sku: 'SKU-BAT-004', wh: 'WH-NORTH', qty: 30, bin: 'A3', batchNo: 'BAT-2601', expiresInDays: 45.5 },
  { sku: 'SKU-BAT-004', wh: 'WH-NORTH', qty: 50, bin: 'A3', batchNo: 'BAT-2602', expiresInDays: 300.5 },
  { sku: 'SKU-THP-005', wh: 'WH-NORTH', qty: 120, bin: 'A3', batchNo: 'THP-0915', expiresInDays: 20.5 },
  { sku: 'SKU-CMP-010', wh: 'WH-NORTH', qty: 10, bin: 'A1' },
  { sku: 'SKU-CMP-010', wh: 'WH-SOUTH', qty: 435, bin: 'A1' },
  { sku: 'SKU-ASM-030', wh: 'WH-NORTH', qty: 5, bin: 'A2' },
  { sku: 'SKU-ASM-030', wh: 'WH-SOUTH', qty: 5, bin: 'A2' },
  { sku: 'SKU-MLK-020', wh: 'WH-NORTH', qty: 500, bin: 'A1', batchNo: 'MLK-A-001', expiresInDays: 6.5 },
  { sku: 'SKU-MLK-020', wh: 'WH-SOUTH', qty: 100, bin: 'A2', batchNo: 'MLK-B-002', expiresInDays: 9.5 },
];

export const POLICIES: { sku: Sku; wh: WhCode; minStock: number; maxStock?: number }[] = [
  { sku: 'SKU-CMP-010', wh: 'WH-NORTH', minStock: 100 },
  { sku: 'SKU-CMP-010', wh: 'WH-SOUTH', minStock: 200 },
];

export const ROUTES: { from: WhCode; to: WhCode; leadTimeDays: number; costPerUnit: number; distanceKm: number }[] = [
  { from: 'WH-SOUTH', to: 'WH-NORTH', leadTimeDays: 1, costPerUnit: 2, distanceKm: 346 },
  { from: 'WH-NORTH', to: 'WH-SOUTH', leadTimeDays: 1, costPerUnit: 1.5, distanceKm: 346 },
  { from: 'WH-NORTH', to: 'WH-EAST', leadTimeDays: 5, costPerUnit: 6, distanceKm: 1871 },
  { from: 'WH-EAST', to: 'WH-NORTH', leadTimeDays: 5, costPerUnit: 6, distanceKm: 1871 },
  { from: 'WH-SOUTH', to: 'WH-EAST', leadTimeDays: 5, costPerUnit: 6, distanceKm: 1663 },
  { from: 'WH-EAST', to: 'WH-SOUTH', leadTimeDays: 5, costPerUnit: 6, distanceKm: 1663 },
];

export const OFFERS = [
  { supplier: 'initech', sku: 'SKU-CMP-010', capacityUnits: 100, minOrderQty: 10, leadTimeDays: 3, unitCost: 62 },
  { supplier: 'globex', sku: 'SKU-STL-001', capacityUnits: 500, minOrderQty: 50, leadTimeDays: 6, unitCost: 48 },
  { supplier: 'acme', sku: 'SKU-BOX-003', capacityUnits: 2000, minOrderQty: 200, leadTimeDays: 4, unitCost: 16 },
] as const;

export const CUSTOMER_ORDERS: { orderNo: string; customerName: string; wh: WhCode; dueInDays: number; priority: 'low' | 'normal' | 'high'; qty: number }[] = [
  { orderNo: 'O1', customerName: 'Alpha Retail', wh: 'WH-NORTH', dueInDays: 3, priority: 'high', qty: 20 },
  { orderNo: 'O2', customerName: 'Beta Stores', wh: 'WH-NORTH', dueInDays: 8, priority: 'normal', qty: 30 },
  { orderNo: 'O3', customerName: 'Gamma Mart', wh: 'WH-SOUTH', dueInDays: 5, priority: 'normal', qty: 15 },
  { orderNo: 'O4', customerName: 'Delta Shop', wh: 'WH-SOUTH', dueInDays: 10, priority: 'low', qty: 25 },
];
