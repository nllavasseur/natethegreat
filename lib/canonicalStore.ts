import { DEFAULT_WORKSPACE_ID, resolveWorkspaceId } from "@/lib/draftsStore";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";

function isMissingRelationError(e: any) {
  const msg = String(e?.message || e || "").toLowerCase();
  return msg.includes("relation") && msg.includes("does not exist");
}

function isMissingColumnError(e: any) {
  const msg = String(e?.message || e || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

function parseUpdatedAtMs(updatedAt: unknown) {
  const raw = String(updatedAt || "");
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

export type CanonicalQuoteRow = {
  id: string;
  data?: any;
  updated_at?: string;
  created_at?: string;
  status?: string | null;
  calendar_hidden?: boolean | null;
  queue_rank?: number | null;
  labor_days?: number | null;
  original_labor_days?: number | null;
  allow_saturday?: boolean | null;
  allow_sunday?: boolean | null;
  hold_date?: string | null;
  estimate_assignee?: string | null;
  customer_name?: string | null;
  phone_number?: string | null;
  project_address?: string | null;
  title?: string | null;
  selected_style?: any;
  totals?: any;
};

export async function fetchCanonicalQuotes(params?: { workspaceId?: string; limit?: number }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, quotes: [] as any[] };

  const workspaceId = resolveWorkspaceId(params?.workspaceId);
  const limit = Number(params?.limit);
  const take = Number.isFinite(limit) && limit > 0 ? Math.max(1, Math.min(2000, limit)) : 900;

  try {
    const selectAll =
      "id,updated_at,created_at,status,calendar_hidden,queue_rank,labor_days,original_labor_days,allow_saturday,allow_sunday,hold_date,estimate_assignee,customer_name,phone_number,project_address,title,selected_style,totals,data";

    let res: any;
    try {
      res = await supabase
        .from("vf_quotes")
        .select(selectAll)
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(take);

      if (res?.error) throw res.error;
    } catch (e: any) {
      if (isMissingColumnError(e)) {
        res = await supabase
          .from("vf_quotes")
          .select("id,updated_at,created_at,status,data")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(take);
        if (res?.error) throw res.error;
      } else {
        throw e;
      }
    }

    const rows = ((res as any)?.data ?? []) as CanonicalQuoteRow[];

    const mapped = rows
      .map((r) => {
        const id = String((r as any)?.id || "");
        if (!id) return null;
        const data = (r as any)?.data && typeof (r as any).data === "object" ? (r as any).data : {};
        const updatedAtMs = Math.max(Number((data as any)?.updatedAt) || 0, parseUpdatedAtMs((r as any)?.updated_at));
        const createdAtMs = Number((data as any)?.createdAt) || parseUpdatedAtMs((r as any)?.created_at) || 0;

        const merged: any = {
          ...(data as any),
          id,
          ...(updatedAtMs > 0 ? { updatedAt: updatedAtMs } : {}),
          ...(createdAtMs > 0 ? { createdAt: createdAtMs } : {})
        };

        // Prefer first-class columns if present.
        if ((r as any).status != null) merged.status = (r as any).status;
        if ((r as any).calendar_hidden != null) merged.calendarHidden = (r as any).calendar_hidden;
        if ((r as any).queue_rank != null) merged.queueRank = (r as any).queue_rank;
        if ((r as any).labor_days != null) merged.laborDays = (r as any).labor_days;
        if ((r as any).original_labor_days != null) merged.originalLaborDays = (r as any).original_labor_days;
        if ((r as any).allow_saturday != null) merged.allowSaturday = (r as any).allow_saturday;
        if ((r as any).allow_sunday != null) merged.allowSunday = (r as any).allow_sunday;
        if ((r as any).hold_date != null) merged.holdDate = (r as any).hold_date;
        if ((r as any).estimate_assignee != null) merged.estimateAssignee = (r as any).estimate_assignee;
        if ((r as any).customer_name != null) merged.customerName = (r as any).customer_name;
        if ((r as any).phone_number != null) merged.phoneNumber = (r as any).phone_number;
        if ((r as any).project_address != null) merged.projectAddress = (r as any).project_address;
        if ((r as any).title != null) merged.title = (r as any).title;
        if ((r as any).selected_style != null) merged.selectedStyle = (r as any).selected_style;
        if ((r as any).totals != null) merged.totals = (r as any).totals;

        return merged;
      })
      .filter(Boolean);

    return { ok: true as const, quotes: mapped as any[] };
  } catch (e: any) {
    if (isMissingRelationError(e)) {
      return { ok: false as const, reason: "missing_relation" as const, quotes: [] as any[] };
    }
    return { ok: false as const, reason: "error" as const, error: e, quotes: [] as any[] };
  }
}

export async function fetchCanonicalQuotesByIds(params: { quoteIds: string[]; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, quotes: [] as any[] };

  const workspaceId = resolveWorkspaceId(params.workspaceId);
  const ids = (Array.isArray(params.quoteIds) ? params.quoteIds : []).map((x) => String(x || "").trim()).filter(Boolean);
  if (ids.length === 0) return { ok: true as const, quotes: [] as any[] };

  try {
    const selectAll =
      "id,updated_at,created_at,status,calendar_hidden,queue_rank,labor_days,original_labor_days,allow_saturday,allow_sunday,hold_date,estimate_assignee,customer_name,phone_number,project_address,title,selected_style,totals,data";

    let res: any;
    try {
      res = await supabase
        .from("vf_quotes")
        .select(selectAll)
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      if (res?.error) throw res.error;
    } catch (e: any) {
      if (isMissingColumnError(e)) {
        res = await supabase
          .from("vf_quotes")
          .select("id,updated_at,created_at,status,data")
          .eq("workspace_id", workspaceId)
          .in("id", ids);
        if (res?.error) throw res.error;
      } else {
        throw e;
      }
    }

    const rows = ((res as any)?.data ?? []) as CanonicalQuoteRow[];

    const mapped = rows
      .map((r) => {
        const id = String((r as any)?.id || "");
        if (!id) return null;
        const data = (r as any)?.data && typeof (r as any).data === "object" ? (r as any).data : {};
        const updatedAtMs = Math.max(Number((data as any)?.updatedAt) || 0, parseUpdatedAtMs((r as any)?.updated_at));
        const createdAtMs = Number((data as any)?.createdAt) || parseUpdatedAtMs((r as any)?.created_at) || 0;

        const merged: any = {
          ...(data as any),
          id,
          ...(updatedAtMs > 0 ? { updatedAt: updatedAtMs } : {}),
          ...(createdAtMs > 0 ? { createdAt: createdAtMs } : {})
        };

        if ((r as any).status != null) merged.status = (r as any).status;
        if ((r as any).calendar_hidden != null) merged.calendarHidden = (r as any).calendar_hidden;
        if ((r as any).queue_rank != null) merged.queueRank = (r as any).queue_rank;
        if ((r as any).labor_days != null) merged.laborDays = (r as any).labor_days;
        if ((r as any).original_labor_days != null) merged.originalLaborDays = (r as any).original_labor_days;
        if ((r as any).allow_saturday != null) merged.allowSaturday = (r as any).allow_saturday;
        if ((r as any).allow_sunday != null) merged.allowSunday = (r as any).allow_sunday;
        if ((r as any).hold_date != null) merged.holdDate = (r as any).hold_date;
        if ((r as any).estimate_assignee != null) merged.estimateAssignee = (r as any).estimate_assignee;
        if ((r as any).customer_name != null) merged.customerName = (r as any).customer_name;
        if ((r as any).phone_number != null) merged.phoneNumber = (r as any).phone_number;
        if ((r as any).project_address != null) merged.projectAddress = (r as any).project_address;
        if ((r as any).title != null) merged.title = (r as any).title;
        if ((r as any).selected_style != null) merged.selectedStyle = (r as any).selected_style;
        if ((r as any).totals != null) merged.totals = (r as any).totals;

        return merged;
      })
      .filter(Boolean);

    return { ok: true as const, quotes: mapped as any[] };
  } catch (e: any) {
    if (isMissingRelationError(e)) {
      return { ok: false as const, reason: "missing_relation" as const, quotes: [] as any[] };
    }
    return { ok: false as const, reason: "error" as const, error: e, quotes: [] as any[] };
  }
}

export type CanonicalJobRow = {
  quote_id: string;
  start_date: string;
  duration_half_days: number;
};

export async function fetchCanonicalJobsByQuoteIds(params: { quoteIds: string[]; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, jobs: [] as CanonicalJobRow[] };

  const workspaceId = resolveWorkspaceId(params.workspaceId);
  const quoteIds = (Array.isArray(params.quoteIds) ? params.quoteIds : []).map((x) => String(x || "").trim()).filter(Boolean);
  if (quoteIds.length === 0) return { ok: true as const, jobs: [] as CanonicalJobRow[] };

  try {
    const res = await supabase
      .from("vf_jobs")
      .select("quote_id,start_date,duration_half_days")
      .eq("workspace_id", workspaceId)
      .in("quote_id", quoteIds);

    if ((res as any)?.error) throw (res as any).error;

    const rows = (((res as any)?.data ?? []) as any[]).map((r) => ({
      quote_id: String((r as any)?.quote_id || ""),
      start_date: String((r as any)?.start_date || "").slice(0, 10),
      duration_half_days: Math.max(1, Math.round(Number((r as any)?.duration_half_days) || 1))
    })) as CanonicalJobRow[];

    return { ok: true as const, jobs: rows.filter((r) => r.quote_id && r.start_date) };
  } catch (e: any) {
    if (isMissingRelationError(e)) {
      return { ok: false as const, reason: "missing_relation" as const, jobs: [] as CanonicalJobRow[] };
    }
    return { ok: false as const, reason: "error" as const, error: e, jobs: [] as CanonicalJobRow[] };
  }
}

export async function upsertCanonicalQuote(params: { id: string; data: any; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const };

  const workspaceId = resolveWorkspaceId(params.workspaceId);
  const id = String(params.id || "").trim();
  const data = params.data && typeof params.data === "object" ? params.data : {};
  if (!id) return { ok: false as const, reason: "missing_params" as const };

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const toIsoDay = (v: any) => {
    const s = String(v || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  try {
    const payload: any = {
      workspace_id: workspaceId || DEFAULT_WORKSPACE_ID,
      id,
      updated_at: new Date().toISOString(),
      status: (data as any)?.status ?? null,
      calendar_hidden: (data as any)?.calendarHidden ?? null,
      queue_rank: toNum((data as any)?.queueRank),
      labor_days: toNum((data as any)?.laborDays),
      original_labor_days: toNum((data as any)?.originalLaborDays),
      allow_saturday: (data as any)?.allowSaturday ?? null,
      allow_sunday: (data as any)?.allowSunday ?? null,
      hold_date: toIsoDay((data as any)?.holdDate),
      estimate_assignee: (data as any)?.estimateAssignee ?? null,
      customer_name: (data as any)?.customerName ?? null,
      phone_number: (data as any)?.phoneNumber ?? null,
      project_address: (data as any)?.projectAddress ?? null,
      title: (data as any)?.title ?? null,
      selected_style: (data as any)?.selectedStyle ?? null,
      totals: (data as any)?.totals ?? null,
      data
    };

    const res = await supabase.from("vf_quotes").upsert(payload, { onConflict: "workspace_id,id" } as any);
    if ((res as any)?.error) throw (res as any).error;
    return { ok: true as const };
  } catch (e: any) {
    if (isMissingRelationError(e)) {
      return { ok: false as const, reason: "missing_relation" as const };
    }
    return { ok: false as const, reason: "error" as const, error: e };
  }
}

export async function fetchCanonicalJobsWindow(params: { windowStartIso: string; windowEndIso: string; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, jobs: [] as CanonicalJobRow[] };

  const workspaceId = resolveWorkspaceId(params.workspaceId);
  const start = String(params.windowStartIso || "").slice(0, 10);
  const end = String(params.windowEndIso || "").slice(0, 10);
  if (!start || !end) return { ok: true as const, jobs: [] as CanonicalJobRow[] };

  // Widen the window so jobs that start a little before the visible range still render.
  const widen = (iso: string, days: number) => {
    const dt = new Date(iso + "T12:00:00");
    if (!Number.isFinite(dt.getTime())) return iso;
    dt.setDate(dt.getDate() + days);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };

  const startWide = widen(start, -60);
  const endWide = widen(end, 60);

  try {
    const res = await supabase
      .from("vf_jobs")
      .select("quote_id,start_date,duration_half_days")
      .eq("workspace_id", workspaceId)
      .gte("start_date", startWide)
      .lte("start_date", endWide);

    if ((res as any)?.error) throw (res as any).error;

    const rows = (((res as any)?.data ?? []) as any[]).map((r) => ({
      quote_id: String((r as any)?.quote_id || ""),
      start_date: String((r as any)?.start_date || "").slice(0, 10),
      duration_half_days: Math.max(1, Math.round(Number((r as any)?.duration_half_days) || 1))
    })) as CanonicalJobRow[];

    return { ok: true as const, jobs: rows.filter((r) => r.quote_id && r.start_date) };
  } catch (e: any) {
    if (isMissingRelationError(e)) {
      return { ok: false as const, reason: "missing_relation" as const, jobs: [] as CanonicalJobRow[] };
    }
    return { ok: false as const, reason: "error" as const, error: e, jobs: [] as CanonicalJobRow[] };
  }
}

export async function upsertCanonicalJob(params: {
  quoteId: string;
  startDate: string;
  durationHalfDays: number;
  workspaceId?: string;
}) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const };

  const workspaceId = resolveWorkspaceId(params.workspaceId);
  const quoteId = String(params.quoteId || "").trim();
  const startDate = String(params.startDate || "").slice(0, 10);
  const durationHalfDays = Math.max(1, Math.round(Number(params.durationHalfDays) || 1));

  if (!quoteId || !startDate) return { ok: false as const, reason: "missing_params" as const };

  try {
    const payload: any = {
      workspace_id: workspaceId || DEFAULT_WORKSPACE_ID,
      quote_id: quoteId,
      start_date: startDate,
      duration_half_days: durationHalfDays,
      updated_at: new Date().toISOString()
    };

    const res = await supabase.from("vf_jobs").upsert(payload, { onConflict: "workspace_id,quote_id" } as any);
    if ((res as any)?.error) throw (res as any).error;
    return { ok: true as const };
  } catch (e: any) {
    if (isMissingRelationError(e)) {
      return { ok: false as const, reason: "missing_relation" as const };
    }
    return { ok: false as const, reason: "error" as const, error: e };
  }
}

export async function deleteCanonicalJob(params: { quoteId: string; workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const };

  const workspaceId = resolveWorkspaceId(params.workspaceId);
  const quoteId = String(params.quoteId || "").trim();
  if (!quoteId) return { ok: false as const, reason: "missing_params" as const };

  try {
    const res = await supabase.from("vf_jobs").delete().eq("workspace_id", workspaceId).eq("quote_id", quoteId);
    if ((res as any)?.error) throw (res as any).error;
    return { ok: true as const };
  } catch (e: any) {
    if (isMissingRelationError(e)) {
      return { ok: false as const, reason: "missing_relation" as const };
    }
    return { ok: false as const, reason: "error" as const, error: e };
  }
}

export type CanonicalBlockoutRow = {
  id: string;
  start_date: string;
  end_date: string;
  description: string;
};

export async function fetchCanonicalCalendarBlockouts(params?: { workspaceId?: string }) {
  if (!supabaseConfigured) return { ok: false as const, reason: "supabase_not_configured" as const, blockouts: [] as CanonicalBlockoutRow[] };

  const workspaceId = resolveWorkspaceId(params?.workspaceId);

  try {
    const res = await supabase
      .from("vf_calendar_blockouts")
      .select("id,start_date,end_date,description")
      .eq("workspace_id", workspaceId)
      .order("start_date", { ascending: true });

    if ((res as any)?.error) throw (res as any).error;

    const rows = (((res as any)?.data ?? []) as any[]).map((r) => ({
      id: String((r as any)?.id || ""),
      start_date: String((r as any)?.start_date || "").slice(0, 10),
      end_date: String((r as any)?.end_date || "").slice(0, 10),
      description: String((r as any)?.description || "")
    })) as CanonicalBlockoutRow[];

    return { ok: true as const, blockouts: rows.filter((b) => b.id && b.start_date && b.end_date) };
  } catch (e: any) {
    if (isMissingRelationError(e)) {
      return { ok: false as const, reason: "missing_relation" as const, blockouts: [] as CanonicalBlockoutRow[] };
    }
    return { ok: false as const, reason: "error" as const, error: e, blockouts: [] as CanonicalBlockoutRow[] };
  }
}
