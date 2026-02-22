import { supabase, supabaseConfigured } from "@/lib/supabaseClient";

export const DEFAULT_WORKSPACE_ID = "b0fbbfe6-9ee1-4e1b-bb9a-cb51ef240df7";

type DraftRow = {
  id: string;
  workspace_id: string;
  data: any;
  updated_at?: string;
};

export async function upsertDraft(params: { id: string; data: any; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const };
  const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID;

  try {
    const payload: DraftRow = {
      id: params.id,
      workspace_id: workspaceId,
      data: params.data
    };

    const { error } = await supabase.from("drafts").upsert(payload, { onConflict: "id" });
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
    const { error } = await supabase.from("drafts").delete().eq("workspace_id", workspaceId).eq("id", params.id);
    if (error) throw error;
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, reason: "error" as const, error: e };
  }
}

export async function fetchDrafts(params?: { workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, drafts: [] as any[] };
  const workspaceId = params?.workspaceId ?? DEFAULT_WORKSPACE_ID;

  try {
    const { data, error } = await supabase
      .from("drafts")
      .select("id, data, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const drafts = (data ?? []).map((r: any) => {
      const d = r?.data ?? {};
      const id = String(r?.id ?? d?.id ?? "");
      return { ...d, id };
    });

    return { ok: true as const, drafts };
  } catch (e) {
    return { ok: false as const, reason: "error" as const, error: e, drafts: [] as any[] };
  }
}

export async function fetchDraft(params: { id: string; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, draft: null as any };
  const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID;

  try {
    const { data, error } = await supabase
      .from("drafts")
      .select("id, data")
      .eq("workspace_id", workspaceId)
      .eq("id", params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: true as const, draft: null as any };

    const d = (data as any).data ?? {};
    const id = String((data as any).id ?? d?.id ?? "");
    return { ok: true as const, draft: { ...d, id } };
  } catch (e) {
    return { ok: false as const, reason: "error" as const, error: e, draft: null as any };
  }
}
