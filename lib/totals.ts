import { QuoteItem, QuoteTotals } from "./types";

export function computeMaterialsAndExpensesTotal(materialItems: QuoteItem[]): number {
  const feeNames = new Set(["disposal", "delivery", "equipment fees", "equipment fee"]);
  const isFeeName = (name: unknown) => {
    const n = String(name || "")
      .trim()
      .toLowerCase();
    return feeNames.has(n);
  };
  const sum = (arr: QuoteItem[]) =>
    arr.reduce((a, b) => {
      const v = Number((b as any)?.lineTotal);
      return a + (Number.isFinite(v) ? v : 0);
    }, 0);

  const safeItems = Array.isArray(materialItems) ? materialItems : [];
  const feesTotal = sum(safeItems.filter((i) => i.section === "materials" && isFeeName(i.name)));
  const materialsBase = sum(safeItems.filter((i) => i.section === "materials" && !isFeeName(i.name)));

  const v = ((materialsBase * 1.08 + feesTotal) * 1.2);
  return Math.round(v * 100) / 100;
}

export function computeTotals(items: QuoteItem[], discount: number, tax: number, depositTotal: number): QuoteTotals {
  const sum = (arr: QuoteItem[]) =>
    arr.reduce((a, b) => {
      const v = Number((b as any)?.lineTotal);
      return a + (Number.isFinite(v) ? v : 0);
    }, 0);

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
