import { upsertDraft } from "@/lib/draftsStore";
import { upsertCanonicalQuote } from "@/lib/canonicalStore";

// Single source of truth for queue mutations.
// - SOLD can only be authored via setStatusFromQuotes
// - Queue rank is assigned once: max+1 when entering sold or when sold but missing a valid rank
// - Labor +/- is exactly 1 day per click

export type QueueDraft = {
  id: string;
  createdAt?: number;
  status?: "estimate" | "pending" | "sold" | "complete" | "void";
  title?: string;
  customerName?: string;
  projectAddress?: string;
  laborDays?: number;
  originalLaborDays?: number;
  allowSaturday?: boolean;
  allowSunday?: boolean;
  calendarHidden?: boolean;
  queueRank?: number;
  holdDate?: string;
  startDate?: string;
  installDate?: string;
  scheduledAt?: string;
  queueLocked?: boolean;
  queueLockedAt?: number;
  [k: string]: any;
};

const STORE_KEY = "vf_estimate_drafts_v1";

function now() {
  return Date.now();
}

function notifyDraftsChanged() {
  try {
    window.dispatchEvent(new Event("vf-drafts-changed"));
  } catch {
    // ignore
  }
}

function writeQuotesStatusCache(id: string, status: QueueDraft["status"], ts: number) {
  if (typeof window === "undefined") return;
  try {
    const key = "vf_quotes_status_cache_v1";
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    const map = parsed && typeof parsed === "object" ? parsed : {};
    const sid = String(id);
    const prev = map[sid];
    const prevTs = Number(prev?.ts || 0);
    if (!prev || ts >= prevTs) {
      map[sid] = { status, ts };
      window.localStorage.setItem(key, JSON.stringify(map));
    }
  } catch {
    // ignore
  }
}

function readStore(): Record<string, QueueDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, QueueDraft>) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, QueueDraft>) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

function hasValidRank(d: any) {
  const n = Number(d?.queueRank);
  return Number.isFinite(n) && n > 0;
}

function ensureStoreEntry(store: Record<string, QueueDraft>, id: string, fallback?: QueueDraft): QueueDraft {
  const sid = String(id);
  const existing = store[sid];
  if (existing) return existing;
  const base = fallback ?? ({ id: sid } as any);
  const createdAt = Number((base as any)?.createdAt) || now();
  const entry: QueueDraft = { ...(base as any), id: sid, createdAt, updatedAt: now() };
  store[sid] = entry;
  return entry;
}

function maxSoldRank(store: Record<string, QueueDraft>) {
  let max = 0;
  for (const d of Object.values(store)) {
    if (!d) continue;
    if (d.status !== "sold") continue;
    if ((d as any).calendarHidden) continue;
    const r = Number((d as any).queueRank);
    if (Number.isFinite(r) && r > max) max = r;
  }
  return max;
}

async function safeUpsert(id: string, data: any) {
  try {
    try {
      await upsertCanonicalQuote({ id: String(id), data });
    } catch {
      // ignore
    }
    await upsertDraft({ id: String(id), data });
  } catch {
    // ignore
  }
}

export async function setStatusFromQuotes(params: {
  id: string;
  status: QueueDraft["status"];
  draftSnapshot?: QueueDraft;
}) {
  const sid = String(params.id);
  const status = params.status;
  const store = readStore();
  const prev = ensureStoreEntry(store, sid, params.draftSnapshot);
  const prevStatus = String((prev as any)?.status || "") as any;

  const ts = now();

  const next: QueueDraft = {
    ...prev,
    id: sid,
    createdAt: Number((prev as any)?.createdAt) || now(),
    status,
    calendarHidden: status === "sold" ? false : status === "void" ? true : (prev as any).calendarHidden,
    // Sold job calendar placement is computed from queue order, not persisted start dates.
    startDate: status === "sold" || status === "void" ? undefined : (prev as any).startDate,
    installDate: status === "sold" || status === "void" ? undefined : (prev as any).installDate,
    queueLockedAt: status === "sold" ? (prev as any).queueLockedAt : undefined,
    updatedAt: ts
  };

  // Quotes is the only author of SOLD + enqueue.
  if (status === "sold") {
    const needsRank = prevStatus !== "sold" || !hasValidRank(prev);
    if (needsRank) {
      next.queueRank = maxSoldRank(store) + 1;
    }
  }

  store[sid] = next;
  writeStore(store);
  writeQuotesStatusCache(sid, status, ts);
  await safeUpsert(sid, next);
  notifyDraftsChanged();
  return { ok: true as const, draft: next };
}

