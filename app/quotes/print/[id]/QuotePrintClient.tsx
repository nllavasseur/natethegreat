"use client";

import React from "react";
import { money } from "@/lib/money";
import { fetchDraft } from "@/lib/draftsStore";
import { computeMaterialsAndExpensesTotal } from "@/lib/totals";
import type { QuoteItem } from "@/lib/types";

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
  projectPhotoDataUrl?: string | null;
  segments?: Array<{ length: number; removed?: boolean; removal?: boolean }>; 
  items?: QuoteItem[];
};

function readDraftStore(): Record<string, DraftEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("vf_estimate_drafts_v1");
    return raw ? (JSON.parse(raw) as Record<string, DraftEntry>) : {};
  } catch {
    return {};
  }
}

export default function QuotePrintClient({ id, printCss }: { id: string; printCss: string }) {
  const [draft, setDraft] = React.useState<DraftEntry | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await fetchDraft({ id });
      if (cancelled) return;
      if (remote.ok && remote.draft) {
        setDraft(remote.draft as DraftEntry);
        return;
      }
      const store = readDraftStore();
      setDraft(store[id] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const items = Array.isArray(draft?.items) ? (draft!.items as QuoteItem[]) : [];
  const materialsAndExpensesTotal = React.useMemo(() => computeMaterialsAndExpensesTotal(items), [items]);

  const segments = Array.isArray(draft?.segments) ? (draft!.segments as any[]) : [];
  const removalLf = segments
    .filter((s: any) => Boolean(s?.removed) || Boolean(s?.removal))
    .reduce((sum: number, s: any) => sum + (Number(s?.length) || 0), 0);
  const removalTotal = Math.round(removalLf * 6 * 100) / 100;

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
  const additionalFeesTotal = additionalFeeItems.reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);

  const total = Math.round(
    ((Number(materialsAndExpensesTotal) || 0) + (Number(additionalFeesTotal) || 0) + (Number(removalTotal) || 0) + (Number(laborBaseTotal) || 0)) * 100
  ) / 100;

  const layoutSrc = (() => {
    const url = (draft as any)?.projectPhotoUrl;
    if (typeof url === "string" && url) return url;
    const data = (draft as any)?.projectPhotoDataUrl;
    if (typeof data === "string" && data) return data;
    return "";
  })();

  const customerName = String(draft?.customerName || "");
  const projectAddress = String(draft?.projectAddress || "");
  const styleTitle = String(draft?.selectedStyle?.name || "");
  const notes = String(draft?.notes || "");

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Vasseur Fencing - Estimate</title>
        <style>{printCss}</style>
      </head>
      <body>
        <div className="noPrint controls">
          <button onClick={() => window.print()} className="btn">
            Print / Save as PDF
          </button>
        </div>

        <main className="page">
          <header className="headerRow">
            <div className="headerLeft">
              <div className="logo placeholder" />
              <div>
                <div className="companyName">Vasseur Fencing</div>
                <div className="tagline">Fencing Contractor</div>
              </div>
            </div>

            <div className="headerRight">
              <div className="rightBold">Estimate</div>
              <div>{new Date().toLocaleDateString("en-US")}</div>
            </div>
          </header>

          <div className="divider" />
          <div className="estimateTitle">ESTIMATE</div>

          <section className="infoGrid">
            <div className="infoBox">
              <div className="infoLabel">Estimate for</div>
              <div className="infoValue">{customerName}</div>
            </div>
            <div className="infoBox">
              <div className="infoLabel">Project address</div>
              <div className="infoValue">{projectAddress}</div>
            </div>
            <div className="infoBox">
              <div className="infoLabel">Style</div>
              <div className="infoValue">{styleTitle}</div>
            </div>
          </section>

          {layoutSrc ? (
            <section className="section">
              <div className="sectionHeader">Fence Layout</div>
              <div className="table" style={{ padding: 10 }}>
                <img src={layoutSrc} alt="Fence layout" style={{ width: "100%", height: "auto", borderRadius: 10 }} />
              </div>
            </section>
          ) : null}

          {notes ? (
            <section className="notesBox">
              <div className="notesTitle">Notes</div>
              <div className="notesText">{notes}</div>
            </section>
          ) : null}

          <section className="bottomRow">
            <div className="disclaimerBox">
              <div className="notesTitle">Totals</div>
              <div className="totLine"><div className="totLabel">Materials &amp; expenses</div><div className="totValue">{money(materialsAndExpensesTotal)}</div></div>
              <div className="totLine"><div className="totLabel">Additional fees</div><div className="totValue">{money(additionalFeesTotal)}</div></div>
              <div className="totLine"><div className="totLabel">Fence removal</div><div className="totValue">{money(removalTotal)}</div></div>
              <div className="totLine"><div className="totLabel">Labor</div><div className="totValue">{money(laborBaseTotal)}</div></div>
              <div className="totalBig"><div className="totalBigLabel">TOTAL</div><div className="totalBigValue">{money(total)}</div></div>
            </div>

            <div className="totalsBox">
              <div className="notesTitle">Additional fees</div>
              {additionalFeeItems.length ? (
                additionalFeeItems.map((f) => (
                  <div key={f.name} className="totLine"><div className="totLabel">{f.name}</div><div className="totValue">{money(f.lineTotal)}</div></div>
                ))
              ) : (
                <div className="finePrint">None</div>
              )}
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
