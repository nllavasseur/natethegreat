"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import { money } from "@/lib/money";
import { computeTotals } from "@/lib/totals";
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
  segments?: Array<{ length: number; removed: boolean }>;
  items?: QuoteItem[];
  status?: "estimate" | "pending" | "sold" | "void";
  scheduledAt?: string;
  installDate?: string;
  startDate?: string;
  laborDays?: number;
  calendarHidden?: boolean;
  preInstallPhotos?: unknown;
};

function normalizePreInstallPhotos(input: unknown) {
  if (!Array.isArray(input)) return [] as Array<{ src: string; note: string; createdAt: number }>;

  const out: Array<{ src: string; note: string; createdAt: number }> = [];
  for (const v of input) {
    if (typeof v === "string") {
      if (!v.startsWith("data:")) continue;
      out.push({ src: v, note: "", createdAt: Date.now() });
      continue;
    }
    if (v && typeof v === "object") {
      const src = typeof (v as any).src === "string" ? (v as any).src : "";
      if (!src.startsWith("data:")) continue;
      out.push({
        src,
        note: typeof (v as any).note === "string" ? (v as any).note : "",
        createdAt: Number((v as any).createdAt) || Date.now()
      });
    }
  }
  return out;
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const [suppressNavUntil, setSuppressNavUntil] = useState(0);
  const [scheduleForId, setScheduleForId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string>("");
  const [scheduleTime, setScheduleTime] = useState<string>("");

  function setDraftScheduledAt(id: string, scheduledAt: string | null) {
    try {
      const store = readDraftStore();
      if (!store[id]) return;
      store[id] = {
        ...store[id],
        scheduledAt: scheduledAt && String(scheduledAt).trim() !== "" ? scheduledAt : undefined,
        updatedAt: Date.now()
      };
      window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, scheduledAt: scheduledAt && String(scheduledAt).trim() !== "" ? scheduledAt : undefined, updatedAt: Date.now() }
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

  function notifyDraftsChanged() {
    try {
      window.dispatchEvent(new Event("vf-drafts-changed"));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const store = readDraftStore();
    const list = Object.values(store)
      .map((d) => ({ ...d }))
      .sort((a, b) => (Number(b.updatedAt ?? b.createdAt) || 0) - (Number(a.updatedAt ?? a.createdAt) || 0));
    setDrafts(list);
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

  function setDraftStatus(id: string, status: DraftEntry["status"]) {
    try {
      const store = readDraftStore();
      if (!store[id]) return;
      store[id] = {
        ...store[id],
        status,
        calendarHidden: status === "sold" ? false : status === "void" ? true : store[id].calendarHidden,
        startDate: status === "void" ? undefined : store[id].startDate,
        installDate: status === "void" ? undefined : store[id].installDate
      };
      window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
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
      notifyDraftsChanged();
    } catch {
      // ignore
    }
  }

  function deleteDraft(id: string) {
    try {
      const store = readDraftStore();
      if (!store[id]) return;
      const next = { ...store };
      delete next[id];
      window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(next));
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      setConfirmDeleteId((cur) => (cur === id ? null : cur));
      setDeletingId((cur) => (cur === id ? null : cur));
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
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, startDate: undefined, installDate: undefined, calendarHidden: true } : d)));
      notifyDraftsChanged();
    } catch {
      // ignore
    }
  }

  function statusLabel(s: DraftEntry["status"]) {
    if (s === "pending") return "Pending";
    if (s === "sold") return "Sold";
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
    if (s === "void") {
      return "border-[rgba(255,80,80,.40)] bg-[linear-gradient(180deg,rgba(255,80,80,.22),rgba(255,80,80,.10))]";
    }
    return "border-[rgba(64,156,255,.55)] bg-[linear-gradient(180deg,rgba(64,156,255,.26),rgba(64,156,255,.12))]";
  }

  function statusPillClass(s: DraftEntry["status"]) {
    if (s === "pending") return "bg-[rgba(255,214,10,.22)] border-[rgba(255,214,10,.40)]";
    if (s === "sold") return "bg-[rgba(31,200,120,.22)] border-[rgba(31,200,120,.40)]";
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

  const cards = useMemo(() => {
    return drafts.map((d) => {
      const items = Array.isArray(d.items) ? d.items : [];

      const totals = computeTotals(items, 0, 0, 0);

      const feeNames = new Set(["Disposal", "Delivery", "Equipment Fees"]);
      const materialsSubtotal = items.filter((i) => i.section === "materials").reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
      const materialsFees = items
        .filter((i) => i.section === "materials" && feeNames.has(i.name))
        .reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
      const materialsUsed = (Number(materialsSubtotal) || 0) - materialsFees;
      const additionalServicesSubtotal = items
        .filter((i) => i.section === "additional")
        .reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
      const materialsAndExpensesTotal = Math.round(
        (materialsUsed * 1.08 + materialsFees + (Number(additionalServicesSubtotal) || 0) * 0.2) * 100
      ) / 100;

      const segments = Array.isArray(d.segments) ? d.segments : [];
      const removalLf = segments.filter((s) => Boolean(s.removed)).reduce((sum, s) => sum + (Number(s.length) || 0), 0);
      const removalTotal = Math.round(removalLf * 6 * 100) / 100;

      const laborTotal = Math.round(((Number(totals.laborSubtotal) || 0) + (Number(removalTotal) || 0)) * 100) / 100;
      const total = Math.round(((Number(materialsAndExpensesTotal) || 0) + laborTotal) * 100) / 100;
      const depositTotal = Math.round((Number(materialsAndExpensesTotal) || 0) * 100) / 100;
      const due = Math.max(0, Math.round((total - depositTotal) * 100) / 100);

      const title = String(d.title || d.customerName || d.projectAddress || d.selectedStyle?.name || "Quote");
      const style = String(d.selectedStyle?.name || "");
      const status = (d.status ?? "estimate") as DraftEntry["status"];
      const phoneNumber = String((d as any).phoneNumber || "");
      const startDate = String((d as any).startDate || d.installDate || "");
      const laborDays = Number((d as any).laborDays);
      const roundedHalfDays = computeRoundedHalfDays(laborDays);
      const spanDays = computeSpanDays(laborDays);
      const endDate = startDate && spanDays > 0 ? addDaysIso(startDate, spanDays - 1) : "";
      const preInstallPhotoCount = normalizePreInstallPhotos((d as any).preInstallPhotos).length;

      return {
        id: d.id,
        title,
        style,
        status,
        startDate,
        endDate,
        roundedHalfDays,
        spanDays,
        total,
        due,
        scheduledAt: String((d as any).scheduledAt || ""),
        phoneNumber,
        preInstallPhotoCount
      };
    });
  }, [drafts]);

  const filteredCards = useMemo(() => {
    if (statusFilter === "all") return cards;
    return cards.filter((c) => (c.status ?? "estimate") === statusFilter);
  }, [cards, statusFilter]);

  return (
    <div className="pb-24">
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

              <div className="mt-4 flex items-center justify-between gap-2">
                <SecondaryButton
                  onClick={() => {
                    setDraftScheduledAt(scheduleForId, null);
                    setScheduleForId(null);
                    setScheduleDate("");
                    setScheduleTime("");
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
                    setScheduleForId(null);
                    setScheduleDate("");
                    setScheduleTime("");
                  }}
                >
                  Save
                </PrimaryButton>
              </div>
            </GlassCard>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div />
        <Link href="/estimates">
          <PrimaryButton>New Quote</PrimaryButton>
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-[11px] text-[var(--muted)]">Filter</div>
        <button
          type="button"
          data-no-swipe="true"
          onClick={() => {
            const order: Array<DraftEntry["status"] | "all"> = ["all", "estimate", "pending", "sold", "void"];
            const idx = order.indexOf(statusFilter);
            const next = order[(idx + 1) % order.length];
            setStatusFilter(next);
          }}
          className={
            "rounded-full border px-3 py-2 text-[12px] font-extrabold text-white " +
            filterPillClass(statusFilter)
          }
        >
          {filterLabel(statusFilter)}
        </button>
      </div>

      <SectionTitle title="Recent quotes" />
      <GlassCard className="p-4">
        <div className="mt-1 grid gap-2">
          {filteredCards.length === 0 ? (
            <div className="text-sm text-[var(--muted)]">No saved quotes yet. Save an estimate to see it here.</div>
          ) : null}
          {filteredCards.map((q) => (
            <Link
              key={q.id}
              href={`/quotes/${encodeURIComponent(q.id)}`}
              onClick={(e) => {
                if (Date.now() < suppressNavUntil) {
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
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSuppressNavUntil(Date.now() + 600);
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSuppressNavUntil(Date.now() + 600);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSuppressNavUntil(Date.now() + 600);
                      setConfirmDeleteId(null);
                      setOpenStatusId((cur) => (cur === q.id ? null : q.id));
                    }}
                    className={
                      "rounded-full border px-2 py-1 text-[11px] font-extrabold text-white " +
                      statusPillClass(q.status)
                    }
                  >
                    {statusLabel(q.status)}
                  </button>

                  {openStatusId === q.id ? (
                    <div
                      className="absolute left-0 top-[calc(100%+8px)] z-20 rounded-2xl border border-[rgba(255,255,255,.14)] bg-[rgba(20,30,24,.85)] shadow-glass backdrop-blur-ios p-2 grid gap-2 min-w-[160px]"
                      data-no-swipe="true"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      {(["estimate", "pending", "sold", "void"] as DraftEntry["status"][]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          data-no-swipe="true"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSuppressNavUntil(Date.now() + 600);
                            setDraftStatus(q.id, s);
                            setOpenStatusId(null);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
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
                    <button
                      type="button"
                      data-no-swipe="true"
                      data-keep-open="true"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSuppressNavUntil(Date.now() + 600);
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSuppressNavUntil(Date.now() + 600);
                        setOpenStatusId(null);
                        setConfirmDeleteId(null);
                        const store = readDraftStore();
                        const cur = store[q.id] as any;
                        const existing = String(cur?.scheduledAt || "");
                        setScheduleForId(q.id);
                        if (existing) {
                          setScheduleDate(toDateLocalValue(existing));
                          setScheduleTime(toTimeLocalValue(existing));
                        } else {
                          setScheduleDate(defaultScheduleDateValue());
                          setScheduleTime(defaultScheduleTimeValue());
                        }
                      }}
                      className={
                        "rounded-full border px-3 py-1 text-[11px] font-extrabold " +
                        (q.scheduledAt
                          ? "bg-[rgba(255,80,80,.30)] border-[rgba(255,80,80,.55)] text-white"
                          : "bg-[rgba(255,255,255,.10)] border-[rgba(255,255,255,.16)] text-[rgba(255,255,255,.90)]")
                      }
                    >
                      {q.scheduledAt ? "Scheduled" : "Schedule"}
                    </button>
                  </div>
                ) : q.status === "pending" ? (
                  <div className="flex-1 flex justify-center">
                    <button
                      type="button"
                      data-no-swipe="true"
                      data-keep-open="true"
                      disabled={!normalizePhone((q as any).phoneNumber || "")}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSuppressNavUntil(Date.now() + 600);
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSuppressNavUntil(Date.now() + 600);
                        const tel = normalizePhone((q as any).phoneNumber || "");
                        if (!tel) return;
                        window.location.href = `tel:${tel}`;
                      }}
                      className={
                        "rounded-full border px-3 py-1 text-[11px] font-extrabold " +
                        (normalizePhone((q as any).phoneNumber || "")
                          ? "bg-[rgba(31,200,120,.22)] border-[rgba(31,200,120,.40)] text-white"
                          : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.10)] text-[rgba(255,255,255,.35)]")
                      }
                    >
                      Call
                    </button>
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
                    setSuppressNavUntil(Date.now() + 600);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSuppressNavUntil(Date.now() + 600);
                    setOpenStatusId(null);
                    if (confirmDeleteId === q.id) {
                      setConfirmDeleteId(null);
                      setDeletingId(q.id);
                      window.setTimeout(() => {
                        deleteDraft(q.id);
                      }, 220);
                    } else {
                      setConfirmDeleteId(q.id);
                      window.setTimeout(() => {
                        setConfirmDeleteId((cur) => (cur === q.id ? null : cur));
                      }, 500);
                    }
                  }}
                  className={
                    "rounded-full border px-2 py-1 text-[11px] font-extrabold " +
                    (confirmDeleteId === q.id
                      ? "bg-[rgba(255,80,80,.30)] border-[rgba(255,80,80,.55)] text-white"
                      : "bg-[rgba(255,255,255,.10)] border-[rgba(255,255,255,.16)] text-[rgba(255,255,255,.85)]")
                  }
                >
                  Delete
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-extrabold truncate">{q.title}</div>
                <div className="text-sm font-black whitespace-nowrap">{money(q.due)}</div>
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-1">
                {q.style ? `${q.style} · ` : ""}Total {money(q.total)}
                {typeof (q as any).roundedHalfDays === "number" && typeof (q as any).spanDays === "number"
                  ? (Number((q as any).spanDays) > 0
                      ? ` · Install ${(q as any).roundedHalfDays}d (${(q as any).spanDays} day${(q as any).spanDays === 1 ? "" : "s"})`
                      : "")
                  : ""}
              </div>
            </Link>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
