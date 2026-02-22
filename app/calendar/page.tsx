"use client";

import React from "react";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import { fetchDrafts, upsertDraft } from "@/lib/draftsStore";
import { createPortal } from "react-dom";

const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const jobColorPalette = [
  "rgba(64,156,255,.55)",
  "rgba(31,200,120,.55)",
  "rgba(255,214,10,.60)",
  "rgba(255,80,80,.55)",
  "rgba(180,120,255,.55)",
  "rgba(255,140,40,.55)",
  "rgba(0,220,255,.55)",
  "rgba(255,0,200,.45)"
];

function colorForJobId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % jobColorPalette.length;
  return jobColorPalette[idx];
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function asBool(v: unknown) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "y" || s === "on") return true;
    if (s === "false" || s === "0" || s === "no" || s === "n" || s === "off" || s === "") return false;
    return true;
  }
  return false;
}

type BlockOut = {
  id: string;
  startIso: string;
  endIso: string;
  description: string;
  createdAt: number;
};

type DraftEntry = {
  id: string;
  createdAt?: number;
  updatedAt?: number;
  title?: string;
  customerName?: string;
  projectAddress?: string;
  selectedStyle?: { name: string } | null;
  segments?: Array<{ length: number; removed?: boolean }>;
  contract?: unknown;
  status?: "estimate" | "pending" | "sold" | "void";
  scheduledAt?: string;
  installDate?: string;
  startDate?: string;
  holdDate?: string;
  laborDays?: number;
  originalLaborDays?: number;
  allowSaturday?: boolean;
  allowSunday?: boolean;
  calendarHidden?: boolean;
  queueRank?: number;
};

function readDraftStore(): Record<string, DraftEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("vf_estimate_drafts_v1");
    return raw ? (JSON.parse(raw) as Record<string, DraftEntry>) : {};
  } catch {
    return {};
  }
}

function readBlockOutStore(): BlockOut[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("vf_calendar_blockouts_v1");
    return raw ? (JSON.parse(raw) as BlockOut[]) : [];
  } catch {
    return [];
  }
}

function writeBlockOutStore(list: BlockOut[]) {
  try {
    window.localStorage.setItem("vf_calendar_blockouts_v1", JSON.stringify(list));
  } catch {
    // ignore
  }
}

function notifyDraftsChanged() {
  try {
    window.dispatchEvent(new Event("vf-drafts-changed"));
  } catch {
    // ignore
  }
}

function mergeDraftLists(local: DraftEntry[], remote: DraftEntry[]) {
  const byId = new Map<string, DraftEntry>();
  local.forEach((d) => {
    if (!d || !d.id) return;
    byId.set(String(d.id), { ...d });
  });
  remote.forEach((d) => {
    if (!d || !d.id) return;
    byId.set(String(d.id), { ...d });
  });
  return Array.from(byId.values());
}

function toKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatTimeLocal(iso: string) {
  try {
    const dt = new Date(iso);
    if (!Number.isFinite(dt.getTime())) return "";
    return dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function totalLfFromDraft(d: DraftEntry) {
  const segments = Array.isArray((d as any).segments) ? ((d as any).segments as Array<{ length: number }>) : [];
  return segments.reduce((sum, s) => sum + (Number(s.length) || 0), 0);
}

function openContractPreview(d: DraftEntry) {
  try {
    if (!d || !(d as any).contract) return;
    window.localStorage.setItem("vf_contract_preview_v1", JSON.stringify((d as any).contract));
    window.location.assign("/estimates/contract");
  } catch {
    // ignore
  }
}

function computeSpanDays(laborDays: unknown) {
  const n = Number(laborDays);
  const roundedHalf = Number.isFinite(n) && n > 0 ? Math.ceil(n * 2) / 2 : 0.5;
  return Math.max(1, Math.ceil(roundedHalf));
}

function addDays(d: Date, days: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function isWeekend(d: Date) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function nextWorkday(d: Date) {
  let cur = startOfDay(d);
  while (isWeekend(cur)) cur = addDays(cur, 1);
  return cur;
}

function workdaySequence(start: Date, count: number) {
  const days: Date[] = [];
  let cur = nextWorkday(start);
  while (days.length < count) {
    if (!isWeekend(cur)) days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

function intersectsMonth(start: Date, end: Date, monthStart: Date) {
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  return start.getTime() <= monthEnd.getTime() && end.getTime() >= monthStart.getTime();
}

export default function CalendarPage() {
  const [cursor, setCursor] = React.useState(() => new Date());
  const [selected, setSelected] = React.useState(() => new Date());
  const [dayPreviewOpen, setDayPreviewOpen] = React.useState(false);
  const [drafts, setDrafts] = React.useState<DraftEntry[]>([]);
  const [blockOuts, setBlockOuts] = React.useState<BlockOut[]>([]);
  const [portalReady, setPortalReady] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [blockStart, setBlockStart] = React.useState("");
  const [blockEnd, setBlockEnd] = React.useState("");
  const [blockDesc, setBlockDesc] = React.useState("");
  const blockStartInputRef = React.useRef<HTMLInputElement | null>(null);
  const blockEndInputRef = React.useRef<HTMLInputElement | null>(null);
  const blockDescInputRef = React.useRef<HTMLInputElement | null>(null);
  const [queueOpen, setQueueOpen] = React.useState(false);
  const [moveOpenId, setMoveOpenId] = React.useState<string | null>(null);
  const [movePreviewPos, setMovePreviewPos] = React.useState<number | null>(null);
  const [holdOpenId, setHoldOpenId] = React.useState<string | null>(null);
  const [holdDraftIso, setHoldDraftIso] = React.useState<string>("");
  const [highlightQueueId, setHighlightQueueId] = React.useState<string | null>(null);
  const highlightTimeoutRef = React.useRef<number | null>(null);
  const queueListRef = React.useRef<HTMLDivElement | null>(null);
  const queueAnchorRef = React.useRef<{ id: string; anchorTop: number } | null>(null);

  const monthStart = React.useMemo(() => startOfMonth(cursor), [cursor]);
  const monthDays = React.useMemo(() => daysInMonth(cursor), [cursor]);
  const firstDow = monthStart.getDay();

  const label = monthStart.toLocaleString(undefined, { month: "long", year: "numeric" });
  const today = new Date();
  const today0 = React.useMemo(() => startOfDay(today), [today]);

  const ensureQueueRanks = React.useCallback(() => {
    const store = readDraftStore();
    const sold = Object.values(store)
      .filter((d) => (d as any).status === "sold" && !(d as any).calendarHidden)
      .slice()
      .sort((a, b) =>
        Number((a as any).queueRank ?? Number.POSITIVE_INFINITY) -
        Number((b as any).queueRank ?? Number.POSITIVE_INFINITY) ||
        Number((a as any).updatedAt ?? (a as any).createdAt ?? 0) - Number((b as any).updatedAt ?? (b as any).createdAt ?? 0)
      );

    let nextRank = 1;
    let changed = false;
    sold.forEach((d) => {
      if (typeof (d as any).queueRank !== "number") {
        (store as any)[d.id] = { ...(store as any)[d.id], queueRank: nextRank };
        changed = true;
      }
      nextRank += 1;
    });

    if (changed) {
      window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
      try {
        Object.values(store).forEach((d) => {
          if ((d as any).status === "sold" && typeof (d as any).queueRank === "number") {
            void upsertDraft({ id: d.id, data: d });
          }
        });
      } catch {
      }
      notifyDraftsChanged();
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const store = readDraftStore();
      const localList = Object.values(store).map((d) => ({ ...d }));
      let remoteList: DraftEntry[] = [];
      try {
        const remote = await fetchDrafts();
        remoteList = remote.ok ? (remote.drafts as DraftEntry[]) : [];
      } catch {
        remoteList = [];
      }

      const merged = mergeDraftLists(localList, remoteList);
      if (!cancelled) setDrafts(merged);

      const blocks = readBlockOutStore();
      if (!cancelled) setBlockOuts(blocks);
    };

    // Ensure sold jobs have stable queue ranks before first render.
    ensureQueueRanks();
    void refresh();

    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== "vf_estimate_drafts_v1" && e.key !== "vf_calendar_blockouts_v1") return;
      void refresh();
    };
    const onDraftsChanged = () => void refresh();

    window.addEventListener("storage", onStorage);
    window.addEventListener("vf-drafts-changed", onDraftsChanged as any);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("vf-drafts-changed", onDraftsChanged as any);
    };
  }, [ensureQueueRanks]);

  React.useEffect(() => {
    if (!blockOpen) return;

    return;
  }, [blockOpen]);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!queueOpen) return;

    const body = document.body;
    const prev = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width
    };
    const scrollY = window.scrollY;

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      body.style.overflow = prev.overflow;
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [queueOpen]);

  const blockedDays = React.useMemo(() => {
    const set = new Set<string>();
    const byKey = new Map<string, BlockOut[]>();
    blockOuts.forEach((b) => {
      const start = new Date(b.startIso + "T12:00:00");
      const end = new Date(b.endIso + "T12:00:00");
      let cur = startOfDay(start);
      const end0 = startOfDay(end);
      for (let guard = 0; guard < 366; guard++) {
        const k = toKey(cur);
        set.add(k);
        const arr = byKey.get(k) ?? [];
        arr.push(b);
        byKey.set(k, arr);
        if (cur.getTime() >= end0.getTime()) break;
        cur = addDays(cur, 1);
      }
    });
    return { set, byKey };
  }, [blockOuts]);

  const isNonWorkingDay = React.useCallback(
    (d: Date) => {
      const d0 = startOfDay(d);
      return isWeekend(d0) || blockedDays.set.has(toKey(d0));
    },
    [blockedDays.set]
  );

  const nextWorkdayNW = React.useCallback(
    (d: Date) => {
      let cur = startOfDay(d);
      while (isNonWorkingDay(cur)) cur = addDays(cur, 1);
      return cur;
    },
    [isNonWorkingDay]
  );

  const workdaySequenceNW = React.useCallback(
    (start: Date, count: number) => {
      const days: Date[] = [];
      let cur = nextWorkdayNW(start);
      while (days.length < count) {
        if (!isNonWorkingDay(cur)) days.push(cur);
        cur = addDays(cur, 1);
      }
      return days;
    },
    [isNonWorkingDay, nextWorkdayNW]
  );

  const isNonWorkingDayForJob = React.useCallback(
    (d: Date, allowSaturday: boolean, allowSunday: boolean) => {
      const d0 = startOfDay(d);
      if (blockedDays.set.has(toKey(d0))) return true;
      const day = d0.getDay();
      if (day === 6) return !allowSaturday;
      if (day === 0) return !allowSunday;
      return false;
    },
    [blockedDays.set]
  );

  const nextWorkdayForJob = React.useCallback(
    (d: Date, allowSaturday: boolean, allowSunday: boolean) => {
      let cur = startOfDay(d);
      while (isNonWorkingDayForJob(cur, allowSaturday, allowSunday)) cur = addDays(cur, 1);
      return cur;
    },
    [isNonWorkingDayForJob]
  );

  const workdaySequenceForJob = React.useCallback(
    (start: Date, count: number, allowSaturday: boolean, allowSunday: boolean) => {
      const days: Date[] = [];
      let cur = nextWorkdayForJob(start, allowSaturday, allowSunday);
      while (days.length < count) {
        if (!isNonWorkingDayForJob(cur, allowSaturday, allowSunday)) days.push(cur);
        cur = addDays(cur, 1);
      }
      return days;
    },
    [isNonWorkingDayForJob, nextWorkdayForJob]
  );

  const moveQueue = React.useCallback((id: string, dir: -1 | 1) => {
    // Capture the row's current top offset within the scroll container so we can keep it
    // visually anchored after the reorder + re-render.
    try {
      const root = queueListRef.current;
      const el = root?.querySelector(`[data-queue-id="${CSS?.escape ? CSS.escape(id) : id}"]`) as HTMLElement | null;
      if (root && el) {
        const rootRect = root.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        queueAnchorRef.current = { id, anchorTop: elRect.top - rootRect.top };
      } else {
        queueAnchorRef.current = null;
      }
    } catch {
      queueAnchorRef.current = null;
    }

    const store = readDraftStore();
    const sold = Object.values(store)
      .filter((d) => (d as any).status === "sold" && !(d as any).calendarHidden)
      .slice()
      .sort((a, b) =>
        Number((a as any).queueRank ?? Number.POSITIVE_INFINITY) -
        Number((b as any).queueRank ?? Number.POSITIVE_INFINITY) ||
        Number((a as any).updatedAt ?? (a as any).createdAt ?? 0) - Number((b as any).updatedAt ?? (b as any).createdAt ?? 0)
      );

    const isHold = (d: DraftEntry) => Boolean(String((d as any).holdDate || "").slice(0, 10));
    const full = sold.map((d) => ({ ...d }));
    const holdSlots = new Set<number>();
    const holds: DraftEntry[] = [];
    const movable: DraftEntry[] = [];
    full.forEach((d, idx) => {
      if (isHold(d)) {
        holdSlots.add(idx);
        holds.push(d);
      } else {
        movable.push(d);
      }
    });
    const movableSlots = full.map((_, idx) => idx).filter((idx) => !holdSlots.has(idx));

    const curFullIdx = full.findIndex((d) => d.id === id);
    if (curFullIdx === -1) return;
    if (holdSlots.has(curFullIdx)) return;
    const curMovIdx = movableSlots.indexOf(curFullIdx);
    if (curMovIdx === -1) return;
    const nextMovIdx = curMovIdx + dir;
    if (nextMovIdx < 0 || nextMovIdx >= movableSlots.length) return;

    const from = movable.findIndex((d) => d.id === id);
    if (from === -1) return;
    const to = nextMovIdx;
    const [picked] = movable.splice(from, 1);
    movable.splice(to, 0, picked);

    const rebuilt: DraftEntry[] = new Array(full.length);
    let h = 0;
    let m = 0;
    for (let i = 0; i < rebuilt.length; i++) {
      if (holdSlots.has(i)) {
        rebuilt[i] = holds[h++];
      } else {
        rebuilt[i] = movable[m++];
      }
    }

    rebuilt.forEach((d, idx) => {
      if (!(store as any)[d.id]) return;
      (store as any)[d.id] = { ...(store as any)[d.id], queueRank: idx + 1 };
    });

    window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
    try {
      rebuilt.forEach((d) => {
        void upsertDraft({ id: d.id, data: (store as any)[d.id] ?? d });
      });
    } catch {
    }
    notifyDraftsChanged();

    setHighlightQueueId(id);
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightQueueId(null), 1200);
  }, []);

  const applyMoveToPosition = React.useCallback((id: string, targetPos: number) => {
    const store = readDraftStore();
    const sold = Object.values(store)
      .filter((d) => (d as any).status === "sold" && !(d as any).calendarHidden)
      .slice()
      .sort((a, b) =>
        Number((a as any).queueRank ?? Number.POSITIVE_INFINITY) -
        Number((b as any).queueRank ?? Number.POSITIVE_INFINITY) ||
        Number((a as any).updatedAt ?? (a as any).createdAt ?? 0) - Number((b as any).updatedAt ?? (b as any).createdAt ?? 0)
      );

    const isHold = (d: DraftEntry) => Boolean(String((d as any).holdDate || "").slice(0, 10));
    const full = sold.map((d) => ({ ...d }));
    const holdSlots = new Set<number>();
    const holds: DraftEntry[] = [];
    const movable: DraftEntry[] = [];
    full.forEach((d, idx) => {
      if (isHold(d)) {
        holdSlots.add(idx);
        holds.push(d);
      } else {
        movable.push(d);
      }
    });
    const movableSlots = full.map((_, idx) => idx).filter((idx) => !holdSlots.has(idx));
    const curFullIdx = full.findIndex((d) => d.id === id);
    if (curFullIdx === -1) return;
    if (holdSlots.has(curFullIdx)) return;

    const desiredFullIdx = Math.max(0, Math.min(full.length - 1, targetPos - 1));
    const desiredMovIdx = movableSlots.findIndex((idx) => idx === desiredFullIdx);
    if (desiredMovIdx === -1) return;

    const from = movable.findIndex((d: DraftEntry) => d.id === id);
    if (from === -1) return;
    const [picked] = movable.splice(from, 1);
    movable.splice(desiredMovIdx, 0, picked);

    const rebuilt: DraftEntry[] = new Array(full.length);
    let h = 0;
    let m = 0;
    for (let i = 0; i < rebuilt.length; i++) {
      if (holdSlots.has(i)) rebuilt[i] = holds[h++];
      else rebuilt[i] = movable[m++];
    }

    rebuilt.forEach((d, idx) => {
      if (!(store as any)[d.id]) return;
      (store as any)[d.id] = { ...(store as any)[d.id], queueRank: idx + 1 };
    });

    window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
    try {
      rebuilt.forEach((d) => {
        void upsertDraft({ id: d.id, data: (store as any)[d.id] ?? d });
      });
    } catch {
    }
    notifyDraftsChanged();
    // Update in-tab state immediately (storage events don't fire in the same tab).
    setDrafts(Object.values(store).map((d) => ({ ...d })));
    setHighlightQueueId(id);
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightQueueId(null), 1200);
  }, []);

  const toggleWeekendAllowed = React.useCallback((id: string, which: "sat" | "sun") => {
    const store = readDraftStore();
    if (!(store as any)[id]) return;
    const curSat = asBool((store as any)[id].allowSaturday);
    const curSun = asBool((store as any)[id].allowSunday);
    const next =
      which === "sat"
        ? { allowSaturday: !curSat, allowSunday: curSun }
        : { allowSaturday: curSat, allowSunday: !curSun };
    (store as any)[id] = { ...(store as any)[id], ...next, updatedAt: Date.now() };
    window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
    try {
      void upsertDraft({ id, data: (store as any)[id] });
    } catch {
    }
    notifyDraftsChanged();

    // Update in-tab state immediately (storage events don't fire in the same tab).
    setDrafts(Object.values(store).map((d) => ({ ...d })));

    setHighlightQueueId(id);
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightQueueId(null), 500);
  }, []);

  const resetLaborDays = React.useCallback((id: string) => {
    const store = readDraftStore();
    if (!(store as any)[id]) return;
    const orig = Number((store as any)[id].originalLaborDays);
    if (!Number.isFinite(orig) || orig <= 0) return;
    (store as any)[id] = { ...(store as any)[id], laborDays: Math.max(1, Math.round(orig)), updatedAt: Date.now() };
    window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
    try {
      void upsertDraft({ id, data: (store as any)[id] });
    } catch {
    }
    notifyDraftsChanged();

    setHighlightQueueId(id);
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightQueueId(null), 500);
  }, []);

  const setHoldDate = React.useCallback((id: string, iso: string | undefined) => {
    const store = readDraftStore();
    if (!(store as any)[id]) return;
    (store as any)[id] = { ...(store as any)[id], holdDate: iso, updatedAt: Date.now() };
    window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
    try {
      void upsertDraft({ id, data: (store as any)[id] });
    } catch {
    }
    notifyDraftsChanged();

    setHighlightQueueId(id);
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightQueueId(null), 500);
  }, []);

  const adjustLaborDays = React.useCallback((id: string, delta: number) => {
    const store = readDraftStore();
    if (!(store as any)[id]) return;
    const cur = Number((store as any)[id].laborDays);
    const base = computeSpanDays(Number.isFinite(cur) && cur > 0 ? cur : 1);
    const next = Math.max(1, Math.round(base + delta));

    const existingOriginal = Number((store as any)[id].originalLaborDays);
    const originalLaborDays =
      Number.isFinite(existingOriginal) && existingOriginal > 0
        ? existingOriginal
        : computeSpanDays(Number.isFinite(cur) && cur > 0 ? cur : 1);

    (store as any)[id] = { ...(store as any)[id], laborDays: next, originalLaborDays, updatedAt: Date.now() };
    window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
    try {
      void upsertDraft({ id, data: (store as any)[id] });
    } catch {
    }
    notifyDraftsChanged();

    setHighlightQueueId(id);
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightQueueId(null), 500);
  }, []);

  const soldQueue = React.useMemo(() => {
    const explicitStartIso = (d: DraftEntry) => {
      const status = (d as any).status as DraftEntry["status"];
      if (status === "estimate") {
        const s = String((d as any).scheduledAt || "");
        if (s) return s.slice(0, 10);
      }
      return String((d as any).startDate || d.installDate || "");
    };

    const occupied = new Set<string>();
    const occupiedEndByDay = new Map<string, Date>();
    const occupyRange = (startIso: string, laborDays: unknown, status: DraftEntry["status"], allowSaturday: boolean, allowSunday: boolean) => {
      if (!startIso) return;
      if (status === "estimate" || status === "void") return;
      const span = computeSpanDays(laborDays);
      const start = new Date(startIso + "T12:00:00");
      const seq = workdaySequenceForJob(start, span, allowSaturday, allowSunday);
      const end = seq[seq.length - 1];
      seq.forEach((d) => {
        const k = toKey(d);
        occupied.add(k);
        const prev = occupiedEndByDay.get(k);
        if (!prev || end.getTime() > prev.getTime()) occupiedEndByDay.set(k, end);
      });
    };

    const reserveGapDays = (from: Date, toExclusive: Date) => {
      // Mark *all* days in the gap as occupied so other jobs cannot backfill.
      // This intentionally includes weekends to keep the calendar visually "empty".
      let cur = startOfDay(from);
      const end = startOfDay(toExclusive);
      for (let guard = 0; guard < 366; guard++) {
        if (cur.getTime() >= end.getTime()) break;
        const k = toKey(cur);
        occupied.add(k);
        occupiedEndByDay.set(k, cur);
        cur = addDays(cur, 1);
      }
    };

    // Blocked days consume capacity for non-estimate/non-void work.
    blockedDays.set.forEach((k) => {
      occupied.add(k);
      const dt = new Date(k + "T12:00:00");
      occupiedEndByDay.set(k, dt);
    });

    const soldJobs = drafts
      .filter((d) => (d as any).status === "sold" && !(d as any).calendarHidden)
      .slice()
      .sort((a, b) =>
        Number((a as any).queueRank ?? Number.POSITIVE_INFINITY) -
        Number((b as any).queueRank ?? Number.POSITIVE_INFINITY) ||
        Number((a as any).updatedAt ?? (a as any).createdAt ?? 0) - Number((b as any).updatedAt ?? (b as any).createdAt ?? 0)
      );

    const scheduledStartById = new Map<string, string>();

    const maxDate = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

    let lastQueuedEnd: Date | null = null;
    soldJobs.forEach((d) => {
      const span = computeSpanDays((d as any).laborDays);
      const allowSat = asBool((d as any).allowSaturday);
      const allowSun = asBool((d as any).allowSunday);

      const requested = String((d as any).holdDate || explicitStartIso(d) || "");
      const explicitMin = requested
        ? nextWorkdayForJob(new Date(requested + "T12:00:00"), allowSat, allowSun)
        : nextWorkdayForJob(today0, allowSat, allowSun);
      const seqMin = lastQueuedEnd
        ? nextWorkdayForJob(addDays(lastQueuedEnd, 1), allowSat, allowSun)
        : nextWorkdayForJob(today0, allowSat, allowSun);

      let candidate = maxDate(explicitMin, seqMin);

      // If a hold pushes this job later than the natural sequence start, reserve the gap.
      if (requested && explicitMin.getTime() > seqMin.getTime()) {
        reserveGapDays(seqMin, explicitMin);
      }
      for (let guard = 0; guard < 365; guard++) {
        if (isNonWorkingDayForJob(candidate, allowSat, allowSun)) {
          candidate = nextWorkdayForJob(addDays(candidate, 1), allowSat, allowSun);
          continue;
        }
        const seq = workdaySequenceForJob(candidate, span, allowSat, allowSun);
        const firstConflict = seq.find((day) => occupied.has(toKey(day)));
        if (!firstConflict) {
          const iso = toKey(seq[0]);
          scheduledStartById.set(d.id, iso);
          const end = seq[seq.length - 1];
          seq.forEach((day) => {
            const k = toKey(day);
            occupied.add(k);
            const prev = occupiedEndByDay.get(k);
            if (!prev || end.getTime() > prev.getTime()) occupiedEndByDay.set(k, end);
          });
          lastQueuedEnd = seq[span - 1];
          break;
        }
        const conflictEnd = occupiedEndByDay.get(toKey(firstConflict)) || firstConflict;
        candidate = nextWorkdayForJob(addDays(conflictEnd, 1), allowSat, allowSun);
      }
    });

    const sold = soldJobs
      .map((d) => {
        const iso = scheduledStartById.get(d.id) || "";
        const install = iso ? new Date(iso + "T12:00:00") : null;
        const spanDays = computeSpanDays((d as any).laborDays);
        const allowSat = asBool((d as any).allowSaturday);
        const allowSun = asBool((d as any).allowSunday);
        const end = install ? workdaySequenceForJob(install, spanDays, allowSat, allowSun)[spanDays - 1] : null;
        return {
          ...d,
          install,
          installDate: iso,
          end,
          spanDays
        };
      })
      .filter((j): j is DraftEntry & { install: Date; installDate: string; end: Date; spanDays: number } => {
        if (!(j as any).install || !(j as any).end) return false;
        return true;
      });

    // Use queue order as primary ordering for display.
    sold.sort((a, b) =>
      Number((a as any).queueRank ?? Number.POSITIVE_INFINITY) -
        Number((b as any).queueRank ?? Number.POSITIVE_INFINITY) ||
      a.install.getTime() - b.install.getTime()
    );

    return sold;
  }, [blockedDays.set, drafts, isNonWorkingDayForJob, nextWorkdayForJob, today0, workdaySequenceForJob]);

  React.useLayoutEffect(() => {
    const snap = queueAnchorRef.current;
    if (!snap) return;
    const root = queueListRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-queue-id="${CSS?.escape ? CSS.escape(snap.id) : snap.id}"]`) as HTMLElement | null;
    if (!el) return;

    try {
      const rootRect = root.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const nextTop = elRect.top - rootRect.top;
      const delta = nextTop - snap.anchorTop;
      if (Math.abs(delta) > 0.5) root.scrollTop += delta;
    } catch {
      // ignore
    } finally {
      queueAnchorRef.current = null;
    }
  }, [soldQueue, queueOpen]);

  const monthJobs = React.useMemo(() => {
    const y = monthStart.getFullYear();
    const m = monthStart.getMonth();

    const explicitStartIso = (d: DraftEntry) => {
      const status = (d as any).status as DraftEntry["status"];
      if (status === "estimate") {
        const s = String((d as any).scheduledAt || "");
        if (s) return s.slice(0, 10);
      }
      return String((d as any).startDate || d.installDate || "");
    };

    // Build occupied set from explicitly scheduled jobs first.
    const occupied = new Set<string>();
    const occupiedEndByDay = new Map<string, Date>();
    const occupyRange = (
      startIso: string,
      laborDays: unknown,
      status: DraftEntry["status"],
      allowSaturday: boolean,
      allowSunday: boolean
    ) => {
      if (!startIso) return;
      if (status === "estimate" || status === "void") return;
      const span = computeSpanDays(laborDays);
      const start = new Date(startIso + "T12:00:00");
      const seq = workdaySequenceForJob(start, span, allowSaturday, allowSunday);
      const end = seq[seq.length - 1];
      seq.forEach((d) => {
        const k = toKey(d);
        occupied.add(k);
        const prev = occupiedEndByDay.get(k);
        if (!prev || end.getTime() > prev.getTime()) occupiedEndByDay.set(k, end);
      });
    };

    // Blocked days consume capacity for non-estimate/non-void work.
    blockedDays.set.forEach((k) => {
      occupied.add(k);
      const dt = new Date(k + "T12:00:00");
      occupiedEndByDay.set(k, dt);
    });

    const scheduledStartById = new Map<string, string>();

    // Schedule ALL SOLD jobs strictly in queue order.
    const soldJobs = drafts
      .filter((d) => (d as any).status === "sold" && !(d as any).calendarHidden)
      .slice()
      .sort((a, b) =>
        Number((a as any).queueRank ?? Number.POSITIVE_INFINITY) -
          Number((b as any).queueRank ?? Number.POSITIVE_INFINITY) ||
        Number((a as any).updatedAt ?? (a as any).createdAt ?? 0) - Number((b as any).updatedAt ?? (b as any).createdAt ?? 0)
      );

    const maxDate = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

    const reserveGapDays = (from: Date, toExclusive: Date) => {
      let cur = startOfDay(from);
      const end = startOfDay(toExclusive);
      for (let guard = 0; guard < 366; guard++) {
        if (cur.getTime() >= end.getTime()) break;
        const k = toKey(cur);
        occupied.add(k);
        occupiedEndByDay.set(k, cur);
        cur = addDays(cur, 1);
      }
    };

    let lastQueuedEnd: Date | null = null;
    soldJobs.forEach((d) => {
      const span = computeSpanDays((d as any).laborDays);
      const allowSat = asBool((d as any).allowSaturday);
      const allowSun = asBool((d as any).allowSunday);
      const minStart = lastQueuedEnd
        ? nextWorkdayForJob(addDays(lastQueuedEnd, 1), allowSat, allowSun)
        : nextWorkdayForJob(today0, allowSat, allowSun);

      const requested = String((d as any).holdDate || explicitStartIso(d) || "");
      const explicitMin = requested
        ? nextWorkdayForJob(new Date(requested + "T12:00:00"), allowSat, allowSun)
        : nextWorkdayForJob(today0, allowSat, allowSun);
      let candidate = maxDate(explicitMin, minStart);

      if (requested && explicitMin.getTime() > minStart.getTime()) {
        reserveGapDays(minStart, explicitMin);
      }

      for (let guard = 0; guard < 365; guard++) {
        if (isNonWorkingDayForJob(candidate, allowSat, allowSun)) {
          candidate = nextWorkdayForJob(addDays(candidate, 1), allowSat, allowSun);
          continue;
        }
        const seq = workdaySequenceForJob(candidate, span, allowSat, allowSun);
        const firstConflict = seq.find((day) => occupied.has(toKey(day)));
        if (!firstConflict) {
          const iso = toKey(seq[0]);
          scheduledStartById.set(d.id, iso);
          const end = seq[seq.length - 1];
          seq.forEach((day) => {
            const k = toKey(day);
            occupied.add(k);
            const prev = occupiedEndByDay.get(k);
            if (!prev || end.getTime() > prev.getTime()) occupiedEndByDay.set(k, end);
          });
          lastQueuedEnd = seq[span - 1];
          break;
        }

        const conflictEnd = occupiedEndByDay.get(toKey(firstConflict)) || firstConflict;
        candidate = nextWorkdayForJob(addDays(conflictEnd, 1), allowSat, allowSun);
      }
    });

    // Schedule non-sold capacity jobs AFTER sold queue so they can't backfill hold gaps.
    const nonSoldCapacity = drafts
      .filter(
        (d) =>
          !(d as any).calendarHidden &&
          (d as any).status !== "sold" &&
          (d as any).status !== "estimate" &&
          (d as any).status !== "void" &&
          Boolean(explicitStartIso(d))
      )
      .slice()
      .sort((a, b) => String(explicitStartIso(a)).localeCompare(String(explicitStartIso(b))));

    nonSoldCapacity.forEach((d) => {
      const span = computeSpanDays((d as any).laborDays);
      const allowSat = asBool((d as any).allowSaturday);
      const allowSun = asBool((d as any).allowSunday);
      let candidate = nextWorkdayForJob(new Date(explicitStartIso(d) + "T12:00:00"), allowSat, allowSun);
      for (let guard = 0; guard < 365; guard++) {
        const seq = workdaySequenceForJob(candidate, span, allowSat, allowSun);
        const firstConflict = seq.find((day) => occupied.has(toKey(day)));
        if (!firstConflict) {
          const iso = toKey(seq[0]);
          scheduledStartById.set(d.id, iso);
          const end = seq[seq.length - 1];
          seq.forEach((day) => {
            const k = toKey(day);
            occupied.add(k);
            const prev = occupiedEndByDay.get(k);
            if (!prev || end.getTime() > prev.getTime()) occupiedEndByDay.set(k, end);
          });
          break;
        }
        const conflictEnd = occupiedEndByDay.get(toKey(firstConflict)) || firstConflict;
        candidate = nextWorkdayForJob(addDays(conflictEnd, 1), allowSat, allowSun);
      }
    });

    const allScheduled = drafts.map((d) => {
      if ((d as any).calendarHidden) {
        return {
          ...d,
          startDate: "",
          installDate: "",
          status: (d as any).status as DraftEntry["status"],
          install: null,
          end: null,
          spanDays: 0
        } as any;
      }

      const status = (d as any).status as DraftEntry["status"];
      const explicit = explicitStartIso(d);
      const sched = String((d as any).scheduledAt || "");
      const iso = status === "sold" ? scheduledStartById.get(d.id) || "" : scheduledStartById.get(d.id) || explicit;

      const dt =
        status === "estimate" && sched
          ? new Date(sched)
          : iso
            ? new Date(iso + "T12:00:00")
            : null;
      const spanDays = status === "estimate" ? 1 : computeSpanDays((d as any).laborDays);
      const allowSat = asBool((d as any).allowSaturday);
      const allowSun = asBool((d as any).allowSunday);
      const end = dt
        ? status === "estimate"
          ? dt
          : workdaySequenceForJob(dt, spanDays, allowSat, allowSun)[spanDays - 1]
        : null;
      return {
        ...d,
        startDate: iso,
        installDate: iso,
        status,
        install: dt,
        end,
        spanDays
      };
    });

    const scheduled = allScheduled.filter(
      (d): d is DraftEntry & { install: Date; installDate: string; end: Date; spanDays: number } => {
        if ((d as any).calendarHidden) return false;
        if (!(d as any).install || !(d as any).end) return false;
        if ((d as any).status === "void") return false;
        return true;
      }
    );

    let lastCompletedId: string | null = null;
    let lastCompletedEnd: Date | null = null;
    scheduled.forEach((j) => {
      if (j.end.getTime() < today0.getTime()) {
        if (!lastCompletedEnd || j.end.getTime() > lastCompletedEnd.getTime()) {
          lastCompletedEnd = j.end;
          lastCompletedId = j.id;
        }
      }
    });

    const parsed = scheduled.filter((j) => {
      const isFutureOrOngoing = j.end.getTime() >= today0.getTime();
      const isLastCompleted = lastCompletedId && j.id === lastCompletedId;
      if (!isFutureOrOngoing && !isLastCompleted) return false;

      if (lastCompletedEnd && j.end.getTime() < lastCompletedEnd.getTime() && !isLastCompleted) return false;

      return intersectsMonth(j.install, j.end, new Date(y, m, 1));
    });

    parsed.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return parsed;
  }, [blockedDays.set, drafts, isNonWorkingDayForJob, monthStart, nextWorkdayForJob, today0, workdaySequenceForJob]);

  const jobColors = React.useMemo(() => {
    const map = new Map<string, string>();
    monthJobs.forEach((j) => {
      map.set(j.id, colorForJobId(j.id));
    });
    return map;
  }, [monthJobs]);

  const jobsByDay = React.useMemo(() => {
    const map = new Map<string, Array<DraftEntry & { color: string }>>();
    monthJobs.forEach((j) => {
      const color = jobColors.get(j.id) ?? "rgba(255,255,255,.25)";
      const start = (j as any).install instanceof Date ? ((j as any).install as Date) : new Date(j.installDate + "T12:00:00");
      const status = (j as any).status as DraftEntry["status"];
      const span = status === "estimate" ? 1 : computeSpanDays((j as any).laborDays);
      const allowSat = asBool((j as any).allowSaturday);
      const allowSun = asBool((j as any).allowSunday);
      const seq = status === "estimate" ? [start] : workdaySequenceForJob(start, span, allowSat, allowSun);
      seq.forEach((day) => {
        const key = toKey(day);
        const arr = map.get(key) ?? [];
        arr.push({ ...j, color } as any);
        map.set(key, arr);
      });
    });
    return map;
  }, [jobColors, monthJobs, workdaySequenceForJob]);

  const grid = React.useMemo(() => {
    const prevMonthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth(), 0);
    const prevDays = prevMonthEnd.getDate();

    const cells: Array<{ date: Date; inMonth: boolean }> = [];

    for (let i = 0; i < firstDow; i++) {
      const day = prevDays - (firstDow - 1 - i);
      cells.push({ date: new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), day), inMonth: false });
    }

    for (let day = 1; day <= monthDays; day++) {
      cells.push({ date: new Date(monthStart.getFullYear(), monthStart.getMonth(), day), inMonth: true });
    }

    const nextCount = 35 - cells.length;
    for (let day = 1; day <= nextCount; day++) {
      cells.push({ date: new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, day), inMonth: false });
    }

    return cells;
  }, [firstDow, monthDays, monthStart]);

  const dayJobs = React.useMemo(() => {
    const key = toKey(selected);
    const list = (jobsByDay.get(key) ?? []).slice();
    list.sort((a: any, b: any) => {
      const at = a?.install instanceof Date ? a.install.getTime() : new Date(String(a?.installDate || "") + "T12:00:00").getTime();
      const bt = b?.install instanceof Date ? b.install.getTime() : new Date(String(b?.installDate || "") + "T12:00:00").getTime();
      return at - bt;
    });
    return list;
  }, [jobsByDay, selected]);

  const dayBlocks = React.useMemo(() => {
    const key = toKey(selected);
    return blockedDays.byKey.get(key) ?? [];
  }, [blockedDays.byKey, selected]);

  return (
    <div className="space-y-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 136px)" }}>
      {dayPreviewOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-3"
          role="dialog"
          aria-modal="true"
          style={{ touchAction: "manipulation" }}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              e.stopPropagation();
              window.setTimeout(() => setDayPreviewOpen(false), 0);
            }}
          />
          <div
            className="relative w-full max-w-[520px] max-h-[85dvh] overflow-auto rounded-3xl border border-[rgba(255,255,255,.14)] bg-[rgba(20,30,24,.92)] shadow-glass backdrop-blur-ios p-4 pb-24"
            onClick={(e) => {
              e.stopPropagation();
            }}
            onPointerDown={(e) => {
              // Allow scroll/zoom inside card; still block bubbling to overlay close.
              e.stopPropagation();
            }}
            style={{ touchAction: "pan-x pan-y pinch-zoom" }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-black truncate">{selected.toLocaleDateString()}</div>
              <button
                type="button"
                data-no-swipe="true"
                onClick={() => setDayPreviewOpen(false)}
                className="rounded-2xl border px-4 py-2 text-[12px] font-black border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)]"
              >
                Close
              </button>
            </div>

              {dayBlocks.length ? (
                <div className="mt-3 grid gap-2">
                  {dayBlocks.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-2xl border border-[rgba(255,80,80,.35)] bg-[rgba(255,80,80,.10)] px-3 py-2"
                    >
                      <div className="text-[12px] font-black">Blocked</div>
                      <div className="mt-1">
                        <div className="inline-flex max-w-full rounded-full border border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.10)] px-2 py-1 text-[11px] font-extrabold text-[rgba(255,255,255,.90)] truncate">
                          {b.description}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {dayJobs.length ? (
                <div className="mt-3 grid gap-2">
                  {dayJobs.map((j) => {
                    const pos = soldQueue.findIndex((q) => q.id === j.id);
                    return (
                      <div
                        key={j.id}
                        className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] px-3 py-3"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openContractPreview(j);
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-black truncate">
                              {j.title || j.customerName || j.projectAddress || j.selectedStyle?.name || "Job"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {pos >= 0 ? <div className="text-[14px] font-black text-white">#{pos + 1}</div> : null}
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ background: (j as any).color ?? "rgba(255,255,255,.25)" }}
                            />
                          </div>
                        </div>
                      <div className="text-[11px] text-[var(--muted)] mt-1">
                        {(j as any).status === "estimate" && String((j as any).scheduledAt || "")
                          ? `Scheduled ${formatTimeLocal(String((j as any).scheduledAt))}`
                          : (j as any).installDate
                            ? `Start ${(j as any).installDate}`
                            : ""}
                        {(j as any).status === "estimate" ? "" : (j as any).end ? ` · End ${(j as any).end.toISOString().slice(0, 10)}` : ""}
                      </div>
                      <div className="text-[11px] text-[var(--muted)] mt-1">
                        {(j.selectedStyle?.name || "").trim()}
                        {totalLfFromDraft(j) ? ` · ${Math.round(totalLfFromDraft(j))} LF` : ""}
                        {j.projectAddress ? ` · ${j.projectAddress}` : ""}
                      </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 text-sm text-[var(--muted)]">No jobs scheduled.</div>
              )}

              <div className="absolute bottom-0 left-0 right-0 -mx-4 border-t border-[rgba(255,255,255,.12)] bg-[rgba(20,30,24,.92)] px-4 pb-3 pt-3 backdrop-blur-ios">
                <div className="grid grid-cols-2 gap-2">
                  {(() => {
                    const j = dayJobs[0] as any;
                    const phone = j ? String(j.customerPhone || j.phone || j.phoneNumber || "") : "";
                    const address = j ? String(j.projectAddress || j.address || "") : "";
                    const canCall = Boolean(phone);
                    const canNav = Boolean(address);
                    const openNav = () => {
                      if (!address) return;
                      const q = encodeURIComponent(address);
                      window.open(`https://maps.apple.com/?q=${q}`, "_blank", "noopener,noreferrer");
                    };
                    const openCall = () => {
                      if (!phone) return;
                      const p = phone.replace(/[^0-9+]/g, "");
                      window.location.assign(`tel:${p}`);
                    };
                    return (
                      <>
                        <button
                          type="button"
                          data-no-swipe="true"
                          disabled={!canCall}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openCall();
                          }}
                          className={
                            "rounded-2xl border px-4 py-3 text-[13px] font-black " +
                            (canCall
                              ? "border-[rgba(31,200,120,.45)] bg-[rgba(31,200,120,.14)] hover:bg-[rgba(31,200,120,.20)]"
                              : "border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] opacity-50")
                          }
                        >
                          Call
                        </button>
                        <button
                          type="button"
                          data-no-swipe="true"
                          disabled={!canNav}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openNav();
                          }}
                          className={
                            "rounded-2xl border px-4 py-3 text-[13px] font-black " +
                            (canNav
                              ? "border-[rgba(64,156,255,.55)] bg-[rgba(64,156,255,.18)] hover:bg-[rgba(64,156,255,.24)]"
                              : "border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] opacity-50")
                          }
                        >
                          Navigate
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
          </div>
        </div>
      ) : null}

      {portalReady && queueOpen ? createPortal(
        <div
          className="fixed inset-0 z-50 overflow-x-hidden"
          role="dialog"
          aria-modal="true"
          style={{ touchAction: "none" }}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              e.stopPropagation();
              window.setTimeout(() => setQueueOpen(false), 0);
            }}
          />

          {moveOpenId ? (
            <div
              className="absolute inset-0 z-[60] grid place-items-center p-2"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMoveOpenId(null);
                setMovePreviewPos(null);
              }}
            >
              <div
                className="w-full max-w-[420px]"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                <GlassCard className="p-3 overflow-hidden overflow-x-hidden flex flex-col">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-black">Move job</div>
                    <SecondaryButton
                      data-no-swipe="true"
                      onClick={() => {
                        setMoveOpenId(null);
                        setMovePreviewPos(null);
                      }}
                    >
                      Close
                    </SecondaryButton>
                  </div>

                  <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <button
                      type="button"
                      data-no-swipe="true"
                      onClick={() => {
                        if (!moveOpenId) return;
                        const cur = typeof movePreviewPos === "number" ? movePreviewPos : 1;
                        const holds = soldQueue.map((j) => Boolean(String((j as any).holdDate || "").slice(0, 10)));
                        let next = cur - 1;
                        while (next >= 1 && holds[next - 1]) next -= 1;
                        if (next >= 1) setMovePreviewPos(next);
                      }}
                      className="w-full sm:w-auto rounded-2xl border border-[rgba(31,200,120,.45)] bg-[rgba(31,200,120,.12)] px-5 py-4 text-[18px] font-black leading-none"
                      aria-label="Move up"
                    >
                      ▲
                    </button>

                    <div className="flex-1 text-center min-w-0">
                      <div className="text-[11px] text-[var(--muted)]">Position</div>
                      <div className="text-3xl font-black leading-none">
                        {typeof movePreviewPos === "number" ? movePreviewPos : "—"}
                      </div>
                      <div className="text-[11px] text-[var(--muted)] mt-1 break-words">Holds keep their slot</div>
                    </div>

                    <button
                      type="button"
                      data-no-swipe="true"
                      onClick={() => {
                        if (!moveOpenId) return;
                        const cur = typeof movePreviewPos === "number" ? movePreviewPos : 1;
                        const holds = soldQueue.map((j) => Boolean(String((j as any).holdDate || "").slice(0, 10)));
                        let next = cur + 1;
                        while (next <= holds.length && holds[next - 1]) next += 1;
                        if (next <= holds.length) setMovePreviewPos(next);
                      }}
                      className="w-full sm:w-auto rounded-2xl border border-[rgba(31,200,120,.45)] bg-[rgba(31,200,120,.12)] px-5 py-4 text-[18px] font-black leading-none"
                      aria-label="Move down"
                    >
                      ▼
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <SecondaryButton
                      data-no-swipe="true"
                      onClick={() => {
                        setMoveOpenId(null);
                        setMovePreviewPos(null);
                      }}
                    >
                      Cancel
                    </SecondaryButton>
                    <PrimaryButton
                      data-no-swipe="true"
                      onClick={() => {
                        if (!moveOpenId) return;
                        const pos = typeof movePreviewPos === "number" ? movePreviewPos : null;
                        if (!pos) return;
                        applyMoveToPosition(moveOpenId, pos);
                        setMoveOpenId(null);
                        setMovePreviewPos(null);
                      }}
                    >
                      Save
                    </PrimaryButton>
                  </div>
                </GlassCard>
              </div>
            </div>
          ) : null}

          <div
            className="absolute inset-0 p-2 flex"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
          >
            <GlassCard className="w-full max-w-[480px] mx-auto p-2 overflow-hidden overflow-x-hidden flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black">Job Queue</div>
              </div>

              <div
                ref={queueListRef}
                className="mt-2 grid gap-1.5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-3"
                style={{ overflowAnchor: "none" }}
              >
                {soldQueue.length === 0 ? (
                  <div className="text-sm text-[var(--muted)]">No sold jobs in queue.</div>
                ) : null}
                {soldQueue.map((j, idx) => {
                  const isHi = highlightQueueId === j.id;
                  const allowSat = asBool((j as any).allowSaturday);
                  const allowSun = asBool((j as any).allowSunday);
                  const style = String(j.selectedStyle?.name || "");
                  const lf = totalLfFromDraft(j);
                  const labor = computeSpanDays((j as any).laborDays);
                  const hold = String((j as any).holdDate || "").slice(0, 10);
                  const startIso = String((j as any).installDate || "");
                  const dotColor = colorForJobId(j.id);
                  const endIso = (() => {
                    const end = (j as any).end;
                    if (end instanceof Date && Number.isFinite(end.getTime())) return end.toISOString().slice(0, 10);
                    return "";
                  })();
                  const usedWeekend = (() => {
                    if (!startIso) return { sat: false, sun: false };
                    try {
                      const start = new Date(startIso + "T12:00:00");
                      const seq = workdaySequenceForJob(start, labor, allowSat, allowSun);
                      let sat = false;
                      let sun = false;
                      seq.forEach((d) => {
                        const day = d.getDay();
                        if (day === 6) sat = true;
                        if (day === 0) sun = true;
                      });
                      return { sat, sun };
                    } catch {
                      return { sat: false, sun: false };
                    }
                  })();
                  return (
                    <div
                      key={j.id}
                      data-queue-id={j.id}
                      className={
                        "rounded-2xl border px-2 py-2 transition-colors duration-150 " +
                        (isHi
                          ? "border-[rgba(31,200,120,.55)] bg-[rgba(31,200,120,.16)]"
                          : "border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]")
                      }
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-black truncate min-w-0">
                            {j.customerName || j.title || j.projectAddress || j.selectedStyle?.name || "Job"}
                          </div>
                          <div className="text-[10px] text-[var(--muted)] mt-0.5 truncate">
                            {style ? style : ""}
                            {lf ? ` · ${Math.round(lf)} LF` : ""}
                            {j.projectAddress ? ` · ${j.projectAddress}` : ""}
                          </div>
                          <div className="text-[10px] text-[var(--muted)] mt-0.5 break-words">
                            {startIso ? `Start ${startIso}` : ""}
                            {endIso ? ` · End ${endIso}` : ""}
                            {hold ? ` · Hold ${hold}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:justify-end">
                          <div
                            className="h-3.5 w-3.5 rounded-full shrink-0"
                            style={{ background: dotColor }}
                            aria-hidden="true"
                          />
                          <button
                            type="button"
                            data-no-swipe="true"
                            disabled={Boolean(hold)}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (hold) return;
                              setMoveOpenId(j.id);
                              setMovePreviewPos(idx + 1);
                            }}
                            className={
                              "rounded-xl border px-2.5 py-2 text-[11px] font-black leading-none " +
                              (hold
                                ? "border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] opacity-50"
                                : "border-[rgba(31,200,120,.45)] bg-[rgba(31,200,120,.12)]")
                            }
                            aria-label="Move"
                            title="Move"
                          >
                            Move
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] text-[var(--muted)] font-extrabold">Labor days</div>
                          <div className="flex items-center gap-2">
                            <div className="inline-flex rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(0,0,0,.18)] overflow-hidden">
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  adjustLaborDays(j.id, -1);
                                }}
                                className="px-3 py-2 text-[12px] font-black bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)]"
                                aria-label="Decrease labor days"
                              >
                                -
                              </button>
                              <div className="px-3 py-2 text-[12px] font-black leading-none min-w-[40px] text-center">
                                {labor}
                              </div>
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  adjustLaborDays(j.id, 1);
                                }}
                                className="px-3 py-2 text-[12px] font-black bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)]"
                                aria-label="Increase labor days"
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              data-no-swipe="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                resetLaborDays(j.id);
                              }}
                              className="rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] px-3 py-2 text-[12px] font-black"
                            >
                              Reset
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] text-[var(--muted)] font-extrabold">Weekend</div>
                          <div className="flex items-center gap-2">
                            <div className="inline-flex rounded-xl border border-[rgba(255,255,255,.14)] overflow-hidden">
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  toggleWeekendAllowed(j.id, "sat");
                                }}
                                className={
                                  "px-3 py-2 text-[12px] font-black transition-colors " +
                                  (usedWeekend.sat
                                    ? "border-r border-[rgba(255,255,255,.14)] bg-[rgba(255,80,80,.18)] hover:bg-[rgba(255,80,80,.24)]"
                                    : "border-r border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] opacity-80")
                                }
                                aria-pressed={allowSat}
                              >
                                Sat
                              </button>
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  toggleWeekendAllowed(j.id, "sun");
                                }}
                                className={
                                  "px-3 py-2 text-[12px] font-black transition-colors " +
                                  (usedWeekend.sun
                                    ? "bg-[rgba(255,80,80,.18)] hover:bg-[rgba(255,80,80,.24)]"
                                    : "bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] opacity-80")
                                }
                                aria-pressed={allowSun}
                              >
                                Sun
                              </button>
                            </div>
                            <div className="text-[14px] font-black text-white">#{idx + 1}</div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-2">
                        <button
                          type="button"
                          data-no-swipe="true"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (holdOpenId === j.id) {
                              setHoldOpenId(null);
                              return;
                            }
                            setHoldOpenId(j.id);
                            setHoldDraftIso(hold);
                          }}
                          className="w-full min-w-0 truncate rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] px-3 py-2 text-[12px] font-black text-left"
                        >
                          {hold ? `Hold: ${hold}` : "Set Hold Date"}
                        </button>

                        {holdOpenId === j.id ? (
                          <div
                            className="mt-2 grid gap-2 min-w-0"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                            }}
                          >
                            <input
                              type="date"
                              value={holdDraftIso}
                              onChange={(e) => setHoldDraftIso(e.currentTarget.value)}
                              className="w-full max-w-full min-w-0 rounded-xl px-3 py-2 text-[12px] font-black bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.14)] outline-none"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setHoldDate(j.id, undefined);
                                  setHoldOpenId(null);
                                  setHoldDraftIso("");
                                }}
                                className="w-full rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] px-3 py-2 text-[12px] font-black"
                              >
                                Clear
                              </button>
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setHoldOpenId(null);
                                }}
                                className="w-full rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] px-3 py-2 text-[12px] font-black"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setHoldDate(j.id, holdDraftIso || undefined);
                                  setHoldOpenId(null);
                                }}
                                className="w-full rounded-xl border border-[rgba(31,200,120,.45)] bg-[rgba(31,200,120,.12)] px-3 py-2 text-[12px] font-black"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="sticky bottom-0 -mx-2 mt-2 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
                <div className="backdrop-blur-ios bg-[rgba(20,30,24,.55)] border border-[var(--stroke)] shadow-glass rounded-2xl p-2">
                  <div className="flex items-center justify-start px-1">
                    <SecondaryButton data-no-swipe="true" onClick={() => setQueueOpen(false)}>
                      Close
                    </SecondaryButton>
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>
        </div>,
        document.body
      ) : null}

      {portalReady
        ? createPortal(
            <div className="fixed left-0 right-0 z-50 px-4" style={{ bottom: "calc(env(safe-area-inset-bottom) + 24px)" }}>
              <div className="mx-auto max-w-[980px]">
                <div className="backdrop-blur-ios bg-[rgba(20,30,24,.55)] border border-[var(--stroke)] shadow-glass rounded-2xl p-3">
                  <div className="mx-auto w-full max-w-[560px] flex items-center justify-between gap-3">
                    <button
                      type="button"
                      data-no-swipe="true"
                      onClick={() => {
                        setQueueOpen(true);
                      }}
                      className="rounded-2xl border px-4 py-3 text-[13px] font-black border-[rgba(31,200,120,.45)] bg-[rgba(31,200,120,.14)] hover:bg-[rgba(31,200,120,.20)]"
                      aria-label="Job Queue"
                    >
                      <span className="inline-flex items-center gap-2">
                        <span>Job Queue</span>
                        <span className="rounded-full border border-[rgba(255,255,255,.18)] bg-[rgba(0,0,0,.18)] px-2 py-[2px] text-[11px] font-black leading-none">
                          {soldQueue.length}
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      data-no-swipe="true"
                      onClick={() => {
                        setBlockOpen(true);
                      }}
                      className="rounded-2xl border px-4 py-3 text-[13px] font-black border-[rgba(255,80,80,.55)] bg-[rgba(255,80,80,.18)] hover:bg-[rgba(255,80,80,.24)]"
                      aria-label="Block Out Dates"
                    >
                      Block
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {blockOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-3"
          role="dialog"
          aria-modal="true"
          data-no-swipe="true"
          onPointerDownCapture={(e) => {
            e.stopPropagation();
          }}
        >
          <div
            className="absolute inset-0 bg-black/40"
            data-no-swipe="true"
            onPointerDownCapture={(e) => {
              e.stopPropagation();
            }}
          />
          <div
            className="relative w-full max-w-[520px]"
            data-no-swipe="true"
            onClick={(e) => {
              e.stopPropagation();
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onPointerDownCapture={(e) => {
              e.stopPropagation();
            }}
          >
            <GlassCard className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black">Block Out Dates</div>
                <SecondaryButton onClick={() => setBlockOpen(false)}>Close</SecondaryButton>
              </div>
              <div className="mt-3 grid gap-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-no-swipe="true"
                    onClick={() => {
                      const el = blockStartInputRef.current;
                      if (!el) return;
                      try {
                        el.showPicker?.();
                        el.focus();
                      } catch {
                        // ignore
                      }
                    }}
                    className="w-full min-w-0 truncate rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] px-3 py-2 text-[12px] font-black text-left"
                  >
                    {blockStart || "Start"}
                  </button>
                  <button
                    type="button"
                    data-no-swipe="true"
                    onClick={() => {
                      const el = blockEndInputRef.current;
                      if (!el) return;
                      try {
                        el.showPicker?.();
                        el.focus();
                      } catch {
                        // ignore
                      }
                    }}
                    className="w-full min-w-0 truncate rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] px-3 py-2 text-[12px] font-black text-left"
                  >
                    {blockEnd || "Stop"}
                  </button>

                  <input
                    ref={blockStartInputRef}
                    type="date"
                    value={blockStart}
                    onChange={(e) => {
                      setBlockStart(e.currentTarget.value);
                      if (!blockEnd) setBlockEnd(e.currentTarget.value);
                    }}
                    className="sr-only"
                  />
                  <input
                    ref={blockEndInputRef}
                    type="date"
                    value={blockEnd}
                    onChange={(e) => setBlockEnd(e.currentTarget.value)}
                    className="sr-only"
                  />
                </div>

                <input
                  ref={blockDescInputRef}
                  data-no-swipe="true"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  value={blockDesc}
                  onChange={(e) => setBlockDesc(e.currentTarget.value)}
                  className="w-full rounded-xl px-3 py-2 text-[12px] font-black bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.14)] outline-none"
                  placeholder="Description"
                />

                <div className="flex items-center justify-end gap-2">
                  <SecondaryButton
                    onClick={() => {
                      setBlockStart("");
                      setBlockEnd("");
                      setBlockDesc("");
                    }}
                  >
                    Clear
                  </SecondaryButton>
                  <SecondaryButton
                    onClick={() => {
                      const s = blockStart;
                      const e = blockEnd || blockStart;
                      if (!s || !e) return;
                      const desc = (blockDesc || "Blocked").slice(0, 120);
                      const list = readBlockOutStore();
                      const id = `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
                      list.push({ id, startIso: s, endIso: e, description: desc, createdAt: Date.now() });
                      writeBlockOutStore(list);
                      setBlockOuts(list);
                      setBlockStart("");
                      setBlockEnd("");
                      setBlockDesc("");
                    }}
                  >
                    Add
                  </SecondaryButton>
                </div>
              </div>

              {blockOuts.length ? (
                <div className="mt-3 grid gap-2">
                  {blockOuts
                    .slice()
                    .sort((a, b) => a.startIso.localeCompare(b.startIso))
                    .map((b) => (
                      <div
                        key={b.id}
                        className="rounded-2xl border border-[rgba(255,80,80,.35)] bg-[rgba(255,80,80,.10)] px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="inline-flex min-w-0 max-w-full rounded-full border border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.10)] px-2 py-1 text-[11px] font-extrabold text-[rgba(255,255,255,.90)] truncate">
                            {b.description}
                          </div>
                          <button
                            type="button"
                            data-no-swipe="true"
                            onClick={() => {
                              const next = readBlockOutStore().filter((x) => x.id !== b.id);
                              writeBlockOutStore(next);
                              setBlockOuts(next);
                            }}
                            className="rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] px-3 py-2 text-[12px] font-black"
                          >
                            Delete
                          </button>
                        </div>
                        <div className="text-[11px] text-[var(--muted)] mt-1">
                          {b.startIso}{b.endIso !== b.startIso ? ` → ${b.endIso}` : ""}
                        </div>
                      </div>
                    ))}
                </div>
              ) : null}
            </GlassCard>
          </div>
        </div>
      ) : null}

      <GlassCard className="p-4">
        <div className="flex items-center justify-between gap-2">
          <SecondaryButton
            onClick={() => {
              const d = new Date(cursor);
              d.setMonth(d.getMonth() - 1);
              setCursor(d);
            }}
          >
            Prev
          </SecondaryButton>
          <div className="text-sm font-extrabold">{label}</div>
          <SecondaryButton
            onClick={() => {
              const d = new Date(cursor);
              d.setMonth(d.getMonth() + 1);
              setCursor(d);
            }}
          >
            Next
          </SecondaryButton>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1">
          {weekday.map((w) => (
            <div key={w} className="text-[11px] text-[var(--muted)] font-extrabold text-center">
              {w}
            </div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1">
          {grid.map((c) => {
            const isToday = sameDay(c.date, today);
            const isSelected = sameDay(c.date, selected);
            const isPast = startOfDay(c.date).getTime() < today0.getTime();
            const dayKey = toKey(c.date);
            const jobs = jobsByDay.get(dayKey) ?? [];
            const isBlocked = blockedDays.set.has(dayKey);
            return (
              <button
                key={c.date.toISOString()}
                type="button"
                data-no-swipe="true"
                onClick={() => {
                  setSelected(c.date);
                  setDayPreviewOpen(true);
                }}
                className={
                  "rounded-2xl border p-1 text-left h-[clamp(44px,calc((100dvh-320px)/5),96px)] transition " +
                  (isBlocked
                    ? "border-[rgba(255,80,80,.55)] bg-[rgba(255,80,80,.22)]"
                    : c.inMonth
                      ? "border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]"
                      : "border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.03)] opacity-60") +
                  (isPast ? " opacity-50 grayscale" : "") +
                  (isSelected ? " ring-2 ring-[rgba(138,90,43,.55)]" : "")
                }
              >
                <div className="flex items-start justify-between">
                  <div
                    className={
                      "text-sm font-black leading-none " +
                      (isToday ? "text-white" : "") +
                      (isPast && !isToday ? " text-[rgba(255,255,255,.55)]" : "")
                    }
                  >
                    {c.date.getDate()}
                  </div>
                </div>

                {jobs.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {jobs.slice(0, 6).map((j) => (
                      <div
                        key={j.id}
                        className="h-2 w-2 rounded-full"
                        style={{ background: j.color }}
                        title={j.title || j.customerName || j.projectAddress || j.selectedStyle?.name || "Job"}
                      />
                    ))}
                    {jobs.length > 6 ? (
                      <div className="text-[10px] text-[var(--muted)] font-extrabold">+{jobs.length - 6}</div>
                    ) : null}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </GlassCard>

      <SectionTitle title={"Installs • " + selected.toLocaleDateString()} />
      <GlassCard className="p-4">
        {dayBlocks.length ? (
          <div className="mb-3 grid gap-2">
            {dayBlocks.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl border border-[rgba(255,80,80,.35)] bg-[rgba(255,80,80,.10)] px-3 py-2"
              >
                <div className="text-[12px] font-black">Blocked</div>
                <div className="mt-1">
                  <div className="inline-flex max-w-full rounded-full border border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.10)] px-2 py-1 text-[11px] font-extrabold text-[rgba(255,255,255,.90)] truncate">
                    {b.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {dayJobs.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">No installs scheduled.</div>
        ) : (
          <div className="grid gap-2">
            {dayJobs.map((j) => (
              <div
                key={j.id}
                className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] px-3 py-3"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openContractPreview(j);
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-black truncate">
                    {j.title || j.customerName || j.projectAddress || j.selectedStyle?.name || "Job"}
                  </div>
                  <div className="h-3 w-3 rounded-full" style={{ background: (j as any).color ?? "rgba(255,255,255,.25)" }} />
                </div>
                {(j as any).status === "estimate" && String((j as any).scheduledAt || "") ? (
                  <div className="text-[11px] text-[var(--muted)] mt-1">Scheduled {formatTimeLocal(String((j as any).scheduledAt))}</div>
                ) : null}
                <div className="text-[11px] text-[var(--muted)] mt-1">
                  {(j.selectedStyle?.name || "").trim()}
                  {totalLfFromDraft(j) ? ` · ${Math.round(totalLfFromDraft(j))} LF` : ""}
                  {j.projectAddress ? ` · ${j.projectAddress}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
