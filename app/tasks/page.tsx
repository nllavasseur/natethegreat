"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import { fetchDrafts, upsertDraft } from "@/lib/draftsStore";

type JobTasks = {
  collectDeposit?: boolean;
  orderMaterials?: boolean;
  scheduleDelivery?: boolean;
  call811?: boolean;
};

type JobTaskSnooze = {
  collectDeposit?: number;
  orderMaterials?: number;
  scheduleDelivery?: number;
  call811?: number;
};

type DraftEntry = {
  id: string;
  createdAt?: number;
  updatedAt?: number;
  title?: string;
  customerName?: string;
  projectAddress?: string;
  status?: "estimate" | "pending" | "sold" | "complete" | "void";
  calendarHidden?: boolean;
  queueRank?: number;
  scheduledAt?: string;
  jobTasks?: JobTasks;
  jobTaskSnooze?: JobTaskSnooze;
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

function writeDraftStore(store: Record<string, DraftEntry>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("vf_estimate_drafts_v1", JSON.stringify(store));
  } catch {
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
    const prevTs = Number((prev as any).updatedAt ?? (prev as any).createdAt ?? 0) || 0;
    const nextTs = Number((d as any).updatedAt ?? (d as any).createdAt ?? 0) || 0;
    if (nextTs > prevTs) byId.set(id, { ...prev, ...d });
  });
  return Array.from(byId.values());
}

const TASKS: Array<{ key: keyof JobTasks; label: string }> = [
  { key: "collectDeposit", label: "Collect Deposit" },
  { key: "orderMaterials", label: "Order materials" },
  { key: "scheduleDelivery", label: "Schedule delivery" },
  { key: "call811", label: "Call 811" }
];

function dueLevelForTask(args: { taskKey: keyof JobTasks; scheduledAt?: string; tasks: JobTasks; snooze?: JobTaskSnooze; nowMs: number }) {
  const { taskKey, scheduledAt, tasks, snooze, nowMs } = args;
  if (Boolean((tasks as any)[taskKey])) return "none" as const;
  const snoozeUntil = Number((snooze as any)?.[taskKey]) || 0;
  if (snoozeUntil > 0 && nowMs < snoozeUntil) return "none" as const;
  const iso = String(scheduledAt || "");
  if (!iso) return "none" as const;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "none" as const;
  const dt = ms - nowMs;
  if (dt < 0) return "none" as const;

  const hours36 = 36 * 60 * 60 * 1000;
  const days7 = 7 * 24 * 60 * 60 * 1000;

  if (taskKey === "call811") return dt <= hours36 ? ("urgent" as const) : ("none" as const);
  if (taskKey === "orderMaterials" || taskKey === "scheduleDelivery") return dt <= days7 ? ("warn" as const) : ("none" as const);
  return "none" as const;
}

function jobTitle(d: DraftEntry) {
  return String(d.title || d.customerName || d.projectAddress || "Job");
}

