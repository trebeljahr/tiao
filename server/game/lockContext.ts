import { AsyncLocalStorage } from "node:async_hooks";

export type LockLease = { key: string; token: string; assertCurrent(): Promise<void> };
const leases = new AsyncLocalStorage<readonly LockLease[]>();

export const withLockLease = <T>(lease: LockLease, operation: () => Promise<T>): Promise<T> =>
  leases.run([...(leases.getStore() ?? []), lease], operation);

/** Check every enclosing lease, including player/matchmaking locks. */
export async function assertCurrentLocks(): Promise<void> {
  for (const lease of leases.getStore() ?? []) await lease.assertCurrent();
}

export const currentLockToken = (key: string): string | undefined =>
  leases.getStore()?.find((lease) => lease.key === key)?.token;
