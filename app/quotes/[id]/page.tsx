"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React from "react";
import { createPortal } from "react-dom";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import { fetchDraft } from "@/lib/draftsStore";
import { fetchCanonicalQuoteById } from "@/lib/canonicalStore";
import type { QuoteItem } from "@/lib/types";
import { money } from "@/lib/money";
import { computeMaterialsAndExpensesTotal, computeTotals } from "@/lib/totals";

type DraftEntry = {
  id: string;
  createdAt: number;
  updatedAt?: number;
  title?: string;
  customerName?: string;
  projectAddress?: string;
  phoneNumber?: string;
  email?: string;
  selectedStyle?: { name: string } | null;
  notes?: string;
  projectPhotoUrl?: string | null;
  projectPhotoPath?: string | null;
  projectPhotoDataUrl?: string | null;
  preInstallPhotos?: unknown;
  segments?: Array<{ length: number; removed: boolean }>;
  items?: QuoteItem[];
  contract?: any;
  photos?: Array<{ url: string; createdAt?: number }>;
};

type QuoteDetailCacheEntry = {
  id: string;
  updatedAt: number;
  cachedAt: number;
  draft: DraftEntry;
};

const QUOTE_DETAIL_CACHE_KEY = "vf_quote_detail_cache_v1";
const QUOTE_DETAIL_CACHE_MAX = 12;

const quoteDetailMemoryCache = new Map<string, QuoteDetailCacheEntry>();

function stripDataUrlsFromPreInstall(input: unknown) {
  if (!Array.isArray(input)) return [] as Array<{ src: string; note?: string; createdAt?: number }>;
  return (input as any[]).filter((p) => p && typeof (p as any).src === "string" && !String((p as any).src || "").startsWith("data:"));
}

function toQuoteDetailCacheLite(d: DraftEntry): DraftEntry {
  const out: any = { ...(d as any) };
  out.projectPhotoDataUrl = null;
  out.preInstallPhotos = stripDataUrlsFromPreInstall((d as any)?.preInstallPhotos);
  out.contract = null;
  out.items = null;
  return out as DraftEntry;
}

function readQuoteDetailCache(): QuoteDetailCacheEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUOTE_DETAIL_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    const list = Array.isArray(parsed?.entries) ? (parsed.entries as any[]) : [];
    return list
      .map((e) => {
        const id = String(e?.id || "").trim();
        const updatedAt = Number(e?.updatedAt) || 0;
        const cachedAt = Number(e?.cachedAt) || 0;
        const draft = e?.draft && typeof e.draft === "object" ? (e.draft as DraftEntry) : null;
        if (!id || !draft) return null;
        return { id, updatedAt, cachedAt, draft } as QuoteDetailCacheEntry;
      })
      .filter(Boolean) as QuoteDetailCacheEntry[];
  } catch {
    return [];
  }
}

function writeQuoteDetailCache(entries: QuoteDetailCacheEntry[]) {
  if (typeof window === "undefined") return;
  try {
    const cleaned = (Array.isArray(entries) ? entries : [])
      .filter((e) => e && typeof e.id === "string")
      .sort((a, b) => Number(b.cachedAt || 0) - Number(a.cachedAt || 0))
      .slice(0, QUOTE_DETAIL_CACHE_MAX);
    const lite = cleaned.map((e) => ({
      ...e,
      draft: e?.draft ? toQuoteDetailCacheLite(e.draft) : (e as any).draft
    }));
    window.localStorage.setItem(QUOTE_DETAIL_CACHE_KEY, JSON.stringify({ updatedAt: Date.now(), entries: lite }));
  } catch {
  }
}

function seedQuoteDetailMemoryCacheFromStorage() {
  if (typeof window === "undefined") return;
  try {
    if (quoteDetailMemoryCache.size > 0) return;
    const entries = readQuoteDetailCache();
    for (const e of entries) {
      quoteDetailMemoryCache.set(String(e.id), e);
    }
  } catch {
  }
}

