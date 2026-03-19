"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import { money } from "@/lib/money";
import { computeMaterialsAndExpensesTotal, computeTotals } from "@/lib/totals";
import { DEFAULT_WORKSPACE_ID, fetchDrafts, fetchQuotesEntries, resolveWorkspaceId, upsertDraft } from "@/lib/draftsStore";
import { fetchJobTasks } from "@/lib/jobTasksStore";
import { setStatusFromQuotes } from "@/lib/queuePipeline";
import { getQuotesDraftsSession, setQuotesDraftsSession } from "@/lib/sessionDraftsCache";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import type { QuoteItem } from "@/lib/types";

type DraftEntry = {
  id: string;
  createdAt: number;
  updatedAt?: number;
  title?: string;
  customerName?: string;
  phoneNumber?: string;
  projectAddress?: string;
  selectedStyle?: { name: string } | null;
  estimateAssignee?: "nate" | "cam";
  projectPhotoUrl?: string | null;
  projectPhotoDataUrl?: string | null;
  preInstallCount?: number;
  materialsDetails?: {
    woodType?: string;
    horizontalCedarBoardMaterial?: string;
  };
  segments?: Array<{ length: number; removed: boolean }>;
  items?: QuoteItem[];
  status?: "estimate" | "pending" | "sold" | "complete" | "void";
  scheduledAt?: string;
  installDate?: string;
  startDate?: string;
  laborDays?: number;
  calendarHidden?: boolean;
  deletedAt?: number;
  preInstallPhotos?: unknown;
  jobTasks?: {
    collectDeposit?: boolean;
    orderMaterials?: boolean;
    scheduleDelivery?: boolean;
    call811?: boolean;
  };
  jobTaskSnooze?: {
    collectDeposit?: number;
    orderMaterials?: number;
    scheduleDelivery?: number;
    call811?: number;
  };
  jobTaskLabels?: Record<string, string>;
  jobTaskHidden?: Record<string, boolean>;
  jobCustomTasks?: Array<{ id: string; label: string; done?: boolean; createdAt?: number }>;
};

const QUOTES_DRAFTS_CACHE_KEY = "vf_quotes_drafts_cache_v1";
const QUOTES_DELETED_TOMBSTONES_KEY = "vf_quotes_deleted_tombstones_v1";
const QUOTES_STATUS_CACHE_KEY = "vf_quotes_status_cache_v1";
const QUOTES_REMOTE_IDS_CACHE_KEY = "vf_quotes_remote_ids_cache_v1";

function readQuotesStatusCache(): Record<string, { status: DraftEntry["status"]; ts: number }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(QUOTES_STATUS_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, { status: DraftEntry["status"]; ts: number }>;
  } catch {
    return {};
  }
}

function writeQuotesStatusCache(next: Record<string, { status: DraftEntry["status"]; ts: number }>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUOTES_STATUS_CACHE_KEY, JSON.stringify(next || {}));
  } catch {
  }
}

function readQuotesRemoteIdsCache(): { ids: string[]; updatedAt: number } {
  if (typeof window === "undefined") return { ids: [], updatedAt: 0 };
  try {
    const raw = window.localStorage.getItem(QUOTES_REMOTE_IDS_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    const ids = Array.isArray(parsed?.ids) ? (parsed.ids as any[]).map((x) => String(x || "").trim()).filter(Boolean) : [];
    const updatedAt = Number(parsed?.updatedAt) || 0;
    return { ids, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 };
  } catch {
    return { ids: [], updatedAt: 0 };
  }
}

function writeQuotesRemoteIdsCache(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    const cleaned = (Array.isArray(ids) ? ids : []).map((x) => String(x || "").trim()).filter(Boolean);
    window.localStorage.setItem(QUOTES_REMOTE_IDS_CACHE_KEY, JSON.stringify({ updatedAt: Date.now(), ids: cleaned }));
  } catch {
  }
}

function readDeletedQuoteTombstones(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(QUOTES_DELETED_TOMBSTONES_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function writeDeletedQuoteTombstones(next: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUOTES_DELETED_TOMBSTONES_KEY, JSON.stringify(next || {}));
  } catch {
  }
}

function normalizePreInstallPhotos(input: unknown) {
  if (!Array.isArray(input)) return [] as Array<{ src: string; note: string; createdAt: number }>;

  const out: Array<{ src: string; note: string; createdAt: number }> = [];
  for (const v of input) {
    if (typeof v === "string") {
      const src = String(v || "");
      if (!src) continue;
      out.push({ src: v, note: "", createdAt: Date.now() });
      continue;
    }
    if (v && typeof v === "object") {
      const src = typeof (v as any).src === "string" ? (v as any).src : "";
      if (!src) continue;
      out.push({
        src,
        note: typeof (v as any).note === "string" ? (v as any).note : "",
        createdAt: Number((v as any).createdAt) || Date.now()
      });
    }
  }
  return out;
}

function stripDataUrlsFromPreInstall(input: unknown) {
  if (!Array.isArray(input)) return [] as Array<{ src: string; note: string; createdAt: number }>;
  return (input as any[]).filter((p) => p && typeof (p as any).src === "string" && !String((p as any).src || "").startsWith("data:"));
}

function toQuotesDraftLite(d: DraftEntry): DraftEntry {
  return {
    ...(d as any),
    id: String((d as any)?.id || ""),
    projectPhotoDataUrl: null,
    preInstallPhotos: stripDataUrlsFromPreInstall((d as any)?.preInstallPhotos)
  } as DraftEntry;
}

function readQuotesDraftsCache(): DraftEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUOTES_DRAFTS_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    const list = Array.isArray(parsed?.drafts) ? (parsed.drafts as DraftEntry[]) : [];
    return (Array.isArray(list) ? list : []).filter((d) => d && typeof (d as any).id === "string");
  } catch {
    return [];
  }
}

