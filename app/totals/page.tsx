"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GlassCard, SecondaryButton, SectionTitle } from "@/components/ui";
import { fetchDrafts } from "@/lib/draftsStore";
import { money } from "@/lib/money";
import type { QuoteItem } from "@/lib/types";

type DraftEntry = {
  id: string;
  createdAt?: number;
  updatedAt?: number;
  title?: string;
  customerName?: string;
  projectAddress?: string;
  status?: "estimate" | "pending" | "sold" | "complete" | "void";
  scheduledAt?: string;
  installDate?: string;
  startDate?: string;
  laborDays?: number;
  allowSaturday?: boolean;
  allowSunday?: boolean;
  items?: QuoteItem[];
  takeoffMaterials?: QuoteItem[];
  takeoffManualItems?: QuoteItem[];
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

function mergeDraftLists(local: DraftEntry[], remote: DraftEntry[]) {
  const byId = new Map<string, DraftEntry>();
  local.forEach((d) => {
    if (!d || !d.id) return;
    byId.set(String(d.id), { ...d });
  });
  remote.forEach((d) => {
    if (!d || !d.id) return;
    const id = String(d.id);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...d });
      return;
    }
    const prevTs = Number((prev as any).updatedAt ?? (prev as any).createdAt ?? 0) || 0;
    const nextTs = Number((d as any).updatedAt ?? (d as any).createdAt ?? 0) || 0;
    if (nextTs > prevTs) byId.set(id, { ...prev, ...d });
  });
  return Array.from(byId.values());
}

