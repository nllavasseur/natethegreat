import React from "react";
import { money } from "@/lib/money";

/**
 * This is the print-to-PDF page.
 * It's intentionally self-contained so it prints cleanly.
 * Next step: replace getQuoteForPrint with a real Supabase fetch.
 */
async function getQuoteForPrint(id: string) {
  return {
    company: {
      name: "Vasseur Fencing",
      tagline: "Fencing Contractor",
      salespersonName: "Salesperson",
      addressLines: ["Your Address Line 1", "Your City, ST ZIP"],
      email: "you@vasseurfencing.com",
      phone: "(000) 000-0000",
      logoUrl: ""
    },
    estimate: {
      id,
      submittedOn: new Date().toLocaleDateString("en-US"),
      customer: { name: "Customer Name", phone: "(000) 000-0000", email: "customer@email.com" },
      projectAddress: "123 Main St, City, ST ZIP",
      styleTitle: "Standard Privacy",
      depositTotal: 2500,
      notes: "Notes go here.",
      disclaimer:
        "Estimate includes listed labor and materials only. Underground utilities, hidden obstructions, and unforeseen site conditions may require change orders.",
      contractText:
        "By signing below, the homeowner agrees to the scope of work and pricing described in this estimate."
    },
    sections: {
      materials: [
        { name: "Panels", qty: 10, unit: "ea", unitPrice: 180, price: 1800 }
      ],
      labor: [
        { name: "Install labor", qty: 100, unit: "ft", unitPrice: 35, price: 3500 }
      ],
      additional: [
        { name: "Gate", qty: 1, unit: "ea", unitPrice: 650, price: 650 }
      ]
    },
    totals: {
      materialsSubtotal: 1800,
      laborSubtotal: 3500,
      additionalSubtotal: 650,
      discount: 0,
      tax: 0,
      total: 5950
    }
  };
}

