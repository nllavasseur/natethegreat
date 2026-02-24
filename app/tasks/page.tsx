"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import { fetchDrafts, upsertDraft } from "@/lib/draftsStore";

type JobTasks = {
  collectDeposit?: boolean;
  orderMaterials?: boolean;
  scheduleDelivery?: boolean;
  call811?: boolean;
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
  jobTasks?: JobTasks;
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

function jobTitle(d: DraftEntry) {
  return String(d.title || d.customerName || d.projectAddress || "Job");
}

export default function TasksPage() {
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

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
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [confirmKey]);

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
                    return (
                      <button
                        key={keyStr}
                        type="button"
                        data-no-swipe="true"
                        data-keep-open="true"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (done) return;
                          if (!isConfirm) {
                            setConfirmKey(keyStr);
                            return;
                          }
                          setConfirmKey(null);
                          setJobTask(job.id, t.key, true);
                        }}
                        className={
                          "w-full rounded-xl border px-3 py-2 text-left transition-none font-extrabold " +
                          (done
                            ? "bg-[rgba(31,200,120,.16)] border-[rgba(31,200,120,.35)] text-white opacity-80"
                            : isConfirm
                              ? "bg-[rgba(255,80,80,.22)] border-[rgba(255,80,80,.45)] text-white"
                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                        }
                        aria-disabled={done}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate">{t.label}</div>
                          <div className="text-[11px] text-[var(--muted)] shrink-0">
                            {done ? "Done" : isConfirm ? "Confirm" : "Tap"}
                          </div>
                        </div>
                      </button>
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