export async function adjustLaborDays(params: { id: string; delta: number; fallback?: QueueDraft }) {
  const sid = String(params.id);
  const store = readStore();
  const prev = ensureStoreEntry(store, sid, params.fallback);

  const cur = Number((prev as any).laborDays);
  const base = Number.isFinite(cur) && cur > 0 ? Math.round(cur) : 1;
  const nextDays = Math.max(1, base + Math.sign(params.delta || 0));

  const existingOriginal = Number((prev as any).originalLaborDays);
  const originalLaborDays = Number.isFinite(existingOriginal) && existingOriginal > 0 ? existingOriginal : base;

  const next: QueueDraft = { ...prev, id: sid, laborDays: nextDays, originalLaborDays, updatedAt: now() };
  store[sid] = next;
  writeStore(store);
  await safeUpsert(sid, next);
  notifyDraftsChanged();
  return { ok: true as const, draft: next };
}

export async function resetLaborDays(params: { id: string; fallback?: QueueDraft }) {
  const sid = String(params.id);
  const store = readStore();
  const prev = ensureStoreEntry(store, sid, params.fallback);
  const orig = Number((prev as any).originalLaborDays);
  if (!Number.isFinite(orig) || orig <= 0) return { ok: false as const };

  const next: QueueDraft = { ...prev, id: sid, laborDays: Math.max(1, Math.round(orig)), updatedAt: now() };
  store[sid] = next;
  writeStore(store);
  await safeUpsert(sid, next);
  notifyDraftsChanged();
  return { ok: true as const, draft: next };
}

export async function setHoldDate(params: { id: string; iso?: string; fallback?: QueueDraft }) {
  const sid = String(params.id);
  const store = readStore();
  const prev = ensureStoreEntry(store, sid, params.fallback);
  const next: QueueDraft = { ...prev, id: sid, holdDate: params.iso, updatedAt: now() };
  store[sid] = next;
  writeStore(store);
  await safeUpsert(sid, next);
  notifyDraftsChanged();
  return { ok: true as const, draft: next };
}

export async function setQueueLocked(params: {
  id: string;
  locked: boolean;
  startIso?: string;
  fallback?: QueueDraft;
}) {
  const sid = String(params.id);
  const store = readStore();
  const prev = ensureStoreEntry(store, sid, params.fallback);

  const lock = Boolean(params.locked);
  const startIso = String(params.startIso || "").slice(0, 10);

  const next: QueueDraft = {
    ...prev,
    id: sid,
    queueLocked: lock,
    // Locking a sold job anchors it via queueLockedAt; we do not persist calendar start dates.
    queueLockedAt: lock
      ? startIso
        ? new Date(startIso + "T12:00:00").getTime()
        : now()
      : undefined,
    startDate: undefined,
    installDate: undefined,
    updatedAt: now()
  };

  store[sid] = next;
  writeStore(store);
  await safeUpsert(sid, next);
  notifyDraftsChanged();
  return { ok: true as const, draft: next };
}

export async function toggleWeekendAllowed(params: { id: string; which: "sat" | "sun"; fallback?: QueueDraft }) {
  const sid = String(params.id);
  const store = readStore();
  const prev = ensureStoreEntry(store, sid, params.fallback);
  const curSat = Boolean((prev as any).allowSaturday);
  const curSun = Boolean((prev as any).allowSunday);
  const nextFlags =
    params.which === "sat"
      ? { allowSaturday: !curSat, allowSunday: curSun }
      : { allowSaturday: curSat, allowSunday: !curSun };

  const next: QueueDraft = { ...prev, id: sid, ...nextFlags, updatedAt: now() };
  store[sid] = next;
  writeStore(store);
  await safeUpsert(sid, next);
  notifyDraftsChanged();
  return { ok: true as const, draft: next };
}

function isHold(d: QueueDraft) {
  return Boolean(String((d as any).holdDate || "").slice(0, 10));
}

function soldQueueFromStore(store: Record<string, QueueDraft>) {
  return Object.values(store)
    .filter((d) => (d as any)?.status === "sold" && !(d as any)?.calendarHidden)
    .slice()
    .sort((a, b) =>
      Number((a as any).queueRank ?? Number.POSITIVE_INFINITY) -
      Number((b as any).queueRank ?? Number.POSITIVE_INFINITY) ||
      String((a as any).id ?? "").localeCompare(String((b as any).id ?? ""))
    );
}

function normalizeSoldRanksFromSnapshot(store: Record<string, QueueDraft>, soldSnapshot: QueueDraft[]) {
  soldSnapshot
    .filter((d) => d && (d as any).status === "sold" && !(d as any).calendarHidden)
    .forEach((d, idx) => {
      const id = String((d as any).id || "");
      if (!id) return;
      ensureStoreEntry(store, id, d as any);
      store[id] = { ...(store as any)[id], queueRank: idx + 1, updatedAt: now() };
    });
}

