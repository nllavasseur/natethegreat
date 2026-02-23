export type SectionKey = "materials" | "labor" | "additional";

export type QuoteItem = {
  id?: string;
  section: SectionKey;
  priceKey?: string;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
};

export type Quote = {
  id?: string;
  createdAt?: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  projectAddress: string;
  styleTitle: string;
  notes: string;
  discount: number;
  tax: number;
  depositTotal: number;
  total: number;
};

export type QuoteTotals = {
  materialsSubtotal: number;
  laborSubtotal: number;
  additionalSubtotal: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  depositTotal: number;
};
