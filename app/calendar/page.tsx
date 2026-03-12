"use client";

import React from "react";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import { fetchCalendarEntries, fetchDraft, fetchDrafts, upsertDraft } from "@/lib/draftsStore";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { createPortal } from "react-dom";
import {
  adjustLaborDays as adjustLaborDaysPipeline,
  moveSoldJobRelative as moveSoldJobRelativePipeline,
  moveSoldJobToPosition as moveSoldJobToPositionPipeline,
  resetLaborDays as resetLaborDaysPipeline,
  setHoldDate as setHoldDatePipeline,
  setQueueLocked as setQueueLockedPipeline,
  toggleWeekendAllowed as toggleWeekendAllowedPipeline
} from "@/lib/queuePipeline";

const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ESTIMATE_DOT_COLOR = "hsla(210, 96%, 66%, 0.92)";
const RESERVED_INSTALL_HUE_MIN = 195;
const RESERVED_INSTALL_HUE_MAX = 225;

const INSTALL_DOT_PALETTE: string[] = [
  "hsla(185, 92%, 50%, 0.80)",
  "hsla(275, 90%, 66%, 0.80)",
  "hsla(105, 78%, 50%, 0.80)",
  "hsla(235, 92%, 66%, 0.80)",
  "hsla(10, 92%, 62%, 0.80)",
  "hsla(255, 92%, 68%, 0.80)",
  "hsla(140, 78%, 48%, 0.80)",
  "hsla(315, 92%, 62%, 0.80)",
  "hsla(70, 84%, 55%, 0.80)",
  "hsla(335, 92%, 60%, 0.80)",
  "hsla(165, 86%, 48%, 0.80)",
  "hsla(45, 92%, 58%, 0.80)",
  "hsla(295, 90%, 64%, 0.80)",
  "hsla(28, 92%, 60%, 0.80)",
  "hsla(350, 92%, 60%, 0.80)"
];

function parseHueFromHsla(hsla: string) {
  const m = String(hsla).match(/hsla\((\s*[-\d.]+)/i);
  const hue = m ? Number(m[1]) : NaN;
  return Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : NaN;
}

function isGreenHue(h: number) {
  return h >= 70 && h <= 170;
}

function isWarmHue(h: number) {
  // red/orange family
  return h >= 0 && h <= 55;
}

function hashInt(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

function colorForInstallId(id: string) {
  const abs = Math.abs(hashInt(id));
  let hue = abs % 360;
  if (hue >= RESERVED_INSTALL_HUE_MIN && hue <= RESERVED_INSTALL_HUE_MAX) {
    hue = (hue + 48) % 360;
  }
  const sat = 74 + ((abs >> 8) % 22); // 74-95
  const light = 52 + ((abs >> 16) % 18); // 52-69
  const alpha = 0.62;
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
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

const BLOCKOUTS_REMOTE_ID = "vf_calendar_blockouts_v1";

const TASKS_REMOTE_ID = "vf_calendar_tasks_v1";

const CALENDAR_ENTRIES_CACHE_KEY = "vf_calendar_entries_cache_v1";

function readCalendarEntriesCache(key: string): DraftEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CALENDAR_ENTRIES_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    if (!parsed || typeof parsed !== "object") return [];
    const list = Array.isArray(parsed?.[key]) ? (parsed[key] as DraftEntry[]) : [];
    return (Array.isArray(list) ? list : []).filter((d) => d && typeof (d as any).id === "string");
  } catch {
    return [];
  }
}

function writeCalendarEntriesCache(key: string, list: DraftEntry[]) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(CALENDAR_ENTRIES_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : {};
    const next = parsed && typeof parsed === "object" ? { ...(parsed as any) } : {};
    next[key] = (Array.isArray(list) ? list : []).slice(0, 1200).map((d) => toCalendarDraftLite(d));
    next.updatedAt = Date.now();
    window.localStorage.setItem(CALENDAR_ENTRIES_CACHE_KEY, JSON.stringify(next));
  } catch {
  }
}

type CalendarTask = {
  id: string;
  atIso: string;
  description: string;
  createdAt: number;
};

type DraftEntry = {
  id: string;
  createdAt?: number;
  updatedAt?: number;
  title?: string;
  customerName?: string;
  phoneNumber?: string;
  customerPhone?: string;
  phone?: string;
  projectAddress?: string;
  selectedStyle?: { name: string } | null;
  segments?: Array<{ length: number; removed?: boolean }>;
  contract?: unknown;
  status?: "estimate" | "pending" | "sold" | "complete" | "void";
  scheduledAt?: string;
  estimateAssignee?: "nate" | "cam";
  installDate?: string;
  startDate?: string;
  holdDate?: string;
  laborDays?: number;
  originalLaborDays?: number;
  allowSaturday?: boolean;
  allowSunday?: boolean;
  calendarHidden?: boolean;
  queueRank?: number;
  queueLocked?: boolean;
  queueLockedAt?: number;
};

const CALENDAR_DRAFTS_CACHE_KEY = "vf_calendar_drafts_cache_v1";

function toCalendarDraftLite(d: DraftEntry): DraftEntry {
  // Keep only fields used by calendar calculations/rendering.
  // This avoids repeatedly carrying very large draft payloads (items, photos, etc.) through React state.
  return {
    id: String((d as any)?.id || ""),
    createdAt: Number((d as any)?.createdAt) || undefined,
    updatedAt: Number((d as any)?.updatedAt) || undefined,
    title: (d as any)?.title,
    customerName: (d as any)?.customerName,
    phoneNumber: (d as any)?.phoneNumber,
    customerPhone: (d as any)?.customerPhone,
    phone: (d as any)?.phone,
    projectAddress: (d as any)?.projectAddress,
    selectedStyle: (d as any)?.selectedStyle,
    segments: Array.isArray((d as any)?.segments) ? ((d as any).segments as any) : undefined,
    contract: (d as any)?.contract,
    status: (d as any)?.status,
    scheduledAt: (d as any)?.scheduledAt,
    estimateAssignee: (d as any)?.estimateAssignee,
    installDate: (d as any)?.installDate,
    startDate: (d as any)?.startDate,
    holdDate: (d as any)?.holdDate,
    laborDays: (d as any)?.laborDays,
    originalLaborDays: (d as any)?.originalLaborDays,
    allowSaturday: (d as any)?.allowSaturday,
    allowSunday: (d as any)?.allowSunday,
    calendarHidden: (d as any)?.calendarHidden,
    queueRank: (d as any)?.queueRank,
    queueLocked: (d as any)?.queueLocked,
    queueLockedAt: (d as any)?.queueLockedAt
  } as DraftEntry;
}

function readCalendarDraftsCache(): DraftEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CALENDAR_DRAFTS_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    const list = Array.isArray(parsed?.drafts) ? (parsed.drafts as DraftEntry[]) : [];
    return (Array.isArray(list) ? list : []).filter((d) => d && typeof (d as any).id === "string");
  } catch {
    return [];
  }
}

function writeCalendarDraftsCache(list: DraftEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CALENDAR_DRAFTS_CACHE_KEY,
      JSON.stringify({ updatedAt: Date.now(), drafts: (Array.isArray(list) ? list : []).map((d) => toCalendarDraftLite(d)) })
    );
  } catch {
    // ignore
  }
}

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

function mergeBlockOutLists(localList: BlockOut[], remoteList: BlockOut[]) {
  const byId = new Map<string, BlockOut>();
  for (const b of Array.isArray(remoteList) ? remoteList : []) {
    const id = String((b as any)?.id || "");
    if (!id) continue;
    byId.set(id, b);
  }
  for (const b of Array.isArray(localList) ? localList : []) {
    const id = String((b as any)?.id || "");
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, b);
      continue;
    }
    const p = Number((prev as any)?.createdAt) || 0;
    const n = Number((b as any)?.createdAt) || 0;
    if (n >= p) byId.set(id, b);
  }
  return Array.from(byId.values());
}

async function upsertBlockOutsRemote(list: BlockOut[]) {
  try {
    await upsertDraft({
      id: BLOCKOUTS_REMOTE_ID,
      data: {
        id: BLOCKOUTS_REMOTE_ID,
        kind: "calendar_blockouts",
        blockOuts: Array.isArray(list) ? list : [],
        updatedAt: Date.now()
      }
    });
  } catch {
    // ignore
  }
}

function readTaskStore(): CalendarTask[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("vf_calendar_tasks_v1");
    const parsed = raw ? (JSON.parse(raw) as any) : [];
    return Array.isArray(parsed) ? (parsed as CalendarTask[]) : [];
  } catch {
    return [];
  }
}

function writeTaskStore(list: CalendarTask[]) {
  try {
    window.localStorage.setItem("vf_calendar_tasks_v1", JSON.stringify(list));
  } catch {
    // ignore
  }
}

async function upsertTasksRemote(list: CalendarTask[]) {
  try {
    await upsertDraft({
      id: TASKS_REMOTE_ID,
      data: {
        id: TASKS_REMOTE_ID,
        kind: "calendar_tasks",
        tasks: Array.isArray(list) ? list : [],
        updatedAt: Date.now()
      }
    });
  } catch {
    // ignore
  }
}