function touchQuoteDetailCache(entry: QuoteDetailCacheEntry) {
  const id = String(entry.id || "").trim();
  if (!id) return;
  quoteDetailMemoryCache.set(id, entry);
  try {
    const all = Array.from(quoteDetailMemoryCache.values())
      .sort((a, b) => Number(b.cachedAt || 0) - Number(a.cachedAt || 0))
      .slice(0, QUOTE_DETAIL_CACHE_MAX);
    writeQuoteDetailCache(all);
  } catch {
  }
}

function parseCanonicalQuoteToDraftEntry(id: string, q: any): DraftEntry {
  const data = q && typeof q === "object" ? q : {};
  const createdAt = Number((data as any)?.createdAt) || Date.now();
  const updatedAt = Number((data as any)?.updatedAt) || undefined;
  return {
    ...(data as any),
    id: String((data as any)?.id || id),
    createdAt,
    ...(updatedAt ? { updatedAt } : {})
  } as DraftEntry;
}

function mergePreferNewer(local: DraftEntry | null, remote: DraftEntry | null, fallbackId: string): DraftEntry | null {
  const l = local && typeof local === "object" ? local : null;
  const r = remote && typeof remote === "object" ? remote : null;
  if (!l && !r) return null;
  if (!l) return r as any;
  if (!r) return l as any;

  const lid = String((l as any)?.id || fallbackId);
  const rid = String((r as any)?.id || fallbackId);
  const id = rid || lid || fallbackId;

  const lts = Number((l as any)?.updatedAt ?? (l as any)?.createdAt ?? 0) || 0;
  const rts = Number((r as any)?.updatedAt ?? (r as any)?.createdAt ?? 0) || 0;

  const base = rts >= lts ? r : l;
  const overlay = rts >= lts ? l : r;
  const merged: any = { ...(base as any), ...(overlay as any), id };

  if ((base as any)?.items != null && (overlay as any)?.items == null) merged.items = (base as any).items;
  if ((base as any)?.segments != null && (overlay as any)?.segments == null) merged.segments = (base as any).segments;
  if ((base as any)?.contract != null && (overlay as any)?.contract == null) merged.contract = (base as any).contract;
  if ((base as any)?.photos != null && (overlay as any)?.photos == null) merged.photos = (base as any).photos;
  if ((base as any)?.projectPhotoUrl != null && (overlay as any)?.projectPhotoUrl == null) merged.projectPhotoUrl = (base as any).projectPhotoUrl;
  if ((base as any)?.projectPhotoPath != null && (overlay as any)?.projectPhotoPath == null) merged.projectPhotoPath = (base as any).projectPhotoPath;
  if ((base as any)?.preInstallPhotos != null && (overlay as any)?.preInstallPhotos == null) merged.preInstallPhotos = (base as any).preInstallPhotos;

  if (!(merged as any).createdAt) (merged as any).createdAt = Number((base as any)?.createdAt || (overlay as any)?.createdAt || Date.now());

  return merged as DraftEntry;
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

function readDraftStore(): Record<string, DraftEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("vf_estimate_drafts_v1");
    return raw ? (JSON.parse(raw) as Record<string, DraftEntry>) : {};
  } catch {
    return {};
  }
}

