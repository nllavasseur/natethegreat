import { supabase, supabaseConfigured } from "@/lib/supabaseClient";

export const DEFAULT_WORKSPACE_ID = "b0fbbfe6-9ee1-4e1b-bb9a-cb51ef240df7";

export const DRAFT_PHOTOS_BUCKET = "draft-photos";

type DraftRow = {
  workspace_id: string;
  draft_id: string;
  draft: any;
  updated_at?: string;
};

const RESERVED_DRAFT_IDS = new Set([
  "vf_calendar_blockouts_v1",
  "vf_calendar_tasks_v1"
]);

export async function upsertDraft(params: { id: string; data: any; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const };
  const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID;

  try {
    const payload: DraftRow = {
      workspace_id: workspaceId,
      draft_id: params.id,
      draft: params.data
    };

    const { error } = await supabase.from("drafts").upsert(payload, { onConflict: "workspace_id,draft_id" });
    if (error) throw error;
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, reason: "error" as const, error: e };
  }
}

export async function deleteDraftRemote(params: { id: string; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const };
  const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID;

  try {
    const { error } = await supabase
      .from("drafts")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("draft_id", params.id);
    if (error) throw error;
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, reason: "error" as const, error: e };
  }
}

export async function fetchDrafts(params?: { workspaceId?: string; limit?: number }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, drafts: [] as any[] };
  const workspaceId = params?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const limit = Number((params as any)?.limit);

  try {
    const q = supabase
      .from("drafts")
      .select("draft_id, draft, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });

    const { data, error } = Number.isFinite(limit) && limit > 0 ? await (q as any).limit(limit) : await q;

    if (error) throw error;

    const drafts = (data ?? [])
      .map((r: any) => {
        const d = r?.draft ?? {};
        const id = String(r?.draft_id ?? d?.id ?? "");
        const updatedAt = (() => {
          const raw = String(r?.updated_at ?? "");
          if (!raw) return undefined;
          const ms = Date.parse(raw);
          return Number.isFinite(ms) ? ms : undefined;
        })();
        return { ...d, id, ...(typeof updatedAt === "number" ? { updatedAt } : {}) };
      })
      .filter((d: any) => {
        const id = String((d as any)?.id || "");
        if (!id) return false;
        if (RESERVED_DRAFT_IDS.has(id)) return false;
        const kind = String((d as any)?.kind || "");
        if (kind === "calendar_blockouts" || kind === "calendar_tasks") return false;
        return true;
      });

    return { ok: true as const, drafts };
  } catch (e) {
    return { ok: false as const, reason: "error" as const, error: e, drafts: [] as any[] };
  }
}

export async function fetchDraft(params: { id: string; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, draft: null as any };
  const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID;

  const sid = String(params.id || "");
  if (RESERVED_DRAFT_IDS.has(sid)) {
    // These are used as internal app records, not user-facing drafts.
    // Use fetchDraft only for internal consumers in that case.
  }

  try {
    const { data, error } = await supabase
      .from("drafts")
      .select("draft_id, draft")
      .eq("workspace_id", workspaceId)
      .eq("draft_id", params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: true as const, draft: null as any };

    const d = (data as any).draft ?? {};
    const id = String((data as any).draft_id ?? d?.id ?? "");
    const updatedAt = (() => {
      const raw = String((data as any)?.updated_at ?? "");
      if (!raw) return undefined;
      const ms = Date.parse(raw);
      return Number.isFinite(ms) ? ms : undefined;
    })();
    if (RESERVED_DRAFT_IDS.has(id)) {
      // Still return it (calendar uses fetchDraft for these), but ensure id is stable.
      return { ok: true as const, draft: { ...d, id, ...(typeof updatedAt === "number" ? { updatedAt } : {}) } };
    }
    const kind = String((d as any)?.kind || "");
    if (kind === "calendar_blockouts" || kind === "calendar_tasks") {
      return { ok: true as const, draft: { ...d, id, ...(typeof updatedAt === "number" ? { updatedAt } : {}) } };
    }
    return { ok: true as const, draft: { ...d, id, ...(typeof updatedAt === "number" ? { updatedAt } : {}) } };
  } catch (e) {
    return { ok: false as const, reason: "error" as const, error: e, draft: null as any };
  }
}

type CalendarEntryRow = {
  draft_id: string;
  updated_at?: string;
  // denormalized fields
  created_at_ms?: number;
  updated_at_ms?: number;
  status?: string;
  calendar_hidden?: boolean;
  scheduled_iso?: string | null;
  install_date?: string | null;
  start_date?: string | null;
  hold_date?: string | null;
  labor_days?: number | null;
  queue_rank?: number | null;
  allow_saturday?: boolean | null;
  allow_sunday?: boolean | null;
  estimate_assignee?: string | null;
  customer_name?: string | null;
  title?: string | null;
  project_address?: string | null;
  selected_style?: any;
};