function mergeTaskLists(localList: CalendarTask[], remoteList: CalendarTask[]) {
  const byId = new Map<string, CalendarTask>();
  for (const t of Array.isArray(remoteList) ? remoteList : []) {
    const id = String((t as any)?.id || "");
    if (!id) continue;
    byId.set(id, t);
  }
  for (const t of Array.isArray(localList) ? localList : []) {
    const id = String((t as any)?.id || "");
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, t);
      continue;
    }
    const p = Number((prev as any)?.createdAt) || 0;
    const n = Number((t as any)?.createdAt) || 0;
    if (n >= p) byId.set(id, t);
  }
  return Array.from(byId.values());
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
    const id = String(d.id);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...d });
      return;
    }

    // Queue is the control center for SOLD jobs.
    // If local says a job is sold, always keep local queue-control fields so remote refresh cannot
    // reorder/snap-back position or duration.
    const localIsSold = (prev as any).status === "sold" && !(prev as any).calendarHidden;
    if (localIsSold) {
      byId.set(id, {
        ...d,
        ...prev,
        status: (prev as any).status,
        calendarHidden: (prev as any).calendarHidden,
        queueRank: (prev as any).queueRank,
        laborDays: (prev as any).laborDays,
        originalLaborDays: (prev as any).originalLaborDays,
        holdDate: (prev as any).holdDate,
        allowSaturday: (prev as any).allowSaturday,
        allowSunday: (prev as any).allowSunday
      });
      return;
    }

    const prevTs = Number((prev as any).updatedAt ?? (prev as any).createdAt ?? 0) || 0;
    const nextTs = Number((d as any).updatedAt ?? (d as any).createdAt ?? 0) || 0;

    // Prefer whichever copy is newer; fall back to local if equal.
    if (nextTs > prevTs) byId.set(id, { ...prev, ...d });
  });
  return Array.from(byId.values());
}

async function publishScheduledEstimates(params: { localList: DraftEntry[]; remoteList: DraftEntry[] }) {
  try {
    if (!supabaseConfigured) return;

    const remoteById = new Map<string, DraftEntry>();
    for (const d of Array.isArray(params.remoteList) ? params.remoteList : []) {
      const id = String((d as any)?.id || "");
      if (!id) continue;
      remoteById.set(id, d);
    }

    const pending: DraftEntry[] = [];
    for (const d of Array.isArray(params.localList) ? params.localList : []) {
      const id = String((d as any)?.id || "");
      if (!id) continue;
      const status = (d as any).status as DraftEntry["status"];
      if (status !== "estimate") continue;
      const scheduledAt = String((d as any).scheduledAt || "");
      if (!scheduledAt) continue;

      const remote = remoteById.get(id);
      const localTs = Number((d as any).updatedAt ?? (d as any).createdAt ?? 0) || 0;
      const remoteTs = Number((remote as any)?.updatedAt ?? (remote as any)?.createdAt ?? 0) || 0;
      if (!remote || localTs > remoteTs) pending.push(d);
    }

    // Publish in small batches to avoid tying up the main thread/network.
    for (let i = 0; i < pending.length; i += 6) {
      const batch = pending.slice(i, i + 6);
      await Promise.all(
        batch.map(async (d) => {
          try {
            const id = String((d as any)?.id || "");
            if (!id) return;
            await upsertDraft({ id, data: d });
          } catch {
          }
        })
      );
    }
  } catch {
  }
}

function toKey(d: Date) {
  // Use local date parts (not UTC) so the calendar doesn't shift days in different timezones/DST.
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
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
    try {
      window.localStorage.setItem("vf_contract_preview_v1", JSON.stringify((d as any).contract));
    } catch {
    }
    const id = String((d as any).id || "").trim();
    window.location.assign(`/estimates/contract${id ? `?draft=${encodeURIComponent(id)}` : ""}`);
  } catch {
    // ignore
  }
}

