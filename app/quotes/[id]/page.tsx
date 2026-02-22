"use client";

import Link from "next/link";
import NextImage from "next/image";
import { useParams, useRouter } from "next/navigation";
import React from "react";
import { createPortal } from "react-dom";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import { fetchDraft } from "@/lib/draftsStore";
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
  projectPhotoDataUrl?: string | null;
  preInstallPhotos?: unknown;
  segments?: Array<{ length: number; removed: boolean }>;
  items?: QuoteItem[];
  contract?: any;
  photos?: Array<{ url: string; createdAt?: number }>;
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

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id ?? "");
  const [draft, setDraft] = React.useState<DraftEntry | null>(null);
  const [portalReady, setPortalReady] = React.useState(false);
  const [viewerIdx, setViewerIdx] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await fetchDraft({ id });
      if (cancelled) return;
      if (remote.ok && remote.draft) {
        setDraft(remote.draft);
        return;
      }
      const store = readDraftStore();
      setDraft(store[id] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  const title = String(draft?.title || draft?.customerName || draft?.projectAddress || draft?.selectedStyle?.name || `Quote #${id}`);
  const items = Array.isArray(draft?.items) ? draft!.items! : [];
  const totals = React.useMemo(() => computeTotals(items, 0, 0, 0), [items]);

  const preInstall = React.useMemo(() => normalizePreInstallPhotos((draft as any)?.preInstallPhotos), [draft]);
  const hasProjectPhoto = typeof (draft as any)?.projectPhotoDataUrl === "string" && Boolean((draft as any)?.projectPhotoDataUrl);
  const viewerItems = React.useMemo(() => {
    const out: Array<{ src: string; note?: string; label: string }> = [];
    const project = (draft as any)?.projectPhotoDataUrl;
    if (typeof project === "string" && project) {
      out.push({ src: project, label: "Project photo" });
    }
    for (const p of preInstall) {
      out.push({ src: p.src, note: p.note, label: "Pre-install" });
    }
    return out;
  }, [draft, preInstall]);

  const curViewer = typeof viewerIdx === "number" && viewerIdx >= 0 && viewerIdx < viewerItems.length
    ? viewerItems[viewerIdx]
    : null;

  const segments = Array.isArray(draft?.segments) ? draft!.segments! : [];
  const totalLf = segments.reduce((sum, s) => sum + (Number(s.length) || 0), 0);

  const removalLf = segments.filter((s) => Boolean(s.removed)).reduce((sum, s) => sum + (Number(s.length) || 0), 0);
  const removalTotal = Math.round(removalLf * 6 * 100) / 100;

  const feeNames = new Set(["Disposal", "Delivery", "Equipment Fees"]);
  const materialsSubtotal = items.filter((i) => i.section === "materials").reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
  const materialsFees = items
    .filter((i) => i.section === "materials" && feeNames.has(i.name))
    .reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
  const materialsUsed = (Number(materialsSubtotal) || 0) - materialsFees;
  const additionalServicesSubtotal = items.filter((i) => i.section === "additional").reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
  const materialsAndExpensesTotal = computeMaterialsAndExpensesTotal(items);

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

  const total = Math.round(
    ((Number(materialsAndExpensesTotal) || 0) + (Number(laborBaseTotal) || 0) + (Number(laborFeesTotal) || 0) + (Number(removalTotal) || 0)) *
      100
  ) / 100;
  const depositTotal = Math.round((Number(materialsAndExpensesTotal) || 0) * 100) / 100;

  const phoneDigits = String(draft?.phoneNumber || "").replace(/[^0-9+]/g, "");
  const canCall = phoneDigits.length >= 7;
  const canMessage = phoneDigits.length >= 7;
  const canNavigate = String(draft?.projectAddress || "").trim().length > 0;

  function viewContract() {
    try {
      if (!draft?.contract) return;
      window.localStorage.setItem("vf_contract_preview_v1", JSON.stringify(draft.contract));
      router.push("/estimates/contract");
    } catch {
      // ignore
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
            <SecondaryButton onClick={() => window.history.back()} data-no-swipe="true">
              Back
            </SecondaryButton>
          </div>,
          document.body
        )
        : null}

      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-black tracking-tight truncate">{title}</div>
          <div className="text-sm text-[var(--muted)]">Read-only view</div>
        </div>
        <div className="flex gap-2">
          <Link href="/quotes"><SecondaryButton>Back</SecondaryButton></Link>
          <SecondaryButton onClick={viewContract} disabled={!draft.contract}>Contract</SecondaryButton>
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

              <div className="mt-2 relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]">
                <NextImage
                  src={curViewer.src}
                  alt=""
                  fill
                  sizes="(max-width: 980px) 92vw, 980px"
                  className="object-contain"
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
            <div className="text-[var(--muted)]">Materials &amp; expenses · Deposit</div>
            <div className="font-extrabold">{money(materialsAndExpensesTotal)}</div>
          </div>
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Labor</div>
            <div className="font-extrabold">{money(laborBaseTotal)}</div>
          </div>
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Fence removal</div>
            <div className="font-extrabold">{money(removalTotal)}</div>
          </div>

          {additionalFeeItems.length ? (
            <div className="mt-1 grid gap-1">
              <div className="text-[11px] font-extrabold text-[var(--muted)]">Additional fees</div>
              {additionalFeeItems.map((f) => (
                <div key={f.name} className="flex justify-between gap-3">
                  <div className="text-[var(--muted)] truncate">{f.name}</div>
                  <div className="font-extrabold">{money(f.lineTotal)}</div>
                </div>
              ))}
            </div>
          ) : null}

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
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="text-[var(--muted)]">Contract</div>
            <SecondaryButton onClick={viewContract} disabled={!draft.contract}>Open</SecondaryButton>
          </div>

          {typeof (draft as any).projectPhotoDataUrl === "string" && (draft as any).projectPhotoDataUrl ? (
            <div className="mt-2">
              <div className="text-[11px] text-[var(--muted)] mb-2">Project photo</div>
              <button
                type="button"
                data-no-swipe="true"
                onClick={() => setViewerIdx(0)}
                className="block w-full text-left"
              >
                <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]">
                  <NextImage
                    src={(draft as any).projectPhotoDataUrl}
                    alt=""
                    fill
                    sizes="(max-width: 980px) 92vw, 980px"
                    className="object-cover"
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
                        <NextImage src={p.src} alt="" fill sizes="120px" className="object-cover" />
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
                    window.location.href = `sms:${phoneDigits}`;
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
