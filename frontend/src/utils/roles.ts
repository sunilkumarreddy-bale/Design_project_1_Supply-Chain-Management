import type { Role } from '../types';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  warehouse_manager: 'Warehouse manager',
  staff: 'Staff',
  supplier: 'Supplier',
};

export const ALL: Role[] = ['admin', 'warehouse_manager', 'staff', 'supplier'];
export const INTERNAL: Role[] = ['admin', 'warehouse_manager', 'staff'];
export const MANAGERS: Role[] = ['admin', 'warehouse_manager'];

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
}

/** Navigation by role (PART 5.2). */
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '▦', roles: ALL },
  { to: '/products', label: 'Products', icon: '◫', roles: INTERNAL },
  { to: '/warehouses', label: 'Warehouses', icon: '⌂', roles: INTERNAL },
  { to: '/stock', label: 'Stock', icon: '▤', roles: INTERNAL },
  { to: '/dna', label: 'Stock DNA', icon: '⧖', roles: ALL },
  { to: '/scan', label: 'Scan', icon: '⌗', roles: INTERNAL },
  { to: '/suppliers', label: 'Suppliers', icon: '⚑', roles: ['admin', 'warehouse_manager', 'supplier'] },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: '✎', roles: ALL },
  { to: '/transfers', label: 'Transfers', icon: '⇄', roles: INTERNAL },
  { to: '/alerts', label: 'Alerts', icon: '⚠', roles: INTERNAL },
  { to: '/insights', label: 'Insights', icon: '◔', roles: MANAGERS },
  { to: '/recovery', label: 'Recovery', icon: '⟲', roles: MANAGERS },
  { to: '/redistribution', label: 'Redistribution', icon: '⇶', roles: MANAGERS },
  { to: '/simulator', label: 'Simulator', icon: '⚙', roles: MANAGERS },
  { to: '/orders', label: 'Customer Orders', icon: '☰', roles: MANAGERS },
  { to: '/counts', label: 'Cycle Counts', icon: '✓', roles: INTERNAL },
  { to: '/reports', label: 'Reports', icon: '⎙', roles: ['admin', 'warehouse_manager', 'supplier'] },
  { to: '/audit', label: 'Audit Log', icon: '⛓', roles: MANAGERS },
  { to: '/users', label: 'Users', icon: '☺', roles: ['admin'] },
  { to: '/profile', label: 'Profile', icon: '◉', roles: ALL },
];

export function can(role: Role | undefined, roles: Role[]): boolean {
  return !!role && roles.includes(role);
}
