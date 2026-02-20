"use client";

import React from "react";
import { createPortal } from "react-dom";
import { money } from "@/lib/money";

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
    submittedOn: string;
    customer: { name: string; phone: string; email: string };
    projectAddress: string;
    styleTitle: string;
    totalLf?: number;
    walkGateCount?: number;
    doubleGateCount?: number;
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

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setData(parsed);
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  const setPrintScale = React.useCallback(() => {
    const el = pageRef.current;
    if (!el) return;

    // Measure actual CSS pixels-per-inch for this device/browser.
    const ruler = document.createElement("div");
    ruler.style.position = "fixed";
    ruler.style.left = "0";
    ruler.style.top = "0";
    ruler.style.width = "1in";
    ruler.style.height = "1in";
    ruler.style.opacity = "0";
    ruler.style.pointerEvents = "none";
    document.body.appendChild(ruler);
    const ppi = ruler.getBoundingClientRect().height || 96;
    ruler.remove();

    // Use a conservative printable height (iOS Safari is sensitive to tiny overflows).
    // Letter height is 11in, but after print margins and internal padding the usable height is smaller.
    const letterHeightPx = 10.4 * ppi;
    const contentHeightPx = el.getBoundingClientRect().height;
    if (!contentHeightPx) return;

    const rawScale = letterHeightPx / contentHeightPx;
    const scale = Math.max(0.25, Math.min(1, rawScale)) * 0.96;
    document.documentElement.style.setProperty("--vf-print-scale", String(scale));
  }, []);

  React.useEffect(() => {
    const onBeforePrint = () => setPrintScale();
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, [setPrintScale]);

  const handlePrint = React.useCallback(() => {
    setPrintScale();
    requestAnimationFrame(() => window.print());
  }, [setPrintScale]);

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
  const gateCount =
    (Number(estimate.walkGateCount ?? 0) || 0) + (Number(estimate.doubleGateCount ?? 0) || 0);
  const descriptionText = `${estimate.styleTitle}${gateCount ? ` + ${gateCount} gate${gateCount === 1 ? "" : "s"}` : ""}`;
  const acceptanceText =
    "The above prices, specifications and conditions are satisfactory and hereby accepted. You are authorized to do the work as specified.\n" +
    "By signing below you agree to have Vasseur Fencing complete all listed line items above in this document.\n" +
    "We look forward to working with you!";
  const remainingBalance = Math.max(0, Math.round((Number(totals.total) - Number(estimate.depositTotal)) * 100) / 100);
  const estimateIncludesText =
    "Estimate Includes all labor, materials, taxes, 811 miss dig ticket, and a 12 month workmanship warranty.\n" +
    `-The \"Materials & Expences\" ${money(estimate.depositTotal)} must be paid prior to ordering materials.\n` +
    `-The remaining Balance of ${money(remainingBalance)} is due upon completion of the fence.`;

  return (
    <>
      <style>{PRINT_CSS}</style>

      {portalReady
        ? createPortal(
          <div className="noPrint stickyBack" aria-label="Contract actions">
            <div className="stickyBackInner">
              <div className="stickyBar">
                <button onClick={() => window.history.back()} className="backBtnHalf">Back</button>
                <button onClick={handlePrint} className="backBtnHalf">Print / Save PDF</button>
              </div>
            </div>
          </div>,
          document.body
        )
        : null}

      <main ref={(el) => {
        pageRef.current = el;
      }} className="page">
        <header className="topHeader">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="headerImage" src="/IMG_3454.JPG" alt="Vasseur Fencing" />
          </div>

          <div className="docTitle">Estimate</div>

          <div className="contact">
            {company.salespersonName ? <div className="contactLine contactBold">{company.salespersonName}</div> : null}
            {(company.addressLines ?? []).map((l, i) => (
              <div key={i} className="contactLine">{l}</div>
            ))}
            {company.email ? <div className="contactLine">{company.email}</div> : null}
            {company.phone ? <div className="contactLine">{company.phone}</div> : null}
          </div>
        </header>

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
          <div className="styleBarText">{estimate.styleTitle}</div>
        </div>

        <div className="descHeader">
          <div className="descHeaderLeft">Description</div>
          <div className="descHeaderRight">Quantity LF</div>
        </div>
        <div className="descRow">
          <div className="descRowLeft">{descriptionText}</div>
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
          </div>
          <div className="workPrice">{money(totals.laborSubtotal)}</div>
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
.page{ width: 8.5in; margin: 0 auto; padding: 0.10in 0.28in 0.14in; }
.controls{ padding:10px; display:flex; justify-content:center; }
.btn{ padding:10px 14px; border-radius:10px; border:1px solid #ddd; background:#fff; cursor:pointer; font-weight:600; }
.noPrint{ display:block; }
.topHeader{ display:grid; grid-template-columns: 3.2in 1fr 2.0in; align-items:start; gap:6px; }
.headerImage{ display:block; height:124px; width:auto; object-fit:contain; margin-top:-4px; }
.docTitle{ text-align:center; font-size:30px; font-weight:900; margin-top:-4px; line-height:1; }
.contact{ text-align:right; font-size:9px; line-height:1.2; }
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
.stickyBar{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
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
  @page{ size: letter; margin: 0.20in; }
  .noPrint{ display:none !important; }
  html, body{
    background:#fff !important;
    filter:none !important;
    -webkit-filter:none !important;
  }
  *{
    filter:none !important;
    -webkit-filter:none !important;
    backdrop-filter:none !important;
    -webkit-backdrop-filter:none !important;
  }
  .page{
    width: auto;
    max-width: 100%;
    margin: 0;
    padding:0.12in 0.34in;
    background:#fff;
    box-shadow:none;
    height: auto;
    overflow: visible;
    zoom: 1;
    transform: none;
    transform-origin: initial;
    break-after: avoid;
    page-break-after: avoid;
  }
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
    margin-top: 8px;
    margin-bottom: 84px;
  }
}
`;
