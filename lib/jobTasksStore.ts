import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { resolveWorkspaceId } from "@/lib/draftsStore";

export type JobTasks = {
  collectDeposit?: boolean;
  orderMaterials?: boolean;
  scheduleDelivery?: boolean;
  call811?: boolean;
};

export type JobTaskSnooze = {
  collectDeposit?: number;
  orderMaterials?: number;
  scheduleDelivery?: number;
  call811?: number;
};

export type JobTaskLabels = Partial<Record<keyof JobTasks, string>>;
export type JobTaskHidden = Partial<Record<keyof JobTasks, boolean>>;

export type CustomJobTask = {
  id: string;
  label: string;
  done?: boolean;
  createdAt?: number;
};

type JobTasksRow = {
  draft_id: string;
  job_tasks?: any;
  job_task_snooze?: any;
  job_task_labels?: any;
  job_task_hidden?: any;
  job_custom_tasks?: any;
};

export async function fetchJobTasks(params: { draftIds: string[]; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, rows: [] as JobTasksRow[] };
  const workspaceId = resolveWorkspaceId(params.workspaceId);
  const draftIds = (Array.isArray(params.draftIds) ? params.draftIds : []).map((id) => String(id || "")).filter(Boolean);
  if (draftIds.length === 0) return { ok: true as const, rows: [] as JobTasksRow[] };

  try {
    const res = await supabase
      .from("job_tasks")
      .select("draft_id, job_tasks, job_task_snooze, job_task_labels, job_task_hidden, job_custom_tasks")
      .eq("workspace_id", workspaceId)
      .in("draft_id", draftIds);

    if ((res as any)?.error) throw (res as any).error;
    const rows = (((res as any)?.data ?? []) as any[]).map((r) => ({
      draft_id: String((r as any)?.draft_id || ""),
      job_tasks: (r as any)?.job_tasks ?? undefined,
      job_task_snooze: (r as any)?.job_task_snooze ?? undefined,
      job_task_labels: (r as any)?.job_task_labels ?? undefined,
      job_task_hidden: (r as any)?.job_task_hidden ?? undefined,
      job_custom_tasks: (r as any)?.job_custom_tasks ?? undefined
    })) as JobTasksRow[];

    return { ok: true as const, rows };
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    if (msg.toLowerCase().includes("relation") && msg.toLowerCase().includes("does not exist")) {
      return { ok: false as const, reason: "missing_relation" as const, rows: [] as JobTasksRow[] };
    }
    return { ok: false as const, reason: "error" as const, error: e, rows: [] as JobTasksRow[] };
  }
}

export async function upsertJobTasks(params: {
  draftId: string;
  jobTasks?: JobTasks;
  jobTaskSnooze?: JobTaskSnooze;
  jobTaskLabels?: JobTaskLabels;
  jobTaskHidden?: JobTaskHidden;
  jobCustomTasks?: CustomJobTask[];
  workspaceId?: string;
}) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const };
  const workspaceId = resolveWorkspaceId(params.workspaceId);
  const draftId = String(params.draftId || "");
  if (!draftId) return { ok: false as const, reason: "missing_draft_id" as const };

  try {
    const payload = {
      workspace_id: workspaceId,
      draft_id: draftId,
      updated_at: new Date().toISOString(),
      job_tasks: params.jobTasks ?? null,
      job_task_snooze: params.jobTaskSnooze ?? null,
      job_task_labels: params.jobTaskLabels ?? null,
      job_task_hidden: params.jobTaskHidden ?? null,
      job_custom_tasks: params.jobCustomTasks ?? null
    };

    const { error } = await supabase
      .from("job_tasks")
      .upsert(payload as any, { onConflict: "workspace_id,draft_id" });

    if (error) throw error;
    return { ok: true as const };
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    if (msg.toLowerCase().includes("relation") && msg.toLowerCase().includes("does not exist")) {
      return { ok: false as const, reason: "missing_relation" as const };
    }
    return { ok: false as const, reason: "error" as const, error: e };
  }
}
