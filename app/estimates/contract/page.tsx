"use client";

import React from "react";
import { createPortal } from "react-dom";
import { money } from "@/lib/money";
import { DEFAULT_WORKSPACE_ID, fetchDraft, resolveWorkspaceId } from "@/lib/draftsStore";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { computeMaterialsAndExpensesTotal } from "@/lib/totals";
import type { QuoteItem } from "@/lib/types";

function readDraftStore(): Record<string, any> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("vf_estimate_drafts_v1");
    return raw ? (JSON.parse(raw) as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function readUnsavedSnapshot(): any | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("vf_estimate_unsaved_snapshot_v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function snapshotMatchesDraftId(snap: any, draftId: string) {
  try {
    if (!snap || typeof snap !== "object") return false;
    const a = typeof (snap as any).draftParam === "string" ? String((snap as any).draftParam) : "";
    const b = typeof (snap as any).draftId === "string" ? String((snap as any).draftId) : "";
    const did = String(draftId || "").trim();
    return Boolean(did) && (a === did || b === did);
  } catch {
    return false;
  }
}

function buildContractFromDraft(draftId: string, draft: any): ContractData {
  const items: QuoteItem[] = Array.isArray(draft?.items) ? (draft.items as QuoteItem[]) : [];
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

  const tenPercentDiscountEnabled = Boolean((draft as any)?.tenPercentDiscountEnabled);

  const segments = (() => {
    try {
      return Array.isArray(draft?.segments) ? (draft.segments as any[]) : [];
    } catch {
      return [] as any[];
    }
  })();

  const totalLf = (() => {
    try {
      const lf = segments
        .filter((s) => !Boolean((s as any)?.removed))
        .reduce((sum, s) => sum + (Number((s as any)?.length) || 0), 0);
      return Math.round(lf * 100) / 100;
    } catch {
      return 0;
    }
  })();

  const gateCounts = (() => {
    try {
      const eligible = segments.filter((s) => !Boolean((s as any)?.removed));
      const walk = eligible.filter((s) => (s as any)?.gateType === "walk" || ((s as any)?.gateType == null && Boolean((s as any)?.gate))).length;
      const dbl = eligible.filter((s) => (s as any)?.gateType === "double").length;
      return { walk, dbl };
    } catch {
      return { walk: 0, dbl: 0 };
    }
  })();

  const removalTotal = (() => {
    try {
      const lf = segments
        .filter((s) => Boolean((s as any)?.removal) || Boolean((s as any)?.removed))
        .reduce((sum, s) => sum + (Number((s as any)?.length) || 0), 0);
      const v = lf > 0 ? lf * 5 : 0;
      return Math.round(v * 100) / 100;
    } catch {
      return 0;
    }
  })();

  const splitWithNeighborsEnabled = Boolean((draft as any)?.splitWithNeighborsEnabled);
  const parties = (() => {
    try {
      const raw = Array.isArray((draft as any)?.parties) ? ((draft as any).parties as any[]) : [];
      return raw
        .filter((p) => p && typeof p === "object")
        .map((p) => ({
          id: String((p as any).id || "").trim(),
          name: String((p as any).name || "")
        }))
        .filter((p) => Boolean(p.id));
    } catch {
      return [] as Array<{ id: string; name: string }>;
    }
  })();
  const splitEnabled = splitWithNeighborsEnabled && parties.length >= 2;

  const sharedAndSplit = (() => {
    try {
      const comboCards = Array.isArray((draft as any)?.comboCards) ? ((draft as any).comboCards as any[]) : [];
      const baseCardId = typeof comboCards?.[0]?.id === "string" ? String(comboCards[0].id) : null;
      const resolveSegmentCardId = (seg: any) => {
        const cid = seg?.cardId ?? null;
        return cid === null ? baseCardId : cid;
      };

      const computeSharedLfLegacy = () => {
        const sharedCardIds = new Set(
          comboCards
            .filter((c, idx) => idx > 0 && Boolean((c as any)?.shared))
            .map((c) => String((c as any)?.id || ""))
            .filter((id) => Boolean(id))
        );
        if (!sharedCardIds.size) return 0;
        return segments
          .filter((s) => !Boolean((s as any)?.removed))
          .filter((s) => (Number((s as any)?.length) || 0) > 0)
          .filter((s) => sharedCardIds.has(String(resolveSegmentCardId(s) || "")))
          .reduce((sum, s) => sum + (Number((s as any)?.length) || 0), 0);
      };

      const sharedLf = splitEnabled
        ? segments
            .filter((s) => !Boolean((s as any)?.removed))
            .filter((s) => (Number((s as any)?.length) || 0) > 0)
            .filter((s) => String((s as any)?.payerType || "").trim() === "shared")
            .reduce((sum, s) => sum + (Number((s as any)?.length) || 0), 0)
        : computeSharedLfLegacy();

      const totalsForBreakdown = (() => {
        const persisted = (draft as any)?.totals as any;
        const persistedMaterialsSubtotal = Number(persisted?.materialsSubtotal);
        const persistedLaborSubtotal = Number(persisted?.laborSubtotal);
        const persistedAdditionalSubtotal = Number(persisted?.additionalSubtotal);
        const persistedRemovalTotal = Number(persisted?.removalTotal);
        const persistedTotal = Number(persisted?.total);
        const persistedDepositTotal = Number(persisted?.depositTotal);

        const hasPersistedTotals =
          Number.isFinite(persistedMaterialsSubtotal) &&
          Number.isFinite(persistedLaborSubtotal) &&
          Number.isFinite(persistedAdditionalSubtotal) &&
          Number.isFinite(persistedTotal);

        const additionalServicesTotal = items
          .filter((i) => i && (i as any).section === "additional")
          .reduce((a, b) => a + (Number((b as any).lineTotal) || 0), 0);
        const laborBaseTotal = items
          .filter((i) => i && (i as any).section === "labor")
          .filter((i) => String((i as any).name || "") === "Days labor")
          .reduce((a, b) => a + (Number((b as any).lineTotal) || 0), 0);
        const laborFeeTotal = items
          .filter((i) => i && (i as any).section === "labor")
          .filter((i) => String((i as any).name || "") !== "Days labor")
          .reduce((a, b) => a + (Number((b as any).lineTotal) || 0), 0);

        const takeoffMaterialsRaw: QuoteItem[] = Array.isArray(draft?.takeoffMaterials) ? (draft.takeoffMaterials as QuoteItem[]) : [];
        const takeoffMaterials = (Array.isArray(takeoffMaterialsRaw) ? takeoffMaterialsRaw : []).filter(
          (i) => i && (i as any).section === "materials"
        );
        const takeoffManualRaw: QuoteItem[] = Array.isArray((draft as any)?.takeoffManualItems)
          ? (((draft as any).takeoffManualItems as any[]) as QuoteItem[])
          : [];
        const takeoffManualItems = (Array.isArray(takeoffManualRaw) ? takeoffManualRaw : []).filter(
          (i) => i && (i as any).section === "materials"
        );

        const materialsAndExpensesTotalWithManual = hasPersistedTotals
          ? round2(persistedMaterialsSubtotal)
          : round2(
              computeMaterialsAndExpensesTotal(
                (takeoffMaterials?.length || 0) > 0
                  ? ([...takeoffMaterials, ...takeoffManualItems] as QuoteItem[])
                  : ([...items, ...takeoffManualItems] as QuoteItem[])
              )
            );
        const tenPercentDiscountEnabled = Boolean((draft as any)?.tenPercentDiscountEnabled);
        const tenPercentDiscountValue = tenPercentDiscountEnabled ? round2(materialsAndExpensesTotalWithManual * 0.1) : 0;
        const materialsAndExpensesDiscounted = round2(materialsAndExpensesTotalWithManual - tenPercentDiscountValue);

        const additionalFeesTotal = hasPersistedTotals
          ? round2(persistedAdditionalSubtotal)
          : round2((Number(additionalServicesTotal) || 0) + (Number(laborFeeTotal) || 0));
        const laborBaseTotalRounded = hasPersistedTotals ? round2(persistedLaborSubtotal) : round2(laborBaseTotal);
        const removalTotalRounded = Number.isFinite(persistedRemovalTotal) ? round2(persistedRemovalTotal) : round2(removalTotal);
        const depositTotalWithManual = Number.isFinite(persistedDepositTotal) ? round2(persistedDepositTotal) : round2(materialsAndExpensesDiscounted);
        const jobTotal = Number.isFinite(persistedTotal)
          ? round2(persistedTotal)
          : round2(materialsAndExpensesDiscounted + additionalFeesTotal + removalTotalRounded + laborBaseTotalRounded);

        return {
          jobTotal,
          depositTotalWithManual,
          laborBaseTotalRounded,
          additionalFeesTotal,
          removalTotalRounded
        };
      })();

      const sharedTotal = (() => {
        const lf = Number(totalLf) || 0;
        if (lf <= 0) return 0;
        const perLf = (Number(totalsForBreakdown.jobTotal) || 0) / lf;
        return Math.round(perLf * (Number(sharedLf) || 0) * 100) / 100;
      })();

      const computeSplitBreakdown = () => {
        if (!splitEnabled) return null;
        const safeParties = parties;
        const partyIdSet = new Set(safeParties.map((p) => p.id));
        const primaryPartyId = safeParties[0]?.id || "";

        const eligibleSegments = segments
          .filter((s) => s && typeof s === "object")
          .filter((s) => !Boolean((s as any).removed))
          .filter((s) => (Number((s as any).length) || 0) > 0);

        const lfShare: Record<string, number> = {};
        const removalLfShare: Record<string, number> = {};
        for (const p of safeParties) {
          lfShare[p.id] = 0;
          removalLfShare[p.id] = 0;
        }

        let sharedLfRaw = 0;
        let totalLfRaw = 0;
        let totalRemovalLfRaw = 0;

        const cardLabelFor = (seg: any) => {
          const cid = resolveSegmentCardId(seg);
          if (!cid) return "";
          const idx = comboCards.findIndex((c) => String((c as any)?.id || "") === String(cid));
          const card = idx >= 0 ? comboCards[idx] : null;
          const label = card && typeof (card as any).label === "string" ? String((card as any).label || "") : "";
          const base = idx >= 0 ? `Card ${idx + 1}` : "Card";
          return label.trim() ? `${base} - ${label.trim()}` : base;
        };

        const segmentBreakdown = eligibleSegments.map((seg: any) => {
          const length = Number(seg.length) || 0;
          totalLfRaw += length;

          const payerTypeRaw = String(seg.payerType || "").trim();
          const payerType: "individual" | "shared" = payerTypeRaw === "shared" ? "shared" : "individual";

          const individualIdRaw = typeof seg.payerPartyId === "string" ? String(seg.payerPartyId || "").trim() : "";
          const sharedIdsRaw = Array.isArray(seg.payerPartyIds) ? (seg.payerPartyIds as any[]).map((x) => String(x || "").trim()) : [];
          const sharedIds = sharedIdsRaw.filter((id) => partyIdSet.has(id));

          const finalType = payerType === "shared" && sharedIds.length >= 2 ? "shared" : "individual";
          const finalIndividualId = partyIdSet.has(individualIdRaw) ? individualIdRaw : primaryPartyId;
          const finalSharedIds = sharedIds.length >= 2 ? sharedIds : [];

          const participants = finalType === "shared" ? finalSharedIds : [finalIndividualId];
          if (finalType === "shared") sharedLfRaw += length;

          const per = participants.length ? length / participants.length : 0;
          for (const pid of participants) {
            lfShare[pid] = (Number(lfShare[pid]) || 0) + per;
          }

          const removal = Boolean((seg as any).removal) || Boolean((seg as any).removed);
          if (removal) {
            totalRemovalLfRaw += length;
            for (const pid of participants) {
              removalLfShare[pid] = (Number(removalLfShare[pid]) || 0) + per;
            }
          }

          return {
            id: String(seg.id || ""),
            label: String(seg.label || ""),
            length,
            removal,
            gateType: String(seg.gateType || "none"),
            payerType: finalType,
            payerPartyId: finalType === "individual" ? finalIndividualId : undefined,
            payerPartyIds: finalType === "shared" ? finalSharedIds : undefined,
            cardId: resolveSegmentCardId(seg),
            cardLabel: cardLabelFor(seg)
          };
        });

        const allocateCents = (total: number, shares: Record<string, number>) => {
          const centsTotal = Math.round((Number(total) || 0) * 100);
          const totalShare = Object.values(shares).reduce((a, b) => a + (Number(b) || 0), 0);
          const base: Record<string, number> = {};
          if (centsTotal === 0) {
            for (const p of safeParties) base[p.id] = 0;
            return base;
          }
          if (totalShare <= 0) {
            for (const p of safeParties) base[p.id] = 0;
            const fallbackId = String(primaryPartyId || safeParties[0]?.id || "").trim();
            if (fallbackId) base[fallbackId] = centsTotal;
            return base;
          }
          const tmp = safeParties.map((p) => {
            const share = Number(shares[p.id]) || 0;
            const raw = (centsTotal * share) / totalShare;
            const floored = Math.floor(raw);
            return { id: p.id, floored, frac: raw - floored };
          });
          const sumBase = tmp.reduce((a, b) => a + b.floored, 0);
          let remainder = centsTotal - sumBase;
          tmp.sort((a, b) => b.frac - a.frac);
          for (const t of tmp) base[t.id] = t.floored;
          let i = 0;
          while (remainder > 0 && tmp.length) {
            const id = tmp[i % tmp.length].id;
            base[id] = (base[id] || 0) + 1;
            remainder -= 1;
            i += 1;
          }
          return base;
        };

        const additionalCents = (() => {
          const base: Record<string, number> = {};
          for (const p of safeParties) base[p.id] = 0;

          const feeItems = (Array.isArray(items) ? items : [])
            .filter((i) => i && typeof i === "object")
            .filter((i: any) => {
              const section = String(i.section || "").trim();
              if (section === "additional") return true;
              if (section === "labor" && String(i.name || "") !== "Days labor") return true;
              return false;
            })
            .filter((i: any) => Math.round((Number(i.lineTotal) || 0) * 100) !== 0);

          for (const it of feeItems as any[]) {
            const centsTotal = Math.round((Number((it as any).lineTotal) || 0) * 100);
            if (!centsTotal) continue;

            const payerTypeRaw = String((it as any).payerType || "").trim();
            const payerType: "individual" | "shared" = payerTypeRaw === "shared" ? "shared" : "individual";

            const individualIdRaw = typeof (it as any).payerPartyId === "string" ? String((it as any).payerPartyId || "").trim() : "";
            const sharedIdsRaw = Array.isArray((it as any).payerPartyIds)
              ? (((it as any).payerPartyIds as any[]) || []).map((x) => String(x || "").trim())
              : [];
            const sharedIds = sharedIdsRaw.filter((id) => partyIdSet.has(id));

            const finalType = payerType === "shared" && sharedIds.length >= 2 ? "shared" : "individual";
            const finalIndividualId = partyIdSet.has(individualIdRaw) ? individualIdRaw : primaryPartyId;
            const finalSharedIds = sharedIds.length >= 2 ? sharedIds : [];

            const participants = finalType === "shared" ? finalSharedIds : [finalIndividualId];
            const participantSet = new Set(participants);

            const denom = participants.length || 1;
            const per = Math.trunc(centsTotal / denom);
            let remainder = centsTotal - per * denom;

            for (const p of safeParties) {
              if (!participantSet.has(p.id)) continue;
              base[p.id] = (base[p.id] || 0) + per;
              if (remainder > 0) {
                base[p.id] = (base[p.id] || 0) + 1;
                remainder -= 1;
              }
            }
          }

          const expected = Math.round((Number(totalsForBreakdown.additionalFeesTotal) || 0) * 100);
          const actual = Object.values(base).reduce((a, b) => a + (Number(b) || 0), 0);
          const delta = expected - actual;
          if (delta !== 0) {
            const fallbackId = String(primaryPartyId || safeParties[0]?.id || "").trim();
            if (fallbackId) base[fallbackId] = (base[fallbackId] || 0) + delta;
          }

          return base;
        })();

        const materialsCents = allocateCents(totalsForBreakdown.depositTotalWithManual, lfShare);
        const laborCents = allocateCents(totalsForBreakdown.laborBaseTotalRounded, lfShare);
        const removalCents = allocateCents(
          totalsForBreakdown.removalTotalRounded,
          totalRemovalLfRaw > 0 ? removalLfShare : Object.fromEntries(safeParties.map((p) => [p.id, 0]))
        );

        const partiesOut = safeParties.map((p) => {
          const materials = round2((materialsCents[p.id] || 0) / 100);
          const labor = round2((laborCents[p.id] || 0) / 100);
          const additional = round2((additionalCents[p.id] || 0) / 100);
          const removal = round2((removalCents[p.id] || 0) / 100);
          const deposit = materials;
          const total = round2(materials + labor + additional + removal);
          const remaining = Math.max(0, round2(total - deposit));
          return {
            id: p.id,
            name: p.name,
            lfShare: round2(Number(lfShare[p.id]) || 0),
            removalLfShare: round2(Number(removalLfShare[p.id]) || 0),
            materials,
            labor,
            additional,
            removal,
            deposit,
            remaining,
            total
          };
        });

        return {
          segmentBreakdown,
          partyBreakdown: {
            totalLf: round2(totalLfRaw),
            sharedLf: round2(sharedLfRaw),
            removalLf: round2(totalRemovalLfRaw),
            parties: partiesOut
          }
        };
      };

      const breakdown = computeSplitBreakdown();
      return { sharedLf: round2(sharedLf), sharedTotal: round2(sharedTotal), breakdown };
    } catch {
      return { sharedLf: 0, sharedTotal: 0, breakdown: null };
    }
  })();

  const takeoffMaterialsForRowsRaw: QuoteItem[] = Array.isArray(draft?.takeoffMaterials) ? (draft.takeoffMaterials as QuoteItem[]) : [];
  const takeoffMaterialsForRows = (Array.isArray(takeoffMaterialsForRowsRaw) ? takeoffMaterialsForRowsRaw : [])
    .filter((i) => i && (i as any).section === "materials")
    .filter((i) => (Number((i as any).qty) || 0) > 0);
  const takeoffManualForRowsRaw: QuoteItem[] = Array.isArray((draft as any)?.takeoffManualItems)
    ? (((draft as any).takeoffManualItems as any[]) as QuoteItem[])
    : [];
  const takeoffManualForRowsItems = (Array.isArray(takeoffManualForRowsRaw) ? takeoffManualForRowsRaw : [])
    .filter((i) => i && (i as any).section === "materials")
    .filter((i) => (Number((i as any).qty) || 0) > 0);

  const materialsRowSource: QuoteItem[] =
    (takeoffMaterialsForRows?.length || 0) > 0
      ? ([...takeoffMaterialsForRows, ...takeoffManualForRowsItems] as QuoteItem[])
      : ([...items, ...takeoffManualForRowsItems] as QuoteItem[]);
  const materialsRows = materialsRowSource
    .filter((i) => i.section === "materials" && (Number(i.qty) || 0) > 0)
    .map((i) => ({
      name: String(i.name || ""),
      qty: Number(i.qty) || 0,
      unit: String(i.unit || ""),
      unitPrice: Number(i.unitPrice) || 0,
      price: Number(i.lineTotal) || 0
    }));

  const laborRows = items
    .filter((i) => i.section === "labor" && (Number(i.qty) || 0) > 0)
    .map((i) => ({
      name: String(i.name || ""),
      qty: Number(i.qty) || 0,
      unit: String(i.unit || ""),
      unitPrice: Number(i.unitPrice) || 0,
      price: Number(i.lineTotal) || 0
    }));

  const additionalRows = items
    .filter((i) => i.section === "additional" && (Number(i.qty) || 0) > 0)
    .map((i) => ({
      name: String(i.name || ""),
      qty: Number(i.qty) || 0,
      unit: String(i.unit || ""),
      unitPrice: Number(i.unitPrice) || 0,
      price: Number(i.lineTotal) || 0
    }));

  const additionalServicesTotal = additionalRows.reduce((a, b) => a + (Number(b.price) || 0), 0);
  const laborBaseTotal = laborRows
    .filter((r) => String(r.name || "") === "Days labor")
    .reduce((a, b) => a + (Number(b.price) || 0), 0);
  const laborFeeTotal = items
    .filter((i) => i.section === "labor")
    .filter((r) => String(r.name || "") !== "Days labor")
    .reduce((a, b) => a + (Number(b.lineTotal) || 0), 0);

  const persisted = (draft as any)?.totals as any;
  const persistedMaterialsSubtotal = Number(persisted?.materialsSubtotal);
  const persistedLaborSubtotal = Number(persisted?.laborSubtotal);
  const persistedAdditionalSubtotal = Number(persisted?.additionalSubtotal);
  const persistedRemovalTotal = Number(persisted?.removalTotal);
  const persistedTotal = Number(persisted?.total);
  const persistedDepositTotal = Number(persisted?.depositTotal);

  const hasPersistedTotals =
    Number.isFinite(persistedMaterialsSubtotal) &&
    Number.isFinite(persistedLaborSubtotal) &&
    Number.isFinite(persistedAdditionalSubtotal) &&
    Number.isFinite(persistedTotal);

  const takeoffMaterialsRaw: QuoteItem[] = Array.isArray(draft?.takeoffMaterials) ? (draft.takeoffMaterials as QuoteItem[]) : [];
  const takeoffMaterials = (Array.isArray(takeoffMaterialsRaw) ? takeoffMaterialsRaw : []).filter(
    (i) => i && (i as any).section === "materials"
  );
  const takeoffManualRaw: QuoteItem[] = Array.isArray((draft as any)?.takeoffManualItems)
    ? (((draft as any).takeoffManualItems as any[]) as QuoteItem[])
    : [];
  const takeoffManualItems = (Array.isArray(takeoffManualRaw) ? takeoffManualRaw : []).filter(
    (i) => i && (i as any).section === "materials"
  );

  const materialsAndExpensesTotal = hasPersistedTotals
    ? round2(persistedMaterialsSubtotal)
    : round2(computeMaterialsAndExpensesTotal((takeoffMaterials?.length || 0) > 0 ? takeoffMaterials : items));
  const materialsAndExpensesTotalWithManual = hasPersistedTotals
    ? round2(persistedMaterialsSubtotal)
    : round2(
        computeMaterialsAndExpensesTotal(
          (takeoffMaterials?.length || 0) > 0
            ? ([...takeoffMaterials, ...takeoffManualItems] as QuoteItem[])
            : ([...items, ...takeoffManualItems] as QuoteItem[])
        )
      );

  const tenPercentDiscountValue = tenPercentDiscountEnabled
    ? round2(materialsAndExpensesTotalWithManual * 0.1)
    : 0;

  const materialsAndExpensesDiscounted = round2(materialsAndExpensesTotalWithManual - tenPercentDiscountValue);
  const additionalFeesTotal = hasPersistedTotals
    ? round2(persistedAdditionalSubtotal)
    : round2((Number(additionalServicesTotal) || 0) + (Number(laborFeeTotal) || 0));
  const laborBaseTotalRounded = hasPersistedTotals ? round2(persistedLaborSubtotal) : round2(laborBaseTotal);
  const removalTotalRounded = Number.isFinite(persistedRemovalTotal) ? round2(persistedRemovalTotal) : round2(removalTotal);
  const depositTotal = Number.isFinite(persistedDepositTotal)
    ? round2(persistedDepositTotal)
    : round2(tenPercentDiscountEnabled ? round2(materialsAndExpensesTotal - round2(materialsAndExpensesTotal * 0.1)) : materialsAndExpensesTotal);
  const depositTotalWithManual = Number.isFinite(persistedDepositTotal)
    ? round2(persistedDepositTotal)
    : round2(materialsAndExpensesDiscounted);
  const grandTotal = hasPersistedTotals
    ? round2(persistedTotal)
    : round2(materialsAndExpensesDiscounted + additionalFeesTotal + removalTotalRounded + laborBaseTotalRounded);

  const estimateName = String(((draft as any)?.title ?? (draft as any)?.estimateName ?? (draft as any)?.name ?? "") || "").trim();
  const customerName = String(draft?.customerName || "");
  const phoneNumber = String(draft?.phoneNumber || "");
  const email = String(draft?.email || "");
  const projectAddress = String(draft?.projectAddress || "");
  const styleTitle = (() => {
    const fb = draft?.fenceBuilder && typeof draft.fenceBuilder === "object" ? (draft.fenceBuilder as any) : null;
    const selectedId = fb ? String(fb.selectedDesignId || "") : "";
    const designs = fb && Array.isArray(fb.designs) ? (fb.designs as any[]) : [];
    const fbDesign = selectedId ? (designs.find((d) => String((d as any)?.id || "") === selectedId) ?? null) : null;
    const fbName = fbDesign ? String((fbDesign as any).name || "").trim() : "";

    const cards = Array.isArray((draft as any)?.comboCards) ? ((draft as any).comboCards as any[]) : [];
    const titles = cards
      .filter((c) => c && c.selectedStyle && typeof c.selectedStyle.name === "string")
      .map((c) => {
        const n = String(c.selectedStyle.name || "");
        if (n.trim().toLowerCase() === "fence builder") return fbName || n;
        return n;
      })
      .map((t) => String(t || "").trim())
      .filter((t) => Boolean(t));

    const uniq: string[] = [];
    for (const t of titles) {
      if (!uniq.includes(t)) uniq.push(t);
    }
    if (uniq.length > 1) return uniq.join(" + ");
    if (uniq.length === 1) return uniq[0];

    const base = String(draft?.selectedStyle?.name || "");
    if (base.trim().toLowerCase() !== "fence builder") return base;
    return fbName || base;
  })();
  const notes = String(draft?.notes || "");

  return {
    company: {
      name: "Vasseur Fencing",
      tagline: "Fencing Contractor",
      salespersonName: "Nathan LaVasseur",
      addressLines: ["1415 Snowmass Rd.", "Columbus, OH 43235"],
      email: "nathan@vasseurfencing.com",
      phone: "(231) 260-0635",
      logoUrl: "/IMG_3454.JPG"
    },
    estimate: {
      id: String(draftId || ""),
      name: estimateName || undefined,
      submittedOn: new Date().toISOString(),
      customer: { name: customerName, phone: phoneNumber, email },
      projectAddress,
      styleTitle,
      totalLf,
      walkGateCount: gateCounts.walk,
      doubleGateCount: gateCounts.dbl,
      sharedLf: Number(sharedAndSplit.sharedLf) || 0,
      sharedTotal: Number(sharedAndSplit.sharedTotal) || 0,
      splitWithNeighborsEnabled: splitEnabled,
      parties: splitEnabled ? (Array.isArray((draft as any)?.parties) ? ((draft as any).parties as any[]) : []) : undefined,
      segmentBreakdown: splitEnabled ? ((sharedAndSplit as any)?.breakdown?.segmentBreakdown as any) : undefined,
      partyBreakdown: splitEnabled ? ((sharedAndSplit as any)?.breakdown?.partyBreakdown as any) : undefined,
      depositTotal: depositTotalWithManual,
      notes,
      disclaimer: "",
      contractText: "By signing below, the homeowner agrees to the scope of work and pricing described in this estimate."
    },
    sections: {
      materials: materialsRows,
      labor: laborRows,
      additional: additionalRows
    },
    totals: {
      materialsSubtotal: depositTotalWithManual,
      laborSubtotal: laborBaseTotalRounded,
      additionalSubtotal: additionalFeesTotal,
      removalTotal: removalTotalRounded,
      discount: tenPercentDiscountValue,
      tax: 0,
      total: grandTotal
    }
  };
}

type ContractRow = { name: string; qty: number; unit: string; unitPrice: number; price: number };

type ContractData = {
  company: {
    name: string;
    tagline: string;
    salespersonName: string;
    addressLines: string[];
    email: string;
    phone: string;
    logoUrl: string;
  };
  estimate: {
    id: string;
    name?: string;
    submittedOn: string;
    customer: { name: string; phone: string; email: string };
    projectAddress: string;
    styleTitle: string;
    totalLf?: number;
    walkGateCount?: number;
    doubleGateCount?: number;
    sharedLf?: number;
    sharedTotal?: number;
    splitWithNeighborsEnabled?: boolean;
    parties?: Array<{ id: string; name: string; phone?: string; email?: string }>;
    segmentBreakdown?: Array<{
      id: string;
      label: string;
      length: number;
      removal: boolean;
      gateType: string;
      payerType: "individual" | "shared";
      payerPartyId?: string;
      payerPartyIds?: string[];
      cardId?: string | null;
      cardLabel?: string;
    }>;
    partyBreakdown?: {
      totalLf: number;
      sharedLf: number;
      removalLf: number;
      parties: Array<{
        id: string;
        name: string;
        lfShare: number;
        removalLfShare: number;
        materials: number;
        labor: number;
        additional: number;
        removal: number;
        deposit: number;
        remaining: number;
        total: number;
      }>;
    };
    depositTotal: number;
    notes: string;
    disclaimer: string;
    contractText: string;
  };
  sections: {
    materials: ContractRow[];
    labor: ContractRow[];
    additional: ContractRow[];
  };
  totals: {
    materialsSubtotal: number;
    laborSubtotal: number;
    additionalSubtotal: number;
    removalTotal?: number;
    discount: number;
    tax: number;
    total: number;
  };
};

const STORAGE_KEY = "vf_contract_preview_v1";

function Table({ title, rows }: { title: string; rows: ContractRow[] }) {
  return (
    <section className="section">
      <div className="sectionHeader">{title}</div>

      <div className="table">
        <div className="tr th">
          <div className="td material">Material</div>
          <div className="td qty">Qty</div>
          <div className="td unit">Unit</div>
          <div className="td unitPrice">Unit Price</div>
          <div className="td price">Price</div>
        </div>

        {rows.map((r, idx) => (
          <div key={idx} className={`tr ${idx % 2 ? "alt" : ""}`}>
            <div className="td material">{r.name}</div>
            <div className="td qty">{r.qty}</div>
            <div className="td unit">{r.unit}</div>
            <div className="td unitPrice">{money(r.unitPrice)}</div>
            <div className="td price">{money(r.price)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function EstimateContractPage() {
  const [data, setData] = React.useState<ContractData | null>(null);
  const pageRef = React.useRef<HTMLElement | null>(null);
  const [portalReady, setPortalReady] = React.useState(false);
  const [embed, setEmbed] = React.useState(false);
  const [draftId, setDraftId] = React.useState<string>("");

  const setDataFromDraft = React.useCallback((id: string, draft: any) => {
    try {
      const hasLineItems = Array.isArray((draft as any)?.items) || Array.isArray((draft as any)?.takeoffMaterials) || Array.isArray((draft as any)?.segments);
      if (!hasLineItems && (draft as any)?.contract) {
        const c = (draft as any).contract as ContractData;
        const estName = String(((draft as any)?.title ?? (draft as any)?.estimateName ?? (draft as any)?.name ?? "") || "").trim();
        if (estName && !String((c as any)?.estimate?.name || "").trim()) {
          setData({
            ...(c as any),
            estimate: {
              ...((c as any).estimate || {}),
              name: estName
            }
          } as any);
        } else {
          setData(c);
        }
        return;
      }

      setData(buildContractFromDraft(id, draft));
    } catch {
    }
  }, []);

  const computeDocTitle = React.useCallback((d: ContractData | null) => {
    try {
      if (!d) return "Estimate";
      const estName = String((d as any)?.estimate?.name || "").trim();
      const customer = String((d as any)?.estimate?.customer?.name || "").trim();
      const address = String((d as any)?.estimate?.projectAddress || "").trim();
      const style = String((d as any)?.estimate?.styleTitle || "").trim();

      if (customer && estName) return `${customer}, (${estName})`;
      if (estName) return estName;
      return customer || address || style || "Estimate";
    } catch {
      return "Estimate";
    }
  }, []);

  React.useEffect(() => {
    if (!draftId) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        let localTs = 0;

        const snap = readUnsavedSnapshot();
        if (snapshotMatchesDraftId(snap, draftId)) {
          localTs = Number.MAX_SAFE_INTEGER;
          setDataFromDraft(draftId, snap);
        } else {
          try {
            const store = readDraftStore();
            const local = store?.[draftId];
            if (local) {
              localTs = Number((local as any)?.updatedAt ?? (local as any)?.createdAt ?? 0) || 0;
              setDataFromDraft(draftId, local);
            }
          } catch {
          }
        }

        const remote = await fetchDraft({ id: draftId });
        if (cancelled) return;
        if (remote.ok && remote.draft) {
          const remoteTs = Number((remote.draft as any)?.updatedAt ?? (remote.draft as any)?.createdAt ?? 0) || 0;
          if (remoteTs >= localTs) setDataFromDraft(draftId, remote.draft);
        }
      } catch {
      }
    };

    const debouncedRefresh = (() => {
      let t: any = null;
      return () => {
        try {
          if (t) window.clearTimeout(t);
          t = window.setTimeout(() => {
            if (cancelled) return;
            void refresh();
          }, 150);
        } catch {
          if (!cancelled) void refresh();
        }
      };
    })();

    let realtimeChannel: any = null;
    try {
      if (supabaseConfigured) {
        const workspaceId = resolveWorkspaceId();
        realtimeChannel = supabase
          .channel(`vf-contract-${draftId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "drafts",
              filter: `workspace_id=eq.${workspaceId || DEFAULT_WORKSPACE_ID}`
            },
            (payload: any) => {
              try {
                const changedId = String(payload?.new?.draft_id ?? payload?.old?.draft_id ?? "");
                if (changedId && changedId !== draftId) return;
              } catch {
              }
              debouncedRefresh();
            }
          )
          .subscribe();
      }
    } catch {
      realtimeChannel = null;
    }

    const onChanged = () => {
      debouncedRefresh();
    };
    window.addEventListener("vf-drafts-changed", onChanged);

    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== "vf_estimate_drafts_v1") return;
      debouncedRefresh();
    };
    window.addEventListener("storage", onStorage);

    const onVisibility = () => {
      try {
        if (document.visibilityState === "visible") debouncedRefresh();
      } catch {
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const pollId = window.setInterval(() => {
      try {
        if (document.visibilityState === "visible") debouncedRefresh();
      } catch {
      }
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        if (realtimeChannel) supabase.removeChannel(realtimeChannel);
      } catch {
      }
      window.removeEventListener("vf-drafts-changed", onChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [draftId]);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        try {
          const q = new URLSearchParams(window.location.search);
          setEmbed(q.get("embed") === "1");
        } catch {
          setEmbed(false);
        }

        const nextDraftId = (() => {
          try {
            const q = new URLSearchParams(window.location.search);
            return String(q.get("draft") || "").trim();
          } catch {
            return "";
          }
        })();
        if (!cancelled) setDraftId(nextDraftId);
        if (nextDraftId) {
          let localTs = 0;

          const snap = readUnsavedSnapshot();
          if (!cancelled && snapshotMatchesDraftId(snap, nextDraftId)) {
            localTs = Number.MAX_SAFE_INTEGER;
            setDataFromDraft(nextDraftId, snap);
          } else {
          try {
            const store = readDraftStore();
            const local = store?.[nextDraftId];
            if (!cancelled && local) {
              localTs = Number((local as any)?.updatedAt ?? (local as any)?.createdAt ?? 0) || 0;
              setDataFromDraft(nextDraftId, local);
            }
          } catch {
          }
          }

          const remote = await fetchDraft({ id: nextDraftId });
          if (!cancelled && remote.ok && remote.draft) {
            const remoteTs = Number((remote.draft as any)?.updatedAt ?? (remote.draft as any)?.createdAt ?? 0) || 0;
            if (remoteTs >= localTs) setDataFromDraft(nextDraftId, remote.draft);
            return;
          }
        }
      } catch {
        // ignore
      }

      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!cancelled) setData(parsed);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setDataFromDraft]);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  React.useEffect(() => {
    try {
      document.title = computeDocTitle(data);
    } catch {
      // ignore
    }
  }, [computeDocTitle, data]);

  const printHiddenElsRef = React.useRef<HTMLElement[]>([]);
  const [printScaleMode, setPrintScaleMode] = React.useState<string>("auto");
  const printScaleModeRef = React.useRef<string>("auto");

  const applyPrintIsolation = React.useCallback(() => {
    try {
      const outer = document.querySelector(".printOuter");
      if (!outer) return;
      const hidden: HTMLElement[] = [];
      for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.contains(outer)) continue;
        child.classList.add("vfPrintHide");
        hidden.push(child);
      }
      printHiddenElsRef.current = hidden;
    } catch {
    }
  }, []);

  const clearPrintIsolation = React.useCallback(() => {
    try {
      for (const el of printHiddenElsRef.current) {
        try {
          el.classList.remove("vfPrintHide");
        } catch {
        }
      }
      printHiddenElsRef.current = [];
    } catch {
    }
  }, []);

  const setPrintScale = React.useCallback((modeOverride?: string) => {
    const effectiveMode = typeof modeOverride === "string" && modeOverride ? modeOverride : printScaleModeRef.current;
    const el = pageRef.current;
    if (!el) return;

    try {
      document.documentElement.style.setProperty("--vf-print-scale", "1");

      const clone = el.cloneNode(true) as HTMLElement;
      clone.classList.add("vfPrintMeasuring");
      clone.classList.add("vfMeasureClone");
      clone.style.position = "fixed";
      clone.style.left = "-10000px";
      clone.style.top = "0";
      clone.style.visibility = "hidden";
      clone.style.pointerEvents = "none";
      clone.style.width = "8.1in";
      clone.style.maxWidth = "8.1in";
      clone.style.margin = "0";
      clone.style.padding = "0.28in 0.16in 0.18in";
      clone.style.boxSizing = "border-box";
      clone.style.background = "#fff";
      clone.style.transform = "none";
      (clone.style as any).webkitTransform = "none";

      document.body.appendChild(clone);

      const PAGE_W = 8.5 * 96;
      const PAGE_H = 11 * 96;
      const PAGE_MARGIN_X = 0.16 * 96;
      const PAGE_MARGIN_TOP = 0.36 * 96;
      const PAGE_MARGIN_BOTTOM = 0.24 * 96;
      const SIDE_SAFE = 0.08 * 96;
      const TOP_SAFE = 0.16 * 96;
      const BOTTOM_SAFE = 0.16 * 96;
      const TOP_GAP = 0.08 * 96;

      const availW = PAGE_W - PAGE_MARGIN_X * 2 - SIDE_SAFE;
      const availH = PAGE_H - PAGE_MARGIN_TOP - PAGE_MARGIN_BOTTOM - TOP_GAP - TOP_SAFE - BOTTOM_SAFE;

      const rect = clone.getBoundingClientRect();
      const w = Math.max(1, Number((clone as any).scrollWidth) || rect.width);
      const h = Math.max(1, Number((clone as any).scrollHeight) || rect.height);
      document.documentElement.style.setProperty("--vf-print-content-w", `${Math.ceil(w)}px`);
      document.documentElement.style.setProperty("--vf-print-content-h", `${Math.ceil(h)}px`);
      const scaleW = availW / w;
      const scaleH = availH / h;
      const scale = Math.min(scaleW, scaleH, 1) * 0.80;
      const clamped = Math.max(0.2, Math.min(1, scale));
      const est: any = (data as any)?.estimate;
      const prefers85 =
        Boolean(est?.splitWithNeighborsEnabled) &&
        ((Number(est?.sharedLf) || 0) > 0 || (Number(est?.sharedTotal) || 0) > 0);
      const autoCap = prefers85 ? 0.85 : 1;
      const chosenCap = effectiveMode === "auto" ? autoCap : Number(effectiveMode) / 100;
      const userCap = Number.isFinite(chosenCap) ? Math.max(0.2, Math.min(1, chosenCap)) : 1;
      const finalScale = Math.min(clamped, userCap, 0.80);
      const rounded = Math.round(finalScale * 1000) / 1000;
      document.documentElement.style.setProperty("--vf-print-scale", String(rounded));

      try {
        clone.remove();
      } catch {
      }
    } catch {
      const fallbackFromMode = (() => {
        if (effectiveMode !== "auto") {
          const n = Number(effectiveMode);
          if (!Number.isFinite(n)) return 0.8;
          return Math.max(0.2, Math.min(0.8, n / 100));
        }
        return 0.8;
      })();
      document.documentElement.style.setProperty("--vf-print-scale", String(fallbackFromMode));
    }
  }, [data]);

  React.useEffect(() => {
    try {
      if (!data) return;
      const t = window.setTimeout(() => setPrintScale(), 0);
      return () => window.clearTimeout(t);
    } catch {
      return;
    }
  }, [data, printScaleMode, setPrintScale]);

  React.useEffect(() => {
    const onBeforePrint = () => {
      applyPrintIsolation();
      setPrintScale();
    };
    window.addEventListener("beforeprint", onBeforePrint);
    const onAfterPrint = () => clearPrintIsolation();
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [applyPrintIsolation, clearPrintIsolation, setPrintScale]);

  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (!window.matchMedia) return;
      const mql = window.matchMedia("print");

      const handler = (e: any) => {
        const matches = typeof e?.matches === "boolean" ? e.matches : Boolean(mql.matches);
        if (matches) {
          applyPrintIsolation();
        } else {
          clearPrintIsolation();
        }
      };

      if (typeof (mql as any).addEventListener === "function") {
        (mql as any).addEventListener("change", handler);
        return () => (mql as any).removeEventListener("change", handler);
      }

      if (typeof (mql as any).addListener === "function") {
        (mql as any).addListener(handler);
        return () => (mql as any).removeListener(handler);
      }
    } catch {
    }
  }, [applyPrintIsolation, clearPrintIsolation, setPrintScale]);

  const handlePrint = React.useCallback(() => {
    try {
      document.title = computeDocTitle(data);
    } catch {
      // ignore
    }
    applyPrintIsolation();
    setPrintScale(printScaleModeRef.current);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }, [applyPrintIsolation, computeDocTitle, data, setPrintScale]);

  const handleEmail = React.useCallback(() => {
    try {
      if (!data) return;
      const to = String(data.estimate?.customer?.email || "").trim();
      if (!to) return;
      const subject = `Vasseur Fencing estimate ${String(data.estimate?.id || "").trim() || ""}`.trim();
      const body = `Hi ${String(data.estimate?.customer?.name || "").trim() || ""},\n\nAttached is your estimate.\n\nThanks,\nVasseur Fencing`;
      const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = url;
    } catch {
      // ignore
    }
  }, [data]);

  if (!data) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>No contract data</h1>
          <p style={{ marginTop: 8 }}>
            Go back to Estimates and click <b>Generate Contract</b>.
          </p>
        </div>
      </div>
    );
  }

  const { company, estimate, sections, totals } = data;
  const subtotal = totals.materialsSubtotal + totals.laborSubtotal + totals.additionalSubtotal;
  const totalLf = Number(estimate.totalLf ?? sections.labor?.[0]?.qty ?? 0);
  const removalTotal = Number(totals.removalTotal ?? 0);
  const installationTotal = Math.round((Number(totals.laborSubtotal || 0) + Number(totals.additionalSubtotal || 0)) * 100) / 100;
  const gateCount =
    (Number(estimate.walkGateCount ?? 0) || 0) + (Number(estimate.doubleGateCount ?? 0) || 0);
  const sharedLf = Number(estimate.sharedLf ?? 0);
  const sharedTotal = Number(estimate.sharedTotal ?? 0);
  const splitMode =
    Boolean((estimate as any)?.splitWithNeighborsEnabled) &&
    Array.isArray((estimate as any)?.partyBreakdown?.parties) &&
    ((estimate as any).partyBreakdown.parties as any[]).length >= 2;
  const partyBreakdown = splitMode ? ((estimate as any).partyBreakdown as any) : null;
  const segmentBreakdown = splitMode && Array.isArray((estimate as any)?.segmentBreakdown)
    ? (((estimate as any).segmentBreakdown as any[]) as any[])
    : [];
  const partyNameById = (() => {
    const m = new Map<string, string>();
    const list = Array.isArray((estimate as any)?.parties) ? ((estimate as any).parties as any[]) : [];
    for (const p of list) {
      const id = typeof (p as any)?.id === "string" ? String((p as any).id) : "";
      if (!id) continue;
      m.set(id, String((p as any)?.name || "").trim());
    }
    return m;
  })();
  const descriptionText = `${estimate.styleTitle}${gateCount ? ` + ${gateCount} gate${gateCount === 1 ? "" : "s"}` : ""}`;
  const estimateDisplayName = String((estimate as any)?.name || "").trim();
  const descriptionDisplayText = estimateDisplayName
    ? `${estimateDisplayName}${gateCount ? ` + ${gateCount} gate${gateCount === 1 ? "" : "s"}` : ""}`
    : descriptionText;
  const acceptanceText =
    "The above prices, specifications and conditions are satisfactory and hereby accepted. You are authorized to do the work as specified.\n" +
    "By signing below you agree to have Vasseur Fencing complete all listed line items above in this document.\n" +
    "We look forward to working with you!";
  const effectiveTotal = (() => {
    const base = Number(totals.total) || 0;
    const candidate = Math.round((Number(totals.materialsSubtotal || 0) + Number(totals.laborSubtotal || 0) + Number(totals.additionalSubtotal || 0) + removalTotal) * 100) / 100;
    const baseRounded = Math.round(base * 100) / 100;
    // If totals.total already includes removal, it should match the full candidate.
    // Otherwise, treat it as missing and add removal.
    if (Math.abs(candidate - baseRounded) <= 0.01) return baseRounded;
    if (removalTotal > 0 && Math.abs((candidate - removalTotal) - baseRounded) <= 0.01) return candidate;
    return baseRounded;
  })();
  const remainingBalance = Math.max(0, Math.round((effectiveTotal - Number(estimate.depositTotal)) * 100) / 100);
  const estimateIncludesText =
    "Estimate Includes all labor, materials, taxes, 811 miss dig ticket, and a 12 month workmanship warranty.\n" +
    `-The \"Materials & Expences\" ${money(estimate.depositTotal)} must be paid prior to ordering materials.\n` +
    `-The remaining Balance of ${money(remainingBalance)} is due upon completion of the fence.`;

  return (
    <>
      <style>{PRINT_CSS}</style>

      {portalReady
        ? (!embed
          ? createPortal(
          <div className="noPrint stickyBack" aria-label="Contract actions">
            <div className="stickyBackInner">
              <div className="stickyBar">
                <button onClick={() => window.history.back()} className="backBtnHalf">Back</button>
                <button onClick={handleEmail} className="backBtnHalf" disabled={!estimate.customer.email}>Email</button>
                <button onClick={handlePrint} className="backBtnHalf">Print / Save PDF</button>
              </div>
              <div className="stickyScaleRow">
                <div className="stickyScaleLabel">Print scale</div>
                <select
                  className="stickyScaleSelect"
                  value={printScaleMode}
                  onChange={(e) => {
                    const v = String(e.target.value || "");
                    printScaleModeRef.current = v;
                    if (v !== "auto") {
                      const n = Number(v);
                      if (!Number.isFinite(n)) return;
                      if (n < 60 || n > 80) return;
                      try {
                        document.documentElement.style.setProperty(
                          "--vf-print-scale",
                          String(Math.max(0.2, Math.min(0.8, n / 100)))
                        );
                      } catch {
                      }
                    }
                    setPrintScaleMode(v);
                    try {
                      setPrintScale(v);
                    } catch {
                    }
                  }}
                >
                  <option value="auto">Auto</option>
                  {Array.from({ length: 21 }, (_, idx) => 80 - idx).map((n) => (
                    <option key={n} value={String(n)}>{n}%</option>
                  ))}
                </select>
              </div>
            </div>
          </div>,
          document.body
          )
          : null)
        : null}

      <div className="printOuter">
        <div className="printPos">
          <div className="printScale">
            <main ref={(el) => {
              pageRef.current = el;
            }} className="page">
        <header className="topHeader">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="headerImage" src="/IMG_3454.JPG" alt="Vasseur Fencing" />
          </div>

          <div className="contact">
            {company.salespersonName ? <div className="contactLine contactBold">{company.salespersonName}</div> : null}
            {(company.addressLines ?? []).map((l, i) => (
              <div key={i} className="contactLine">{l}</div>
            ))}
            {company.email ? <div className="contactLine">{company.email}</div> : null}
            {company.phone ? <div className="contactLine">{company.phone}</div> : null}
          </div>
        </header>

        <div className="docTitleCentered">Estimate</div>

        <div className="rule" />

        <section className="submittedBlock">
          <div className="submittedLabel">Submitted on:</div>
          <div className="submittedValue">{estimate.submittedOn}</div>
          <div className="submittedLabel">Estimate For:</div>
          <div className="submittedValue">{estimate.customer.name}</div>
          <div className="submittedValue">{estimate.projectAddress}</div>
          {estimate.customer.phone ? <div className="submittedValue">{estimate.customer.phone}</div> : null}
          {estimate.customer.email ? <div className="submittedValue">{estimate.customer.email}</div> : null}
        </section>

        <div className="styleBar">
          <div className="styleBarText">{estimateDisplayName || estimate.styleTitle}</div>
        </div>

        <div className="descHeader">
          <div className="descHeaderLeft">Description</div>
          <div className="descHeaderRight">Quantity LF</div>
        </div>
        <div className="descRow">
          <div className="descRowLeft">{descriptionDisplayText}</div>
          <div className="descRowRight">{Math.round(totalLf)}</div>
        </div>

        <section className="materialsBlock">
          <div className="sectionBar">
            <div>Materials &amp; Expenses</div>
            <div className="sectionCols">
              <div className="colQty">Quantity</div>
              <div className="colUnit">Unit Price</div>
            </div>
          </div>

          <div className="materialsTable">
            {sections.materials.map((r, idx) => (
              <div key={idx} className={`matRow ${idx % 2 ? "alt" : ""}`}>
                <div className="matName">{r.name}</div>
                <div className="matQty">{r.qty}</div>
                <div className="matUnit">{money(r.unitPrice)}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="depositRow">
          <div className="depositLabel">Deposit Total</div>
          <div className="depositValue">{money(estimate.depositTotal)}</div>
        </div>

        <section className="workBlock">
          <div className="workHeader">
            <div>Installation (Labor)</div>
            <div className="workHeaderRight">
              <div>Total LF</div>
              <div className="workLf">{Math.round(totalLf)}</div>
            </div>
          </div>
          <div className="workBody">
            <div className="workText">
              {estimate.notes || "Install fence per estimate details."}
            </div>
            {[...(sections.labor || []), ...(sections.additional || [])].length ? (
              <div style={{ marginTop: 8 }}>
                {[...(sections.labor || []), ...(sections.additional || [])].map((r, idx) => (
                  <div key={idx} className="flex justify-between gap-3" style={{ fontSize: 9, fontWeight: 700, lineHeight: 1.2 }}>
                    <div style={{ maxWidth: "75%" }}>{String(r.name || "") === "Days labor" ? "Labor" : r.name}</div>
                    <div>{money(r.price)}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="workPrice">{money(installationTotal)}</div>
        </section>

        <section className="workBlock">
          <div className="workHeader">
            <div>Fence Removal</div>
            <div className="workHeaderRight">
              <div>Total LF</div>
              <div className="workLf">{Math.round(totalLf)}</div>
            </div>
          </div>
          <div className="workBody">
            <div className="workText">Remove and dispose of all old fencing and concrete.</div>
          </div>
          <div className="workPrice">{money(removalTotal)}</div>
        </section>

        <section className="notesBlock">
          <div className="sectionBar single">Notes</div>
          <div className="notesBody" style={{ whiteSpace: "pre-wrap" }}>
            {"All of the utilities for the property will have been marked by 811 Miss Dig under Vasseur Fencing's name for liability purposes,\n" +
              "and it is homeowners responcibility to obtain appropriate permits for project if necessary, including any compliance's with HOA."}
          </div>
        </section>

        {splitMode && partyBreakdown ? (
          <section className="workBlock">
            <div className="workHeader">
              <div>Segments (paid by)</div>
            </div>
            <div className="workBody" style={{ paddingTop: 8, paddingBottom: 8 }}>
              {segmentBreakdown.length ? (
                <div style={{ border: "1px solid var(--mid)", borderRadius: 10, overflow: "hidden" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "0.9in 1.9in 0.7in 1fr 0.7in",
                      gap: 0,
                      background: "var(--green)",
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 900,
                      padding: "4px 7px"
                    }}
                  >
                    <div>Segment</div>
                    <div>Card</div>
                    <div style={{ textAlign: "right" }}>LF</div>
                    <div>Paid by</div>
                    <div style={{ textAlign: "right" }}>Remove</div>
                  </div>
                  {segmentBreakdown.map((seg: any, idx: number) => {
                    const payerType = String(seg?.payerType || "").trim() === "shared" ? "shared" : "individual";
                    const payerLabel = (() => {
                      if (payerType === "shared") {
                        const ids = Array.isArray(seg?.payerPartyIds) ? (seg.payerPartyIds as any[]) : [];
                        const names = ids
                          .map((id) => partyNameById.get(String(id || "")) || "")
                          .map((n) => String(n || "").trim())
                          .filter((n) => Boolean(n));
                        return names.length ? `Shared: ${names.join(", ")}` : "Shared";
                      }
                      const pid = String(seg?.payerPartyId || "");
                      const name = partyNameById.get(pid) || "";
                      return `Individual: ${String(name || "").trim() || "(unnamed)"}`;
                    })();
                    return (
                      <div
                        key={String(seg?.id || idx)}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "0.9in 1.9in 0.7in 1fr 0.7in",
                          padding: "4px 7px",
                          fontSize: 9,
                          fontWeight: 700,
                          background: idx % 2 ? "var(--light)" : "#fff",
                          borderTop: "1px solid var(--mid)"
                        }}
                      >
                        <div>{String(seg?.label || "")}</div>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(seg?.cardLabel || "")}</div>
                        <div style={{ textAlign: "right" }}>{Math.round((Number(seg?.length) || 0) * 100) / 100}</div>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{payerLabel}</div>
                        <div style={{ textAlign: "right" }}>{Boolean(seg?.removal) ? "Yes" : ""}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 9, fontWeight: 700 }}>No segments.</div>
              )}
            </div>
          </section>
        ) : null}

        {splitMode && partyBreakdown ? (
          <section className="workBlock">
            <div className="workHeader">
              <div>Per-party prorated breakdown</div>
              <div className="workHeaderRight">
                <div>Shared LF</div>
                <div className="workLf">{Math.round(Number(partyBreakdown.sharedLf || 0))}</div>
              </div>
            </div>
            <div className="workBody" style={{ paddingTop: 8, paddingBottom: 8 }}>
              {Array.isArray(partyBreakdown.parties) ? (
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    alignItems: "start"
                  }}
                >
                  {partyBreakdown.parties.map((p: any, idx: number) => {
                    const name = String(p?.name || "").trim() || `Party ${idx + 1}`;
                    return (
                      <div key={String(p?.id || idx)} style={{ border: "1px solid var(--mid)", borderRadius: 10, padding: "6px 7px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                          <div style={{ fontSize: 10, fontWeight: 900 }}>{name}</div>
                          <div style={{ fontSize: 9, fontWeight: 800 }}>{Math.round((Number(p?.lfShare) || 0) * 100) / 100} LF share</div>
                        </div>
                        <div
                          style={{
                            marginTop: 4,
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            gap: 3,
                            fontSize: 9,
                            fontWeight: 700
                          }}
                        >
                          <div>Materials &amp; Expenses</div>
                          <div style={{ textAlign: "right" }}>{money(Number(p?.materials) || 0)}</div>
                          <div>Labor</div>
                          <div style={{ textAlign: "right" }}>{money(Number(p?.labor) || 0)}</div>
                          <div>Additional fees</div>
                          <div style={{ textAlign: "right" }}>{money(Number(p?.additional) || 0)}</div>
                          <div>Fence removal</div>
                          <div style={{ textAlign: "right" }}>{money(Number(p?.removal) || 0)}</div>
                          <div style={{ fontWeight: 900 }}>Total</div>
                          <div style={{ textAlign: "right", fontWeight: 900 }}>{money(Number(p?.total) || 0)}</div>
                          <div>Deposit</div>
                          <div style={{ textAlign: "right" }}>{money(Number(p?.deposit) || 0)}</div>
                          <div>Remaining</div>
                          <div style={{ textAlign: "right" }}>{money(Number(p?.remaining) || 0)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {sharedLf > 0 || (splitMode && partyBreakdown && Array.isArray(partyBreakdown.parties)) ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 }}>
              {sharedLf > 0 && sharedTotal > 0 ? (
                <div
                  style={{
                    border: "1px solid var(--mid)",
                    borderRadius: 10,
                    padding: "6px 7px"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 9, fontWeight: 900 }}>
                    <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Shared</div>
                    <div style={{ whiteSpace: "nowrap" }}>{money(sharedTotal)}</div>
                  </div>
                  <div style={{ marginTop: 2, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 8.5, fontWeight: 700 }}>
                    <div>{Math.round(sharedLf)} LF</div>
                    <div />
                  </div>
                </div>
              ) : null}

              {splitMode && partyBreakdown && Array.isArray(partyBreakdown.parties)
                ? partyBreakdown.parties.map((p: any, idx: number) => {
                    const name = String(p?.name || "").trim() || `Party ${idx + 1}`;
                    const total = Number(p?.total) || 0;
                    const deposit = Number(p?.deposit) || 0;
                    const remaining = Number(p?.remaining) || 0;
                    return (
                      <div
                        key={String(p?.id || idx)}
                        style={{
                          border: "1px solid var(--mid)",
                          borderRadius: 10,
                          padding: "6px 7px"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 9, fontWeight: 900 }}>
                          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                          <div style={{ whiteSpace: "nowrap" }}>{money(total)}</div>
                        </div>
                        <div style={{ marginTop: 2, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 8.5, fontWeight: 700 }}>
                          <div>Dep {money(deposit)}</div>
                          <div>Rem {money(remaining)}</div>
                        </div>
                      </div>
                    );
                  })
                : null}
            </div>
          </div>
        ) : null}

        <section className="bottomGrid">
          <div className="disclaimer">
            <div className="discTitle">Disclaimer:</div>
            <div className="discTerms" style={{ whiteSpace: "pre-wrap" }}>{estimateIncludesText}</div>
            <div className="discText">{estimate.disclaimer}</div>
          </div>

          <div className="totalCost">
            {Boolean((estimate as any)?.splitWithNeighborsEnabled) && !(splitMode && partyBreakdown && Array.isArray(partyBreakdown.parties)) ? (
              <div style={{ marginBottom: 10, textAlign: "left" }}>
                <div className="totalCostLabel">Per-party totals</div>
                <div style={{ fontSize: 9, fontWeight: 800, marginTop: 3, color: "#A52B2B" }}>
                  Split is enabled, but per-party breakdown is not available.
                </div>
                <div style={{ fontSize: 8.5, fontWeight: 700, marginTop: 2 }}>
                  Make sure you have 2+ parties and assign segment payers.
                </div>
              </div>
            ) : null}

            <div className="totalCostLabel">Total Cost</div>
            <div className="totalCostValue">{money(totals.total)}</div>
          </div>
        </section>

        <div className="contractBar">Homeowner Contract</div>
        <div className="contractText">
          <div style={{ whiteSpace: "pre-wrap" }}>{acceptanceText}</div>
          {estimate.contractText ? (
            <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{estimate.contractText}</div>
          ) : null}
        </div>

        <div className="sigLines">
          {splitMode && partyBreakdown && Array.isArray(partyBreakdown.parties)
            ? partyBreakdown.parties.map((p: any, idx: number) => {
                const name = String(p?.name || "").trim() || `Party ${idx + 1}`;
                return (
                  <div key={String(p?.id || idx)} style={{ marginTop: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.8fr", gap: 10, marginTop: 8 }}>
                      <div>
                        <div className="sigLine" />
                        <div className="sigLabel">{name} Signature</div>
                      </div>
                      <div>
                        <div className="sigLine" />
                        <div className="sigLabel">{name} Print</div>
                      </div>
                      <div>
                        <div className="sigLine" />
                        <div className="sigLabel">Date</div>
                      </div>
                    </div>
                  </div>
                );
              })
            : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.8fr", gap: 10, marginTop: 8 }}>
                  <div>
                    <div className="sigLine" />
                    <div className="sigLabel">Homeowner Signature</div>
                  </div>
                  <div>
                    <div className="sigLine" />
                    <div className="sigLabel">Homeowner Print</div>
                  </div>
                  <div>
                    <div className="sigLine" />
                    <div className="sigLabel">Date</div>
                  </div>
                </div>
              </>
            )}
        </div>
            </main>
          </div>
        </div>
      </div>
    </>
  );
}

const PRINT_CSS = `
:root{ --green:#244B2A; --brown:#8A5A2B; --text:#111; --light:#F4F4F4; --mid:#E6E6E6; --vf-print-scale:0.80; --vf-print-content-w: 778px; --vf-print-content-h: 1056px; }
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; color:var(--text); font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif; background:#fff; }
body{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page{ width: 8.5in; margin: 0 auto; padding: 0.35in 0.28in 0.14in; }
.controls{ padding:10px; display:flex; justify-content:center; }
.btn{ padding:10px 14px; border-radius:10px; border:1px solid #ddd; background:#fff; cursor:pointer; font-weight:600; }
.noPrint{ display:block; }
.topHeader{ display:grid; grid-template-columns: 3.2in 1fr; align-items:start; gap:6px; }
.headerImage{ display:block; height:124px; width:auto; object-fit:contain; margin-top:0; }
.vfPrintMeasuring .topHeader{ gap:2px; }
.vfPrintMeasuring .headerImage{ height:96px; }
.docTitleCentered{ text-align:center; font-size:30px; font-weight:900; margin:0 0 2px; line-height:1; }
.contact{ text-align:right; font-size:9px; line-height:1.2; margin-top:0; }
.contactBold{ font-weight:800; }
.rule{ height:2px; background:#000; opacity:.6; margin:2px 0; }
.submittedBlock{ text-align:center; font-size:9px; line-height:1.2; margin: 0 0 3px; }
.submittedLabel{ font-weight:800; display:inline; margin-right:4px; }
.submittedValue{ font-weight:600; }
.styleBar{ background:var(--brown); color:#fff; padding:3px 7px; font-weight:900; text-align:center; margin: 4px 0 4px; font-size:10px; }
.descHeader{ display:flex; justify-content:space-between; background:var(--green); color:#fff; padding:3px 7px; font-weight:900; font-size:10px; }
.descRow{ display:flex; justify-content:space-between; padding:3px 7px; border-bottom:1px solid var(--mid); font-size:10px; font-weight:700; }
.materialsBlock{ margin-top:6px; }
.sectionBar{ display:flex; justify-content:space-between; align-items:center; background:var(--green); color:#fff; padding:3px 7px; font-weight:900; font-size:10px; }
.sectionBar.single{ justify-content:flex-start; }
.sectionCols{ display:grid; grid-template-columns: .9in 1.1in; gap:8px; font-size:10px; }
.materialsTable{ border-left:1px solid var(--mid); border-right:1px solid var(--mid); }
.matRow{ display:grid; grid-template-columns: 1fr .9in 1.1in; padding:3px 7px; border-bottom:1px solid var(--mid); font-size:9.5px; }
.matRow.alt{ background:var(--light); }
.matQty, .matUnit{ text-align:right; font-weight:700; }
.depositRow{ margin-top:4px; display:flex; justify-content:flex-end; align-items:center; gap:8px; background:var(--brown); color:#fff; padding:3px 7px; font-weight:900; font-size:9.5px; width: 2.0in; margin-left:auto; }
.workBlock{ margin-top:6px; border:1px solid var(--mid); }
.workHeader{ display:flex; justify-content:space-between; align-items:center; background:var(--green); color:#fff; padding:3px 7px; font-weight:900; font-size:10px; }
.workHeaderRight{ display:flex; gap:10px; align-items:baseline; }
.workLf{ font-weight:900; }
.workBody{ padding:6px 7px; font-size:8.5px; min-height:34px; }
.workText{ line-height:1.35; }
.workPrice{ background:var(--brown); color:#fff; font-weight:900; padding:3px 7px; font-size:9.5px; width: 2.0in; margin-left:auto; text-align:right; }
.notesBlock{ margin-top:6px; border:1px solid var(--mid); }
.notesBody{ padding:6px 7px; font-size:8.5px; text-align:center; }
.bottomGrid{ display:grid; grid-template-columns: 1fr 2.0in; gap:10px; margin-top:8px; align-items:end; }
.disclaimer{ border-top:1px solid #000; padding-top:6px; font-size:7.5px; }
.discTitle{ font-weight:900; margin-bottom:4px; }
.discText{ line-height:1.35; }
.totalCost{ text-align:center; }
.totalCostLabel{ color:#A52B2B; font-weight:900; font-size:11px; }
.totalCostValue{ font-weight:900; font-size:12px; margin-top:1px; }
.contractBar{ margin-top:6px; background:var(--brown); color:#fff; padding:5px 7px; text-align:center; font-weight:900; font-size:10px; }
.contractText{ background:var(--brown); color:#fff; padding:5px 7px; text-align:center; font-size:8.2px; line-height:1.2; }
.contractText .totalTerms{ font-size:7.3px; line-height:1.15; margin-bottom:4px; }
.sigLines{ margin-top:8px; }
.sigLineRow{ margin-top:8px; }
.sigLine{ height:1px; background:#000; opacity:.8; }
.sigLabel{ font-size:8.5px; margin-top:3px; }

.stickyBack{ position:fixed; left:0; right:0; bottom:0; z-index:50; padding:0 16px calc(env(safe-area-inset-bottom) + 16px); }
.stickyBackInner{ max-width:980px; margin:0 auto; padding-top:12px; }
.stickyBar{ display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; }
.stickyScaleRow{ margin-top:10px; display:flex; justify-content:center; align-items:center; gap:10px; }
.stickyScaleLabel{ color:#fff; font-size:12px; font-weight:900; letter-spacing:.01em; opacity:.92; }
.stickyScaleSelect{
  height:44px;
  border-radius:12px;
  padding:0 12px;
  border:1px solid rgba(255,255,255,.16);
  background: rgba(20,30,24,.55);
  color:#fff;
  font-weight:900;
  letter-spacing:.01em;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.backBtnHalf{
  width:100%;
  height:64px;
  border-radius:16px;
  border:1px solid rgba(255,255,255,.12);
  background: rgba(20,30,24,.55);
  color:#fff;
  font-size:16px;
  font-weight:900;
  letter-spacing:.02em;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow: 0 12px 30px rgba(0,0,0,.35);
}
@media print{
  @page {
    size: letter;
    margin: 0.36in 0.16in 0.24in 0.16in;
  }

  html, body, #__next {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    height: auto !important;
    overflow: visible !important;
    background: #fff !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  body {
    display: block !important;
  }

  .printOuter {
    width: 100% !important;
    display: flex !important;
    justify-content: center !important;
    align-items: flex-start !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
  }

  .printPos {
    width: calc(var(--vf-print-content-w) * var(--vf-print-scale)) !important;
    height: auto !important;
    margin: 0 auto !important;
    display: flex !important;
    justify-content: center !important;
    align-items: flex-start !important;
    overflow: visible !important;
  }

  .printScale {
    width: var(--vf-print-content-w) !important;
    margin: 0 auto !important;
    height: auto !important;
    transform: scale(var(--vf-print-scale)) !important;
    -webkit-transform: scale(var(--vf-print-scale)) !important;
    transform-origin: top center !important;
    -webkit-transform-origin: top center !important;
  }

  .page {
    width: 8.1in !important;
    margin: 0 auto !important;
    padding: 0.24in 0.16in 0.06in !important;
    box-sizing: border-box !important;
    transform: none !important;
    -webkit-transform: none !important;
    overflow: visible !important;
    background: #fff !important;
    box-shadow: none !important;
  }

  .noPrint,
  .stickyBack,
  nextjs-portal,
  #__next-route-announcer,
  [aria-live] {
    display: none !important;
  }

  .vfMeasureClone,
  .vfPrintHide{
    display:none !important;
  }
}
.workBlock, .materialsBlock, .notesBlock{ break-inside: avoid; page-break-inside: avoid; }

@media screen{
  html, body{ height: auto; }
  body{
    background:#fff;
    min-height: 100vh;
    display: block;
    padding: 24px 0 140px;
    overflow-y: auto;
  }
  .page{
    box-shadow: 0 10px 30px rgba(0,0,0,.12);
    background:#fff;
    width: min(720px, calc(100vw - 48px));
    max-width: 720px;
    padding: 22px;
    margin: 0 auto;
  }
}
`;
