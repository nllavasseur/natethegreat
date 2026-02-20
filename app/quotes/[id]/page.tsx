"use client";

import Link from "next/link";
import NextImage from "next/image";
import { useParams, useRouter } from "next/navigation";
import React from "react";
import { createPortal } from "react-dom";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";
import type { QuoteItem } from "@/lib/types";
import { money } from "@/lib/money";
import { computeTotals } from "@/lib/totals";

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

  React.useEffect(() => {
    const store = readDraftStore();
    setDraft(store[id] ?? null);
  }, [id]);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  const title = String(draft?.title || draft?.customerName || draft?.projectAddress || draft?.selectedStyle?.name || `Quote #${id}`);
  const items = Array.isArray(draft?.items) ? draft!.items! : [];
  const totals = React.useMemo(() => computeTotals(items, 0, 0, 0), [items]);

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
  const materialsAndExpensesTotal = Math.round(
    (materialsUsed * 1.08 + materialsFees + (Number(additionalServicesSubtotal) || 0) * 0.2) * 100
  ) / 100;
  const laborTotal = Math.round(((Number(totals.laborSubtotal) || 0) + (Number(removalTotal) || 0)) * 100) / 100;
  const total = Math.round(((Number(materialsAndExpensesTotal) || 0) + laborTotal) * 100) / 100;
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
            <div className="text-[var(--muted)]">Labor</div>
            <div className="font-extrabold">{money(laborTotal)}</div>
          </div>
          <div className="flex justify-between gap-3">
            <div className="text-[var(--muted)]">Deposit total</div>
            <div className="font-extrabold">{money(depositTotal)}</div>
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
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="text-[var(--muted)]">Contract</div>
            <SecondaryButton onClick={viewContract} disabled={!draft.contract}>Open</SecondaryButton>
          </div>

          {typeof (draft as any).projectPhotoDataUrl === "string" && (draft as any).projectPhotoDataUrl ? (
            <div className="mt-2">
              <div className="text-[11px] text-[var(--muted)] mb-2">Project photo</div>
              <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]">
                <NextImage
                  src={(draft as any).projectPhotoDataUrl}
                  alt=""
                  fill
                  sizes="(max-width: 980px) 92vw, 980px"
                  className="object-cover"
                />
              </div>
            </div>
          ) : null}

          {normalizePreInstallPhotos((draft as any).preInstallPhotos).length ? (
            <div className="mt-3">
              <div className="text-[11px] text-[var(--muted)] mb-2">Pre-install photos</div>
              <div className="grid grid-cols-3 gap-2">
                {normalizePreInstallPhotos((draft as any).preInstallPhotos).map((p, idx) => (
                  <div key={`${draft.id}:pre:${idx}`} className="grid gap-1">
                    <div className="relative w-full aspect-square rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]">
                      <NextImage src={p.src} alt="" fill sizes="120px" className="object-cover" />
                    </div>
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