function writeQuotesDraftsCache(list: DraftEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      QUOTES_DRAFTS_CACHE_KEY,
      JSON.stringify({ updatedAt: Date.now(), drafts: (Array.isArray(list) ? list : []).map((d) => toQuotesDraftLite(d)) })
    );
  } catch {
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

export default function QuotesPage() {
  const [drafts, setDrafts] = useState<DraftEntry[]>(() => getQuotesDraftsSession<DraftEntry[]>() ?? []);
  const [statusFilter, setStatusFilter] = useState<DraftEntry["status"] | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [completedSearchQuery, setCompletedSearchQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const suppressNavUntilRef = useRef(0);
  const [scheduleForId, setScheduleForId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string>("");
  const [scheduleTime, setScheduleTime] = useState<string>("");
  const [scheduleAssignee, setScheduleAssignee] = useState<DraftEntry["estimateAssignee"] | "">("");
  const [portalReady, setPortalReady] = useState(false);
  const [expandedCustomerStacks, setExpandedCustomerStacks] = useState<Record<string, boolean>>({});
  const [layoutViewerSrc, setLayoutViewerSrc] = useState<string | null>(null);

  const diagEnabled = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URLSearchParams(window.location.search).has("diag");
    } catch {
      return false;
    }
  }, []);

  const [remoteDiag, setRemoteDiag] = useState<
    | {
        at: number;
        supabaseConfigured: boolean;
        workspaceId: string;
        quotesEntries?: { ok: boolean; reason?: string; count: number; error?: string };
        draftsFallback?: { ok: boolean; reason?: string; count: number; error?: string };
        jobTasks?: { ok: boolean; reason?: string; count: number; error?: string };
      }
    | null
  >(null);

  const loadInFlightRef = useRef(false);
  const loadQueuedRef = useRef(false);

  const hasSeededFromCacheRef = useRef(false);

  const orderRef = useRef<Record<string, number>>({});
  const orderMaxRef = useRef(0);

  const applyStableOrder = (list: DraftEntry[]) => {
    const arr = Array.isArray(list) ? list : [];

    if (typeof window !== "undefined" && Object.keys(orderRef.current || {}).length === 0) {
      try {
        const raw = window.sessionStorage.getItem("vf_quotes_order_v1");
        const ids = raw ? (JSON.parse(raw) as any) : null;
        if (Array.isArray(ids)) {
          const nextMap: Record<string, number> = {};
          let max = 0;
          for (const idRaw of ids) {
            const id = String(idRaw || "").trim();
            if (!id) continue;
            nextMap[id] = max;
            max++;
          }
          orderRef.current = nextMap;
          orderMaxRef.current = max;
        }
      } catch {
        // ignore
      }
    }

    const map = orderRef.current || {};
    let max = orderMaxRef.current || 0;
    let changed = false;

    for (const d of arr) {
      const id = String((d as any)?.id || "");
      if (!id) continue;
      if (map[id] == null) {
        map[id] = max;
        max++;
        changed = true;
      }
    }

    orderRef.current = map;
    orderMaxRef.current = max;

    if (changed && typeof window !== "undefined") {
      try {
        const ids = Object.entries(map)
          .sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0))
          .map(([id]) => id);
        window.sessionStorage.setItem("vf_quotes_order_v1", JSON.stringify(ids));
      } catch {
        // ignore
      }
    }

    return [...arr].sort((a, b) => {
      const ai = map[String((a as any)?.id || "")] ?? Number.MAX_SAFE_INTEGER;
      const bi = map[String((b as any)?.id || "")] ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  };

  const setDraftsStable = (list: DraftEntry[]) => {
    const next = applyStableOrder(list);
    setDrafts(next);
    try {
      if (Array.isArray(next) && next.length) setQuotesDraftsSession(next);
    } catch {
    }
  };

  useEffect(() => {
    try {
      if (Array.isArray(drafts) && drafts.length) setQuotesDraftsSession(drafts);
    } catch {
    }
  }, [drafts]);

  function setDraftScheduledAt(id: string, scheduledAt: string | null) {
    try {
      const sid = String(id);
      void (async () => {
        const store = readDraftStore();
        const existing: any = drafts.find((d) => d.id === sid) ?? store[sid];
        if (!existing) return;

        const nextStatus =
          scheduledAt && String(scheduledAt).trim() !== ""
            ? "estimate"
            : (existing as any)?.status;

        const nextDraft = {
          ...existing,
          scheduledAt: scheduledAt && String(scheduledAt).trim() !== "" ? scheduledAt : undefined,
          updatedAt: Date.now(),
          calendarHidden: false,
          ...(nextStatus ? { status: nextStatus } : {})
        };
        try {
          await upsertDraft({ id: sid, data: nextDraft });
        } catch {
        }

        setDrafts((prev) =>
          applyStableOrder(
            prev.map((d) =>
              d.id === sid
                ? {
                    ...d,
                    scheduledAt: scheduledAt && String(scheduledAt).trim() !== "" ? scheduledAt : undefined,
                    updatedAt: Date.now(),
                    calendarHidden: false,
                    ...(nextStatus ? { status: nextStatus as any } : {})
                  }
                : d
            ) as any
          ) as any
        );
        notifyDraftsChanged();
      })();
    } catch {
      // ignore
    }
  }

  function setDraftEstimateAssignee(id: string, assignee: DraftEntry["estimateAssignee"] | null) {
    try {
      const sid = String(id);
      void (async () => {
        const store = readDraftStore();
        const existing: any = drafts.find((d) => d.id === sid) ?? store[sid];
        if (!existing) return;

        const nextDraft = {
          ...existing,
          estimateAssignee: assignee ?? undefined,
          updatedAt: Date.now()
        };
        try {
          await upsertDraft({ id: sid, data: nextDraft });
        } catch {
        }

        setDrafts((prev) =>
          applyStableOrder(
            prev.map((d) =>
              d.id === sid
                ? {
                    ...d,
                    estimateAssignee: assignee ?? undefined,
                    updatedAt: Date.now()
                  }
                : d
            ) as any
          ) as any
        );
        notifyDraftsChanged();
      })();
    } catch {
      // ignore
    }
  }

  function toDateTimeLocalValue(iso: string) {
    try {
      const dt = new Date(iso);
      if (!Number.isFinite(dt.getTime())) return "";
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    } catch {
      return "";
    }
  }

  function toDateLocalValue(iso: string) {
    try {
      const dt = new Date(iso);
      if (!Number.isFinite(dt.getTime())) return "";
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    } catch {
      return "";
    }
  }

  function toTimeLocalValue(iso: string) {
    try {
      const dt = new Date(iso);
      if (!Number.isFinite(dt.getTime())) return "";
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    } catch {
      return "";
    }
  }

  function defaultScheduleLocalValue() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    // Default to today at 5:30 PM local time.
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T17:30`;
  }

  function defaultScheduleDateValue() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function defaultScheduleTimeValue() {
    return "17:30";
  }

  function scheduledAtToPrefill(iso: string) {
    try {
      const raw = String(iso || "").trim();
      if (!raw) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return { date: raw, time: defaultScheduleTimeValue() };
      }
      const date = toDateLocalValue(raw);
      const time = toTimeLocalValue(raw);
      if (!date) return null;
      return { date, time: time || defaultScheduleTimeValue() };
    } catch {
      return null;
    }
  }

  function computeSpanDays(laborDays: unknown) {
    const n = Number(laborDays);
    if (!Number.isFinite(n) || n <= 0) return 0;
    const roundedHalf = Math.ceil(n * 2) / 2;
    return Math.max(1, Math.ceil(roundedHalf));
  }

  function computeRoundedHalfDays(laborDays: unknown) {
    const n = Number(laborDays);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.ceil(n * 2) / 2;
  }

  function addDaysIso(iso: string, days: number) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function normalizePhone(raw: string) {
    const s = String(raw || "").trim();
    const hasPlus = s.startsWith("+");
    const digits = s.replace(/[^0-9]/g, "");
    if (digits.length < 7) return "";
    return hasPlus ? `+${digits}` : digits;
  }

  function isWeekend(d: Date) {
    const day = d.getDay();
    return day === 0 || day === 6;
  }

  function workdayIsoSequence(startIso: string, count: number) {
    const out: string[] = [];
    let cur = new Date(startIso + "T12:00:00");
    while (out.length < count) {
      if (!isWeekend(cur)) out.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  const tasksNeedAttention = useMemo(() => {
    const now = Date.now();
    const hours36 = 36 * 60 * 60 * 1000;
    const days7 = 7 * 24 * 60 * 60 * 1000;

    return drafts
      .filter((d) => (d.status ?? "estimate") === "sold")
      .filter((d) => !d.calendarHidden)
      .some((d) => {
        const iso = String((d as any).scheduledAt || "");
        if (!iso) return false;
        const ms = new Date(iso).getTime();
        if (!Number.isFinite(ms)) return false;

        const dt = ms - now;
        if (dt < 0) return false;

        const tasks = (d as any).jobTasks || {};
        const snooze = (d as any).jobTaskSnooze || {};
        const snoozed = (k: "call811" | "orderMaterials" | "scheduleDelivery") => {
          const until = Number((snooze as any)[k]) || 0;
          return until > 0 && now < until;
        };

        if (dt <= hours36 && !tasks.call811 && !snoozed("call811")) return true;
        if (dt <= days7 && !tasks.orderMaterials && !snoozed("orderMaterials")) return true;
        if (dt <= days7 && !tasks.scheduleDelivery && !snoozed("scheduleDelivery")) return true;
        return false;
      });
  }, [drafts]);

  function notifyDraftsChanged() {
    try {
      window.dispatchEvent(new Event("vf-drafts-changed"));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    let cancelled = false;
    const getTs = (d: any) => Number(d?.updatedAt ?? d?.createdAt) || 0;
    const withTimeout = async <T,>(p: Promise<T>, ms: number) => {
      let t: any;
      try {
        return await Promise.race([
          p,
          new Promise<T>((_, reject) => {
            t = window.setTimeout(() => reject(new Error("timeout")), ms);
          })
        ]);
      } finally {
        if (t) window.clearTimeout(t);
      }
    };

    const load = async () => {
      if (loadInFlightRef.current) {
        loadQueuedRef.current = true;
        return;
      }
      loadInFlightRef.current = true;

      try {
        const session = getQuotesDraftsSession<DraftEntry[]>();
        if (!hasSeededFromCacheRef.current && Array.isArray(session) && session.length) {
          setDraftsStable(session);
          hasSeededFromCacheRef.current = true;
        }
      } catch {
      }

      const tombstones = readDeletedQuoteTombstones();
      const statusCache = readQuotesStatusCache();

      const filterGhosts = (list: DraftEntry[]) => {
        const arr = Array.isArray(list) ? list : [];
        return arr;
      };

      const applyStatusCache = (list: DraftEntry[]) => {
        const arr = Array.isArray(list) ? list : [];
        return arr.map((d) => {
          const id = String((d as any)?.id || "");
          if (!id) return d;
          const cached = statusCache[id];
          if (!cached || !cached.status) return d;
          const ts = getTs(d);
          if (Number(cached.ts) > ts) return { ...(d as any), status: cached.status, updatedAt: Math.max(ts, Number(cached.ts) || 0) } as any;
          return d;
        });
      };
      try {
        const cached = readQuotesDraftsCache();
        if (!cancelled && !hasSeededFromCacheRef.current && Array.isArray(cached) && cached.length) {
          setDraftsStable(filterGhosts(applyStatusCache(cached.filter((d) => !tombstones[String((d as any)?.id || "")]))));
          hasSeededFromCacheRef.current = true;
        }
      } catch {
      }

      window.setTimeout(() => {
        if (cancelled) return;
        if (hasSeededFromCacheRef.current) return;
        try {
          const localStore = readDraftStore();
          const localList = Object.values(localStore)
            .map((d) => toQuotesDraftLite({ ...(d as any) } as any))
            .filter((d) => !tombstones[String((d as any)?.id || "")]);
          if (!cancelled) setDraftsStable(filterGhosts(applyStatusCache(localList)));
          hasSeededFromCacheRef.current = true;
          try {
            writeQuotesDraftsCache(localList);
          } catch {
          }
        } catch {
        }
      }, 0);

      const localStore = readDraftStore();
      const localList = Object.values(localStore)
        .map((d) => ({ ...d }))
        .filter((d) => !tombstones[String((d as any)?.id || "")]);

      let remoteListRaw: DraftEntry[] = [];
      const remoteTs = (d: any) => Number(d?.updatedAt ?? d?.createdAt ?? 0) || 0;
      const mergeRemote = (a: DraftEntry[], b: DraftEntry[]) => {
        const out = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
        const byId = new Map<string, DraftEntry>();
        for (const d of out) {
          const id = String((d as any)?.id || "");
          if (!id) continue;
          const prev = byId.get(id);
          if (!prev) {
            byId.set(id, d);
            continue;
          }
          if (remoteTs(d) > remoteTs(prev)) byId.set(id, d);
        }
        return Array.from(byId.values());
      };

      let snapshotList: DraftEntry[] = [];
      let draftsList: DraftEntry[] = [];

      try {
        const snap = await withTimeout(fetchQuotesEntries({ limit: 900 }) as any, 3500);
        if ((snap as any)?.ok && Array.isArray((snap as any)?.drafts)) {
          snapshotList = ((snap as any).drafts as DraftEntry[]) || [];
          if (diagEnabled) {
            setRemoteDiag((prev) => ({
              ...(prev || { at: Date.now(), supabaseConfigured, workspaceId: resolveWorkspaceId() }),
              at: Date.now(),
              supabaseConfigured,
              workspaceId: resolveWorkspaceId(),
              quotesEntries: { ok: true, count: snapshotList.length }
            }));
          }
        } else if (diagEnabled) {
          setRemoteDiag((prev) => ({
            ...(prev || { at: Date.now(), supabaseConfigured, workspaceId: resolveWorkspaceId() }),
            at: Date.now(),
            supabaseConfigured,
            workspaceId: resolveWorkspaceId(),
            quotesEntries: {
              ok: false,
              reason: String((snap as any)?.reason || ""),
              count: 0,
              error: (snap as any)?.error ? String(((snap as any).error as any)?.message || (snap as any).error || "") : undefined
            }
          }));
        }
      } catch (e: any) {
        if (diagEnabled) {
          setRemoteDiag((prev) => ({
            ...(prev || { at: Date.now(), supabaseConfigured, workspaceId: resolveWorkspaceId() }),
            at: Date.now(),
            supabaseConfigured,
            workspaceId: resolveWorkspaceId(),
            quotesEntries: { ok: false, reason: "error", count: 0, error: String(e?.message || e || "") }
          }));
        }
      }

      try {
        const remote = await withTimeout(fetchDrafts({ limit: 900 }) as any, 3500);
        draftsList = (remote as any)?.ok ? (((remote as any).drafts as DraftEntry[]) || []) : [];
        if (diagEnabled) {
          setRemoteDiag((prev) => ({
            ...(prev || { at: Date.now(), supabaseConfigured, workspaceId: resolveWorkspaceId() }),
            at: Date.now(),
            supabaseConfigured,
            workspaceId: resolveWorkspaceId(),
            draftsFallback: {
              ok: Boolean((remote as any)?.ok),
              reason: String((remote as any)?.reason || ""),
              count: draftsList.length,
              error: (remote as any)?.error ? String(((remote as any).error as any)?.message || (remote as any).error || "") : undefined
            }
          }));
        }
      } catch (e: any) {
        if (diagEnabled) {
          setRemoteDiag((prev) => ({
            ...(prev || { at: Date.now(), supabaseConfigured, workspaceId: resolveWorkspaceId() }),
            at: Date.now(),
            supabaseConfigured,
            workspaceId: resolveWorkspaceId(),
            draftsFallback: { ok: false, reason: "error", count: 0, error: String(e?.message || e || "") }
          }));
        }
      }

      remoteListRaw = mergeRemote(snapshotList, draftsList);

      const remoteList = remoteListRaw.filter((d) => !tombstones[String((d as any)?.id || "")]);

      const byId = new Map<string, DraftEntry>();
      for (const d of Array.isArray(localList) ? localList : []) {
        const id = String((d as any)?.id || "");
        if (!id) continue;
        byId.set(id, d as any);
      }
      for (const d of Array.isArray(remoteList) ? remoteList : []) {
        const id = String((d as any)?.id || "");
        if (!id) continue;
        const prev = byId.get(id);
        if (!prev) {
          byId.set(id, d as any);
          continue;
        }

        if (getTs(d) > getTs(prev)) {
          const mergedNext: DraftEntry = { ...(prev as any), ...(d as any) } as any;
          if ((d as any).items == null && (prev as any).items != null) (mergedNext as any).items = (prev as any).items;
          if ((d as any).takeoffMaterials == null && (prev as any).takeoffMaterials != null)
            (mergedNext as any).takeoffMaterials = (prev as any).takeoffMaterials;
          if ((d as any).takeoffManualItems == null && (prev as any).takeoffManualItems != null)
            (mergedNext as any).takeoffManualItems = (prev as any).takeoffManualItems;
          if ((d as any).totals == null && (prev as any).totals != null) (mergedNext as any).totals = (prev as any).totals;
          if ((d as any).jobTasks == null && (prev as any).jobTasks != null) (mergedNext as any).jobTasks = (prev as any).jobTasks;
          if ((d as any).jobTaskSnooze == null && (prev as any).jobTaskSnooze != null) (mergedNext as any).jobTaskSnooze = (prev as any).jobTaskSnooze;
          if ((d as any).jobTaskLabels == null && (prev as any).jobTaskLabels != null) (mergedNext as any).jobTaskLabels = (prev as any).jobTaskLabels;
          if ((d as any).jobTaskHidden == null && (prev as any).jobTaskHidden != null) (mergedNext as any).jobTaskHidden = (prev as any).jobTaskHidden;
          if ((d as any).jobCustomTasks == null && (prev as any).jobCustomTasks != null) (mergedNext as any).jobCustomTasks = (prev as any).jobCustomTasks;
          byId.set(id, mergedNext);
        }
      }

      const merged = Array.from(byId.values()).sort((a, b) => getTs(b) - getTs(a));
      const mergedLite = (Array.isArray(merged) ? merged : [])
        .filter((d) => !tombstones[String((d as any)?.id || "")])
        .map((d) => toQuotesDraftLite({ ...(d as any) } as any));
      const mergedLitePatched = applyStatusCache(mergedLite);
      if (!cancelled) setDraftsStable(mergedLitePatched);
      try {
        writeQuotesDraftsCache(mergedLitePatched);
      } catch {
      }

      try {
        writeQuotesRemoteIdsCache(mergedLitePatched.map((d: any) => String(d?.id || "")).filter(Boolean));
      } catch {
      }

      try {
        const nextStatusCache = { ...(statusCache as any) } as Record<string, { status: DraftEntry["status"]; ts: number }>;
        for (const d of mergedLitePatched as any[]) {
          const id = String((d as any)?.id || "");
          if (!id) continue;
          const s = (d as any)?.status as any;
          if (!s) continue;
          const ts = getTs(d);
          const prev = nextStatusCache[id];
          if (!prev || ts >= Number(prev.ts || 0)) nextStatusCache[id] = { status: s, ts };
        }
        writeQuotesStatusCache(nextStatusCache);
      } catch {
      }

      try {
        const ids = mergedLite.map((d) => String((d as any)?.id || "")).filter(Boolean);
        const tasksRes = await withTimeout(fetchJobTasks({ draftIds: ids }) as any, 3500);
        if (!cancelled && (tasksRes as any)?.ok && Array.isArray((tasksRes as any)?.rows)) {
          if (diagEnabled) {
            setRemoteDiag((prev) => ({
              ...(prev || { at: Date.now(), supabaseConfigured, workspaceId: resolveWorkspaceId() }),
              at: Date.now(),
              supabaseConfigured,
              workspaceId: resolveWorkspaceId(),
              jobTasks: { ok: true, count: Number((tasksRes as any)?.rows?.length || 0) }
            }));
          }
          const byIdTasks = new Map<string, any>();
          for (const r of (tasksRes as any).rows as any[]) {
            const rid = String((r as any)?.draft_id || "");
            if (!rid) continue;
            byIdTasks.set(rid, r);
          }

          setDrafts((prev) => {
            const next = (Array.isArray(prev) ? prev : []).map((d: any) => {
              const r = byIdTasks.get(String(d?.id || ""));
              if (!r) return d;
              const jt = (r as any).job_tasks;
              const js = (r as any).job_task_snooze;
              const jl = (r as any).job_task_labels;
              const jh = (r as any).job_task_hidden;
              const jc = (r as any).job_custom_tasks;
              return {
                ...d,
                ...(jt != null ? { jobTasks: jt } : {}),
                ...(js != null ? { jobTaskSnooze: js } : {}),
                ...(jl != null ? { jobTaskLabels: jl } : {}),
                ...(jh != null ? { jobTaskHidden: jh } : {}),
                ...(jc != null ? { jobCustomTasks: jc } : {})
              };
            });

            try {
              writeQuotesDraftsCache(next as any);
            } catch {
            }

            return applyStableOrder(next as any) as any;
          });
        }
      } catch {
        if (diagEnabled) {
          setRemoteDiag((prev) => ({
            ...(prev || { at: Date.now(), supabaseConfigured, workspaceId: resolveWorkspaceId() }),
            at: Date.now(),
            supabaseConfigured,
            workspaceId: resolveWorkspaceId(),
            jobTasks: { ok: false, reason: "error", count: 0 }
          }));
        }
      }

      loadInFlightRef.current = false;
      if (loadQueuedRef.current && !cancelled) {
        loadQueuedRef.current = false;
        window.setTimeout(() => {
          if (cancelled) return;
          void load();
        }, 0);
      }
    };

    const debouncedLoad = (() => {
      let t: any = null;
      return () => {
        try {
          if (t) window.clearTimeout(t);
          t = window.setTimeout(() => {
            if (cancelled) return;
            void load();
          }, 150);
        } catch {
          if (!cancelled) void load();
        }
      };
    })();

    void load();

    let realtimeChannel: any = null;
    try {
      if (supabaseConfigured) {
        const workspaceId = resolveWorkspaceId();
        realtimeChannel = supabase
          .channel("vf-quotes")
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "quotes_entries",
              filter: `workspace_id=eq.${workspaceId || DEFAULT_WORKSPACE_ID}`
            },
            () => debouncedLoad()
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "calendar_entries",
              filter: `workspace_id=eq.${workspaceId || DEFAULT_WORKSPACE_ID}`
            },
            () => debouncedLoad()
          )
          .subscribe();
      }
    } catch {
      realtimeChannel = null;
    }

    const onVisibility = () => {
      try {
        if (document.visibilityState === "visible") debouncedLoad();
      } catch {
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const pollId = !supabaseConfigured
      ? window.setInterval(() => {
          try {
            if (document.visibilityState === "visible") debouncedLoad();
          } catch {
          }
        }, 120000)
      : null;

    const onChanged = () => {
      debouncedLoad();
    };
    window.addEventListener("vf-drafts-changed", onChanged);

    return () => {
      cancelled = true;
      if (pollId) window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        if (realtimeChannel) supabase.removeChannel(realtimeChannel);
      } catch {
      }
      window.removeEventListener("vf-drafts-changed", onChanged);
    };
  }, []);

  useEffect(() => {
    if (!openStatusId && !confirmDeleteId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof (t as any).closest === "function" && t.closest("[data-keep-open='true']")) return;
      setOpenStatusId(null);
      setConfirmDeleteId(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [confirmDeleteId, openStatusId]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  function setDraftStatus(id: string, status: DraftEntry["status"]) {
    try {
      const existing = readDraftStore()[id] ?? drafts.find((d) => d.id === id);
      if (!existing) return;

      try {
        const now = Date.now();
        const cache = readQuotesStatusCache();
        const prev = cache[id];
        if (!prev || now >= Number(prev.ts || 0)) {
          cache[id] = { status, ts: now };
          writeQuotesStatusCache(cache);
        }
      } catch {
      }

      void setStatusFromQuotes({ id, status, draftSnapshot: existing as any });
      setDrafts((prev) =>
        applyStableOrder(
          prev.map((d) =>
          d.id === id
            ? {
                ...d,
                status,
                calendarHidden: status === "sold" ? false : status === "void" ? true : d.calendarHidden,
                startDate: status === "void" ? undefined : (d as any).startDate,
                installDate: status === "void" ? undefined : d.installDate
              }
            : d
          )
        )
      );
    } catch {
      // ignore
    }
  }

  function deleteDraft(id: string) {
    try {
      const now = Date.now();

      try {
        const cache = readQuotesStatusCache();
        const prev = cache[id];
        if (!prev || now >= Number(prev.ts || 0)) {
          cache[id] = { status: "void", ts: now };
          writeQuotesStatusCache(cache);
        }
      } catch {
      }

      const store = readDraftStore();
      const existing: any = drafts.find((d) => d.id === id) ?? store[id];
      if (!existing) return;

      const nextDraft = {
        ...existing,
        status: "void",
        deletedAt: now,
        updatedAt: now,
        calendarHidden: true,
        startDate: undefined,
        installDate: undefined
      };

      try {
        void upsertDraft({ id, data: nextDraft });
      } catch {
      }

      setDrafts((prev) => {
        const updated = (Array.isArray(prev) ? prev : []).map((d) => (d.id === id ? toQuotesDraftLite(nextDraft as any) : d));
        const next = statusFilter === "void" ? updated : updated.filter((d) => d.id !== id);
        try {
          writeQuotesDraftsCache(next as any);
        } catch {
        }
        return applyStableOrder(next as any) as any;
      });
      setConfirmDeleteId(null);
      setDeletingId(null);
      notifyDraftsChanged();
    } catch {
      // ignore
    }
  }

  function setDraftStartDate(id: string, startDate: string | undefined) {
    try {
      const store = readDraftStore();
      const existing: any = drafts.find((d) => d.id === id) ?? store[id];
      if (!existing) return;
      const nextDraft = { ...existing, startDate, installDate: startDate, calendarHidden: false, updatedAt: Date.now() };
      try {
        void upsertDraft({ id, data: nextDraft });
      } catch {
      }
      setDrafts((prev) =>
        applyStableOrder(prev.map((d) => (d.id === id ? { ...d, startDate, installDate: startDate, calendarHidden: false } : d)) as any) as any
      );
      notifyDraftsChanged();
    } catch {
      // ignore
    }
  }

  function removeFromCalendar(id: string) {
    try {
      const store = readDraftStore();
      const existing: any = drafts.find((d) => d.id === id) ?? store[id];
      if (!existing) return;
      const nextDraft = { ...existing, startDate: undefined, installDate: undefined, calendarHidden: true, updatedAt: Date.now() };
      try {
        void upsertDraft({ id, data: nextDraft });
      } catch {
      }
      setDrafts((prev) =>
        applyStableOrder(prev.map((d) => (d.id === id ? { ...d, startDate: undefined, installDate: undefined, calendarHidden: true } : d)) as any) as any
      );
      notifyDraftsChanged();
    } catch {
      // ignore
    }
  }

  function statusLabel(s: DraftEntry["status"]) {
    if (s === "pending") return "Pending";
    if (s === "sold") return "Sold";
    if (s === "complete") return "Complete";
    if (s === "void") return "Trash";
    return "Estimate";
  }

  function statusCardClass(s: DraftEntry["status"]) {
    if (s === "pending") {
      return "border-[rgba(255,214,10,.40)] bg-[linear-gradient(180deg,rgba(255,214,10,.24),rgba(255,214,10,.10))]";
    }
    if (s === "sold") {
      return "border-[rgba(31,200,120,.40)] bg-[linear-gradient(180deg,rgba(31,200,120,.22),rgba(31,200,120,.10))]";
    }
    if (s === "complete") {
      return "border-[rgba(255,255,255,.18)] bg-[linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.04))]";
    }
    if (s === "void") {
      return "border-[rgba(255,80,80,.40)] bg-[linear-gradient(180deg,rgba(255,80,80,.22),rgba(255,80,80,.10))]";
    }
    return "border-[rgba(64,156,255,.55)] bg-[linear-gradient(180deg,rgba(64,156,255,.26),rgba(64,156,255,.12))]";
  }

  function statusPillClass(s: DraftEntry["status"]) {
    if (s === "pending") return "bg-[rgba(255,214,10,.22)] border-[rgba(255,214,10,.40)]";
    if (s === "sold") return "bg-[rgba(31,200,120,.22)] border-[rgba(31,200,120,.40)]";
    if (s === "complete") return "bg-[rgba(255,255,255,.10)] border-[rgba(255,255,255,.18)]";
    if (s === "void") return "bg-[rgba(255,80,80,.22)] border-[rgba(255,80,80,.40)]";
    return "bg-[rgba(64,156,255,.30)] border-[rgba(64,156,255,.55)]";
  }

  function filterLabel(s: DraftEntry["status"] | "all") {
    if (s === "all") return "All";
    return statusLabel(s);
  }

  function filterPillClass(s: DraftEntry["status"] | "all") {
    if (s === "all") return "bg-[rgba(255,255,255,.10)] border-[rgba(255,255,255,.16)]";
    return statusPillClass(s);
  }

  function bumpSuppressNav(ms = 700) {
    suppressNavUntilRef.current = Date.now() + ms;
  }

  function soldJobHasIncompleteTasks(d: any) {
    const status = String((d as any)?.status || "estimate");
    if (status !== "sold") return false;
    const tasks = ((d as any)?.jobTasks || {}) as any;
    const keys: Array<keyof NonNullable<DraftEntry["jobTasks"]>> = [
      "collectDeposit",
      "orderMaterials",
      "scheduleDelivery",
      "call811"
    ];
    return keys.some((k) => !Boolean(tasks?.[k]));
  }

  const cards = useMemo(() => {
    return drafts.map((d) => {
      const items = Array.isArray(d.items) ? d.items : [];

      const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

      const sumLineTotals = (arr: QuoteItem[]) =>
        (Array.isArray(arr) ? arr : []).reduce((a, b) => {
          const v = Number((b as any)?.lineTotal);
          return a + (Number.isFinite(v) ? v : 0);
        }, 0);

      const totals = computeTotals(items, 0, 0, 0);

      const feeNames = new Set(["Disposal", "Delivery", "Equipment Fees"]);
      const materialsSubtotal = sumLineTotals(items.filter((i) => i.section === "materials"));
      const materialsFees = items
        .filter((i) => i.section === "materials" && feeNames.has(i.name))
        .reduce((sum, i) => {
          const v = Number((i as any)?.lineTotal);
          return sum + (Number.isFinite(v) ? v : 0);
        }, 0);
      const materialsUsed = (Number(materialsSubtotal) || 0) - materialsFees;
      const additionalServicesSubtotal = items
        .filter((i) => i.section === "additional")
        .reduce((sum, i) => {
          const v = Number((i as any)?.lineTotal);
          return sum + (Number.isFinite(v) ? v : 0);
        }, 0);

      const takeoffMaterialsRaw = Array.isArray((d as any).takeoffMaterials) ? ((d as any).takeoffMaterials as QuoteItem[]) : [];
      const takeoffMaterials = (Array.isArray(takeoffMaterialsRaw) ? takeoffMaterialsRaw : []).filter(
        (i) => i && (i as any).section === "materials"
      );
      const takeoffManualRaw = Array.isArray((d as any).takeoffManualItems)
        ? (((d as any).takeoffManualItems as any[]) as QuoteItem[])
        : [];
      const takeoffManualItems = (Array.isArray(takeoffManualRaw) ? takeoffManualRaw : []).filter(
        (i) => i && (i as any).section === "materials"
      );
      const persistedMaterialsAndExpensesTotal = Number((d as any)?.totals?.materialsSubtotal);
      const materialsAndExpensesTotal = Number.isFinite(persistedMaterialsAndExpensesTotal)
        ? round2(persistedMaterialsAndExpensesTotal)
        : round2(
            computeMaterialsAndExpensesTotal(
              (Array.isArray(items) && items.length > 0
                ? items
                : ([...takeoffMaterials, ...takeoffManualItems] as QuoteItem[])) as QuoteItem[]
            )
          );

      const segments = Array.isArray(d.segments) ? d.segments : [];
      const removalLf = segments
        .filter((s: any) => Boolean((s as any).removed) || Boolean((s as any).removal))
        .reduce((sum: number, s: any) => sum + (Number(s.length) || 0), 0);
      const removalTotal = round2(removalLf > 0 ? removalLf * 5 : 0);

      const laborBaseTotal = items
        .filter((i) => i.section === "labor" && String(i.name || "") === "Days labor")
        .reduce((sum, i) => {
          const v = Number((i as any)?.lineTotal);
          return sum + (Number.isFinite(v) ? v : 0);
        }, 0);
      const laborBaseTotalRounded = round2(laborBaseTotal);
      const laborFeeItems = items
        .filter((i) => i.section === "labor" && String(i.name || "") !== "Days labor")
        .map((i) => ({ name: String(i.name || ""), lineTotal: Math.round((Number((i as any).lineTotal) || 0) * 100) / 100 }))
        .filter((i) => i.lineTotal !== 0);
      const additionalSectionFeeItems = items
        .filter((i) => i.section === "additional")
        .map((i) => ({ name: String(i.name || ""), lineTotal: Math.round((Number((i as any).lineTotal) || 0) * 100) / 100 }))
        .filter((i) => i.lineTotal !== 0);
      const additionalFeeItems = [...laborFeeItems, ...additionalSectionFeeItems];
      const persistedAdditionalSubtotal = Number((d as any)?.totals?.additionalSubtotal);
      const additionalFeesTotal = Number.isFinite(persistedAdditionalSubtotal)
        ? round2(persistedAdditionalSubtotal)
        : round2(additionalFeeItems.reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0));

      const persistedRemovalTotal = Number((d as any)?.totals?.removalTotal);
      const removalTotalForCard = Number.isFinite(persistedRemovalTotal) ? round2(persistedRemovalTotal) : removalTotal;

      const persistedLaborSubtotal = Number((d as any)?.totals?.laborSubtotal);
      const laborBaseTotalForCard = Number.isFinite(persistedLaborSubtotal) ? round2(persistedLaborSubtotal) : laborBaseTotalRounded;

      const persistedTotal = Number((d as any)?.totals?.total);

      const computedTotal = round2(
        (Number(materialsAndExpensesTotal) || 0) +
          (Number(additionalFeesTotal) || 0) +
          (Number(removalTotalForCard) || 0) +
          (Number(laborBaseTotalForCard) || 0)
      );
      const total = Number.isFinite(persistedTotal) ? round2(persistedTotal) : computedTotal;
      const depositTotal = round2(Number(materialsAndExpensesTotal) || 0);
      const due = round2(Math.max(0, total - depositTotal));

      const style = String(d.selectedStyle?.name || "");
      const fenceBuilderTitle = (() => {
        if (style.trim().toLowerCase() !== "fence builder") return "";
        const fb = (d as any).fenceBuilder;
        if (!fb || typeof fb !== "object") return "";
        const selectedId = String((fb as any).selectedDesignId || "").trim();
        if (!selectedId) return "";
        const designs = Array.isArray((fb as any).designs) ? ((fb as any).designs as any[]) : [];
        const design = designs.find((x) => String((x as any)?.id || "") === selectedId) as any;
        return String(design?.name || "").trim();
      })();
      const styleLabel = style.trim().toLowerCase() === "fence builder" && fenceBuilderTitle ? fenceBuilderTitle : style;
      const estimateTitle = String(d.title || "").trim();
      const customerLabel = String(d.customerName || "").trim();
      const title = estimateTitle || customerLabel || String(d.projectAddress || d.selectedStyle?.name || "Quote");
      const material = (() => {
        const md = (d as any).materialsDetails as any;
        if (!md || typeof md !== "object") return "";
        if (style === "Horizontal Cedar") return String(md.horizontalCedarBoardMaterial || "");
        return String(md.woodType || "");
      })();
      const statusRaw = String((d as any).status ?? "estimate").trim().toLowerCase();
      const status = (statusRaw === "pending" || statusRaw === "estimate" || statusRaw === "sold" || statusRaw === "complete" || statusRaw === "void"
        ? statusRaw
        : "estimate") as DraftEntry["status"];
      const phoneNumber = String((d as any).phoneNumber || "");
      const startDate = String((d as any).startDate || d.installDate || "");
      const laborDays = Number((d as any).laborDays);
      const roundedHalfDays = computeRoundedHalfDays(laborDays);
      const spanDays = computeSpanDays(laborDays);
      const endDate = startDate && spanDays > 0 ? addDaysIso(startDate, spanDays - 1) : "";
      const preInstallPhotoCount = (() => {
        const normalized = normalizePreInstallPhotos((d as any).preInstallPhotos);
        if (normalized.length > 0) return normalized.length;
        const c = Number((d as any).preInstallCount);
        return Number.isFinite(c) && c > 0 ? Math.max(0, Math.floor(c)) : 0;
      })();
      const hasIncompleteTasks = soldJobHasIncompleteTasks(d as any);
      const queueRank = Number((d as any).queueRank);
      const updatedAt = Number((d as any).updatedAt);
      const createdAt = Number((d as any).createdAt);

      const layoutSrc = (() => {
        const url = (d as any).projectPhotoUrl;
        if (typeof url === "string" && url) return url;
        const data = (d as any).projectPhotoDataUrl;
        if (typeof data === "string" && data) return data;
        return "";
      })();

      return {
        id: String(d.id),
        status: (d.status ?? "estimate") as DraftEntry["status"],
        title,
        estimateTitle,
        customerName: String((d as any).customerName || ""),
        style,
        styleLabel,
        material,
        startDate,
        endDate,
        roundedHalfDays,
        spanDays,
        materialsAndExpensesTotal,
        additionalFeesTotal,
        removalTotal: removalTotalForCard,
        laborBaseTotal: laborBaseTotalForCard,
        total,
        due,
        scheduledAt: String((d as any).scheduledAt || ""),
        phoneNumber,
        preInstallPhotoCount,
        layoutSrc,
        hasIncompleteTasks,
        queueRank,
        updatedAt,
        createdAt
      };
    });
  }, [drafts]);

  const filteredCards = useMemo(() => {
    const q = String((statusFilter === "complete" ? completedSearchQuery : searchQuery) || "").trim().toLowerCase();
    const recency = (c: any) => {
      const u = Number((c as any).updatedAt ?? 0);
      const cr = Number((c as any).createdAt ?? 0);
      const ut = Number.isFinite(u) ? u : 0;
      const ct = Number.isFinite(cr) ? cr : 0;
      return Math.max(ut, ct);
    };
    const parseIsoMs = (iso: string) => {
      const s = String(iso || "").trim();
      if (!s) return Number.POSITIVE_INFINITY;
      const ms = Date.parse(s);
      return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
    };
    const parseDayMs = (day: string) => {
      const s = String(day || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.POSITIVE_INFINITY;
      const ms = Date.parse(`${s}T12:00:00`);
      return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
    };

    const byStatus = statusFilter === "all"
      ? cards.filter((c) => {
          const s = String((c as any).status ?? "estimate").trim().toLowerCase() as any;
          return s !== "complete" && s !== "void";
        })
      : cards.filter((c) => String((c as any).status ?? "estimate").trim().toLowerCase() === statusFilter);

    const withSearch = (() => {
      if (!q) return byStatus;
      return byStatus.filter((c) => {
        const hay = [
          c.id,
          c.title,
          c.style,
          String((c as any).material || ""),
          String((c as any).phoneNumber || ""),
          c.status,
          String((c as any).scheduledAt || ""),
          String((c as any).startDate || ""),
          String((c as any).endDate || "")
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    })();

    const indexed = withSearch.map((c, idx) => ({ c, idx }));

    if (statusFilter === "all") {
      indexed.sort((a, b) => {
        const ar = recency(a.c);
        const br = recency(b.c);
        if (ar !== br) return br - ar;
        return a.idx - b.idx;
      });
      return indexed.map((x) => x.c);
    }

    if (statusFilter === "estimate") {
      const scheduled: Array<{ c: any; idx: number }> = [];
      const unscheduled: Array<{ c: any; idx: number }> = [];

      for (const it of indexed) {
        const iso = String((it.c as any).scheduledAt || "").trim();
        if (iso) scheduled.push(it);
        else unscheduled.push(it);
      }

      scheduled.sort((a, b) => {
        const am = parseIsoMs(String((a.c as any).scheduledAt || ""));
        const bm = parseIsoMs(String((b.c as any).scheduledAt || ""));
        if (am !== bm) return am - bm;
        const ar = recency(a.c);
        const br = recency(b.c);
        if (ar !== br) return br - ar;
        return a.idx - b.idx;
      });

      unscheduled.sort((a, b) => {
        const ar = recency(a.c);
        const br = recency(b.c);
        if (ar !== br) return br - ar;
        return a.idx - b.idx;
      });

      return [...scheduled, ...unscheduled].map((x) => x.c);
    }

    if (statusFilter === "sold") {
      indexed.sort((a, b) => {
        const am = parseDayMs(String((a.c as any).installDate || (a.c as any).startDate || ""));
        const bm = parseDayMs(String((b.c as any).installDate || (b.c as any).startDate || ""));
        if (am !== bm) return am - bm;
        const ar = recency(a.c);
        const br = recency(b.c);
        if (ar !== br) return br - ar;
        return a.idx - b.idx;
      });
      return indexed.map((x) => x.c);
    }

    if (statusFilter === "void") {
      indexed.sort((a, b) => {
        const ad = Number((a.c as any).deletedAt ?? 0);
        const bd = Number((b.c as any).deletedAt ?? 0);
        const aDel = Number.isFinite(ad) ? ad : 0;
        const bDel = Number.isFinite(bd) ? bd : 0;
        if (aDel !== bDel) return bDel - aDel;
        const ar = recency(a.c);
        const br = recency(b.c);
        if (ar !== br) return br - ar;
        return a.idx - b.idx;
      });
      return indexed.map((x) => x.c);
    }

    if (statusFilter === "pending" || statusFilter === "complete") {
      indexed.sort((a, b) => {
        const ar = recency(a.c);
        const br = recency(b.c);
        if (ar !== br) return br - ar;
        return a.idx - b.idx;
      });
      return indexed.map((x) => x.c);
    }

    return withSearch;
  }, [cards, completedSearchQuery, searchQuery, statusFilter]);

  const customerStacks = useMemo(() => {
    const normalizeKey = (raw: unknown) => String(raw || "").trim().replace(/\s+/g, " ");
    const keyFor = (q: any) => {
      const customer = normalizeKey((q as any).customerName);
      return customer ? customer.toLowerCase() : "";
    };

    const displayNameFor = (q: any) => {
      const customer = normalizeKey((q as any).customerName);
      return customer || "(No customer name)";
    };

    const order: Array<{ key: string; label: string; cards: any[] }> = [];
    const byKey = new Map<string, { key: string; label: string; cards: any[] }>();
    for (const c of filteredCards as any[]) {
      const key = keyFor(c) || `__no_customer__:${String((c as any).id || "")}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.cards.push(c);
        continue;
      }
      const entry = { key, label: displayNameFor(c), cards: [c] };
      byKey.set(key, entry);
      order.push(entry);
    }
    return order;
  }, [filteredCards]);

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 136px)" }}>
      {diagEnabled ? (
        <div className="px-4 pt-3">
          <div className="max-w-[980px] mx-auto">
            <div className="rounded-2xl border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] px-3 py-2 text-[12px] text-[rgba(255,255,255,.88)]">
              <div className="font-black">Diagnostics</div>
              <div className="mt-1 grid gap-1">
                <div>supabaseConfigured: {String(Boolean(remoteDiag?.supabaseConfigured ?? supabaseConfigured))}</div>
                <div>workspaceId: {String(remoteDiag?.workspaceId ?? resolveWorkspaceId() ?? "")}</div>
                {remoteDiag?.quotesEntries ? (
                  <div>
                    quotes_entries: {remoteDiag.quotesEntries.ok ? "ok" : "fail"} ({remoteDiag.quotesEntries.count})
                    {remoteDiag.quotesEntries.error ? ` — ${remoteDiag.quotesEntries.error}` : ""}
                  </div>
                ) : null}
                {remoteDiag?.draftsFallback ? (
                  <div>
                    drafts fallback: {remoteDiag.draftsFallback.ok ? "ok" : "fail"} ({remoteDiag.draftsFallback.count})
                    {remoteDiag.draftsFallback.error ? ` — ${remoteDiag.draftsFallback.error}` : ""}
                  </div>
                ) : null}
                {remoteDiag?.jobTasks ? (
                  <div>
                    job_tasks: {remoteDiag.jobTasks.ok ? "ok" : "fail"} ({remoteDiag.jobTasks.count})
                    {remoteDiag.jobTasks.error ? ` — ${remoteDiag.jobTasks.error}` : ""}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {scheduleForId ? (
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
              setScheduleForId(null);
              setScheduleDate("");
              setScheduleTime("");
              setScheduleAssignee("");
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
                <div className="text-sm font-black">Schedule estimate</div>
                <SecondaryButton
                  onClick={() => {
                    setScheduleForId(null);
                    setScheduleDate("");
                    setScheduleTime("");
                    setScheduleAssignee("");
                  }}
                >
                  Close
                </SecondaryButton>
              </div>

              <div className="mt-3 grid gap-2">
                <div className="text-[11px] text-[var(--muted)]">Date &amp; time</div>
                <div className="grid gap-2 sm:grid-cols-2 items-end">
                  <div className="min-w-0">
                    <div className="text-[11px] text-[var(--muted)] mb-1">Date</div>
                    <input
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="block box-border w-full max-w-full min-w-0 rounded-full px-2.5 py-1.5 text-[12px] bg-[rgba(255,255,255,.10)] border border-[rgba(255,255,255,.16)] outline-none"
                      style={{ minWidth: 0, WebkitAppearance: "none", appearance: "none" }}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] text-[var(--muted)] mb-1">Time</div>
                    <input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="block box-border w-full max-w-full min-w-0 rounded-full px-2.5 py-1.5 text-[12px] bg-[rgba(255,255,255,.10)] border border-[rgba(255,255,255,.16)] outline-none"
                      style={{ minWidth: 0, WebkitAppearance: "none", appearance: "none" }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-2">
                <div className="text-[11px] text-[var(--muted)]">Assigned to</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-no-swipe="true"
                    onClick={() => setScheduleAssignee("nate")}
                    className={
                      "rounded-full border px-3 py-2 text-[12px] font-black transition " +
                      (scheduleAssignee === "nate"
                        ? "border-[rgba(64,156,255,.65)] bg-[rgba(64,156,255,.22)]"
                        : "border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.10)] hover:bg-[rgba(255,255,255,.14)]")
                    }
                  >
                    Nate
                  </button>
                  <button
                    type="button"
                    data-no-swipe="true"
                    onClick={() => setScheduleAssignee("cam")}
                    className={
                      "rounded-full border px-3 py-2 text-[12px] font-black transition " +
                      (scheduleAssignee === "cam"
                        ? "border-[rgba(255,214,10,.70)] bg-[rgba(255,214,10,.22)]"
                        : "border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.10)] hover:bg-[rgba(255,255,255,.14)]")
                    }
                  >
                    Cam
                  </button>
                  <button
                    type="button"
                    data-no-swipe="true"
                    onClick={() => setScheduleAssignee("")}
                    className={
                      "rounded-full border px-3 py-2 text-[12px] font-black transition " +
                      (!scheduleAssignee
                        ? "border-[rgba(255,255,255,.28)] bg-[rgba(255,255,255,.14)]"
                        : "border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.10)] hover:bg-[rgba(255,255,255,.14)]")
                    }
                    title="Unassigned"
                  >
                    —
                  </button>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <SecondaryButton
                  onClick={() => {
                    setDraftScheduledAt(scheduleForId, null);
                    if (scheduleForId) setDraftEstimateAssignee(scheduleForId, null);
                    setScheduleForId(null);
                    setScheduleDate("");
                    setScheduleTime("");
                    setScheduleAssignee("");
                  }}
                >
                  Clear
                </SecondaryButton>
                <PrimaryButton
                  onClick={() => {
                    const id = scheduleForId;
                    if (!id) return;
                    const d = String(scheduleDate || "").trim();
                    const t = String(scheduleTime || "").trim();
                    if (!d || !t) return;
                    // Treat date+time as local time; store as ISO.
                    const dt = new Date(`${d}T${t}`);
                    if (!Number.isFinite(dt.getTime())) return;
                    setDraftScheduledAt(id, dt.toISOString());
                    setDraftEstimateAssignee(id, (scheduleAssignee || null) as any);
                    setScheduleForId(null);
                    setScheduleDate("");
                    setScheduleTime("");
                    setScheduleAssignee("");
                  }}
                >
                  Save
                </PrimaryButton>
              </div>
            </GlassCard>
          </div>
        </div>
      ) : null}

      <SectionTitle
        title="Recent quotes"
        right={
          <div className="flex items-center gap-2">
            <SecondaryButton
              onClick={() => {
                try {
                  notifyDraftsChanged();
                } catch {
                }
              }}
            >
              Refresh
            </SecondaryButton>
          </div>
        }
      />
      <GlassCard className="p-4">
        <div className="mb-3">
          <input
            value={statusFilter === "complete" ? completedSearchQuery : searchQuery}
            onChange={(e) => (statusFilter === "complete" ? setCompletedSearchQuery(e.target.value) : setSearchQuery(e.target.value))}
            placeholder={statusFilter === "complete" ? "Search completed…" : "Search quotes…"}
            className="block box-border w-full max-w-full min-w-0 rounded-full px-3 py-2 text-[13px] bg-[rgba(255,255,255,.10)] border border-[rgba(255,255,255,.16)] outline-none"
            style={{ minWidth: 0, WebkitAppearance: "none", appearance: "none" }}
          />
        </div>
        <div className="mt-1 grid gap-2">
          {filteredCards.length === 0 ? (
            <div className="text-sm text-[var(--muted)]">No saved quotes yet. Save an estimate to see it here.</div>
          ) : null}
          {customerStacks.map((stack) => {
            const expanded = Boolean(expandedCustomerStacks[stack.key]);
            const hasScheduled = stack.cards.some((c) => Boolean(String((c as any).scheduledAt || "").trim()));
            const hasIncompleteTasks = stack.cards.some((c) => Boolean((c as any).hasIncompleteTasks));
            const firstUnscheduledEstimate = stack.cards.find(
              (c) => (c as any).status === "estimate" && !String((c as any).scheduledAt || "").trim()
            ) as any;
            const firstPending = stack.cards.find((c) => (c as any).status === "pending") as any;
            const stackCallTel = normalizePhone(String((firstPending as any)?.phoneNumber || (firstUnscheduledEstimate as any)?.phoneNumber || ""));
            const stackCustomerName = String(
              (firstPending as any)?.customerName || (firstUnscheduledEstimate as any)?.customerName || stack.label || ""
            ).trim();
            const stackFirstName = (() => {
              const cleaned = String(stackCustomerName || "").replace(/,+/g, " ").trim();
              if (!cleaned) return "";
              return cleaned.split(/\s+/g).filter(Boolean)[0] || "";
            })();
            const stackSmsBody = stackFirstName ? `Hi ${stackFirstName}` : "Hi";
            const stackSmsHref = `sms:${stackCallTel}?&body=${encodeURIComponent(stackSmsBody)}`;
            const stackStatus = stack.cards.some((c) => (c as any).status === "sold")
              ? "sold"
              : stack.cards.some((c) => (c as any).status === "pending")
                ? "pending"
                : stack.cards.some((c) => (c as any).status === "estimate")
                  ? "estimate"
                  : (stack.cards[0] as any)?.status;

            const soldTopCard = stack.cards.find((c) => (c as any).status === "sold");
            const stackStartDate = (() => {
              // Show the same date field that jobs typically use across the app: installDate (yyyy-mm-dd).
              // Do not derive from scheduledAt here to avoid timezone-based day shifts.
              const iso = String((soldTopCard as any)?.installDate || "").trim();
              if (!iso) return "";
              return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
            })();

            return (
              <div key={stack.key} className="grid gap-2">
                <button
                  type="button"
                  data-no-swipe="true"
                  onClick={() =>
                    setExpandedCustomerStacks((prev) => ({
                      ...prev,
                      [stack.key]: !Boolean(prev[stack.key])
                    }))
                  }
                  className={
                    "w-full text-left rounded-xl border px-3 py-3 transition hover:bg-[rgba(255,255,255,.08)] " +
                    statusCardClass(stackStatus as any)
                  }
                >
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold truncate">{stack.label}</div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {stack.cards.length} quote{stack.cards.length === 1 ? "" : "s"}
                        {expanded ? " · Tap to collapse" : " · Tap to expand"}
                      </div>
                    </div>

                    <div className="flex items-center justify-center">
                      {statusFilter === "sold" && stackStatus === "sold" && stackStartDate ? (
                        <div className="rounded-full border border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.10)] px-2 py-1 text-[11px] font-extrabold text-white whitespace-nowrap">
                          {stackStartDate}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      {stackStatus === "sold" && hasIncompleteTasks ? (
                        <div className="relative" aria-label="Incomplete tasks" title="Incomplete tasks">
                          <span className="h-3 w-3 rounded-full bg-[rgba(255,80,80,.95)] animate-pulse block" />
                        </div>
                      ) : null}
                      {(stackStatus === "estimate" && !hasScheduled) || stackStatus === "pending" ? (
                        <button
                          type="button"
                          data-no-swipe="true"
                          data-keep-open="true"
                          disabled={!stackCallTel}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            bumpSuppressNav();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            bumpSuppressNav();
                            if (!stackCallTel) return;
                            window.location.href = `tel:${stackCallTel}`;
                          }}
                          className={
                            "rounded-full border px-3 py-1 text-[11px] font-extrabold whitespace-nowrap " +
                            (stackCallTel
                              ? "bg-[rgba(31,200,120,.22)] border-[rgba(31,200,120,.40)] text-white"
                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.10)] text-[rgba(255,255,255,.35)]")
                          }
                        >
                          Call
                        </button>
                      ) : null}
                      {stackStatus === "estimate" && !hasScheduled ? (
                        <button
                          type="button"
                          data-no-swipe="true"
                          data-keep-open="true"
                          disabled={!stackCallTel}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            bumpSuppressNav();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            bumpSuppressNav();
                            if (!stackCallTel) return;
                            window.location.href = stackSmsHref;
                          }}
                          className={
                            "rounded-full border px-3 py-1 text-[11px] font-extrabold whitespace-nowrap " +
                            (stackCallTel
                              ? "bg-[rgba(60,140,255,.22)] border-[rgba(60,140,255,.42)] text-white"
                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.10)] text-[rgba(255,255,255,.35)]")
                          }
                        >
                          Message
                        </button>
                      ) : null}
                      {hasScheduled && stackStatus !== "pending" ? (
                        <div className="rounded-full border border-[rgba(255,80,80,.55)] bg-[rgba(255,80,80,.30)] px-2 py-1 text-[11px] font-extrabold text-white whitespace-nowrap">
                          Scheduled
                        </div>
                      ) : null}
                    </div>
                  </div>
                </button>

                {expanded
                  ? stack.cards.map((q) => (
                    <Link
                      key={q.id}
                      href={`/quotes/${encodeURIComponent(q.id)}`}
                      onClick={(e) => {
                        const t = e.target as HTMLElement | null;
                        if (t && typeof (t as any).closest === "function" && t.closest("[data-keep-open='true']")) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        if (openStatusId === q.id || confirmDeleteId === q.id || openStatusId != null || confirmDeleteId != null) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        if (Date.now() < suppressNavUntilRef.current) {
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }}
                      className={
                        "block rounded-xl border px-3 py-3 hover:bg-[rgba(255,255,255,.08)] transition " +
                        statusCardClass(q.status) +
                        (deletingId === q.id
                          ? " !border-[rgba(255,80,80,.70)] !bg-[linear-gradient(180deg,rgba(255,80,80,.22),rgba(255,80,80,.10))]"
                          : "")
                      }
                    >
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 mb-2">
                <div className="relative">
                  <button
                    type="button"
                    data-no-swipe="true"
                    data-keep-open="true"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      bumpSuppressNav();
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      bumpSuppressNav();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      bumpSuppressNav();
                      setConfirmDeleteId(null);
                      setOpenStatusId((cur) => (cur === q.id ? null : q.id));
                    }}
                    className={
                      "relative z-30 rounded-full border px-2 py-1 text-[11px] font-extrabold text-white " +
                      statusPillClass(q.status)
                    }
                  >
                    {statusLabel(q.status)}
                  </button>

                  {openStatusId === q.id ? (
                    <div
                      className="absolute left-0 top-[calc(100%+8px)] z-40 rounded-2xl border border-[rgba(255,255,255,.14)] bg-[rgba(20,30,24,.85)] shadow-glass backdrop-blur-ios p-2 grid gap-2 min-w-[160px]"
                      data-no-swipe="true"
                      data-keep-open="true"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        bumpSuppressNav();
                      }}
                      onPointerUp={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        bumpSuppressNav();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      {(q.status === "complete"
                        ? (["sold"] as DraftEntry["status"][])
                        : (["estimate", "pending", "sold", "complete", "void"] as DraftEntry["status"][])
                      )
                        .filter((s) => (q.status === "complete" ? statusFilter === "complete" : true))
                        .map((s) => (
                        <button
                          key={s}
                          type="button"
                          data-no-swipe="true"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            bumpSuppressNav();
                            setDraftStatus(q.id, s);
                            setOpenStatusId(null);
                          }}
                          onPointerUp={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            bumpSuppressNav();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onMouseUp={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            bumpSuppressNav();
                          }}
                          className={
                            "w-full text-left rounded-xl border px-3 py-2 text-[12px] font-extrabold text-white " +
                            statusPillClass(s) +
                            (q.status === s ? " opacity-100" : " opacity-90")
                          }
                        >
                          {statusLabel(s)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="min-w-0 text-center">
                  <div className="text-[14px] font-extrabold truncate">
                    {String((q as any).estimateTitle || "").trim() ? String((q as any).estimateTitle || "") : q.title}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  {q.status === "estimate" ? (
                    <button
                      type="button"
                      data-no-swipe="true"
                      data-keep-open="true"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        bumpSuppressNav();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        bumpSuppressNav();
                        setOpenStatusId(null);
                        setConfirmDeleteId(null);
                        const store = readDraftStore();
                        const cur = store[q.id] as any;
                        const fromState = drafts.find((d) => d.id === q.id) as any;
                        const existing = String((q as any)?.scheduledAt || fromState?.scheduledAt || cur?.scheduledAt || "");
                        const existingAssignee = String(
                          (q as any)?.estimateAssignee || fromState?.estimateAssignee || cur?.estimateAssignee || ""
                        );
                        setScheduleForId(q.id);
                        const prefill = scheduledAtToPrefill(existing);
                        if (prefill) {
                          setScheduleDate(prefill.date);
                          setScheduleTime(prefill.time);
                        } else {
                          setScheduleDate(defaultScheduleDateValue());
                          setScheduleTime(defaultScheduleTimeValue());
                        }
                        setScheduleAssignee(existingAssignee === "nate" || existingAssignee === "cam" ? (existingAssignee as any) : "");
                      }}
                      className={
                        "rounded-full border px-2.5 py-1 text-[11px] font-black hover:bg-[rgba(255,255,255,.14)]"
                      }
                    >
                      {q.scheduledAt ? "Scheduled" : "Schedule"}
                    </button>
                  ) : null}

                  {Number((q as any).preInstallPhotoCount) > 0 ? (
                    <div className="rounded-full border border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.10)] px-2 py-1 text-[11px] font-extrabold text-[rgba(255,255,255,.90)] whitespace-nowrap">
                      📎 {Number((q as any).preInstallPhotoCount) || 0}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    data-no-swipe="true"
                    data-keep-open="true"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      bumpSuppressNav();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      bumpSuppressNav();
                      setOpenStatusId(null);
                      setConfirmDeleteId(null);
                      window.location.href = `/estimates/contract?draft=${encodeURIComponent(q.id)}`;
                    }}
                    className="rounded-full border px-2 py-1 text-[11px] font-extrabold bg-[rgba(255,255,255,.10)] border-[rgba(255,255,255,.16)] text-[rgba(255,255,255,.90)]"
                  >
                    Contract
                  </button>

                  <button
                    type="button"
                    data-no-swipe="true"
                    data-keep-open="true"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      bumpSuppressNav();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      bumpSuppressNav();
                      setOpenStatusId(null);
                      if (confirmDeleteId === q.id) {
                        setConfirmDeleteId(null);
                        setDeletingId(q.id);
                        window.setTimeout(() => {
                          deleteDraft(q.id);
                        }, 220);
                      } else {
                        setConfirmDeleteId(q.id);
                      }
                    }}
                    className={
                      "rounded-full border px-2 py-1 text-[11px] font-extrabold " +
                      (confirmDeleteId === q.id
                        ? "bg-[rgba(255,80,80,.30)] border-[rgba(255,80,80,.55)] text-white"
                        : "bg-[rgba(255,255,255,.10)] border-[rgba(255,255,255,.16)] text-[rgba(255,255,255,.85)]")
                    }
                  >
                    {confirmDeleteId === q.id ? "Confirm" : "Delete"}
                  </button>
                </div>
              </div>

              {q.style || (q as any).material ? (
                <div className="text-[15px] font-black leading-tight">
                  {String(
                    [(q as any).styleLabel ?? q.style, (q as any).material].filter((v) => Boolean(String(v || "").trim())).join(" · ")
                  )}
                </div>
              ) : null}

              <div className="flex items-center justify-end">
                <div className="text-sm font-black whitespace-nowrap">{money(q.due)}</div>
              </div>
              {String((q as any).layoutSrc || "") ? (
                <div className="mt-2">
                  <button
                    type="button"
                    data-no-swipe="true"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      bumpSuppressNav();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      bumpSuppressNav();
                      if (Date.now() < suppressNavUntilRef.current) return;
                      setLayoutViewerSrc(String((q as any).layoutSrc || ""));
                    }}
                    className={
                      "block w-full text-left " +
                      (openStatusId === q.id ? "pointer-events-none" : "")
                    }
                    aria-label="Open fence layout"
                    title="Fence layout"
                  >
                    <div className="relative w-full h-[120px] rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]">
                      <img src={String((q as any).layoutSrc || "")} alt="Fence layout" className="absolute inset-0 w-full h-full object-cover" />
                    </div>
                  </button>
                </div>
              ) : null}
              <div className="text-[11px] text-[var(--muted)]">
                Materials &amp; expenses {money((q as any).materialsAndExpensesTotal)}
                {` · Additional fees ${money((q as any).additionalFeesTotal)}`}
                {` · Fence removal ${money((q as any).removalTotal)}`}
                {` · Labor ${money((q as any).laborBaseTotal)}`}
                {` · Total ${money(q.total)}`}
                {typeof (q as any).roundedHalfDays === "number" && typeof (q as any).spanDays === "number"
                  ? (Number((q as any).spanDays) > 0
                      ? ` · Install ${(q as any).roundedHalfDays}d (${(q as any).spanDays} day${(q as any).spanDays === 1 ? "" : "s"})`
                      : "")
                  : ""}
              </div>
              {q.status !== "pending" && String((q as any).scheduledAt || "") ? (
                <div className="text-[11px] text-[var(--muted)]">Scheduled {toDateLocalValue(String((q as any).scheduledAt || ""))}</div>
              ) : null}
                    </Link>
                  ))
                  : null}
              </div>
            );
          })}
        </div>
      </GlassCard>

      {portalReady
        ? createPortal(
            layoutViewerSrc ? (
              <div className="fixed inset-0 z-[80] grid place-items-center p-3" data-no-swipe="true">
                <div
                  className="absolute inset-0 bg-[rgba(0,0,0,.75)]"
                  onClick={() => setLayoutViewerSrc(null)}
                />
                <div
                  className="relative w-full max-w-[980px]"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <GlassCard className="p-3 overflow-hidden">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-black truncate">Fence layout</div>
                      <SecondaryButton data-no-swipe="true" onClick={() => setLayoutViewerSrc(null)}>
                        Close
                      </SecondaryButton>
                    </div>
                    <div className="mt-2 relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]">
                      <img src={layoutViewerSrc} alt="Fence layout" className="absolute inset-0 w-full h-full object-contain" />
                    </div>
                  </GlassCard>
                </div>
              </div>
            ) : null,
            document.body
          )
        : null}

      {portalReady
        ? createPortal(
            <div className="fixed bottom-0 left-0 right-0 z-50 transform-gpu will-change-transform isolate" aria-label="Quotes actions">
              <div className="mx-auto max-w-[980px] px-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
                <div className="backdrop-blur-ios bg-[rgba(20,30,24,.55)] border border-[var(--stroke)] shadow-glass rounded-2xl p-3">
                  <div className="mx-auto w-full max-w-[560px] flex items-center justify-between gap-3">
                    <Link href="/estimates" className="shrink-0">
                      <PrimaryButton>New Quote</PrimaryButton>
                    </Link>

                    <Link href="/tasks" className="shrink-0">
                      <div className="relative">
                        <PrimaryButton
                          className={
                            tasksNeedAttention
                              ? "border-[rgba(255,80,80,.55)] bg-[rgba(255,80,80,.22)]"
                              : undefined
                          }
                        >
                          Tasks
                        </PrimaryButton>
                        {tasksNeedAttention ? (
                          <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[rgba(255,80,80,.90)] animate-pulse" />
                        ) : null}
                      </div>
                    </Link>

                    <button
                      type="button"
                      data-no-swipe="true"
                      onClick={() => {
                        const order: Array<DraftEntry["status"] | "all"> = ["all", "estimate", "pending", "sold", "complete", "void"];
                        const idx = order.indexOf(statusFilter);
                        const next = order[(idx + 1) % order.length];
                        setStatusFilter(next);
                      }}
                      className={
                        "rounded-full border px-3 py-2 text-[12px] font-extrabold text-white min-w-[108px] " +
                        filterPillClass(statusFilter)
                      }
                    >
                      {filterLabel(statusFilter)}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
