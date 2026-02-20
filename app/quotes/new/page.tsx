"use client";

import React, { useMemo, useState } from "react";
import { GlassCard, Input, PrimaryButton, SecondaryButton, SectionTitle, Select } from "@/components/ui";
import { QuoteItem, SectionKey } from "@/lib/types";
import { computeTotals } from "@/lib/totals";
import { money } from "@/lib/money";
import Link from "next/link";

const sectionOptions: { key: SectionKey; label: string }[] = [
  { key: "materials", label: "Materials & Expenses" },
  { key: "labor", label: "Fence Installation / Labor" },
  { key: "additional", label: "Additional Services" }
];

function emptyItem(section: SectionKey): QuoteItem {
  return { section, name: "", qty: 1, unit: "ea", unitPrice: 0, lineTotal: 0 };
}

export default function NewQuotePage() {
  const [customerName, setCustomerName] = useState("");
  const [styleTitle, setStyleTitle] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [depositTotal, setDepositTotal] = useState(0);

  const [items, setItems] = useState<QuoteItem[]>([
    { section: "materials", name: "Horizontal rails", qty: 500, unit: "ea", unitPrice: 12.5, lineTotal: 6250 },
    { section: "labor", name: "Fence installation / labor", qty: 1000, unit: "ft", unitPrice: 35, lineTotal: 35000 },
    { section: "additional", name: "Brush Hog / Woods Clearing", qty: 1, unit: "ea", unitPrice: 1200, lineTotal: 1200 }
  ]);

  const totals = useMemo(() => computeTotals(items, discount, tax, depositTotal), [items, discount, tax, depositTotal]);

  function recalc(idx: number, patch: Partial<QuoteItem>) {
    setItems((prev) => {
      const next = [...prev];
      const current = { ...next[idx], ...patch };
      const qty = Number(current.qty) || 0;
      const unitPrice = Number(current.unitPrice) || 0;
      current.lineTotal = Math.round((qty * unitPrice) * 100) / 100;
      next[idx] = current;
      return next;
    });
  }

  function addItem(section: SectionKey) {
    setItems((prev) => [...prev, emptyItem(section)]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-black tracking-tight">New Quote</div>
          <div className="text-sm text-[var(--muted)]">UI-first builder. Connect Supabase after.</div>
        </div>
        <Link href="/quotes">
          <SecondaryButton>Back</SecondaryButton>
        </Link>
      </div>

      <GlassCard className="p-4">
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <div className="text-[11px] text-[var(--muted)] mb-1">Customer</div>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" />
          </div>
          <div>
            <div className="text-[11px] text-[var(--muted)] mb-1">Style</div>
            <Input value={styleTitle} onChange={(e) => setStyleTitle(e.target.value)} placeholder="e.g. Standard Privacy" />
          </div>
          <div>
            <div className="text-[11px] text-[var(--muted)] mb-1">Address</div>
            <Input value={projectAddress} onChange={(e) => setProjectAddress(e.target.value)} placeholder="Project address" />
          </div>
        </div>
      </GlassCard>

      {sectionOptions.map((s) => {
        const rows = items.filter((i) => i.section === s.key);
        return (
          <div key={s.key}>
            <SectionTitle
              title={s.label}
              right={<SecondaryButton onClick={() => addItem(s.key)}>Add</SecondaryButton>}
            />
            <GlassCard className="p-3">
              <div className="grid gap-2">
                {rows.map((row, localIdx) => {
                  const idx = items.findIndex((it) => it === row);
                  return (
                    <div key={idx} className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                      <div className="grid md:grid-cols-12 gap-2">
                        <div className="md:col-span-5">
                          <div className="text-[11px] text-[var(--muted)] mb-1">Item</div>
                          <Input value={row.name} onChange={(e) => recalc(idx, { name: e.target.value })} placeholder="Line item name" />
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-[11px] text-[var(--muted)] mb-1">Qty</div>
                          <Input
                            inputMode="decimal"
                            value={String(row.qty)}
                            onChange={(e) => recalc(idx, { qty: Number(e.target.value) })}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-[11px] text-[var(--muted)] mb-1">Unit</div>
                          <Select value={row.unit} onChange={(e) => recalc(idx, { unit: e.target.value })}>
                            <option value="ea">ea</option>
                            <option value="ft">ft</option>
                            <option value="lf">lf</option>
                            <option value="yd">yd</option>
                          </Select>
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-[11px] text-[var(--muted)] mb-1">Unit Price</div>
                          <Input
                            inputMode="decimal"
                            value={String(row.unitPrice)}
                            onChange={(e) => recalc(idx, { unitPrice: Number(e.target.value) })}
                          />
                        </div>
                        <div className="md:col-span-1">
                          <div className="text-[11px] text-[var(--muted)] mb-1"> </div>
                          <SecondaryButton onClick={() => removeItem(idx)} className="w-full">✕</SecondaryButton>
                        </div>
                      </div>
                      <div className="mt-2 text-right text-sm font-black">{money(row.lineTotal)}</div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </div>
        );
      })}

      <SectionTitle title="Totals" />
      <GlassCard className="p-4">
        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <div className="text-[11px] text-[var(--muted)] mb-1">Discount</div>
            <Input inputMode="decimal" value={String(discount)} onChange={(e) => setDiscount(Number(e.target.value))} />
          </div>
          <div>
            <div className="text-[11px] text-[var(--muted)] mb-1">Tax</div>
            <Input inputMode="decimal" value={String(tax)} onChange={(e) => setTax(Number(e.target.value))} />
          </div>
          <div>
            <div className="text-[11px] text-[var(--muted)] mb-1">Deposit total</div>
            <Input inputMode="decimal" value={String(depositTotal)} onChange={(e) => setDepositTotal(Number(e.target.value))} />
          </div>
          <div className="flex items-end justify-end">
            <PrimaryButton onClick={() => alert("Next: save to Supabase (we’ll wire this up).")}>
              Save Quote
            </PrimaryButton>
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-sm">
          <div className="flex justify-between"><span className="text-[var(--muted)]">Materials</span><span className="font-black">{money(totals.materialsSubtotal)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Labor</span><span className="font-black">{money(totals.laborSubtotal)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Additional</span><span className="font-black">{money(totals.additionalSubtotal)}</span></div>
          <div className="h-px bg-[rgba(255,255,255,.12)] my-1" />
          <div className="flex justify-between"><span className="text-[var(--muted)]">Subtotal</span><span className="font-black">{money(totals.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Discount</span><span className="font-black">-{money(Math.abs(totals.discount))}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Tax</span><span className="font-black">{money(totals.tax)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Deposit total</span><span className="font-black">{money(totals.depositTotal)}</span></div>
          <div className="h-px bg-[rgba(255,255,255,.12)] my-1" />
          <div className="flex justify-between text-base"><span className="font-black">TOTAL</span><span className="font-black">{money(totals.total)}</span></div>
        </div>
      </GlassCard>
    </div>
  );
}