export default function TasksPage() {
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [holdKey, setHoldKey] = useState<string | null>(null);
  const [holdMode, setHoldMode] = useState<"undo" | "snooze" | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const holdTimerRef = useRef<any>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const localStore = readDraftStore();
      const localList = Object.values(localStore).map((d) => ({ ...d }));

      const remote = await fetchDrafts();
      const remoteList = remote.ok ? (remote.drafts as DraftEntry[]) : [];

      const merged = mergeDraftLists(localList, remoteList);
      if (!cancelled) setDrafts(merged);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!confirmKey) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof (t as any).closest === "function" && t.closest("[data-keep-open='true']")) return;
      setConfirmKey(null);
      setHoldKey(null);
      setHoldMode(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [confirmKey]);

  useEffect(() => {
    if (!holdKey) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof (t as any).closest === "function" && t.closest("[data-keep-open='true']")) return;
      setHoldKey(null);
      setHoldMode(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [holdKey]);

  const soldJobs = useMemo(() => {
    const list = drafts
      .filter((d) => (d.status ?? "estimate") === "sold")
      .filter((d) => !(d as any).calendarHidden);

    const withRank = list.map((d, idx) => ({ d, idx }));
    withRank.sort((a, b) => {
      const ar = Number((a.d as any).queueRank);
      const br = Number((b.d as any).queueRank);
      const aHas = Number.isFinite(ar) && ar > 0;
      const bHas = Number.isFinite(br) && br > 0;
      if (aHas && bHas) return ar - br;
      if (aHas) return -1;
      if (bHas) return 1;
      return a.idx - b.idx;
    });

    return withRank.map((x) => x.d);
  }, [drafts]);

  function setJobTask(jobId: string, key: keyof JobTasks, value: boolean) {
    try {
      const store = readDraftStore();
      const existing = store[jobId] ?? drafts.find((d) => d.id === jobId);
      if (!existing) return;

      const next: DraftEntry = {
        ...existing,
        createdAt: Number((existing as any).createdAt) || Date.now(),
        updatedAt: Date.now(),
        jobTasks: {
          ...(existing as any).jobTasks,
          [key]: value
        }
      };

      store[jobId] = next;
      writeDraftStore(store);

      setDrafts((prev) => prev.map((d) => (d.id === jobId ? { ...d, ...next } : d)));

      try {
        void upsertDraft({ id: jobId, data: next });
      } catch {
      }
    } catch {
    }
  }

  function snoozeJobTask(jobId: string, key: keyof JobTasks, untilMs: number) {
    try {
      const store = readDraftStore();
      const existing = store[jobId] ?? drafts.find((d) => d.id === jobId);
      if (!existing) return;

      const next: DraftEntry = {
        ...existing,
        createdAt: Number((existing as any).createdAt) || Date.now(),
        updatedAt: Date.now(),
        jobTaskSnooze: {
          ...(existing as any).jobTaskSnooze,
          [key]: untilMs
        }
      };

      store[jobId] = next;
      writeDraftStore(store);
      setDrafts((prev) => prev.map((d) => (d.id === jobId ? { ...d, ...next } : d)));
      try {
        void upsertDraft({ id: jobId, data: next });
      } catch {
      }
    } catch {
    }
  }

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 88px)" }}>
      <div className="flex items-center justify-between">
        <SectionTitle title="Tasks" />
        <Link href="/quotes">
          <SecondaryButton>Back</SecondaryButton>
        </Link>
      </div>

      <GlassCard className="p-4">
        {soldJobs.length === 0 ? <div className="text-sm text-[var(--muted)]">No sold jobs.</div> : null}

        <div className="mt-2 grid gap-3">
          {soldJobs.map((job) => {
            const tasks = (job as any).jobTasks || {};
            const snooze = (job as any).jobTaskSnooze || {};
            const doneCount = TASKS.filter((t) => Boolean((tasks as any)[t.key])).length;

            return (
              <div
                key={job.id}
                className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold truncate">{jobTitle(job)}</div>
                    {job.projectAddress ? (
                      <div className="text-[11px] text-[var(--muted)] truncate">{String(job.projectAddress)}</div>
                    ) : null}
                  </div>
                  <div className="rounded-full border border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.10)] px-2 py-1 text-[11px] font-extrabold text-[rgba(255,255,255,.90)] shrink-0">
                    {doneCount}/{TASKS.length}
                  </div>
                </div>

                <div className="mt-3 grid gap-2">
                  {TASKS.map((t) => {
                    const done = Boolean((tasks as any)[t.key]);
                    const keyStr = `${job.id}:${String(t.key)}`;
                    const isConfirm = confirmKey === keyStr;
                    const dueLevel = dueLevelForTask({ taskKey: t.key, scheduledAt: (job as any).scheduledAt, tasks, snooze, nowMs });
                    const urgent = dueLevel === "urgent";
                    const warn = dueLevel === "warn";
                    const showHold = holdKey === keyStr;
                    const showUndo = showHold && holdMode === "undo" && done;
                    const showSnooze = showHold && holdMode === "snooze" && !done && (urgent || warn);
                    return (
                      <div key={keyStr} className="grid gap-2">
                        <button
                          type="button"
                          data-no-swipe="true"
                          data-keep-open="true"
                          onContextMenu={(e) => {
                            e.preventDefault();
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
                            const mode = done ? "undo" : (urgent || warn ? "snooze" : null);
                            if (!mode) return;
                            holdTimerRef.current = window.setTimeout(() => {
                              setHoldKey(keyStr);
                              setHoldMode(mode);
                              setConfirmKey(null);
                            }, 3000);
                          }}
                          onTouchEnd={() => {
                            if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
                            holdTimerRef.current = null;
                          }}
                          onTouchCancel={() => {
                            if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
                            holdTimerRef.current = null;
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
                            const mode = done ? "undo" : (urgent || warn ? "snooze" : null);
                            if (!mode) return;
                            holdTimerRef.current = window.setTimeout(() => {
                              setHoldKey(keyStr);
                              setHoldMode(mode);
                              setConfirmKey(null);
                            }, 3000);
                          }}
                          onPointerUp={() => {
                            if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
                            holdTimerRef.current = null;
                          }}
                          onPointerCancel={() => {
                            if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
                            holdTimerRef.current = null;
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (done) return;
                            if (!isConfirm) {
                              setConfirmKey(keyStr);
                              setHoldKey(null);
                              setHoldMode(null);
                              return;
                            }
                            setConfirmKey(null);
                            setJobTask(job.id, t.key, true);
                          }}
                          className={
                            "w-full rounded-xl border px-3 py-2 text-left transition-none font-extrabold select-none " +
                            (done
                              ? "bg-[rgba(31,200,120,.16)] border-[rgba(31,200,120,.35)] text-white opacity-80"
                              : isConfirm
                                ? "bg-[rgba(255,80,80,.22)] border-[rgba(255,80,80,.45)] text-white"
                                : urgent
                                  ? "bg-[rgba(255,80,80,.18)] border-[rgba(255,80,80,.55)] text-white animate-pulse"
                                  : warn
                                    ? "bg-[rgba(255,214,10,.12)] border-[rgba(255,214,10,.45)] text-white"
                                    : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                          }
                          style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", touchAction: "pan-y" }}
                          aria-disabled={false}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="truncate">{t.label}</div>
                            <div className="text-[11px] text-[var(--muted)] shrink-0">
                              {done ? "Done" : isConfirm ? "Confirm" : urgent || warn ? "Hold" : "Tap"}
                            </div>
                          </div>
                        </button>

                        {showUndo ? (
                          <div className="flex justify-end" data-keep-open="true">
                            <SecondaryButton
                              type="button"
                              data-no-swipe="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setHoldKey(null);
                                setHoldMode(null);
                                setJobTask(job.id, t.key, false);
                              }}
                            >
                              Undo
                            </SecondaryButton>
                          </div>
                        ) : null}

                        {showSnooze ? (
                          <div className="flex justify-end" data-keep-open="true">
                            <SecondaryButton
                              type="button"
                              data-no-swipe="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setHoldKey(null);
                                setHoldMode(null);
                                snoozeJobTask(job.id, t.key, Date.now() + 4 * 60 * 60 * 1000);
                              }}
                            >
                              Snooze 4h
                            </SecondaryButton>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <div className="mt-4">
        <GlassCard className="p-3">
          <div className="text-[11px] text-[var(--muted)]">
            Tap a task once to arm it, tap again to confirm. Completed tasks sync to your saved draft.
          </div>
        </GlassCard>
      </div>

      <div className="mt-3 flex justify-end">
        <Link href="/quotes">
          <SecondaryButton>Back to Quotes</SecondaryButton>
        </Link>
      </div>
    </div>
  );
}