function markDraftComplete(id: string) {
  try {
    const store = readDraftStore();
    if (!(store as any)[id]) return;
    (store as any)[id] = {
      ...(store as any)[id],
      status: "complete",
      calendarHidden: true,
      updatedAt: Date.now()
    };
    window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
    try {
      void upsertDraft({ id, data: (store as any)[id] });
    } catch {
    }
    notifyDraftsChanged();
  } catch {
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
  const suppressDayPreviewOpenUntilRef = React.useRef(0);
  const localMutationEpochRef = React.useRef(0);
  const [drafts, setDrafts] = React.useState<DraftEntry[]>([]);
  const [blockOuts, setBlockOuts] = React.useState<BlockOut[]>([]);
  const [portalReady, setPortalReady] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [blockStart, setBlockStart] = React.useState("");
  const [blockEnd, setBlockEnd] = React.useState("");
  const [blockDesc, setBlockDesc] = React.useState("");
  const [tasks, setTasks] = React.useState<CalendarTask[]>([]);
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [taskDate, setTaskDate] = React.useState("");
  const [taskTime, setTaskTime] = React.useState("");
  const [taskDesc, setTaskDesc] = React.useState("");
  const [syncDiag, setSyncDiag] = React.useState(() => ({
    supabaseConfigured,
    blockouts: { ok: false as boolean, count: 0 as number, error: "" as string },
    tasks: { ok: false as boolean, count: 0 as number, error: "" as string }
  }));
  const blockStartInputRef = React.useRef<HTMLInputElement | null>(null);
  const blockEndInputRef = React.useRef<HTMLInputElement | null>(null);
  const blockDescInputRef = React.useRef<HTMLInputElement | null>(null);
  const [queueOpen, setQueueOpen] = React.useState(false);
  const [moveOpenId, setMoveOpenId] = React.useState<string | null>(null);
  const [movePreviewPos, setMovePreviewPos] = React.useState<number | null>(null);
  const [moveError, setMoveError] = React.useState<string>("");
  const [moveSaving, setMoveSaving] = React.useState(false);
  const [holdOpenId, setHoldOpenId] = React.useState<string | null>(null);
  const [holdDraftIso, setHoldDraftIso] = React.useState<string>("");
  const [highlightQueueId, setHighlightQueueId] = React.useState<string | null>(null);
  const highlightTimeoutRef = React.useRef<number | null>(null);
  const queueListRef = React.useRef<HTMLDivElement | null>(null);
  const queueAnchorRef = React.useRef<{ id: string; anchorTop: number } | null>(null);

  const refreshDebounceRef = React.useRef<number | null>(null);

  const withTimeout = React.useCallback(async <T,>(p: Promise<T>, ms: number) => {
    return await Promise.race([
      p,
      new Promise<T>((_resolve, reject) => {
        window.setTimeout(() => reject(new Error("timeout")), ms);
      })
    ]);
  }, [cursor]);

  const monthStart = React.useMemo(() => startOfMonth(cursor), [cursor]);
  const monthDays = React.useMemo(() => daysInMonth(cursor), [cursor]);
  const firstDow = monthStart.getDay();

  const label = monthStart.toLocaleString(undefined, { month: "long", year: "numeric" });
  const today = new Date();
  const today0 = React.useMemo(() => startOfDay(today), [today]);

  const requestOpenDayPreview = React.useCallback(() => {
    if (Date.now() < suppressDayPreviewOpenUntilRef.current) return;
    setDayPreviewOpen(true);
  }, [drafts]);

  const setQueueLocked = React.useCallback((id: string, locked: boolean, startIso?: string, fallback?: DraftEntry) => {
    const sid = String(id);
    localMutationEpochRef.current = Date.now();
    void (async () => {
      const res = await setQueueLockedPipeline({ id: sid, locked, startIso, fallback: fallback as any });
      if (!res.ok) return;
      setDrafts((prev) => {
        const nextOne = { ...(res.draft as any) };
        const idx = prev.findIndex((d) => String(d.id) === sid);
        if (idx >= 0) return prev.map((d) => (String(d.id) === sid ? { ...(d as any), ...(nextOne as any) } : d));
        return [...prev, nextOne as any];
      });
    })();
  }, [drafts]);

  const requestCloseDayPreview = React.useCallback(() => {
    suppressDayPreviewOpenUntilRef.current = Date.now() + 450;
    setDayPreviewOpen(false);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const cursorMonthStart = startOfMonth(cursor);
    const windowStart = new Date(cursorMonthStart);
    windowStart.setDate(windowStart.getDate() - 45);
    const windowEnd = new Date(cursorMonthStart);
    windowEnd.setMonth(windowEnd.getMonth() + 1);
    windowEnd.setDate(windowEnd.getDate() + 45);
    const windowStartIso = windowStart.toISOString().slice(0, 10);
    const windowEndIso = windowEnd.toISOString().slice(0, 10);
    const windowKey = `${windowStartIso}_${windowEndIso}`;

    const refreshLocal = () => {
      try {
        // Fast path: seed UI from lightweight cache so the calendar can render immediately.
        const cached = readCalendarDraftsCache();
        if (!cancelled && Array.isArray(cached) && cached.length) setDrafts(cached);
      } catch {
      }

      try {
        // Extra-fast path: if available, seed the visible window from a smaller calendar-specific cache.
        const cachedEntries = readCalendarEntriesCache(windowKey);
        if (!cancelled && Array.isArray(cachedEntries) && cachedEntries.length) setDrafts((prev) => {
          if (Array.isArray(prev) && prev.length > 0) return prev;
          return cachedEntries;
        });
      } catch {
      }
      try {
        const localBlocks = readBlockOutStore();
        if (!cancelled) setBlockOuts(localBlocks);
      } catch {
      }
      try {
        const localTasks = readTaskStore();
        if (!cancelled) setTasks(localTasks);
      } catch {
      }
    };

    const hydrateLocalFull = () => {
      // Heavy path: parse the full drafts store after initial paint.
      try {
        const store = readDraftStore();
        const localDrafts = Object.values(store).map((d) => toCalendarDraftLite(d));
        if (!cancelled) setDrafts(localDrafts);
        try {
          writeCalendarDraftsCache(localDrafts);
        } catch {
        }
      } catch {
      }
    };

    const refreshRemote = async () => {
      // Do remote fetch/merge in the background. On poor service this can take a while,
      // but the UI should already be populated from localStorage.
      const store = readDraftStore();
      const localList = Object.values(store).map((d) => ({ ...d }));
      const localBlocks = readBlockOutStore();
      const localTasks = readTaskStore();

      let remoteList: DraftEntry[] = [];
      let remoteListOk = false;
      let remoteBlocks: BlockOut[] = [];
      let remoteTasks: CalendarTask[] = [];
      let remoteBlocksOk = false;
      let remoteTasksOk = false;
      let remoteBlocksErr = "";
      let remoteTasksErr = "";

      // Prefer fast calendar snapshot if available; it fetches only the visible window + sold queue.
      try {
        const snapshot = await withTimeout(fetchCalendarEntries({ windowStartIso, windowEndIso }), 3500);
        if ((snapshot as any)?.ok && Array.isArray((snapshot as any)?.drafts)) {
          remoteList = ((snapshot as any).drafts as DraftEntry[]) || [];
          remoteListOk = true;
        }
      } catch {
      }

      // Backfill completes/older drafts on a slower path so they still appear eventually.
      // This is intentionally not awaited; it updates drafts in-place when it finishes.
      const backfillCompletes = () => {
        void (async () => {
          try {
            const res = await withTimeout(fetchDrafts({ limit: 1800 }), 12000);
            if (!(res as any)?.ok) return;

            const latestStore = readDraftStore();
            const latestLocalList = Object.values(latestStore).map((d) => ({ ...d }));
            const mergedAll = mergeDraftLists(latestLocalList, ((res as any).drafts as DraftEntry[]) || []);
            const mergedAllLite = (Array.isArray(mergedAll) ? mergedAll : []).map((d) => toCalendarDraftLite(d));
            if (!cancelled) {
              setDrafts((prev) => {
                const prevList = Array.isArray(prev) ? prev : [];
                const merged = mergeDraftLists(prevList as any, mergedAllLite as any);
                return (Array.isArray(merged) ? merged : []) as any;
              });
            }
          } catch {
          }
        })();
      };

      try {
        const [draftsRes, blocksRes, tasksRes] = await Promise.all([
          // Limit drafts fetch to keep calendar responsive.
          // Calendar only needs a rolling window of recent drafts + sold queue.
          remoteListOk ? Promise.resolve({ ok: true, drafts: remoteList } as any) : withTimeout(fetchDrafts({ limit: 450 }), 4500),
          withTimeout(fetchDraft({ id: BLOCKOUTS_REMOTE_ID }), 4500),
          withTimeout(fetchDraft({ id: TASKS_REMOTE_ID }), 4500)
        ]);

        remoteList = (draftsRes as any)?.ok ? ((draftsRes as any)?.drafts as DraftEntry[]) : remoteList;

        remoteBlocksOk = Boolean((blocksRes as any)?.ok);
        if (!remoteBlocksOk) remoteBlocksErr = String((blocksRes as any)?.reason || "");
        remoteBlocks = Array.isArray((blocksRes as any)?.draft?.blockOuts) ? ((blocksRes as any).draft.blockOuts as BlockOut[]) : [];

        remoteTasksOk = Boolean((tasksRes as any)?.ok);
        if (!remoteTasksOk) remoteTasksErr = String((tasksRes as any)?.reason || "");
        remoteTasks = Array.isArray((tasksRes as any)?.draft?.tasks) ? ((tasksRes as any).draft.tasks as CalendarTask[]) : [];
      } catch (e) {
        // ignore (offline/slow). Keep local data.
        const msg = String((e as any)?.message || e || "");
        if (msg === "timeout") {
          remoteBlocksErr = remoteBlocksErr || "timeout";
          remoteTasksErr = remoteTasksErr || "timeout";
        } else {
          remoteBlocksErr = remoteBlocksErr || msg;
          remoteTasksErr = remoteTasksErr || msg;
        }
      }

      // Re-read local store right before merge so recent local mutations (toggles, locks, moves)
      // can't be overwritten by a stale snapshot captured before the remote fetch finished.
      const latestStore = readDraftStore();
      const latestLocalList = Object.values(latestStore).map((d) => ({ ...d }));

      const merged = mergeDraftLists(latestLocalList, remoteList);

      // If an estimate was scheduled on this device but hasn't made it to Supabase yet,
      // publish it so other devices (iPad) see the same calendar.
      try {
        void publishScheduledEstimates({ localList: latestLocalList, remoteList });
      } catch {
      }

      const mergedLite = (Array.isArray(merged) ? merged : []).map((d) => toCalendarDraftLite(d));
      if (!cancelled) setDrafts(mergedLite);
      try {
        writeCalendarDraftsCache(mergedLite);
      } catch {
      }

      try {
        if (remoteListOk && Array.isArray(remoteList) && remoteList.length > 0) {
          writeCalendarEntriesCache(windowKey, remoteList);
        }
      } catch {
      }

      // After the fast path sets the calendar, kick off a slower backfill for completes.
      backfillCompletes();

      const mergedBlocks = mergeBlockOutLists(localBlocks, remoteBlocks);
      try {
        writeBlockOutStore(mergedBlocks);
      } catch {
      }
      if (!cancelled) setBlockOuts(mergedBlocks);

      try {
        // Always publish blockout changes (including deletions that result in an empty list).
        const same = JSON.stringify(mergedBlocks) === JSON.stringify(remoteBlocks);
        if (!same) void upsertBlockOutsRemote(mergedBlocks);
      } catch {
      }

      const mergedTasks = mergeTaskLists(localTasks, remoteTasks);
      try {
        writeTaskStore(mergedTasks);
      } catch {
      }
      if (!cancelled) setTasks(mergedTasks);

      try {
        const mergedHas = Array.isArray(mergedTasks) && mergedTasks.length > 0;
        if (mergedHas) {
          const same = JSON.stringify(mergedTasks) === JSON.stringify(remoteTasks);
          if (!same) void upsertTasksRemote(mergedTasks);
        }
      } catch {
      }

      try {
        if (!cancelled) {
          setSyncDiag({
            supabaseConfigured,
            blockouts: { ok: remoteBlocksOk, count: remoteBlocks.length, error: remoteBlocksErr },
            tasks: { ok: remoteTasksOk, count: remoteTasks.length, error: remoteTasksErr }
          });
        }
      } catch {
      }
    };

    const refresh = () => {
      refreshLocal();
      void refreshRemote();
    };

    refresh();

    // Defer full local parse until after first paint.
    window.setTimeout(() => hydrateLocalFull(), 0);

    const debouncedRefresh = () => {
      if (refreshDebounceRef.current) window.clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = window.setTimeout(() => refresh(), 150);
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== "vf_estimate_drafts_v1" && e.key !== "vf_calendar_blockouts_v1" && e.key !== "vf_calendar_tasks_v1") return;
      debouncedRefresh();
    };
    const onDraftsChanged = () => debouncedRefresh();

    window.addEventListener("storage", onStorage);
    window.addEventListener("vf-drafts-changed", onDraftsChanged as any);
    return () => {
      cancelled = true;
      if (refreshDebounceRef.current) window.clearTimeout(refreshDebounceRef.current);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("vf-drafts-changed", onDraftsChanged as any);
    };
  }, []);

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

  const moveQueue = React.useCallback(async (id: string, dir: -1 | 1) => {
    const sid = String(id);
    localMutationEpochRef.current = Date.now();
    // Capture the row's current top offset within the scroll container so we can keep it
    // visually anchored after the reorder + re-render.
    try {
      const root = queueListRef.current;
      const el = root?.querySelector(`[data-queue-id="${CSS?.escape ? CSS.escape(sid) : sid}"]`) as HTMLElement | null;
      if (root && el) {
        const rootRect = root.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        queueAnchorRef.current = { id: sid, anchorTop: elRect.top - rootRect.top };
      } else {
        queueAnchorRef.current = null;
      }
    } catch {
      queueAnchorRef.current = null;
    }

    const res = await (async () => {
      const soldSnapshot = (drafts || [])
        .filter((d) => (d as any).status === "sold" && !(d as any).calendarHidden)
        .slice()
        .sort((a, b) =>
          Number((a as any).queueRank ?? Number.POSITIVE_INFINITY) -
            Number((b as any).queueRank ?? Number.POSITIVE_INFINITY) ||
          String((a as any).id ?? "").localeCompare(String((b as any).id ?? ""))
        );
      const res = await moveSoldJobRelativePipeline({ id: sid, dir, soldSnapshot: soldSnapshot as any });
      if (!(res as any)?.ok) return res as any;
      const store = readDraftStore();
      setDrafts((prev) => {
        const byId = new Map<string, any>();
        prev.forEach((d) => {
          const id = String((d as any)?.id || "");
          if (id) byId.set(id, d);
        });
        Object.entries(store).forEach(([k, v]) => {
          const id = String((v as any)?.id || k);
          if (!id) return;
          const prevOne = byId.get(id);
          byId.set(id, prevOne ? { ...(prevOne as any), ...(v as any) } : (v as any));
        });
        return Array.from(byId.values());
      });
      return res as any;
    })();

    setHighlightQueueId(sid);
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current ?? undefined);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightQueueId(null), 1200);
    return res as any;
  }, [drafts]);

  const applyMoveToPosition = React.useCallback(async (id: string, targetPos: number) => {
    const sid = String(id);
    localMutationEpochRef.current = Date.now();
    const res = await (async () => {
      const soldSnapshot = (drafts || [])
        .filter((d) => (d as any).status === "sold" && !(d as any).calendarHidden)
        .slice()
        .sort((a, b) =>
          Number((a as any).queueRank ?? Number.POSITIVE_INFINITY) -
            Number((b as any).queueRank ?? Number.POSITIVE_INFINITY) ||
          String((a as any).id ?? "").localeCompare(String((b as any).id ?? ""))
        );
      const res = await moveSoldJobToPositionPipeline({ id: sid, targetPos, soldSnapshot: soldSnapshot as any });
      if (!(res as any)?.ok) return res as any;
      const store = readDraftStore();
      setDrafts((prev) => {
        const byId = new Map<string, any>();
        prev.forEach((d) => {
          const id = String((d as any)?.id || "");
          if (id) byId.set(id, d);
        });
        Object.entries(store).forEach(([k, v]) => {
          const id = String((v as any)?.id || k);
          if (!id) return;
          const prevOne = byId.get(id);
          byId.set(id, prevOne ? { ...(prevOne as any), ...(v as any) } : (v as any));
        });
        return Array.from(byId.values());
      });
      return res as any;
    })();
    setHighlightQueueId(sid);
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current ?? undefined);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightQueueId(null), 1200);
    return res as any;
  }, [drafts]);

  const toggleWeekendAllowed = React.useCallback((id: string, which: "sat" | "sun", fallback?: DraftEntry) => {
    const sid = String(id);
    localMutationEpochRef.current = Date.now();

    // Optimistic UI: immediately toggle weekend flag in local state.
    setDrafts((prev) =>
      prev.map((d) => {
        if (String((d as any).id) !== sid) return d;
        const curSat = asBool((d as any).allowSaturday);
        const curSun = asBool((d as any).allowSunday);
        const nextFlags =
          which === "sat"
            ? { allowSaturday: !curSat, allowSunday: curSun }
            : { allowSaturday: curSat, allowSunday: !curSun };
        return { ...(d as any), ...nextFlags } as any;
      })
    );

    void (async () => {
      const res = await toggleWeekendAllowedPipeline({ id: sid, which, fallback: fallback as any });
      if (!res.ok) return;
      setDrafts((prev) => {
        const nextOne = { ...(res.draft as any) };
        const idx = prev.findIndex((d) => String(d.id) === sid);
        if (idx >= 0) return prev.map((d) => (String(d.id) === sid ? { ...(d as any), ...(nextOne as any) } : d));
        return [...prev, nextOne as any];
      });
    })();

  }, [drafts]);

  const resetLaborDays = React.useCallback((id: string, fallback?: DraftEntry) => {
    const sid = String(id);
    localMutationEpochRef.current = Date.now();

    // Optimistic UI: immediately reset days in local state.
    setDrafts((prev) =>
      prev.map((d) => {
        if (String((d as any).id) !== sid) return d;
        const curOriginal = Number((d as any).originalLaborDays);
        const curLabor = Number((d as any).laborDays);
        const nextDays = Number.isFinite(curOriginal) && curOriginal > 0 ? Math.round(curOriginal) : Number.isFinite(curLabor) && curLabor > 0 ? Math.round(curLabor) : 1;
        return { ...(d as any), laborDays: nextDays } as any;
      })
    );

    void (async () => {
      const res = await resetLaborDaysPipeline({ id: sid, fallback: fallback as any });
      if (!res.ok) return;
      const store = readDraftStore();
      setDrafts((prev) => {
        const byId = new Map<string, any>();
        prev.forEach((d) => {
          const id = String((d as any)?.id || "");
          if (id) byId.set(id, d);
        });
        Object.entries(store).forEach(([k, v]) => {
          const id = String((v as any)?.id || k);
          if (!id) return;
          const prevOne = byId.get(id);
          byId.set(id, prevOne ? { ...(prevOne as any), ...(v as any) } : (v as any));
        });
        return Array.from(byId.values());
      });
      setHighlightQueueId(sid);
      if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = window.setTimeout(() => setHighlightQueueId(null), 500);
    })();
  }, [drafts]);

  const setHoldDate = React.useCallback((id: string, iso: string | undefined) => {
    const sid = String(id);
    void (async () => {
      const res = await setHoldDatePipeline({ id: sid, iso, fallback: (drafts.find((d) => String(d.id) === sid) as any) });
      if (!res.ok) return;
      const store = readDraftStore();
      setDrafts(Object.values(store).map((d) => ({ ...d })));
    })();

  }, [drafts]);

  const adjustLaborDays = React.useCallback((id: string, delta: number, fallback?: DraftEntry) => {
    const sid = String(id);
    localMutationEpochRef.current = Date.now();

    // Optimistic UI: immediately reflect the +/- in local state.
    setDrafts((prev) =>
      prev.map((d) => {
        if (String((d as any).id) !== sid) return d;
        const cur = Number((d as any).laborDays);
        const base = Number.isFinite(cur) && cur > 0 ? Math.round(cur) : 1;
        const nextDays = Math.max(1, base + Math.sign(delta || 0));
        return { ...(d as any), laborDays: nextDays } as any;
      })
    );

    void (async () => {
      const res = await adjustLaborDaysPipeline({ id: sid, delta, fallback: fallback as any });
      if (!res.ok) return;
      setDrafts((prev) => {
        const nextOne = { ...(res.draft as any) };
        const idx = prev.findIndex((d) => String(d.id) === sid);
        if (idx >= 0) return prev.map((d) => (String(d.id) === sid ? { ...(d as any), ...(nextOne as any) } : d));
        return [...prev, nextOne as any];
      });
    })();
  }, [drafts]);

  const soldQueue = React.useMemo(() => {
    const lockAnchorIso = (d: DraftEntry) => {
      const t = Number((d as any).queueLockedAt);
      if (!Number.isFinite(t) || t <= 0) return "";
      try {
        return toKey(startOfDay(new Date(t)));
      } catch {
        return "";
      }
    };

    const legacyAnchorIso = (d: DraftEntry) => {
      const s = String((d as any).installDate || (d as any).startDate || "");
      return s ? s.slice(0, 10) : "";
    };

    const occupied = new Set<string>();
    const occupiedEndByDay = new Map<string, Date>();
    const occupyRange = (startIso: string, laborDays: unknown, status: DraftEntry["status"], allowSaturday: boolean, allowSunday: boolean) => {
      if (!startIso) return;
      if (status === "estimate" || status === "void" || status === "complete") return;
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
        String((a as any).id ?? "").localeCompare(String((b as any).id ?? ""))
      );

    const scheduledStartById = new Map<string, string>();

    const maxDate = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

    let lastQueuedEnd: Date | null = null;
    soldJobs.forEach((d) => {
      const span = computeSpanDays((d as any).laborDays);
      const allowSat = asBool((d as any).allowSaturday);
      const allowSun = asBool((d as any).allowSunday);

      // For SOLD jobs, queue is the control center. Only an explicit hold date
      // is allowed to constrain scheduling; prior estimate scheduling should not.
      const requested = String((d as any).holdDate || "");

      const isLocked = (d as any).queueLocked === true;
      const anchorIso = isLocked ? (lockAnchorIso(d) || legacyAnchorIso(d)) : "";
      const anchorStart = anchorIso ? new Date(anchorIso + "T12:00:00") : null;

      // If a sold job has started, keep it anchored unless the user explicitly
      // changes it by setting a hold date.
      if (isLocked && anchorIso && anchorStart) {
        // Burn down the locked/current job by elapsed workdays since the anchor.
        // Semantics: a new day consumes *yesterday only* (elapsed counts days strictly before today0).
        const originalSeq = workdaySequenceForJob(anchorStart as Date, span, allowSat, allowSun);
        const elapsed = originalSeq.filter((day) => startOfDay(day).getTime() < today0.getTime()).length;
        const remaining = Math.max(0, span - elapsed);

        // If no days remain, do not occupy future capacity (job should be marked complete).
        if (remaining <= 0) {
          lastQueuedEnd = null;
          return;
        }

        const todayAllowed = !isNonWorkingDayForJob(today0, allowSat, allowSun);
        const displayStart = todayAllowed ? today0 : nextWorkdayForJob(today0, allowSat, allowSun);
        const remainingSeq = workdaySequenceForJob(displayStart, remaining, allowSat, allowSun);
        const end = remainingSeq[remainingSeq.length - 1];
        const iso = toKey(remainingSeq[0]);

        scheduledStartById.set(String((d as any).id), iso);
        remainingSeq.forEach((day) => {
          const k = toKey(day);
          occupied.add(k);
          const prev = occupiedEndByDay.get(k);
          if (!prev || end.getTime() > prev.getTime()) occupiedEndByDay.set(k, end);
        });
        lastQueuedEnd = end;
        return;
      }

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
          scheduledStartById.set(String((d as any).id), iso);
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
        const iso = scheduledStartById.get(String((d as any).id)) || "";
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

  React.useEffect(() => {
    // Auto-lock only the job in queue position #1 (unless explicitly unlocked).
    // Locking persists queueLockedAt so it never slides after midnight.
    const first = (soldQueue || [])[0] as any;
    if (!first) return;

    // Only #1 may be locked. If older data has other rows locked, unlock them.
    (soldQueue || []).slice(1).forEach((j: any) => {
      if (!j) return;
      if (j.queueLocked === true) setQueueLocked(String(j.id), false, undefined, j);
    });

    if (first.queueLocked === false) return;
    if (first.queueLocked === true) return;
    const startIso = String(first.installDate || first.startDate || "").slice(0, 10);
    setQueueLocked(String(first.id), true, startIso || undefined, first);
  }, [soldQueue, setQueueLocked, today0]);

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
      const s = String((d as any).scheduledAt || "");
      if (s) return s.slice(0, 10);
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
      if (status === "estimate" || status === "void" || status === "complete") return;
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

    // Sold jobs: take schedule directly from soldQueue (single source of truth).
    // This prevents month view from drifting from the queue schedule.
    const soldJobs = (Array.isArray(soldQueue) ? soldQueue : [])
      .filter((d) => d && !(d as any).calendarHidden)
      .slice();

    soldJobs.forEach((d) => {
      const iso = String((d as any).installDate || (d as any).startDate || "").slice(0, 10);
      if (!iso) return;
      scheduledStartById.set(String((d as any).id), iso);
      occupyRange(iso, (d as any).laborDays, "sold", asBool((d as any).allowSaturday), asBool((d as any).allowSunday));
    });

    // Schedule non-sold capacity jobs AFTER sold queue so they can't backfill hold gaps.
    const nonSoldCapacity = drafts
      .filter(
        (d) =>
          !(d as any).calendarHidden &&
          (d as any).status !== "sold" &&
          (d as any).status !== "complete" &&
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
      const iso =
        status === "sold"
          ? scheduledStartById.get(String((d as any).id)) || ""
          : scheduledStartById.get(String((d as any).id)) || explicit;

      const hasSched = Boolean(sched) && status !== "sold" && status !== "void";

      const dt =
        hasSched
          ? new Date(sched)
          : iso
            ? new Date(iso + "T12:00:00")
            : null;
      const spanDays = hasSched || status === "estimate" ? 1 : computeSpanDays((d as any).laborDays);
      const allowSat = asBool((d as any).allowSaturday);
      const allowSun = asBool((d as any).allowSunday);
      const end = dt
        ? status === "estimate"
          ? dt
          : workdaySequenceForJob(dt, spanDays, allowSat, allowSun)[spanDays - 1]
        : null;
      return {
        ...d,
        startDate: hasSched ? sched.slice(0, 10) : iso,
        installDate: hasSched ? sched.slice(0, 10) : iso,
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
        if ((d as any).status === "pending") return false;
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
      const status = (j as any).status as DraftEntry["status"];
      map.set(j.id, status === "estimate" ? ESTIMATE_DOT_COLOR : colorForInstallId(j.id));
    });
    return map;
  }, [monthJobs]);

  const installColorMap = React.useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();

    // 1) Preserve sold queue order so adjacent queue items avoid similar hues.
    soldQueue.forEach((j) => {
      const id = String(j.id);
      if (seen.has(id)) return;
      seen.add(id);
      ordered.push(id);
    });

    // 2) Then append other non-estimate jobs in chronological order.
    const other = monthJobs
      .filter((j) => {
        const status = (j as any).status as DraftEntry["status"];
        if (status === "estimate") return false;
        const id = String(j.id);
        return !seen.has(id);
      })
      .slice()
      .sort((a, b) => {
        const ad = String((a as any).installDate || (a as any).startDate || (a as any).scheduledAt || "");
        const bd = String((b as any).installDate || (b as any).startDate || (b as any).scheduledAt || "");
        if (ad !== bd) return ad.localeCompare(bd);
        return String(a.id).localeCompare(String(b.id));
      })
      .map((j) => String(j.id));

    other.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      ordered.push(id);
    });

    const out = new Map<string, string>();
    let paletteCursor = 0;
    let prevHue: number | null = null;
    ordered.forEach((id) => {
      for (let guard = 0; guard < INSTALL_DOT_PALETTE.length; guard++) {
        const candidate = INSTALL_DOT_PALETTE[paletteCursor % INSTALL_DOT_PALETTE.length];
        paletteCursor += 1;
        const h = parseHueFromHsla(candidate);
        const ok = prevHue == null
          ? true
          : (!((isGreenHue(prevHue) && isGreenHue(h)) || (isWarmHue(prevHue) && (isWarmHue(h) || (h >= 20 && h <= 85)))));
        if (ok) {
          out.set(id, candidate);
          prevHue = h;
          return;
        }
      }
      // Fallback if we somehow couldn't find a good candidate.
      const fallback = INSTALL_DOT_PALETTE[Math.abs(hashInt(id)) % INSTALL_DOT_PALETTE.length];
      out.set(id, fallback);
      prevHue = parseHueFromHsla(fallback);
    });
    return out;
  }, [monthJobs, soldQueue]);

  const soldQueueComputed = React.useMemo(() => {
    return soldQueue.map((j, idx) => {
      const allowSat = asBool((j as any).allowSaturday);
      const allowSun = asBool((j as any).allowSunday);
      const style = String(j.selectedStyle?.name || "");
      const lf = totalLfFromDraft(j);
      const labor = computeSpanDays((j as any).laborDays) || 0;
      const hold = String((j as any).holdDate || "").slice(0, 10);
      const startDt = (j as any).install instanceof Date && Number.isFinite(((j as any).install as Date).getTime())
        ? ((j as any).install as Date)
        : null;
      const startIsoRaw = String((j as any).installDate || (j as any).startDate || "");
      const startIso = startIsoRaw ? startIsoRaw.slice(0, 10) : "";
      const hasStarted = (() => {
        try {
          if (startDt) return startOfDay(startDt).getTime() <= today0.getTime();
          if (!startIso) return false;
          return startOfDay(new Date(startIso + "T12:00:00")).getTime() <= today0.getTime();
        } catch {
          return false;
        }
      })();
      const locked = (j as any).queueLocked !== false;
      const dotColor = installColorMap.get(j.id) ?? colorForInstallId(j.id);

      const seqInfo = (() => {
        if (!startIso) return { endIso: "", usedWeekend: { sat: false, sun: false } };
        try {
          const start = new Date(startIso + "T12:00:00");
          const seq = workdaySequenceForJob(start, Math.max(1, labor || 0), allowSat, allowSun);
          const last = seq[seq.length - 1];
          const endIso = last instanceof Date && Number.isFinite(last.getTime()) ? last.toISOString().slice(0, 10) : "";
          let sat = false;
          let sun = false;
          seq.forEach((d) => {
            const day = d.getDay();
            if (day === 6) sat = true;
            if (day === 0) sun = true;
          });
          return { endIso, usedWeekend: { sat, sun } };
        } catch {
          return { endIso: "", usedWeekend: { sat: false, sun: false } };
        }
      })();

      const isLastDay = Boolean(seqInfo.endIso) && seqInfo.endIso === toKey(today0);
      const canComplete = (() => {
        if (!seqInfo.endIso) return false;
        try {
          const end = new Date(seqInfo.endIso + "T00:00:00");
          return today0.getTime() >= end.getTime();
        } catch {
          return false;
        }
      })();

      return {
        j,
        idx,
        allowSat,
        allowSun,
        style,
        lf,
        labor,
        hold,
        startIso,
        hasStarted,
        locked,
        dotColor,
        endIso: seqInfo.endIso,
        usedWeekend: seqInfo.usedWeekend,
        isLastDay,
        canComplete
      };
    });
  }, [installColorMap, soldQueue, today0, workdaySequenceForJob]);

  const effectiveJobColors = React.useMemo(() => {
    const map = new Map<string, string>();
    monthJobs.forEach((j) => {
      const status = (j as any).status as DraftEntry["status"];
      if (status === "estimate") {
        const who = String((j as any).estimateAssignee || "").trim().toLowerCase();
        if (who === "nate") {
          map.set(j.id, "hsla(210, 96%, 66%, 0.92)");
        } else if (who === "cam") {
          map.set(j.id, "hsla(50, 96%, 60%, 0.92)");
        } else {
          map.set(j.id, ESTIMATE_DOT_COLOR);
        }
      } else {
        map.set(j.id, installColorMap.get(j.id) ?? colorForInstallId(j.id));
      }
    });
    return map;
  }, [installColorMap, monthJobs]);

  const jobsByDay = React.useMemo(() => {
    const map = new Map<string, Array<DraftEntry & { color: string }>>();
    monthJobs.forEach((j) => {
      const color = effectiveJobColors.get(j.id) ?? "rgba(255,255,255,.25)";
      const start = (j as any).install instanceof Date ? ((j as any).install as Date) : new Date(j.installDate + "T12:00:00");
      const status = (j as any).status as DraftEntry["status"];
      const span = status === "estimate" ? 1 : computeSpanDays((j as any).laborDays);
      const allowSat = asBool((j as any).allowSaturday);
      const allowSun = asBool((j as any).allowSunday);
      const seqRaw = status === "estimate" ? [start] : workdaySequenceForJob(start, span, allowSat, allowSun);
      const seq = seqRaw;
      seq.forEach((day) => {
        const key = toKey(day);
        const arr = map.get(key) ?? [];
        arr.push({ ...j, color } as any);
        map.set(key, arr);
      });
    });
    return map;
  }, [effectiveJobColors, monthJobs, workdaySequenceForJob]);

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

  const estimateAssigneeRank = React.useCallback((j: any) => {
    const who = String((j as any)?.estimateAssignee || "").trim().toLowerCase();
    if (who === "nate") return 0;
    if (who === "cam") return 1;
    return 2;
  }, []);

  const dayJobs = React.useMemo(() => {
    const key = toKey(selected);
    const list = (jobsByDay.get(key) ?? []).slice();
    list.sort((a: any, b: any) => {
      const aEst = (a as any).status === "estimate";
      const bEst = (b as any).status === "estimate";
      if (aEst !== bEst) return aEst ? -1 : 1;

       if (aEst && bEst) {
         const ar = estimateAssigneeRank(a);
         const br = estimateAssigneeRank(b);
         if (ar !== br) return ar - br;
         const at = new Date(String((a as any).scheduledAt || (a as any).installDate || "") || "").getTime();
         const bt = new Date(String((b as any).scheduledAt || (b as any).installDate || "") || "").getTime();
         if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
         return String((a as any).id || "").localeCompare(String((b as any).id || ""));
       }

      const at = a?.install instanceof Date ? a.install.getTime() : new Date(String(a?.installDate || "") + "T12:00:00").getTime();
      const bt = b?.install instanceof Date ? b.install.getTime() : new Date(String(b?.installDate || "") + "T12:00:00").getTime();
      return at - bt;
    });
    return list;
  }, [estimateAssigneeRank, jobsByDay, selected]);

  const dayBlocks = React.useMemo(() => {
    const key = toKey(selected);
    return blockedDays.byKey.get(key) ?? [];
  }, [blockedDays.byKey, selected]);

  const tasksByDay = React.useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    (tasks || []).forEach((t) => {
      const iso = String((t as any).atIso || "");
      if (!iso) return;
      const key = iso.slice(0, 10);
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    });
    map.forEach((arr, k) => {
      arr.sort((a, b) => String((a as any).atIso || "").localeCompare(String((b as any).atIso || "")));
      map.set(k, arr);
    });
    return map;
  }, [tasks]);

  const dayTasks = React.useMemo(() => {
    const key = toKey(selected);
    return (tasksByDay.get(key) ?? []).slice();
  }, [selected, tasksByDay]);

  return (
    <div className="space-y-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 136px)" }}>
      {portalReady && dayPreviewOpen ? createPortal(
        <div
          className="fixed inset-0 z-[70] grid place-items-center p-3"
          role="dialog"
          aria-modal="true"
          style={{ touchAction: "pan-y" }}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              e.stopPropagation();
              window.setTimeout(() => requestCloseDayPreview(), 0);
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
                onClick={() => requestCloseDayPreview()}
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

              {dayTasks.length ? (
                <div className="mt-3 grid gap-2">
                  {dayTasks.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-2xl border border-[rgba(31,200,120,.35)] bg-[rgba(31,200,120,.10)] px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-black truncate">{t.description || "Task"}</div>
                          <div className="text-[11px] text-[var(--muted)] mt-1">
                            {String((t as any).atIso || "").slice(11, 16)}
                          </div>
                        </div>
                        <div className="h-3 w-3 grid place-items-center" style={{ color: "rgba(31,200,120,.95)" }} aria-hidden="true">
                          <span className="text-[14px] leading-none">★</span>
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
                    const phone = String((j as any).customerPhone || (j as any).phone || (j as any).phoneNumber || "");
                    const address = String((j as any).projectAddress || (j as any).address || "");
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
                              className={"h-3 w-3 " + ((j as any).status === "estimate" ? "rounded-none" : "rounded-full")}
                              style={{
                                background: (j as any).color ?? "rgba(255,255,255,.25)",
                                filter: "saturate(1.8) contrast(1.2)",
                                boxShadow: "0 0 0 1px rgba(0,0,0,.25), 0 0 10px rgba(0,0,0,.15)"
                              }}
                              aria-hidden="true"
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

                        {(canCall || canNav) ? (
                          <div className="mt-2 grid grid-cols-2 gap-2">
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
                                "rounded-xl border px-3 py-2 text-[12px] font-black " +
                                (canCall
                                  ? "border-[rgba(31,200,120,.45)] bg-[rgba(31,200,120,.12)] hover:bg-[rgba(31,200,120,.18)]"
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
                                "rounded-xl border px-3 py-2 text-[12px] font-black " +
                                (canNav
                                  ? "border-[rgba(80,160,255,.45)] bg-[rgba(80,160,255,.12)] hover:bg-[rgba(80,160,255,.18)]"
                                  : "border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] opacity-50")
                              }
                            >
                              Navigate
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 text-sm text-[var(--muted)]">No jobs scheduled.</div>
              )}
          </div>
        </div>
      , document.body) : null}

      {portalReady && queueOpen ? createPortal(
        <div
          className="fixed inset-0 z-[70] overflow-x-hidden"
          role="dialog"
          aria-modal="true"
          style={{ touchAction: "pan-y" }}
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
                setMoveError("");
                setMoveSaving(false);
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
                      type="button"
                      onClick={() => {
                        setMoveOpenId(null);
                        setMovePreviewPos(null);
                        setMoveError("");
                        setMoveSaving(false);
                      }}
                    >
                      Close
                    </SecondaryButton>
                  </div>

                  {moveError ? (
                    <div className="mt-2 rounded-2xl border border-[rgba(255,80,80,.45)] bg-[rgba(255,80,80,.14)] px-3 py-2 text-[12px] font-black text-[rgba(255,240,240,.95)]">
                      {moveError}
                    </div>
                  ) : null}

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
                        if (next >= 1) {
                          setMovePreviewPos(next);
                          moveQueue(moveOpenId, -1);
                        }
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
                        if (next <= holds.length) {
                          setMovePreviewPos(next);
                          moveQueue(moveOpenId, 1);
                        }
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
                        setMoveError("");
                        setMoveSaving(false);
                      }}
                    >
                      Cancel
                    </SecondaryButton>
                    <PrimaryButton
                      data-no-swipe="true"
                      type="button"
                      disabled={moveSaving}
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!moveOpenId) return;
                        const pos = typeof movePreviewPos === "number" ? movePreviewPos : null;
                        if (!pos) return;
                        if (moveSaving) return;
                        setMoveSaving(true);
                        setMoveError("");
                        try {
                          const res: any = await applyMoveToPosition(moveOpenId, pos);
                          if (!res?.ok) {
                            const reason = String(res?.reason || "MOVE_FAILED");
                            setMoveError(reason);
                            setMoveSaving(false);
                            return;
                          }
                          setMoveOpenId(null);
                          setMovePreviewPos(null);
                          setMoveSaving(false);
                        } catch {
                          setMoveError("MOVE_EXCEPTION");
                          setMoveSaving(false);
                        }
                      }}
                    >
                      {moveSaving ? "Saving…" : "Save"}
                    </PrimaryButton>
                  </div>
                </GlassCard>
              </div>
            </div>
          ) : null}

          <div
            className="absolute inset-0 p-2 flex"
            style={{ paddingTop: "calc(var(--vf-header-h, 0px) + 8px)" }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
          >
            <GlassCard className="w-full max-w-[440px] mx-auto p-2 overflow-hidden overflow-x-hidden flex flex-col max-h-[calc(100dvh-var(--vf-header-h,0px)-24px)]">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black">Job Queue</div>
              </div>

              <div
                ref={queueListRef}
                className="mt-2 grid content-start gap-2.5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-3"
                style={{ overflowAnchor: "none", WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
              >
                {soldQueue.length === 0 ? (
                  <div className="text-sm text-[var(--muted)]">No sold jobs in queue.</div>
                ) : null}
                {soldQueueComputed.map((row) => {
                  const { j, idx, allowSat, allowSun, style, lf, labor, hold, startIso, hasStarted, locked, dotColor, endIso, usedWeekend, isLastDay, canComplete } = row;
                  const isHi = highlightQueueId === j.id;
                  const isCurrentQueueJob = idx === 0;
                  const isActiveForUi = isCurrentQueueJob && hasStarted;
                  const canInteractLock = isActiveForUi;
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
                      <div className="flex flex-col gap-2">
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
                        <div className="w-full grid grid-cols-[auto,1fr,auto] items-center gap-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3.5 w-3.5 rounded-full shrink-0"
                              style={{
                                background: dotColor,
                                filter: "saturate(1.8) contrast(1.2)",
                                boxShadow: "0 0 0 1px rgba(0,0,0,.25), 0 0 10px rgba(0,0,0,.15)"
                              }}
                              aria-hidden="true"
                            />
                            <div className="text-[14px] font-black text-white">#{idx + 1}</div>
                          </div>

                          <div className="flex justify-center">
                            <div className="inline-flex rounded-2xl border border-[rgba(255,255,255,.14)] bg-[rgba(0,0,0,.18)] overflow-hidden">
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  adjustLaborDays(j.id, -1, j);
                                }}
                                className="px-5 py-3 text-[18px] font-black bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)]"
                                aria-label="Decrease labor days"
                              >
                                -
                              </button>
                              <div className="px-5 py-3 text-[18px] font-black leading-none min-w-[56px] text-center">
                                {labor}
                              </div>
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  adjustLaborDays(j.id, 1, j);
                                }}
                                className="px-5 py-3 text-[18px] font-black bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)]"
                                aria-label="Increase labor days"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <button
                            type="button"
                            data-no-swipe="true"
                            disabled={!canInteractLock}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();

                              if (!canInteractLock) return;

                              if (locked) {
                                // Unlock = clear explicit start so it rebases from today.
                                setQueueLocked(j.id, false, undefined, j as any);
                              } else {
                                // Lock = pin whatever the queue currently has scheduled.
                                if (!startIso) return;
                                setQueueLocked(j.id, true, startIso, j as any);
                              }
                            }}
                            className={
                              "rounded-full border px-3 py-2 text-[11px] font-black leading-none transition " +
                              (canInteractLock
                                ? locked
                                  ? "border-[rgba(31,200,120,.55)] bg-[rgba(31,200,120,.18)] hover:bg-[rgba(31,200,120,.24)]"
                                  : "border-[rgba(31,200,120,.55)] bg-[rgba(31,200,120,.14)] hover:bg-[rgba(31,200,120,.18)]"
                                : "border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] opacity-50")
                            }
                            title={isActiveForUi ? (locked ? "Active (locked)" : "Unlocked (rebases)") : "Locks once job starts"}
                          >
                            {isActiveForUi ? (locked ? "Active" : "Unlocked") : "Lock"}
                          </button>

                          <button
                            type="button"
                            data-no-swipe="true"
                            disabled={Boolean(hold)}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setMoveOpenId(j.id);
                              setMovePreviewPos(idx + 1);
                              setMoveError("");
                              setMoveSaving(false);
                            }}
                            className={
                              "rounded-2xl border px-4 py-2 text-[14px] font-black leading-none " +
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

                      <div className="mt-1.5 flex items-center justify-between gap-2">
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
                          className={
                            "rounded-full border px-3 py-1 text-[10px] font-black leading-none transition max-w-[120px] truncate " +
                            (hold
                              ? "border-[rgba(31,200,120,.55)] bg-[rgba(31,200,120,.14)] hover:bg-[rgba(31,200,120,.20)]"
                              : "border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)]")
                          }
                          title={hold ? `Hold ${hold}` : "Hold"}
                        >
                          {hold ? `Hold ${hold}` : "Hold"}
                        </button>

                        {isLastDay ? (
                          <button
                            type="button"
                            data-no-swipe="true"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!canComplete) return;
                              markDraftComplete(j.id);
                            }}
                            className={
                              "rounded-full border px-3 py-1 text-[10px] font-black leading-none transition " +
                              (canComplete
                                ? "border-[rgba(31,200,120,.55)] bg-[rgba(31,200,120,.18)] hover:bg-[rgba(31,200,120,.24)]"
                                : "border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] opacity-50")
                            }
                            disabled={!canComplete}
                            title="Mark job complete"
                          >
                            Complete?
                          </button>
                        ) : null}

                        <div className="inline-flex rounded-2xl border border-[rgba(255,255,255,.14)] overflow-hidden">
                          <button
                            type="button"
                            data-no-swipe="true"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleWeekendAllowed(j.id, "sat", j);
                            }}
                            className={
                              "px-5 py-3 text-[16px] font-black transition-colors " +
                              (allowSat
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
                              toggleWeekendAllowed(j.id, "sun", j);
                            }}
                            className={
                              "px-5 py-3 text-[16px] font-black transition-colors " +
                              (allowSun
                                ? "bg-[rgba(255,80,80,.18)] hover:bg-[rgba(255,80,80,.24)]"
                                : "bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] opacity-80")
                            }
                            aria-pressed={allowSun}
                          >
                            Sun
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
                          className="rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] px-2 py-1.5 text-[11px] font-black"
                        >
                          Reset
                        </button>
                      </div>

                        {holdOpenId === j.id ? (
                          <div
                            className="mt-1 grid gap-2 min-w-0"
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
                              className="w-full max-w-full min-w-0 rounded-xl px-2 py-1.5 text-[11px] font-black bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.14)] outline-none"
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
                                className="w-full rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] px-2 py-1.5 text-[11px] font-black"
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
                                className="w-full rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] px-2 py-1.5 text-[11px] font-black"
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
                                className="w-full rounded-xl border border-[rgba(31,200,120,.45)] bg-[rgba(31,200,120,.12)] px-2 py-1.5 text-[11px] font-black"
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
                    <SecondaryButton
                      data-no-swipe="true"
                      onClick={() => setQueueOpen(false)}
                    >
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
                      void upsertBlockOutsRemote(list);
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
                              void upsertBlockOutsRemote(next);
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-no-swipe="true"
              onClick={() => {
                setTaskOpen(true);
                setTaskDate(toKey(selected));
                setTaskTime("09:00");
                setTaskDesc("");
              }}
              className="rounded-2xl border px-4 py-3 text-[13px] font-black border-[rgba(31,200,120,.55)] bg-[rgba(31,200,120,.12)] hover:bg-[rgba(31,200,120,.18)]"
              aria-label="Add task"
              title="Add task"
            >
              +
            </button>
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
            const isPastLike = isPast || !c.inMonth;
            const dayKey = toKey(c.date);
            const jobs = jobsByDay.get(dayKey) ?? [];
            const dayTasks = tasksByDay.get(dayKey) ?? [];
            const isBlocked = blockedDays.set.has(dayKey);
            return (
              <button
                key={c.date.toISOString()}
                type="button"
                data-no-swipe="true"
                onClick={() => {
                  setSelected(c.date);
                }}
                className={
                  "rounded-2xl border p-1 text-left h-[clamp(44px,calc((100dvh-320px)/5),96px)] transition " +
                  (isBlocked
                    ? "border-[rgba(255,80,80,.55)] bg-[rgba(180,20,20,.36)]"
                    : "border-[rgba(255,255,255,.22)] bg-[rgba(0,0,0,.22)]") +
                  (isPastLike ? " opacity-50 grayscale" : "") +
                  (isSelected
                    ? " ring-4 ring-[rgba(255,255,255,.45)] border-[rgba(255,255,255,.45)] shadow-[0_0_0_2px_rgba(0,0,0,.25)]"
                    : "") +
                  (isToday && !isSelected
                    ? " ring-4 ring-[rgba(31,200,120,.70)] shadow-[0_0_0_2px_rgba(31,200,120,.18)]"
                    : "")
                }
              >
                <div className="relative h-full">
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
                    <div className="mt-1 w-full h-2 rounded-xl overflow-hidden bg-[rgba(255,255,255,.06)]">
                      {(() => {
                        const isEstimate = (j: any) => (j as any).status === "estimate";
                        const installs = jobs.filter((j: any) => !isEstimate(j));
                        const maxBands = 4;
                        const visibleInstalls = installs.slice(0, maxBands);
                        return visibleInstalls.length ? (
                          <div className="h-full w-full flex">
                            {visibleInstalls.map((j: any) => (
                              <div
                                key={j.id}
                                className="h-full flex-1"
                                style={{ background: isPastLike ? "rgba(255,255,255,.18)" : (j as any).color, filter: isPastLike ? "none" : "saturate(1.8) contrast(1.2)" }}
                                title={j.title || j.customerName || j.projectAddress || j.selectedStyle?.name || "Job"}
                              />
                            ))}
                          </div>
                        ) : null;
                      })()}
                    </div>
                  ) : null}

                  {(() => {
                    const isEstimate = (j: any) => (j as any).status === "estimate";
                    const installs = jobs.filter((j: any) => !isEstimate(j));
                    const estimates = jobs
                      .filter((j: any) => isEstimate(j))
                      .slice()
                      .sort((a: any, b: any) => {
                        const ar = estimateAssigneeRank(a);
                        const br = estimateAssigneeRank(b);
                        if (ar !== br) return ar - br;
                        const at = new Date(String((a as any).scheduledAt || (a as any).installDate || "") || "").getTime();
                        const bt = new Date(String((b as any).scheduledAt || (b as any).installDate || "") || "").getTime();
                        if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
                        return String((a as any).id || "").localeCompare(String((b as any).id || ""));
                      });
                    const visibleInstallCount = Math.min(installs.length, 4);
                    const visibleEstimateCount = Math.min(estimates.length, 4);
                    const visibleTaskCount = Math.min(dayTasks.length, 4);
                    const visibleTotal = visibleInstallCount + visibleEstimateCount + visibleTaskCount;
                    const total = jobs.length + dayTasks.length;
                    const showOverflow = total > visibleTotal;
                    const maxEst = 4;
                    const maxStars = 4;
                    const visibleEst = estimates.slice(0, maxEst);
                    const visibleTasks = dayTasks.slice(0, maxStars);

                    return (
                      <>
                        {visibleEst.length ? (
                          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                            <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap sm:justify-center">
                              {visibleEst.map((j: any) => (
                                <div
                                  key={j.id}
                                  className="h-2.5 w-2.5 rounded-sm"
                                  style={{ background: isPastLike ? "rgba(255,255,255,.20)" : (j as any).color, filter: isPastLike ? "none" : "saturate(1.8) contrast(1.2)", boxShadow: "0 0 0 1px rgba(0,0,0,.25), 0 0 10px rgba(0,0,0,.12)" }}
                                  title={j.title || j.customerName || j.projectAddress || j.selectedStyle?.name || "Estimate"}
                                />
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {visibleTasks.length ? (
                          <div className="absolute left-0 right-0 bottom-0 flex items-end justify-start gap-1">
                            <div className="flex flex-wrap gap-1">
                              {visibleTasks.map((t) => (
                                <div
                                  key={t.id}
                                  className="h-3 w-3 grid place-items-center"
                                  title={t.description || "Task"}
                                  style={{ color: isPastLike ? "rgba(255,255,255,.35)" : "rgba(31,200,120,.95)", textShadow: "0 0 8px rgba(0,0,0,.30)" }}
                                >
                                  <span className="text-[10px] leading-none">★</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {showOverflow ? (
                          <div className="absolute bottom-0 right-0 text-[10px] text-[var(--muted)] font-extrabold">+{total - visibleTotal}</div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </button>
            );
          })}
        </div>
      </GlassCard>

      {taskOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          data-no-swipe="true"
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <div
            className="absolute inset-0 bg-[rgba(0,0,0,.45)]"
            onClick={() => {
              setTaskOpen(false);
              setTaskDate("");
              setTaskTime("");
              setTaskDesc("");
            }}
          />
          <div
            className="relative w-full max-w-[420px]"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <GlassCard className="p-4 overflow-hidden">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black">Add task</div>
                <SecondaryButton
                  onClick={() => {
                    setTaskOpen(false);
                    setTaskDate("");
                    setTaskTime("");
                    setTaskDesc("");
                  }}
                >
                  Close
                </SecondaryButton>
              </div>

              {(tasksByDay.get(String(taskDate || "").slice(0, 10)) ?? []).length ? (
                <div className="mt-3 grid gap-2">
                  <div className="text-[11px] text-[var(--muted)]">Tasks on this day</div>
                  {(tasksByDay.get(String(taskDate || "").slice(0, 10)) ?? []).map((t) => (
                    <div
                      key={t.id}
                      className="rounded-2xl border border-[rgba(31,200,120,.28)] bg-[rgba(31,200,120,.08)] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12px] font-black truncate">{t.description || "Task"}</div>
                          <div className="text-[11px] text-[var(--muted)] mt-1">
                            {String((t as any).atIso || "").slice(11, 16)}
                          </div>
                        </div>
                        <button
                          type="button"
                          data-no-swipe="true"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const next = readTaskStore().filter((x) => x.id !== t.id);
                            writeTaskStore(next);
                            setTasks(next);
                            void upsertTasksRemote(next);
                          }}
                          className="rounded-xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] hover:bg-[rgba(255,255,255,.10)] px-3 py-2 text-[12px] font-black"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 grid gap-2">
                <div className="text-[11px] text-[var(--muted)]">Date &amp; time</div>
                <div className="grid gap-2 sm:grid-cols-2 items-end">
                  <div className="min-w-0">
                    <div className="text-[11px] text-[var(--muted)] mb-1">Date</div>
                    <input
                      type="date"
                      value={taskDate}
                      onChange={(e) => setTaskDate(e.target.value)}
                      className="block box-border w-full max-w-full min-w-0 rounded-full px-2.5 py-1.5 text-[12px] bg-[rgba(255,255,255,.10)] border border-[rgba(255,255,255,.16)] outline-none"
                      style={{ minWidth: 0, WebkitAppearance: "none", appearance: "none" }}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] text-[var(--muted)] mb-1">Time</div>
                    <input
                      type="time"
                      value={taskTime}
                      onChange={(e) => setTaskTime(e.target.value)}
                      className="block box-border w-full max-w-full min-w-0 rounded-full px-2.5 py-1.5 text-[12px] bg-[rgba(255,255,255,.10)] border border-[rgba(255,255,255,.16)] outline-none"
                      style={{ minWidth: 0, WebkitAppearance: "none", appearance: "none" }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-2">
                <div className="text-[11px] text-[var(--muted)]">Description</div>
                <input
                  type="text"
                  value={taskDesc}
                  onChange={(e) => setTaskDesc(e.target.value)}
                  placeholder="Task description"
                  className="block box-border w-full max-w-full min-w-0 rounded-full px-3 py-2 text-[13px] bg-[rgba(255,255,255,.10)] border border-[rgba(255,255,255,.16)] outline-none"
                  style={{ minWidth: 0, WebkitAppearance: "none", appearance: "none" }}
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <SecondaryButton
                  onClick={() => {
                    setTaskOpen(false);
                    setTaskDate("");
                    setTaskTime("");
                    setTaskDesc("");
                  }}
                >
                  Cancel
                </SecondaryButton>
                <SecondaryButton
                  onClick={() => {
                    const d = String(taskDate || "").trim();
                    const t = String(taskTime || "").trim();
                    const desc = String(taskDesc || "").trim().slice(0, 120);
                    if (!d || !t || !desc) return;
                    const dt = new Date(`${d}T${t}`);
                    if (!Number.isFinite(dt.getTime())) return;
                    const atIso = dt.toISOString();
                    const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
                    const next: CalendarTask = { id, atIso, description: desc, createdAt: Date.now() };
                    const list = [...readTaskStore(), next];
                    writeTaskStore(list);
                    setTasks(list);
                    setTaskOpen(false);
                    setTaskDate("");
                    setTaskTime("");
                    setTaskDesc("");
                  }}
                >
                  Add
                </SecondaryButton>
              </div>
            </GlassCard>
          </div>
        </div>
      ) : null}

      <div
        onClick={() => requestOpenDayPreview()}
        className="cursor-pointer"
        role="button"
        tabIndex={0}
        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            requestOpenDayPreview();
          }
        }}
      >
        <SectionTitle title={"Installs • " + selected.toLocaleDateString()} />
      </div>
      <div
        className="cursor-pointer"
        onClick={() => requestOpenDayPreview()}
        role="button"
        tabIndex={0}
        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            requestOpenDayPreview();
          }
        }}
      >
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
          {dayTasks.length ? (
            <div className="mb-3 grid gap-2">
              {dayTasks.map((t) => (
                <div
                  key={t.id}
                  className="rounded-2xl border border-[rgba(31,200,120,.35)] bg-[rgba(31,200,120,.10)] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-black truncate">{t.description || "Task"}</div>
                      <div className="text-[11px] text-[var(--muted)] mt-1">
                        {String((t as any).atIso || "").slice(11, 16)}
                      </div>
                    </div>
                    <div className="h-3 w-3 grid place-items-center" style={{ color: "rgba(31,200,120,.95)" }} aria-hidden="true">
                      <span className="text-[14px] leading-none">★</span>
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
                  className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black truncate">
                      {j.title || j.customerName || j.projectAddress || j.selectedStyle?.name || "Job"}
                    </div>
                    <div
                      className={"h-3 w-3 " + ((j as any).status === "estimate" ? "rounded-none" : "rounded-full")}
                      style={{
                        background: (j as any).color ?? "rgba(255,255,255,.25)",
                        filter: "saturate(1.8) contrast(1.2)",
                        boxShadow: "0 0 0 1px rgba(0,0,0,.25), 0 0 10px rgba(0,0,0,.15)"
                      }}
                    />
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
    </div>
  );
}
