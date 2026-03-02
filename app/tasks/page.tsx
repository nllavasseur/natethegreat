"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { GlassCard, Input, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import { fetchDrafts, upsertDraft } from "@/lib/draftsStore";

type JobTasks = {
  collectDeposit?: boolean;
  orderMaterials?: boolean;
  scheduleDelivery?: boolean;
  call811?: boolean;
};

type JobTaskLabels = Partial<Record<keyof JobTasks, string>>;
type JobTaskHidden = Partial<Record<keyof JobTasks, boolean>>;

type JobTaskSnooze = {
  collectDeposit?: number;
  orderMaterials?: number;
  scheduleDelivery?: number;
  call811?: number;
};

type CustomJobTask = {
  id: string;
  label: string;
  done?: boolean;
  createdAt?: number;
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
  jobTaskLabels?: JobTaskLabels;
  jobTaskHidden?: JobTaskHidden;
  jobCustomTasks?: CustomJobTask[];
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
  const [holdMode, setHoldMode] = useState<"undo" | "snooze" | "custom" | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const holdTimerRef = useRef<any>(null);
  const [customTaskDrafts, setCustomTaskDrafts] = useState<Record<string, string>>({});
  const [editingCustomTaskKey, setEditingCustomTaskKey] = useState<string | null>(null);
  const [newCustomTaskDraftByJob, setNewCustomTaskDraftByJob] = useState<Record<string, string>>({});
  const [addingCustomTaskJobId, setAddingCustomTaskJobId] = useState<string | null>(null);
  const [jobTaskLabelDrafts, setJobTaskLabelDrafts] = useState<Record<string, string>>({});
  const [editingJobTaskKey, setEditingJobTaskKey] = useState<string | null>(null);

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
      const asIso = String((a.d as any).scheduledAt || "");
      const bsIso = String((b.d as any).scheduledAt || "");
      const asMsRaw = asIso ? Date.parse(asIso) : Number.POSITIVE_INFINITY;
      const bsMsRaw = bsIso ? Date.parse(bsIso) : Number.POSITIVE_INFINITY;
      const asMs = Number.isFinite(asMsRaw) ? asMsRaw : Number.POSITIVE_INFINITY;
      const bsMs = Number.isFinite(bsMsRaw) ? bsMsRaw : Number.POSITIVE_INFINITY;
      if (asMs !== bsMs) return asMs - bsMs;

      const ar = Number((a.d as any).queueRank);
      const br = Number((b.d as any).queueRank);
      const aHas = Number.isFinite(ar) && ar > 0;
      const bHas = Number.isFinite(br) && br > 0;
      if (aHas && bHas && ar !== br) return ar - br;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;

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

  function updateJobTaskLabel(jobId: string, key: keyof JobTasks, label: string) {
    const existing = drafts.find((d) => d.id === jobId);
    const prevLabels = (existing as any)?.jobTaskLabels && typeof (existing as any).jobTaskLabels === "object"
      ? (((existing as any).jobTaskLabels as any) as JobTaskLabels)
      : {};
    const nextLabels: JobTaskLabels = { ...prevLabels, [key]: label };
    persistDraftPatch(jobId, { jobTaskLabels: nextLabels });
  }

  function hideJobTask(jobId: string, key: keyof JobTasks, hidden: boolean) {
    const existing = drafts.find((d) => d.id === jobId);
    const prevHidden = (existing as any)?.jobTaskHidden && typeof (existing as any).jobTaskHidden === "object"
      ? (((existing as any).jobTaskHidden as any) as JobTaskHidden)
      : {};
    const nextHidden: JobTaskHidden = { ...prevHidden, [key]: hidden };
    persistDraftPatch(jobId, { jobTaskHidden: nextHidden });
  }

  function restoreAllJobTasks(jobId: string) {
    persistDraftPatch(jobId, { jobTaskHidden: {} });
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

  function persistDraftPatch(jobId: string, patch: Partial<DraftEntry>) {
    try {
      const store = readDraftStore();
      const existing = store[jobId] ?? drafts.find((d) => d.id === jobId);
      if (!existing) return;

      const next: DraftEntry = {
        ...existing,
        ...patch,
        createdAt: Number((existing as any).createdAt) || Date.now(),
        updatedAt: Date.now()
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

  function beginAddCustomJobTask(jobId: string) {
    setAddingCustomTaskJobId(jobId);
    setNewCustomTaskDraftByJob((prev) => ({ ...prev, [jobId]: String(prev[jobId] ?? "") }));
  }

  function cancelAddCustomJobTask(jobId: string) {
    setAddingCustomTaskJobId((prev) => (prev === jobId ? null : prev));
    setNewCustomTaskDraftByJob((prev) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  }

  function commitAddCustomJobTask(jobId: string) {
    const raw = String((newCustomTaskDraftByJob as any)[jobId] ?? "");
    const label = raw.trim();
    if (!label) return;

    const id =
      typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
        ? (crypto as any).randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const nextTask: CustomJobTask = { id, label, done: false, createdAt: Date.now() };
    const existing = drafts.find((d) => d.id === jobId);
    const prevTasks = Array.isArray((existing as any)?.jobCustomTasks)
      ? (((existing as any).jobCustomTasks as any[]) as CustomJobTask[])
      : [];
    persistDraftPatch(jobId, { jobCustomTasks: [...prevTasks, nextTask] });

    setAddingCustomTaskJobId((prev) => (prev === jobId ? null : prev));
    setNewCustomTaskDraftByJob((prev) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  }

  function toggleCustomJobTask(jobId: string, taskId: string) {
    const existing = drafts.find((d) => d.id === jobId);
    const prevTasks = Array.isArray((existing as any)?.jobCustomTasks)
      ? (((existing as any).jobCustomTasks as any[]) as CustomJobTask[])
      : [];
    const nextTasks = prevTasks.map((t) => (t.id === taskId ? { ...t, done: !Boolean(t.done) } : t));
    persistDraftPatch(jobId, { jobCustomTasks: nextTasks });
  }

  function setCustomJobTaskDone(jobId: string, taskId: string, done: boolean) {
    const existing = drafts.find((d) => d.id === jobId);
    const prevTasks = Array.isArray((existing as any)?.jobCustomTasks)
      ? (((existing as any).jobCustomTasks as any[]) as CustomJobTask[])
      : [];
    const nextTasks = prevTasks.map((t) => (t.id === taskId ? { ...t, done } : t));
    persistDraftPatch(jobId, { jobCustomTasks: nextTasks });
  }

  function updateCustomJobTaskLabel(jobId: string, taskId: string, label: string) {
    const existing = drafts.find((d) => d.id === jobId);
    const prevTasks = Array.isArray((existing as any)?.jobCustomTasks)
      ? (((existing as any).jobCustomTasks as any[]) as CustomJobTask[])
      : [];
    const nextTasks = prevTasks.map((t) => (t.id === taskId ? { ...t, label } : t));
    persistDraftPatch(jobId, { jobCustomTasks: nextTasks });
  }

  function deleteCustomJobTask(jobId: string, taskId: string) {
    const existing = drafts.find((d) => d.id === jobId);
    const prevTasks = Array.isArray((existing as any)?.jobCustomTasks)
      ? (((existing as any).jobCustomTasks as any[]) as CustomJobTask[])
      : [];
    const nextTasks = prevTasks.filter((t) => t.id !== taskId);
    persistDraftPatch(jobId, { jobCustomTasks: nextTasks });
    setCustomTaskDrafts((prev) => {
      const next = { ...prev };
      delete next[`${jobId}:${taskId}`];
      return next;
    });
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
            const customTasks = Array.isArray((job as any).jobCustomTasks) ? ((job as any).jobCustomTasks as CustomJobTask[]) : [];
            const doneCount = TASKS.filter((t) => Boolean((tasks as any)[t.key])).length;
            const isAdding = addingCustomTaskJobId === job.id;
            const newDraft = String((newCustomTaskDraftByJob as any)[job.id] ?? "");
            const hiddenMap = (((job as any).jobTaskHidden && typeof (job as any).jobTaskHidden === "object") ? (job as any).jobTaskHidden : {}) as JobTaskHidden;

            return (
              <div
                key={job.id}
                className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-extrabold truncate">{jobTitle(job)}</div>
                    {job.projectAddress ? (
                      <div className="text-[11px] text-[var(--muted)] truncate">{String(job.projectAddress)}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-end gap-2 shrink-0 flex-wrap">
                    {isAdding ? (
                      <div className="flex items-center gap-2" data-keep-open="true">
                        <Input
                          value={newDraft}
                          placeholder="New task"
                          data-no-swipe="true"
                          data-keep-open="true"
                          onChange={(e) =>
                            setNewCustomTaskDraftByJob((prev) => ({
                              ...prev,
                              [job.id]: e.target.value
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              commitAddCustomJobTask(job.id);
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              e.stopPropagation();
                              cancelAddCustomJobTask(job.id);
                            }
                          }}
                          className="w-[120px]"
                        />
                        <SecondaryButton
                          type="button"
                          data-no-swipe="true"
                          data-keep-open="true"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            commitAddCustomJobTask(job.id);
                          }}
                          className="px-3 py-1 text-xs"
                        >
                          Add
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          data-no-swipe="true"
                          data-keep-open="true"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            cancelAddCustomJobTask(job.id);
                          }}
                          className="px-3 py-1 text-xs"
                        >
                          Cancel
                        </SecondaryButton>
                      </div>
                    ) : (
                      <SecondaryButton
                        type="button"
                        data-no-swipe="true"
                        data-keep-open="true"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          beginAddCustomJobTask(job.id);
                        }}
                        className="px-3 py-1 text-xs"
                      >
                        Add task
                      </SecondaryButton>
                    )}
                    <div className="rounded-full border border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.10)] px-2 py-1 text-[11px] font-extrabold text-[rgba(255,255,255,.90)]">
                      {doneCount}/{TASKS.length}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2">
                  {TASKS.filter((t) => !Boolean((hiddenMap as any)[t.key])).map((t) => {
                    const done = Boolean((tasks as any)[t.key]);
                    const keyStr = `${job.id}:${String(t.key)}`;
                    const isConfirm = confirmKey === keyStr;
                    const isEditing = editingJobTaskKey === keyStr;
                    const labelKey = `${job.id}:${String(t.key)}`;
                    const overrideLabelRaw = String(((job as any)?.jobTaskLabels as any)?.[t.key] ?? "");
                    const shownLabel = (overrideLabelRaw || t.label);
                    const editDraftValue = jobTaskLabelDrafts[labelKey];
                    const dueLevel = dueLevelForTask({ taskKey: t.key, scheduledAt: (job as any).scheduledAt, tasks, snooze, nowMs });
                    const urgent = dueLevel === "urgent";
                    const warn = dueLevel === "warn";
                    const showHold = holdKey === keyStr;
                    const showUndo = showHold && holdMode === "undo" && done;
                    const showSnooze = showHold && holdMode === "snooze" && !done && (urgent || warn);
                    const showCustom = showHold && holdMode === "custom" && !done;
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
                            const mode = done ? "undo" : (urgent || warn ? "snooze" : "custom");
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
                            const mode = done ? "undo" : (urgent || warn ? "snooze" : "custom");
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
                                    ? "bg-[rgba(255,80,80,.14)] border-[rgba(255,80,80,.45)] text-white"
                                    : "bg-[rgba(255,80,80,.10)] border-[rgba(255,80,80,.35)] text-white")
                          }
                          style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", touchAction: "pan-y" }}
                          aria-disabled={false}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="truncate">{shownLabel}</div>
                            <div className="text-[11px] text-[var(--muted)] shrink-0">
                              {done ? "Done" : isConfirm ? "Confirm" : urgent || warn ? "Hold" : "Tap"}
                            </div>
                          </div>
                        </button>

                        {showCustom ? (
                          <div className="flex justify-end gap-2" data-keep-open="true">
                            <SecondaryButton
                              type="button"
                              data-no-swipe="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingJobTaskKey(keyStr);
                                setJobTaskLabelDrafts((prev) => ({ ...prev, [labelKey]: shownLabel }));
                              }}
                            >
                              Edit
                            </SecondaryButton>
                            <SecondaryButton
                              type="button"
                              data-no-swipe="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setHoldKey(null);
                                setHoldMode(null);
                                setEditingJobTaskKey(null);
                                hideJobTask(job.id, t.key, true);
                              }}
                            >
                              Delete
                            </SecondaryButton>
                          </div>
                        ) : null}

                        {showUndo ? (
                          <div className="flex justify-end gap-2" data-keep-open="true">
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
                            <SecondaryButton
                              type="button"
                              data-no-swipe="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingJobTaskKey(keyStr);
                                setJobTaskLabelDrafts((prev) => ({ ...prev, [labelKey]: shownLabel }));
                              }}
                            >
                              Edit
                            </SecondaryButton>
                            <SecondaryButton
                              type="button"
                              data-no-swipe="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setHoldKey(null);
                                setHoldMode(null);
                                setEditingJobTaskKey(null);
                                hideJobTask(job.id, t.key, true);
                              }}
                            >
                              Delete
                            </SecondaryButton>
                          </div>
                        ) : null}

                        {showSnooze ? (
                          <div className="flex justify-end gap-2" data-keep-open="true">
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
                            <SecondaryButton
                              type="button"
                              data-no-swipe="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingJobTaskKey(keyStr);
                                setJobTaskLabelDrafts((prev) => ({ ...prev, [labelKey]: shownLabel }));
                              }}
                            >
                              Edit
                            </SecondaryButton>
                            <SecondaryButton
                              type="button"
                              data-no-swipe="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setHoldKey(null);
                                setHoldMode(null);
                                setEditingJobTaskKey(null);
                                hideJobTask(job.id, t.key, true);
                              }}
                            >
                              Delete
                            </SecondaryButton>
                          </div>
                        ) : null}

                        {isEditing ? (
                          <div className="grid gap-2" data-keep-open="true">
                            <Input
                              value={editDraftValue ?? shownLabel}
                              placeholder="Task"
                              data-no-swipe="true"
                              data-keep-open="true"
                              onChange={(e) =>
                                setJobTaskLabelDrafts((prev) => ({
                                  ...prev,
                                  [labelKey]: e.target.value
                                }))
                              }
                              onBlur={() => {
                                const raw = String((jobTaskLabelDrafts as any)[labelKey] ?? "");
                                const nextLabel = raw.trim();
                                updateJobTaskLabel(job.id, t.key, nextLabel);
                                setJobTaskLabelDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[labelKey];
                                  return next;
                                });
                                setEditingJobTaskKey(null);
                                setHoldKey(null);
                                setHoldMode(null);
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {customTasks.length ? (
                  <div className="mt-3 grid gap-2">
                    {customTasks.map((t) => {
                      const done = Boolean(t.done);
                      const keyStr = `${job.id}:custom:${t.id}`;
                      const draftKey = `${job.id}:${t.id}`;
                      const draftValue = customTaskDrafts[draftKey];
                      const label = String(t.label || "Task");
                      const isConfirm = confirmKey === keyStr;
                      const showHold = holdKey === keyStr;
                      const showUndo = showHold && holdMode === "undo" && done;
                      const showCustomActions = showHold && holdMode === "custom" && !done;
                      const isEditing = editingCustomTaskKey === keyStr;
                      return (
                        <div key={keyStr} className="grid gap-2" data-keep-open="true">
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
                              const mode = done ? "undo" : "custom";
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
                              const mode = done ? "undo" : "custom";
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
                              setCustomJobTaskDone(job.id, t.id, true);
                            }}
                            className={
                              "w-full rounded-xl border px-3 py-2 text-left transition-none font-extrabold select-none " +
                              (done
                                ? "bg-[rgba(31,200,120,.16)] border-[rgba(31,200,120,.35)] text-white opacity-80"
                                : isConfirm
                                  ? "bg-[rgba(255,80,80,.22)] border-[rgba(255,80,80,.45)] text-white"
                                  : "bg-[rgba(255,80,80,.10)] border-[rgba(255,80,80,.35)] text-white")
                            }
                            style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", touchAction: "pan-y" }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="truncate">{label}</div>
                              <div className="text-[11px] text-[var(--muted)] shrink-0">
                                {done ? "Done" : isConfirm ? "Confirm" : "Hold"}
                              </div>
                            </div>
                          </button>

                          {showUndo ? (
                            <div className="flex justify-end gap-2" data-keep-open="true">
                              <SecondaryButton
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setHoldKey(null);
                                  setHoldMode(null);
                                  setCustomJobTaskDone(job.id, t.id, false);
                                }}
                              >
                                Undo
                              </SecondaryButton>
                              <SecondaryButton
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setHoldKey(null);
                                  setHoldMode(null);
                                  setEditingCustomTaskKey(null);
                                  deleteCustomJobTask(job.id, t.id);
                                }}
                              >
                                Delete
                              </SecondaryButton>
                            </div>
                          ) : null}

                          {showCustomActions ? (
                            <div className="flex justify-end gap-2" data-keep-open="true">
                              <SecondaryButton
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setEditingCustomTaskKey(keyStr);
                                  setCustomTaskDrafts((prev) => ({ ...prev, [draftKey]: label }));
                                }}
                              >
                                Edit
                              </SecondaryButton>
                              <SecondaryButton
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setHoldKey(null);
                                  setHoldMode(null);
                                  setEditingCustomTaskKey(null);
                                  deleteCustomJobTask(job.id, t.id);
                                }}
                              >
                                Delete
                              </SecondaryButton>
                            </div>
                          ) : null}

                          {isEditing ? (
                            <div className="grid gap-2" data-keep-open="true">
                              <Input
                                value={draftValue ?? label}
                                placeholder="Task"
                                data-no-swipe="true"
                                data-keep-open="true"
                                onChange={(e) =>
                                  setCustomTaskDrafts((prev) => ({
                                    ...prev,
                                    [draftKey]: e.target.value
                                  }))
                                }
                                onBlur={() => {
                                  const raw = String((customTaskDrafts as any)[draftKey] ?? "");
                                  const nextLabel = raw.trim();
                                  updateCustomJobTaskLabel(job.id, t.id, nextLabel);
                                  setCustomTaskDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[draftKey];
                                    return next;
                                  });
                                  setEditingCustomTaskKey(null);
                                  setHoldKey(null);
                                  setHoldMode(null);
                                }}
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
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
