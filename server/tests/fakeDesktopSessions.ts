import {
  type DesktopSessionRecord,
  type DesktopSessionStore,
  desktopSessionStore,
} from "../auth/desktopSessionStore";

export function fakeDesktopSessionStore() {
  const rows = new Map<string, DesktopSessionRecord>();
  let state: string | null = "fake-security-state";
  const store: DesktopSessionStore = {
    async securityState() {
      return state;
    },
    async insert(row) {
      rows.set(row._id, { ...row });
    },
    async read(id) {
      return rows.has(id) ? { ...rows.get(id)! } : null;
    },
    async rotate(id, nonce, next, expiresAt) {
      const row = rows.get(id);
      if (!row || row.nonce !== nonce) return false;
      rows.set(id, { ...row, nonce: next, expiresAt });
      return true;
    },
    async delete(id) {
      rows.delete(id);
    },
  };
  return {
    store,
    rows,
    setSecurityState: (next: string | null) => {
      state = next;
    },
  };
}

export function installFakeDesktopSessions() {
  const fake = fakeDesktopSessionStore();
  Object.assign(desktopSessionStore, fake.store);
  return fake;
}
