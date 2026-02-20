import { QuoteItem, QuoteTotals } from "./types";

export function computeTotals(items: QuoteItem[], discount: number, tax: number, depositTotal: number): QuoteTotals {
  const sum = (arr: QuoteItem[]) => arr.reduce((a, b) => a + (Number.isFinite(b.lineTotal) ? b.lineTotal : 0), 0);

  const materialsSubtotal = sum(items.filter(i => i.section === "materials"));
  const laborSubtotal = sum(items.filter(i => i.section === "labor"));
  const additionalSubtotal = sum(items.filter(i => i.section === "additional"));
  const subtotal = materialsSubtotal + laborSubtotal + additionalSubtotal;

  const safeDiscount = Number.isFinite(discount) ? discount : 0;
  const safeTax = Number.isFinite(tax) ? tax : 0;
  const computedTotal = subtotal - safeDiscount + safeTax;

  return {
    materialsSubtotal,
    laborSubtotal,
    additionalSubtotal,
    subtotal,
    discount: safeDiscount,
    tax: safeTax,
    total: computedTotal,
    depositTotal: Number.isFinite(depositTotal) ? depositTotal : 0
  };
}