function Table({
  title,
  rows
}: {
  title: string;
  rows: { name: string; qty: number; unit: string; unitPrice: number; price: number }[];
}) {
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

export default async function QuotePrintPage({ params }: { params: { id: string } }) {
  const data = await getQuoteForPrint(params.id);
  const { company, estimate, sections, totals } = data;
  const subtotal = totals.materialsSubtotal + totals.laborSubtotal + totals.additionalSubtotal;
  const remainingBalance = Math.max(0, Math.round((Number(totals.total) - Number(estimate.depositTotal)) * 100) / 100);
  const estimateIncludesText =
    "Estimate Includes all labor, materials, taxes, 811 miss dig ticket, and a 12 month workmanship warranty.\n" +
    `-The \"Materials & Expences\" ${money(estimate.depositTotal)} must be paid prior to ordering materials.\n` +
    `-The remaining Balance of ${money(remainingBalance)} is due upon completion of the fence.`;

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{company.name} - Estimate</title>
        <style>{PRINT_CSS}</style>
      </head>
      <body>
        <div className="noPrint controls">
          <button onClick={() => window.print()} className="btn">Print / Save as PDF</button>
        </div>

        <main className="page">
          <header className="headerRow">
            <div className="headerLeft">
              <div className="logo placeholder" />
              <div>
                <div className="companyName">{company.name}</div>
                {company.tagline ? <div className="tagline">{company.tagline}</div> : null}
              </div>
            </div>

            <div className="headerRight">
              {company.salespersonName ? <div className="rightBold">{company.salespersonName}</div> : null}
              {company.addressLines.map((l: string, i: number) => <div key={i}>{l}</div>)}
              <div>{company.email}</div>
              <div>{company.phone}</div>
            </div>
          </header>

          <div className="divider" />
          <div className="estimateTitle">ESTIMATE</div>

          <section className="infoGrid">
            <div className="infoBox">
              <div className="infoLabel">Submitted on</div>
              <div className="infoValue">{estimate.submittedOn}</div>
            </div>
            <div className="infoBox">
              <div className="infoLabel">Estimate for</div>
              <div className="infoValue">{estimate.customer.name}</div>
              <div className="muted">{estimate.customer.phone}</div>
              <div className="muted">{estimate.customer.email}</div>
            </div>
            <div className="infoBox">
              <div className="infoLabel">Project address</div>
              <div className="infoValue">{estimate.projectAddress}</div>
            </div>
          </section>

          <div className="styleBar">
            <div className="styleBarText">{estimate.styleTitle}</div>
          </div>

          <Table title="Materials & Expenses" rows={sections.materials} />
          <div className="depositWrap">
            <div className="depositBox">
              <div className="depositLine">
                <div className="depositLabel">Deposit total</div>
                <div className="depositValue">{money(estimate.depositTotal)}</div>
              </div>
            </div>
          </div>
          <Table title="Fence Installation / Labor" rows={sections.labor} />
          <Table title="Additional Services" rows={sections.additional} />

          {estimate.notes ? (
            <section className="notesBox">
              <div className="notesTitle">Notes</div>
              <div className="notesText">{estimate.notes}</div>
            </section>
          ) : null}

          <section className="bottomRow">
            <div className="disclaimerBox">
              <div className="notesTitle">Disclaimer / Terms</div>
              <div className="finePrint">{estimate.disclaimer}</div>
            </div>

            <div className="totalsBox">
              <div className="totLine"><div className="totLabel">Materials</div><div className="totValue">{money(totals.materialsSubtotal)}</div></div>
              <div className="totLine"><div className="totLabel">Labor</div><div className="totValue">{money(totals.laborSubtotal)}</div></div>
              <div className="totLine"><div className="totLabel">Additional</div><div className="totValue">{money(totals.additionalSubtotal)}</div></div>
              <div className="totLine"><div className="totLabel">Subtotal</div><div className="totValue">{money(subtotal)}</div></div>
              <div className="totalBig"><div className="totalBigLabel">TOTAL</div><div className="totalBigValue">{money(totals.total)}</div></div>
              <div className="totalTerms" style={{ whiteSpace: "pre-wrap" }}>{estimateIncludesText}</div>
            </div>
          </section>

          <div className="contractBar">HOMEOWNER CONTRACT</div>
          <section className="signatureBlock">
            <div className="finePrint">{estimate.contractText}</div>
            <div className="sigRow">
              <div className="sigField"><div className="sigLine" /><div className="sigLabel">Homeowner Signature</div></div>
              <div className="sigField"><div className="sigLine" /><div className="sigLabel">Printed Name</div></div>
              <div className="sigField"><div className="sigLine" /><div className="sigLabel">Date</div></div>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}

const PRINT_CSS = `
:root{
  --green:#1F4D3A;
  --brown:#8A5A2B;
  --text:#111;
  --light:#F2F2F2;
  --mid:#E6E6E6;
}
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; color:var(--text); font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif; }
.page{ width: 8.5in; margin: 0 auto; padding: 0.35in; }
.controls{ padding:12px; display:flex; justify-content:center; }
.btn{ padding:10px 14px; border-radius:10px; border:1px solid #ddd; background:#fff; cursor:pointer; font-weight:600; }
.noPrint{ display:block; }
.headerRow{ display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
.headerLeft{ display:flex; gap:10px; align-items:flex-start; }
.logo{ width:56px; height:56px; object-fit:contain; }
.logo.placeholder{ border:1px solid var(--mid); border-radius:10px; }
.companyName{ font-size:18px; font-weight:800; line-height:1.1; }
.tagline{ font-size:12px; margin-top:2px; opacity:.85; }
.headerRight{ text-align:right; font-size:11px; line-height:1.3; max-width: 3.0in; }
.rightBold{ font-weight:800; }
.divider{ height:1px; background:#000; opacity:.28; margin:12px 0 12px; }
.estimateTitle{ display:flex; justify-content:center; font-size:26px; font-weight:900; letter-spacing:.08em; margin: 0 0 10px; padding-left:.08em; transform:none; }
.infoGrid{ display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; }
.infoBox{ border:1px solid var(--mid); border-radius:10px; padding:10px; }
.infoLabel{ font-size:11px; opacity:.7; }
.infoValue{ font-size:12px; font-weight:800; margin-top:3px; }
.muted{ font-size:11px; opacity:.85; margin-top:2px; }
.styleBar{ margin-top:10px; margin-bottom:12px; background:var(--brown); color:#fff; border-radius:10px; padding:10px 12px; }
.styleBarText{ text-align:center; font-weight:900; font-size:13px; }
.section{ margin-top:12px; }
.sectionHeader{ background:var(--green); color:#fff; padding:8px 10px; border-radius:10px; font-weight:900; font-size:12px; margin-bottom:6px; }
.table{ border:1px solid var(--mid); border-radius:10px; overflow:hidden; }
.tr{ display:grid; grid-template-columns: 3.2fr .9fr .9fr 1.1fr 1.1fr; padding:7px 10px; border-bottom:1px solid var(--mid); font-size:11px; }
.tr.th{ background:var(--green); color:#fff; font-weight:900; font-size:11px; }
.tr.alt{ background:var(--light); }
.td.qty, .td.unit{ text-align:center; }
.td.unitPrice, .td.price{ text-align:right; }
.material{ padding-right:8px; }
.table .tr:last-child{ border-bottom:0; }
.depositWrap{ display:flex; justify-content:flex-end; margin-top:10px; }
.depositBox{ background:var(--brown); color:#fff; border-radius:10px; padding:10px 12px; min-width: 2.6in; }
.depositLine{ display:flex; justify-content:space-between; gap:16px; font-weight:900; font-size:12px; }
.notesBox{ margin-top:12px; border:1px solid var(--mid); border-radius:10px; padding:10px; background:var(--light); text-align:center; }
.notesTitle{ font-weight:900; margin-bottom:6px; font-size:12px; text-align:center; }
.notesText{ font-size:11px; line-height:1.35; white-space: pre-wrap; text-align:center; }
.bottomRow{ display:grid; grid-template-columns: 1.5fr 1fr; gap:12px; margin-top:14px; align-items:stretch; }
.disclaimerBox{ border:1px solid var(--mid); border-radius:10px; padding:10px; }
.finePrint{ font-size:10px; line-height:1.35; }
.totalsBox{ border:1px solid var(--mid); border-radius:10px; padding:12px; }
.totLine{ display:flex; justify-content:space-between; font-size:11px; margin-bottom:6px; }
.totLabel{ opacity:.8; }
.totValue{ font-weight:900; }
.totalBig{ border-top:1px solid var(--mid); padding-top:10px; margin-top:10px; display:flex; justify-content:space-between; }
.totalBigLabel{ font-size:15px; font-weight:900; }
.totalBigValue{ font-size:15px; font-weight:900; }
.contractBar{ margin-top:14px; background:var(--brown); color:#fff; border-radius:10px; padding:9px 12px; text-align:center; font-weight:900; }
.signatureBlock{ margin-top:10px; border:1px solid var(--mid); border-radius:10px; padding:12px; }
.sigRow{ display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-top:14px; }
.sigLine{ height:16px; border-bottom:1px solid #333; }
.sigLabel{ font-size:10px; opacity:.75; margin-top:4px; }
body{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print{
  @page{ size: letter; margin: 0.20in; }
  .noPrint{ display:none !important; }
  html,body{ height:auto; margin:0; padding:0; }
  .page{ width: 8.5in; margin:0; padding:0.20in; height:auto; overflow:visible; transform: scale(0.98); transform-origin: top left; }
}
.section, .table, .infoBox, .notesBox, .disclaimerBox, .totalsBox, .signatureBlock{
  break-inside: avoid;
  page-break-inside: avoid;
}
`;
