// server/afterMode.ts
type AfterState = { defectId: number; startedAt: number };

const TTL_MS = 15 * 60 * 1000; // 15 минут
const store = new Map<number, AfterState>(); // key = userId

export function setAfterMode(userId: number, defectId: number) {
  store.set(userId, { defectId, startedAt: Date.now() });
}

export function getAfterMode(userId: number): AfterState | null {
  const s = store.get(userId);
  if (!s) return null;
  if (Date.now() - s.startedAt > TTL_MS) {
    store.delete(userId);
    return null;
  }
  return s;
}

export function clearAfterMode(userId: number) {
  store.delete(userId);
}

export function isAfterMode(userId: number): boolean {
  return !!getAfterMode(userId);
}