export default function QuoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String((params as any)?.id || "");
  const [draft, setDraft] = React.useState<DraftEntry | null>(null);
  const [portalReady, setPortalReady] = React.useState(false);
  const [viewerIdx, setViewerIdx] = React.useState<number | null>(null);
  const [photoViewerScale, setPhotoViewerScale] = React.useState(1);
  const [photoViewerX, setPhotoViewerX] = React.useState(0);
  const [photoViewerY, setPhotoViewerY] = React.useState(0);
  const contractFrameRef = React.useRef<HTMLDivElement | null>(null);
  const [contractScale, setContractScale] = React.useState(1);

  const viewerPointersRef = React.useRef(new Map<number, { x: number; y: number }>());
  const viewerGestureRef = React.useRef<{
    startScale: number;
    startX: number;
    startY: number;
    startDist: number;
    startCenter: { x: number; y: number };
  } | null>(null);

  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const centerOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      seedQuoteDetailMemoryCacheFromStorage();
      const store = readDraftStore();
      const local = store[id] ?? null;

      const mem = quoteDetailMemoryCache.get(String(id));
      if (mem && mem.draft) {
        setDraft(mem.draft);
      } else {
        const persisted = readQuoteDetailCache().find((e) => String(e.id) === String(id));
        if (persisted?.draft) setDraft(persisted.draft);
        else setDraft(local);
      }

      // Canonical detail first.
      let canonicalDraft: DraftEntry | null = null;
      try {
        const canon = await fetchCanonicalQuoteById({ quoteId: id });
        if (cancelled) return;
        if ((canon as any)?.ok && (canon as any)?.quote) {
          canonicalDraft = parseCanonicalQuoteToDraftEntry(id, (canon as any).quote);
        }
      } catch {
        canonicalDraft = null;
      }

      // Fallback to legacy drafts remote if canonical missing (should be rare).
      if (!canonicalDraft) {
        try {
          const remote = await fetchDraft({ id });
          if (cancelled) return;
          if (remote.ok && remote.draft) canonicalDraft = remote.draft as any;
        } catch {
        }
      }

      const merged = mergePreferNewer(local as any, canonicalDraft as any, id);
      if (cancelled) return;
      setDraft(merged);

      if (merged) {
        const ts = Number((merged as any)?.updatedAt ?? (merged as any)?.createdAt ?? 0) || Date.now();
        touchQuoteDetailCache({ id: String(id), updatedAt: ts, cachedAt: Date.now(), draft: merged });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  React.useEffect(() => {
    if (typeof viewerIdx !== "number") return;
    setPhotoViewerScale(1);
    setPhotoViewerX(0);
    setPhotoViewerY(0);
    viewerPointersRef.current.clear();
    viewerGestureRef.current = null;
  }, [viewerIdx]);

  React.useEffect(() => {
    const el = contractFrameRef.current;
    if (!el) return;
    const BASE_W = 720;
    const BASE_H = 1040;
    const PREVIEW_SHRINK = 0.96;

    const computeFromRect = (rect: DOMRect) => {
      const w = rect.width || 0;
      const h = rect.height || 0;
      if (!w || !h) return null;
      const fitW = w / BASE_W;
      const fitH = h / BASE_H;
      const fit = Math.min(fitW, fitH) * PREVIEW_SHRINK;
      return Math.max(0.12, Math.min(0.84, fit));
    };

    const computeFromWindow = () => {
      // iOS/PWA sometimes reports 0-size rects for below-the-fold content.
      // Use conservative fallbacks so we never leave scale at 1.
      const vw = Math.max(0, Number(window.innerWidth) || 0);
      const vh = Math.max(0, Number(window.innerHeight) || 0);
      const w = Math.max(0, vw - 32); // page padding
      const h = Math.max(0, Math.min(520, vh - 220));
      if (!w || !h) return null;
      const fitW = w / BASE_W;
      const fitH = h / BASE_H;
      const fit = Math.min(fitW, fitH) * PREVIEW_SHRINK;
      return Math.max(0.12, Math.min(0.84, fit));
    };

    const compute = () => {
      const rect = el.getBoundingClientRect();
      const fromRect = computeFromRect(rect);
      const next = fromRect ?? computeFromWindow();
      if (typeof next === "number" && Number.isFinite(next) && next > 0) {
        setContractScale(next);
      }
    };
    const ro = new ResizeObserver(() => {
      compute();
    });
    ro.observe(el);
    // Retry a few times because iOS/PWA can delay layout until after paint.
    compute();
    const t1 = window.setTimeout(compute, 60);
    const t2 = window.setTimeout(compute, 260);
    const t3 = window.setTimeout(compute, 900);

    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, { passive: true });
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    vv?.addEventListener("resize", compute);
    vv?.addEventListener("scroll", compute);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute);
      vv?.removeEventListener("resize", compute);
      vv?.removeEventListener("scroll", compute);
      ro.disconnect();
    };
  }, []);

  const title = String(draft?.title || draft?.customerName || draft?.projectAddress || draft?.selectedStyle?.name || `Quote #${id}`);
  const items = Array.isArray(draft?.items) ? draft!.items! : [];
  const totals = React.useMemo(() => computeTotals(items, 0, 0, 0), [items]);

  const preInstall = React.useMemo(() => normalizePreInstallPhotos((draft as any)?.preInstallPhotos), [draft]);
  const projectPhotoSrc = (() => {
    const url = (draft as any)?.projectPhotoUrl;
    if (typeof url === "string" && url) return url;
    const data = (draft as any)?.projectPhotoDataUrl;
    if (typeof data === "string" && data) return data;
    return "";
  })();
  const hasProjectPhoto = Boolean(projectPhotoSrc);
  const viewerItems = React.useMemo(() => {
    const out: Array<{ src: string; note?: string; label: string }> = [];
    if (projectPhotoSrc) {
      out.push({ src: projectPhotoSrc, label: "Project photo" });
    }
    for (const p of preInstall) {
      out.push({ src: p.src, note: p.note, label: "Pre-install" });
    }
    return out;
  }, [projectPhotoSrc, preInstall]);

  const curViewer = typeof viewerIdx === "number" && viewerIdx >= 0 && viewerIdx < viewerItems.length
    ? viewerItems[viewerIdx]
    : null;

  const segments = Array.isArray(draft?.segments) ? draft!.segments! : [];
  const totalLf = segments.reduce((sum, s) => sum + (Number(s.length) || 0), 0);

  const removalLf = segments
    .filter((s: any) => Boolean((s as any).removed) || Boolean((s as any).removal))
    .reduce((sum, s) => sum + (Number((s as any).length) || 0), 0);
  const removalTotalComputed = Math.round(removalLf * 5 * 100) / 100;

  const feeNames = new Set(["Disposal", "Delivery", "Equipment Fees"]);
  const materialsSubtotal = items.filter((i) => i.section === "materials").reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
  const materialsFees = items
    .filter((i) => i.section === "materials" && feeNames.has(i.name))
    .reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
  const materialsUsed = (Number(materialsSubtotal) || 0) - materialsFees;
  const additionalServicesSubtotal = items.filter((i) => i.section === "additional").reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
  const persistedMaterialsAndExpensesTotal = Number((draft as any)?.totals?.materialsSubtotal);
  const takeoffMaterialsRaw = Array.isArray((draft as any)?.takeoffMaterials) ? (((draft as any).takeoffMaterials as any[]) as QuoteItem[]) : [];
  const takeoffMaterials = (Array.isArray(takeoffMaterialsRaw) ? takeoffMaterialsRaw : []).filter(
    (i) => i && (i as any).section === "materials"
  );
  const takeoffManualRaw = Array.isArray((draft as any)?.takeoffManualItems)
    ? (((draft as any).takeoffManualItems as any[]) as QuoteItem[])
    : [];
  const takeoffManualItems = (Array.isArray(takeoffManualRaw) ? takeoffManualRaw : []).filter(
    (i) => i && (i as any).section === "materials"
  );
  const materialsAndExpensesTotal = Number.isFinite(persistedMaterialsAndExpensesTotal)
    ? persistedMaterialsAndExpensesTotal
    : computeMaterialsAndExpensesTotal(
        (Array.isArray(items) && items.length > 0
          ? items
          : ([...takeoffMaterials, ...takeoffManualItems] as QuoteItem[])) as QuoteItem[]
      );

  const laborBaseTotal = items
    .filter((i) => i.section === "labor" && String(i.name || "") === "Days labor")
    .reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
  const laborFeeItems = items
    .filter((i) => i.section === "labor" && String(i.name || "") !== "Days labor")
    .map((i) => ({ name: String(i.name || ""), lineTotal: Math.round((Number(i.lineTotal) || 0) * 100) / 100 }))
    .filter((i) => i.lineTotal !== 0);
  const additionalSectionFeeItems = items
    .filter((i) => i.section === "additional")
    .map((i) => ({ name: String(i.name || ""), lineTotal: Math.round((Number(i.lineTotal) || 0) * 100) / 100 }))
    .filter((i) => i.lineTotal !== 0);
  const additionalFeeItems = [...laborFeeItems, ...additionalSectionFeeItems];
  const laborFeesTotal = additionalFeeItems.reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);

  const persistedLaborSubtotal = Number((draft as any)?.totals?.laborSubtotal);
  const laborBaseTotalForView = Number.isFinite(persistedLaborSubtotal) ? persistedLaborSubtotal : laborBaseTotal;

  const persistedAdditionalSubtotal = Number((draft as any)?.totals?.additionalSubtotal);
  const laborFeesTotalForView = Number.isFinite(persistedAdditionalSubtotal) ? persistedAdditionalSubtotal : laborFeesTotal;

  const persistedRemovalTotal = Number((draft as any)?.totals?.removalTotal);
  const removalTotal = Number.isFinite(persistedRemovalTotal) ? persistedRemovalTotal : removalTotalComputed;

  const persistedTotal = Number((draft as any)?.totals?.total);

  const totalComputed = Math.round(
    ((Number(materialsAndExpensesTotal) || 0) + (Number(laborBaseTotalForView) || 0) + (Number(laborFeesTotalForView) || 0) + (Number(removalTotal) || 0)) *
      100
  ) / 100;
  const total = Number.isFinite(persistedTotal) ? Math.round(persistedTotal * 100) / 100 : totalComputed;
  const persistedDepositTotal = Number((draft as any)?.totals?.depositTotal);
  const depositTotal = Number.isFinite(persistedDepositTotal)
    ? Math.round(persistedDepositTotal * 100) / 100
    : Math.round((Number(materialsAndExpensesTotal) || 0) * 100) / 100;

  const phoneDigits = String(draft?.phoneNumber || "").replace(/[^0-9+]/g, "");
  const canCall = phoneDigits.length >= 7;
  const canMessage = phoneDigits.length >= 7;
  const canNavigate = String(draft?.projectAddress || "").trim().length > 0;

  const smsBody = (() => {
    const full = String(draft?.customerName || "").trim();
    const cleaned = full.replace(/,+/g, " ").trim();
    const first = cleaned ? (cleaned.split(/\s+/g).filter(Boolean)[0] || "") : "";
    return first ? `Hi ${first}` : "Hi";
  })();
  const smsHref = `sms:${phoneDigits}?&body=${encodeURIComponent(smsBody)}`;

  function viewContract() {
    try {
      if (draft?.contract) {
        try {
          window.localStorage.setItem("vf_contract_preview_v1", JSON.stringify(draft.contract));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    try {
      window.location.href = `/estimates/contract?draft=${encodeURIComponent(id)}`;
    } catch {
      try {
        router.push(`/estimates/contract?draft=${encodeURIComponent(id)}`);
      } catch {
        // ignore
      }
    }
  }

  if (!id) {
    return (
      <div className="space-y-4">
        <SectionTitle title="Quote" />
        <GlassCard className="p-4">
          <div className="text-sm text-[var(--muted)]">Missing quote id.</div>
        </GlassCard>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xl font-black tracking-tight">Quote</div>
            <div className="text-sm text-[var(--muted)]">Not found.</div>
          </div>
          <Link href="/quotes"><SecondaryButton>Back</SecondaryButton></Link>
        </div>

        <GlassCard className="p-4">
          <div className="text-sm text-[var(--muted)]">This saved quote could not be loaded.</div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-[calc(env(safe-area-inset-bottom)+96px)]">
      {portalReady
        ? createPortal(
          <div className="fixed left-4 z-[70]" style={{ bottom: "calc(env(safe-area-inset-bottom) + 88px)" }}>
            <PrimaryButton
              data-no-swipe="true"
              onClick={() => window.history.back()}
              className="bg-[rgba(31,200,120,.30)] hover:bg-[rgba(31,200,120,.38)] border-[rgba(31,200,120,.40)]"
            >
              Back
            </PrimaryButton>
          </div>,
          document.body
        )
        : null}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xl font-black tracking-tight truncate">{title}</div>
          <div className="text-sm text-[var(--muted)]">Read-only view</div>
        </div>
        <div className="flex flex-wrap justify-start sm:justify-end gap-2 max-w-full">
          <Link href={`/estimates?clone=${encodeURIComponent(id)}`}><SecondaryButton>Additional quote</SecondaryButton></Link>
          <Link href={`/estimates?draft=${encodeURIComponent(id)}`}><PrimaryButton>Edit</PrimaryButton></Link>
        </div>
      </div>

      <SectionTitle title="Customer" />
      <GlassCard className="p-4 mb-4">
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Name</div>
            <div className="font-extrabold text-right">{draft.customerName || ""}</div>
          </div>
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Phone</div>
            <div className="font-extrabold text-right">{draft.phoneNumber || ""}</div>
          </div>
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Email</div>
            <div className="font-extrabold text-right">{draft.email || ""}</div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <SecondaryButton data-no-swipe="true" onClick={viewContract}>
            Open contract
          </SecondaryButton>
        </div>
      </GlassCard>

      {portalReady && curViewer ? createPortal(
        <div className="fixed inset-0 z-[80] grid place-items-center p-3" data-no-swipe="true">
          <div
            className="absolute inset-0 bg-[rgba(0,0,0,.75)]"
            onClick={() => setViewerIdx(null)}
          />
          <div
            className="relative w-full max-w-[980px]"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <GlassCard className="p-3 overflow-hidden">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-black truncate">{curViewer.label}</div>
                <div className="flex items-center gap-2">
                  <SecondaryButton
                    data-no-swipe="true"
                    disabled={viewerIdx === 0}
                    onClick={() => setViewerIdx((v) => (typeof v === "number" ? Math.max(0, v - 1) : v))}
                  >
                    Prev
                  </SecondaryButton>
                  <SecondaryButton
                    data-no-swipe="true"
                    disabled={typeof viewerIdx !== "number" || viewerIdx >= viewerItems.length - 1}
                    onClick={() => setViewerIdx((v) => (typeof v === "number" ? Math.min(viewerItems.length - 1, v + 1) : v))}
                  >
                    Next
                  </SecondaryButton>
                  <SecondaryButton data-no-swipe="true" onClick={() => setViewerIdx(null)}>Close</SecondaryButton>
                </div>
              </div>

              <div
                className="mt-2 relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] touch-none"
                style={{ touchAction: "none" }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  (e.currentTarget as any).setPointerCapture?.(e.pointerId);
                  viewerPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                  const pts = Array.from(viewerPointersRef.current.values());
                  if (pts.length === 1) {
                    viewerGestureRef.current = {
                      startScale: photoViewerScale,
                      startX: photoViewerX,
                      startY: photoViewerY,
                      startDist: 0,
                      startCenter: { x: pts[0].x, y: pts[0].y }
                    };
                    return;
                  }
                  if (pts.length >= 2) {
                    const a = pts[0];
                    const b = pts[1];
                    viewerGestureRef.current = {
                      startScale: photoViewerScale,
                      startX: photoViewerX,
                      startY: photoViewerY,
                      startDist: dist(a, b) || 1,
                      startCenter: centerOf(a, b)
                    };
                  }
                }}
                onPointerMove={(e) => {
                  if (!viewerPointersRef.current.has(e.pointerId)) return;
                  viewerPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                  const g = viewerGestureRef.current;
                  if (!g) return;
                  const pts = Array.from(viewerPointersRef.current.values());
                  if (pts.length >= 2) {
                    const a = pts[0];
                    const b = pts[1];
                    const center = centerOf(a, b);
                    const dNow = dist(a, b) || 1;
                    const nextScale = clamp(g.startScale * (dNow / (g.startDist || 1)), 1, 5);
                    const dx = center.x - g.startCenter.x;
                    const dy = center.y - g.startCenter.y;
                    setPhotoViewerScale(nextScale);
                    setPhotoViewerX(g.startX + dx);
                    setPhotoViewerY(g.startY + dy);
                    return;
                  }
                  if (pts.length === 1) {
                    const p = pts[0];
                    const dx = p.x - g.startCenter.x;
                    const dy = p.y - g.startCenter.y;
                    setPhotoViewerX(g.startX + dx);
                    setPhotoViewerY(g.startY + dy);
                  }
                }}
                onPointerUp={(e) => {
                  viewerPointersRef.current.delete(e.pointerId);
                  const pts = Array.from(viewerPointersRef.current.values());
                  if (pts.length === 1) {
                    viewerGestureRef.current = {
                      startScale: photoViewerScale,
                      startX: photoViewerX,
                      startY: photoViewerY,
                      startDist: 0,
                      startCenter: { x: pts[0].x, y: pts[0].y }
                    };
                  }
                  if (viewerPointersRef.current.size === 0) viewerGestureRef.current = null;
                }}
                onPointerCancel={(e) => {
                  viewerPointersRef.current.delete(e.pointerId);
                  if (viewerPointersRef.current.size === 0) viewerGestureRef.current = null;
                }}
                onDoubleClick={() => {
                  setPhotoViewerScale(1);
                  setPhotoViewerX(0);
                  setPhotoViewerY(0);
                }}
              >
                <img
                  src={curViewer.src}
                  alt=""
                  className="block w-full h-full object-contain"
                  style={{
                    transform: `translate3d(${photoViewerX}px, ${photoViewerY}px, 0) scale(${photoViewerScale})`,
                    transformOrigin: "center center",
                    willChange: "transform"
                  }}
                  draggable={false}
                />
              </div>

              {curViewer.note ? (
                <div className="mt-2 rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] px-3 py-2 text-[12px] font-black text-[rgba(255,255,255,.90)]">
                  {curViewer.note}
                </div>
              ) : null}
            </GlassCard>
          </div>
        </div>,
        document.body
      ) : null}

      <SectionTitle title="Job details" />
      <GlassCard className="p-4">
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Address</div>
            <div className="font-extrabold text-right">{draft.projectAddress || ""}</div>
          </div>
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Style</div>
            <div className="font-extrabold text-right">{draft.selectedStyle?.name || ""}</div>
          </div>
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">LF</div>
            <div className="font-extrabold text-right">{Math.round(totalLf)} LF</div>
          </div>
          {draft.notes ? (
            <div className="pt-2 text-[11px] text-[var(--muted)] whitespace-pre-wrap">{draft.notes}</div>
          ) : null}
        </div>
      </GlassCard>

      <SectionTitle title="Totals" />
      <GlassCard className="p-4">
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Materials &amp; expenses</div>
            <div className="font-extrabold">{money(materialsAndExpensesTotal)}</div>
          </div>
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Additional fees</div>
            <div className="font-extrabold">{money(laborFeesTotalForView)}</div>
          </div>
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Fence removal</div>
            <div className="font-extrabold">{money(removalTotal)}</div>
          </div>
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Labor</div>
            <div className="font-extrabold">{money(laborBaseTotalForView)}</div>
          </div>

          <div className="h-px bg-[rgba(255,255,255,.12)] my-1" />
          <div className="flex justify-between gap-3">
            <div className="font-black">TOTAL</div>
            <div className="font-black">{money(total)}</div>
          </div>
        </div>
      </GlassCard>

      <SectionTitle title="Attachments" />
      <GlassCard className="p-4">
        <div className="grid gap-2">
          {hasProjectPhoto ? (
            <div className="mt-2">
              <div className="text-[11px] text-[var(--muted)] mb-2">Project photo</div>
              <button
                type="button"
                data-no-swipe="true"
                onClick={() => setViewerIdx(0)}
                className="block w-full text-left"
              >
                <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]">
                  <img
                    src={projectPhotoSrc}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                    draggable={false}
                  />
                </div>
              </button>
            </div>
          ) : null}

          {preInstall.length ? (
            <div className="mt-3">
              <div className="text-[11px] text-[var(--muted)] mb-2">Pre-install photos</div>
              <div className="grid grid-cols-3 gap-2">
                {preInstall.map((p, idx) => (
                  <div key={`${draft.id}:pre:${idx}`} className="grid gap-1">
                    <button
                      type="button"
                      data-no-swipe="true"
                      onClick={() => setViewerIdx((hasProjectPhoto ? 1 : 0) + idx)}
                      className="block w-full text-left"
                    >
                      <div className="relative w-full aspect-square rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]">
                        <img
                          src={p.src}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          draggable={false}
                        />
                      </div>
                    </button>
                    {p.note ? (
                      <div className="text-[11px] text-[var(--muted)] truncate">{p.note}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3">
            <div className="text-[11px] text-[var(--muted)] mb-2">Contract</div>
            <div
              className="rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-white"
            >
              <div ref={contractFrameRef} className="relative w-full h-[420px] sm:h-[520px] overflow-auto bg-white">
                <div
                  className="absolute left-0 top-0"
                  style={{
                    width: 720,
                    height: 1040,
                    transformOrigin: "top left",
                    transform: `scale(${contractScale})`
                  }}
                >
                  <iframe
                    title="Contract"
                    src={`/estimates/contract?draft=${encodeURIComponent(id)}&embed=1`}
                    className="block border-0"
                    style={{ width: 720, height: 1040 }}
                    scrolling="yes"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="text-[var(--muted)]">Photos</div>
            <div className="text-[11px] text-[var(--muted)]">
              {Array.isArray(draft.photos) && draft.photos.length ? `${draft.photos.length} saved` : "None"}
            </div>
          </div>
        </div>
      </GlassCard>

      {portalReady
        ? createPortal(
          <div className="fixed bottom-0 left-0 right-0 z-50 transform-gpu will-change-transform isolate" aria-label="Quote actions">
            <div className="mx-auto max-w-[980px] px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
              <div className="backdrop-blur-ios bg-[rgba(20,30,24,.55)] border border-[var(--stroke)] shadow-glass rounded-2xl h-16 flex items-center justify-around gap-2 px-2">
                <SecondaryButton
                  data-no-swipe="true"
                  disabled={!canCall}
                  onClick={() => {
                    if (!canCall) return;
                    window.location.href = `tel:${phoneDigits}`;
                  }}
                >
                  Call
                </SecondaryButton>
                <SecondaryButton
                  data-no-swipe="true"
                  disabled={!canMessage}
                  onClick={() => {
                    if (!canMessage) return;
                    window.location.href = smsHref;
                  }}
                >
                  Message
                </SecondaryButton>
                <SecondaryButton
                  data-no-swipe="true"
                  disabled={!canNavigate}
                  onClick={() => {
                    if (!canNavigate) return;
                    const q = encodeURIComponent(String(draft.projectAddress || "").trim());
                    window.location.href = `https://www.google.com/maps/search/?api=1&query=${q}`;
                  }}
                >
                  Navigate
                </SecondaryButton>
              </div>
            </div>
          </div>,
          document.body
        )
        : null}
    </div>
  );
}