export async function moveSoldJobRelative(params: { id: string; dir: -1 | 1; soldSnapshot?: QueueDraft[] }) {
  const sid = String(params.id);
  const store = readStore();

  // If the UI has a merged/remote-enriched view of sold jobs, seed them into the local store so
  // reorder operations can't accidentally drop remote-only entries.
  if (Array.isArray(params.soldSnapshot)) {
    normalizeSoldRanksFromSnapshot(store, params.soldSnapshot);
  }

  const sold = soldQueueFromStore(store);
  const full = sold.map((d) => ({ ...d }));

  const holdSlots = new Set<number>();
  const holds: QueueDraft[] = [];
  const movable: QueueDraft[] = [];
  full.forEach((d, idx) => {
    if (isHold(d)) {
      holdSlots.add(idx);
      holds.push(d);
    } else {
      movable.push(d);
    }
  });

  const movableSlots = full.map((_, idx) => idx).filter((idx) => !holdSlots.has(idx));
  const curFullIdx = full.findIndex((d) => String(d.id) === sid);
  if (curFullIdx === -1) return { ok: false as const, reason: "NOT_FOUND" as const };
  if (holdSlots.has(curFullIdx)) return { ok: false as const, reason: "IS_HOLD" as const };

  const curMovIdx = movableSlots.indexOf(curFullIdx);
  if (curMovIdx === -1) return { ok: false as const, reason: "NOT_MOVABLE" as const };
  const nextMovIdx = curMovIdx + params.dir;
  if (nextMovIdx < 0 || nextMovIdx >= movableSlots.length) return { ok: false as const, reason: "OUT_OF_RANGE" as const };

  const from = movable.findIndex((d) => String(d.id) === sid);
  if (from === -1) return { ok: false as const, reason: "NOT_FOUND_MOVABLE" as const };

  const [picked] = movable.splice(from, 1);
  movable.splice(nextMovIdx, 0, picked);

  const rebuilt: QueueDraft[] = new Array(full.length);
  let h = 0;
  let m = 0;
  for (let i = 0; i < rebuilt.length; i++) {
    rebuilt[i] = holdSlots.has(i) ? holds[h++] : movable[m++];
  }

  // Persist new ranks (1..N)
  rebuilt.forEach((d, idx) => {
    const rid = String((d as any).id);
    ensureStoreEntry(store, rid, d as any);
    store[rid] = { ...(store as any)[rid], queueRank: idx + 1, updatedAt: now() };
  });

  writeStore(store);
  notifyDraftsChanged();
  try {
    void Promise.all(rebuilt.map((d) => safeUpsert(String((d as any).id), (store as any)[String((d as any).id)] ?? d)));
  } catch {
  }
  return { ok: true as const };
}

export async function moveSoldJobToPosition(params: { id: string; targetPos: number; soldSnapshot?: QueueDraft[] }) {
  const sid = String(params.id);
  const store = readStore();

  if (Array.isArray(params.soldSnapshot)) {
    normalizeSoldRanksFromSnapshot(store, params.soldSnapshot);
  }

  const sold = soldQueueFromStore(store);
  const full = sold.map((d) => ({ ...d }));

  const holdSlots = new Set<number>();
  const holds: QueueDraft[] = [];
  const movable: QueueDraft[] = [];
  full.forEach((d, idx) => {
    if (isHold(d)) {
      holdSlots.add(idx);
      holds.push(d);
    } else {
      movable.push(d);
    }
  });

  const movableSlots = full.map((_, idx) => idx).filter((idx) => !holdSlots.has(idx));
  const curFullIdx = full.findIndex((d) => String(d.id) === sid);
  if (curFullIdx === -1) return { ok: false as const, reason: "NOT_FOUND" as const };
  if (holdSlots.has(curFullIdx)) return { ok: false as const, reason: "IS_HOLD" as const };

  const desiredFullIdx = Math.max(0, Math.min(full.length - 1, Math.round(params.targetPos) - 1));
  const desiredMovIdx = movableSlots.findIndex((idx) => idx === desiredFullIdx);
  if (desiredMovIdx === -1) return { ok: false as const, reason: "TARGET_IS_HOLD" as const };

  const from = movable.findIndex((d) => String(d.id) === sid);
  if (from === -1) return { ok: false as const, reason: "NOT_FOUND_MOVABLE" as const };

  const [picked] = movable.splice(from, 1);
  movable.splice(desiredMovIdx, 0, picked);

  const rebuilt: QueueDraft[] = new Array(full.length);
  let h = 0;
  let m = 0;
  for (let i = 0; i < rebuilt.length; i++) {
    rebuilt[i] = holdSlots.has(i) ? holds[h++] : movable[m++];
  }

  rebuilt.forEach((d, idx) => {
    const rid = String((d as any).id);
    ensureStoreEntry(store, rid, d as any);
    store[rid] = { ...(store as any)[rid], queueRank: idx + 1, updatedAt: now() };
  });

  writeStore(store);
  notifyDraftsChanged();
  try {
    void Promise.all(rebuilt.map((d) => safeUpsert(String((d as any).id), (store as any)[String((d as any).id)] ?? d)));
  } catch {
  }
  return { ok: true as const };
}