function sumLineTotals(items: QuoteItem[]) {
  return (Array.isArray(items) ? items : []).reduce((sum, i) => {
    const v = Number((i as any)?.lineTotal);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}

function isSameMonth(a: Date, y: number, m0: number) {
  return a.getFullYear() === y && a.getMonth() === m0;
}

function addDays(dt: Date, days: number) {
  const d = new Date(dt);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfDay(dt: Date) {
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function toIsoDayKey(dt: Date) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function asBool(v: unknown) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  return false;
}

function computeSpanDays(laborDays: unknown) {
  const n = Number(laborDays);
  const roundedHalf = Number.isFinite(n) && n > 0 ? Math.ceil(n * 2) / 2 : 0.5;
  return Math.max(1, Math.ceil(roundedHalf));
}

function computeWorkdaysEquivalent(laborDays: unknown) {
  const n = Number(laborDays);
  const roundedHalf = Number.isFinite(n) && n > 0 ? Math.ceil(n * 2) / 2 : 0.5;
  return Math.max(0.5, roundedHalf);
}

function nextWorkdayForJob(d: Date, allowSaturday: boolean, allowSunday: boolean) {
  let cur = startOfDay(d);
  while (true) {
    const day = cur.getDay();
    if (day === 6 && !allowSaturday) {
      cur = addDays(cur, 1);
      continue;
    }
    if (day === 0 && !allowSunday) {
      cur = addDays(cur, 1);
      continue;
    }
    return cur;
  }
}

function workdaySequenceForJob(start: Date, count: number, allowSaturday: boolean, allowSunday: boolean) {
  const days: Date[] = [];
  let cur = nextWorkdayForJob(start, allowSaturday, allowSunday);
  while (days.length < count) {
    const day = cur.getDay();
    const isSatBlocked = day === 6 && !allowSaturday;
    const isSunBlocked = day === 0 && !allowSunday;
    if (!isSatBlocked && !isSunBlocked) days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

function parseJobStartDate(d: DraftEntry): Date | null {
  const sched = String((d as any).scheduledAt || "");
  if (sched) {
    const isoDay = sched.length >= 10 ? sched.slice(0, 10) : "";
    if (isoDay) {
      // Normalize to a date-only key at midday to avoid timezone offsets shifting the day.
      const ms = Date.parse(isoDay + "T12:00:00");
      if (Number.isFinite(ms)) return new Date(ms);
    }
    const ms = Date.parse(sched);
    if (Number.isFinite(ms)) return new Date(ms);
  }

  const iso = String((d as any).startDate || (d as any).installDate || "");
  if (!iso) return null;
  // Use midday to avoid timezone edge cases when parsing yyyy-mm-dd.
  const ms = Date.parse(iso + "T12:00:00");
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function monthKeyFromDate(dt: Date) {
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function formatMonthLabel(key: string) {
  const [yRaw, mRaw] = key.split("-");
  const y = Number(yRaw);
  const m = Number(mRaw);
  const dt = new Date(y, Math.max(0, m - 1), 1);
  return dt.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function firstMondayOfMonth(y: number, m0: number) {
  const d = new Date(y, m0, 1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return startOfDay(d);
}

function weekBucketForDateInMonth(dt: Date, y: number, m0: number) {
  const firstMon = firstMondayOfMonth(y, m0);
  const day = startOfDay(dt);
  const diffDays = Math.floor((day.getTime() - firstMon.getTime()) / (24 * 60 * 60 * 1000));
  const raw = diffDays < 0 ? 1 : Math.floor(diffDays / 7) + 1;
  return Math.min(4, Math.max(1, raw));
}

function workingDaysInMonth(y: number, m0: number) {
  const d = new Date(y, m0, 1);
  let count = 0;
  while (d.getMonth() === m0) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(1, count);
}

function daysInMonth(y: number, m0: number) {
  const last = new Date(y, m0 + 1, 0);
  return Math.max(1, last.getDate());
}

function countWeekdaysBetween(start: Date, endExclusive: Date) {
  const s = startOfDay(start);
  const e = startOfDay(endExclusive);
  let cur = s;
  let count = 0;
  while (cur.getTime() < e.getTime()) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cur = addDays(cur, 1);
  }
  return count;
}

function computeBreakdown(items: QuoteItem[]) {
  const safeItems = Array.isArray(items) ? items : [];

  const norm = (s: unknown) => String(s || "").trim().toLowerCase();
  const isFee = (name: unknown, expected: string) => norm(name) === norm(expected);

  const laborTotal = sumLineTotals(safeItems.filter((i) => i.section === "labor"));

  const equipmentTotal = sumLineTotals(
    safeItems.filter((i) => i.section === "materials" && isFee((i as any).name, "Equipment Fees"))
  );
  const deliveryTotal = sumLineTotals(
    safeItems.filter((i) => i.section === "materials" && isFee((i as any).name, "Delivery"))
  );
  const disposalTotal = sumLineTotals(
    safeItems.filter((i) => i.section === "materials" && isFee((i as any).name, "Disposal"))
  );

  const materialsFeeTotal = equipmentTotal + deliveryTotal + disposalTotal;
  const materialsBase = sumLineTotals(
    safeItems.filter((i) => i.section === "materials" && ![
      "equipment fees",
      "equipment fee",
      "delivery",
      "disposal"
    ].includes(norm((i as any).name)))
  );

  const materialsTotal = materialsBase * 1.08;
  const pre20 = materialsTotal + materialsFeeTotal;
  const markup20 = pre20 * 0.2;

  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

  return {
    laborTotal: round2(laborTotal),
    materialsTotal: round2(materialsTotal),
    equipmentTotal: round2(equipmentTotal),
    deliveryTotal: round2(deliveryTotal),
    disposalTotal: round2(disposalTotal),
    materialsMarkup20: round2(markup20)
  };
}

type TotalsRow = {
  laborTotal: number;
  materialsTotal: number;
  equipmentTotal: number;
  deliveryTotal: number;
  disposalTotal: number;
  materialsMarkup20: number;
};

function addRows(a: TotalsRow, b: TotalsRow): TotalsRow {
  return {
    laborTotal: a.laborTotal + b.laborTotal,
    materialsTotal: a.materialsTotal + b.materialsTotal,
    equipmentTotal: a.equipmentTotal + b.equipmentTotal,
    deliveryTotal: a.deliveryTotal + b.deliveryTotal,
    disposalTotal: a.disposalTotal + b.disposalTotal,
    materialsMarkup20: a.materialsMarkup20 + b.materialsMarkup20
  };
}

function emptyRow(): TotalsRow {
  return { laborTotal: 0, materialsTotal: 0, equipmentTotal: 0, deliveryTotal: 0, disposalTotal: 0, materialsMarkup20: 0 };
}

function roundRow(r: TotalsRow): TotalsRow {
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  return {
    laborTotal: round2(r.laborTotal),
    materialsTotal: round2(r.materialsTotal),
    equipmentTotal: round2(r.equipmentTotal),
    deliveryTotal: round2(r.deliveryTotal),
    disposalTotal: round2(r.disposalTotal),
    materialsMarkup20: round2(r.materialsMarkup20)
  };
}

function rowGrandTotal(r: TotalsRow) {
  return r.laborTotal + r.materialsTotal + r.equipmentTotal + r.deliveryTotal + r.disposalTotal + r.materialsMarkup20;
}

function scaleRow(r: TotalsRow, factor: number): TotalsRow {
  return {
    laborTotal: r.laborTotal * factor,
    materialsTotal: r.materialsTotal * factor,
    equipmentTotal: r.equipmentTotal * factor,
    deliveryTotal: r.deliveryTotal * factor,
    disposalTotal: r.disposalTotal * factor,
    materialsMarkup20: r.materialsMarkup20 * factor
  };
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <div className="text-[var(--muted)]">{label}</div>
      <div className="font-black">{money(value)}</div>
    </div>
  );
}

function SummaryCard({ title, row }: { title: string; row: TotalsRow }) {
  const rounded = roundRow(row);
  const grand = Math.round(rowGrandTotal(rounded) * 100) / 100;

  return (
    <GlassCard className="p-4">
      <div className="text-sm font-extrabold mb-2">{title}</div>
      <div className="grid gap-2">
        <Line label="Labor" value={rounded.laborTotal} />
        <Line label="Materials" value={rounded.materialsTotal} />
        <Line label="Equipment" value={rounded.equipmentTotal} />
        <Line label="Delivery" value={rounded.deliveryTotal} />
        <Line label="Disposal" value={rounded.disposalTotal} />
        <Line label="Materials 20%" value={rounded.materialsMarkup20} />
        <div className="h-px bg-[rgba(255,255,255,.12)] my-1" />
        <div className="flex justify-between gap-3 text-base">
          <div className="font-black">TOTAL</div>
          <div className="font-black">{money(grand)}</div>
        </div>
      </div>
    </GlassCard>
  );
}

export default function TotalsPage() {
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [monthKey, setMonthKey] = useState<string>("");
  const [year, setYear] = useState<number>(() => new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const localStore = readDraftStore();
      const localList = Object.values(localStore).map((d) => ({ ...d }));

      const remote = await fetchDrafts();
      const remoteList = remote.ok ? (remote.drafts as DraftEntry[]) : [];

      const merged = mergeDraftLists(localList, remoteList);
      if (!cancelled) setDrafts(merged);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dayBuckets = useMemo(() => {
    const byDay = new Map<string, TotalsRow>();

    const includedDrafts = drafts.filter((d) => {
      const status = String((d as any)?.status || "estimate");
      return status === "sold";
    });
    for (const d of includedDrafts) {
      const start = parseJobStartDate(d);
      if (!start) continue;

      const span = computeSpanDays((d as any).laborDays);
      const allowSat = asBool((d as any).allowSaturday);
      const allowSun = asBool((d as any).allowSunday);
      const seq = workdaySequenceForJob(start, span, allowSat, allowSun);
      const items = Array.isArray((d as any).items) ? ((d as any).items as QuoteItem[]) : [];
      const takeoffMaterialsRaw = Array.isArray((d as any).takeoffMaterials)
        ? (((d as any).takeoffMaterials as any[]) as QuoteItem[])
        : [];
      const takeoffManualRaw = Array.isArray((d as any).takeoffManualItems)
        ? (((d as any).takeoffManualItems as any[]) as QuoteItem[])
        : [];
      const itemsForBreakdown =
        Array.isArray(items) && items.length > 0
          ? items
          : ([...takeoffMaterialsRaw, ...takeoffManualRaw] as QuoteItem[]);
      const jobRow = computeBreakdown(itemsForBreakdown);
      const perDay = scaleRow(jobRow, 1 / Math.max(1, seq.length));

      for (const day of seq) {
        const key = toIsoDayKey(day);
        byDay.set(key, addRows(byDay.get(key) ?? emptyRow(), perDay));
      }
    }

    return byDay;
  }, [drafts]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();

    for (const d of drafts) {
      const status = String((d as any)?.status || "estimate");
      if (status !== "sold") continue;
      const dt = parseJobStartDate(d);
      if (!dt) continue;
      years.add(dt.getFullYear());
    }

    const cur = new Date().getFullYear();
    years.add(cur);

    return Array.from(years.values()).sort((a, b) => b - a);
  }, [drafts]);

  useEffect(() => {
    if (availableYears.length === 0) return;
    if (availableYears.includes(year)) return;
    setYear(availableYears[0]);
  }, [availableYears, year]);

  const months = useMemo(() => {
    const out: string[] = [];
    for (let m = 1; m <= 12; m += 1) {
      out.push(`${year}-${String(m).padStart(2, "0")}`);
    }
    return out;
  }, [year]);

  useEffect(() => {
    if (!monthKey) {
      setMonthKey(`${year}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);
      return;
    }
    const y = Number(monthKey.split("-")[0]);
    if (Number.isFinite(y) && y !== year) setMonthKey(`${year}-${monthKey.split("-")[1]}`);
  }, [monthKey, year]);

  const includedCustomerNames = useMemo(() => {
    if (!monthKey) return [] as string[];

    const names = new Set<string>();
    const includedDrafts = drafts.filter((d) => {
      const status = String((d as any)?.status || "estimate");
      return status === "sold";
    });

    for (const d of includedDrafts) {
      const start = parseJobStartDate(d);
      if (!start) continue;

      const span = computeSpanDays((d as any).laborDays);
      const allowSat = asBool((d as any).allowSaturday);
      const allowSun = asBool((d as any).allowSunday);
      const seq = workdaySequenceForJob(start, span, allowSat, allowSun);

      const hitsMonth = seq.some((day) => monthKeyFromDate(day) === monthKey);
      if (!hitsMonth) continue;

      const name = String((d as any).customerName || (d as any).title || (d as any).projectAddress || "").trim();
      if (name) names.add(name);
    }

    return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
  }, [drafts, monthKey]);

  const days = useMemo(() => {
    const out = Array.from(dayBuckets.entries()).map(([key, row]) => {
      const ms = Date.parse(key + "T12:00:00");
      const dt = Number.isFinite(ms) ? new Date(ms) : null;
      if (!dt) return null;
      return { key, dt, monthKey: monthKeyFromDate(dt), week: 1, row };
    });
    return out.filter(Boolean) as Array<{ key: string; dt: Date; monthKey: string; week: number; row: TotalsRow }>;
  }, [dayBuckets]);

  const selectedMonthDays = useMemo(() => {
    if (!monthKey) return [] as Array<{ key: string; dt: Date; monthKey: string; week: number; row: TotalsRow }>;
    const [yRaw, mRaw] = monthKey.split("-");
    const y = Number(yRaw);
    const m0 = Number(mRaw) - 1;
    if (!Number.isFinite(y) || !Number.isFinite(m0)) return [];

    const count = daysInMonth(y, m0);
    const out: Array<{ key: string; dt: Date; monthKey: string; week: number; row: TotalsRow }> = [];
    for (let day = 1; day <= count; day += 1) {
      const dt = new Date(y, m0, day);
      const key = toIsoDayKey(dt);
      out.push({
        key,
        dt,
        monthKey,
        week: weekBucketForDateInMonth(dt, y, m0),
        row: dayBuckets.get(key) ?? emptyRow()
      });
    }
    return out;
  }, [dayBuckets, monthKey]);

  const selected = useMemo(() => {
    return selectedMonthDays;
  }, [selectedMonthDays]);

  const selectedDaysWithTotals = useMemo(() => {
    return selected.reduce((count, d) => {
      const g = rowGrandTotal(d.row);
      return count + (Math.abs(g) > 0.0001 ? 1 : 0);
    }, 0);
  }, [selected]);

  const monthTotals = useMemo(() => {
    return selected.reduce((sum, j) => {
      return addRows(sum, j.row);
    }, emptyRow());
  }, [selected]);

  const weekTotals = useMemo(() => {
    const out: Record<number, TotalsRow> = { 1: emptyRow(), 2: emptyRow(), 3: emptyRow(), 4: emptyRow() };
    for (const j of selected) {
      out[j.week] = addRows(out[j.week] ?? emptyRow(), j.row);
    }
    return out;
  }, [selected]);

  const perWorkingDay = useMemo(() => {
    if (!monthKey) return { row: emptyRow(), workingDays: 1 };
    const [yRaw, mRaw] = monthKey.split("-");
    const y = Number(yRaw);
    const m0 = Number(mRaw) - 1;
    const wd = workingDaysInMonth(y, m0);
    const div = (n: number) => (Number(n) || 0) / wd;
    return {
      workingDays: wd,
      row: {
        laborTotal: div(monthTotals.laborTotal),
        materialsTotal: div(monthTotals.materialsTotal),
        equipmentTotal: div(monthTotals.equipmentTotal),
        deliveryTotal: div(monthTotals.deliveryTotal),
        disposalTotal: div(monthTotals.disposalTotal),
        materialsMarkup20: div(monthTotals.materialsMarkup20)
      }
    };
  }, [monthKey, monthTotals]);

  const soldQueue = useMemo(() => {
    const soldDrafts = drafts.filter((d) => String((d as any)?.status || "estimate") === "sold");

    const totals = soldDrafts.reduce((sum, d) => {
      const items = Array.isArray((d as any).items) ? ((d as any).items as QuoteItem[]) : [];
      const takeoffMaterialsRaw = Array.isArray((d as any).takeoffMaterials)
        ? (((d as any).takeoffMaterials as any[]) as QuoteItem[])
        : [];
      const takeoffManualRaw = Array.isArray((d as any).takeoffManualItems)
        ? (((d as any).takeoffManualItems as any[]) as QuoteItem[])
        : [];
      const itemsForBreakdown =
        Array.isArray(items) && items.length > 0 ? items : ([...takeoffMaterialsRaw, ...takeoffManualRaw] as QuoteItem[]);
      return addRows(sum, computeBreakdown(itemsForBreakdown));
    }, emptyRow());

    const workdaysEq = soldDrafts.reduce((sum, d) => sum + computeWorkdaysEquivalent((d as any).laborDays), 0);

    const seasonStart = new Date(year, 2, 1);
    const seasonEnd = new Date(year, 11, 1);
    const seasonWorkdays = countWeekdaysBetween(seasonStart, seasonEnd);
    const avgPerWorkday = workdaysEq > 0 ? rowGrandTotal(totals) / workdaysEq : 0;
    const avgPerWeek = avgPerWorkday * 5;
    const projectedAnnual = avgPerWorkday * seasonWorkdays;

    return {
      count: soldDrafts.length,
      totals,
      workdaysEq,
      avgPerWorkday,
      avgPerWeek,
      seasonWorkdays,
      workingWeeks: seasonWorkdays / 5,
      projectedAnnual
    };
  }, [drafts, year]);

  const allTime = useMemo(() => {
    return days.reduce((sum, j) => addRows(sum, j.row), emptyRow());
  }, [days]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-black tracking-tight">Running Totals</div>
          <div className="text-sm text-[var(--muted)]">Sold jobs (spread across calendar workdays)</div>
        </div>
        <Link href="/tasks">
          <SecondaryButton>Back</SecondaryButton>
        </Link>
      </div>

      <GlassCard className="p-4">
        <div className="grid gap-2">
          <div className="text-[11px] text-[var(--muted)]">Month</div>
          <select
            className="w-full rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.08)] border border-[rgba(255,255,255,.14)] outline-none"
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {availableYears.map((y) => (
              <option key={y} value={String(y)}>
                {String(y)}
              </option>
            ))}
          </select>
          <select
            className="w-full rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.08)] border border-[rgba(255,255,255,.14)] outline-none"
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
          >
            {months.map((k) => (
              <option key={k} value={k}>
                {new Date(Number(k.split("-")[0]), Number(k.split("-")[1]) - 1, 1).toLocaleString(undefined, { month: "long" })}
              </option>
            ))}
          </select>
          <div className="text-[11px] text-[var(--muted)]">Days in month: {selected.length}</div>
          <div className="text-[11px] text-[var(--muted)]">Days with totals: {selectedDaysWithTotals}</div>
          <div className="text-[11px] text-[var(--muted)]">
            Customers: {includedCustomerNames.length > 0 ? includedCustomerNames.join(", ") : "(none)"}
          </div>
        </div>
      </GlassCard>

      <SectionTitle title="Sold queue" />
      <div className="grid gap-3">
        <GlassCard className="p-4">
          <div className="text-sm font-extrabold mb-2">Sold breakdown ({soldQueue.count} jobs)</div>
          <div className="grid gap-2">
            <Line
              label="Material costs"
              value={soldQueue.totals.materialsTotal + soldQueue.totals.deliveryTotal + soldQueue.totals.disposalTotal}
            />
            <Line label="Equipment costs" value={soldQueue.totals.equipmentTotal} />
            <Line label="Markup" value={soldQueue.totals.materialsMarkup20} />
            <Line label="Labor" value={soldQueue.totals.laborTotal} />
            <div className="h-px bg-[rgba(255,255,255,.12)] my-1" />
            <div className="flex justify-between gap-3 text-base">
              <div className="font-black">TOTAL REVENUE</div>
              <div className="font-black">{money(rowGrandTotal(soldQueue.totals))}</div>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="text-sm font-extrabold mb-2">Projected annual revenue (Mar–Nov)</div>
          <div className="grid gap-2">
            <Line label="Revenue / 5-day week" value={soldQueue.avgPerWeek} />
            <div className="flex justify-between gap-3 text-sm">
              <div className="text-[var(--muted)]">Working weeks</div>
              <div className="font-black">{soldQueue.workingWeeks.toFixed(1)}</div>
            </div>
            <div className="h-px bg-[rgba(255,255,255,.12)] my-1" />
            <div className="flex justify-between gap-3 text-base">
              <div className="font-black">PROJECTED</div>
              <div className="font-black">{money(soldQueue.projectedAnnual)}</div>
            </div>
          </div>
        </GlassCard>
      </div>

      <SectionTitle title="Weeks (1-4)" />
      <div className="grid gap-3">
        <SummaryCard title="Week 1" row={weekTotals[1]} />
        <SummaryCard title="Week 2" row={weekTotals[2]} />
        <SummaryCard title="Week 3" row={weekTotals[3]} />
        <SummaryCard title="Week 4" row={weekTotals[4]} />
      </div>

      <SectionTitle title="Month" />
      <div className="grid gap-3">
        <SummaryCard title="Month total" row={monthTotals} />
        <SummaryCard
          title={`Per working day (avg) — ${perWorkingDay.workingDays} days`}
          row={perWorkingDay.row}
        />
      </div>

      <SectionTitle title="All time" />
      <SummaryCard title="Running total (sold jobs)" row={allTime} />
    </div>
  );
}
