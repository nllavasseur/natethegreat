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
