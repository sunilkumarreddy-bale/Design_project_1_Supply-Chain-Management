import { useAppSelector } from '../app/store';
import type { Role } from '../types';

export function useAuth() {
  const { user, token, selectedWarehouse } = useAppSelector((s) => s.auth);
  const role = user?.role;
  const is = (...roles: Role[]) => !!role && roles.includes(role);
  /** Warehouse the user may write to (null = any, for admins). */
  const ownWarehouse = role === 'admin' ? null : (user?.warehouse?._id ?? null);
  const canWrite = (warehouseId: string | null | undefined) => role === 'admin' || (!!warehouseId && warehouseId === ownWarehouse);
  return { user, token, role, is, selectedWarehouse, ownWarehouse, canWrite };
}
