"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import NextImage from "next/image";
import { GlassCard, Input, PrimaryButton, SecondaryButton, SectionTitle, Select } from "@/components/ui";
import { money } from "@/lib/money";
import { computeTotals } from "@/lib/totals";
import type { QuoteItem, SectionKey } from "@/lib/types";

const sectionOptions: { key: SectionKey; label: string }[] = [
  { key: "materials", label: "Materials & Expenses" },
  { key: "labor", label: "Fence Installation / Labor" },
  { key: "additional", label: "Additional Services" }
];

function emptyItem(section: SectionKey): QuoteItem {
  return { section, name: "", qty: section === "additional" ? 0 : 1, unit: "ea", unitPrice: 0, lineTotal: 0 };
}

export default function EstimatesPage() {
  return (
    <Suspense>
      <EstimatesPageInner />
    </Suspense>
  );
}

function EstimatesPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [portalReady, setPortalReady] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [projectPhoto, setProjectPhoto] = useState<File | null>(null);
  const [projectPhotoUrl, setProjectPhotoUrl] = useState<string | null>(null);
  const [projectPhotoDataUrl, setProjectPhotoDataUrl] = useState<string | null>(null);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [tracePoints, setTracePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrResults, setOcrResults] = useState<Array<{ label: string; value: number | null; raw: string }>>([]);
  const [ocrEmpty, setOcrEmpty] = useState(false);
  const [ocrCenters, setOcrCenters] = useState<Record<string, { x: number; y: number }>>({});
  const [pickOcrForLabel, setPickOcrForLabel] = useState<string | null>(null);
  const [referenceLength, setReferenceLength] = useState(0);
  const [segments, setSegments] = useState<Array<{ id: string; label: string; length: number; removed: boolean; gate?: boolean }>>([]);
  const [notes, setNotes] = useState("");
  const [preInstallPhotos, setPreInstallPhotos] = useState<Array<{ src: string; note: string; createdAt: number }>>([]);
  const preInstallPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [notePhotoIdx, setNotePhotoIdx] = useState<number | null>(null);
  const [laborDays, setLaborDays] = useState<number>(0);
  const [laborManualDays, setLaborManualDays] = useState<string>("");
  const [laborManualCost, setLaborManualCost] = useState<string>("");
  const [gradingPrice, setGradingPrice] = useState<number>(0);
  const [treeRemovalPrice, setTreeRemovalPrice] = useState<number>(0);
  const [toughDigEnabled, setToughDigEnabled] = useState<boolean>(false);
  const [gradeEnabled, setGradeEnabled] = useState<boolean>(false);
  const [stumpGrindingPrice, setStumpGrindingPrice] = useState<number>(0);
  const [doubleGateCount, setDoubleGateCount] = useState<number>(0);

  const materialStyles: Array<{ type: "wood" | "vinyl" | "aluminum" | "chainlink"; name: string; thumb: string }> = [
    {
      type: "wood",
      name: "Standard Privacy",
      thumb:
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'>
            <defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'><stop stop-color='#4E5B31'/><stop offset='1' stop-color='#1F4D3A'/></linearGradient></defs>
            <rect width='80' height='80' rx='14' fill='url(#g)'/>
            <g opacity='.28' fill='#fff'>
              <rect x='14' y='14' width='6' height='52' rx='3'/>
              <rect x='26' y='14' width='6' height='52' rx='3'/>
              <rect x='38' y='14' width='6' height='52' rx='3'/>
              <rect x='50' y='14' width='6' height='52' rx='3'/>
              <rect x='62' y='14' width='6' height='52' rx='3'/>
            </g>
          </svg>`
        )
    },
    {
      type: "wood",
      name: "Picture Framed",
      thumb:
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'>
            <rect width='80' height='80' rx='14' fill='#4E5B31'/>
            <rect x='14' y='14' width='52' height='52' rx='10' fill='rgba(255,255,255,.10)' stroke='rgba(255,255,255,.35)' stroke-width='4'/>
            <rect x='24' y='24' width='32' height='32' rx='8' fill='rgba(255,255,255,.08)'/>
          </svg>`
        )
    },
    {
      type: "wood",
      name: "3 Rail w/ Wire Mesh",
      thumb:
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'>
            <rect width='80' height='80' rx='14' fill='#1F4D3A'/>
            <g stroke='rgba(255,255,255,.35)' stroke-width='4' stroke-linecap='round'>
              <path d='M16 24h48'/>
              <path d='M16 40h48'/>
              <path d='M16 56h48'/>
            </g>
            <g stroke='rgba(255,255,255,.18)' stroke-width='1'>
              ${Array.from({ length: 10 })
                .map((_, i) => `<path d='M16 ${18 + i * 5}h48'/>`)
                .join("")}
            </g>
          </svg>`
        )
    },
    {
      type: "wood",
      name: "Split Rail",
      thumb:
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'>
            <rect width='80' height='80' rx='14' fill='#8A5A2B'/>
            <g stroke='rgba(255,255,255,.35)' stroke-width='5' stroke-linecap='round'>
              <path d='M16 28h48'/>
              <path d='M16 52h48'/>
            </g>
            <g opacity='.25' fill='#fff'>
              <rect x='18' y='18' width='6' height='44' rx='3'/>
              <rect x='56' y='18' width='6' height='44' rx='3'/>
            </g>
          </svg>`
        )
    }
  ];

  const [stylePickerIdx, setStylePickerIdx] = useState<boolean>(false);
  const [selectedFenceType, setSelectedFenceType] = useState<"wood" | "vinyl" | "aluminum" | "chainlink">("wood");
  const [selectedStyle, setSelectedStyle] = useState<{ name: string; thumb: string } | null>(null);
  const [materialsDetailsOpen, setMaterialsDetailsOpen] = useState<boolean>(false);
  const [materialsDetails, setMaterialsDetails] = useState<{
    woodType: "Pressure treated" | "Cedar" | "Cedar tone";
    postSize: 8 | 10 | 12 | 14;
    postType: "Pressure treated" | "Cedar" | "Cedar tone";
    postCaps: boolean;
    arbor: boolean;
  }>({
    woodType: "Pressure treated",
    postSize: 8,
    postType: "Pressure treated",
    postCaps: false,
    arbor: false
  });

  const [extraPosts, setExtraPosts] = useState<number>(0);

  const materialsDetailsActive = useMemo(() => {
    return (
      materialsDetails.woodType !== "Pressure treated" ||
      materialsDetails.postType !== "Pressure treated" ||
      materialsDetails.postSize !== 8 ||
      materialsDetails.postCaps ||
      materialsDetails.arbor ||
      (Number(extraPosts) || 0) !== 0
    );
  }, [extraPosts, materialsDetails]);
  const [materialUnitPrices, setMaterialUnitPrices] = useState<Record<string, number>>({
    "4x4 x 8' Post": 11.08,
    "6' Pressure Treated Dog Ear Pickets": 2.38,
    "2x4 16' Pressure Treated Rails": 13.78,
    "80 lb Quickcrete": 5.31,
    "2\" Nails 2000ct Hot-Dipped Galvanized Ring Shank Nails": 98,
    "Gate Hinge Kit": 90,
    "Double gate kit": 180,
    "3\" Deck Screws": 35,
    "Cedar S4S Gate Framing": 12,
    "Post caps": 5,
    "Arbor": 200,
    "Disposal": 100,
    "Delivery": 100,
    "Equipment Fees": 100
  });

  const defaultMaterialUnitPricesRef = useRef(materialUnitPrices);
  const touchedMaterialUnitPricesRef = useRef<Set<string>>(new Set());

  const cedarToneUnitPricesRef = useRef<Record<string, number>>({
    "6' Pressure Treated Dog Ear Pickets": 3.89,
    "2x4 16' Pressure Treated Rails": 15.89,
    "4x4 x 8' Post": 16.49,
    "3\" Deck Screws": 29.97
  });

  const materialUnitPricesActive = useMemo(() => {
    const base = defaultMaterialUnitPricesRef.current;
    for (const k of Object.keys(base)) {
      if (Number(materialUnitPrices[k]) !== Number(base[k])) return true;
    }
    return false;
  }, [materialUnitPrices]);

  useEffect(() => {
    const wood = materialsDetails.woodType;
    const base = defaultMaterialUnitPricesRef.current;
    const preset = cedarToneUnitPricesRef.current;
    const touched = touchedMaterialUnitPricesRef.current;

    setMaterialUnitPrices((prev) => {
      const next = { ...prev };
      const keys = Object.keys(base);
      let changed = false;

      for (const k of keys) {
        if (touched.has(k)) continue;

        const target = wood === "Cedar tone"
          ? (typeof preset[k] === "number" ? preset[k] : base[k])
          : base[k];

        if (Number(next[k]) !== Number(target)) {
          next[k] = target;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [materialsDetails.woodType]);

  const [materialUnitPriceDrafts, setMaterialUnitPriceDrafts] = useState<Record<string, string>>({});
  const [itemNumberDrafts, setItemNumberDrafts] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [savingAsNew, setSavingAsNew] = useState(false);
  const [saveAsNewJustSaved, setSaveAsNewJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const totalLf = useMemo(() => {
    return segments.reduce((sum, s) => sum + (Number(s.length) || 0), 0);
  }, [segments]);

  const tracedSegments = useMemo(() => {
    const pts = tracePoints;
    if (pts.length < 2) return [] as Array<{ label: string; a: { x: number; y: number }; b: { x: number; y: number } }>;
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const out: Array<{ label: string; a: { x: number; y: number }; b: { x: number; y: number } }> = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const A = letters[i] ?? "A";
      const B = letters[i + 1] ?? "B";
      out.push({ label: `${A}–${B}`, a: pts[i], b: pts[i + 1] });
    }
    return out;
  }, [tracePoints]);

  useEffect(() => {
    setOcrResults((prev) => {
      const map = new Map(prev.map((p) => [p.label, p] as const));
      return tracedSegments.map((s) => map.get(s.label) ?? { label: s.label, value: null, raw: "" });
    });
  }, [tracedSegments]);

  const removalLf = useMemo(() => {
    return segments
      .filter((s) => s.removed)
      .reduce((sum, s) => sum + (Number(s.length) || 0), 0);
  }, [segments]);

  const removalRate = 6;
  const removalTotal = useMemo(() => {
    const lf = Number(removalLf) || 0;
    return Math.round(lf * removalRate * 100) / 100;
  }, [removalLf]);

  const walkGateCountDerived = useMemo(() => {
    return segments.filter((s) => Boolean((s as any).gate)).length;
  }, [segments]);

  const generatedMaterials = useMemo(() => {
    if (!selectedStyle) return [] as QuoteItem[];

    const walkGates = Number(walkGateCountDerived) || 0;
    const doubleGates = Number(doubleGateCount) || 0;

    const walkGatePostsAdd = segments
      .filter((s) => Boolean((s as any).gate))
      .reduce((sum, s) => {
        const len = Number((s as any).length) || 0;
        return sum + (len > 0 && len < 8 ? 2 : 1);
      }, 0);

    const gatePostsAdd = walkGatePostsAdd + doubleGates;
    const gateHingeKitsAdd = walkGates * 1;
    const doubleGateKitsAdd = doubleGates;
    const gateFramingAdd = walkGates * 5 + doubleGates * 10;

    if (selectedStyle.name === "Standard Privacy") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);

      const segmentLengths = segments.map((s) => Number(s.length) || 0).filter((n) => n > 0);

      // Posts = ceil(segment/7.5) for each segment + 1 for first segment
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0) + 1
        : 0;
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));

      // Rails = ceil(segment/15 * 3) per segment
      const rails = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil((len / 15) * 3), 0)
        : 0;

      // Pickets = ceil(totalLf * 12 / 5.5) + 15 pickets per every 100ft
      const pickets = totalLf > 0 ? Math.ceil((totalLf * 12) / 5.5) + Math.floor(totalLf / 100) * 15 : 0;

      const concrete = posts * 2;

      // Nails: pickets*6 nails, 2000 per box
      const nailsBoxes = pickets > 0 ? Math.ceil((pickets * 6) / 2000) : 0;

      // Screws: 6 per rail, 350 per box
      const screwBoxes = rails > 0 ? Math.ceil((rails * 6) / 350) : 0;

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: "4x4 x 8' Post", qty: posts, unit: "ea" },
        { name: "2x4 16' Pressure Treated Rails", qty: rails, unit: "ea" },
        { name: "6' Pressure Treated Dog Ear Pickets", qty: pickets, unit: "ea" },
        { name: "80 lb Quickcrete", qty: concrete, unit: "bag" },
        { name: "2\" Nails 2000ct Hot-Dipped Galvanized Ring Shank Nails", qty: nailsBoxes, unit: "box" },
        { name: "3\" Deck Screws", qty: screwBoxes, unit: "box" },
        ...(materialsDetails.postCaps ? [{ name: "Post caps", qty: posts, unit: "ea" }] : []),
        ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" }] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows.map((r) => {
        const unitPrice = Number(materialUnitPrices[r.name] ?? 0);
        const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
        return { section: "materials" as const, name: r.name, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
      });
    }

    // Placeholder rule set for now (iterate with you): driven by total LF.
    // We’ll replace these rules with your exact Standard Privacy rules.
    const lf = totalLf;
    const postSpacingFt = 8;
    const postsBase = lf > 0 ? Math.max(2, Math.ceil(lf / postSpacingFt) + 1) : 0;
    const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));
    const railsPerSection = 3;
    const rails = posts > 1 ? (posts - 1) * railsPerSection : 0;
    const picketsPerFt = 1.3;
    const pickets = lf > 0 ? Math.ceil(lf * picketsPerFt) : 0;
    const concreteBagsPerPost = 2;
    const concrete = posts * concreteBagsPerPost;

    const rows: Array<{ name: string; qty: number; unit: string }> = [
      { name: "4x4 Post", qty: posts, unit: "ea" },
      { name: "2x4 Treated", qty: rails, unit: "ea" },
      { name: "6' Pressure Treated Dog Ear Pickets", qty: pickets, unit: "ea" },
      { name: "Concrete (bags)", qty: concrete, unit: "ea" },
      { name: "Fasteners", qty: 1, unit: "ea" },
      ...(materialsDetails.postCaps ? [{ name: "Post caps", qty: posts, unit: "ea" }] : []),
      ...(materialsDetails.arbor ? [{ name: "Arbor", qty: 1, unit: "ea" }] : []),
      ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
      ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
      ...(gateFramingAdd > 0 ? [{ name: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" }] : [])
    ];

    return rows.map((r) => {
      const unitPrice = Number(materialUnitPrices[r.name] ?? 0);
      const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
      return { section: "materials" as const, name: r.name, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
    });
  }, [doubleGateCount, extraPosts, materialUnitPrices, materialsDetails.arbor, materialsDetails.postCaps, segments, selectedStyle, totalLf, walkGateCountDerived]);

  const storageKey = "vf_estimate_drafts_v1";
  const unsavedSnapshotKey = "vf_estimate_unsaved_snapshot_v1";

  function readDraftStore(): Record<string, any> {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Record<string, any>) : {};
    } catch {
      return {};
    }
  }

  function writeDraftStore(store: Record<string, any>) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(store));
  }

  function clearUnsavedSnapshot() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(unsavedSnapshotKey);
    } catch {
      // ignore
    }
  }

  function writeUnsavedSnapshot() {
    if (typeof window === "undefined") return;
    try {
      const payload = {
        customerName,
        projectAddress,
        phoneNumber,
        email,
        projectPhotoDataUrl,
        selectedFenceType,
        selectedStyle,
        materialsDetails,
        extraPosts,
        materialUnitPrices,
        laborDays,
        laborManualDays,
        laborManualCost,
        gradingPrice,
        treeRemovalPrice,
        toughDigEnabled,
        gradeEnabled,
        stumpGrindingPrice,
        doubleGateCount,
        referenceLength,
        notes,
        preInstallPhotos,
        segments,
        items
      };
      window.localStorage.setItem(unsavedSnapshotKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function buildContractPayload(overrideDraftId?: string) {
    const materialsRows = items
      .filter((i) => i.section === "materials" && (Number(i.qty) || 0) > 0)
      .map((i) => ({
        name: i.name,
        qty: Number(i.qty) || 0,
        unit: i.unit,
        unitPrice: Number(i.unitPrice) || 0,
        price: Number(i.lineTotal) || 0
      }));

    const laborRows = items
      .filter((i) => i.section === "labor" && (Number(i.qty) || 0) > 0)
      .map((i) => ({
        name: i.name,
        qty: Number(i.qty) || 0,
        unit: i.unit,
        unitPrice: Number(i.unitPrice) || 0,
        price: Number(i.lineTotal) || 0
      }));

    const additionalRows = items
      .filter((i) => i.section === "additional" && (Number(i.qty) || 0) > 0)
      .map((i) => ({
        name: i.name,
        qty: Number(i.qty) || 0,
        unit: i.unit,
        unitPrice: Number(i.unitPrice) || 0,
        price: Number(i.lineTotal) || 0
      }));

    return {
      company: {
        name: "Vasseur Fencing",
        tagline: "Fencing Contractor",
        salespersonName: "Nathan LaVasseur",
        addressLines: ["1415 Snowmass Rd.", "Columbus, OH 43235"],
        email: "nathan@vasseurfencing.com",
        phone: "(231) 260-0635",
        logoUrl: ""
      },
      estimate: {
        id: overrideDraftId ?? draftId ?? "",
        submittedOn: new Date().toLocaleDateString("en-US"),
        customer: { name: customerName, phone: phoneNumber, email },
        projectAddress,
        styleTitle: selectedStyle?.name ?? "",
        totalLf: Number(totalLf) || 0,
        walkGateCount: Number(walkGateCountDerived) || 0,
        doubleGateCount: Number(doubleGateCount) || 0,
        depositTotal: Number(depositTotal) || 0,
        notes,
        disclaimer:
          "Estimate includes listed labor and materials only. Underground utilities, hidden obstructions, and unforeseen site conditions may require change orders.",
        contractText:
          "By signing below, the homeowner agrees to the scope of work and pricing described in this estimate."
      },
      sections: {
        materials: materialsRows,
        labor: laborRows,
        additional: additionalRows
      },
      totals: {
        materialsSubtotal: Number(materialsAndExpensesTotal) || 0,
        laborSubtotal: Number(totals.laborSubtotal) || 0,
        additionalSubtotal: Number(additionalServicesSubtotal) || 0,
        removalTotal: Number(removalTotal) || 0,
        discount: 0,
        tax: 0,
        total: Number(grandTotal) || 0
      }
    };
  }

  function segmentOptions() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const out: string[] = [];
    for (let i = 0; i < letters.length - 1; i++) {
      out.push(`${letters[i]}–${letters[i + 1]}`);
    }
    return out;
  }

  function addSegment() {
    const opts = segmentOptions();
    const nextLabel = opts[Math.min(segments.length, opts.length - 1)] ?? "A–B";
    setSegments((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, label: nextLabel, length: 0, removed: false, gate: false }
    ]);
  }

  function patchSegment(id: string, patch: Partial<{ label: string; length: number; removed: boolean; gate?: boolean }>) {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function deleteSegment(id: string) {
    setSegments((prev) => prev.filter((s) => s.id !== id));
  }

  const [items, setItems] = useState<QuoteItem[]>([]);

  function fileToCompressedDataUrl(file: File, maxSide = 1280, quality = 0.72): Promise<string | null> {
    if (typeof window === "undefined") return Promise.resolve(null);

    return new Promise((resolve) => {
      let objectUrl: string | null = null;
      try {
        objectUrl = window.URL.createObjectURL(file);
      } catch {
        objectUrl = null;
      }

      if (!objectUrl) {
        try {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        } catch {
          resolve(null);
        }
        return;
      }

      const img = new window.Image();
      img.onload = () => {
        try {
          const w = Number(img.naturalWidth || img.width || 0);
          const h = Number(img.naturalHeight || img.height || 0);
          if (!w || !h) {
            resolve(null);
            return;
          }

          const scale = Math.min(1, maxSide / Math.max(w, h));
          const outW = Math.max(1, Math.round(w * scale));
          const outH = Math.max(1, Math.round(h * scale));

          const canvas = document.createElement("canvas");
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }

          ctx.drawImage(img, 0, 0, outW, outH);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(typeof dataUrl === "string" ? dataUrl : null);
        } catch {
          resolve(null);
        } finally {
          try {
            if (objectUrl) window.URL.revokeObjectURL(objectUrl);
          } catch {
            // ignore
          }
        }
      };
      img.onerror = () => {
        try {
          if (objectUrl) window.URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore
        }
        try {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        } catch {
          resolve(null);
        }
      };
      img.src = objectUrl;
    });
  }

  function recompressDataUrl(dataUrl: string, maxSide = 1280, quality = 0.72): Promise<string | null> {
    if (typeof window === "undefined") return Promise.resolve(null);
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return Promise.resolve(null);

    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        try {
          const w = Number(img.naturalWidth || img.width || 0);
          const h = Number(img.naturalHeight || img.height || 0);
          if (!w || !h) {
            resolve(null);
            return;
          }

          const scale = Math.min(1, maxSide / Math.max(w, h));
          const outW = Math.max(1, Math.round(w * scale));
          const outH = Math.max(1, Math.round(h * scale));

          const canvas = document.createElement("canvas");
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, outW, outH);
          const next = canvas.toDataURL("image/jpeg", quality);
          resolve(typeof next === "string" ? next : null);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function isQuotaError(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e || "");
    return msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("exceeded") || msg.toLowerCase().includes("storage");
  }

  function sanitizePhotosForStorage(input: {
    projectPhotoDataUrl: string | null;
    preInstallPhotos: Array<{ src: string; note: string; createdAt: number }>;
  }) {
    const MAX_PROJECT_PHOTO_CHARS = 650_000;
    const MAX_PREINSTALL_PHOTO_CHARS = 420_000;
    const MAX_TOTAL_PREINSTALL_CHARS = 1_200_000;

    const project =
      typeof input.projectPhotoDataUrl === "string" && input.projectPhotoDataUrl.startsWith("data:")
        ? input.projectPhotoDataUrl
        : null;

    const projectOk = project && project.length <= MAX_PROJECT_PHOTO_CHARS ? project : null;

    const cleanedPre = Array.isArray(input.preInstallPhotos)
      ? input.preInstallPhotos.filter((p) => p && typeof (p as any).src === "string" && (p as any).src.startsWith("data:"))
      : [];

    const cappedEach = cleanedPre.filter((p) => String((p as any).src || "").length <= MAX_PREINSTALL_PHOTO_CHARS);
    const outPre: Array<{ src: string; note: string; createdAt: number }> = [];
    let total = 0;
    for (const p of cappedEach) {
      const src = String((p as any).src || "");
      if (total + src.length > MAX_TOTAL_PREINSTALL_CHARS) break;
      outPre.push({
        src,
        note: String((p as any).note || ""),
        createdAt: Number((p as any).createdAt) || Date.now()
      });
      total += src.length;
    }

    return {
      projectPhotoDataUrl: projectOk,
      preInstallPhotos: outPre,
      droppedProject: Boolean(project && !projectOk),
      droppedPreInstallCount: Math.max(0, cleanedPre.length - outPre.length)
    };
  }

  function normalizePreInstallPhotos(input: unknown) {
    if (!Array.isArray(input)) return [] as Array<{ src: string; note: string; createdAt: number }>;

    const out: Array<{ src: string; note: string; createdAt: number }> = [];
    for (const v of input) {
      if (typeof v === "string") {
        if (!v.startsWith("data:")) continue;
        out.push({ src: v, note: "", createdAt: Date.now() });
        continue;
      }
      if (v && typeof v === "object") {
        const src = typeof (v as any).src === "string" ? (v as any).src : "";
        if (!src.startsWith("data:")) continue;
        out.push({
          src,
          note: typeof (v as any).note === "string" ? (v as any).note : "",
          createdAt: Number((v as any).createdAt) || Date.now()
        });
      }
    }
    return out;
  }

  useEffect(() => {
    let cancelled = false;

    if (projectPhoto) {
      fileToCompressedDataUrl(projectPhoto, 1280, 0.72).then((result) => {
        if (cancelled) return;
        setProjectPhotoDataUrl(result);
        setProjectPhotoUrl(result);
      });
      return () => {
        cancelled = true;
      };
    }

    if (projectPhotoDataUrl) {
      setProjectPhotoUrl(projectPhotoDataUrl);
      return;
    }

    setProjectPhotoUrl(null);
    return () => {
      cancelled = true;
    };
  }, [projectPhoto, projectPhotoDataUrl]);

  useEffect(() => {
    const id = searchParams?.get("draft");
    if (!id) return;
    loadDraft(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const id = searchParams?.get("draft");
    if (id) return;
    try {
      const raw = window.localStorage.getItem(unsavedSnapshotKey);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (!snap || typeof snap !== "object") return;

      const hasAnyCurrent =
        String(customerName || "").trim() !== "" ||
        String(projectAddress || "").trim() !== "" ||
        String(phoneNumber || "").trim() !== "" ||
        String(email || "").trim() !== "" ||
        (Array.isArray(segments) && segments.length > 0) ||
        (Array.isArray(items) && items.length > 0);
      if (hasAnyCurrent) return;

      setCustomerName(String((snap as any).customerName ?? ""));
      setProjectAddress(String((snap as any).projectAddress ?? ""));
      setPhoneNumber(String((snap as any).phoneNumber ?? ""));
      setEmail(String((snap as any).email ?? ""));
      setSelectedFenceType((snap as any).selectedFenceType ?? "wood");
      setSelectedStyle((snap as any).selectedStyle ?? null);
      if ((snap as any).materialsDetails && typeof (snap as any).materialsDetails === "object") {
        setMaterialsDetails((prev) => ({ ...prev, ...(snap as any).materialsDetails }));
      }
      setExtraPosts(Number((snap as any).extraPosts ?? 0) || 0);
      if ((snap as any).materialUnitPrices && typeof (snap as any).materialUnitPrices === "object") {
        setMaterialUnitPrices((prev) => ({ ...prev, ...(snap as any).materialUnitPrices }));
      }
      setLaborDays(Number((snap as any).laborDays ?? 0));
      setLaborManualDays(String((snap as any).laborManualDays ?? ""));
      setLaborManualCost(String((snap as any).laborManualCost ?? ""));
      setGradingPrice(Number((snap as any).gradingPrice ?? 0));
      setTreeRemovalPrice(Number((snap as any).treeRemovalPrice ?? 0));
      setToughDigEnabled(Boolean((snap as any).toughDigEnabled));
      setGradeEnabled(Boolean((snap as any).gradeEnabled));
      setStumpGrindingPrice(Number((snap as any).stumpGrindingPrice ?? 0));
      setDoubleGateCount(Number((snap as any).doubleGateCount ?? 0));
      setReferenceLength(Number((snap as any).referenceLength ?? 0));
      setNotes(String((snap as any).notes ?? ""));
      setPreInstallPhotos(normalizePreInstallPhotos((snap as any).preInstallPhotos));
      setSegments(Array.isArray((snap as any).segments) ? (snap as any).segments : []);
      setItems(Array.isArray((snap as any).items) ? (snap as any).items : []);
      setProjectPhoto(null);
      setProjectPhotoDataUrl(typeof (snap as any).projectPhotoDataUrl === "string" ? (snap as any).projectPhotoDataUrl : null);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const totals = useMemo(() => computeTotals(items, 0, 0, 0), [items]);
  const materialsSubtotal = useMemo(() => {
    return items
      .filter((i) => i.section === "materials")
      .reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
  }, [items]);

  const additionalServicesSubtotal = useMemo(() => {
    const v = items
      .filter((i) => i.section === "additional")
      .reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
    return Math.round(v * 100) / 100;
  }, [items]);

  const materialsAndExpensesTotal = useMemo(() => {
    const feeNames = new Set(["Disposal", "Delivery", "Equipment Fees"]);
    const materialsFees = items
      .filter((i) => i.section === "materials" && feeNames.has(i.name))
      .reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);

    const materialsUsed = (Number(materialsSubtotal) || 0) - materialsFees;
    const taxed = materialsUsed * 1.08;
    const additionalServicesSurcharge = (Number(additionalServicesSubtotal) || 0) * 0.2;

    const v = taxed + materialsFees + additionalServicesSurcharge;
    return Math.round(v * 100) / 100;
  }, [additionalServicesSubtotal, items, materialsSubtotal]);

  const grandTotal = useMemo(() => {
    const laborTotal = (Number(totals.laborSubtotal) || 0) + (Number(removalTotal) || 0);
    const v = (Number(materialsAndExpensesTotal) || 0) + laborTotal;
    return Math.round(v * 100) / 100;
  }, [materialsAndExpensesTotal, removalTotal, totals.laborSubtotal]);

  const depositTotal = useMemo(() => {
    return Math.round((Number(materialsAndExpensesTotal) || 0) * 100) / 100;
  }, [materialsAndExpensesTotal]);

  const laborRatePerHalfDay = 650;
  const laborItem = useMemo<QuoteItem>(() => {
    const manualDaysNum = Number(laborManualDays);
    const manualCostNum = Number(laborManualCost);
    const manualDaysOk = laborManualDays.trim() !== "" && Number.isFinite(manualDaysNum);
    const manualCostOk = laborManualCost.trim() !== "" && Number.isFinite(manualCostNum);
    const useManual = manualDaysOk || manualCostOk;

    const autoQty = Number(laborDays) || 0;
    const autoUnitPrice = laborRatePerHalfDay * 2;
    const autoLineTotal = Math.round(autoQty * autoUnitPrice * 100) / 100;

    const qty = useManual ? (manualDaysOk ? manualDaysNum : autoQty) : autoQty;
    const lineTotal = useManual
      ? Math.round(((manualCostOk ? manualCostNum : autoLineTotal) || 0) * 100) / 100
      : autoLineTotal;
    const unitPrice = qty > 0 ? Math.round((lineTotal / qty) * 100) / 100 : lineTotal;
    return {
      section: "labor",
      name: "Days labor",
      qty,
      unit: "day",
      unitPrice,
      lineTotal
    };
  }, [laborDays, laborManualCost, laborManualDays]);

  const gradingItem = useMemo<QuoteItem>(() => {
    const unitPrice = Number(gradingPrice) || 0;
    const lineTotal = Math.round(unitPrice * 100) / 100;
    return {
      section: "labor",
      name: "Grading",
      qty: 1,
      unit: "ea",
      unitPrice: lineTotal,
      lineTotal
    };
  }, [gradingPrice]);

  const treeRemovalItem = useMemo<QuoteItem>(() => {
    const unitPrice = Number(treeRemovalPrice) || 0;
    const lineTotal = Math.round(unitPrice * 100) / 100;
    return {
      section: "labor",
      name: "Tree removal",
      qty: 1,
      unit: "ea",
      unitPrice: lineTotal,
      lineTotal
    };
  }, [treeRemovalPrice]);

  const surchargeRate = 0.05; // 5%

  const toughDigItem = useMemo<QuoteItem>(() => {
    const lineTotal = toughDigEnabled ? Math.round(laborItem.lineTotal * surchargeRate * 100) / 100 : 0;
    return {
      section: "labor",
      name: "Tough dig (5%)",
      qty: toughDigEnabled ? 1 : 0,
      unit: "ea",
      unitPrice: lineTotal,
      lineTotal
    };
  }, [laborItem.lineTotal, toughDigEnabled]);

  const gradeSurchargeItem = useMemo<QuoteItem>(() => {
    const lineTotal = gradeEnabled ? Math.round(laborItem.lineTotal * surchargeRate * 100) / 100 : 0;
    return {
      section: "labor",
      name: "Steep grade (5%)",
      qty: gradeEnabled ? 1 : 0,
      unit: "ea",
      unitPrice: lineTotal,
      lineTotal
    };
  }, [gradeEnabled, laborItem.lineTotal]);

  const laborDaysTotal = useMemo(() => {
    const v =
      (Number(laborItem.lineTotal) || 0) + (Number(toughDigItem.lineTotal) || 0) + (Number(gradeSurchargeItem.lineTotal) || 0);
    return Math.round(v * 100) / 100;
  }, [gradeSurchargeItem.lineTotal, laborItem.lineTotal, toughDigItem.lineTotal]);

  const stumpGrindingItem = useMemo<QuoteItem>(() => {
    const unitPrice = Number(stumpGrindingPrice) || 0;
    const lineTotal = Math.round(unitPrice * 100) / 100;
    return {
      section: "labor",
      name: "Stump grinding",
      qty: 1,
      unit: "ea",
      unitPrice: lineTotal,
      lineTotal
    };
  }, [stumpGrindingPrice]);

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

  function setMaterialStyle(style: { name: string; thumb: string }) {
    setSelectedStyle(style);
    setStylePickerIdx(false);
  }

  useEffect(() => {
    const open = Boolean(stylePickerIdx || materialsDetailsOpen || measureOpen);
    if (!open) return;

    const scrollY = window.scrollY || 0;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPosition = body.style.position;
    const prevTop = body.style.top;
    const prevLeft = body.style.left;
    const prevRight = body.style.right;
    const prevWidth = body.style.width;

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    return () => {
      body.style.overflow = prevOverflow;
      body.style.position = prevPosition;
      body.style.top = prevTop;
      body.style.left = prevLeft;
      body.style.right = prevRight;
      body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
    };
  }, [materialsDetailsOpen, measureOpen, stylePickerIdx]);

  useEffect(() => {
    // Keep generated materials + labor line in sync so totals work.
    setItems((prev) => {
      const manual = prev.filter((it) => it.section !== "materials" && it.section !== "labor");
      const laborExtras = [toughDigItem, gradeSurchargeItem].filter((it) => it.lineTotal !== 0);
      return [...generatedMaterials, laborItem, ...laborExtras, ...manual];
    });
  }, [generatedMaterials, laborItem, toughDigItem, gradeSurchargeItem]);

  function addItem(section: SectionKey) {
    setItems((prev) => [...prev, emptyItem(section)]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function reset() {
    clearUnsavedSnapshot();
    setCustomerName("");
    setProjectAddress("");
    setPhoneNumber("");
    setEmail("");
    setDraftId(null);
    setProjectPhoto(null);
    setMeasureOpen(false);
    setTracePoints([]);
    setOcrBusy(false);
    setOcrError(null);
    setOcrResults([]);
    setOcrEmpty(false);
    setOcrCenters({});
    setPickOcrForLabel(null);
    setReferenceLength(0);
    setSegments([]);
    setSelectedFenceType("wood");
    setSelectedStyle(null);
    setStylePickerIdx(false);
    setMaterialsDetailsOpen(false);
    setMaterialsDetails({
      woodType: "Pressure treated",
      postSize: 8,
      postType: "Pressure treated",
      postCaps: false,
      arbor: false
    });
    setExtraPosts(0);
    setNotes("");
    setPreInstallPhotos([]);
    setNotePhotoIdx(null);
    setLaborDays(0);
    setLaborManualDays("");
    setLaborManualCost("");
    setGradingPrice(0);
    setTreeRemovalPrice(0);
    setToughDigEnabled(false);
    setGradeEnabled(false);
    setStumpGrindingPrice(0);
    setDoubleGateCount(0);
    setItems([]);
  }

  async function scanLengthsFromPhoto() {
    if (!projectPhotoUrl) return;
    if (tracedSegments.length === 0) return;
    if (ocrBusy) return;

    setOcrBusy(true);
    setOcrError(null);
    setOcrEmpty(false);
    let worker: any = null;
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = projectPhotoUrl!;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed"));
      });

      const { createWorker } = await import("tesseract.js");
      worker = await createWorker();
      await worker.loadLanguage("eng");
      await worker.initialize("eng");
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789.",
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: "7"
      });

      const cropNorm = 0.22;

      const next: Array<{ label: string; value: number | null; raw: string }> = [];

      for (const s of tracedSegments) {
        const center = ocrCenters[s.label];
        const mx = center ? center.x : (s.a.x + s.b.x) / 2;
        const my = center ? center.y : (s.a.y + s.b.y) / 2;

        const x0 = Math.max(0, mx - cropNorm / 2);
        const y0 = Math.max(0, my - cropNorm / 2);
        const x1 = Math.min(1, mx + cropNorm / 2);
        const y1 = Math.min(1, my + cropNorm / 2);

        const sx = Math.round(x0 * img.naturalWidth);
        const sy = Math.round(y0 * img.naturalHeight);
        const sw = Math.max(1, Math.round((x1 - x0) * img.naturalWidth));
        const sh = Math.max(1, Math.round((y1 - y0) * img.naturalHeight));

        const upscale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = sw * upscale;
        canvas.height = sh * upscale;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          next.push({ label: s.label, value: null, raw: "" });
          continue;
        }

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw * upscale, sh * upscale);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] ?? 0;
          const g = d[i + 1] ?? 0;
          const b = d[i + 2] ?? 0;
          const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          const v = gray > 185 ? 255 : 0;
          d[i] = v;
          d[i + 1] = v;
          d[i + 2] = v;
          d[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");

        const res = await worker.recognize(dataUrl);
        const raw = (res.data.text ?? "").trim();
        const match = raw.replace(/\s+/g, "").match(/\d+(?:\.\d+)?/);
        const value = match ? Number(match[0]) : null;
        next.push({ label: s.label, value: Number.isFinite(value as any) ? (value as number) : null, raw });
      }

      setOcrResults(next);
      setOcrEmpty(next.every((r) => !r.raw && (r.value === null || r.value === 0)));
    } catch (e) {
      setOcrError(e instanceof Error ? e.message : "OCR failed");
    } finally {
      try {
        await worker?.terminate?.();
      } catch {
        // ignore
      }
      setOcrBusy(false);
    }
  }

  function applyTracedSegments() {
    const byLabel = new Map(ocrResults.map((r) => [r.label, r.value] as const));
    const nextSegs = tracedSegments.map((s) => {
      const v = byLabel.get(s.label);
      return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        label: s.label,
        length: Number.isFinite(v as any) ? (v as number) : 0,
        removed: false,
        gate: false
      };
    });
    setSegments(nextSegs);
    setMeasureOpen(false);
  }

  function save() {
    if (saving || savingAsNew) return;
    setSaving(true);
    setSaveError(null);
    const now = Date.now();
    const id = draftId ?? `${now}-${Math.random().toString(16).slice(2)}`;
    const title = customerName ? customerName : projectAddress ? projectAddress : "Draft estimate";

    const hasCustomerInfo =
      String(customerName || "").trim() !== "" ||
      String(projectAddress || "").trim() !== "" ||
      String(phoneNumber || "").trim() !== "" ||
      String(email || "").trim() !== "";

    const hasEstimateContent =
      (Number(laborDays) || 0) > 0 ||
      (Array.isArray(segments) && segments.some((s) => (Number((s as any)?.length) || 0) > 0)) ||
      (Array.isArray(items) && items.some((i) => (Number((i as any)?.lineTotal) || 0) > 0 || (Number((i as any)?.qty) || 0) > 0)) ||
      Boolean(selectedStyle) ||
      String(notes || "").trim() !== "";

    const store = readDraftStore();
    const prevStatus = store[id]?.status;
    const isNewDraft = !store[id];
    const status = isNewDraft ? (hasCustomerInfo && hasEstimateContent ? "pending" : prevStatus ?? "estimate") : prevStatus;
    const sanitized = sanitizePhotosForStorage({ projectPhotoDataUrl, preInstallPhotos });
    const baseDraft = {
      id,
      createdAt: store[id]?.createdAt ?? now,
      updatedAt: now,
      title,
      status,
      customerName,
      projectAddress,
      phoneNumber,
      email,
      projectPhotoDataUrl: sanitized.projectPhotoDataUrl,
      selectedFenceType,
      selectedStyle,
      materialsDetails,
      extraPosts,
      materialUnitPrices,
      laborDays,
      laborManualDays,
      laborManualCost,
      gradingPrice,
      treeRemovalPrice,
      toughDigEnabled,
      gradeEnabled,
      stumpGrindingPrice,
      doubleGateCount,
      referenceLength,
      notes,
      preInstallPhotos: sanitized.preInstallPhotos,
      segments,
      items,
      contract: buildContractPayload(id)
    };

    if (sanitized.droppedProject || sanitized.droppedPreInstallCount > 0) {
      setSaveError(
        sanitized.droppedProject
          ? "Photos were too large for device storage and were omitted before saving."
          : "Some photos were too large for device storage and were omitted before saving."
      );
    }

    const finishOk = () => {
      clearUnsavedSnapshot();
      setDraftId(id);
    };

    const finishFail = (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Save failed";
      setSaveError(isQuotaError(e)
        ? "Save failed: storage is full (photo too large)."
        : `Save failed: ${msg}`
      );
    };

    (async () => {
      try {
        store[id] = baseDraft;
        writeDraftStore(store);
        finishOk();
        return;
      } catch (e) {
        if (!isQuotaError(e)) {
          finishFail(e);
          return;
        }
      }

      try {
        const recompressed = projectPhotoDataUrl
          ? (await recompressDataUrl(projectPhotoDataUrl, 1024, 0.7))
          : null;
        if (recompressed) {
          setProjectPhotoDataUrl(recompressed);
          setProjectPhotoUrl(recompressed);
          store[id] = { ...baseDraft, projectPhotoDataUrl: recompressed };
          writeDraftStore(store);
          setSaveError("Saved, but project photo was compressed to fit storage.");
          finishOk();
          return;
        }
      } catch {
        // ignore
      }

      try {
        store[id] = { ...baseDraft, projectPhotoDataUrl: null, preInstallPhotos: [] };
        writeDraftStore(store);
        setSaveError("Saved, but photos were omitted to fit device storage.");
        finishOk();
      } catch (e) {
        finishFail(e);
      }
    })().finally(() => {
      setSaving(false);
    });
  }

  function saveAsNew() {
    if (saving || savingAsNew) return;
    setSavingAsNew(true);
    setSaveAsNewJustSaved(false);
    setSaveError(null);
    const now = Date.now();
    const id = `${now}-${Math.random().toString(16).slice(2)}`;
    const title = customerName ? customerName : projectAddress ? projectAddress : "Draft estimate";

    const hasCustomerInfo =
      String(customerName || "").trim() !== "" ||
      String(projectAddress || "").trim() !== "" ||
      String(phoneNumber || "").trim() !== "" ||
      String(email || "").trim() !== "";

    const hasEstimateContent =
      (Number(laborDays) || 0) > 0 ||
      (Array.isArray(segments) && segments.some((s) => (Number((s as any)?.length) || 0) > 0)) ||
      (Array.isArray(items) && items.some((i) => (Number((i as any)?.lineTotal) || 0) > 0 || (Number((i as any)?.qty) || 0) > 0)) ||
      Boolean(selectedStyle) ||
      String(notes || "").trim() !== "";

    const finishOk = () => {
      clearUnsavedSnapshot();
      setDraftId(id);
      setSaveAsNewJustSaved(true);
      setTimeout(() => {
        setSaveAsNewJustSaved(false);
      }, 1200);
    };

    const finishFail = (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Save failed";
      setSaveError(isQuotaError(e)
        ? "Save failed: storage is full (photo too large)."
        : `Save failed: ${msg}`
      );
    };

    const sanitized = sanitizePhotosForStorage({ projectPhotoDataUrl, preInstallPhotos });
    const baseDraft = {
      id,
      createdAt: now,
      updatedAt: now,
      title,
      status: hasCustomerInfo && hasEstimateContent ? "pending" : "estimate",
      customerName,
      projectAddress,
      phoneNumber,
      email,
      projectPhotoDataUrl: sanitized.projectPhotoDataUrl,
      selectedFenceType,
      selectedStyle,
      materialsDetails,
      extraPosts,
      materialUnitPrices,
      laborDays,
      laborManualDays,
      laborManualCost,
      gradingPrice,
      treeRemovalPrice,
      toughDigEnabled,
      gradeEnabled,
      stumpGrindingPrice,
      doubleGateCount,
      referenceLength,
      notes,
      preInstallPhotos: sanitized.preInstallPhotos,
      segments,
      items,
      contract: buildContractPayload(id)
    };

    if (sanitized.droppedProject || sanitized.droppedPreInstallCount > 0) {
      setSaveError(
        sanitized.droppedProject
          ? "Photos were too large for device storage and were omitted before saving."
          : "Some photos were too large for device storage and were omitted before saving."
      );
    }

    (async () => {
      try {
        const store = readDraftStore();
        store[id] = baseDraft;
        writeDraftStore(store);
        finishOk();
        return;
      } catch (e) {
        if (!isQuotaError(e)) {
          finishFail(e);
          return;
        }
      }

      try {
        const recompressed = projectPhotoDataUrl
          ? (await recompressDataUrl(projectPhotoDataUrl, 1024, 0.7))
          : null;
        if (recompressed) {
          setProjectPhotoDataUrl(recompressed);
          setProjectPhotoUrl(recompressed);
          const store = readDraftStore();
          store[id] = { ...baseDraft, projectPhotoDataUrl: recompressed };
          writeDraftStore(store);
          setSaveError("Saved, but project photo was compressed to fit storage.");
          finishOk();
          return;
        }
      } catch {
        // ignore
      }

      try {
        const store = readDraftStore();
        store[id] = { ...baseDraft, projectPhotoDataUrl: null, preInstallPhotos: [] };
        writeDraftStore(store);
        setSaveError("Saved, but photos were omitted to fit device storage.");
        finishOk();
      } catch (e) {
        finishFail(e);
      }
    })().finally(() => {
      setSavingAsNew(false);
    });
  }

  function loadDraft(id: string) {
    const store = readDraftStore();
    const d = store[id];
    if (!d) return;
    setDraftId(id);
    setCustomerName(String(d.customerName ?? ""));
    setProjectAddress(String(d.projectAddress ?? ""));
    setPhoneNumber(String(d.phoneNumber ?? ""));
    setEmail(String(d.email ?? ""));
    setProjectPhoto(null);
    setProjectPhotoDataUrl(typeof (d as any).projectPhotoDataUrl === "string" ? (d as any).projectPhotoDataUrl : null);
    setSelectedFenceType(d.selectedFenceType ?? "wood");
    setSelectedStyle(d.selectedStyle ?? null);
    setExtraPosts(Number((d as any).extraPosts) || 0);
    if (d.materialsDetails && typeof d.materialsDetails === "object") {
      const dd = d.materialsDetails as any;
      const woodType = (dd.woodType === "Cedar" || dd.woodType === "Cedar tone" || dd.woodType === "Pressure treated")
        ? dd.woodType
        : "Pressure treated";

      const postType = (dd.postType === "Cedar" || dd.postType === "Cedar tone" || dd.postType === "Pressure treated")
        ? dd.postType
        : "Pressure treated";

      const postCaps = typeof dd.postCaps === "boolean" ? dd.postCaps : Boolean(dd.topCap);
      const arbor = typeof dd.arbor === "boolean" ? dd.arbor : String(dd.arbor).toLowerCase() === "yes";

      setMaterialsDetails((prev) => ({
        ...prev,
        ...dd,
        woodType,
        postType,
        postCaps,
        arbor
      }));
    }
    if (d.materialUnitPrices && typeof d.materialUnitPrices === "object") {
      setMaterialUnitPrices((prev) => ({ ...prev, ...d.materialUnitPrices }));
    }
    setLaborDays(Number(d.laborDays ?? 0));
    setLaborManualDays(String((d as any).laborManualDays ?? ""));
    setLaborManualCost(String((d as any).laborManualCost ?? ""));
    setGradingPrice(Number(d.gradingPrice ?? 0));
    setTreeRemovalPrice(Number(d.treeRemovalPrice ?? 0));
    setToughDigEnabled(typeof d.toughDigEnabled === "boolean" ? d.toughDigEnabled : Number(d.toughDigFee ?? 0) > 0);
    setGradeEnabled(typeof d.gradeEnabled === "boolean" ? d.gradeEnabled : false);
    setStumpGrindingPrice(Number(d.stumpGrindingPrice ?? 0));
    setDoubleGateCount(Number(d.doubleGateCount ?? 0));
    setReferenceLength(Number(d.referenceLength ?? 0));
    setNotes(String(d.notes ?? ""));
    setPreInstallPhotos(normalizePreInstallPhotos((d as any).preInstallPhotos));
    setSegments(Array.isArray(d.segments) ? d.segments : []);
    setItems(Array.isArray(d.items) ? d.items : []);

    try {
      if (d.contract) {
        window.localStorage.setItem("vf_contract_preview_v1", JSON.stringify(d.contract));
      }
    } catch {
      // ignore
    }
  }

  function generateContract() {
    try {
      const STORAGE_KEY = "vf_contract_preview_v1";

      if (!searchParams?.get("draft")) {
        writeUnsavedSnapshot();
      }
      const payload = buildContractPayload();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      router.push("/estimates/contract");
    } catch {
      // ignore
    }
  }

  const phoneDigits = String(phoneNumber || "").replace(/[^0-9+]/g, "");
  const canCall = phoneDigits.length >= 7;
  const canMessage = phoneDigits.length >= 7;
  const canNavigate = String(projectAddress || "").trim().length > 0;

  return (
    <div className="space-y-4 pb-[calc(env(safe-area-inset-bottom)+160px)]">
      {portalReady
        ? createPortal(
          <div
            className="fixed right-4 z-40"
            style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
            aria-label="Total lineal feet"
          >
            <div className="rounded-full border border-[rgba(255,255,255,.14)] bg-[rgba(20,30,24,.72)] backdrop-blur-ios px-3 py-2 text-[12px] font-black shadow-glass">
              {totalLf.toFixed(0)} LF
            </div>
          </div>,
          document.body
        )
        : null}

      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-black tracking-tight">Estimate</div>
          <div className="text-sm text-[var(--muted)]">Build the quote, generate a printable contract.</div>
        </div>
      </div>

      <GlassCard className="p-0 overflow-hidden">
        <div className="p-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-[var(--muted)] mb-1">Customer</div>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" />
            </div>
            <div>
              <div className="text-[11px] text-[var(--muted)] mb-1">Address</div>
              <Input value={projectAddress} onChange={(e) => setProjectAddress(e.target.value)} placeholder="Project address" />
            </div>
            <div>
              <div className="text-[11px] text-[var(--muted)] mb-1">Phone</div>
              <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Phone number" />
            </div>
            <div>
              <div className="text-[11px] text-[var(--muted)] mb-1">Email</div>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-[rgba(255,255,255,.12)] bg-[rgba(20,30,24,.55)] backdrop-blur-ios">
          <div className="p-3">
            <div className="grid grid-cols-3 gap-2">
              <SecondaryButton
                data-no-swipe="true"
                disabled={!canCall}
                onClick={() => {
                  if (!canCall) return;
                  window.location.href = `tel:${phoneDigits}`;
                }}
              >
                Call
              </SecondaryButton>
              <SecondaryButton
                data-no-swipe="true"
                disabled={!canMessage}
                onClick={() => {
                  if (!canMessage) return;
                  window.location.href = `sms:${phoneDigits}`;
                }}
              >
                Message
              </SecondaryButton>
              <SecondaryButton
                data-no-swipe="true"
                disabled={!canNavigate}
                onClick={() => {
                  if (!canNavigate) return;
                  const q = encodeURIComponent(String(projectAddress || "").trim());
                  window.location.href = `https://www.google.com/maps/search/?api=1&query=${q}`;
                }}
              >
                Navigate
              </SecondaryButton>
            </div>
          </div>
        </div>
      </GlassCard>

      <SectionTitle title="Project photo & measurements" />
      <GlassCard className="p-4">
        <div className="grid md:grid-cols-12 gap-3">
          <div className="md:col-span-5">
            <div className="text-[11px] text-[var(--muted)] mb-1">Upload photo</div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setProjectPhoto(file);
              }}
              className="block w-full text-sm text-[rgba(255,255,255,.85)] file:mr-3 file:rounded-xl file:border file:border-[rgba(255,255,255,.16)] file:bg-[rgba(255,255,255,.10)] file:px-3 file:py-2 file:text-sm file:font-extrabold file:text-white"
            />

            <div className="mt-2 flex items-center gap-2">
              <SecondaryButton
                onClick={() => {
                  setProjectPhoto(null);
                  setProjectPhotoDataUrl(null);
                  setProjectPhotoUrl(null);
                }}
                disabled={!projectPhoto && !projectPhotoDataUrl}
              >
                Clear
              </SecondaryButton>
            </div>
            <div className="mt-2 text-[11px] text-[var(--muted)]">
              Tip: include a known-size reference in the photo (tape measure, 2x4, marker) for accurate scaling.
            </div>
          </div>

          <div className="md:col-span-7">
            <div className="text-[11px] text-[var(--muted)] mb-1">Preview</div>
            <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] overflow-hidden">
              {projectPhotoUrl ? (
                <img src={projectPhotoUrl ?? undefined} alt="Project photo" className="w-full h-[220px] object-cover" />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-sm text-[var(--muted)]">
                  No photo uploaded yet
                </div>
              )}
            </div>

            {projectPhotoUrl ? (
              <div className="mt-2">
                <SecondaryButton onClick={() => setMeasureOpen(true)} data-no-swipe="true" className="w-full">
                  Measure from photo
                </SecondaryButton>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4">
          <SecondaryButton onClick={addSegment} className="w-full">Add segment</SecondaryButton>
        </div>

        <div className="mt-4">
          <div className="text-[11px] text-[var(--muted)]">Segments</div>
        </div>

        <div className="mt-2 grid gap-2">
          {segments.map((seg) => (
            <div
              key={seg.id}
              className={"rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] px-2 py-2"}
            >
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <div className="text-[11px] text-[var(--muted)] mb-1">Segment</div>
                  <Select value={seg.label} onChange={(e) => patchSegment(seg.id, { label: e.target.value })}>
                    {segmentOptions().map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="col-span-3">
                  <div className="text-[11px] text-[var(--muted)] mb-1">Length (ft)</div>
                  <Input
                    inputMode="decimal"
                    maxLength={3}
                    value={Number(seg.length) === 0 ? "" : String(seg.length)}
                    onChange={(e) => {
                      const raw = String(e.target.value ?? "");
                      const cleaned = raw.replace(/^0+(?=\d)/, "");
                      patchSegment(seg.id, { length: cleaned === "" ? 0 : Number(cleaned) });
                    }}
                    onBlur={(e) => {
                      const raw = String((e.target as HTMLInputElement).value ?? "").trim();
                      if (raw === "") patchSegment(seg.id, { length: 0 });
                    }}
                    className="text-center"
                  />
                </div>

                <div className="col-span-3 flex gap-2">
                  <SecondaryButton
                    type="button"
                    data-no-swipe="true"
                    onClick={() => patchSegment(seg.id, { gate: !(seg as any).gate })}
                    aria-pressed={Boolean((seg as any).gate)}
                    aria-label="Gate"
                    title="Gate"
                    style={
                      (seg as any).gate
                        ? {
                            backgroundColor: "rgba(31,200,120,.22)",
                            borderColor: "rgba(31,200,120,.40)",
                            color: "rgba(235,255,245,.98)"
                          }
                        : undefined
                    }
                    className={
                      "w-full min-w-0 px-2 py-2 text-[14px] leading-none transition-none active:bg-[rgba(31,200,120,.22)] active:border-[rgba(31,200,120,.40)]"
                    }
                  >
                    🚪
                  </SecondaryButton>
                  <SecondaryButton
                    type="button"
                    data-no-swipe="true"
                    onClick={() => patchSegment(seg.id, { removed: !seg.removed })}
                    aria-pressed={seg.removed}
                    aria-label="Removal"
                    title="Removal"
                    style={
                      seg.removed
                        ? {
                            backgroundColor: "rgba(255,214,10,.30)",
                            borderColor: "rgba(255,214,10,.55)",
                            color: "rgba(255,244,200,.98)"
                          }
                        : undefined
                    }
                    className={
                      "w-full min-w-0 px-2 py-2 text-[14px] leading-none transition-none active:bg-[rgba(255,214,10,.34)] active:border-[rgba(255,214,10,.65)]"
                    }
                  >
                    🗑
                  </SecondaryButton>
                </div>

                <div className="col-span-2">
                  <SecondaryButton onClick={() => deleteSegment(seg.id)} className="w-full px-2 py-2 text-[12px]">
                    ✕
                  </SecondaryButton>
                </div>
              </div>
            </div>
          ))}

      {measureOpen ? (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4" data-no-swipe="true">
          <div className="absolute inset-0 bg-[rgba(0,0,0,.55)]" onClick={() => setMeasureOpen(false)} />
          <div className="relative w-full max-w-[980px]">
            <GlassCard className="p-4 max-h-[90dvh] overflow-y-auto">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-extrabold">Measure from photo</div>
                  <div className="text-[11px] text-[var(--muted)]">Tap points around the fence line to create segments.</div>
                  <div className="text-[11px] text-[var(--muted)] mt-1">Points: {tracePoints.length}  Segments: {tracedSegments.length}</div>
                </div>
                <SecondaryButton onClick={() => setMeasureOpen(false)}>Close</SecondaryButton>
              </div>

              <div className="mt-3 rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] overflow-hidden">
                {projectPhotoUrl ? (
                  <div
                    className="relative touch-none select-none"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      const clientX = (e as any).clientX ?? (e as any).nativeEvent?.clientX;
                      const clientY = (e as any).clientY ?? (e as any).nativeEvent?.clientY;
                      const x = (clientX - rect.left) / rect.width;
                      const y = (clientY - rect.top) / rect.height;
                      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                      if (x < 0 || x > 1 || y < 0 || y > 1) return;
                      if (pickOcrForLabel) {
                        setOcrCenters((prev) => ({ ...prev, [pickOcrForLabel]: { x, y } }));
                        setPickOcrForLabel(null);
                        return;
                      }
                      setTracePoints((p) => [...p, { x, y }]);
                    }}
                  >
                    <img src={projectPhotoUrl ?? undefined} alt="Sketch" className="w-full h-auto block" />
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="none">
                      {tracePoints.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r={0.012} fill="rgba(255,255,255,.85)" />
                      ))}
                      {tracedSegments.map((s) => (
                        <line
                          key={s.label}
                          x1={s.a.x}
                          y1={s.a.y}
                          x2={s.b.x}
                          y2={s.b.y}
                          stroke="rgba(255,255,255,.75)"
                          strokeWidth={0.008}
                        />
                      ))}
                      {Object.entries(ocrCenters).map(([label, p]) => (
                        <g key={label}>
                          <circle cx={p.x} cy={p.y} r={0.016} fill="rgba(245,158,11,.55)" />
                          <circle cx={p.x} cy={p.y} r={0.007} fill="rgba(245,158,11,.95)" />
                        </g>
                      ))}
                    </svg>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <SecondaryButton
                  onClick={() => setTracePoints((p) => p.slice(0, -1))}
                  disabled={tracePoints.length === 0}
                >
                  Undo
                </SecondaryButton>
                <SecondaryButton onClick={() => setTracePoints([])} disabled={tracePoints.length === 0}>
                  Clear
                </SecondaryButton>
                <SecondaryButton onClick={scanLengthsFromPhoto} disabled={!projectPhotoUrl || tracedSegments.length === 0 || ocrBusy}>
                  {ocrBusy ? "Scanning…" : "Scan lengths"}
                </SecondaryButton>
                <PrimaryButton onClick={applyTracedSegments} disabled={tracedSegments.length === 0}>
                  Apply segments
                </PrimaryButton>
              </div>

              {pickOcrForLabel ? (
                <div className="mt-2 text-sm text-[rgba(255,240,200,.92)]">
                  Tap on the photo near the handwritten number for <span className="font-extrabold">{pickOcrForLabel}</span>.
                </div>
              ) : null}

              {ocrError ? <div className="mt-2 text-sm text-[rgba(255,220,220,.92)]">{ocrError}</div> : null}
              {ocrEmpty ? <div className="mt-2 text-sm text-[var(--muted)]">OCR ran but didn’t find any numbers in the crops.</div> : null}

              {tracedSegments.length ? (
                <div className="mt-3 grid gap-2">
                  {tracedSegments.map((s, idx) => {
                    const current = ocrResults.find((r) => r.label === s.label);
                    const value = current?.value;
                    const hasCenter = Boolean(ocrCenters[s.label]);
                    return (
                      <div key={s.label} className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-extrabold">{s.label}</div>
                          <div className="text-[11px] text-[var(--muted)]">Segment {idx + 1}</div>
                        </div>
                        <div className="mt-2 grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-6">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Length (ft)</div>
                            <Input
                              inputMode="decimal"
                              value={value === null ? "" : String(value)}
                              onChange={(e) => {
                                const v = e.target.value === "" ? null : Number(e.target.value);
                                setOcrResults((prev) =>
                                  prev.map((r) => (r.label === s.label ? { ...r, value: Number.isFinite(v as any) ? (v as number) : null } : r))
                                );
                              }}
                              placeholder="(OCR)"
                            />
                          </div>
                          <div className="col-span-6">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Raw</div>
                            <div className="rounded-xl px-3 py-2 text-[12px] bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)] text-[rgba(255,255,255,.85)]">
                              {current?.raw || ""}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <SecondaryButton
                            onClick={() => setPickOcrForLabel(s.label)}
                            disabled={!projectPhotoUrl || ocrBusy}
                          >
                            {hasCenter ? "Re-pick number spot" : "Pick number spot"}
                          </SecondaryButton>
                          {hasCenter ? (
                            <SecondaryButton
                              onClick={() =>
                                setOcrCenters((prev) => {
                                  const next = { ...prev };
                                  delete next[s.label];
                                  return next;
                                })
                              }
                              disabled={ocrBusy}
                            >
                              Clear spot
                            </SecondaryButton>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 text-sm text-[var(--muted)]">Tap at least 2 points to create segments.</div>
              )}
            </GlassCard>
          </div>
        </div>
      ) : null}
        </div>
      </GlassCard>

      {sectionOptions.map((s) => {
        const rows = items.filter((i) => i.section === s.key);
        const showCard = s.key !== "additional" || rows.length > 0;
        return (
          <div key={s.key}>
            {s.key === "additional" && rows.length === 0 ? (
              <div className="flex items-center justify-between mb-2 mt-4">
                <h2 className="text-sm font-extrabold tracking-tight">{s.label}</h2>
                <PrimaryButton onClick={() => addItem(s.key)}>Add</PrimaryButton>
              </div>
            ) : (
              <SectionTitle
                title={s.label}
                right={
                  s.key === "materials" || s.key === "labor"
                    ? null
                    : s.key === "additional"
                      ? <PrimaryButton onClick={() => addItem(s.key)}>Add</PrimaryButton>
                      : <SecondaryButton onClick={() => addItem(s.key)}>Add</SecondaryButton>
                }
              />
            )}
            {showCard ? (
              <GlassCard className="p-3">
                <div className="grid gap-2">
                  {s.key === "materials" ? (
                    <>
                      <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                        <div className="text-[11px] text-[var(--muted)] mb-1">Fence type</div>
                        <Select value={selectedFenceType} onChange={(e) => {
                          const next = e.target.value as "wood" | "vinyl" | "aluminum" | "chainlink";
                          setSelectedFenceType(next);
                          setSelectedStyle(null);
                        }}>
                          <option value="wood">Wood</option>
                          <option value="vinyl">Vinyl</option>
                          <option value="aluminum">Aluminum</option>
                          <option value="chainlink">Chainlink</option>
                        </Select>
                      </div>

                      <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                        <div className="text-[11px] text-[var(--muted)] mb-1">Style</div>
                        <button
                          type="button"
                          data-no-swipe="true"
                          onClick={() => setStylePickerIdx(true)}
                          className="w-full text-left rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.08)] border border-[rgba(255,255,255,.14)] outline-none focus:ring-2 focus:ring-[rgba(138,90,43,.55)]"
                        >
                          <div className="flex items-center gap-2">
                            {selectedStyle?.thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={selectedStyle.thumb} alt="" className="h-8 w-8 rounded-lg object-cover border border-[rgba(255,255,255,.14)]" />
                            ) : (
                              <div className="h-8 w-8 rounded-lg bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.14)]" />
                            )}
                            <div className="flex-1">
                              <div className={selectedStyle ? "" : "text-[var(--muted)]"}>{selectedStyle?.name || "Style"}</div>
                            </div>
                            <div className="text-[11px] text-[var(--muted)]">LF {totalLf.toFixed(0)}</div>
                          </div>
                        </button>

                        <div className="mt-2">
                          <SecondaryButton
                            onClick={() => setMaterialsDetailsOpen(true)}
                            data-no-swipe="true"
                            className={
                              ((materialsDetailsOpen || materialsDetailsActive || materialUnitPricesActive)
                                ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)] "
                                : "") +
                              "transition-colors duration-0 active:bg-[rgba(255,214,10,.34)] active:border-[rgba(255,214,10,.65)]"
                            }
                          >
                            Details
                          </SecondaryButton>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                        <div className="text-[11px] text-[var(--muted)] mb-2">Gates</div>

                        <div className="grid gap-2">
                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-extrabold">Double gate</div>
                              <div className="flex items-center gap-2">
                                <PrimaryButton
                                  data-no-swipe="true"
                                  className="px-3 py-2 text-[12px]"
                                  onClick={() => setDoubleGateCount((v) => Math.max(0, (Number(v) || 0) - 1))}
                                >
                                  -
                                </PrimaryButton>
                                <div className="min-w-8 text-center font-black">{doubleGateCount}</div>
                                <PrimaryButton
                                  data-no-swipe="true"
                                  className="px-3 py-2 text-[12px]"
                                  onClick={() => setDoubleGateCount((v) => (Number(v) || 0) + 1)}
                                >
                                  +
                                </PrimaryButton>
                              </div>
                            </div>
                            <div className="mt-1 text-[11px] text-[var(--muted)]">Adds 10 Cedar S4S Gate Framing and 1 Double gate kit</div>
                          </div>
                        </div>
                      </div>

                      {selectedStyle ? (
                        <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                          <div className="text-[11px] font-extrabold text-[var(--muted)] mb-2">Takeoff</div>
                          {totalLf <= 0 ? (
                            <div className="text-sm text-[var(--muted)]">
                              Add segment lengths to generate the material list.
                            </div>
                          ) : (
                            <div className="grid gap-2">
                              {generatedMaterials.map((m) => (
                                <div key={m.name} className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-2 py-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-extrabold">{m.name}</div>
                                    <div className="text-sm font-black">{money(m.lineTotal)}</div>
                                  </div>
                                  <div className="mt-1 grid grid-cols-12 gap-2 items-end">
                                    <div className="col-span-4">
                                      <div className="text-[11px] text-[var(--muted)] mb-1">Qty</div>
                                      <div className="rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)]">
                                        {m.qty} {m.unit}
                                      </div>
                                    </div>
                                    <div className="col-span-4">
                                      <div className="text-[11px] text-[var(--muted)] mb-1">Unit Price</div>
                                      <Input
                                        inputMode="decimal"
                                        value={
                                          materialUnitPriceDrafts[m.name] ??
                                          String(materialUnitPrices[m.name] ?? m.unitPrice ?? 0)
                                        }
                                        onChange={(e) =>
                                          setMaterialUnitPriceDrafts((prev) => ({
                                            ...prev,
                                            [m.name]: e.target.value
                                          }))
                                        }
                                        onBlur={() => {
                                          const raw = materialUnitPriceDrafts[m.name];
                                          if (raw === undefined) return;
                                          const n = Number(raw);
                                          touchedMaterialUnitPricesRef.current.add(m.name);
                                          setMaterialUnitPrices((prev) => ({
                                            ...prev,
                                            [m.name]: Number.isFinite(n) ? n : 0
                                          }));
                                          setMaterialUnitPriceDrafts((prev) => {
                                            const next = { ...prev };
                                            delete next[m.name];
                                            return next;
                                          });
                                        }}
                                      />
                                    </div>
                                    <div className="col-span-4">
                                      <div className="text-[11px] text-[var(--muted)] mb-1">Total</div>
                                      <div className="rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)] text-right font-black">
                                        {money(m.lineTotal)}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-[var(--muted)] px-1">Select a style to generate materials.</div>
                      )}

                    </>
                  ) : s.key === "labor" ? (
                    <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                      <div className="flex justify-end mb-2">
                        <div className="text-[11px] text-[var(--muted)]">LF {totalLf.toFixed(0)}</div>
                      </div>
                      <div className="grid gap-2">
                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-3">
                          <div className="grid md:grid-cols-12 gap-2">
                            <div className="md:col-span-5">
                              <div className="text-[11px] text-[var(--muted)] mb-1">Item</div>
                              <div className="rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)] font-extrabold">
                                Days labor
                              </div>
                            </div>
                            <div className="md:col-span-4">
                              <div className="text-[11px] text-[var(--muted)] mb-1">Days</div>
                              <Select value={String(laborDays)} onChange={(e) => setLaborDays(Number(e.target.value))}>
                                {Array.from({ length: 41 }).map((_, i) => {
                                  const v = i * 0.25;
                                  return (
                                    <option key={v} value={String(v)}>
                                      {v.toFixed(2)}
                                    </option>
                                  );
                                })}
                              </Select>
                              <div className="mt-2 grid grid-cols-12 gap-2 items-end">
                                <div className="col-span-5">
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Manual days</div>
                                  <Input
                                    inputMode="decimal"
                                    value={laborManualDays}
                                    onChange={(e) => setLaborManualDays(e.target.value)}
                                    placeholder=""
                                  />
                                </div>
                                <div className="col-span-5">
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Manual cost</div>
                                  <Input
                                    inputMode="decimal"
                                    value={laborManualCost}
                                    onChange={(e) => setLaborManualCost(e.target.value)}
                                    placeholder=""
                                  />
                                </div>
                                <div className="col-span-2">
                                  <div className="text-[11px] text-[var(--muted)] mb-1"> </div>
                                  <SecondaryButton
                                    data-no-swipe="true"
                                    className="w-full px-2 py-2 text-[12px]"
                                    aria-label="Clear manual override"
                                    title="Clear manual override"
                                    onClick={() => {
                                      setLaborManualDays("");
                                      setLaborManualCost("");
                                    }}
                                  >
                                    ✕
                                  </SecondaryButton>
                                </div>
                              </div>
                            </div>
                            <div className="md:col-span-3">
                              <div className="text-[11px] text-[var(--muted)] mb-1">Total</div>
                              <div className="rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)] text-right font-black">
                                {money(laborDaysTotal)}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-3">
                          <SecondaryButton
                            onClick={() => setToughDigEnabled((v) => !v)}
                            data-no-swipe="true"
                            className={
                              (toughDigEnabled
                                ? "!bg-[rgba(255,214,10,.34)] !border-[rgba(255,214,10,.65)] hover:!bg-[rgba(255,214,10,.34)] "
                                : "") +
                              "w-full px-3 py-2 text-[12px] transition-none active:!bg-[rgba(255,214,10,.34)] active:!border-[rgba(255,214,10,.65)]"
                            }
                          >
                            Tough dig (adds 5%)
                          </SecondaryButton>
                          <div className="mt-1 text-[11px] text-[var(--muted)]">{money(toughDigItem.lineTotal)}</div>
                        </div>

                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-3">
                          <SecondaryButton
                            onClick={() => setGradeEnabled((v) => !v)}
                            data-no-swipe="true"
                            className={
                              (gradeEnabled
                                ? "!bg-[rgba(255,214,10,.34)] !border-[rgba(255,214,10,.65)] hover:!bg-[rgba(255,214,10,.34)] "
                                : "") +
                              "w-full px-3 py-2 text-[12px] transition-none active:!bg-[rgba(255,214,10,.34)] active:!border-[rgba(255,214,10,.65)]"
                            }
                          >
                            Steep grade (adds 5%)
                          </SecondaryButton>
                          <div className="mt-1 text-[11px] text-[var(--muted)]">{money(gradeSurchargeItem.lineTotal)}</div>
                        </div>

                      </div>
                    </div>
                  ) : (
                    rows.map((row) => {
                      const idx = items.findIndex((it) => it === row);
                      const isAdditional = s.key === "additional";
                      return (
                        <div key={idx} className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                          <div className="grid md:grid-cols-12 gap-2">
                            <div className="md:col-span-5">
                              {isAdditional ? null : <div className="text-[11px] text-[var(--muted)] mb-1">Item</div>}
                              <Input
                                value={row.name}
                                onChange={(e) => recalc(idx, { name: e.target.value })}
                                placeholder={isAdditional ? "Service" : "Line item name"}
                              />
                            </div>
                            <div className="md:col-span-2">
                              {isAdditional ? null : <div className="text-[11px] text-[var(--muted)] mb-1">Qty</div>}
                              <Input
                                inputMode="decimal"
                                value={
                                  itemNumberDrafts[`${idx}:qty`] ??
                                  (isAdditional && (Number(row.qty) || 0) === 0 ? "" : String(row.qty))
                                }
                                onChange={(e) =>
                                  setItemNumberDrafts((prev) => ({
                                    ...prev,
                                    [`${idx}:qty`]: e.target.value
                                  }))
                                }
                                onBlur={() => {
                                  const raw = itemNumberDrafts[`${idx}:qty`];
                                  if (raw === undefined) return;
                                  recalc(idx, { qty: raw === "" ? 0 : Number(raw) });
                                  setItemNumberDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[`${idx}:qty`];
                                    return next;
                                  });
                                }}
                                placeholder={isAdditional ? "Quantity" : ""}
                              />
                            </div>
                            <div className="md:col-span-2">
                              {isAdditional ? null : <div className="text-[11px] text-[var(--muted)] mb-1">Unit</div>}
                              <Select value={row.unit} onChange={(e) => recalc(idx, { unit: e.target.value })}>
                                <option value="ea">ea</option>
                                <option value="ft">ft</option>
                                <option value="lf">lf</option>
                                <option value="yd">yd</option>
                              </Select>
                            </div>
                            <div className="md:col-span-2">
                              {isAdditional ? null : <div className="text-[11px] text-[var(--muted)] mb-1">Unit Price</div>}
                              <Input
                                inputMode="decimal"
                                value={
                                  itemNumberDrafts[`${idx}:unitPrice`] ??
                                  (isAdditional && (Number(row.unitPrice) || 0) === 0 ? "" : String(row.unitPrice))
                                }
                                onChange={(e) =>
                                  setItemNumberDrafts((prev) => ({
                                    ...prev,
                                    [`${idx}:unitPrice`]: e.target.value
                                  }))
                                }
                                onBlur={() => {
                                  const raw = itemNumberDrafts[`${idx}:unitPrice`];
                                  if (raw === undefined) return;
                                  recalc(idx, { unitPrice: raw === "" ? 0 : Number(raw) });
                                  setItemNumberDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[`${idx}:unitPrice`];
                                    return next;
                                  });
                                }}
                                placeholder={isAdditional ? "Unit price" : ""}
                              />
                            </div>
                            <div className="md:col-span-1">
                              {isAdditional ? (
                                <div className="text-[11px] text-[var(--muted)] mb-1"> </div>
                              ) : (
                                <div className="text-[11px] text-[var(--muted)] mb-1"> </div>
                              )}
                              <SecondaryButton onClick={() => removeItem(idx)} className="w-full">✕</SecondaryButton>
                            </div>
                          </div>
                          <div className="mt-2 text-right text-sm font-black">{money(row.lineTotal)}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </GlassCard>
            ) : null}
          </div>
        );
      })}

      <SectionTitle title="Notes" />
      <GlassCard className="p-4">
        <div className="text-[11px] text-[var(--muted)] mb-1">Notes</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder=""
          className={
            "w-full min-h-[120px] rounded-xl px-3 py-2 text-[16px] md:text-sm " +
            "bg-[rgba(255,255,255,.08)] border border-[rgba(255,255,255,.14)] " +
            "outline-none focus:ring-2 focus:ring-[rgba(138,90,43,.55)]"
          }
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-[11px] text-[var(--muted)]">Pre-install photos</div>
          <SecondaryButton
            data-no-swipe="true"
            onClick={() => {
              preInstallPhotoInputRef.current?.click();
            }}
          >
            Add photo
          </SecondaryButton>
        </div>

        <input
          ref={preInstallPhotoInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length === 0) return;
            const startIdx = preInstallPhotos.length;

            Promise.all(
              files.map(
                (file) => fileToCompressedDataUrl(file, 1280, 0.72)
              )
            ).then((results) => {
              const urls = results.filter((r): r is string => typeof r === "string" && r.startsWith("data:"));
              if (urls.length === 0) return;
              const added = urls.map((src) => ({ src, note: "", createdAt: Date.now() }));
              setPreInstallPhotos((prev) => [...prev, ...added]);
              setNotePhotoIdx((cur) => (cur == null ? startIdx : cur));
            });

            e.target.value = "";
          }}
        />

        {preInstallPhotos.length ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {preInstallPhotos.map((p, idx) => (
              <div key={`${idx}`} className="relative rounded-xl overflow-hidden border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)]">
                <div className="relative w-full aspect-square">
                  <NextImage src={p.src} alt="" fill sizes="120px" className="object-cover" />
                </div>
                <button
                  type="button"
                  data-no-swipe="true"
                  onClick={() => {
                    setPreInstallPhotos((prev) => prev.filter((_, i) => i !== idx));
                    setNotePhotoIdx((cur) => (cur === idx ? null : cur != null && cur > idx ? cur - 1 : cur));
                  }}
                  className="absolute top-1 right-1 rounded-full border border-[rgba(255,255,255,.18)] bg-[rgba(20,30,24,.72)] backdrop-blur-ios px-2 py-1 text-[11px] font-extrabold"
                >
                  ✕
                </button>

                {p.note ? (
                  <div className="absolute left-1 bottom-1 right-1 rounded-lg border border-[rgba(255,255,255,.14)] bg-[rgba(20,30,24,.72)] backdrop-blur-ios px-2 py-1 text-[10px] font-extrabold truncate">
                    {p.note}
                  </div>
                ) : (
                  <button
                    type="button"
                    data-no-swipe="true"
                    onClick={() => setNotePhotoIdx(idx)}
                    className="absolute left-1 bottom-1 rounded-lg border border-[rgba(255,255,255,.14)] bg-[rgba(20,30,24,.72)] backdrop-blur-ios px-2 py-1 text-[10px] font-extrabold"
                  >
                    Add note
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </GlassCard>

      {portalReady && notePhotoIdx != null && preInstallPhotos[notePhotoIdx] ? createPortal(
        <div className="fixed inset-0 z-[70] grid place-items-center p-4" data-no-swipe="true">
          <div
            className="absolute inset-0 bg-[rgba(0,0,0,.45)]"
            onClick={() => setNotePhotoIdx(null)}
          />
          <div className="relative w-full max-w-[520px]" onClick={(e) => e.stopPropagation()}>
            <GlassCard className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black">Photo note</div>
                <SecondaryButton onClick={() => setNotePhotoIdx(null)}>Close</SecondaryButton>
              </div>

              <div className="mt-3 relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]">
                <NextImage src={preInstallPhotos[notePhotoIdx].src} alt="" fill sizes="520px" className="object-cover" />
              </div>

              <div className="mt-3">
                <div className="text-[11px] text-[var(--muted)] mb-1">Comment</div>
                <Input
                  value={preInstallPhotos[notePhotoIdx].note}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPreInstallPhotos((prev) => prev.map((p, i) => (i === notePhotoIdx ? { ...p, note: v } : p)));
                  }}
                  placeholder=""
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <SecondaryButton
                  data-no-swipe="true"
                  onClick={() => {
                    const next = notePhotoIdx + 1;
                    if (next < preInstallPhotos.length) setNotePhotoIdx(next);
                    else setNotePhotoIdx(null);
                  }}
                >
                  Next
                </SecondaryButton>
                <PrimaryButton
                  data-no-swipe="true"
                  onClick={() => setNotePhotoIdx(null)}
                >
                  Done
                </PrimaryButton>
              </div>
            </GlassCard>
          </div>
        </div>,
        document.body
      ) : null}

      {portalReady && stylePickerIdx
        ? createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" data-no-swipe="true">
            <div
              className="absolute inset-0 bg-[rgba(0,0,0,.45)]"
              onClick={() => setStylePickerIdx(false)}
            />
            <div className="relative w-full max-w-[520px]">
              <GlassCard className="p-4 max-h-[80dvh] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold">Choose style</div>
                  <SecondaryButton onClick={() => setStylePickerIdx(false)}>Close</SecondaryButton>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {materialStyles.filter((st) => st.type === selectedFenceType).map((st) => (
                    <button
                      key={st.name}
                      type="button"
                      onClick={() => setMaterialStyle(st)}
                      className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-2 text-left"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={st.thumb} alt="" className="w-full aspect-[4/3] rounded-xl object-cover" />
                      <div className="mt-2 text-sm font-extrabold">{st.name}</div>
                    </button>
                  ))}
                </div>
              </GlassCard>
            </div>
          </div>,
          document.body
        )
        : null}

      {portalReady && materialsDetailsOpen
        ? createPortal(
          <div className="fixed inset-0 z-[60] grid place-items-center p-4" data-no-swipe="true">
            <div
              className="absolute inset-0 bg-[rgba(0,0,0,.45)]"
              onClick={() => setMaterialsDetailsOpen(false)}
            />
            <div className="relative w-full max-w-[980px]">
              <GlassCard className="p-4 max-h-[80dvh] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold">Materials details</div>
                  <SecondaryButton onClick={() => setMaterialsDetailsOpen(false)}>Close</SecondaryButton>
                </div>

                <div className="mt-3 grid gap-3">
                  <div>
                    <div className="text-[11px] text-[var(--muted)] mb-1">Wood type</div>
                    <Select
                      value={materialsDetails.woodType}
                      onChange={(e) =>
                        setMaterialsDetails((p) => ({
                          ...p,
                          woodType: e.target.value as "Pressure treated" | "Cedar" | "Cedar tone"
                        }))
                      }
                    >
                      <option value="Pressure treated">Pressure treated</option>
                      <option value="Cedar">Cedar</option>
                      <option value="Cedar tone">Cedar tone</option>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] text-[var(--muted)] mb-1">Post size</div>
                      <Select
                        value={String(materialsDetails.postSize)}
                        onChange={(e) =>
                          setMaterialsDetails((p) => ({ ...p, postSize: Number(e.target.value) as 8 | 10 | 12 | 14 }))
                        }
                      >
                        <option value="8">8</option>
                        <option value="10">10</option>
                        <option value="12">12</option>
                        <option value="14">14</option>
                      </Select>
                    </div>
                    <div>
                      <div className="text-[11px] text-[var(--muted)] mb-1">Posts</div>
                      <Select
                        value={materialsDetails.postType}
                        onChange={(e) =>
                          setMaterialsDetails((p) => ({
                            ...p,
                            postType: e.target.value as "Pressure treated" | "Cedar" | "Cedar tone"
                          }))
                        }
                      >
                        <option value="Pressure treated">Pressure treated</option>
                        <option value="Cedar">Cedar</option>
                        <option value="Cedar tone">Cedar tone</option>
                      </Select>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                    <div className="text-[11px] text-[var(--muted)] mb-2">Add posts</div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-extrabold">Extra posts</div>
                      <div className="flex items-center gap-2">
                        <PrimaryButton
                          data-no-swipe="true"
                          className="px-3 py-2 text-[12px]"
                          onClick={() => setExtraPosts((v) => Math.max(0, (Number(v) || 0) - 1))}
                        >
                          -
                        </PrimaryButton>
                        <div className="min-w-8 text-center font-black">{extraPosts}</div>
                        <PrimaryButton
                          data-no-swipe="true"
                          className="px-3 py-2 text-[12px]"
                          onClick={() => setExtraPosts((v) => (Number(v) || 0) + 1)}
                        >
                          +
                        </PrimaryButton>
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--muted)]">Adds posts to the generated takeoff.</div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] text-[var(--muted)] mb-1">Post caps</div>
                      <button
                        type="button"
                        data-no-swipe="true"
                        onClick={() => setMaterialsDetails((p) => ({ ...p, postCaps: !p.postCaps }))}
                        className={
                          "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                          (materialsDetails.postCaps
                            ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                            : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                        }
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-extrabold">{materialsDetails.postCaps ? "On" : "Off"}</div>
                          <div className="text-[11px] text-[var(--muted)]">Tap</div>
                        </div>
                      </button>
                    </div>
                    <div>
                      <div className="text-[11px] text-[var(--muted)] mb-1">Arbor</div>
                      <button
                        type="button"
                        data-no-swipe="true"
                        onClick={() => setMaterialsDetails((p) => ({ ...p, arbor: !p.arbor }))}
                        className={
                          "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                          (materialsDetails.arbor
                            ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                            : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                        }
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-extrabold">{materialsDetails.arbor ? "Yes" : "No"}</div>
                          <div className="text-[11px] text-[var(--muted)]">Tap</div>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </div>
          </div>,
          document.body
        )
        : null}

      <SectionTitle title="Totals" />
      <GlassCard className="p-4">
        <div className="flex items-baseline justify-between gap-3 pb-2 mb-2 border-b border-[rgba(255,255,255,.12)]">
          <div className={"text-sm font-extrabold truncate " + (selectedStyle?.name ? "" : "text-[var(--muted)]")}>{selectedStyle?.name ?? "Fence style"}</div>
          <div className="text-[11px] text-[var(--muted)] whitespace-nowrap">{totalLf.toFixed(0)} LF</div>
        </div>
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-[var(--muted)]">Materials &amp; expenses · Deposit</span>
            <span className="font-black">{money(materialsAndExpensesTotal)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[var(--muted)]">Labor</span>
            <span className="font-black">{money((Number(totals.laborSubtotal) || 0) + (Number(removalTotal) || 0))}</span>
          </div>
          <div className="h-px bg-[rgba(255,255,255,.12)] my-1" />
          <div className="flex justify-between text-base">
            <span className="font-black">TOTAL</span>
            <span className="font-black">{money(grandTotal)}</span>
          </div>
        </div>
      </GlassCard>

      <div className="flex justify-end">
        <SecondaryButton onClick={generateContract}>Generate Contract</SecondaryButton>
      </div>

      {portalReady
        ? createPortal(
          <nav className="fixed bottom-0 left-0 right-0 z-50 transform-gpu will-change-transform isolate" aria-label="Estimate actions">
            <div className="mx-auto max-w-[980px] px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
              {saveError ? (
                <div className="mb-2 rounded-2xl border border-[rgba(255,80,80,.45)] bg-[rgba(255,80,80,.14)] px-4 py-3 text-[12px] font-black text-[rgba(255,240,240,.95)] shadow-glass">
                  {saveError}
                </div>
              ) : null}
              <div className="backdrop-blur-ios bg-[rgba(20,30,24,.55)] border border-[var(--stroke)] shadow-glass rounded-2xl h-16 flex items-center justify-around">
                <SecondaryButton onClick={reset} disabled={saving || savingAsNew}>Reset</SecondaryButton>
                <SecondaryButton onClick={saveAsNew} disabled={saving || savingAsNew}>
                  {savingAsNew ? "Saving…" : saveAsNewJustSaved ? "Saved" : "Save as new"}
                </SecondaryButton>
                <PrimaryButton onClick={save} disabled={saving || savingAsNew}>
                  {saving ? "Saving…" : "Save"}
                </PrimaryButton>
              </div>
            </div>
          </nav>,
          document.body
        )
        : null}
    </div>
  );
}
