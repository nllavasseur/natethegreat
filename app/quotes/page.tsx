"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import { money } from "@/lib/money";
import { computeMaterialsAndExpensesTotal, computeTotals } from "@/lib/totals";
import { deleteDraftRemote, fetchDrafts, fetchQuotesEntries, upsertDraft } from "@/lib/draftsStore";
import { setStatusFromQuotes } from "@/lib/queuePipeline";
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
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
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

  function setDraftScheduledAt(id: string, scheduledAt: string | null) {
    try {
      const store = readDraftStore();
      const existing = store[id] ?? drafts.find((d) => d.id === id);
      const nextStatus =
        scheduledAt && String(scheduledAt).trim() !== ""
          ? "estimate"
          : (existing as any)?.status;
      if (!existing) {
        store[id] = {
          id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          scheduledAt: scheduledAt && String(scheduledAt).trim() !== "" ? scheduledAt : undefined,
          calendarHidden: false,
          ...(nextStatus ? { status: nextStatus } : {})
        };
      } else {
        store[id] = {
          ...existing,
          scheduledAt: scheduledAt && String(scheduledAt).trim() !== "" ? scheduledAt : undefined,
          updatedAt: Date.now(),
          calendarHidden: false,
          ...(nextStatus ? { status: nextStatus } : {})
        };
      }
      store[id] = {
        ...store[id],
        scheduledAt: scheduledAt && String(scheduledAt).trim() !== "" ? scheduledAt : undefined,
        updatedAt: Date.now()
      };
      window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
      try {
        void upsertDraft({ id, data: store[id] });
      } catch {
      }
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                scheduledAt: scheduledAt && String(scheduledAt).trim() !== "" ? scheduledAt : undefined,
                updatedAt: Date.now(),
                calendarHidden: false,
                ...(nextStatus ? { status: nextStatus as any } : {})
              }
            : d
        )
      );
      notifyDraftsChanged();
    } catch {
      // ignore
    }
  }

  function setDraftEstimateAssignee(id: string, assignee: DraftEntry["estimateAssignee"] | null) {
    try {
      const store = readDraftStore();
      const existing = store[id] ?? drafts.find((d) => d.id === id);
      if (!existing) return;
      store[id] = {
        ...existing,
        estimateAssignee: assignee ?? undefined,
        updatedAt: Date.now()
      };
      window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
      try {
        void upsertDraft({ id, data: store[id] });
      } catch {
      }
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                estimateAssignee: assignee ?? undefined,
                updatedAt: Date.now()
              }
            : d
        )
      );
      notifyDraftsChanged();
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
      const tombstones = readDeletedQuoteTombstones();
      try {
        const cached = readQuotesDraftsCache();
        if (!cancelled && Array.isArray(cached) && cached.length) {
          setDrafts(cached.filter((d) => !tombstones[String((d as any)?.id || "")]));
        }
      } catch {
      }

      window.setTimeout(() => {
        if (cancelled) return;
        try {
          const localStore = readDraftStore();
          const localList = Object.values(localStore)
            .map((d) => toQuotesDraftLite({ ...(d as any) } as any))
            .filter((d) => !tombstones[String((d as any)?.id || "")]);
          if (!cancelled) setDrafts(localList);
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
      let usedSnapshot = false;

      try {
        const snap = await withTimeout(fetchQuotesEntries({ limit: 900 }) as any, 3500);
        if ((snap as any)?.ok && Array.isArray((snap as any)?.drafts)) {
          remoteListRaw = ((snap as any).drafts as DraftEntry[]) || [];
          usedSnapshot = true;
        }
      } catch {
      }

      if (!usedSnapshot) {
        const remote = await fetchDrafts({ limit: 450 });
        remoteListRaw = remote.ok ? (remote.drafts as DraftEntry[]) : [];
      }

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
      if (!cancelled) setDrafts(mergedLite);
      try {
        writeQuotesDraftsCache(mergedLite);
      } catch {
      }

      if (usedSnapshot) {
        void (async () => {
          try {
            const remoteAll = await withTimeout(fetchDrafts({ limit: 1800 }) as any, 12000);
            if (!(remoteAll as any)?.ok) return;
            const remoteAllListRaw = (((remoteAll as any).drafts as DraftEntry[]) || []).filter(
              (d) => !tombstones[String((d as any)?.id || "")]
            );

            const latestStore = readDraftStore();
            const latestLocalList = Object.values(latestStore)
              .map((d) => ({ ...d }))
              .filter((d) => !tombstones[String((d as any)?.id || "")]);

            const byIdAll = new Map<string, DraftEntry>();
            for (const d of Array.isArray(latestLocalList) ? latestLocalList : []) {
              const id = String((d as any)?.id || "");
              if (!id) continue;
              byIdAll.set(id, d as any);
            }
            for (const d of Array.isArray(remoteAllListRaw) ? remoteAllListRaw : []) {
              const id = String((d as any)?.id || "");
              if (!id) continue;
              const prev = byIdAll.get(id);
              if (!prev) {
                byIdAll.set(id, d as any);
                continue;
              }

              if (getTs(d) > getTs(prev)) {
                const mergedNext: DraftEntry = { ...(prev as any), ...(d as any) } as any;
                if ((d as any).jobTasks == null && (prev as any).jobTasks != null) (mergedNext as any).jobTasks = (prev as any).jobTasks;
                if ((d as any).jobTaskSnooze == null && (prev as any).jobTaskSnooze != null) (mergedNext as any).jobTaskSnooze = (prev as any).jobTaskSnooze;
                if ((d as any).jobTaskLabels == null && (prev as any).jobTaskLabels != null) (mergedNext as any).jobTaskLabels = (prev as any).jobTaskLabels;
                if ((d as any).jobTaskHidden == null && (prev as any).jobTaskHidden != null) (mergedNext as any).jobTaskHidden = (prev as any).jobTaskHidden;
                if ((d as any).jobCustomTasks == null && (prev as any).jobCustomTasks != null) (mergedNext as any).jobCustomTasks = (prev as any).jobCustomTasks;
                byIdAll.set(id, mergedNext);
              }
            }

            const mergedAll = Array.from(byIdAll.values()).sort((a, b) => getTs(b) - getTs(a));
            const mergedAllLite = (Array.isArray(mergedAll) ? mergedAll : [])
              .filter((d) => !tombstones[String((d as any)?.id || "")])
              .map((d) => toQuotesDraftLite({ ...(d as any) } as any));

            if (!cancelled) setDrafts(mergedAllLite);
            try {
              writeQuotesDraftsCache(mergedAllLite);
            } catch {
            }
          } catch {
          }
        })();
      }
    };

    void load();

    const onChanged = () => {
      void load();
    };
    window.addEventListener("vf-drafts-changed", onChanged);
    return () => {
      cancelled = true;
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
      void setStatusFromQuotes({ id, status, draftSnapshot: existing as any });
      setDrafts((prev) =>
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
      );
    } catch {
      // ignore
    }
  }

  function deleteDraft(id: string) {
    try {
      try {
        const prevTombstones = readDeletedQuoteTombstones();
        writeDeletedQuoteTombstones({ ...prevTombstones, [String(id)]: Date.now() });
      } catch {
      }
      const store = readDraftStore();
      if (store[id]) {
        const next = { ...store };
        delete next[id];
        window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(next));
      }
      try {
        void deleteDraftRemote({ id });
      } catch {
      }
      setDrafts((prev) => prev.filter((d) => d.id !== id));
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
      if (!store[id]) return;
      store[id] = { ...store[id], startDate, installDate: startDate, calendarHidden: false };
      window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
      try {
        void upsertDraft({ id, data: store[id] });
      } catch {
      }
      setDrafts((prev) =>
        prev.map((d) => (d.id === id ? { ...d, startDate, installDate: startDate, calendarHidden: false } : d))
      );
      notifyDraftsChanged();
    } catch {
      // ignore
    }
  }

  function removeFromCalendar(id: string) {
    try {
      const store = readDraftStore();
      if (!store[id]) return;
      store[id] = { ...store[id], startDate: undefined, installDate: undefined, calendarHidden: true };
      window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
      try {
        void upsertDraft({ id, data: store[id] });
      } catch {
      }
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, startDate: undefined, installDate: undefined, calendarHidden: true } : d)));
      notifyDraftsChanged();
    } catch {
      // ignore
    }
  }

  function statusLabel(s: DraftEntry["status"]) {
    if (s === "pending") return "Pending";
    if (s === "sold") return "Sold";
    if (s === "complete") return "Complete";
    if (s === "void") return "Void";
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
      const removalTotal = round2(removalLf > 0 ? removalLf * 6 : 0);

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

      const title = String(d.title || d.customerName || d.projectAddress || d.selectedStyle?.name || "Quote");
      const style = String(d.selectedStyle?.name || "");
      const material = (() => {
        const md = (d as any).materialsDetails as any;
        if (!md || typeof md !== "object") return "";
        if (style === "Horizontal Cedar") return String(md.horizontalCedarBoardMaterial || "");
        return String(md.woodType || "");
      })();
      const status = (d.status ?? "estimate") as DraftEntry["status"];
      const phoneNumber = String((d as any).phoneNumber || "");
      const startDate = String((d as any).startDate || d.installDate || "");
      const laborDays = Number((d as any).laborDays);
      const roundedHalfDays = computeRoundedHalfDays(laborDays);
      const spanDays = computeSpanDays(laborDays);
      const endDate = startDate && spanDays > 0 ? addDaysIso(startDate, spanDays - 1) : "";
      const preInstallPhotoCount = normalizePreInstallPhotos((d as any).preInstallPhotos).length;
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
        style,
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
    const byStatus = statusFilter === "all"
      ? cards.filter((c) => (c.status ?? "estimate") !== "complete")
      : cards.filter((c) => (c.status ?? "estimate") === statusFilter);

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

    if (statusFilter === "sold") {
      const indexed = withSearch.map((c, idx) => ({ c, idx }));
      indexed.sort((a, b) => {
        const ar = Number((a.c as any).queueRank ?? Number.POSITIVE_INFINITY);
        const br = Number((b.c as any).queueRank ?? Number.POSITIVE_INFINITY);
        const aRank = Number.isFinite(ar) ? ar : Number.POSITIVE_INFINITY;
        const bRank = Number.isFinite(br) ? br : Number.POSITIVE_INFINITY;
        if (aRank !== bRank) return aRank - bRank;

        const au = Number((a.c as any).updatedAt ?? (a.c as any).createdAt ?? 0);
        const bu = Number((b.c as any).updatedAt ?? (b.c as any).createdAt ?? 0);
        const aTime = Number.isFinite(au) ? au : 0;
        const bTime = Number.isFinite(bu) ? bu : 0;
        if (aTime !== bTime) return aTime - bTime;

        return a.idx - b.idx;
      });
      return indexed.map((x) => x.c);
    }

    if (statusFilter !== "estimate") return withSearch;

    const indexed = withSearch.map((c, idx) => ({ c, idx }));
    const parseMs = (iso: string) => {
      if (!iso) return Number.POSITIVE_INFINITY;
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
    };
    indexed.sort((a, b) => {
      const am = parseMs(String((a.c as any).scheduledAt || ""));
      const bm = parseMs(String((b.c as any).scheduledAt || ""));
      if (am !== bm) return am - bm;
      return a.idx - b.idx;
    });
    return indexed.map((x) => x.c);
  }, [cards, completedSearchQuery, searchQuery, statusFilter]);

  const customerStacks = useMemo(() => {
    const normalizeKey = (raw: unknown) => String(raw || "").trim().replace(/\s+/g, " ");
    const keyFor = (q: any) => {
      const name = normalizeKey((q as any).title);
      const customer = normalizeKey((q as any).customerName);
      const primary = customer || name;
      return primary ? primary.toLowerCase() : "";
    };

    const displayNameFor = (q: any) => {
      const customer = normalizeKey((q as any).customerName);
      const name = normalizeKey((q as any).title);
      return customer || name || "(No customer name)";
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

      <SectionTitle title="Recent quotes" />
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
              <div className="flex items-center justify-between gap-2 mb-2">
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

                {q.status === "estimate" ? (
                  <div className="flex-1 flex justify-center">
                    <div className="flex items-center justify-center gap-2">
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
                          const existing = String(cur?.scheduledAt || fromState?.scheduledAt || (q as any)?.scheduledAt || "");
                          const existingAssignee = String(
                            cur?.estimateAssignee || fromState?.estimateAssignee || (q as any)?.estimateAssignee || ""
                          );
                          setScheduleForId(q.id);
                          if (existing) {
                            setScheduleDate(toDateLocalValue(existing));
                            setScheduleTime(toTimeLocalValue(existing));
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
                    </div>
                  </div>
                ) : (
                  <div className="flex-1" />
                )}

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

              {q.style || (q as any).material ? (
                <div className="text-[15px] font-black leading-tight">
                  {String(
                    [q.style, (q as any).material].filter((v) => Boolean(String(v || "").trim())).join(" · ")
                  )}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-extrabold truncate">{q.title}</div>
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
            <div
              className="fixed left-0 right-0 z-50 px-4"
              style={{ bottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
            >
              <div className="mx-auto max-w-[980px]">
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