export async function fetchCalendarEntries(params: {
  windowStartIso: string;
  windowEndIso: string;
  workspaceId?: string;
  soldLimit?: number;
}) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, drafts: [] as any[] };
  const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const soldLimit = Number(params.soldLimit);
  const soldTake = Number.isFinite(soldLimit) && soldLimit > 0 ? Math.min(600, Math.max(50, soldLimit)) : 250;

  try {
    const selectCols =
      "draft_id,updated_at,created_at_ms,updated_at_ms,status,calendar_hidden,scheduled_iso,install_date,start_date,hold_date,labor_days,queue_rank,allow_saturday,allow_sunday,estimate_assignee,customer_name,title,project_address,selected_style";

    const [windowRes, soldRes] = await Promise.all([
      supabase
        .from("calendar_entries")
        .select(selectCols)
        .eq("workspace_id", workspaceId)
        .gte("scheduled_iso", params.windowStartIso)
        .lte("scheduled_iso", params.windowEndIso),
      supabase
        .from("calendar_entries")
        .select(selectCols)
        .eq("workspace_id", workspaceId)
        .eq("status", "sold")
        .eq("calendar_hidden", false)
        .order("queue_rank", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(soldTake)
    ]);

    if (windowRes.error) throw windowRes.error;
    if (soldRes.error) throw soldRes.error;

    const rows = [...(windowRes.data ?? []), ...(soldRes.data ?? [])] as CalendarEntryRow[];

    const byId = new Map<string, any>();
    for (const r of rows) {
      const id = String((r as any)?.draft_id || "");
      if (!id) continue;
      const updatedAtMs = Number((r as any)?.updated_at_ms);
      const next = {
        id,
        createdAt: Number((r as any)?.created_at_ms) || undefined,
        updatedAt: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : undefined,
        status: (r as any)?.status ?? undefined,
        calendarHidden: (r as any)?.calendar_hidden ?? undefined,
        scheduledAt: (r as any)?.scheduled_iso ?? undefined,
        installDate: (r as any)?.install_date ?? undefined,
        startDate: (r as any)?.start_date ?? undefined,
        holdDate: (r as any)?.hold_date ?? undefined,
        laborDays: (r as any)?.labor_days ?? undefined,
        queueRank: (r as any)?.queue_rank ?? undefined,
        allowSaturday: (r as any)?.allow_saturday ?? undefined,
        allowSunday: (r as any)?.allow_sunday ?? undefined,
        estimateAssignee: (r as any)?.estimate_assignee ?? undefined,
        customerName: (r as any)?.customer_name ?? undefined,
        title: (r as any)?.title ?? undefined,
        projectAddress: (r as any)?.project_address ?? undefined,
        selectedStyle: (r as any)?.selected_style ?? undefined
      };

      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, next);
        continue;
      }
      const p = Number(prev?.updatedAt ?? prev?.createdAt ?? 0) || 0;
      const n = Number(next?.updatedAt ?? next?.createdAt ?? 0) || 0;
      if (n >= p) byId.set(id, next);
    }

    return { ok: true as const, drafts: Array.from(byId.values()) };
  } catch (e) {
    return { ok: false as const, reason: "error" as const, error: e, drafts: [] as any[] };
  }
}

export async function uploadDraftPhoto(params: {
  draftId: string;
  file: File | Blob;
  filename?: string;
  kind: "project" | "preinstall";
  workspaceId?: string;
}) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, url: "", path: "" };
  const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID;

  try {
    const ts = Date.now();
    const ext = (() => {
      const raw = String(params.filename || "");
      const m = raw.toLowerCase().match(/\.([a-z0-9]+)$/);
      return m ? m[1] : "jpg";
    })();

    const filenameBase = params.filename
      ? String(params.filename).replace(/[^a-zA-Z0-9._-]/g, "_")
      : `${params.kind}-${ts}.${ext}`;

    const path = `${workspaceId}/${params.draftId}/${params.kind}/${ts}-${filenameBase}`;

    const { error } = await supabase
      .storage
      .from(DRAFT_PHOTOS_BUCKET)
      .upload(path, params.file, {
        upsert: true,
        contentType: (params.file as any)?.type || undefined
      });
    if (error) throw error;

    const pub = supabase.storage.from(DRAFT_PHOTOS_BUCKET).getPublicUrl(path);
    const url = String(pub?.data?.publicUrl || "");
    if (!url) throw new Error("No publicUrl returned.");

    return { ok: true as const, url, path };
  } catch (e) {
    return { ok: false as const, reason: "error" as const, error: e, url: "", path: "" };
  }
}
