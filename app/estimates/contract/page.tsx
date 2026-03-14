"use client";

import React from "react";
import { createPortal } from "react-dom";
import { money } from "@/lib/money";
import { fetchDraft } from "@/lib/draftsStore";
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
      const v = lf > 0 ? lf * 6 : 0;
      return Math.round(v * 100) / 100;
    } catch {
      return 0;
    }
  })();

  const materialsRows = items
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

  const estimateName = String((draft as any)?.title || "").trim();
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

  const computeDocTitle = React.useCallback((d: ContractData | null) => {
    try {
      if (!d) return "Estimate";
      const estName = String((d as any)?.estimate?.name || "").trim();
      const customer = String((d as any)?.estimate?.customer?.name || "").trim();
      const address = String((d as any)?.estimate?.projectAddress || "").trim();
      const style = String((d as any)?.estimate?.styleTitle || "").trim();

      if (estName) return estName;
      return customer || address || style || "Estimate";
    } catch {
      return "Estimate";
    }
  }, []);

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

        const draftId = (() => {
          try {
            const q = new URLSearchParams(window.location.search);
            return String(q.get("draft") || "").trim();
          } catch {
            return "";
          }
        })();
        if (draftId) {
          const remote = await fetchDraft({ id: draftId });
          if (!cancelled && remote.ok && remote.draft) {
            if ((remote.draft as any).contract) {
              setData((remote.draft as any).contract as ContractData);
              return;
            }
            setData(buildContractFromDraft(draftId, remote.draft));
            return;
          }

          // Fallback: local-only draft (not in Supabase) or offline.
          try {
            const store = readDraftStore();
            const local = store?.[draftId];
            if (!cancelled && local) {
              if ((local as any).contract) {
                setData((local as any).contract as ContractData);
                return;
              }
              setData(buildContractFromDraft(draftId, local));
              return;
            }
          } catch {
            // ignore
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
  }, []);

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

  const setPrintScale = React.useCallback(() => {
    const el = pageRef.current;
    if (!el) return;

    document.documentElement.style.setProperty("--vf-print-scale", "0.75");
  }, []);

  React.useEffect(() => {
    const onBeforePrint = () => setPrintScale();
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, [setPrintScale]);

  const handlePrint = React.useCallback(() => {
    try {
      document.title = computeDocTitle(data);
    } catch {
      // ignore
    }
    setPrintScale();
    requestAnimationFrame(() => window.print());
  }, [computeDocTitle, data, setPrintScale]);

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
            </div>
          </div>,
          document.body
          )
          : null)
        : null}

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

        <section className="bottomGrid">
          <div className="disclaimer">
            <div className="discTitle">Disclaimer:</div>
            <div className="discTerms" style={{ whiteSpace: "pre-wrap" }}>{estimateIncludesText}</div>
            <div className="discText">{estimate.disclaimer}</div>
          </div>

          <div className="totalCost">
            {sharedLf > 0 && sharedTotal > 0 ? (
              <div style={{ marginBottom: 8 }}>
                <div className="totalCostLabel">Shared Portion</div>
                <div style={{ fontSize: 10, fontWeight: 800, marginTop: 2 }}>{Math.round(sharedLf)} LF</div>
                <div className="totalCostValue">{money(sharedTotal)}</div>
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
          <div className="sigLineRow">
            <div className="sigLine" />
            <div className="sigLabel">Homeowner Signature</div>
          </div>
          <div className="sigLineRow">
            <div className="sigLine" />
            <div className="sigLabel">Homeowner Print</div>
          </div>
          <div className="sigLineRow">
            <div className="sigLine" />
            <div className="sigLabel">Date</div>
          </div>
        </div>
      </main>
    </>
  );
}

const PRINT_CSS = `
:root{ --green:#244B2A; --brown:#8A5A2B; --text:#111; --light:#F4F4F4; --mid:#E6E6E6; --vf-print-scale:1; }
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; color:var(--text); font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif; background:#fff; }
.page{ width: 8.5in; margin: 0 auto; padding: 0.60in 0.28in 0.14in; }
.controls{ padding:10px; display:flex; justify-content:center; }
.btn{ padding:10px 14px; border-radius:10px; border:1px solid #ddd; background:#fff; cursor:pointer; font-weight:600; }
.noPrint{ display:block; }
.topHeader{ display:grid; grid-template-columns: 3.2in 1fr; align-items:start; gap:6px; }
.headerImage{ display:block; height:124px; width:auto; object-fit:contain; margin-top:0; }
.docTitleCentered{ text-align:center; font-size:30px; font-weight:900; margin:0 0 2px; line-height:1; }
.contact{ text-align:right; font-size:9px; line-height:1.2; }
.contactBold{ font-weight:800; }
.rule{ height:2px; background:#000; opacity:.6; margin:1px 0; }
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
  @page{ size: letter; margin: 0in; }
  .noPrint{ display:none !important; }
  html, body{
    width: 100% !important;
    background:#fff !important;
    filter:none !important;
    -webkit-filter:none !important;
  }
  body{
    margin: 0 !important;
    padding: 0 !important;
    display: flex !important;
    justify-content: center !important;
    align-items: flex-start !important;
  }
  *{
    filter:none !important;
    -webkit-filter:none !important;
    backdrop-filter:none !important;
    -webkit-backdrop-filter:none !important;
  }
  .page{
    /* Keep the contract centered even if the user adjusts the print dialog scaling. */
    box-sizing: border-box;
    width: 8.1in;
    max-width: 100%;
    margin: -0.15in 0 0;
    padding: 0in 0.28in;
    background:#fff;
    box-shadow:none;
    height: auto;
    overflow: visible;
    zoom: 1;
    transform: scale(var(--vf-print-scale));
    transform-origin: top center;
    break-after: avoid;
    page-break-after: avoid;
  }

  .topHeader{ gap: 2px; }
  .headerImage{ height: 92px; }
  .docTitleCentered{ margin: 0 0 1px; }
}
.workBlock, .materialsBlock, .notesBlock{ break-inside: avoid; page-break-inside: avoid; }

@media screen{
  body{ background:#fff; }
  .page{
    box-shadow: 0 10px 30px rgba(0,0,0,.12);
    background:#fff;
    width: min(720px, calc(100vw - 48px));
    max-width: 720px;
    padding: 22px;
    margin-top: 0;
    margin-bottom: 84px;
  }
}
`;
