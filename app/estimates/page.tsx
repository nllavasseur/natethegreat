"use client";

import { useRouter } from "next/navigation";
import NextImage from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlassCard, Input, PrimaryButton, SecondaryButton, SectionTitle, Select } from "@/components/ui";
import { money } from "@/lib/money";
import { computeMaterialsAndExpensesTotal, computeTotals } from "@/lib/totals";
import { fetchDraft, upsertDraft, uploadDraftPhoto } from "@/lib/draftsStore";
import type { QuoteItem, SectionKey } from "@/lib/types";

const sectionOptions: { key: SectionKey; label: string }[] = [
  { key: "materials", label: "Materials & Expenses" },
  { key: "labor", label: "Fence Installation / Labor" },
  { key: "additional", label: "Additional Services" }
];

function emptyItem(section: SectionKey): QuoteItem {
  return { section, name: "", qty: section === "additional" ? 0 : 1, unit: "ea", unitPrice: 0, lineTotal: 0 };
}

function normalizeUnitPriceKey(name: string) {
  const v = String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return v;
}

function canonicalMaterialsMergeKey(name: string) {
  let v = String(name || "").trim().toLowerCase();

  // Drop parenthetical notes that should not create separate line items.
  v = v.replace(/\([^)]*\)/g, "");

  // Normalize common synonyms / phrasing.
  v = v.replace(/pressure\s*treated/g, "");
  v = v.replace(/\bposts\b/g, "post");

  // Normalize punctuation/spacing.
  v = v.replace(/[^a-z0-9x' ]+/g, " ");
  v = v.replace(/\s+/g, " ").trim();

  return v;
}

function getUnitPriceFromMap(params: { materialUnitPrices: Record<string, number>; name: string; priceKey?: string }) {
  const { materialUnitPrices, name, priceKey } = params;
  if (priceKey) {
    const keyed = Number(materialUnitPrices[priceKey] ?? NaN);
    if (Number.isFinite(keyed) && keyed > 0) return keyed;
  }
  const direct = Number(materialUnitPrices[name] ?? NaN);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const baseName = String(name || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (baseName && baseName !== name) {
    const baseDirect = Number(materialUnitPrices[baseName] ?? NaN);
    if (Number.isFinite(baseDirect) && baseDirect > 0) return baseDirect;
  }
  const normalized = Number(materialUnitPrices[normalizeUnitPriceKey(name)] ?? NaN);
  if (Number.isFinite(normalized)) return normalized;
  if (baseName) {
    const normalizedBase = Number(materialUnitPrices[normalizeUnitPriceKey(baseName)] ?? NaN);
    if (Number.isFinite(normalizedBase)) return normalizedBase;
  }
  // If we had an explicit 0 set as a placeholder, keep it as the final fallback.
  if (Number.isFinite(direct)) return direct;
  return 0;
}

function aluminumHeightKeySuffix(hIn: number) {
  if (hIn === 54) return "54";
  if (hIn === 60) return "60";
  return "48";
}

function aluminumGateHeightSuffix(hIn: number) {
  if (hIn === 54) return "45";
  if (hIn === 60) return "5";
  return "4";
}

function aluminumStyleKeyPrefix(style: string) {
  return String(style || "").trim().toUpperCase();
}

function aluminumPanelPriceKey(style: string, hIn: number) {
  return `ALU_PANEL_${aluminumStyleKeyPrefix(style)}_${aluminumHeightKeySuffix(hIn)}`;
}

function aluminumPostPriceKey(kind: "LINE" | "CORNER" | "END" | "GATE" | "BLANK", style: string, hIn: number) {
  return `ALU_POST_${kind}_${aluminumStyleKeyPrefix(style)}_${aluminumHeightKeySuffix(hIn)}`;
}

function aluminumBlankGatePostPriceKey(style: string, hIn: number) {
  return `${aluminumStyleKeyPrefix(style)}_BLANK_GATE_POST_${aluminumHeightKeySuffix(hIn)}`;
}

function aluminumGatePriceKey(params: { style: string; kind: "WALK" | "DOUBLE"; widthIn: 48 | 60; hIn: number }) {
  const styleKey = aluminumStyleKeyPrefix(params.style);
  const h = aluminumGateHeightSuffix(params.hIn);
  return `${styleKey}_GATE_${params.kind}_${params.widthIn}_${h}`;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }
    if (!inQuotes && ch === ",") {
      out.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  out.push(cur);
  return out;
}

function isCedarLike(m: unknown) {
  if (m === "Cedar") return true;
  if (typeof m === "string" && m.startsWith("Rough sawn cedar")) return true;
  return false;
}

function woodMaterialLabel(m: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar") {
  return m === "Cedar tone" ? "CedarTone" : (isCedarLike(m) ? "Cedar" : "Pressure Treated");
}

function woodPostItemName(postSize: number, postType: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar") {
  const s = postSize === 10 ? "10" : "8";
  if (isCedarLike(postType)) return `4x4 x ${s}' Cedar S4S Post`;
  if (postType === "Cedar tone") return `4x4 x ${s}' CedarTone Post`;
  return `4x4 x ${s}' Post`;
}

function woodPostItemNameByDim(params: { postDim: "4x4" | "6x6"; postSize: number; postType: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar" }) {
  const { postDim, postSize, postType } = params;
  return postDim === "6x6" ? woodPost6x6ItemName(postSize, postType) : woodPostItemName(postSize, postType);
}

function woodPost6x6ItemName(postSize: number, postType: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar") {
  const s = postSize === 12 ? "12" : postSize === 10 ? "10" : "8";
  if (isCedarLike(postType)) return `6x6 x ${s}' Cedar S4S Post`;
  if (postType === "Cedar tone") return `6x6 x ${s}' CedarTone Post`;
  return `6x6 x ${s}' Pressure Treated Post`;
}

function woodRail2x4Name(lengthFt: 8 | 16, railMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar") {
  if (railMaterial === "Rough sawn cedar") return `2x4 ${lengthFt}' Rough Sawn Cedar Rails`;
  if (isCedarLike(railMaterial)) return `2x4 ${lengthFt}' Cedar S4S Rails`;
  if (railMaterial === "Cedar tone") return `2x4 ${lengthFt}' CedarTone Rails`;
  return `2x4 ${lengthFt}' Pressure Treated Rails`;
}

function woodPicketName(picketMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar" | "Rough sawn cedar 5/8" | "Rough sawn cedar 3/4") {
  if (picketMaterial === "Rough sawn cedar 5/8") return "6' Rough Sawn Cedar Dog Ear Pickets 5/8";
  if (picketMaterial === "Rough sawn cedar 3/4") return "6' Rough Sawn Cedar Dog Ear Pickets 3/4";
  if (isCedarLike(picketMaterial)) return "6' Cedar Dog Ear Pickets";
  if (picketMaterial === "Cedar tone") return "6' CedarTone Dog Ear Pickets";
  return "6' Pressure Treated Dog Ear Pickets";
}

function woodTrimName(trimMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar") {
  if (trimMaterial === "Rough sawn cedar") return "1x4 x 8' Rough Sawn Cedar Trim";
  if (isCedarLike(trimMaterial)) return "1x4 x 8' Cedar Trim";
  if (trimMaterial === "Cedar tone") return "1x4 x 8' CedarTone Trim";
  return "1x4 x 8' Trim";
}

function woodGateFramingName(railMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar") {
  return railMaterial === "Rough sawn cedar" ? "Rough Sawn Cedar Gate Framing" : "Cedar S4S Gate Framing";
}

function woodTwoByTwoName(twoByTwoMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar") {
  if (isCedarLike(twoByTwoMaterial)) return "2x2 8' Cedar S4S";
  if (twoByTwoMaterial === "Cedar tone") return "2x2 8' CedarTone";
  return "2x2 8' Pressure Treated";
}

function woodBoard1x6x12Name(boardMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar") {
  if (isCedarLike(boardMaterial)) return "1x6x12 Cedar Boards";
  if (boardMaterial === "Cedar tone") return "1x6x12 CedarTone Boards";
  return "1x6x12 Pressure Treated Boards";
}

function woodBoard1x6x8Name(boardMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar") {
  if (isCedarLike(boardMaterial)) return "1x6x8 Cedar";
  if (boardMaterial === "Cedar tone") return "1x6x8 CedarTone";
  return "1x6x8";
}

function woodBoard2x2x8Name(boardMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar") {
  if (isCedarLike(boardMaterial)) return "2x2x8 Cedar";
  if (boardMaterial === "Cedar tone") return "2x2x8 CedarTone";
  return "2x2x8";
}

function woodNailsBoxQty(picketMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar" | "Rough sawn cedar 5/8" | "Rough sawn cedar 3/4") {
  return isCedarLike(picketMaterial) ? 1000 : 2000;
}

function woodNailsItemName(picketMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar" | "Rough sawn cedar 5/8" | "Rough sawn cedar 3/4") {
  const qty = woodNailsBoxQty(picketMaterial);
  if (isCedarLike(picketMaterial)) return `2\" Nails ${qty}ct Stainless Steel Ring Shank Nails`;
  return `2\" Nails ${qty}ct Hot-Dipped Galvanized Ring Shank Nails`;
}

const vinylColorSwatches: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  White: { label: "White", bg: "rgba(255,255,255,.92)", fg: "rgba(0,0,0,.9)", border: "rgba(255,255,255,.55)" },
  Tan: { label: "Tan", bg: "rgba(226,206,166,.92)", fg: "rgba(0,0,0,.9)", border: "rgba(226,206,166,.6)" },
  Khaki: { label: "Khaki", bg: "rgba(210,196,156,.92)", fg: "rgba(0,0,0,.9)", border: "rgba(210,196,156,.6)" },
  Clay: { label: "Clay", bg: "rgba(170,120,86,.92)", fg: "rgba(255,255,255,.92)", border: "rgba(170,120,86,.6)" },
  "Cedar tone": { label: "Cedar tone", bg: "rgba(145,92,48,.92)", fg: "rgba(255,255,255,.92)", border: "rgba(145,92,48,.6)" },
  Gray: { label: "Gray", bg: "rgba(152,160,168,.92)", fg: "rgba(0,0,0,.9)", border: "rgba(152,160,168,.6)" },
  Black: { label: "Black", bg: "rgba(10,10,12,.92)", fg: "rgba(255,255,255,.92)", border: "rgba(255,255,255,.18)" }
};

type MaterialsDetails = {
  woodType: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar";
  railMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar";
  picketMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar" | "Rough sawn cedar 5/8" | "Rough sawn cedar 3/4";
  picketSpacingIn: 5.5 | 8;
  trimMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar";
  twoByTwoMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar";
  horizontalCedarBoardProfile: "5/4" | "1x6";
  horizontalCedarBoardMaterial: "Pressure Treated" | "5/4 cedar" | "1x6 cedar" | "CedarTone";
  shadowboxBoardMaterial: "Pressure Treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar";
  fiveQuarterTwoRailMeshVerticals: boolean;
  fiveQuarterTwoRailMeshCorners: boolean;
  wireMeshCornerBoardsOverride: number;
  wireMeshVerticalBoardsOverride: number;
  postDim: "4x4" | "6x6";
  postSize: 8 | 10 | 12 | 14;
  postType: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar";
  postCaps: boolean;
  topCaps: boolean;
  arbor: boolean;
  splitRailRails: 2 | 3;
  splitRailWireMesh: boolean;
  splitRailMaterial: "Pressure treated" | "Cedar tone";
  fourRailPoplarWireMesh: boolean;
  fourRailPoplarPostCaps: boolean;
  fourRailPoplarThreeRail: boolean;
  fourRailWireMeshWireMesh: boolean;
  fourRailWireMeshPostCaps: boolean;
  fourRailWireMeshThreeRail: boolean;
  splitRailCornerPosts: number;
  splitRailEndPosts: number;
  pictureFrameTrimPieces: 2 | 3 | 5;
  pictureFrameTrimMaterial: "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar";
  takeoffPreset: "standard" | "horizontal_cedar";
  horizontalCedarVerticals: boolean;
  horizontalCedarCornerAdjust: number;
  horizontalCedarExtraBoards: number;
  aluminumPanelHeight: number;
  aluminumGateAuto: boolean;
  aluminumCornerPosts: number;
  aluminumGatePosts: number;
  aluminumEndPosts: number;
  aluminumBlankPosts: number;
  mansfieldWalkGateOptions: string[];
  mansfieldDoubleGateOptions: string[];
  mansfieldBlankGatePost: boolean;
  atlanticWalkGateOptions: string[];
  atlanticDoubleGateOptions: string[];
  pacificWalkGateOptions: string[];
  pacificDoubleGateOptions: string[];
  toledoWalkGateOptions: string[];
  toledoDoubleGateOptions: string[];
  vinylColor: string;
  vinylPanelWidthFt: number;
  vinylPanelHeightFt: number;
  vinylCornerPosts: number;
  vinylEndPosts: number;
  vinylBlankPosts: number;
  vinylThreeWayPosts: number;
  vinylPostStiffeners: number;
  railEndBracketPacks: number;
};

const DEFAULT_MATERIALS_DETAILS: MaterialsDetails = {
  woodType: "Pressure treated",
  railMaterial: "Pressure treated",
  picketMaterial: "Pressure treated",
  picketSpacingIn: 5.5,
  trimMaterial: "Pressure treated",
  twoByTwoMaterial: "Pressure treated",
  horizontalCedarBoardProfile: "5/4",
  horizontalCedarBoardMaterial: "Pressure Treated",
  shadowboxBoardMaterial: "Pressure Treated",
  fiveQuarterTwoRailMeshVerticals: true,
  fiveQuarterTwoRailMeshCorners: true,
  wireMeshCornerBoardsOverride: -1,
  wireMeshVerticalBoardsOverride: -1,
  postDim: "4x4",
  postSize: 8,
  postType: "Pressure treated",
  postCaps: false,
  topCaps: false,
  arbor: false,
  splitRailRails: 3,
  splitRailWireMesh: false,
  splitRailMaterial: "Pressure treated",
  fourRailPoplarWireMesh: false,
  fourRailPoplarPostCaps: false,
  fourRailPoplarThreeRail: false,
  fourRailWireMeshWireMesh: false,
  fourRailWireMeshPostCaps: false,
  fourRailWireMeshThreeRail: false,
  splitRailCornerPosts: 0,
  splitRailEndPosts: 0,
  pictureFrameTrimPieces: 3,
  pictureFrameTrimMaterial: "Pressure treated",
  takeoffPreset: "standard",
  horizontalCedarVerticals: false,
  horizontalCedarCornerAdjust: 0,
  horizontalCedarExtraBoards: 0,
  aluminumPanelHeight: 48,
  aluminumGateAuto: true,
  aluminumCornerPosts: 0,
  aluminumGatePosts: 0,
  aluminumEndPosts: 0,
  aluminumBlankPosts: 0,
  mansfieldWalkGateOptions: [] as string[],
  mansfieldDoubleGateOptions: [] as string[],
  mansfieldBlankGatePost: false,
  atlanticWalkGateOptions: [] as string[],
  atlanticDoubleGateOptions: [] as string[],
  pacificWalkGateOptions: [] as string[],
  pacificDoubleGateOptions: [] as string[],
  toledoWalkGateOptions: [] as string[],
  toledoDoubleGateOptions: [] as string[],
  vinylColor: "White",
  vinylPanelWidthFt: 6,
  vinylPanelHeightFt: 6,
  vinylCornerPosts: 0,
  vinylEndPosts: 0,
  vinylBlankPosts: 0,
  vinylThreeWayPosts: 0,
  vinylPostStiffeners: 0,
  railEndBracketPacks: 0
};

export default function EstimatesPage() {
  return <EstimatesPageInner />;
}

function EstimatesPageInner() {
  const router = useRouter();
  const [draftParam, setDraftParam] = useState<string | null>(null);
  const [debugTotals, setDebugTotals] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const restoringRef = useRef(false);
  const [customerName, setCustomerName] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [projectPhoto, setProjectPhoto] = useState<File | null>(null);
  const [projectPhotoUrl, setProjectPhotoUrl] = useState<string | null>(null);
  const [projectPhotoPath, setProjectPhotoPath] = useState<string | null>(null);
  const [projectPhotoDataUrl, setProjectPhotoDataUrl] = useState<string | null>(null);
  const [photoViewerSrc, setPhotoViewerSrc] = useState<string | null>(null);
  const [photoViewerScale, setPhotoViewerScale] = useState(1);
  const [photoViewerX, setPhotoViewerX] = useState(0);
  const [photoViewerY, setPhotoViewerY] = useState(0);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [tracePoints, setTracePoints] = useState<Array<{ x: number; y: number }>>([]);
  const tracedSegments = useMemo(() => {
    if (tracePoints.length < 2) return [] as Array<{ label: string; a: { x: number; y: number }; b: { x: number; y: number } }>;
    return tracePoints.slice(0, -1).map((p, i) => ({
      label: `S${i + 1}`,
      a: p,
      b: tracePoints[i + 1]
    }));
  }, [tracePoints]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrResults, setOcrResults] = useState<Array<{ label: string; value: number | null; raw: string }>>([]);
  const [ocrEmpty, setOcrEmpty] = useState(false);
  const [ocrCenters, setOcrCenters] = useState<Record<string, { x: number; y: number }>>({});
  const [pickOcrForLabel, setPickOcrForLabel] = useState<string | null>(null);
  const [referenceLength, setReferenceLength] = useState(0);
  const [segments, setSegments] = useState<
    Array<{
      id: string;
      label: string;
      length: number;
      removed: boolean;
      removal?: boolean;
      gate?: boolean;
      cardId?: string | null;
      gateType?: "none" | "walk" | "double";
    }>
  >([]);
  const [notes, setNotes] = useState("");
  const [preInstallPhotos, setPreInstallPhotos] = useState<Array<{ src: string; srcPath?: string; note: string; createdAt: number }>>([]);
  const preInstallPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [notePhotoIdx, setNotePhotoIdx] = useState<number | null>(null);
  const preInstallPendingRef = useRef<Set<number>>(new Set());
  const [preInstallPendingCount, setPreInstallPendingCount] = useState(0);
  const [laborDays, setLaborDays] = useState<number>(0);
  const [laborManualDays, setLaborManualDays] = useState<string>("");
  const [laborManualCost, setLaborManualCost] = useState<string>("");
  const [gradingPrice, setGradingPrice] = useState<number>(0);
  const [treeRemovalPrice, setTreeRemovalPrice] = useState<number>(0);
  const [toughDigEnabled, setToughDigEnabled] = useState<boolean>(false);
  const [gradeEnabled, setGradeEnabled] = useState<boolean>(false);
  const [stumpGrindingPrice, setStumpGrindingPrice] = useState<number>(0);
  const [doubleGateCount, setDoubleGateCount] = useState<number>(0);

  function scanLengthsFromPhoto() {
    setOcrBusy(true);
    setOcrError(null);
    setOcrEmpty(false);
    setTimeout(() => {
      setOcrBusy(false);
      setOcrError("OCR scanning is not configured.");
    }, 50);
  }

  function applyTracedSegments() {
    const next = tracedSegments.map((s, i) => {
      const current = ocrResults.find((r) => r.label === s.label);
      const length = Number(current?.value) || 0;
      const id =
        typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
          ? (crypto as any).randomUUID()
          : `${Date.now()}-${i}-${s.label}`;
      return { id, label: s.label, length, removed: false, removal: false, cardId: null, gateType: "none" as const };
    });
    setSegments(next);
    setMeasureOpen(false);
  }

  const materialStyles: Array<{ type: "wood" | "vinyl" | "aluminum" | "chainlink"; name: string; thumb: string; group?: "privacy" | "semi-privacy" | "pool" | "picket" | "horse" }> = [
    {
      type: "wood",
      name: "standard",
      thumb: "/standard.jpeg"
    },
    {
      type: "wood",
      name: "horizontal",
      thumb: "/horizontal.jpeg"
    },
    {
      type: "wood",
      name: "picture framed flat top",
      thumb: "/picture framed flat top.jpeg"
    },
    {
      type: "wood",
      name: "4 rail wire mesh",
      thumb: "/4 rail wire mesh.jpeg"
    },
    {
      type: "wood",
      name: "split rail",
      thumb: "/split rail.jpeg"
    }
    ,
    {
      type: "wood",
      name: "1x4 shadowbox",
      thumb: "/1x4 shadowbox.jpg"
    },
    {
      type: "wood",
      name: "2 trim picture framed",
      thumb: "/2 trim picture framed.jpeg"
    },
    {
      type: "wood",
      name: "4' picture framed",
      thumb: "/4' picture framed.jpeg"
    },
    {
      type: "wood",
      name: "5:4 2 rail mesh",
      thumb: "/5:4 2 rail mesh.jpeg"
    },
    {
      type: "wood",
      name: "A & M",
      thumb: "/A & M.jpg"
    },
    {
      type: "wood",
      name: "all cedar niko",
      thumb: "/all cedar niko.jpeg"
    },
    {
      type: "wood",
      name: "all cedar picture framed",
      thumb: "/all cedar picture framed.jpeg"
    },
    {
      type: "wood",
      name: "basket-weve",
      thumb: "/basket-weve.jpeg"
    },
    {
      type: "wood",
      name: "board on board",
      thumb: "/board on board.jpeg"
    },
    {
      type: "wood",
      name: "casto",
      thumb: "/casto.jpg"
    },
    {
      type: "wood",
      name: "four rail poplar 6x6",
      thumb: "/four rail poplar 6x6.jpg"
    },
    {
      type: "wood",
      name: "hog-wire",
      thumb: "/hog-wire.jpeg"
    },
    {
      type: "wood",
      name: "mary-jane",
      thumb: "/mary-jane.jpeg"
    },
    {
      type: "wood",
      name: "niko",
      thumb: "/niko.jpeg"
    },
    {
      type: "wood",
      name: "picture framed lattice panel",
      thumb: "/picture framed lattice panel.jpeg"
    },
    {
      type: "wood",
      name: "picture framed caps",
      thumb: "/picture framed caps.jpg"
    },
    {
      type: "wood",
      name: "scalloped",
      thumb: "/scalloped.jpeg"
    },
    {
      type: "wood",
      name: "shadowbox top cap",
      thumb: "/shadowbox top cap.jpeg"
    },
    {
      type: "wood",
      name: "shadowbox",
      thumb: "/shadowbox.jpeg"
    }
    ,
    {
      type: "vinyl",
      name: "Savannah",
      group: "privacy",
      thumb: "/savannah.jpg"
    },
    {
      type: "vinyl",
      name: "Pembroke",
      group: "privacy",
      thumb: "/pembroke.jpg"
    },
    {
      type: "vinyl",
      name: "Glenshire",
      group: "privacy",
      thumb: "/glenshire.jpg"
    },
    {
      type: "vinyl",
      name: "Halifax",
      group: "privacy",
      thumb: "/halifax.jpg"
    },
    {
      type: "vinyl",
      name: "Tuscany",
      group: "privacy",
      thumb: "/tuscany.jpg"
    },
    {
      type: "vinyl",
      name: "Dora",
      group: "privacy",
      thumb: "/dora.jpg"
    },
    {
      type: "vinyl",
      name: "Calgary",
      group: "privacy",
      thumb: "/calgary.jpg"
    },
    {
      type: "vinyl",
      name: "Gideon",
      group: "privacy",
      thumb: "/gideon.jpg"
    },
    {
      type: "vinyl",
      name: "Ashton",
      group: "privacy",
      thumb: "/ashton.jpg"
    },
    {
      type: "vinyl",
      name: "Augusta",
      group: "privacy",
      thumb: "/augusta.jpg"
    },
    {
      type: "vinyl",
      name: "Bradford",
      group: "privacy",
      thumb: "/bradford.jpg"
    },
    {
      type: "vinyl",
      name: "Mason",
      group: "privacy",
      thumb: "/mason.jpg"
    },
    {
      type: "vinyl",
      name: "Scottsdale",
      group: "privacy",
      thumb: "/scottsdale.jpg"
    },
    {
      type: "vinyl",
      name: "Neptune",
      group: "pool",
      thumb: "/style-thumbs/vinyl/brochure/styles/neptune.jpg"
    },
    {
      type: "vinyl",
      name: "Williamsport",
      group: "pool",
      thumb: "/style-thumbs/vinyl/brochure/styles/williamsport.jpg"
    },
    {
      type: "vinyl",
      name: "Atlantis",
      group: "pool",
      thumb: "/style-thumbs/vinyl/brochure/styles/atlantis.jpg"
    },
    {
      type: "vinyl",
      name: "Crestview",
      group: "pool",
      thumb: "/style-thumbs/vinyl/brochure/styles/crestview.jpg"
    },
    {
      type: "vinyl",
      name: "Hanover",
      group: "pool",
      thumb: "/style-thumbs/vinyl/brochure/styles/hanover.jpg"
    },
    {
      type: "vinyl",
      name: "Captiva",
      group: "pool",
      thumb: "/style-thumbs/vinyl/brochure/styles/captiva.jpg"
    },
    {
      type: "vinyl",
      name: "Sarasota",
      group: "pool",
      thumb: "/style-thumbs/vinyl/brochure/styles/sarasota.jpg"
    },
    {
      type: "vinyl",
      name: "Davenport",
      group: "semi-privacy",
      thumb: "/style-thumbs/vinyl/brochure/styles/davenport.jpg"
    },
    {
      type: "vinyl",
      name: "Glendale",
      group: "semi-privacy",
      thumb: "/style-thumbs/vinyl/brochure/styles/glendale.jpg"
    },
    {
      type: "vinyl",
      name: "Alden",
      group: "semi-privacy",
      thumb: "/style-thumbs/vinyl/brochure/styles/alden.jpg"
    },
    {
      type: "vinyl",
      name: "Everglade",
      group: "semi-privacy",
      thumb: "/style-thumbs/vinyl/brochure/styles/everglade.jpg"
    },
    {
      type: "vinyl",
      name: "Huntington",
      group: "semi-privacy",
      thumb: "/style-thumbs/vinyl/brochure/styles/huntington.jpg"
    },
    {
      type: "vinyl",
      name: "Meridian",
      group: "semi-privacy",
      thumb: "/style-thumbs/vinyl/brochure/styles/meridian.jpg"
    },
    {
      type: "vinyl",
      name: "Provincetown",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/provincetown.jpg"
    },
    {
      type: "vinyl",
      name: "Plymouth",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/plymouth.jpg"
    },
    {
      type: "vinyl",
      name: "Ellington",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/ellington.jpg"
    },
    {
      type: "vinyl",
      name: "Chelsea",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/chelsea.jpg"
    },
    {
      type: "vinyl",
      name: "Hampshire",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/hampshire.jpg"
    },
    {
      type: "vinyl",
      name: "Monterey",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/monterey.jpg"
    },
    {
      type: "vinyl",
      name: "Richmond",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/richmond.jpg"
    },
    {
      type: "vinyl",
      name: "Abbington",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/abbington.jpg"
    },
    {
      type: "vinyl",
      name: "Classic",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/classic.jpg"
    },
    {
      type: "vinyl",
      name: "Stratford",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/stratford.jpg"
    },
    {
      type: "vinyl",
      name: "Barrington",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/barrington.jpg"
    },
    {
      type: "vinyl",
      name: "Hartford",
      group: "picket",
      thumb: "/style-thumbs/vinyl/brochure/styles/hartford.jpg"
    },
    {
      type: "vinyl",
      name: "Cross Buck",
      group: "horse",
      thumb: "/style-thumbs/vinyl/brochure/styles/cross-buck.jpg"
    },
    {
      type: "vinyl",
      name: "2 Rail Horse",
      group: "horse",
      thumb: "/style-thumbs/vinyl/brochure/styles/2-rail-horse.jpg"
    },
    {
      type: "vinyl",
      name: "3 Rail Horse",
      group: "horse",
      thumb: "/style-thumbs/vinyl/brochure/styles/3-rail-horse.jpg"
    },
    {
      type: "vinyl",
      name: "4 Rail Horse",
      group: "horse",
      thumb: "/style-thumbs/vinyl/brochure/styles/4-rail-horse.jpg"
    },
    {
      type: "aluminum",
      name: "Mansfield",
      thumb: "/style-thumbs/aluminum/mansfield.jpg"
    },
    {
      type: "aluminum",
      name: "Atlantic",
      thumb: "/style-thumbs/aluminum/atlantic.jpg"
    },
    {
      type: "aluminum",
      name: "Pacific",
      thumb: "/style-thumbs/aluminum/pacific.jpg"
    },
    {
      type: "aluminum",
      name: "Toledo",
      thumb: "/style-thumbs/aluminum/toledo.jpg"
    },
    {
      type: "aluminum",
      name: "Terrier",
      thumb: "/style-thumbs/aluminum/terrier.webp"
    }
  ];

  type ComboCard = {
    id: string;
    fenceType: "wood" | "vinyl" | "aluminum" | "chainlink";
    vinylStyleTab: "privacy" | "semi-privacy" | "pool" | "picket" | "horse";
    selectedStyle: { name: string; thumb: string } | null;
    materialsDetails: MaterialsDetails;
    extraPosts: number;
    extraPostSize?: number;
    shared?: boolean;
  };

  const [stylePickerIdx, setStylePickerIdx] = useState<boolean>(false);
  const [selectedFenceType, setSelectedFenceType] = useState<"wood" | "vinyl" | "aluminum" | "chainlink">("wood");
  const [vinylStyleTab, setVinylStyleTab] = useState<"privacy" | "semi-privacy" | "pool" | "picket" | "horse">("privacy");
  const [selectedStyle, setSelectedStyle] = useState<{ name: string; thumb: string } | null>(null);
  const [materialsDetailsOpen, setMaterialsDetailsOpen] = useState<boolean>(false);
  const [materialsDetails, setMaterialsDetails] = useState<MaterialsDetails>(DEFAULT_MATERIALS_DETAILS);

  const [extraPosts, setExtraPosts] = useState<number>(0);
  const [extraPostSize, setExtraPostSize] = useState<number>(10);

  const initialComboCardId =
    typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
      ? (crypto as any).randomUUID()
      : `card-${Date.now()}`;
  const [comboCards, setComboCards] = useState<ComboCard[]>([
    {
      id: initialComboCardId,
      fenceType: "wood",
      vinylStyleTab: "privacy",
      selectedStyle: null,
      materialsDetails: DEFAULT_MATERIALS_DETAILS,
      extraPosts: 0,
      extraPostSize: 10,
      shared: false
    }
  ]);
  const [activeComboCardId, setActiveComboCardId] = useState<string>(initialComboCardId);

  useEffect(() => {
    setComboCards((prev) =>
      prev.map((c) =>
        c.id === activeComboCardId
          ? {
              ...c,
              fenceType: selectedFenceType,
              vinylStyleTab,
              selectedStyle,
              materialsDetails,
              extraPosts,
              extraPostSize
            }
          : c
      )
    );
  }, [activeComboCardId, extraPostSize, extraPosts, materialsDetails, selectedFenceType, selectedStyle, vinylStyleTab]);

  useEffect(() => {
    const card = comboCards.find((c) => c.id === activeComboCardId);
    if (!card) return;
    if (card.fenceType !== selectedFenceType) setSelectedFenceType(card.fenceType);
    if (card.vinylStyleTab !== vinylStyleTab) setVinylStyleTab(card.vinylStyleTab);
    if ((card.selectedStyle?.name || "") !== (selectedStyle?.name || "")) setSelectedStyle(card.selectedStyle);
    if (card.materialsDetails !== materialsDetails) setMaterialsDetails(card.materialsDetails);
    if ((Number(card.extraPosts) || 0) !== (Number(extraPosts) || 0)) setExtraPosts(Number(card.extraPosts) || 0);
    const nextExtraPostSize = Number((card as any).extraPostSize);
    if (Number.isFinite(nextExtraPostSize) && nextExtraPostSize > 0 && nextExtraPostSize !== extraPostSize) setExtraPostSize(nextExtraPostSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeComboCardId]);

  const baseComboCardId = comboCards[0]?.id;

  const activeCardSegments = useMemo(() => {
    const baseId = baseComboCardId || null;
    const activeId = String(activeComboCardId || "");
    if (!activeId) return [] as typeof segments;
    return segments.filter((s) => {
      if (s.removed) return false;
      const cid = (s as any).cardId ?? null;
      const resolved = cid === null ? baseId : cid;
      return resolved === activeId;
    });
  }, [activeComboCardId, baseComboCardId, segments]);

  const activeCardWalkGates = useMemo(() => {
    return Math.max(0, activeCardSegments.filter((s: any) => (s as any).gateType === "walk" || ((s as any).gateType == null && Boolean((s as any).gate))).length);
  }, [activeCardSegments]);

  const activeCardDoubleGates = useMemo(() => {
    return Math.max(0, activeCardSegments.filter((s: any) => (s as any).gateType === "double").length);
  }, [activeCardSegments]);

  function resolveSegmentCardId(seg: { cardId?: string | null }) {
    const cid = seg.cardId ?? null;
    return cid === null ? (baseComboCardId || null) : cid;
  }

  function comboCardAccent(idx: number) {
    if (idx === 0) {
      return { border: "rgba(255,214,10,.55)", bg: "rgba(255,214,10,.10)" };
    }
    if (idx === 1) {
      return { border: "rgba(60,140,255,.70)", bg: "rgba(60,140,255,.14)" };
    }
    if (idx === 2) {
      return { border: "rgba(170,90,255,.42)", bg: "rgba(170,90,255,.12)" };
    }
    if (idx === 3) {
      return { border: "rgba(255,90,180,.40)", bg: "rgba(255,90,180,.10)" };
    }
    if (idx >= 4) {
      return { border: "rgba(40,210,180,.40)", bg: "rgba(40,210,180,.10)" };
    }
    return null;
  }

  function deleteComboCard(cardId: string) {
    const baseId = baseComboCardId;
    if (!baseId) return;
    if (cardId === baseId) return;

    setComboCards((prev) => prev.filter((c) => c.id !== cardId));
    setSegments((prev) => prev.map((s) => (resolveSegmentCardId(s) === cardId ? { ...s, cardId: null } : s)));
    setActiveComboCardId(baseId);
  }

  const sharedLf = useMemo(() => {
    const sharedCardIds = new Set(comboCards.filter((c, idx) => idx > 0 && Boolean(c.shared)).map((c) => c.id));
    if (!sharedCardIds.size) return 0;
    return segments
      .filter((s) => !s.removed)
      .filter((s) => (Number(s.length) || 0) > 0)
      .filter((s) => sharedCardIds.has(resolveSegmentCardId(s) || ""))
      .reduce((sum, s) => sum + (Number(s.length) || 0), 0);
  }, [comboCards, segments]);

  const [items, setItems] = useState<QuoteItem[]>([]);

  const [takeoffMaterialsStable, setTakeoffMaterialsStable] = useState<QuoteItem[]>([]);

  const [takeoffManualItems, setTakeoffManualItems] = useState<QuoteItem[]>([]);
  const [takeoffManualDraft, setTakeoffManualDraft] = useState(() => ({ desc: "", qty: "", unitPrice: "" }));

  const [takeoffPerPanelAddons, setTakeoffPerPanelAddons] = useState<
    Array<{ id: string; desc: string; qtyPerPanel: number; unitPrice: number }>
  >([]);
  const [takeoffPerPanelDraft, setTakeoffPerPanelDraft] = useState(() => ({ desc: "", qtyPerPanel: "", unitPrice: "" }));

  const [saving, setSaving] = useState(false);
  const [savingAsNew, setSavingAsNew] = useState(false);
  const [saveAsNewJustSaved, setSaveAsNewJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const [cloneParam, setCloneParam] = useState<string | null>(null);

  const [takeoffError, setTakeoffError] = useState<string | null>(null);
  const takeoffErrorRef = useRef<string | null>(null);

  const takeoffDiagnostics = useMemo(() => {
    try {
      const baseId = baseComboCardId || null;
      const eligibleSegments = segments.filter((s) => !s.removed && (Number(s.length) || 0) > 0);
      const cardsWithStyle = comboCards.filter((c) => Boolean(c.selectedStyle));
      const perCard = comboCards.map((c) => {
        const assigned = eligibleSegments.filter((s) => {
          const cid = (s as any).cardId ?? null;
          const resolved = cid === null ? baseId : cid;
          return resolved === c.id;
        }).length;
        return {
          id: c.id,
          hasStyle: Boolean(c.selectedStyle),
          fenceType: c.fenceType,
          assignedSegments: assigned
        };
      });

      const hasEligibleSegments = eligibleSegments.length > 0;
      const hasStyledCards = cardsWithStyle.length > 0;
      const hasAnyAssignedToStyled = perCard.some((p) => p.hasStyle && p.assignedSegments > 0);

      return {
        baseId,
        activeId: String(activeComboCardId || ""),
        eligibleSegments: eligibleSegments.length,
        hasEligibleSegments,
        hasStyledCards,
        hasAnyAssignedToStyled,
        perCard
      };
    } catch {
      return null;
    }
  }, [activeComboCardId, baseComboCardId, comboCards, segments]);

  const [materialUnitPriceDrafts, setMaterialUnitPriceDrafts] = useState<Record<string, string>>({});
  const touchedMaterialUnitPricesRef = useRef<Set<string>>(new Set());
  const materialUnitPricesActive = useMemo(() => {
    return Object.keys(materialUnitPriceDrafts).length > 0;
  }, [materialUnitPriceDrafts]);

  const [takeoffUnitPriceOverrides, setTakeoffUnitPriceOverrides] = useState<Record<string, number>>({});
  const [takeoffUnitPriceOverrideDrafts, setTakeoffUnitPriceOverrideDrafts] = useState<Record<string, string>>({});

  function takeoffLineKeyForItem(m: any) {
    const name = String((m as any)?.name || "");
    const unit = String((m as any)?.unit || "");
    const priceKey = typeof (m as any)?.priceKey === "string" ? String((m as any).priceKey) : "";
    const nameKey = canonicalMaterialsMergeKey(name);
    const core = priceKey ? `${priceKey}__${nameKey}` : nameKey;
    return `${core}__${unit}`;
  }

  const [itemNumberDrafts, setItemNumberDrafts] = useState<Record<string, string>>({});

  const materialsDetailsActive = useMemo(() => {
    return (
      (materialsDetails.mansfieldWalkGateOptions || []).some((v) => Boolean(v)) ||
      (materialsDetails.mansfieldDoubleGateOptions || []).some((v) => Boolean(v)) ||
      Boolean(materialsDetails.mansfieldBlankGatePost) ||
      (materialsDetails.atlanticDoubleGateOptions || []).some((v) => Boolean(v)) ||
      (materialsDetails.toledoWalkGateOptions || []).some((v) => Boolean(v)) ||
      (materialsDetails.toledoDoubleGateOptions || []).some((v) => Boolean(v)) ||
      Boolean(materialsDetails.postCaps) ||
      Boolean(materialsDetails.topCaps) ||
      Boolean(materialsDetails.arbor) ||
      String(materialsDetails.railMaterial || "Pressure treated") !== "Pressure treated" ||
      String(materialsDetails.picketMaterial || "Pressure treated") !== "Pressure treated" ||
      (Number((materialsDetails as any).picketSpacingIn) || 5.5) !== 5.5 ||
      String(materialsDetails.trimMaterial || "Pressure treated") !== "Pressure treated" ||
      String(materialsDetails.twoByTwoMaterial || "Pressure treated") !== "Pressure treated" ||
      String(materialsDetails.shadowboxBoardMaterial || "Pressure Treated") !== "Pressure Treated" ||
      Boolean(materialsDetails.fiveQuarterTwoRailMeshVerticals) !== true ||
      Boolean(materialsDetails.fiveQuarterTwoRailMeshCorners) !== true ||
      (Number(materialsDetails.wireMeshCornerBoardsOverride) || -1) !== -1 ||
      (Number(materialsDetails.wireMeshVerticalBoardsOverride) || -1) !== -1 ||
      (Number(materialsDetails.splitRailRails) || 3) !== 3 ||
      Boolean(materialsDetails.splitRailWireMesh) ||
      String(materialsDetails.splitRailMaterial || "Pressure treated") !== "Pressure treated" ||
      Boolean(materialsDetails.fourRailPoplarWireMesh) ||
      (Number(materialsDetails.splitRailCornerPosts) || 0) !== 0 ||
      (Number(materialsDetails.splitRailEndPosts) || 0) !== 0 ||
      String(materialsDetails.vinylColor || "White") !== "White" ||
      (Number(materialsDetails.vinylPanelWidthFt) || 6) !== 6 ||
      (Number(materialsDetails.vinylPanelHeightFt) || 6) !== 6 ||
      (Number(materialsDetails.vinylCornerPosts) || 0) !== 0 ||
      (Number(materialsDetails.vinylEndPosts) || 0) !== 0 ||
      (Number(materialsDetails.vinylBlankPosts) || 0) !== 0 ||
      (Number(materialsDetails.vinylThreeWayPosts) || 0) !== 0 ||
      (Number(materialsDetails.vinylPostStiffeners) || 0) !== 0 ||
      (Number(materialsDetails.railEndBracketPacks) || 0) !== 0 ||
      (Number(extraPosts) || 0) !== 0
    );
  }, [extraPosts, materialsDetails]);

  const effectiveDoubleGateCount = useMemo(() => {
    const fromSegments = Math.max(
      0,
      segments
        .filter((s) => !s.removed)
        .filter((s) => (s as any).gateType === "double")
        .length
    );
    if (fromSegments > 0) return fromSegments;
    return Math.max(0, Number(doubleGateCount) || 0);
  }, [doubleGateCount, segments]);

  const isWalkGateSegment = (s: any) => (s as any).gateType === "walk" || ((s as any).gateType == null && Boolean((s as any).gate));
  const isDoubleGateSegment = (s: any) => (s as any).gateType === "double";

  const splitRailPostsSummary = useMemo(() => {
    const n = String(selectedStyle?.name || "").trim().toLowerCase();
    const styleKind = !n
      ? ""
      : (n === "standard privacy" || n === "standard")
          ? "wood_standard"
          : (n === "horizontal cedar" || n === "horizontal")
              ? "wood_horizontal"
              : (n === "picture framed" || n.startsWith("picture framed") || n.includes("picture framed"))
                  ? "wood_picture_framed"
                  : (n === "3 rail w/ wire mesh" || n.includes("wire mesh") || n.includes("hog-wire") || n.includes("hog wire") || n.includes("mesh"))
                      ? "wood_wire_mesh"
                      : (n === "split rail" || n.includes("split rail"))
                          ? "wood_split_rail"
                          : n;

    if (selectedFenceType !== "wood" || styleKind !== "wood_split_rail") {
      return { total: 0, line: 0, corner: 0, end: 0, gateDerived: 0 };
    }

    const walkGates = Math.max(0, segments.filter((s) => !s.removed).filter((s) => isWalkGateSegment(s)).length);
    const doubleGates = Math.max(0, Number(effectiveDoubleGateCount) || 0);
    const gateDerived = (walkGates + doubleGates) * 2;

    const lf = segments.filter((s) => !s.removed).reduce((sum, s) => sum + (Number(s.length) || 0), 0);
    const segmentLengths = segments
      .filter((s) => !s.removed)
      .map((s) => Number(s.length) || 0)
      .filter((n) => n > 0);
    const panels = segmentLengths.length
      ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 10), 0)
      : (lf > 0 ? Math.ceil(lf / 10) : 0);
    const postsBase = panels > 0 ? panels + 1 : 0;
    const total = Math.max(0, postsBase + gateDerived + (Number(extraPosts) || 0));

    const corner = Math.max(0, Math.floor(Number(materialsDetails.splitRailCornerPosts) || 0));
    const end = Math.max(0, Math.floor(Number(materialsDetails.splitRailEndPosts) || 0));
    const line = Math.max(0, total - (corner + end + gateDerived));

    return { total, line, corner, end, gateDerived };
  }, [effectiveDoubleGateCount, extraPosts, materialsDetails.splitRailCornerPosts, materialsDetails.splitRailEndPosts, segments, selectedFenceType, selectedStyle?.name]);

  const selectedStyleKind = useMemo(() => {
    const nRaw = String(selectedStyle?.name || "");
    const n = nRaw
      .trim()
      .toLowerCase()
      .replaceAll("/", ":")
      .replaceAll("-", " ")
      .replace(/\s+/g, " ");

    if (n === "standard privacy" || n === "standard") return "wood_standard";
    if (n === "horizontal cedar" || n === "horizontal") return "wood_horizontal";
    if (n === "niko" || n === "all cedar niko") return "wood_niko";
    if (n === "casto") return "wood_casto";
    if (n === "a & m") return "wood_am";
    if (n === "4' picture framed") return "wood_picture_framed_4ft";
    if (n === "picture framed lattice panel") return "wood_picture_framed_lattice";
    if (n === "picture framed" || n.startsWith("picture framed") || n.includes("picture framed")) return "wood_picture_framed";
    if (n === "mary jane") return "wood_picture_framed";
    if (n === "picture framed caps") return "wood_picture_framed";
    if (n === "hog wire" || n === "hog-wire" || n.includes("hog wire") || n.includes("hog-wire")) return "wood_hog_wire";
    if ((n.includes("4 rail") || n.includes("four rail")) && n.includes("wire") && n.includes("mesh")) return "wood_4_rail_wire_mesh";
    if (n === "4 rail wire mesh" || n.includes("4 rail wire mesh")) return "wood_4_rail_wire_mesh";
    if (n === "3 rail w/ wire mesh" || n.includes("wire mesh") || n.includes("hog-wire") || n.includes("hog wire") || n.includes("mesh")) return "wood_wire_mesh";
    if (n === "split rail" || n.includes("split rail")) return "wood_split_rail";
    if (n === "shadowbox top cap" || n.includes("shadowbox top cap")) return "wood_shadowbox_top_cap";
    if (n === "1x4 shadowbox" || n.includes("1x4 shadowbox")) return "wood_shadowbox";
    if (n === "shadowbox") return "wood_shadowbox_pickets";
    if (n.includes("shadowbox")) return "wood_shadowbox_pickets";
    if (n === "basket weve" || n === "basket weave" || n.includes("basket weve") || n.includes("basket weave")) return "wood_basket_weave";
    if (n === "board on board" || n.includes("board on board") || n.includes("board-on-board")) return "wood_board_on_board";
    if (n === "four rail poplar" || n.includes("four rail poplar")) return "wood_four_rail_poplar";
    if (n === "scalloped" || n.includes("scalloped")) return "wood_scalloped";
    return n;
  }, [selectedStyle?.name]);

  const castoTopCapsLocked = selectedStyleKind === "wood_casto" && materialsDetails.postDim !== "4x4";

  useEffect(() => {
    if (!castoTopCapsLocked) return;
    if (!materialsDetails.topCaps) return;
    setMaterialsDetails((p) => ({
      ...p,
      topCaps: false
    }));
  }, [castoTopCapsLocked, materialsDetails.topCaps]);

  useEffect(() => {
    if (selectedStyleKind !== "wood_am") return;
    if ((Number(materialsDetails.pictureFrameTrimPieces) || 0) === 5) return;
    setMaterialsDetails((p) => ({
      ...p,
      pictureFrameTrimPieces: 5
    }));
  }, [materialsDetails.pictureFrameTrimPieces, selectedStyleKind]);

  useEffect(() => {
    const useHorizontalCedarTakeoff =
      (selectedStyleKind === "wood_standard" && materialsDetails.takeoffPreset === "horizontal_cedar") ||
      selectedStyleKind === "wood_horizontal";
    if (!useHorizontalCedarTakeoff) return;

    const wood = (materialsDetails.woodType || "Pressure treated") as "Pressure treated" | "Cedar" | "Cedar tone" | "Rough sawn cedar";
    const desired =
      wood === "Cedar tone"
        ? "CedarTone"
        : wood === "Pressure treated"
          ? "Pressure Treated"
          : (materialsDetails.horizontalCedarBoardProfile === "1x6" ? "1x6 cedar" : "5/4 cedar");
    if (materialsDetails.horizontalCedarBoardMaterial === desired) return;
    setMaterialsDetails((p) => ({ ...p, horizontalCedarBoardMaterial: desired }));
  }, [materialsDetails.horizontalCedarBoardMaterial, materialsDetails.horizontalCedarBoardProfile, materialsDetails.takeoffPreset, materialsDetails.woodType, selectedStyleKind]);

  useEffect(() => {
    const isPictureFramedFamily =
      selectedStyleKind === "wood_picture_framed" ||
      selectedStyleKind === "wood_niko" ||
      selectedStyleKind === "wood_casto" ||
      selectedStyleKind === "wood_picture_framed_4ft" ||
      selectedStyleKind === "wood_picture_framed_lattice";
    if (!isPictureFramedFamily) return;

    const raw = Math.floor(Number(materialsDetails.pictureFrameTrimPieces) || 0);
    const next = raw === 2 ? 2 : 3;
    if (raw === next) return;
    setMaterialsDetails((p) => ({
      ...p,
      pictureFrameTrimPieces: next
    }));
  }, [materialsDetails.pictureFrameTrimPieces, selectedStyleKind]);

  const vinylPrivacyMatrix = useMemo(() => {
    const fourSixEight = [4, 6, 8];
    const sixEight = [6, 8];
    const heights456 = [4, 5, 6];
    const heights5678 = [5, 6, 7, 8];
    const heights678 = [6, 7, 8];
    const heights45678 = [4, 5, 6, 7, 8];

    return {
      Savannah: {
        colors: ["Coastal gray woodgrain", "Cedar woodgrain", "Black", "White", "Tan", "Gray", "Khaki"],
        getWidths: (color: string) => (["Coastal gray woodgrain", "Cedar woodgrain", "Black"].includes(color) ? [8] : fourSixEight),
        getHeights: (color: string) => (["Coastal gray woodgrain", "Cedar woodgrain", "Black"].includes(color) ? [6] : heights456)
      },
      Halifax: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights5678 },
      Pembroke: { colors: ["White"], widths: sixEight, heights: heights45678 },
      Glenshire: { colors: ["White"], widths: sixEight, heights: heights678 },
      Tuscany: { colors: ["White"], widths: sixEight, heights: heights678 },
      Dora: { colors: ["White"], widths: sixEight, heights: heights678 },
      Calgary: { colors: ["White"], widths: sixEight, heights: heights678 },
      Gideon: { colors: ["White"], widths: sixEight, heights: heights678 },
      Ashton: { colors: ["White", "Tan", "Khaki"], widths: fourSixEight, heights: heights5678 },
      Augusta: { colors: ["White", "Tan", "Gray", "Khaki"], widths: sixEight, heights: heights678 },
      // Backwards compatibility for older drafts saved with a misspelling.
      Agusta: { colors: ["White", "Tan", "Gray", "Khaki"], widths: sixEight, heights: heights678 },
      Bradford: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights5678 },
      Mason: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights5678 },
      Scottsdale: { colors: ["White"], widths: sixEight, heights: heights5678 }
    } as const;
  }, []);

  const vinylPoolMatrix = useMemo(() => {
    const sixEight = [6, 8];
    const heights45 = [4, 5];
    return {
      Neptune: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights45 },
      Williamsport: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights45 },
      Atlantis: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights45 },
      Crestview: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights45 },
      Hanover: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights45 },
      Captiva: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights45 },
      Sarasota: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights45 }
    } as const;
  }, []);

  const vinylSemiPrivacyMatrix = useMemo(() => {
    const sixEight = [6, 8];
    const heights56 = [5, 6];
    return {
      Davenport: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights56 },
      Glendale: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights56 },
      Alden: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights56 },
      Everglade: { colors: ["White", "Tan", "Khaki"], widths: [8], heights: [6] },
      Huntington: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights56 },
      Meridian: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights56 }
    } as const;
  }, []);

  const vinylPicketMatrix = useMemo(() => {
    const sixEight = [6, 8];
    const heights345 = [3, 4, 5];
    return {
      Provincetown: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights345 },
      Plymouth: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights345 },
      Ellington: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights345 },
      Chelsea: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights345 },
      Hampshire: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights345 },
      Monterey: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: [3, 4] },
      Richmond: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights345 },
      Abbington: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights345 },
      Classic: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: [3, 4] },
      Stratford: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights345 },
      Barrington: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights345 },
      Hartford: { colors: ["White", "Tan", "Khaki"], widths: sixEight, heights: heights345 }
    } as const;
  }, []);

  const vinylHorseMatrix = useMemo(() => {
    // Brochure section for horse fencing does not list panel width/height; these defaults keep it selectable.
    return {
      "Cross Buck": { colors: ["White", "Tan", "Khaki"], widths: [8], heights: [4] },
      "2 Rail Horse": { colors: ["White", "Tan", "Khaki"], widths: [8], heights: [4] },
      "3 Rail Horse": { colors: ["White", "Tan", "Khaki"], widths: [8], heights: [4] },
      "4 Rail Horse": { colors: ["White", "Tan", "Khaki"], widths: [8], heights: [4] }
    } as const;
  }, []);

  const vinylAllowed = useMemo(() => {
    if (selectedFenceType !== "vinyl" || !selectedStyle?.name) {
      return {
        colors: ["White"],
        widths: [6],
        heights: [6]
      };
    }

    const matrix = vinylStyleTab === "pool"
      ? vinylPoolMatrix
      : (vinylStyleTab === "picket"
          ? vinylPicketMatrix
          : (vinylStyleTab === "horse"
              ? vinylHorseMatrix
              : (vinylStyleTab === "semi-privacy" ? vinylSemiPrivacyMatrix : vinylPrivacyMatrix)));
    const entry = (matrix as any)[selectedStyle.name];
    if (!entry) {
      return {
        colors: ["White"],
        widths: [6],
        heights: [6]
      };
    }

    const curColor = String(materialsDetails.vinylColor || "White");
    const colors = Array.isArray(entry.colors) ? entry.colors : ["White"];
    const widths = typeof entry.getWidths === "function" ? entry.getWidths(curColor) : (entry.widths || [6]);
    const heights = typeof entry.getHeights === "function" ? entry.getHeights(curColor) : (entry.heights || [6]);
    return { colors, widths, heights };
  }, [materialsDetails.vinylColor, selectedFenceType, selectedStyle?.name, vinylHorseMatrix, vinylPicketMatrix, vinylPoolMatrix, vinylPrivacyMatrix, vinylSemiPrivacyMatrix, vinylStyleTab]);

  useEffect(() => {
    if (selectedFenceType !== "vinyl") return;
    if (!selectedStyle?.name) return;

    setMaterialsDetails((p) => {
      const curColor = String(p.vinylColor || "White");
      const nextColor = vinylAllowed.colors.includes(curColor) ? curColor : (vinylAllowed.colors[0] || "White");

      const curW = Number(p.vinylPanelWidthFt) || 0;
      const nextW = vinylAllowed.widths.includes(curW) ? curW : Number(vinylAllowed.widths[0] || 6);

      const curH = Number(p.vinylPanelHeightFt) || 0;
      const nextH = vinylAllowed.heights.includes(curH) ? curH : Number(vinylAllowed.heights[0] || 6);

      const same = curColor === nextColor && curW === nextW && curH === nextH;
      if (same) return p;
      return {
        ...p,
        vinylColor: nextColor,
        vinylPanelWidthFt: nextW,
        vinylPanelHeightFt: nextH
      };
    });
  }, [selectedFenceType, selectedStyle?.name, vinylAllowed.colors, vinylAllowed.heights, vinylAllowed.widths]);

  const aluminumPostsSummary = useMemo(() => {
    if (selectedFenceType !== "aluminum") {
      return {
        total: 0,
        line: 0,
        corner: 0,
        end: 0,
        gate: 0,
        blank: 0,
        gateDerived: 0
      };
    }

    const walkGates = Math.max(0, Number(activeCardWalkGates) || 0);
    const doubleGates = Math.max(0, Number(activeCardDoubleGates) || 0);
    const gateDerived = (walkGates + doubleGates) * 2;

    const w = 6;
    const segmentLengths = activeCardSegments
      .map((s) => Number(s.length) || 0)
      .filter((n) => n > 0);
    const panels = segmentLengths.length
      ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / w), 0)
      : 0;

    const postsBase = panels > 0 ? panels + 1 : 0;
    const total = Math.max(0, postsBase + gateDerived + (Number(extraPosts) || 0));

    const corner = Math.max(0, Math.floor(Number(materialsDetails.aluminumCornerPosts) || 0));
    const gate = materialsDetails.aluminumGateAuto
      ? gateDerived
      : Math.max(0, Math.floor(Number(materialsDetails.aluminumGatePosts) || 0));
    const end = Math.max(0, Math.floor(Number(materialsDetails.aluminumEndPosts) || 0));
    const blank = Math.max(0, Math.floor(Number(materialsDetails.aluminumBlankPosts) || 0));
    const line = Math.max(0, total - (corner + gate + end + blank));

    return { total, line, corner, end, gate, blank, gateDerived };
  }, [activeCardDoubleGates, activeCardSegments, activeCardWalkGates, extraPosts, materialsDetails.aluminumBlankPosts, materialsDetails.aluminumCornerPosts, materialsDetails.aluminumEndPosts, materialsDetails.aluminumGateAuto, materialsDetails.aluminumGatePosts, selectedFenceType]);

  const vinylSummary = useMemo(() => {
    if (selectedFenceType !== "vinyl") {
      return {
        panels: 0,
        posts: 0
      };
    }

    const lf = segments
      .filter((s) => !s.removed)
      .reduce((sum, s) => sum + (Number(s.length) || 0), 0);
    const panelW = Math.max(1, Number(materialsDetails.vinylPanelWidthFt) || 6);
    const panels = lf > 0 ? Math.ceil(lf / panelW) : 0;
    const postsBase = panels > 0 ? panels + 1 : 0;

    const walkGates = Math.max(0, segments.filter((s) => !s.removed).filter((s) => isWalkGateSegment(s)).length);
    const gatePostsAdd = walkGates * 2;
    const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));
    return { panels, posts };
  }, [extraPosts, materialsDetails.vinylPanelWidthFt, segments, selectedFenceType]);

  const walkGateCount = useMemo(() => {
    return Math.max(
      0,
      segments
        .filter((s) => !s.removed)
        .filter((s) => (s as any).gateType === "walk" || ((s as any).gateType == null && Boolean((s as any).gate)))
        .length
    );
  }, [segments]);

  const totalLf = useMemo(() => {
    return segments
      .filter((s) => !s.removed)
      .reduce((sum, s) => sum + (Number(s.length) || 0), 0);
  }, [segments]);

  const horizontalCedarDetailsActive = useMemo(() => {
    if (selectedStyleKind !== "wood_horizontal") return false;
    return (
      materialsDetails.horizontalCedarVerticals ||
      (Number(materialsDetails.horizontalCedarCornerAdjust) || 0) !== 0 ||
      (Number(materialsDetails.horizontalCedarExtraBoards) || 0) !== 0 ||
      materialsDetails.horizontalCedarBoardMaterial !== "5/4 cedar" ||
      materialsDetails.postSize !== 10 ||
      materialsDetails.postType !== "Pressure treated" ||
      Boolean(materialsDetails.postCaps) ||
      Boolean(materialsDetails.arbor) ||
      (Number(extraPosts) || 0) !== 0
    );
  }, [extraPosts, materialsDetails, selectedStyleKind]);

  const useHorizontalCedarTakeoff = useMemo(() => {
    return (
      (selectedStyleKind === "wood_standard" && materialsDetails.takeoffPreset === "horizontal_cedar") ||
      selectedStyleKind === "wood_horizontal"
    );
  }, [materialsDetails.takeoffPreset, selectedStyleKind]);

  const aluminumAllowedPanelHeights = useMemo(() => {
    if (selectedFenceType !== "aluminum") return [48];
    const style = String(selectedStyle?.name || "");
    if (style === "Mansfield") return [48, 60];
    if (style === "Atlantic") return [48];
    if (style === "Pacific") return [54];
    if (style === "Toledo") return [48, 60];
    if (style === "Terrier") return [48];
    return [48];
  }, [selectedFenceType, selectedStyle?.name]);

  useEffect(() => {
    if (selectedFenceType !== "aluminum") return;
    if (String(selectedStyle?.name || "") !== "Mansfield") return;

    const walkGates = Math.max(0, Number(activeCardWalkGates) || 0);
    const doubleGates = Math.max(0, Number(activeCardDoubleGates) || 0);

    setMaterialsDetails((p) => {
      const defaultWalk = (Number(p.aluminumPanelHeight) || 0) === 60 ? "walk_48_5" : "walk_48_4";
      const defaultDouble = (Number(p.aluminumPanelHeight) || 0) === 60 ? "double_48_5" : "double_48_4";
      const nextWalk = Array.from({ length: walkGates }, (_, i) => {
        const cur = p.mansfieldWalkGateOptions?.[i] || defaultWalk;
        if (cur === "walk_48_5_arched") return "walk_48_5";
        if (cur === "walk_60_5_arched") return "walk_60_5";
        return cur;
      });
      const nextDouble = Array.from({ length: doubleGates }, (_, i) => p.mansfieldDoubleGateOptions?.[i] || defaultDouble);

      const walkSame = (p.mansfieldWalkGateOptions?.length || 0) === nextWalk.length && nextWalk.every((v, i) => v === p.mansfieldWalkGateOptions?.[i]);
      const doubleSame = (p.mansfieldDoubleGateOptions?.length || 0) === nextDouble.length && nextDouble.every((v, i) => v === p.mansfieldDoubleGateOptions?.[i]);
      if (walkSame && doubleSame) return p;
      return {
        ...p,
        mansfieldWalkGateOptions: nextWalk,
        mansfieldDoubleGateOptions: nextDouble
      };
    });
  }, [activeCardDoubleGates, activeCardWalkGates, selectedFenceType, selectedStyle?.name]);

  useEffect(() => {
    if (selectedFenceType !== "aluminum") return;
    if (String(selectedStyle?.name || "") !== "Toledo") return;

    const isFive = (Number(materialsDetails.aluminumPanelHeight) || 0) === 60;
    setMaterialsDetails((p) => {
      const nextWalk = (p.toledoWalkGateOptions || []).map((v) => {
        const s = String(v);
        const n = s === "walk_48_5_arched" ? "walk_48_5" : s === "walk_60_5_arched" ? "walk_60_5" : s;
        if (isFive) {
          if (n === "walk_48_4") return "walk_48_5";
          if (n === "walk_60_4") return "walk_60_5";
        } else {
          if (n === "walk_48_5") return "walk_48_4";
          if (n === "walk_60_5") return "walk_60_4";
        }
        return n;
      });

      const nextDouble = (p.toledoDoubleGateOptions || []).map((v) => {
        const s = String(v);
        const n = s === "double_60_4_arched" ? "double_60_4" : s === "double_60_5_arched" ? "double_60_5" : s;
        if (isFive) {
          if (n === "double_48_4") return "double_48_5";
          if (n === "double_60_4") return "double_60_5";
        } else {
          if (n === "double_48_5") return "double_48_4";
          if (n === "double_60_5") return "double_60_4";
        }
        return n;
      });

      const sameWalk = (p.toledoWalkGateOptions || []).length === nextWalk.length && nextWalk.every((v, i) => v === p.toledoWalkGateOptions?.[i]);
      const sameDouble = (p.toledoDoubleGateOptions || []).length === nextDouble.length && nextDouble.every((v, i) => v === p.toledoDoubleGateOptions?.[i]);
      if (sameWalk && sameDouble) return p;
      return { ...p, toledoWalkGateOptions: nextWalk, toledoDoubleGateOptions: nextDouble };
    });
  }, [materialsDetails.aluminumPanelHeight, selectedFenceType, selectedStyle?.name]);

  useEffect(() => {
    if (selectedFenceType !== "aluminum") return;
    if (String(selectedStyle?.name || "") !== "Mansfield") return;

    const isFive = (Number(materialsDetails.aluminumPanelHeight) || 0) === 60;
    setMaterialsDetails((p) => {
      const nextWalk = (p.mansfieldWalkGateOptions || []).map((v) => {
        const s = String(v);
        const n = s === "walk_48_5_arched" ? "walk_48_5" : s === "walk_60_5_arched" ? "walk_60_5" : s;
        if (isFive) {
          if (n === "walk_48_4") return "walk_48_5";
          if (n === "walk_60_4") return "walk_60_5";
        } else {
          if (n === "walk_48_5") return "walk_48_4";
          if (n === "walk_60_5") return "walk_60_4";
        }
        return n;
      });

      const nextDouble = (p.mansfieldDoubleGateOptions || []).map((v) => {
        const s = String(v);
        if (isFive) {
          if (s === "double_48_4") return "double_48_5";
          if (s === "double_60_4") return "double_60_5";
        } else {
          if (s === "double_48_5") return "double_48_4";
          if (s === "double_60_5") return "double_60_4";
        }
        return s;
      });

      const sameWalk = (p.mansfieldWalkGateOptions || []).length === nextWalk.length && nextWalk.every((v, i) => v === p.mansfieldWalkGateOptions?.[i]);
      const sameDouble = (p.mansfieldDoubleGateOptions || []).length === nextDouble.length && nextDouble.every((v, i) => v === p.mansfieldDoubleGateOptions?.[i]);
      if (sameWalk && sameDouble) return p;
      return { ...p, mansfieldWalkGateOptions: nextWalk, mansfieldDoubleGateOptions: nextDouble };
    });
  }, [materialsDetails.aluminumPanelHeight, selectedFenceType, selectedStyle?.name]);

  useEffect(() => {
    if (selectedFenceType !== "aluminum") return;
    if (String(selectedStyle?.name || "") !== "Pacific") return;

    const walkGates = Math.max(0, Number(activeCardWalkGates) || 0);
    const doubleGates = Math.max(0, Number(activeCardDoubleGates) || 0);

    setMaterialsDetails((p) => {
      const nextWalk = Array.from({ length: walkGates }, (_, i) => p.pacificWalkGateOptions?.[i] || "walk_48_45");
      const nextDouble = Array.from({ length: doubleGates }, (_, i) => p.pacificDoubleGateOptions?.[i] || "double_48_45");
      const walkSame = (p.pacificWalkGateOptions?.length || 0) === nextWalk.length && nextWalk.every((v, i) => v === p.pacificWalkGateOptions?.[i]);
      const doubleSame = (p.pacificDoubleGateOptions?.length || 0) === nextDouble.length && nextDouble.every((v, i) => v === p.pacificDoubleGateOptions?.[i]);
      if (walkSame && doubleSame) return p;
      return {
        ...p,
        pacificWalkGateOptions: nextWalk,
        pacificDoubleGateOptions: nextDouble
      };
    });
  }, [activeCardDoubleGates, activeCardWalkGates, selectedFenceType, selectedStyle?.name]);

  useEffect(() => {
    if (selectedFenceType !== "aluminum") return;
    if (String(selectedStyle?.name || "") !== "Atlantic") return;

    const walkGates = Math.max(0, Number(activeCardWalkGates) || 0);
    const doubleGates = Math.max(0, Number(activeCardDoubleGates) || 0);

    setMaterialsDetails((p) => {
      const nextWalk = Array.from({ length: walkGates }, (_, i) => p.atlanticWalkGateOptions?.[i] || "walk_48_4");
      const nextDouble = Array.from({ length: doubleGates }, (_, i) => {
        const cur = p.atlanticDoubleGateOptions?.[i] || "double_60_4";
        return cur === "double_60_4_arched" ? "double_60_4" : cur;
      });
      const walkSame = (p.atlanticWalkGateOptions?.length || 0) === nextWalk.length && nextWalk.every((v, i) => v === p.atlanticWalkGateOptions?.[i]);
      const doubleSame = (p.atlanticDoubleGateOptions?.length || 0) === nextDouble.length && nextDouble.every((v, i) => v === p.atlanticDoubleGateOptions?.[i]);
      if (walkSame && doubleSame) return p;
      return {
        ...p,
        atlanticWalkGateOptions: nextWalk,
        atlanticDoubleGateOptions: nextDouble
      };
    });
  }, [activeCardDoubleGates, activeCardWalkGates, selectedFenceType, selectedStyle?.name]);

  useEffect(() => {
    if (selectedFenceType !== "aluminum") return;
    if (String(selectedStyle?.name || "") !== "Toledo") return;

    const walkGates = Math.max(0, Number(activeCardWalkGates) || 0);
    const doubleGates = Math.max(0, Number(activeCardDoubleGates) || 0);
    setMaterialsDetails((p) => {
      const defaultWalk = (Number(p.aluminumPanelHeight) || 0) === 60 ? "walk_48_5" : "walk_48_4";
      const nextWalk = Array.from({ length: walkGates }, (_, i) => {
        const cur = p.toledoWalkGateOptions?.[i] || defaultWalk;
        if (cur === "walk_48_5_arched") return "walk_48_5";
        if (cur === "walk_60_5_arched") return "walk_60_5";
        return cur;
      });
      const defaultDouble = (Number(p.aluminumPanelHeight) || 0) === 60 ? "double_48_5" : "double_48_4";
      const nextDouble = Array.from({ length: doubleGates }, (_, i) => {
        const cur = p.toledoDoubleGateOptions?.[i] || defaultDouble;
        if (cur === "double_60_4_arched") return "double_60_4";
        if (cur === "double_60_5_arched") return "double_60_5";
        return cur;
      });
      const sameWalk = (p.toledoWalkGateOptions?.length || 0) === nextWalk.length && nextWalk.every((v, i) => v === p.toledoWalkGateOptions?.[i]);
      const sameDouble = (p.toledoDoubleGateOptions?.length || 0) === nextDouble.length && nextDouble.every((v, i) => v === p.toledoDoubleGateOptions?.[i]);
      if (sameWalk && sameDouble) return p;
      return {
        ...p,
        toledoWalkGateOptions: nextWalk,
        toledoDoubleGateOptions: nextDouble
      };
    });
  }, [effectiveDoubleGateCount, segments, selectedFenceType, selectedStyle?.name]);

  useEffect(() => {
    if (selectedFenceType !== "aluminum") return;
    const allowed = aluminumAllowedPanelHeights;
    if (!allowed.length) return;
    const cur = Number(materialsDetails.aluminumPanelHeight) || 0;
    if (allowed.includes(cur)) return;
    const next = allowed[0];
    if (next === cur) return;
    setMaterialsDetails((p) => ({ ...p, aluminumPanelHeight: next }));
  }, [aluminumAllowedPanelHeights, materialsDetails.aluminumPanelHeight, selectedFenceType]);

  useEffect(() => {
    if (selectedStyleKind !== "wood_scalloped") return;

    const heightFt = Math.max(4, Math.min(6, Math.floor(Number(materialsDetails.vinylPanelHeightFt) || 6)));
    const desiredPostSize = heightFt >= 6 ? 10 : 8;
    if (materialsDetails.postSize === desiredPostSize) return;

    setMaterialsDetails((p) => ({ ...p, postSize: desiredPostSize }));
  }, [materialsDetails.postSize, materialsDetails.vinylPanelHeightFt, selectedStyleKind]);

  useEffect(() => {
    if (!useHorizontalCedarTakeoff) return;

    const heightFt = Math.max(4, Math.min(6, Math.floor(Number(materialsDetails.vinylPanelHeightFt) || 6)));
    const desiredPostSize = heightFt >= 6 ? 10 : 8;
    if (materialsDetails.postSize === desiredPostSize) return;

    setMaterialsDetails((p) => ({ ...p, postSize: desiredPostSize }));
  }, [materialsDetails.postSize, materialsDetails.vinylPanelHeightFt, useHorizontalCedarTakeoff]);

  const [materialUnitPrices, setMaterialUnitPrices] = useState<Record<string, number>>({
    "4x4 x 8' Post": 11.28,
    "4x4 x 10' Post": 16.88,
    "4x4 x 8' Cedar S4S Post": 45.99,
    "4x4 x 10' Cedar S4S Post": 57.59,
    "6x6 x 8' Cedar S4S Post": 145.99,
    "6x6 x 10' Cedar S4S Post": 166.79,
    "6' Pressure Treated Dog Ear Pickets": 2.38,
    "6' Rough Sawn Cedar Dog Ear Pickets 5/8": 4.78,
    "6' Rough Sawn Cedar Dog Ear Pickets 3/4": 5.95,
    "2x4 8' Cedar S4S Rails": 14.99,
    "2x4 8' Rough Sawn Cedar Rails": 14.99,
    "2x4 16' Cedar S4S Rails": 29.99,
    "2x4 16' Rough Sawn Cedar Rails": 29.99,
    "2x4 16' Pressure Treated Rails": 13.78,
    "5/4x6x12 Pressure Treated Boards": 10.59,
    "1x6x12 Pressure Treated Boards": 8.58,
    "5/4x6x12 Cedar S4S Rails": 29.79,
    "5/4x6x12 CedarTone Rails": 17.69,
    "Concrete 60lb Bag": 0,
    "1x4 Cedar Boards": 9.98,
    "1x4 x 8' Trim": 0,
    "1x4 x 8' Cedar Trim": 0,
    "1x4 x 8' CedarTone Trim": 0,
    "1x4 x 8' Rough Sawn Cedar Trim": 9.98,
    "3\" Deck Screws": 29.97,
    "Delivery": 150,
    "Disposal": 150,
    "Equipment Fees": 400,
    "Mansfield aluminum panel 6ft (4')": 99.99,
    "Mansfield line post (4')": 34.99,
    "Mansfield corner post (4')": 34.99,
    "Mansfield end post (4')": 34.99,
    "Mansfield gate post (4')": 65.99,
    "Mansfield blank post (4')": 34.99,
    "Mansfield blank gate post add-on (4')": 65.99,
    "Mansfield walk gate 48\" x 4'": 399.99,
    "Mansfield walk gate 60\" x 4'": 445.0,
    "Mansfield double gate 48\" x 4'": 795.0,
    "Mansfield double gate 60\" x 4'": 859.9,
    "Mansfield aluminum panel 6ft (5')": 119.99,
    "Mansfield line post (5')": 39.99,
    "Mansfield corner post (5')": 39.99,
    "Mansfield end post (5')": 39.99,
    "Mansfield gate post (5')": 75.0,
    "Mansfield blank post (5')": 39.99,
    "Mansfield blank gate post add-on (5')": 74.99,
    "Mansfield walk gate 48\" x 5'": 429.99,
    "Mansfield walk gate 60\" x 5'": 459.99,
    "Mansfield double gate 48\" x 5'": 859.99,
    "Mansfield double gate 60\" x 5'": 899.99,
    "Atlantic aluminum panel 6ft (4')": 124.99,
    "Atlantic line post (4')": 34.99,
    "Atlantic corner post (4')": 34.99,
    "Atlantic end post (4')": 34.99,
    "Atlantic gate post (4')": 65.99,
    "Atlantic blank post (4')": 34.99,
    "Atlantic blank gate post add-on (4')": 65.99,
    "Atlantic walk gate 48\" x 4'": 429.99,
    "Atlantic walk gate 60\" x 4'": 459.99,
    "Atlantic double gate 48\" x 4'": 859.99,
    "Atlantic double gate 60\" x 4'": 909.5,
    "Pacific aluminum panel 6ft (4.5')": 119.99,
    "Pacific line post (4.5')": 39.99,
    "Pacific corner post (4.5')": 39.99,
    "Pacific end post (4.5')": 39.99,
    "Pacific gate post (4.5')": 75.0,
    "Pacific blank post (4.5')": 39.99,
    "Pacific blank gate post add-on (4.5')": 49.99,
    "Pacific walk gate 48\" x 4.5'": 429.99,
    "Pacific walk gate 60\" x 4.5'": 459.99,
    "Pacific double gate 48\" x 4.5'": 859.99,
    "Pacific double gate 60\" x 4.5'": 899.99,
    "Toledo aluminum panel 6ft (4')": 105.99,
    "Toledo line post (4')": 34.99,
    "Toledo corner post (4')": 34.99,
    "Toledo end post (4')": 34.99,
    "Toledo gate post (4')": 65.99,
    "Toledo blank post (4')": 34.99,
    "Toledo blank gate post add-on (4')": 65.99,
    "Toledo walk gate 48\" x 4'": 399.99,
    "Toledo walk gate 60\" x 4'": 445.0,
    "Toledo double gate 48\" x 4'": 785.0,
    "Toledo double gate 60\" x 4'": 859.9,
    "Toledo aluminum panel 6ft (5')": 124.99,
    "Toledo line post (5')": 39.99,
    "Toledo corner post (5')": 39.99,
    "Toledo end post (5')": 39.99,
    "Toledo gate post (5')": 75.0,
    "Toledo blank post (5')": 39.99,
    "Toledo blank gate post add-on (5')": 75.0,
    "Toledo walk gate 48\" x 5'": 429.99,
    "Toledo walk gate 60\" x 5'": 459.99,
    "Toledo double gate 48\" x 5'": 859.99,
    "Toledo double gate 60\" x 5'": 899.99,
    "Terrier aluminum panel 6ft (4')": 169.99,
    "Terrier line post (4')": 34.99,
    "Terrier corner post (4')": 34.99,
    "Terrier end post (4')": 34.99,
    "Terrier gate post (4')": 65.99,
    "Terrier blank post (4')": 34.99,
    "Terrier blank gate post add-on (4')": 65.99,
    "Terrier walk gate 48\" x 4'": 386.99,
    "Terrier double gate 48\" x 4'": 809.99
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    fetch("/aluminum_pricing_form.csv")
      .then((r) => (r.ok ? r.text() : ""))
      .then((raw) => {
        if (!raw || cancelled) return;
        const lines = raw
          .split(/\r?\n/)
          .map((l) => String(l || "").trim())
          .filter((l) => Boolean(l));
        const headerIdx = lines.findIndex((l) => l.toLowerCase() === "key,description,unit,price_usd");
        const start = headerIdx >= 0 ? headerIdx + 1 : 0;
        const patch: Record<string, number> = {};
        for (const line of lines.slice(start)) {
          const cols = parseCsvLine(line);
          const k = String(cols[0] || "").trim();
          const price = Number(String(cols[3] || "").trim());
          if (!k) continue;
          if (!Number.isFinite(price)) continue;
          patch[k] = price;
        }
        if (!Object.keys(patch).length) return;
        setMaterialUnitPrices((prev) => ({ ...prev, ...patch }));
      })
      .catch(() => {
        // ignore
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    fetch("/wood_unit_prices.csv")
      .then((r) => (r.ok ? r.text() : ""))
      .then((raw) => {
        if (!raw || cancelled) return;
        const lines = raw
          .split(/\r?\n/)
          .map((l) => String(l || "").trim())
          .filter((l) => Boolean(l));
        const headerIdx = lines.findIndex((l) => l.toLowerCase() === "item_name,unit_price");
        const start = headerIdx >= 0 ? headerIdx + 1 : 0;
        const patch: Record<string, number> = {};
        for (const line of lines.slice(start)) {
          const [itemRaw, priceRaw] = parseCsvLine(line);
          const exactName = String(itemRaw || "").trim();
          const name = normalizeUnitPriceKey(itemRaw);
          const price = Number(String(priceRaw || "").trim());
          if (!name && !exactName) continue;
          if (!Number.isFinite(price)) continue;
          if (exactName) patch[exactName] = price;
          if (name) patch[name] = price;
        }
        if (Object.keys(patch).length <= 0) return;
        setMaterialUnitPrices((prev) => ({ ...prev, ...patch }));
      })
      .catch(() => {
        // ignore
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function generateMaterialsForContext(ctx: {
    selectedStyle: { name: string; thumb: string } | null;
    selectedFenceType: "wood" | "vinyl" | "aluminum" | "chainlink";
    vinylStyleTab: "privacy" | "semi-privacy" | "pool" | "picket" | "horse";
    materialsDetails: MaterialsDetails;
    extraPosts: number;
    segments: typeof segments;
  }) {
    const selectedStyle = ctx.selectedStyle;
    const selectedFenceType = ctx.selectedFenceType;
    const vinylStyleTab = ctx.vinylStyleTab;
    const materialsDetails = ctx.materialsDetails;
    const extraPosts = ctx.extraPosts;
    const segments = ctx.segments;

    const totalLf = segments
      .filter((s) => !s.removed)
      .reduce((sum, s) => sum + (Number(s.length) || 0), 0);

    const walkGateCount = Math.max(
      0,
      segments
        .filter((s) => !s.removed)
        .filter((s) => (s as any).gateType === "walk" || ((s as any).gateType == null && Boolean((s as any).gate)))
        .length
    );
    const doubleGateCount = Math.max(
      0,
      segments
        .filter((s) => !s.removed)
        .filter((s) => (s as any).gateType === "double")
        .length
    );

    const selectedStyleKind = (() => {
      const nRaw = String(selectedStyle?.name || "");
      const n = nRaw
        .trim()
        .toLowerCase()
        .replaceAll("/", ":")
        .replaceAll("-", " ")
        .replace(/\s+/g, " ");

      if (n === "standard privacy" || n === "standard") return "wood_standard";
      if (n === "horizontal cedar" || n === "horizontal") return "wood_horizontal";
      if (n === "niko" || n === "all cedar niko") return "wood_niko";
      if (n === "casto") return "wood_casto";
      if (n === "a & m") return "wood_am";
      if (n === "4' picture framed") return "wood_picture_framed_4ft";
      if (n === "picture framed lattice panel") return "wood_picture_framed_lattice";
      if (n === "picture framed" || n.startsWith("picture framed") || n.includes("picture framed")) return "wood_picture_framed";
      if (n === "mary jane") return "wood_picture_framed";
      if (n === "picture framed caps") return "wood_picture_framed";
      if (n === "hog wire" || n === "hog-wire" || n.includes("hog wire") || n.includes("hog-wire")) return "wood_hog_wire";
      if ((n.includes("4 rail") || n.includes("four rail")) && n.includes("wire") && n.includes("mesh")) return "wood_4_rail_wire_mesh";
      if (n === "4 rail wire mesh" || n.includes("4 rail wire mesh")) return "wood_4_rail_wire_mesh";
      if (n === "3 rail w/ wire mesh" || n.includes("wire mesh") || n.includes("hog-wire") || n.includes("hog wire") || n.includes("mesh")) return "wood_wire_mesh";
      if (n === "split rail" || n.includes("split rail")) return "wood_split_rail";
      if (n === "shadowbox top cap" || n.includes("shadowbox top cap")) return "wood_shadowbox_top_cap";
      if (n === "1x4 shadowbox" || n.includes("1x4 shadowbox")) return "wood_shadowbox";
      if (n === "shadowbox") return "wood_shadowbox_pickets";
      if (n.includes("shadowbox")) return "wood_shadowbox_pickets";
      if (n === "basket weve" || n === "basket weave" || n.includes("basket weve") || n.includes("basket weave")) return "wood_basket_weave";
      if (n === "board on board" || n.includes("board on board") || n.includes("board-on-board")) return "wood_board_on_board";
      if (n === "scalloped" || n.includes("scalloped")) return "wood_scalloped";
      return n;
    })();

    const aluminumPostsSummary = (() => {
      if (selectedFenceType !== "aluminum") {
        return { total: 0, line: 0, corner: 0, end: 0, gate: 0, blank: 0, gateDerived: 0 };
      }

      const segmentLengths = segments
        .filter((s) => !s.removed)
        .map((s) => Number(s.length) || 0)
        .filter((n) => n > 0);
      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 6), 0)
        : (totalLf > 0 ? Math.ceil(totalLf / 6) : 0);
      const postsBase = panels > 0 ? panels + 1 : 0;

      const walkGates = walkGateCount;
      const doubleGates = doubleGateCount;
      const gateDerived = (walkGates + doubleGates) * 2;

      const corner = Math.max(0, Math.floor(Number(materialsDetails.aluminumCornerPosts) || 0));
      const end = Math.max(0, Math.floor(Number(materialsDetails.aluminumEndPosts) || 0));
      const blank = Math.max(0, Math.floor(Number(materialsDetails.aluminumBlankPosts) || 0));

      const gate = materialsDetails.aluminumGateAuto
        ? gateDerived
        : Math.max(0, Math.floor(Number(materialsDetails.aluminumGatePosts) || 0));

      const total = Math.max(0, postsBase + gateDerived + (Number(extraPosts) || 0));
      const line = Math.max(0, total - (corner + gate + end + blank));
      return { total, line, corner, end, gate, blank, gateDerived };
    })();

    const vinylSummary = (() => {
      if (selectedFenceType !== "vinyl") {
        return { panels: 0, posts: 0 };
      }

      const segmentLengths = segments
        .filter((s) => !s.removed)
        .map((s) => Number(s.length) || 0)
        .filter((n) => n > 0);
      const lf = totalLf;
      const panelWidth = Number(materialsDetails.vinylPanelWidthFt) || 6;
      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / panelWidth), 0)
        : (lf > 0 ? Math.ceil(lf / panelWidth) : 0);
      const postsBase = panels > 0 ? panels + 1 : 0;
      const gatePostsAdd = walkGateCount * 2;
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));
      return { panels, posts };
    })();

    if (!selectedStyle) return [] as QuoteItem[];

    const walkGates = Number(walkGateCount) || 0;
    const doubleGates = Number(doubleGateCount) || 0;

    const walkGatePostsAdd = segments
      .filter((s) => (s as any).gateType === "walk" || ((s as any).gateType == null && Boolean((s as any).gate)))
      .reduce((sum, s) => {
        const len = Number((s as any).length) || 0;
        return sum + (len > 0 && len < 8 ? 2 : 1);
      }, 0);

    const gatePostsAdd = walkGatePostsAdd + doubleGates;
    const gateHingeKitsAdd = walkGates * 1;
    const doubleGateKitsAdd = doubleGates;
    const gateFramingAdd = walkGates * 5 + doubleGates * 10;

    if (selectedStyleKind === "wood_wire_mesh") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const extraPostsQty = Math.max(0, Math.floor(Number(extraPosts) || 0));
      const extraPostSizeSafe = ([8, 10, 12, 14] as const).includes(extraPostSize as any) ? (extraPostSize as 8 | 10 | 12 | 14) : 10;
      const segmentLengths = segments
        .filter((s) => !s.removed)
        .map((s) => Number(s.length) || 0)
        .filter((n) => n > 0);

      const normalizedWireMeshStyle = String(selectedStyle?.name || "")
        .trim()
        .toLowerCase()
        .replaceAll("/", ":")
        .replaceAll("-", " ")
        .replace(/\s+/g, " ");
      const isFiveQuarterTwoRailMesh = normalizedWireMeshStyle === "5:4 2 rail mesh";

      if (isFiveQuarterTwoRailMesh) {
        // 7.5' centers.
        const postsBase = segmentLengths.length
          ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0) + 1
          : (lf > 0 ? Math.max(2, Math.ceil(lf / 7.5) + 1) : 0);
        const postsFence = Math.max(0, postsBase + gatePostsAdd);
        const posts = postsFence;

        const panels = segmentLengths.length
          ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0)
          : (lf > 0 ? Math.ceil(lf / 7.5) : 0);

        const cornerCount = materialsDetails.fiveQuarterTwoRailMeshCorners
          ? Math.max(0, segmentLengths.length - 1)
          : 0;

        // 5/4 rails: (segmentLength/15) * 3
        const rails5_4 = segmentLengths.length
          ? segmentLengths.reduce((sum, len) => sum + Math.ceil((len / 15) * 3), 0)
          : (lf > 0 ? Math.ceil((lf / 15) * 3) : 0);

        // Verticals: +1/3 board per post (toggle) + 1 per corner (toggle)
        const verticalBoards = materialsDetails.fiveQuarterTwoRailMeshVerticals && postsFence > 0
          ? Math.ceil(postsFence * (1 / 3))
          : 0;

        // Cedar S4S: 2x 2x4x8 per panel
        const cedarS4SRails2x4x8 = panels * 2;

        // Wire mesh: total lf / 50 rolls, round up
        const meshRolls = lf > 0 ? Math.ceil(lf / 50) : 0;

        // Screws: 6 per 5/4 board
        const screwCount = rails5_4 > 0 ? Math.ceil(rails5_4 * 6) : 0;
        const useStainlessScrews = isCedarLike(materialsDetails.railMaterial);
        const deckScrewBoxes = !useStainlessScrews && screwCount > 0 ? Math.ceil(screwCount / 350) : 0;

        // Staples: 10 per post
        const staples = postsFence > 0 ? Math.ceil(postsFence * 10) : 0;
        const staplesBoxes = staples > 0 ? Math.ceil(staples / 1000) : 0;

        const concrete80Bags = postsFence * 2;
        const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

        const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });
        const extraPostName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: extraPostSizeSafe, postType: materialsDetails.postType });

        const fiveQuarterRailName =
          materialsDetails.railMaterial === "Cedar tone"
            ? "5/4x6x12 CedarTone Rails"
            : isCedarLike(materialsDetails.railMaterial)
              ? "5/4x6x12 Cedar S4S Rails"
              : "5/4x6x12 Pressure Treated Boards";

        const fiveQuarterVerticalName = fiveQuarterRailName;

        const rail8Name = woodRail2x4Name(8, materialsDetails.railMaterial);
        const picketName = woodPicketName(materialsDetails.picketMaterial);

        const rows: Array<{ name: string; qty: number; unit: string }> = [
          { name: postName, qty: postsFence, unit: "ea" },
          ...(extraPostsQty > 0 ? [{ name: extraPostName, qty: extraPostsQty, unit: "ea" }] : []),
          ...(rails5_4 > 0 ? [{ name: fiveQuarterRailName, qty: rails5_4, unit: "ea" }] : []),
          ...(verticalBoards + cornerCount > 0 ? [{ name: fiveQuarterVerticalName, qty: verticalBoards + cornerCount, unit: "ea" }] : []),
          ...(cedarS4SRails2x4x8 > 0 ? [{ name: rail8Name, qty: cedarS4SRails2x4x8, unit: "ea" }] : []),
          ...(meshRolls > 0 ? [{ name: "Wire mesh roll", qty: meshRolls, unit: "ea" }] : []),
          ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
          ...(useStainlessScrews && screwCount > 0 ? [{ name: "Stainless screws", qty: screwCount, unit: "ea" }] : []),
          ...(deckScrewBoxes > 0 ? [{ name: "3\" Deck Screws", qty: deckScrewBoxes, unit: "box" }] : []),
          ...(staplesBoxes > 0 ? [{ name: "Staples", qty: staplesBoxes, unit: "box" }] : []),
          ...(materialsDetails.postCaps ? [{ name: "Post caps", qty: postsFence, unit: "ea" }] : []),
          ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
          ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
          ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
          ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
          { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
          { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
          { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
        ];

        const combinedRows = rows.reduce((acc, r) => {
          const key = `${canonicalMaterialsMergeKey(r.name)}__${r.unit}`;
          const prev = acc.get(key);
          if (prev) {
            prev.qty = (Number(prev.qty) || 0) + (Number(r.qty) || 0);
          } else {
            acc.set(key, { ...r });
          }
          return acc;
        }, new Map<string, { name: string; qty: number; unit: string }>());

        return Array.from(combinedRows.values())
          .filter((r) => (Number(r.qty) || 0) > 0)
          .map((r) => {
            const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
            const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
            return { section: "materials" as const, name: r.name, priceKey: (r as any).priceKey, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
          });
      }

      // 5.5' centers.
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 5.5), 0) + 1
        : (lf > 0 ? Math.max(2, Math.ceil(lf / 5.5) + 1) : 0);
      const postsFence = Math.max(0, postsBase + gatePostsAdd);

      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 5.5), 0)
        : (lf > 0 ? Math.ceil(lf / 5.5) : 0);

      const cornerDefault = Math.max(0, segmentLengths.length - 1);
      const cornerOverride = Number(materialsDetails.wireMeshCornerBoardsOverride);
      const cornerCount = Number.isFinite(cornerOverride) && cornerOverride >= 0 ? Math.floor(cornerOverride) : cornerDefault;

      // Boards: (segmentLength/12) * 4 + 1/3 board per post + 1 per corner
      const boardsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil((len / 12) * 4), 0)
        : (lf > 0 ? Math.ceil((lf / 12) * 4) : 0);

      const verticalDefault = postsFence > 0 ? Math.ceil(postsFence * (1 / 3)) : 0;
      const verticalOverride = Number(materialsDetails.wireMeshVerticalBoardsOverride);
      const verticalBoards = Number.isFinite(verticalOverride) && verticalOverride >= 0 ? Math.floor(verticalOverride) : verticalDefault;
      const boards = boardsBase + verticalBoards + cornerCount;

      // Wire mesh: total lf / 50 rolls, round up
      const meshRolls = lf > 0 ? Math.ceil(lf / 50) : 0;

      // Nails: one box per job (priced in wood_unit_prices.csv)
      const nailsBoxes = boards > 0 ? 1 : 0;
      const nailsName = "2\" Nails 2000ct Hot-Dipped Galvanized Ring Shank Nails";

      // Staples: 10 per post
      const staples = postsFence > 0 ? Math.ceil(postsFence * 10) : 0;
      const staplesBoxes = staples > 0 ? Math.ceil(staples / 1000) : 0;

      const concrete80Bags = postsFence * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });
      const extraPostName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: extraPostSizeSafe, postType: materialsDetails.postType });
      const rail8Name = woodRail2x4Name(8, materialsDetails.railMaterial);
      const rail16Name = woodRail2x4Name(16, materialsDetails.railMaterial);

      const boardsName = woodBoard1x6x12Name(materialsDetails.railMaterial);

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: postName, qty: postsFence, unit: "ea" },
        ...(extraPostsQty > 0 ? [{ name: extraPostName, qty: extraPostsQty, unit: "ea" }] : []),
        { name: boardsName, qty: boards, unit: "ea" },
        ...(meshRolls > 0 ? [{ name: "Wire mesh roll", qty: meshRolls, unit: "ea" }] : []),
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(nailsBoxes > 0 ? [{ name: nailsName, qty: nailsBoxes, unit: "box" }] : []),
        ...(staplesBoxes > 0 ? [{ name: "Staples", qty: staplesBoxes, unit: "box" }] : []),
        ...(materialsDetails.postCaps ? [{ name: "Post caps", qty: postsFence, unit: "ea" }] : []),
        ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, priceKey: (r as any).priceKey, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedStyleKind === "wood_shadowbox_top_cap") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const picketSpacingIn = 8;
      const segmentLengths = segments
        .filter((s) => !s.removed)
        .map((s) => Number(s.length) || 0)
        .filter((n) => n > 0);

      // 7.5' centers.
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0) + 1
        : (lf > 0 ? Math.max(2, Math.ceil(lf / 7.5) + 1) : 0);
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));

      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0)
        : (lf > 0 ? Math.ceil(lf / 7.5) : 0);

      const heightFt = Math.max(4, Math.min(6, Math.floor(Number(materialsDetails.vinylPanelHeightFt) || 6)));
      const rails2x4x8 = panels * (heightFt <= 4 ? 2 : 3);

      // 16' 2x4 rule
      const rails2x4x16 = segmentLengths.length ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 15), 0) : 0;

      // Pickets: (lf inches / 8) * 2
      const pickets = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(((len * 12) / picketSpacingIn) * 2), 0)
        : (lf > 0 ? Math.ceil(((lf * 12) / picketSpacingIn) * 2) : 0);

      const concrete80Bags = posts * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const nailsPerBox = woodNailsBoxQty(materialsDetails.picketMaterial);
      const nailsName = woodNailsItemName(materialsDetails.picketMaterial);
      const nailsBoxes = pickets > 0 ? Math.ceil((pickets * 6) / nailsPerBox) : 0;
      const screwBoxes = (rails2x4x8 + rails2x4x16) > 0 ? Math.ceil(((rails2x4x8 + rails2x4x16) * 6) / 350) : 0;

      const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });
      const rail8Name = woodRail2x4Name(8, materialsDetails.railMaterial);
      const rail16Name = woodRail2x4Name(16, materialsDetails.railMaterial);
      const picketName = woodPicketName(materialsDetails.picketMaterial);

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: postName, qty: posts, unit: "ea" },
        ...(rails2x4x8 > 0 ? [{ name: rail8Name, qty: rails2x4x8, unit: "ea" }] : []),
        ...(rails2x4x16 > 0 ? [{ name: rail16Name, qty: rails2x4x16, unit: "ea" }] : []),
        ...(pickets > 0 ? [{ name: picketName, qty: pickets, unit: "ea" }] : []),
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(nailsBoxes > 0 ? [{ name: nailsName, qty: nailsBoxes, unit: "box" }] : []),
        ...(screwBoxes > 0 ? [{ name: "3\" Deck Screws", qty: screwBoxes, unit: "box" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, priceKey: (r as any).priceKey, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedStyleKind === "wood_hog_wire") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const segmentLengths = segments.map((s) => Number(s.length) || 0).filter((n) => n > 0);

      // 7.5' centers.
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0) + 1
        : (lf > 0 ? Math.max(2, Math.ceil(lf / 7.5) + 1) : 0);
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));

      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0)
        : (lf > 0 ? Math.ceil(lf / 7.5) : 0);

      // 2x4x8 rails per panel (post caps adds 1)
      const rails2x4x8 = panels * (materialsDetails.postCaps ? 6 : 5);

      // Top cap rule: 2x4x16 adders
      const rails2x4x16 = materialsDetails.topCaps
        ? (segmentLengths.length ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 15), 0) : 0)
        : 0;

      // Cattle panel: 0.5 of a 16' panel per fence panel => ceil(panels/2)
      const cattlePanels = panels > 0 ? Math.ceil(panels / 2) : 0;

      // Screws: 8 per board (boards = all rail boards), sold by 350/box
      const screwsPerBox = 350;
      const screwBoxes = (rails2x4x8 + rails2x4x16) > 0
        ? Math.ceil(((rails2x4x8 + rails2x4x16) * 8) / screwsPerBox)
        : 0;
      const screwName = "Cattle panel screws (350ct box)";

      // Staples: 25 per panel
      const staples = panels > 0 ? Math.ceil(panels * 25) : 0;
      const staplesBoxes = staples > 0 ? Math.ceil(staples / 1000) : 0;

      const concrete80Bags = posts * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });
      const rail8Name = woodRail2x4Name(8, materialsDetails.railMaterial);
      const rail16Name = woodRail2x4Name(16, materialsDetails.railMaterial);

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: postName, qty: posts, unit: "ea" },
        ...(rails2x4x8 > 0 ? [{ name: rail8Name, qty: rails2x4x8, unit: "ea" }] : []),
        ...(rails2x4x16 > 0 ? [{ name: rail16Name, qty: rails2x4x16, unit: "ea" }] : []),
        ...(cattlePanels > 0 ? [{ name: "16' Cattle Panel", qty: cattlePanels, unit: "ea" }] : []),
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(screwBoxes > 0 ? [{ name: screwName, qty: screwBoxes, unit: "box" }] : []),
        ...(staplesBoxes > 0 ? [{ name: "Staples", qty: staplesBoxes, unit: "box" }] : []),
        ...(materialsDetails.postCaps ? [{ name: "Post caps", qty: posts, unit: "ea" }] : []),
        ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, priceKey: (r as any).priceKey, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedStyleKind === "wood_scalloped") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const picketSpacingIn = (materialsDetails.picketSpacingIn === 8 ? 8 : 5.5) as 5.5 | 8;
      const segmentLengths = segments.map((s) => Number(s.length) || 0).filter((n) => n > 0);

      // 7.5' centers.
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0) + 1
        : (lf > 0 ? Math.max(2, Math.ceil(lf / 7.5) + 1) : 0);
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));

      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0)
        : (lf > 0 ? Math.ceil(lf / 7.5) : 0);

      const heightFt = Math.max(4, Math.min(6, Math.floor(Number(materialsDetails.vinylPanelHeightFt) || 6)));
      const railsPerPanel = heightFt <= 4 ? 2 : 3;
      const rails2x4x8 = panels * railsPerPanel;

      // Pickets: ceil(totalLf * 12 / spacing) + 15 pickets per every 100ft
      const pickets = totalLf > 0 ? Math.ceil((totalLf * 12) / picketSpacingIn) + Math.floor(totalLf / 100) * 15 : 0;

      const concrete80Bags = posts * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const nailsPerBox = woodNailsBoxQty(materialsDetails.picketMaterial);
      const nailsName = woodNailsItemName(materialsDetails.picketMaterial);
      const nailsBoxes = pickets > 0 ? Math.ceil((pickets * 6) / nailsPerBox) : 0;

      // Screws: 6 per rail, 350 per box
      const screwBoxes = rails2x4x8 > 0 ? Math.ceil((rails2x4x8 * 6) / 350) : 0;

      const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });
      const rail8Name = woodRail2x4Name(8, materialsDetails.railMaterial);
      const picketName = woodPicketName(materialsDetails.picketMaterial);

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: postName, qty: posts, unit: "ea" },
        ...(rails2x4x8 > 0 ? [{ name: rail8Name, qty: rails2x4x8, unit: "ea" }] : []),
        { name: picketName, qty: pickets, unit: "ea" },
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(nailsBoxes > 0 ? [{ name: nailsName, qty: nailsBoxes, unit: "box" }] : []),
        ...(screwBoxes > 0 ? [{ name: "3\" Deck Screws", qty: screwBoxes, unit: "box" }] : []),
        ...(materialsDetails.postCaps ? [{ name: "Post caps", qty: posts, unit: "ea" }] : []),
        ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, priceKey: (r as any).priceKey, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedStyleKind === "wood_shadowbox") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const segmentLengths = segments.map((s) => Number(s.length) || 0).filter((n) => n > 0);

      // 7.5' centers.
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0) + 1
        : (lf > 0 ? Math.max(2, Math.ceil(lf / 7.5) + 1) : 0);
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));

      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0)
        : (lf > 0 ? Math.ceil(lf / 7.5) : 0);

      // Rails: sum(ceil(segment/7.5) * 3)
      const rails2x4x8 = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil((len / 7.5) * 3), 0)
        : (lf > 0 ? Math.ceil((lf / 7.5) * 3) : 0);
      const rails2x4x16 = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 15), 0)
        : (lf > 0 ? Math.ceil(lf / 15) : 0);

      // 1x4 boards: ceil((segment inches / 7.5 inches) * 2)
      const shadowboxBoards = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(((len * 12) / 7) * 2), 0)
        : (lf > 0 ? Math.ceil(((lf * 12) / 7) * 2) : 0);

      const nailsMaterial = isCedarLike(materialsDetails.shadowboxBoardMaterial) ? ("Cedar" as const) : ("Pressure treated" as const);
      const nailsPerBox = woodNailsBoxQty(nailsMaterial);
      const nailsName = woodNailsItemName(nailsMaterial);
      const nailsBoxes = shadowboxBoards > 0 ? Math.ceil((shadowboxBoards * 6) / nailsPerBox) : 0;

      const screwsPerBox = 350;
      const screwBoxes = (rails2x4x8 + rails2x4x16) > 0
        ? Math.ceil(((rails2x4x8 + rails2x4x16) * 5) / screwsPerBox)
        : 0;

      const concrete80Bags = posts * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const boardName = isCedarLike(materialsDetails.shadowboxBoardMaterial)
        ? "1x4 Cedar Boards"
        : materialsDetails.shadowboxBoardMaterial === "Cedar tone"
          ? "1x4 CedarTone Boards"
          : "1x4 Pressure Treated Boards";

      const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });
      const rail8Name = woodRail2x4Name(8, materialsDetails.railMaterial);
      const rail16Name = woodRail2x4Name(16, materialsDetails.railMaterial);

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: postName, qty: posts, unit: "ea" },
        ...(rails2x4x8 > 0 ? [{ name: rail8Name, qty: rails2x4x8, unit: "ea" }] : []),
        ...(rails2x4x16 > 0 ? [{ name: rail16Name, qty: rails2x4x16, unit: "ea" }] : []),
        ...(shadowboxBoards > 0 ? [{ name: boardName, qty: shadowboxBoards, unit: "ea" }] : []),
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(nailsBoxes > 0 ? [{ name: nailsName, qty: nailsBoxes, unit: "box" }] : []),
        ...(screwBoxes > 0 ? [{ name: "3\" Deck Screws", qty: screwBoxes, unit: "box" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, priceKey: (r as any).priceKey, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedStyleKind === "wood_shadowbox_pickets") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const picketSpacingIn = 8;
      const segmentLengths = segments.map((s) => Number(s.length) || 0).filter((n) => n > 0);

      // 7.5' centers.
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0) + 1
        : (lf > 0 ? Math.max(2, Math.ceil(lf / 7.5) + 1) : 0);
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));

      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0)
        : (lf > 0 ? Math.ceil(lf / 7.5) : 0);

      // Rails: 3x 2x4x8 per panel + 2x4x16 at ceil(segmentLength/15)
      const rails2x4x8 = panels * 3;
      const rails2x4x16 = segmentLengths.length ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 15), 0) : 0;

      // Pickets: use the prior shadowbox math, but output as pickets (not 1x4 boards)
      const pickets = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(((len * 12) / picketSpacingIn) * 2), 0)
        : (lf > 0 ? Math.ceil(((lf * 12) / picketSpacingIn) * 2) : 0);

      const concrete80Bags = posts * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const nailsPerBox = woodNailsBoxQty(materialsDetails.picketMaterial);
      const nailsName = woodNailsItemName(materialsDetails.picketMaterial);
      const nailsBoxes = pickets > 0 ? Math.ceil((pickets * 6) / nailsPerBox) : 0;
      const screwBoxes = (rails2x4x8 + rails2x4x16) > 0 ? Math.ceil(((rails2x4x8 + rails2x4x16) * 6) / 350) : 0;

      const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: 10, postType: materialsDetails.postType });
      const rail8Name = woodRail2x4Name(8, materialsDetails.railMaterial);
      const rail16Name = woodRail2x4Name(16, materialsDetails.railMaterial);
      const picketName = woodPicketName(materialsDetails.picketMaterial);

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: postName, qty: posts, unit: "ea" },
        ...(rails2x4x8 > 0 ? [{ name: rail8Name, qty: rails2x4x8, unit: "ea" }] : []),
        ...(rails2x4x16 > 0 ? [{ name: rail16Name, qty: rails2x4x16, unit: "ea" }] : []),
        ...(pickets > 0 ? [{ name: picketName, qty: pickets, unit: "ea" }] : []),
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(nailsBoxes > 0 ? [{ name: nailsName, qty: nailsBoxes, unit: "box" }] : []),
        ...(screwBoxes > 0 ? [{ name: "3\" Deck Screws", qty: screwBoxes, unit: "box" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, priceKey: (r as any).priceKey, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedStyleKind === "wood_basket_weave") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const segmentLengths = segments.map((s) => Number(s.length) || 0).filter((n) => n > 0);

      // 7.5' centers.
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0) + 1
        : (lf > 0 ? Math.max(2, Math.ceil(lf / 7.5) + 1) : 0);
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));

      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0)
        : (lf > 0 ? Math.ceil(lf / 7.5) : 0);

      // Per-panel material rules
      const twoByTwo8 = panels * 3;
      const oneBySix8 = panels * 14;

      // Fasteners (screws): 6 per board, 350 per box
      const screwPieces = twoByTwo8 + oneBySix8;
      const screwBoxes = screwPieces > 0 ? Math.ceil((screwPieces * 6) / 350) : 0;

      const concrete80Bags = posts * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });

      const twoByTwoName = woodBoard2x2x8Name(materialsDetails.twoByTwoMaterial);
      const oneBySixName = woodBoard1x6x8Name(materialsDetails.railMaterial);

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: postName, qty: posts, unit: "ea" },
        ...(twoByTwo8 > 0 ? [{ name: twoByTwoName, qty: twoByTwo8, unit: "ea" }] : []),
        ...(oneBySix8 > 0 ? [{ name: oneBySixName, qty: oneBySix8, unit: "ea" }] : []),
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(screwBoxes > 0 ? [{ name: "3\" Deck Screws", qty: screwBoxes, unit: "box" }] : []),
        ...(materialsDetails.postCaps ? [{ name: "Post caps", qty: posts, unit: "ea" }] : []),
        ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedStyleKind === "wood_four_rail_poplar") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const segmentLengths = segments.map((s) => Number(s.length) || 0).filter((n) => n > 0);

      // 7.5' centers.
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0) + 1
        : (lf > 0 ? Math.max(2, Math.ceil(lf / 7.5) + 1) : 0);
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));

      const panels = segmentLengths.length
      const cornerCount = Math.max(0, segmentLengths.length - 1);

      // Rails: ceil((segment/15)*railCount)
      const railCount = materialsDetails.fourRailPoplarThreeRail ? 3 : 4;
      const railsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil((len / 15) * railCount), 0)
        : (lf > 0 ? Math.ceil((lf / 15) * railCount) : 0);

      // +5 for every 200'
      const railsWaste = lf > 0 ? Math.ceil(lf / 200) * 5 : 0;
      const rails = railsBase + railsWaste;

      // Verticles = 0.25 per post + 0.5 per corner
      const verticalAdders = posts > 0
        ? Math.ceil((posts * 0.25) + (cornerCount * 0.5))
        : 0;

      // Optional wire mesh
      const meshRolls = materialsDetails.fourRailPoplarWireMesh && lf > 0 ? Math.ceil(lf / 50) : 0;
      const staples = materialsDetails.fourRailPoplarWireMesh && posts > 0 ? Math.ceil(posts * 10) : 0;
      const staplesBoxes = staples > 0 ? Math.ceil(staples / 1000) : 0;

      const concrete80Bags = posts * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: postName, qty: posts, unit: "ea" },
        ...(rails > 0 ? [{ name: "1x6x16 Poplar Rails", qty: rails, unit: "ea" }] : []),
        ...(verticalAdders > 0 ? [{ name: "1x6x16 Poplar Verticals", qty: verticalAdders, unit: "ea" }] : []),
        ...(meshRolls > 0 ? [{ name: "Wire mesh roll", qty: meshRolls, unit: "ea" }] : []),
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(staplesBoxes > 0 ? [{ name: "Staples", qty: staplesBoxes, unit: "box" }] : []),
        ...(materialsDetails.fourRailPoplarPostCaps ? [{ name: "Post caps", qty: posts, unit: "ea" }] : []),
        ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedStyleKind === "wood_4_rail_wire_mesh") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const segmentLengths = segments.map((s) => Number(s.length) || 0).filter((n) => n > 0);

      // 5.5' centers.
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 5.5), 0) + 1
        : (lf > 0 ? Math.max(2, Math.ceil(lf / 5.5) + 1) : 0);
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));

      const cornerCount = Math.max(0, segmentLengths.length - 1);

      // Rails: ceil((segment/11) * railCount)
      const railCount = materialsDetails.fourRailWireMeshThreeRail ? 3 : 4;
      const railsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil((len / 11) * railCount), 0)
        : (lf > 0 ? Math.ceil((lf / 11) * railCount) : 0);

      // +5 for every 200'
      const railsWaste = lf > 0 ? Math.ceil(lf / 200) * 5 : 0;
      const rails = railsBase + railsWaste;

      // Verticles = 1/3 per post + 1 per corner
      const verticalAdders = posts > 0
        ? Math.ceil((posts * (1 / 3)) + (cornerCount * 1))
        : 0;

      const railBoardName = woodBoard1x6x12Name(materialsDetails.railMaterial);

      // Optional wire mesh
      const meshRolls = materialsDetails.fourRailWireMeshWireMesh && lf > 0 ? Math.ceil(lf / 50) : 0;
      const staples = materialsDetails.fourRailWireMeshWireMesh && posts > 0 ? Math.ceil(posts * 10) : 0;
      const staplesBoxes = staples > 0 ? Math.ceil(staples / 1000) : 0;

      const concrete80Bags = posts * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: postName, qty: posts, unit: "ea" },
        ...(rails > 0 ? [{ name: railBoardName, qty: rails, unit: "ea" }] : []),
        ...(verticalAdders > 0 ? [{ name: railBoardName, qty: verticalAdders, unit: "ea" }] : []),
        ...(meshRolls > 0 ? [{ name: "Wire mesh roll", qty: meshRolls, unit: "ea" }] : []),
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(staplesBoxes > 0 ? [{ name: "Staples", qty: staplesBoxes, unit: "box" }] : []),
        ...(materialsDetails.fourRailWireMeshPostCaps ? [{ name: "Post caps", qty: posts, unit: "ea" }] : []),
        ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedStyleKind === "wood_split_rail") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const segmentLengths = segments.map((s) => Number(s.length) || 0).filter((n) => n > 0);

      // 10' centers.
      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 10), 0)
        : (lf > 0 ? Math.ceil(lf / 10) : 0);
      const postsBase = panels > 0 ? panels + 1 : 0;
      const walkGates = Number(walkGateCount) || 0;
      const doubleGates = Number(doubleGateCount) || 0;
      const gatePostsDerived = (walkGates + doubleGates) * 2;
      const posts = Math.max(0, postsBase + gatePostsDerived + (Number(extraPosts) || 0));

      // Rails: ceil((segmentLength/10) * railCount)
      const railCount = materialsDetails.splitRailRails === 2 ? 2 : 3;
      const rails = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil((len / 10) * railCount), 0)
        : (lf > 0 ? Math.ceil((lf / 10) * railCount) : 0);

      // Optional wire mesh (same as wood wire mesh: rolls + staples).
      const meshRolls = materialsDetails.splitRailWireMesh && lf > 0 ? Math.ceil(lf / 50) : 0;
      const staples = materialsDetails.splitRailWireMesh && posts > 0 ? Math.ceil(posts * 10) : 0;
      const staplesBoxes = staples > 0 ? Math.ceil(staples / 1000) : 0;

      const concrete80Bags = posts * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const gateFramingS4S = walkGates * 5 + doubleGates * 10;
      const cedarPickets = walkGates * 10 + doubleGates * 20;

      const splitRailName = materialsDetails.splitRailMaterial === "Cedar tone" ? "Split rail (CedarTone)" : "Split rail";

      const splitRailLinePostName = materialsDetails.splitRailMaterial === "Cedar tone"
        ? (materialsDetails.splitRailRails === 2 ? "CedarTone split rail posts (2 rail)" : "CedarTone split rail line post (3 rail)")
        : "Split rail posts";
      const splitRailCornerPostName = materialsDetails.splitRailMaterial === "Cedar tone"
        ? "CedarTone split rail corner post (3 rail)"
        : "Split rail corner post";
      const splitRailEndPostName = materialsDetails.splitRailMaterial === "Cedar tone"
        ? "CedarTone split rail end post (3 rail)"
        : "Split rail end post";
      const splitRailGatePostName = materialsDetails.splitRailMaterial === "Cedar tone"
        ? "CedarTone split rail end post (3 rail)"
        : "Split rail end post";

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        ...(splitRailPostsSummary.line > 0 ? [{ name: splitRailLinePostName, qty: splitRailPostsSummary.line, unit: "ea" }] : []),
        ...(splitRailPostsSummary.corner > 0 ? [{ name: splitRailCornerPostName, qty: splitRailPostsSummary.corner, unit: "ea" }] : []),
        ...(splitRailPostsSummary.end > 0 ? [{ name: splitRailEndPostName, qty: splitRailPostsSummary.end, unit: "ea" }] : []),
        ...(splitRailPostsSummary.gateDerived > 0 ? [{ name: splitRailGatePostName, qty: splitRailPostsSummary.gateDerived, unit: "ea" }] : []),
        { name: splitRailName, qty: rails, unit: "ea" },
        ...(meshRolls > 0 ? [{ name: "Wire mesh roll", qty: meshRolls, unit: "ea" }] : []),
        ...(staplesBoxes > 0 ? [{ name: "Staples", qty: staplesBoxes, unit: "box" }] : []),
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(gateFramingS4S > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingS4S, unit: "ea" } as any] : []),
        ...(cedarPickets > 0 ? [{ name: "Cedar pickets", qty: cedarPickets, unit: "ea" }] : []),
        ...(materialsDetails.postCaps ? [{ name: "Post caps", qty: posts, unit: "ea" }] : []),
        ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (
      selectedStyleKind === "wood_standard" ||
      selectedStyleKind === "wood_picture_framed" ||
      selectedStyleKind === "wood_am" ||
      selectedStyleKind === "wood_niko" ||
      selectedStyleKind === "wood_casto" ||
      selectedStyleKind === "wood_picture_framed_4ft" ||
      selectedStyleKind === "wood_picture_framed_lattice" ||
      selectedStyleKind === "wood_horizontal" ||
      selectedStyleKind === "wood_board_on_board"
    ) {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);

      const normalizedWoodStyle = String(selectedStyle?.name || "")
        .trim()
        .toLowerCase();
      const isBoardOnBoard =
        selectedStyleKind === "wood_board_on_board" ||
        normalizedWoodStyle === "board on board" ||
        normalizedWoodStyle.includes("board on board") ||
        normalizedWoodStyle.includes("board-on-board");

      const isNikoStyleName = normalizedWoodStyle === "niko" || normalizedWoodStyle.includes("niko");
      const isCastoStyleName = normalizedWoodStyle === "casto" || normalizedWoodStyle.includes("casto");

      const useHorizontalCedarTakeoff =
        (selectedStyleKind === "wood_standard" && materialsDetails.takeoffPreset === "horizontal_cedar") ||
        selectedStyleKind === "wood_horizontal";

      if (useHorizontalCedarTakeoff) {
        const lf = Number(totalLf) || 0;
        const extraPostsQty = Math.max(0, Math.floor(Number(extraPosts) || 0));
        const extraPostSizeSafe = ([8, 10, 12, 14] as const).includes(extraPostSize as any) ? (extraPostSize as 8 | 10 | 12 | 14) : 10;
        const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });
        const extraPostName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: extraPostSizeSafe, postType: materialsDetails.postType });
        const boardProfile = materialsDetails.horizontalCedarBoardProfile === "1x6" ? "1x6" : "5/4";
        const woodType = (materialsDetails.woodType || "Pressure treated") as "Pressure treated" | "Cedar" | "Rough sawn cedar" | "Cedar tone";
        const boardName =
          boardProfile === "1x6"
            ? (woodType === "Pressure treated"
              ? "1x6x12 Pressure Treated Boards"
              : woodType === "Cedar tone"
                ? "1x6x12 CedarTone Boards"
                : "1x6x12 Cedar Boards")
            : (woodType === "Pressure treated"
              ? "5/4x6x12 Pressure Treated Boards"
              : woodType === "Cedar tone"
                ? "5/4x6x12 CedarTone Rails"
                : "5/4x6x12 Cedar S4S Rails");

        const segmentLengths = segments
          .filter((s) => !s.removed)
          .map((s) => Number(s.length) || 0)
          .filter((n) => n > 0);

        // Posts: same as Standard Privacy, but 5.5' spacing.
        // Sum ceil(segment/5.5) + 1 (first post) for base line.
        const postsBase = segmentLengths.length
          ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 5.5), 0) + 1
          : (lf > 0 ? Math.max(2, Math.ceil(lf / 5.5) + 1) : 0);
        const postsFence = Math.max(0, postsBase + gatePostsAdd);

        const panels = segmentLengths.length
          ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 5.5), 0)
          : (lf > 0 ? Math.ceil(lf / 5.5) : 0);
        const cornerCount = Math.max(0, Math.floor(Number(materialsDetails.horizontalCedarCornerAdjust) || 0));

        const heightFt = Math.max(4, Math.min(6, Math.floor(Number(materialsDetails.vinylPanelHeightFt) || 6)));
        const boardsPerPanel = heightFt >= 6 ? 13 : heightFt === 5 ? 11 : 9;

        const baseBoards = panels > 0 ? (panels / 2) * boardsPerPanel : 0;
        const includeVerticals = Boolean(materialsDetails.horizontalCedarVerticals);
        const verticalBoards = includeVerticals && postsFence > 0 ? postsFence * 0.5 : 0;
        const spineBoards = panels > 0 ? panels * 0.25 : 0;
        const cornerBoards = cornerCount;
        const extraBoards = Math.max(0, Math.floor(Number(materialsDetails.horizontalCedarExtraBoards) || 0));
        const boardsBase = Math.ceil(baseBoards + verticalBoards + spineBoards + cornerBoards) + extraBoards;
        const topCapBoards = materialsDetails.topCaps && panels > 0 ? Math.ceil(panels / 2) : 0;
        const boards = boardsBase + topCapBoards;

        // Keep these proportional to the reference sheet (274 LF):
        const screwCount = lf > 0 ? Math.ceil(lf * (50 / 274)) : 0;
        const useStainlessScrews =
          materialsDetails.horizontalCedarBoardMaterial === "5/4 cedar" ||
          materialsDetails.horizontalCedarBoardMaterial === "1x6 cedar";
        const deckScrewBoxes = !useStainlessScrews && screwCount > 0 ? Math.ceil(screwCount / 350) : 0;
        const concrete80Bags = postsFence * 2;
        const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;
        const gateFramingS4S = walkGates * 5 + doubleGates * 10;

        const rows: Array<{ name: string; qty: number; unit: string }> = [
          { name: postName, qty: postsFence, unit: "ea" },
          ...(extraPostsQty > 0 ? [{ name: extraPostName, qty: extraPostsQty, unit: "ea" }] : []),
          { name: boardName, qty: boards, unit: "ea" },
          ...(useStainlessScrews && screwCount > 0 ? [{ name: "3\" screws 60 ct stainless steel", qty: screwCount, unit: "ea" }] : []),
          ...(deckScrewBoxes > 0 ? [{ name: "3\" Deck Screws", qty: deckScrewBoxes, unit: "box" }] : []),
          ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
          ...(gateFramingS4S > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingS4S, unit: "ea" } as any] : []),
          ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
          ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
          ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
          { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
          { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
          { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
        ];

        return rows
          .filter((r) => (Number(r.qty) || 0) > 0)
          .map((r) => {
            const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
            const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
            return { section: "materials" as const, name: r.name, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
          });
      }

      const segmentLengths = segments.map((s) => Number(s.length) || 0).filter((n) => n > 0);

      const isPictureFramedFamily =
        selectedStyleKind === "wood_picture_framed" ||
        selectedStyleKind === "wood_am" ||
        selectedStyleKind === "wood_niko" ||
        selectedStyleKind === "wood_casto" ||
        selectedStyleKind === "wood_picture_framed_4ft" ||
        selectedStyleKind === "wood_picture_framed_lattice";
      const isNiko = selectedStyleKind === "wood_niko";
      const isCasto = selectedStyleKind === "wood_casto";
      const isAm = selectedStyleKind === "wood_am";
      const isFourFootPictureFramedKind = selectedStyleKind === "wood_picture_framed_4ft";
      const isPictureFramedLattice = selectedStyleKind === "wood_picture_framed_lattice";

      const isPictureFramed = isPictureFramedFamily;
      const isFourFootPictureFramed = String(selectedStyle?.name || "").trim().toLowerCase() === "4' picture framed";

      const picketSpacingIn = (materialsDetails.picketSpacingIn === 8 ? 8 : 5.5) as 5.5 | 8;

      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0)
        : (totalLf > 0 ? Math.ceil(totalLf / 7.5) : 0);

      const extraPostsQty = Math.max(0, Math.floor(Number(extraPosts) || 0));
      const extraPostSizeSafe = ([8, 10, 12, 14] as const).includes(extraPostSize as any) ? (extraPostSize as 8 | 10 | 12 | 14) : 10;

      // Posts = ceil(segment/7.5) for each segment + 1 for first segment
      const postsBase = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 7.5), 0) + 1
        : (totalLf > 0 ? Math.max(2, Math.ceil(totalLf / 7.5) + 1) : 0);
      const postsFence = Math.max(0, postsBase + gatePostsAdd);

      // Rails for picture-framed family styles (7.5' centers) are style-specific.
      // Assumption from you: styles will have either topCaps OR postCaps on.
      const pictureFramedRailsPerSection = (isFourFootPictureFramedKind
        ? (materialsDetails.postCaps ? 3 : 2)
        : (isNiko
            ? (materialsDetails.postCaps ? 5 : 4)
            : (isAm
                ? (materialsDetails.postCaps ? 4 : 3)
                : (isPictureFramedLattice
                    ? (materialsDetails.postCaps ? 5 : 4)
                    : (materialsDetails.postCaps ? 4 : 3)))));

      const rails = isPictureFramed
        ? (segmentLengths.length
            ? segmentLengths.reduce((sum, len) => sum + (Math.ceil(len / 7.5) * pictureFramedRailsPerSection), 0)
            : (totalLf > 0 ? panels * pictureFramedRailsPerSection : 0))
        : (segmentLengths.length
            ? segmentLengths.reduce((sum, len) => sum + Math.ceil((len / 15) * 3), 0)
            : (totalLf > 0 ? Math.ceil((totalLf / 15) * 3) : 0));

      const pictureFramed2x4x8 = isPictureFramed ? rails : 0;
      const pictureFramed2x4x16 =
        (isPictureFramed && Boolean(materialsDetails.topCaps))
          ? (segmentLengths.length
              ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / 15), 0)
              : (totalLf > 0 ? Math.ceil(totalLf / 15) : 0))
          : 0;

      // Pickets
      // Standard: ceil(totalLf * 12 / spacing) + 15 pickets per every 100ft
      // Board-on-board: sum( ceil((segment inches / 8) * 2) )
      const pickets = isBoardOnBoard
        ? (segmentLengths.length
            ? segmentLengths.reduce((sum, len) => sum + Math.ceil(((len * 12) / 8) * 2), 0)
            : (totalLf > 0 ? Math.ceil(((totalLf * 12) / 8) * 2) : 0))
        : (totalLf > 0 ? Math.ceil((totalLf * 12) / picketSpacingIn) + Math.floor(totalLf / 100) * 15 : 0);

      const concrete80Bags = postsFence * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const nailsPerBox = woodNailsBoxQty(materialsDetails.picketMaterial);
      const nailsName = woodNailsItemName(materialsDetails.picketMaterial);
      const nailsBoxes = pickets > 0 ? Math.ceil((pickets * 6) / nailsPerBox) : 0;

      const picketName = woodPicketName(materialsDetails.picketMaterial);

      const trimMaterialFinal = isPictureFramed
        ? (materialsDetails.pictureFrameTrimMaterial || materialsDetails.trimMaterial)
        : materialsDetails.trimMaterial;
      const trimNameFinal = woodTrimName(trimMaterialFinal);
      const trimBoards = isPictureFramed ? Math.max(0, Math.floor(Number(materialsDetails.pictureFrameTrimPieces) || 0)) * panels : 0;

      const latticeName = "";
      const latticePanels = 0;

      const nailsNameFinal = nailsName;
      const nailsBoxesFinal = nailsBoxes;

      const railEndBracketsQty = Math.max(0, Math.floor(Number(materialsDetails.railEndBracketPacks) || 0)) * 3;

      // Screws: 6 per rail, 350 per box
      // For picture framed styles we use the actual picture-framed rail counts.
      const railsForScrews = isPictureFramed ? (pictureFramed2x4x8 + pictureFramed2x4x16) : rails;
      const screwBoxes = railsForScrews > 0 ? Math.ceil((railsForScrews * 6) / 350) : 0;

      const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });
      const extraPostName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: extraPostSizeSafe, postType: materialsDetails.postType });

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: postName, qty: postsFence, unit: "ea" },
        ...(extraPostsQty > 0 ? [{ name: extraPostName, qty: extraPostsQty, unit: "ea" }] : []),
        ...(isPictureFramed
          ? [
            {
              name: woodRail2x4Name(8, materialsDetails.railMaterial),
              qty: pictureFramed2x4x8,
              unit: "ea"
            },
            ...(isNiko
              ? [{ name: woodTwoByTwoName(materialsDetails.twoByTwoMaterial), qty: panels * 8, unit: "ea" }]
              : []),
            ...(isCasto
              ? [{ name: woodTwoByTwoName(materialsDetails.twoByTwoMaterial), qty: panels * 7, unit: "ea" }]
              : []),
            ...(pictureFramed2x4x16 > 0
              ? [{ name: woodRail2x4Name(16, materialsDetails.railMaterial), qty: pictureFramed2x4x16, unit: "ea" }]
              : []),
          ]
          : [{ name: woodRail2x4Name(16, materialsDetails.railMaterial), qty: rails, unit: "ea" }]),
        { name: picketName, qty: pickets, unit: "ea" },
        ...(trimBoards > 0 ? [{ name: trimNameFinal, qty: trimBoards, unit: "ea" }] : []),
        ...(latticePanels > 0 ? [{ name: latticeName, qty: latticePanels, unit: "ea" }] : []),
        ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
        ...(nailsBoxesFinal > 0 ? [{ name: nailsNameFinal, qty: nailsBoxesFinal, unit: "box" }] : []),
        ...(screwBoxes > 0 ? [{ name: "3\" Deck Screws", qty: screwBoxes, unit: "box" }] : []),
        ...(railEndBracketsQty > 0
          ? [{ name: "Rail end bracket packs", qty: railEndBracketsQty, unit: "ea" }]
          : []),
        ...(materialsDetails.postCaps ? [{ name: "Post caps", qty: postsFence, unit: "ea" }] : []),
        ...(materialsDetails.arbor ? [{ name: "Arbor", qty: fixedOrZero(1), unit: "ea" }] : []),
        ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
        ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
        ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedFenceType === "vinyl") {
      const lf = Number(totalLf) || 0;
      const panelW = Math.max(1, Number(materialsDetails.vinylPanelWidthFt) || 6);
      const panelH = Math.max(1, Number(materialsDetails.vinylPanelHeightFt) || 6);
      const color = String(materialsDetails.vinylColor || "White");

      const panels = lf > 0 ? Math.ceil(lf / panelW) : 0;
      const postsBase = panels > 0 ? panels + 1 : 0;
      const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));

      const corner = Math.max(0, Math.floor(Number(materialsDetails.vinylCornerPosts) || 0));
      const end = Math.max(0, Math.floor(Number(materialsDetails.vinylEndPosts) || 0));
      const blank = Math.max(0, Math.floor(Number(materialsDetails.vinylBlankPosts) || 0));
      const threeWay = Math.max(0, Math.floor(Number(materialsDetails.vinylThreeWayPosts) || 0));
      const stiffeners = Math.max(0, Math.floor(Number(materialsDetails.vinylPostStiffeners) || 0));
      const gatePosts = Math.max(0, Math.floor(Number(gatePostsAdd) || 0));
      const line = Math.max(0, posts - (corner + end + blank + threeWay + gatePosts));

      const walkGateQty = Math.max(0, segments.filter((s) => !s.removed).filter((s) => isWalkGateSegment(s)).length);
      const doubleGateQty = Math.max(0, segments.filter((s) => !s.removed).filter((s) => isDoubleGateSegment(s)).length);

      const rows: Array<{ name: string; qty: number; unit: string }> = [
        { name: `Vinyl ${selectedStyle.name} panel ${panelH}' x ${panelW}' (${color})`, qty: panels, unit: "ea" },
        ...(line > 0 ? [{ name: "Vinyl line post", qty: line, unit: "ea" }] : []),
        ...(corner > 0 ? [{ name: "Vinyl corner post", qty: corner, unit: "ea" }] : []),
        ...(end > 0 ? [{ name: "Vinyl end post", qty: end, unit: "ea" }] : []),
        ...(blank > 0 ? [{ name: "Vinyl blank post", qty: blank, unit: "ea" }] : []),
        ...(threeWay > 0 ? [{ name: "Vinyl 3-way post", qty: threeWay, unit: "ea" }] : []),
        ...(gatePosts > 0 ? [{ name: "Vinyl gate post", qty: gatePosts, unit: "ea" }] : []),
        ...(stiffeners > 0 ? [{ name: "Vinyl post stiffener", qty: stiffeners, unit: "ea" }] : []),
        ...(walkGateQty > 0 ? [{ name: "Vinyl walk gate", qty: walkGateQty, unit: "ea" }] : []),
        ...(doubleGateQty > 0 ? [{ name: "Vinyl double gate", qty: doubleGateQty, unit: "ea" }] : [])
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    if (selectedFenceType === "aluminum") {
      const fixedOrZero = (qty: number) => (totalLf > 0 ? qty : 0);
      const lf = Number(totalLf) || 0;
      const style = String(selectedStyle?.name || "Aluminum");
      const hRaw = Math.max(1, Math.floor(Number(materialsDetails.aluminumPanelHeight) || 48));
      const allowedHeights = aluminumAllowedPanelHeights;
      const h = allowedHeights.includes(hRaw) ? hRaw : Math.max(1, Math.floor(Number(allowedHeights[0]) || hRaw));

      const w = 6;
      const segmentLengths = segments
        .filter((s) => !s.removed)
        .map((s) => Number(s.length) || 0)
        .filter((n) => n > 0);
      const panels = segmentLengths.length
        ? segmentLengths.reduce((sum, len) => sum + Math.ceil(len / w), 0)
        : (lf > 0 ? Math.ceil(lf / w) : 0);

      const corner = aluminumPostsSummary.corner;
      const end = aluminumPostsSummary.end;
      const blank = aluminumPostsSummary.blank;
      const gate = aluminumPostsSummary.gate;
      const line = aluminumPostsSummary.line;

      // Concrete: 160lb per post (2x 80lb bags per post). Priced using 60lb bag line item.
      const concrete80Bags = Math.max(0, aluminumPostsSummary.total) * 2;
      const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

      const heightLabel = h === 54 ? "4.5'" : `${Math.round(h / 12)}'`;
      const panelName = `${style} aluminum panel 6ft (${heightLabel})`;
      const linePostName = `${style} line post (${heightLabel})`;
      const cornerPostName = `${style} corner post (${heightLabel})`;
      const endPostName = `${style} end post (${heightLabel})`;
      const gatePostName = `${style} gate post (${heightLabel})`;
      const blankPostName = `${style} blank post (${heightLabel})`;
      const blankGatePostName = `${style} blank gate post add-on (${heightLabel})`;

      const panelKey = aluminumPanelPriceKey(style, h);
      const linePostKey = aluminumPostPriceKey("LINE", style, h);
      const cornerPostKey = aluminumPostPriceKey("CORNER", style, h);
      const endPostKey = aluminumPostPriceKey("END", style, h);
      const gatePostKey = aluminumPostPriceKey("GATE", style, h);
      const blankPostKey = aluminumPostPriceKey("BLANK", style, h);
      const blankGatePostKey = aluminumBlankGatePostPriceKey(style, h);

      const walkGateItems: Array<{ name: string; qty: number; unit: string; priceKey?: string }> = (() => {
        if (!selectedStyle) return [] as Array<{ name: string; qty: number; unit: string }>;
        const walkCount = Math.max(0, segments.filter((s) => !s.removed).filter((s) => isWalkGateSegment(s)).length);
        if (walkCount <= 0) return [];

        if (style === "Mansfield") {
          const defaultOpt = h === 60 ? "walk_48_5" : "walk_48_4";
          const raw = materialsDetails.mansfieldWalkGateOptions || [];
          const opts = raw.length === walkCount ? raw : Array.from({ length: walkCount }, (_, i) => String(raw[i] || defaultOpt));
          const qty48 = opts.filter((v) => (h === 60 ? v === "walk_48_5" : v === "walk_48_4")).length;
          const qty60 = opts.filter((v) => (h === 60 ? v === "walk_60_5" : v === "walk_60_4")).length;
          const name48 = `Mansfield walk gate 48\" x ${heightLabel}`;
          const name60 = `Mansfield walk gate 60\" x ${heightLabel}`;
          return [
            ...(qty48 > 0 ? [{ name: name48, qty: qty48, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "WALK", widthIn: 48, hIn: h }) }] : []),
            ...(qty60 > 0 ? [{ name: name60, qty: qty60, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "WALK", widthIn: 60, hIn: h }) }] : [])
          ];
        }

        if (style === "Toledo") {
          const defaultOpt = h === 60 ? "walk_48_5" : "walk_48_4";
          const raw = materialsDetails.toledoWalkGateOptions || [];
          const opts = raw.length === walkCount ? raw : Array.from({ length: walkCount }, (_, i) => String(raw[i] || defaultOpt));
          const qty48 = opts.filter((v) => (h === 60 ? v === "walk_48_5" : v === "walk_48_4")).length;
          const qty60 = opts.filter((v) => (h === 60 ? v === "walk_60_5" : v === "walk_60_4")).length;
          const name48 = `Toledo walk gate 48\" x ${heightLabel}`;
          const name60 = `Toledo walk gate 60\" x ${heightLabel}`;
          return [
            ...(qty48 > 0 ? [{ name: name48, qty: qty48, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "WALK", widthIn: 48, hIn: h }) }] : []),
            ...(qty60 > 0 ? [{ name: name60, qty: qty60, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "WALK", widthIn: 60, hIn: h }) }] : [])
          ];
        }

        if (style === "Atlantic") {
          const defaultOpt = h === 60 ? "walk_48_5" : "walk_48_4";
          const raw = materialsDetails.atlanticWalkGateOptions || [];
          const opts = raw.length === walkCount ? raw : Array.from({ length: walkCount }, (_, i) => String(raw[i] || defaultOpt));
          const qty48 = opts.filter((v) => v === "walk_48_4" || v === "walk_48_5" || v === "walk_48_45").length;
          const qty60 = opts.filter((v) => v === "walk_60_4" || v === "walk_60_5" || v === "walk_60_45").length;
          const name48 = `Atlantic walk gate 48\" x ${heightLabel}`;
          const name60 = `Atlantic walk gate 60\" x ${heightLabel}`;
          return [
            ...(qty48 > 0 ? [{ name: name48, qty: qty48, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Atlantic", kind: "WALK", widthIn: 48, hIn: h }) }] : []),
            ...(qty60 > 0 ? [{ name: name60, qty: qty60, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Atlantic", kind: "WALK", widthIn: 60, hIn: h }) }] : [])
          ];
        }

        if (style === "Pacific") {
          const defaultOpt = "walk_48_45";
          const raw = materialsDetails.pacificWalkGateOptions || [];
          const opts = raw.length === walkCount ? raw : Array.from({ length: walkCount }, (_, i) => String(raw[i] || defaultOpt));
          const qty48 = opts.filter((v) => v === "walk_48_45").length;
          const qty60 = opts.filter((v) => v === "walk_60_45").length;
          const name48 = `Pacific walk gate 48\" x ${heightLabel}`;
          const name60 = `Pacific walk gate 60\" x ${heightLabel}`;
          return [
            ...(qty48 > 0 ? [{ name: name48, qty: qty48, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Pacific", kind: "WALK", widthIn: 48, hIn: h }) }] : []),
            ...(qty60 > 0 ? [{ name: name60, qty: qty60, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Pacific", kind: "WALK", widthIn: 60, hIn: h }) }] : [])
          ];
        }

        if (style === "Terrier") {
          const name48 = `Terrier walk gate 48\" x ${heightLabel}`;
          return walkCount > 0
            ? [{ name: name48, qty: walkCount, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Terrier", kind: "WALK", widthIn: 48, hIn: 48 }) }]
            : [];
        }

        return [];
      })();

      const doubleGateItems: Array<{ name: string; qty: number; unit: string; priceKey?: string }> = (() => {
        const doubleCount = Math.max(0, Number(effectiveDoubleGateCount) || 0);
        if (doubleCount <= 0) return [] as Array<{ name: string; qty: number; unit: string }>;

        if (style === "Mansfield") {
          const defaultOpt = h === 60 ? "double_48_5" : "double_48_4";
          const raw = materialsDetails.mansfieldDoubleGateOptions || [];
          const opts = raw.length === doubleCount ? raw : Array.from({ length: doubleCount }, (_, i) => String(raw[i] || defaultOpt));
          const qty48 = opts.filter((v) => (h === 60 ? v === "double_48_5" : v === "double_48_4")).length;
          const qty60 = opts.filter((v) => (h === 60 ? v === "double_60_5" : v === "double_60_4")).length;
          const name48 = `Mansfield double gate 48\" x ${heightLabel}`;
          const name60 = `Mansfield double gate 60\" x ${heightLabel}`;
          return [
            ...(qty48 > 0 ? [{ name: name48, qty: qty48, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "DOUBLE", widthIn: 48, hIn: h }) }] : []),
            ...(qty60 > 0 ? [{ name: name60, qty: qty60, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "DOUBLE", widthIn: 60, hIn: h }) }] : [])
          ];
        }

        if (style === "Atlantic") {
          const defaultOpt = "double_60_4";
          const raw = materialsDetails.atlanticDoubleGateOptions || [];
          const opts = raw.length === doubleCount ? raw : Array.from({ length: doubleCount }, (_, i) => String(raw[i] || defaultOpt));
          const qty48 = opts.filter((v) => v === "double_48_4").length;
          const qty60 = opts.filter((v) => v === "double_60_4").length;
          const name48 = `Atlantic double gate 48\" x ${heightLabel}`;
          const name60 = `Atlantic double gate 60\" x ${heightLabel}`;
          return [
            ...(qty48 > 0 ? [{ name: name48, qty: qty48, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Atlantic", kind: "DOUBLE", widthIn: 48, hIn: h }) }] : []),
            ...(qty60 > 0 ? [{ name: name60, qty: qty60, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Atlantic", kind: "DOUBLE", widthIn: 60, hIn: h }) }] : [])
          ];
        }

        if (style === "Toledo") {
          const defaultOpt = h === 60 ? "double_48_5" : "double_48_4";
          const raw = materialsDetails.toledoDoubleGateOptions || [];
          const opts = raw.length === doubleCount ? raw : Array.from({ length: doubleCount }, (_, i) => String(raw[i] || defaultOpt));
          const qty48 = opts.filter((v) => (h === 60 ? v === "double_48_5" : v === "double_48_4")).length;
          const qty60 = opts.filter((v) => (h === 60 ? v === "double_60_5" : v === "double_60_4")).length;
          const name48 = `Toledo double gate 48\" x ${heightLabel}`;
          const name60 = `Toledo double gate 60\" x ${heightLabel}`;
          return [
            ...(qty48 > 0 ? [{ name: name48, qty: qty48, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "DOUBLE", widthIn: 48, hIn: h }) }] : []),
            ...(qty60 > 0 ? [{ name: name60, qty: qty60, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "DOUBLE", widthIn: 60, hIn: h }) }] : [])
          ];
        }

        if (style === "Pacific") {
          const defaultOpt = "double_48_45";
          const raw = materialsDetails.pacificDoubleGateOptions || [];
          const opts = raw.length === doubleCount ? raw : Array.from({ length: doubleCount }, (_, i) => String(raw[i] || defaultOpt));
          const qty48 = opts.filter((v) => v === "double_48_45").length;
          const qty60 = opts.filter((v) => v === "double_60_45").length;
          const name48 = `Pacific double gate 48\" x ${heightLabel}`;
          const name60 = `Pacific double gate 60\" x ${heightLabel}`;
          return [
            ...(qty48 > 0 ? [{ name: name48, qty: qty48, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Pacific", kind: "DOUBLE", widthIn: 48, hIn: h }) }] : []),
            ...(qty60 > 0 ? [{ name: name60, qty: qty60, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Pacific", kind: "DOUBLE", widthIn: 60, hIn: h }) }] : [])
          ];
        }

        if (style === "Terrier") {
          const name48 = `Terrier double gate 48\" x ${heightLabel}`;
          return doubleCount > 0
            ? [{ name: name48, qty: doubleCount, unit: "ea", priceKey: aluminumGatePriceKey({ style: "Terrier", kind: "DOUBLE", widthIn: 48, hIn: 48 }) }]
            : [];
        }

        return [];
      })();

      const rows: Array<{ name: string; qty: number; unit: string; priceKey?: string }> = [
        ...(panels > 0 ? [{ name: panelName, qty: panels, unit: "ea", priceKey: panelKey }] : []),
        ...(line > 0 ? [{ name: linePostName, qty: line, unit: "ea", priceKey: linePostKey }] : []),
        ...(corner > 0 ? [{ name: cornerPostName, qty: corner, unit: "ea", priceKey: cornerPostKey }] : []),
        ...(end > 0 ? [{ name: endPostName, qty: end, unit: "ea", priceKey: endPostKey }] : []),
        ...(blank > 0 ? [{ name: blankPostName, qty: blank, unit: "ea", priceKey: blankPostKey }] : []),
        ...(gate > 0 ? [{ name: gatePostName, qty: gate, unit: "ea", priceKey: gatePostKey }] : []),
        ...(selectedStyle?.name === "Mansfield" && materialsDetails.mansfieldBlankGatePost
          ? [{ name: blankGatePostName, qty: 1, unit: "ea", priceKey: blankGatePostKey }]
          : []),
        ...walkGateItems,
        ...doubleGateItems,
        ...(concrete60Bags > 0
          ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: fixedOrZero(concrete60Bags), unit: "bag" }]
          : []),
        { name: "Disposal", qty: fixedOrZero(1), unit: "ea" },
        { name: "Delivery", qty: fixedOrZero(1), unit: "ea" },
        { name: "Equipment Fees", qty: fixedOrZero(1), unit: "ea" }
      ];

      return rows
        .filter((r) => (Number(r.qty) || 0) > 0)
        .map((r) => {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
          const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
          return { section: "materials" as const, name: r.name, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
        });
    }

    // Placeholder rule set for now (iterate with you): driven by total LF.
    // We’ll replace these rules with your exact Standard Privacy rules.
    const lf = totalLf;
    const panels = lf > 0 ? Math.ceil(lf / 7.5) : 0;
    const postSpacingFt = 8;
    const postsBase = lf > 0 ? Math.max(2, Math.ceil(lf / postSpacingFt) + 1) : 0;
    const posts = Math.max(0, postsBase + gatePostsAdd + (Number(extraPosts) || 0));
    const railsPerSection = 3;
    const rails = posts > 1 ? (posts - 1) * railsPerSection : 0;
    const picketsPerFt = 1.3;
    const pickets = lf > 0 ? Math.ceil(lf * picketsPerFt) : 0;
    const concrete80Bags = posts * 2;
    const concrete60Bags = concrete80Bags > 0 ? Math.ceil((concrete80Bags * 80) / 60) : 0;

    const nailsPerBox = woodNailsBoxQty(materialsDetails.picketMaterial);
    const nailsName = woodNailsItemName(materialsDetails.picketMaterial);
    const nailsBoxes = pickets > 0 ? Math.ceil((pickets * 6) / nailsPerBox) : 0;

    const isPictureFrameKind =
      selectedStyleKind === "wood_picture_framed" ||
      selectedStyleKind === "wood_am" ||
      selectedStyleKind === "wood_niko" ||
      selectedStyleKind === "wood_casto" ||
      selectedStyleKind === "wood_picture_framed_4ft" ||
      selectedStyleKind === "wood_picture_framed_lattice";
    const trimMaterialFinal = isPictureFrameKind
      ? (materialsDetails.pictureFrameTrimMaterial || materialsDetails.trimMaterial)
      : materialsDetails.trimMaterial;
    const trimName = woodTrimName(trimMaterialFinal);
    const trimBoards = selectedStyleKind === "wood_picture_framed" || selectedStyleKind === "wood_am" || selectedStyleKind === "wood_niko" || selectedStyleKind === "wood_casto" || selectedStyleKind === "wood_picture_framed_4ft" || selectedStyleKind === "wood_picture_framed_lattice"
      ? Math.max(0, Math.floor(Number(materialsDetails.pictureFrameTrimPieces) || 0)) * panels
      : 0;

    const railEndBracketsQty = Math.max(0, Math.floor(Number(materialsDetails.railEndBracketPacks) || 0)) * 3;

    const postName = woodPostItemNameByDim({ postDim: materialsDetails.postDim, postSize: materialsDetails.postSize, postType: materialsDetails.postType });
    const railName = woodRail2x4Name(16, materialsDetails.railMaterial);
    const picketName = woodPicketName(materialsDetails.picketMaterial);

    const rows: Array<{ name: string; qty: number; unit: string }> = [
      { name: postName, qty: posts, unit: "ea" },
      { name: railName, qty: rails, unit: "ea" },
      { name: picketName, qty: pickets, unit: "ea" },
      ...(concrete60Bags > 0 ? [{ name: `Concrete 60lb Bag (≈ ${concrete80Bags} 80lb)`, qty: concrete60Bags, unit: "bag" }] : []),
      ...(trimBoards > 0 ? [{ name: trimName, qty: trimBoards, unit: "ea" }] : []),
      ...(nailsBoxes > 0 ? [{ name: nailsName, qty: nailsBoxes, unit: "box" }] : []),
      ...(railEndBracketsQty > 0
        ? [{ name: "Rail end bracket", qty: railEndBracketsQty, unit: "ea" }]
        : []),
      ...(materialsDetails.postCaps ? [{ name: "Post caps", qty: posts, unit: "ea" }] : []),
      ...(materialsDetails.arbor ? [{ name: "Arbor", qty: 1, unit: "ea" }] : []),
      ...(gateHingeKitsAdd > 0 ? [{ name: "Gate Hinge Kit", qty: gateHingeKitsAdd, unit: "ea" }] : []),
      ...(doubleGateKitsAdd > 0 ? [{ name: "Double gate kit", qty: doubleGateKitsAdd, unit: "ea" }] : []),
      ...(gateFramingAdd > 0 ? [{ name: woodGateFramingName(materialsDetails.railMaterial), priceKey: "Cedar S4S Gate Framing", qty: gateFramingAdd, unit: "ea" } as any] : [])
    ];

    return rows.map((r) => {
      const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name: r.name, priceKey: (r as any).priceKey });
      const lineTotal = Math.round((r.qty * unitPrice) * 100) / 100;
      return { section: "materials" as const, name: r.name, priceKey: (r as any).priceKey, qty: r.qty, unit: r.unit, unitPrice, lineTotal };
    });
  }

  const generatedMaterials = useMemo(() => {
    try {
      if (takeoffErrorRef.current) {
        takeoffErrorRef.current = null;
        setTimeout(() => setTakeoffError(null), 0);
      }
      const baseId = baseComboCardId;
      if (!baseId) return [] as QuoteItem[];

      const allRows: QuoteItem[] = [];

      for (const card of comboCards) {
        if (!card.selectedStyle) continue;

        let usedExtraPosts = false;

        // Split into contiguous runs based on original segment order.
        let currentRun: typeof segments = [];
        const flush = () => {
          if (!currentRun.length) return;
          const generated = generateMaterialsForContext({
            selectedStyle: card.selectedStyle,
            selectedFenceType: card.fenceType,
            vinylStyleTab: card.vinylStyleTab,
            materialsDetails: card.materialsDetails,
            extraPosts: usedExtraPosts ? 0 : (Number(card.extraPosts) || 0),
            segments: currentRun
          });
          allRows.push(
            ...generated.map((r) => ({
              ...r,
              __cardId: card.id,
              __shared: Boolean((card as any).shared)
            }))
          );
          usedExtraPosts = true;
          currentRun = [];
        };

        for (const s of segments) {
          if (s.removed) {
            flush();
            continue;
          }
          const len = Number(s.length) || 0;
          if (len <= 0) {
            flush();
            continue;
          }
          const resolved = resolveSegmentCardId(s);
          if (resolved === card.id) {
            currentRun.push(s);
          } else {
            flush();
          }
        }
        flush();
      }

      const merged = allRows.reduce((acc, r) => {
        const key = `${canonicalMaterialsMergeKey(r.name)}__${r.unit}`;
        const prev = acc.get(key);
        if (prev) {
          const prevIds = Array.isArray((prev as any).__cardIds) ? ((prev as any).__cardIds as string[]) : [];
          const nextId = typeof (r as any).__cardId === "string" ? String((r as any).__cardId) : "";
          const nextIds = nextId ? (prevIds.includes(nextId) ? prevIds : [...prevIds, nextId]) : prevIds;
          (prev as any).__cardIds = nextIds;
          (prev as any).__shared = Boolean((prev as any).__shared) || Boolean((r as any).__shared);

          prev.qty = (Number(prev.qty) || 0) + (Number(r.qty) || 0);
          const prevPrice = Number(prev.unitPrice) || 0;
          const nextPrice = Number(r.unitPrice) || 0;
          if (prevPrice <= 0 && nextPrice > 0) {
            prev.unitPrice = nextPrice;
            prev.name = r.name;
          } else if (nextPrice > prevPrice) {
            // If we canonical-merge two equivalent names, keep the higher non-zero price.
            // Also switch display name so price edits map to the priced name.
            prev.unitPrice = nextPrice;
            prev.name = r.name;
          }
          prev.lineTotal = Math.round((Number(prev.qty) || 0) * (Number(prev.unitPrice) || 0) * 100) / 100;
        } else {
          const nextId = typeof (r as any).__cardId === "string" ? String((r as any).__cardId) : "";
          acc.set(key, {
            ...(r as any),
            __cardIds: nextId ? [nextId] : [],
            __shared: Boolean((r as any).__shared)
          });
        }
        return acc;
      }, new Map<string, QuoteItem>());

      const applyTakeoffOverrides = (rows: QuoteItem[]) => {
        const indexed = (Array.isArray(rows) ? rows : []).map((r) => ({ r, idx: 0 }));
        return indexed.map(({ r }) => {
          const lk = takeoffLineKeyForItem(r as any);
          const override = Number((takeoffUnitPriceOverrides as any)[lk]);
          if (!Number.isFinite(override)) return r;
          const unitPrice = override;
          const qty = Number((r as any).qty) || 0;
          const lineTotal = Math.round(qty * unitPrice * 100) / 100;
          return { ...(r as any), unitPrice, lineTotal } as QuoteItem;
        });
      };

      // Gate accessories (hinges/kits/framing) are wood-only and should reflect estimate-level wood gate count,
      // not multiply per card/run.
      const baseIdResolved = baseComboCardId || null;
      const woodGateSegments = segments
        .filter((s) => !s.removed)
        .filter((s) => {
          const cid = (s as any).cardId ?? null;
          const resolved = cid === null ? baseIdResolved : cid;
          const card = comboCards.find((c) => c.id === resolved);
          return card?.fenceType === "wood";
        });

      const totalWalkGates = Math.max(
        0,
        woodGateSegments.filter((s: any) => (s as any).gateType === "walk" || ((s as any).gateType == null && Boolean((s as any).gate))).length
      );
      const totalDoubleGates = Math.max(0, woodGateSegments.filter((s: any) => (s as any).gateType === "double").length);

      const ensureQty = (name: string, unit: QuoteItem["unit"], qty: number) => {
        const k = `${canonicalMaterialsMergeKey(name)}__${unit}`;
        if (qty <= 0) {
          merged.delete(k);
          return;
        }
        const prev = merged.get(k);
        if (prev) {
          prev.qty = qty;
          prev.name = name;
          prev.unit = unit;
          prev.lineTotal = Math.round((Number(qty) || 0) * (Number(prev.unitPrice) || 0) * 100) / 100;
        } else {
          const unitPrice = getUnitPriceFromMap({ materialUnitPrices, name });
          merged.set(k, { section: "materials", name, qty, unit, unitPrice, lineTotal: Math.round(qty * unitPrice * 100) / 100 });
        }
      };

      ensureQty("Gate Hinge Kit", "ea", totalWalkGates * 1);
      ensureQty("Double gate kit", "ea", totalDoubleGates * 1);
      ensureQty("Cedar S4S Gate Framing", "ea", totalWalkGates * 5 + totalDoubleGates * 10);

      ensureQty("Disposal", "ea", 1);
      ensureQty("Delivery", "ea", 1);
      ensureQty("Equipment Fees", "ea", 1);

      const out = applyTakeoffOverrides(Array.from(merged.values()));
      const feeOrder: Record<string, number> = { Disposal: 0, Delivery: 1, "Equipment Fees": 2 };
      const indexed = out.map((r, idx) => ({ r, idx }));
      indexed.sort((a, b) => {
        const ai = feeOrder[a.r.name];
        const bi = feeOrder[b.r.name];
        const aIsFee = Number.isFinite(ai);
        const bIsFee = Number.isFinite(bi);
        const aCardIds = Array.isArray((a.r as any).__cardIds) ? ((a.r as any).__cardIds as string[]) : [];
        const bCardIds = Array.isArray((b.r as any).__cardIds) ? ((b.r as any).__cardIds as string[]) : [];
        const aIsSharedMaterial = aCardIds.length > 1;
        const bIsSharedMaterial = bCardIds.length > 1;

        const group = (isSharedMaterial: boolean, isFee: boolean) => (isFee ? 2 : isSharedMaterial ? 1 : 0);
        const ag = group(aIsSharedMaterial, aIsFee);
        const bg = group(bIsSharedMaterial, bIsFee);
        if (ag !== bg) return ag - bg;

        if (aIsFee && bIsFee) return ai - bi;
        return a.idx - b.idx;
      });
      return indexed.map((x) => x.r);
    } catch (e) {
      try {
        console.error(e);
      } catch {
      }
      const errAny = e as any;
      const name = typeof errAny?.name === "string" ? errAny.name : (e instanceof Error ? e.name : "");
      const msg = e instanceof Error ? e.message : String(e);
      const details = String(msg || "").trim() || String(name || "").trim() || "Unknown error";
      if (takeoffErrorRef.current !== details) {
        takeoffErrorRef.current = details;
        setTimeout(() => setTakeoffError(`Takeoff error: ${details}`), 0);
      }
      return [] as QuoteItem[];
    }
  }, [baseComboCardId, comboCards, materialUnitPrices, segments, takeoffUnitPriceOverrides]);

  useEffect(() => {
    if ((generatedMaterials?.length || 0) > 0) {
      setTakeoffMaterialsStable(generatedMaterials);
      return;
    }

    // If we're truly not configured for a takeoff, clear.
    // Otherwise keep the last non-empty list to avoid momentary UI wipes on mobile while editing.
    if (takeoffDiagnostics && (!takeoffDiagnostics.hasStyledCards || !takeoffDiagnostics.hasEligibleSegments)) {
      setTakeoffMaterialsStable([]);
    }
  }, [generatedMaterials, takeoffDiagnostics]);

  const storageKey = "vf_estimate_drafts_v1";
  const unsavedSnapshotKey = "vf_estimate_unsaved_snapshot_v1";

  function stripDataUrlsFromPreInstall(input: Array<{ src: string; srcPath?: string; note: string; createdAt: number }>) {
    if (!Array.isArray(input)) return [] as Array<{ src: string; srcPath?: string; note: string; createdAt: number }>;
    return input.filter((p) => p && typeof (p as any).src === "string" && !String((p as any).src || "").startsWith("data:"));
  }

  function mergePreInstallForStorage(input: Array<{ src: string; srcPath?: string; note: string; createdAt: number }>, sanitizedData: Array<{ src: string; note: string; createdAt: number }>) {
    const remote = Array.isArray(input)
      ? input
          .filter((p) => p && typeof (p as any).src === "string" && !String((p as any).src || "").startsWith("data:"))
          .map((p) => ({
            src: String((p as any).src || ""),
            srcPath: typeof (p as any).srcPath === "string" ? (p as any).srcPath : undefined,
            note: String((p as any).note || ""),
            createdAt: Number((p as any).createdAt) || Date.now()
          }))
          .filter((p) => Boolean(p.src))
      : [];

    const local = Array.isArray(sanitizedData)
      ? sanitizedData
          .map((p) => ({ src: String((p as any).src || ""), note: String((p as any).note || ""), createdAt: Number((p as any).createdAt) || Date.now() }))
          .filter((p) => Boolean(p.src))
      : [];

    return [...remote, ...local];
  }

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
    try {
      window.dispatchEvent(new Event("vf-drafts-changed"));
    } catch {
      // ignore
    }
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
      const comboPayload = {
        comboCards,
        activeComboCardId
      };

      const sanitized = sanitizePhotosForStorage({ projectPhotoDataUrl, preInstallPhotos });
      const projectDataBackup = sanitized.projectPhotoDataUrl;
      const projectUrlSafe = typeof projectPhotoUrl === "string" && projectPhotoUrl.startsWith("data:") ? null : projectPhotoUrl;
      const preInstallForStorage = mergePreInstallForStorage(preInstallPhotos, sanitized.preInstallPhotos);

      const payload = {
        draftId,
        draftParam,
        customerName,
        projectAddress,
        phoneNumber,
        email,
        // Keep photo state in the snapshot so navigating away/back doesn't wipe in-progress photo edits.
        // Prefer remote URL if available; otherwise keep a small local data backup.
        projectPhotoUrl: projectUrlSafe || projectDataBackup,
        projectPhotoPath,
        projectPhotoDataUrl: projectDataBackup,
        selectedFenceType,
        selectedStyle,
        materialsDetails,
        extraPosts,
        ...comboPayload,
        materialUnitPrices,
        takeoffUnitPriceOverrides,
        laborDays,
        laborManualDays,
        laborManualCost,
        gradingPrice,
        treeRemovalPrice,
        toughDigEnabled,
        gradeEnabled,
        stumpGrindingPrice,
        doubleGateCount: effectiveDoubleGateCount,
        referenceLength,
        notes,
        preInstallPhotos: preInstallForStorage,
        segments,
        items
      };
      window.localStorage.setItem(unsavedSnapshotKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (draftParam) {
      // Still persist while editing an existing draft so navigation away/back restores unsaved changes.
    }
    if (restoringRef.current) return;

    const t = window.setTimeout(() => {
      try {
        writeUnsavedSnapshot();
      } catch {
      }
    }, 250);
    return () => {
      window.clearTimeout(t);
      try {
        if (!restoringRef.current) writeUnsavedSnapshot();
      } catch {
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftId,
    draftParam,
    customerName,
    projectAddress,
    phoneNumber,
    email,
    projectPhotoUrl,
    projectPhotoPath,
    selectedFenceType,
    selectedStyle,
    materialsDetails,
    extraPosts,
    comboCards,
    activeComboCardId,
    materialUnitPrices,
    takeoffUnitPriceOverrides,
    laborDays,
    laborManualDays,
    laborManualCost,
    gradingPrice,
    treeRemovalPrice,
    toughDigEnabled,
    gradeEnabled,
    stumpGrindingPrice,
    effectiveDoubleGateCount,
    referenceLength,
    notes,
    preInstallPhotos,
    segments,
    items
  ]);

  function buildDraftData(id: string) {
    const feeNames = new Set(["Disposal", "Delivery", "Equipment Fees"]);
    const hasRealMaterials = Array.isArray(items)
      ? items.some((i: any) => i && i.section === "materials" && (Number(i.qty) || 0) > 0 && !feeNames.has(String(i.name || "")))
      : false;
    const existingStatus = (() => {
      try {
        const store = readDraftStore();
        return store && (store as any)[id] ? String((store as any)[id].status || "") : "";
      } catch {
        return "";
      }
    })();

    const existingSchedule = (() => {
      try {
        const store = readDraftStore();
        return store && (store as any)[id] && typeof (store as any)[id] === "object" ? (store as any)[id] : null;
      } catch {
        return null;
      }
    })();
    const status = existingStatus === "sold" || existingStatus === "complete" || existingStatus === "void"
      ? (existingStatus as any)
      : (hasRealMaterials ? "pending" : "estimate");

    // Calendar scheduling fields live on the draft object and should not be blown away by an edit-save.
    // This is especially important for SOLD jobs whose calendar position is queue-based.
    const createdAt = Number((existingSchedule as any)?.createdAt) || Date.now();
    const scheduledAt = typeof (existingSchedule as any)?.scheduledAt === "string" ? (existingSchedule as any).scheduledAt : undefined;
    const installDate = typeof (existingSchedule as any)?.installDate === "string" ? (existingSchedule as any).installDate : undefined;
    const startDate = typeof (existingSchedule as any)?.startDate === "string" ? (existingSchedule as any).startDate : undefined;
    const holdDate = typeof (existingSchedule as any)?.holdDate === "string" ? (existingSchedule as any).holdDate : undefined;
    const allowSaturday = typeof (existingSchedule as any)?.allowSaturday === "boolean" ? (existingSchedule as any).allowSaturday : undefined;
    const allowSunday = typeof (existingSchedule as any)?.allowSunday === "boolean" ? (existingSchedule as any).allowSunday : undefined;
    const calendarHidden = typeof (existingSchedule as any)?.calendarHidden === "boolean" ? (existingSchedule as any).calendarHidden : undefined;
    const originalLaborDays = Number.isFinite(Number((existingSchedule as any)?.originalLaborDays))
      ? Number((existingSchedule as any).originalLaborDays)
      : undefined;

    // Keep a stable sold ordering key so edits don't reshuffle the calendar.
    const queueRank = status === "sold"
      ? (Number.isFinite(Number((existingSchedule as any)?.queueRank))
        ? Number((existingSchedule as any).queueRank)
        : createdAt)
      : (Number.isFinite(Number((existingSchedule as any)?.queueRank)) ? Number((existingSchedule as any).queueRank) : undefined);
    const sanitized = sanitizePhotosForStorage({ projectPhotoDataUrl, preInstallPhotos });
    const projectDataBackup = sanitized.projectPhotoDataUrl;
    const projectUrlSafe = typeof projectPhotoUrl === "string" && projectPhotoUrl.startsWith("data:") ? null : projectPhotoUrl;
    const preInstallForStorage = mergePreInstallForStorage(preInstallPhotos, sanitized.preInstallPhotos);

    return {
      id,
      createdAt,
      customerName,
      projectAddress,
      phoneNumber,
      email,
      // Prefer remote URL if available; otherwise keep a small local data backup so the preview survives saves.
      projectPhotoUrl: projectUrlSafe || projectDataBackup,
      projectPhotoPath,
      projectPhotoDataUrl: projectDataBackup,
      selectedFenceType,
      selectedStyle,
      materialsDetails,
      extraPosts,
      comboCards,
      activeComboCardId,
      materialUnitPrices,
      takeoffUnitPriceOverrides,
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
      preInstallPhotos: preInstallForStorage,
      segments,
      items,
      takeoffMaterials: ((generatedMaterials?.length || 0) > 0
        ? generatedMaterials
        : (Array.isArray(takeoffMaterialsStable) ? takeoffMaterialsStable : [])),
      takeoffManualItems: (Array.isArray(takeoffManualItems) ? takeoffManualItems : []),
      takeoffPerPanelAddons: (Array.isArray(takeoffPerPanelAddons) ? takeoffPerPanelAddons : []),
      totals: {
        materialsSubtotal: Number(takeoffMaterialsAndExpensesTotal) || 0,
        laborSubtotal: Number(laborBaseTotal) || 0,
        additionalSubtotal: Number(additionalFeesTotal) || 0,
        removalTotal: Number(removalTotal) || 0,
        discount: 0,
        tax: 0,
        total: Number(grandTotal) || 0,
        depositTotal: Number(materialsDepositTotal) || 0
      },
      status,
      scheduledAt,
      installDate,
      startDate,
      holdDate,
      allowSaturday,
      allowSunday,
      calendarHidden,
      queueRank,
      originalLaborDays,
      updatedAt: Date.now()
    };
  }

  async function save() {
    const id = draftId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      if (preInstallPendingCount > 0 || preInstallPhotos.some((p) => !String((p as any)?.src || "").trim())) {
        setSaveError("Photos are still processing. Please wait a moment and try saving again.");
        return;
      }
      const store = readDraftStore();
      const payload = buildDraftData(id);
      store[id] = payload;
      try {
        writeDraftStore(store);
      } catch (e) {
        if (!isQuotaError(e)) throw e;
        const quotaSanitized = sanitizePhotosForStorage({
          projectPhotoDataUrl:
            typeof (payload as any)?.projectPhotoDataUrl === "string" && String((payload as any).projectPhotoDataUrl).startsWith("data:")
              ? String((payload as any).projectPhotoDataUrl)
              : null,
          preInstallPhotos: normalizePreInstallPhotos((payload as any)?.preInstallPhotos)
        });
        const lite = {
          ...payload,
          projectPhotoDataUrl: quotaSanitized.projectPhotoDataUrl,
          projectPhotoUrl:
            typeof payload.projectPhotoUrl === "string" && payload.projectPhotoUrl.startsWith("data:")
              ? quotaSanitized.projectPhotoDataUrl
              : payload.projectPhotoUrl,
          preInstallPhotos: mergePreInstallForStorage(
            stripDataUrlsFromPreInstall(Array.isArray((payload as any).preInstallPhotos) ? (payload as any).preInstallPhotos : []),
            quotaSanitized.preInstallPhotos
          )
        };
        store[id] = lite;
        try {
          writeDraftStore(store);
          setSaveNotice("Saved without local photo cache (storage full on this device). ");
        } catch (e2) {
          if (!isQuotaError(e2)) throw e2;
          // As a last resort, clear older local drafts until it fits.
          try {
            const entries = Object.entries(store)
              .map(([k, v]) => ({ k, v }))
              .filter((x) => x.k !== id);
            entries.sort((a, b) => (Number((a.v as any)?.updatedAt) || 0) - (Number((b.v as any)?.updatedAt) || 0));
            let working: Record<string, any> = { ...store };
            for (const ent of entries) {
              delete working[ent.k];
              try {
                writeDraftStore(working);
                setSaveNotice("Saved after clearing old local drafts (storage full on this device). ");
                break;
              } catch {
                // keep pruning
              }
            }
            // If we still can't write, keep only the current draft and continue (remote save still happens).
            try {
              writeDraftStore({ [id]: lite });
              setSaveNotice("Saved without local history (storage full on this device). ");
            } catch {
              setSaveNotice("Saved remotely (local storage full on this device). ");
            }
          } catch {
            setSaveNotice("Saved remotely (local storage full on this device). ");
          }
        }
      }
      setDraftId(id);

      try {
        await upsertDraft({ id, data: payload });
      } catch {
        // ignore
      }
    } catch (e) {
      try {
        console.error(e);
      } catch {
      }
      const errAny = e as any;
      const name = typeof errAny?.name === "string" ? errAny.name : (e instanceof Error ? e.name : "");
      const msg = e instanceof Error ? e.message : String(e);
      const details = String(msg || "").trim() || String(name || "").trim();
      setSaveError(details ? `Failed to save: ${details}` : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAsNew() {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setSavingAsNew(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      if (preInstallPendingCount > 0 || preInstallPhotos.some((p) => !String((p as any)?.src || "").trim())) {
        setSaveError("Photos are still processing. Please wait a moment and try saving again.");
        return;
      }
      const store = readDraftStore();
      const payload = buildDraftData(id);
      store[id] = payload;
      const tryWrite = (nextStore: Record<string, any>) => {
        writeDraftStore(nextStore);
      };

      const pruneAndWrite = (nextStore: Record<string, any>) => {
        const entries = Object.entries(nextStore)
          .map(([k, v]) => ({ k, v }))
          .filter((x) => x.k !== id);
        entries.sort((a, b) => (Number(a.v?.updatedAt) || 0) - (Number(b.v?.updatedAt) || 0));
        let working = { ...nextStore };
        for (const e of entries) {
          delete working[e.k];
          try {
            tryWrite(working);
            return working;
          } catch {
            // keep pruning
          }
        }
        tryWrite({ [id]: nextStore[id] });
        return { [id]: nextStore[id] };
      };

      try {
        tryWrite(store);
      } catch (e) {
        if (!isQuotaError(e)) throw e;
        const quotaSanitized = sanitizePhotosForStorage({
          projectPhotoDataUrl:
            typeof (payload as any)?.projectPhotoDataUrl === "string" && String((payload as any).projectPhotoDataUrl).startsWith("data:")
              ? String((payload as any).projectPhotoDataUrl)
              : null,
          preInstallPhotos: normalizePreInstallPhotos((payload as any)?.preInstallPhotos)
        });
        const lite = {
          ...payload,
          projectPhotoDataUrl: quotaSanitized.projectPhotoDataUrl,
          projectPhotoUrl:
            typeof payload.projectPhotoUrl === "string" && payload.projectPhotoUrl.startsWith("data:")
              ? quotaSanitized.projectPhotoDataUrl
              : payload.projectPhotoUrl,
          preInstallPhotos: mergePreInstallForStorage(
            stripDataUrlsFromPreInstall(Array.isArray((payload as any).preInstallPhotos) ? (payload as any).preInstallPhotos : []),
            quotaSanitized.preInstallPhotos
          )
        };
        store[id] = lite;
        try {
          tryWrite(store);
          setSaveNotice("Saved without local photo cache (storage full on this device). ");
        } catch (e2) {
          if (!isQuotaError(e2)) throw e2;
          const pruned = pruneAndWrite(store);
          if (Object.keys(pruned).length <= 1) {
            setSaveNotice("Saved without local history (storage full on this device). ");
          } else {
            setSaveNotice("Saved after clearing old local drafts (storage full on this device). ");
          }
        }
      }
      setDraftId(id);

      try {
        await upsertDraft({ id, data: payload });
      } catch {
        // ignore
      }
      setSaveAsNewJustSaved(true);
      setTimeout(() => setSaveAsNewJustSaved(false), 900);
    } catch (e) {
      try {
        console.error(e);
      } catch {
      }
      const errAny = e as any;
      const name = typeof errAny?.name === "string" ? errAny.name : (e instanceof Error ? e.name : "");
      const msg = e instanceof Error ? e.message : String(e);
      const details = String(msg || "").trim() || String(name || "").trim();
      setSaveError(details ? `Failed to save: ${details}` : "Failed to save.");
    } finally {
      setSavingAsNew(false);
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

    const contractId = String(overrideDraftId || draftId || "");
    const submittedOn = new Date().toISOString();
    const styleTitle = selectedStyle?.name ? String(selectedStyle.name) : "";
    const totalLfValue = Number(totalLf) || 0;
    const walkGatesValue = Math.max(0, Number(walkGateCount) || 0);
    const doubleGatesValue = Math.max(0, Number(effectiveDoubleGateCount) || 0);

    return {
      company: {
        name: "Vasseur Fencing",
        tagline: "Fencing Contractor",
        salespersonName: "Nathan LaVasseur",
        addressLines: ["1415 Snowmass Rd.", "Columbus, OH 43235"],
        email: "nathan@vasseurfencing.com",
        phone: "(231) 260-0635",
        logoUrl: "/IMG_3454.JPG",
        contractText:
          "By signing below, the homeowner agrees to the scope of work and pricing described in this estimate."
      },
      estimate: {
        id: contractId,
        submittedOn,
        customer: { name: customerName, phone: phoneNumber, email },
        projectAddress,
        styleTitle,
        totalLf: totalLfValue,
        walkGateCount: walkGatesValue,
        doubleGateCount: doubleGatesValue,
        sharedLf: Number(sharedLf) || 0,
        sharedTotal: Number(sharedTotal) || 0,
        depositTotal: Number(materialsDepositTotal) || 0,
        notes,
        disclaimer: "",
        contractText:
          "By signing below, the homeowner agrees to the scope of work and pricing described in this estimate."
      },
      sections: {
        materials: materialsRows,
        labor: laborRows,
        additional: additionalRows
      },
      totals: {
        materialsSubtotal: Number(materialsDepositTotal) || 0,
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

  function dataUrlToBlob(dataUrl: string) {
    try {
      const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.*)$/);
      if (!m) return null;
      const mime = m[1] || "application/octet-stream";
      const b64 = m[2] || "";
      const bin = atob(b64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    } catch {
      return null;
    }
  }

  function addSegment() {
    const opts = segmentOptions();
    const nextLabel = opts[Math.min(segments.length, opts.length - 1)] ?? "A–B";
    setSegments((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, label: nextLabel, length: 0, removed: false, removal: false, cardId: null, gateType: "none" }
    ]);
  }

  function patchSegment(
    id: string,
    patch: Partial<{
      label: string;
      length: number;
      removed: boolean;
      removal?: boolean;
      gate?: boolean;
      cardId?: string | null;
      gateType?: "none" | "walk" | "double";
    }>
  ) {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function deleteSegment(id: string) {
    setSegments((prev) => prev.filter((s) => s.id !== id));
  }

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

  function fileToCompressedBlob(file: File, maxSide = 1280, quality = 0.72): Promise<Blob | null> {
    if (typeof window === "undefined") return Promise.resolve(null);

    return new Promise((resolve) => {
      let objectUrl: string | null = null;
      try {
        objectUrl = window.URL.createObjectURL(file);
      } catch {
        objectUrl = null;
      }

      if (!objectUrl) {
        resolve(null);
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
          canvas.toBlob(
            (blob) => resolve(blob ?? null),
            "image/jpeg",
            quality
          );
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
        resolve(null);
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
    if (!Array.isArray(input)) return [] as Array<{ src: string; srcPath?: string; note: string; createdAt: number }>;

    const out: Array<{ src: string; srcPath?: string; note: string; createdAt: number }> = [];
    for (const v of input) {
      if (typeof v === "string") {
        if (!v.startsWith("data:")) continue;
        out.push({ src: v, srcPath: undefined, note: "", createdAt: Date.now() });
        continue;
      }
      if (v && typeof v === "object") {
        const src = typeof (v as any).src === "string" ? (v as any).src : "";
        if (!src) continue;
        out.push({
          src,
          srcPath: typeof (v as any).srcPath === "string" ? (v as any).srcPath : undefined,
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
      const idForPhoto = draftId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      if (!draftId) setDraftId(idForPhoto);

      uploadDraftPhoto({ draftId: idForPhoto, file: projectPhoto, filename: (projectPhoto as any)?.name, kind: "project" }).then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setProjectPhotoDataUrl(null);
          setProjectPhotoPath(res.path);
          setProjectPhotoUrl(res.url);
          return;
        }
        fileToCompressedBlob(projectPhoto, 1280, 0.72).then((blob) => {
          if (cancelled) return;
          if (!blob) return;
          uploadDraftPhoto({ draftId: idForPhoto, file: blob, filename: (projectPhoto as any)?.name, kind: "project" }).then((res2) => {
            if (cancelled) return;
            if (!res2.ok) return;
            setProjectPhotoDataUrl(null);
            setProjectPhotoPath(res2.path);
            setProjectPhotoUrl(res2.url);
          });
        });
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
  }, [draftId, projectPhoto, projectPhotoDataUrl]);

  useEffect(() => {
    let cancelled = false;
    const data = typeof projectPhotoDataUrl === "string" ? projectPhotoDataUrl : null;
    const needsUpload =
      Boolean(data && data.startsWith("data:")) &&
      Boolean(draftId) &&
      !projectPhotoPath &&
      (!projectPhotoUrl || String(projectPhotoUrl).startsWith("data:"));
    if (!needsUpload) return;

    const blob = dataUrlToBlob(data!);
    if (!blob) return;

    (async () => {
      try {
        const uploaded = await uploadDraftPhoto({
          draftId: String(draftId),
          file: blob,
          filename: "project-photo.jpg",
          kind: "project"
        });
        if (cancelled) return;
        if (!uploaded.ok) return;
        setProjectPhotoPath(uploaded.path);
        setProjectPhotoUrl(uploaded.url);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftId, projectPhotoDataUrl, projectPhotoPath, projectPhotoUrl]);

  const lastPersistedProjectPhotoRef = useRef<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!draftId) return;
    if (restoringRef.current) return;

    const key = `${draftId}::${String(projectPhotoUrl || "")}::${String(projectPhotoPath || "")}::${String(projectPhotoDataUrl || "")}`;
    if (lastPersistedProjectPhotoRef.current === key) return;
    lastPersistedProjectPhotoRef.current = key;

    try {
      const store = readDraftStore();
      const prev = (store as any)[draftId] ?? {};
      const next = {
        ...prev,
        projectPhotoUrl: typeof projectPhotoUrl === "string" && projectPhotoUrl.startsWith("data:") ? null : projectPhotoUrl,
        projectPhotoPath,
        projectPhotoDataUrl: typeof projectPhotoDataUrl === "string" && projectPhotoDataUrl.startsWith("data:") ? projectPhotoDataUrl : null,
        updatedAt: Date.now()
      };
      (store as any)[draftId] = next;
      try {
        writeDraftStore(store);
      } catch {
        // ignore
      }
      try {
        void upsertDraft({ id: draftId, data: next });
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  }, [draftId, projectPhotoUrl, projectPhotoPath, projectPhotoDataUrl]);

  const lastPersistedPreInstallRef = useRef<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!draftId) return;
    if (restoringRef.current) return;

    // Don't persist placeholder rows while uploads/compression are still running.
    if (preInstallPendingCount > 0) return;
    if (preInstallPhotos.some((p) => !String((p as any)?.src || "").trim())) return;

    const key = JSON.stringify(preInstallPhotos);
    if (lastPersistedPreInstallRef.current === key) return;
    lastPersistedPreInstallRef.current = key;

    const t = window.setTimeout(() => {
      try {
        const sanitized = sanitizePhotosForStorage({
          projectPhotoDataUrl: null,
          preInstallPhotos: (Array.isArray(preInstallPhotos) ? preInstallPhotos : []).map((p: any) => ({
            src: String(p?.src || ""),
            note: String(p?.note || ""),
            createdAt: Number(p?.createdAt) || Date.now()
          }))
        });
        const preInstallForStorage = mergePreInstallForStorage(preInstallPhotos, sanitized.preInstallPhotos);

        const store = readDraftStore();
        const prev = (store as any)[draftId] ?? {};
        const next = {
          ...prev,
          preInstallPhotos: preInstallForStorage,
          updatedAt: Date.now()
        };
        (store as any)[draftId] = next;
        try {
          writeDraftStore(store);
        } catch {
          // ignore
        }
        try {
          void upsertDraft({ id: draftId, data: next });
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }, 250);

    return () => window.clearTimeout(t);
  }, [draftId, preInstallPhotos, preInstallPendingCount]);

  useEffect(() => {
    const read = () => {
      if (typeof window === "undefined") return;
      try {
        const q = new URLSearchParams(window.location.search);
        const id = q.get("draft");
        const clone = q.get("clone");
        setDraftParam(id ? String(id) : null);
        setCloneParam(clone ? String(clone) : null);
        setDebugTotals(q.get("debugTotals") === "1");
      } catch {
        setDraftParam(null);
        setCloneParam(null);
        setDebugTotals(false);
      }
    };
    read();
    if (typeof window === "undefined") return;
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  useEffect(() => {
    const id = draftParam;
    if (!id) return;
    void loadDraft(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftParam]);

  useEffect(() => {
    const id = cloneParam;
    if (!id) return;
    // Clone-lite: copy only customer fields, segments, and additional services.
    void loadDraftForClone(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloneParam]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(unsavedSnapshotKey);
      if (!raw) return;
      const snap = JSON.parse(raw) as any;
      const snapDraftParam = typeof snap?.draftParam === "string" ? String(snap.draftParam) : null;
      const allow = (!draftParam && !snapDraftParam) || (draftParam && snapDraftParam === draftParam);
      if (!allow) return;
      void loadDraft("__snapshot__", { source: "snapshot" });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftParam]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!photoViewerSrc) return;
    setPhotoViewerScale(1);
    setPhotoViewerX(0);
    setPhotoViewerY(0);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPhotoViewerSrc(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [photoViewerSrc]);

  const viewerPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const viewerGestureRef = useRef<{
    startScale: number;
    startX: number;
    startY: number;
    startDist: number;
    startCenter: { x: number; y: number };
  } | null>(null);

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
  }

  function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

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

  const takeoffMaterialsWithAdditional = useMemo(() => {
    const base = takeoffMaterialsStable;
    const manual = Array.isArray(takeoffManualItems) ? takeoffManualItems : [];
    const addons = Array.isArray(takeoffPerPanelAddons) ? takeoffPerPanelAddons : [];

    const segmentLengths = segments
      .filter((s) => !s.removed)
      .map((s) => Number(s.length) || 0)
      .filter((n) => n > 0);

    const centerFt = (() => {
      if (selectedFenceType !== "wood") return null;
      if (selectedStyleKind === "wood_split_rail") return 10;
      if (selectedStyleKind === "wood_wire_mesh") {
        const normalizedWireMeshStyle = String(selectedStyle?.name || "")
          .trim()
          .toLowerCase()
          .replaceAll("/", ":")
          .replaceAll("-", " ")
          .replace(/\s+/g, " ");
        const isFiveQuarterTwoRailMesh = normalizedWireMeshStyle === "5:4 2 rail mesh";
        return isFiveQuarterTwoRailMesh ? 7.5 : 5.5;
      }
      if (useHorizontalCedarTakeoff) return 5.5;
      return 7.5;
    })();

    const panels = (() => {
      const c = Number(centerFt);
      if (!Number.isFinite(c) || c <= 0) return 0;
      if (segmentLengths.length) return segmentLengths.reduce((sum, len) => sum + Math.ceil(len / c), 0);
      const lf = Number(totalLf) || 0;
      return lf > 0 ? Math.ceil(lf / c) : 0;
    })();

    const derivedAddonItems: QuoteItem[] = addons
      .filter((a) => a && typeof a === "object")
      .filter((a) => String(a.desc || "").trim().length > 0)
      .filter((a) => panels > 0)
      .map((a) => {
        const qtyPerPanel = Number(a.qtyPerPanel) || 0;
        const unitPrice = Number(a.unitPrice) || 0;
        const qty = Math.round((qtyPerPanel * panels) * 1000) / 1000;
        const lineTotal = Math.round((qty * unitPrice) * 100) / 100;
        return {
          id: String(a.id || ""),
          section: "materials",
          name: String(a.desc || ""),
          qty,
          unit: "ea",
          unitPrice,
          lineTotal
        } as any;
      });

    const combined = derivedAddonItems.length ? [...manual, ...derivedAddonItems] : manual;
    return combined.length ? [...base, ...combined] : base;
  }, [segments, selectedFenceType, selectedStyle?.name, selectedStyleKind, takeoffManualItems, takeoffMaterialsStable, takeoffPerPanelAddons, totalLf, useHorizontalCedarTakeoff]);

  const takeoffPerPanelAddonItems = useMemo(() => {
    const addons = Array.isArray(takeoffPerPanelAddons) ? takeoffPerPanelAddons : [];
    const segmentLengths = segments
      .filter((s) => !s.removed)
      .map((s) => Number(s.length) || 0)
      .filter((n) => n > 0);

    const centerFt = (() => {
      if (selectedFenceType !== "wood") return null;
      if (selectedStyleKind === "wood_split_rail") return 10;
      if (selectedStyleKind === "wood_wire_mesh") {
        const normalizedWireMeshStyle = String(selectedStyle?.name || "")
          .trim()
          .toLowerCase()
          .replaceAll("/", ":")
          .replaceAll("-", " ")
          .replace(/\s+/g, " ");
        const isFiveQuarterTwoRailMesh = normalizedWireMeshStyle === "5:4 2 rail mesh";
        return isFiveQuarterTwoRailMesh ? 7.5 : 5.5;
      }
      if (useHorizontalCedarTakeoff) return 5.5;
      return 7.5;
    })();

    const panels = (() => {
      const c = Number(centerFt);
      if (!Number.isFinite(c) || c <= 0) return 0;
      if (segmentLengths.length) return segmentLengths.reduce((sum, len) => sum + Math.ceil(len / c), 0);
      const lf = Number(totalLf) || 0;
      return lf > 0 ? Math.ceil(lf / c) : 0;
    })();

    return addons
      .filter((a) => a && typeof a === "object")
      .filter((a) => String(a.desc || "").trim().length > 0)
      .filter(() => panels > 0)
      .map((a) => {
        const qtyPerPanel = Number(a.qtyPerPanel) || 0;
        const unitPrice = Number(a.unitPrice) || 0;
        const qty = Math.round((qtyPerPanel * panels) * 1000) / 1000;
        const lineTotal = Math.round((qty * unitPrice) * 100) / 100;
        return {
          id: String(a.id || ""),
          section: "materials",
          name: String(a.desc || ""),
          qty,
          unit: "ea",
          unitPrice,
          lineTotal
        } as any;
      });
  }, [segments, selectedFenceType, selectedStyle?.name, selectedStyleKind, takeoffPerPanelAddons, totalLf, useHorizontalCedarTakeoff]);

  const takeoffMaterialsTotal = useMemo(() => {
    const v = takeoffMaterialsWithAdditional.reduce((sum, m) => sum + (Number((m as any).lineTotal) || 0), 0);
    return Math.round(v * 100) / 100;
  }, [takeoffMaterialsWithAdditional]);

  const takeoffMaterialsAndExpensesBaseTotal = useMemo(() => {
    return computeMaterialsAndExpensesTotal(takeoffMaterialsWithAdditional);
  }, [takeoffMaterialsWithAdditional]);

  const takeoffMaterialsAndExpensesTotal = useMemo(() => {
    const v = Number(takeoffMaterialsAndExpensesBaseTotal) || 0;
    return Math.round(v * 100) / 100;
  }, [takeoffMaterialsAndExpensesBaseTotal]);

  const materialsDepositTotal = useMemo(() => {
    const v = Number(takeoffMaterialsAndExpensesTotal) || 0;
    return Math.round(v * 100) / 100;
  }, [takeoffMaterialsAndExpensesTotal]);

  const removalTotal = useMemo(() => {
    const lf = segments
      .filter((s: any) => Boolean((s as any).removal) || Boolean((s as any).removed))
      .reduce((sum: number, s: any) => sum + (Number(s.length) || 0), 0);
    const v = lf > 0 ? lf * 6 : 0;
    return Math.round(v * 100) / 100;
  }, [segments]);

  const removalLf = useMemo(() => {
    const lf = segments
      .filter((s: any) => Boolean((s as any).removal) || Boolean((s as any).removed))
      .reduce((sum: number, s: any) => sum + (Number(s.length) || 0), 0);
    return Math.round(lf * 100) / 100;
  }, [segments]);

  const laborBaseTotal = useMemo(() => {
    const base = items
      .filter((i) => i.section === "labor" && String(i.name || "") === "Days labor")
      .reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
    return Math.round(base * 100) / 100;
  }, [items]);

  const laborFeeItems = useMemo(() => {
    return items
      .filter((i) => i.section === "labor" && String(i.name || "") !== "Days labor")
      .map((i) => ({ name: String(i.name || ""), lineTotal: Math.round((Number(i.lineTotal) || 0) * 100) / 100 }))
      .filter((i) => i.lineTotal !== 0);
  }, [items]);

  const additionalFeeItems = useMemo(() => {
    const additional = items
      .filter((i) => i.section === "additional")
      .map((i) => ({ name: String(i.name || ""), lineTotal: Math.round((Number(i.lineTotal) || 0) * 100) / 100 }))
      .filter((i) => i.lineTotal !== 0);
    return [...laborFeeItems, ...additional];
  }, [items, laborFeeItems]);

  const additionalFeesTotal = useMemo(() => {
    const v = additionalFeeItems.reduce((sum, i) => sum + (Number(i.lineTotal) || 0), 0);
    return Math.round(v * 100) / 100;
  }, [additionalFeeItems]);

  const grandTotal = useMemo(() => {
    const v =
      (Number(materialsDepositTotal) || 0) +
      (Number(laborBaseTotal) || 0) +
      (Number(additionalFeesTotal) || 0) +
      (Number(removalTotal) || 0);
    return Math.round(v * 100) / 100;
  }, [additionalFeesTotal, laborBaseTotal, materialsDepositTotal, removalTotal]);

  const sharedTotal = useMemo(() => {
    const lf = Number(totalLf) || 0;
    if (lf <= 0) return 0;
    const jobTotal = Number(grandTotal) || 0;
    const perLf = jobTotal / lf;
    const v = perLf * (Number(sharedLf) || 0);
    return Math.round(v * 100) / 100;
  }, [grandTotal, sharedLf, totalLf]);

  const depositTotal = useMemo(() => {
    return Math.round((Number(materialsDepositTotal) || 0) * 100) / 100;
  }, [materialsDepositTotal]);

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

    const styleName = String(style.name || "").trim().toLowerCase();

    const normalized = styleName
      .replaceAll("/", ":")
      .replaceAll("-", " ")
      .replace(/\s+/g, " ");

    let overrides: Partial<typeof DEFAULT_MATERIALS_DETAILS> = {};

    if (styleName === "horizontal" || styleName === "horizontal cedar") {
      overrides = {
        woodType: "Cedar",
        railMaterial: "Cedar",
        picketMaterial: "Cedar",
        trimMaterial: "Cedar",
        twoByTwoMaterial: "Cedar",
        horizontalCedarBoardMaterial: "5/4 cedar",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "horizontal_cedar",
        horizontalCedarVerticals: true,
        horizontalCedarCornerAdjust: 0,
        topCaps: false
      };
    } else if (styleName === "picture framed flat top") {
      overrides = {
        woodType: "Pressure treated",
        picketMaterial: "Pressure treated",
        railMaterial: "Pressure treated",
        trimMaterial: "Pressure treated",
        twoByTwoMaterial: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        topCaps: true
      };
    } else if (styleName === "2 trim picutre framed") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: false,
        topCaps: true
      };
    } else if (styleName === "4' picture framed") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 8,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: false,
        topCaps: true
      };
    } else if (normalized === "5:4 2 rail mesh") {
      overrides = {
        woodType: "Cedar",
        postSize: 8,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: false,
        topCaps: false
      };
    } else if (styleName === "a & m") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: true,
        topCaps: false,
        pictureFrameTrimPieces: 5
      };
    } else if (styleName === "all cedar niko") {
      overrides = {
        woodType: "Cedar",
        railMaterial: "Cedar",
        picketMaterial: "Cedar",
        trimMaterial: "Cedar",
        twoByTwoMaterial: "Cedar",
        postSize: 10,
        postType: "Cedar",
        takeoffPreset: "standard",
        postCaps: false,
        topCaps: true
      };
    } else if (styleName === "niko") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: false,
        topCaps: true
      };
    } else if (styleName === "all cedar picture framed") {
      overrides = {
        woodType: "Cedar",
        railMaterial: "Cedar",
        picketMaterial: "Cedar",
        trimMaterial: "Cedar",
        twoByTwoMaterial: "Cedar",
        postSize: 10,
        postType: "Cedar",
        takeoffPreset: "standard",
        postCaps: false,
        topCaps: false
      };
    } else if (styleName === "casto") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: true,
        topCaps: false
      };
    } else if (normalized === "mary jane") {
      overrides = {
        woodType: "Cedar",
        railMaterial: "Cedar",
        picketMaterial: "Cedar",
        trimMaterial: "Cedar",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: true,
        topCaps: false
      };
    } else if (styleName === "picture framed caps") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: true,
        topCaps: false
      };
    } else if (styleName === "picture framed lattice panel") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        pictureFrameTrimPieces: 3,
        pictureFrameTrimMaterial: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: false,
        topCaps: true
      };
    } else if (styleName === "scalloped") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        vinylPanelHeightFt: 6,
        topCaps: false
      };
    } else if (styleName === "shadowbox top cap") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        vinylPanelHeightFt: 6,
        postCaps: false,
        topCaps: true
      };
    } else if (styleName === "board on board") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        topCaps: false
      };
    } else if (styleName === "four rail poplar") {
      overrides = {
        woodType: "Pressure treated",
        postDim: "6x6",
        railMaterial: "Pressure treated",
        postSize: 8,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        fourRailPoplarWireMesh: false,
        fourRailPoplarPostCaps: false,
        fourRailPoplarThreeRail: false,
        topCaps: false
      };
    } else if (styleName === "4 rail wire mesh") {
      overrides = {
        woodType: "Pressure treated",
        railMaterial: "Pressure treated",
        postDim: "4x4",
        postSize: 8,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        fourRailWireMeshWireMesh: false,
        fourRailWireMeshPostCaps: false,
        fourRailWireMeshThreeRail: false,
        topCaps: false
      };
    } else if (styleName === "hog wire") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 8,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: false,
        topCaps: true
      };
    } else if (styleName === "shadowbox") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: false,
        topCaps: false
      };
    } else if (styleName === "1x4 shadowbox") {
      overrides = {
        woodType: "Pressure treated",
        shadowboxBoardMaterial: "Pressure Treated",
        postSize: 10,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        postCaps: false,
        topCaps: false
      };
    } else if (styleName === "4 foot wire mesh") {
      overrides = {
        woodType: "Pressure treated",
        postSize: 8,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        topCaps: false
      };
    } else if (styleName.includes("split rail")) {
      overrides = {
        woodType: "Pressure treated",
        postSize: 8,
        postType: "Pressure treated",
        takeoffPreset: "standard",
        splitRailRails: 3,
        splitRailWireMesh: false,
        topCaps: false
      };
    }

    setMaterialsDetails(() => {
      const base = { ...DEFAULT_MATERIALS_DETAILS, ...overrides } as MaterialsDetails;
      const set = base.woodType;

      // If a style only specifies a woodType (material set), keep trim aligned by default.
      if (overrides.trimMaterial === undefined) base.trimMaterial = set;
      if (overrides.pictureFrameTrimMaterial === undefined) base.pictureFrameTrimMaterial = set;

      return base;
    });
    setStylePickerIdx(false);
    if (selectedFenceType === "vinyl") setMaterialsDetailsOpen(true);
  }

  const [stylePreview, setStylePreview] = useState<{ name: string; thumb: string } | null>(null);

  const visibleStyleOptions = useMemo(() => {
    return materialStyles.filter((st) => {
      if (st.type !== selectedFenceType) return false;
      if (selectedFenceType !== "vinyl") return true;
      return (st as any).group === vinylStyleTab;
    });
  }, [materialStyles, selectedFenceType, vinylStyleTab]);

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
      const laborExtras = [
        toughDigItem,
        gradeSurchargeItem,
        gradingItem,
        treeRemovalItem,
        stumpGrindingItem
      ].filter((it) => it.lineTotal !== 0);
      return [...takeoffMaterialsWithAdditional, laborItem, ...laborExtras, ...manual];
    });
  }, [laborItem, takeoffMaterialsWithAdditional, toughDigItem, gradeSurchargeItem, gradingItem, treeRemovalItem, stumpGrindingItem]);

  function addItem(section: SectionKey) {
    setItems((prev) => [...prev, emptyItem(section)]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function resetEstimate() {
    clearUnsavedSnapshot();

    const nextComboCardId =
      typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
        ? (crypto as any).randomUUID()
        : `card-${Date.now()}`;

    setCustomerName("");
    setProjectAddress("");
    setPhoneNumber("");
    setEmail("");
    setDraftId(null);
    setProjectPhoto(null);
    setStylePickerIdx(false);
    setMaterialsDetailsOpen(false);
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
    setVinylStyleTab("privacy");
    setSelectedStyle(null);
    setMaterialsDetails(DEFAULT_MATERIALS_DETAILS);
    setExtraPosts(0);
    setExtraPostSize(10);
    setComboCards([
      {
        id: nextComboCardId,
        fenceType: "wood",
        vinylStyleTab: "privacy",
        selectedStyle: null,
        materialsDetails: DEFAULT_MATERIALS_DETAILS,
        extraPosts: 0,
        extraPostSize: 10,
        shared: false
      }
    ]);
    setActiveComboCardId(nextComboCardId);

    setTakeoffUnitPriceOverrides({});
    setTakeoffUnitPriceOverrideDrafts({});

    setTakeoffManualItems([]);
    setTakeoffManualDraft({ desc: "", qty: "", unitPrice: "" });

    setTakeoffPerPanelAddons([]);
    setTakeoffPerPanelDraft({ desc: "", qtyPerPanel: "", unitPrice: "" });
  }

// ...

  async function loadDraftForClone(id: string) {
    let d: any = null;
    try {
      const store = readDraftStore();
      d = (store as any)[id] as any;
    } catch {
      d = null;
    }

    if (!d) {
      try {
        const remote = await fetchDraft({ id });
        if (remote.ok && remote.draft) {
          d = remote.draft as any;
        }
      } catch {
      }
    }

    if (!d) return;

    const nextComboCardId =
      typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
        ? (crypto as any).randomUUID()
        : `card-${Date.now()}`;

    restoringRef.current = true;
    setTimeout(() => {
      restoringRef.current = false;
    }, 0);

    setStylePickerIdx(false);
    setMaterialsDetailsOpen(false);
    setDraftId(null);
    setCustomerName(String(d.customerName ?? ""));
    setProjectAddress(String(d.projectAddress ?? ""));
    setPhoneNumber(String(d.phoneNumber ?? ""));
    setEmail(String(d.email ?? ""));

    setProjectPhoto(null);
    setProjectPhotoPath(null);
    setProjectPhotoUrl(null);
    setProjectPhotoDataUrl(null);

    setMeasureOpen(false);
    setTracePoints([]);
    setReferenceLength(0);
    setPickOcrForLabel(null);

    setSegments(Array.isArray(d.segments) ? (d.segments as any[]) : []);

    setSelectedFenceType("wood");
    setVinylStyleTab("privacy");
    setSelectedStyle(null);
    setMaterialsDetails(DEFAULT_MATERIALS_DETAILS);
    setExtraPosts(0);
    setComboCards([
      {
        id: nextComboCardId,
        fenceType: "wood",
        vinylStyleTab: "privacy",
        selectedStyle: null,
        materialsDetails: DEFAULT_MATERIALS_DETAILS,
        extraPosts: 0,
        shared: false
      }
    ]);
    setActiveComboCardId(nextComboCardId);

    setTakeoffUnitPriceOverrides({});
    setTakeoffUnitPriceOverrideDrafts({});

    const additionalItems = Array.isArray(d.items)
      ? (d.items as any[]).filter((it) => it && typeof it === "object" && (it as any).section === "additional")
      : [];
    setItems(additionalItems as QuoteItem[]);
  }

  async function loadDraft(id: string, opts?: { source?: "snapshot" | "draft" }) {
    let d: any = null;
    const source = opts?.source ?? "draft";
    const store = readDraftStore();
    if (source === "snapshot") {
      try {
        const raw = window.localStorage.getItem(unsavedSnapshotKey);
        d = raw ? (JSON.parse(raw) as any) : null;
      } catch {
        d = null;
      }
    } else {
      d = store[id] as any;
    }
    if (!d) {
      try {
        const remote = await fetchDraft({ id });
        if (remote.ok && remote.draft) {
          d = remote.draft as any;
          try {
            store[id] = d;
            writeDraftStore(store);
          } catch {
          }
        }
      } catch {
      }
    }
    if (!d) return;

    restoringRef.current = true;
    setTimeout(() => {
      restoringRef.current = false;
    }, 0);

    setStylePickerIdx(false);
    setMaterialsDetailsOpen(false);
    setMeasureOpen(false);

    const snapDraftId = source === "snapshot" && typeof (d as any).draftId === "string" ? String((d as any).draftId) : null;
    setDraftId(source === "snapshot" ? snapDraftId : id);
    setCustomerName(String(d.customerName ?? ""));
    setProjectAddress(String(d.projectAddress ?? ""));
    setPhoneNumber(String(d.phoneNumber ?? ""));
    setEmail(String(d.email ?? ""));
    setProjectPhoto(null);
    setProjectPhotoPath(typeof (d as any).projectPhotoPath === "string" ? (d as any).projectPhotoPath : null);
    const loadedUrl = typeof (d as any).projectPhotoUrl === "string" ? (d as any).projectPhotoUrl : null;
    const loadedData = typeof (d as any).projectPhotoDataUrl === "string" ? (d as any).projectPhotoDataUrl : null;
    setProjectPhotoDataUrl(loadedData && loadedData.startsWith("data:") ? loadedData : null);
    setProjectPhotoUrl(loadedUrl || (loadedData && loadedData.startsWith("data:") ? loadedData : null));
    // Restore combo cards (if present). Falls back to legacy single-card fields.
    const incomingCardsRaw = (d as any).comboCards;
    const incomingActiveIdRaw = (d as any).activeComboCardId;
    if (Array.isArray(incomingCardsRaw) && incomingCardsRaw.length > 0) {
      const normalizedCards = incomingCardsRaw
        .filter((c: any) => c && typeof c === "object")
        .map((c: any, idx: number) => {
          const cid = typeof c.id === "string" && c.id ? c.id : `card-${Date.now()}-${idx}`;
          const fenceType = (c.fenceType ?? "wood") as "wood" | "vinyl" | "aluminum" | "chainlink";
          const vinylStyleTab = (c.vinylStyleTab ?? "privacy") as "privacy" | "semi-privacy" | "pool" | "picket" | "horse";
          const selectedStyle = c.selectedStyle && typeof c.selectedStyle === "object" && typeof c.selectedStyle.name === "string" && typeof c.selectedStyle.thumb === "string"
            ? { name: c.selectedStyle.name, thumb: c.selectedStyle.thumb }
            : null;
          const materialsDetails = (c.materialsDetails && typeof c.materialsDetails === "object")
            ? ({ ...DEFAULT_MATERIALS_DETAILS, ...(c.materialsDetails as any) } as MaterialsDetails)
            : DEFAULT_MATERIALS_DETAILS;
          const extraPosts = Number(c.extraPosts) || 0;
          const extraPostSizeRaw = Number((c as any).extraPostSize);
          const extraPostSize = Number.isFinite(extraPostSizeRaw) ? extraPostSizeRaw : 10;
          const shared = typeof c.shared === "boolean" ? c.shared : false;
          return { id: cid, fenceType, vinylStyleTab, selectedStyle, materialsDetails, extraPosts, extraPostSize, shared };
        });

      const normalizedActiveId =
        typeof incomingActiveIdRaw === "string" && normalizedCards.some((c: any) => c.id === incomingActiveIdRaw)
          ? incomingActiveIdRaw
          : normalizedCards[0].id;

      setComboCards(normalizedCards);
      setActiveComboCardId(normalizedActiveId);

      const active = normalizedCards.find((c: any) => c.id === normalizedActiveId) || normalizedCards[0];
      if (active) {
        setSelectedFenceType(active.fenceType);
        setVinylStyleTab(active.vinylStyleTab);
        setSelectedStyle(active.selectedStyle);
        setMaterialsDetails(active.materialsDetails);
        setExtraPosts(Number(active.extraPosts) || 0);
        setExtraPostSize(Number.isFinite(Number((active as any).extraPostSize)) ? Number((active as any).extraPostSize) : 10);
      }
    } else {
      const fenceType = (d.selectedFenceType ?? "wood") as "wood" | "vinyl" | "aluminum" | "chainlink";
      setSelectedFenceType(fenceType);

      const rawStyle = (d as any).selectedStyle;
      const rawName =
        typeof rawStyle === "string"
          ? rawStyle
          : rawStyle && typeof rawStyle === "object" && typeof rawStyle.name === "string"
            ? rawStyle.name
            : null;

      const resolved = rawName
        ? materialStyles.find((st) => st.type === fenceType && st.name === rawName) ?? materialStyles.find((st) => st.name === rawName)
        : null;

      setSelectedStyle(
        resolved
          ? { name: resolved.name, thumb: resolved.thumb }
          : (rawStyle && typeof rawStyle === "object" && typeof rawStyle.name === "string" && typeof rawStyle.thumb === "string")
            ? { name: rawStyle.name, thumb: rawStyle.thumb }
            : null
      );
      setExtraPosts(Number((d as any).extraPosts) || 0);
      setExtraPostSize(Number.isFinite(Number((d as any).extraPostSize)) ? Number((d as any).extraPostSize) : 10);
    }

    if (d.materialsDetails && typeof d.materialsDetails === "object") {
      const dd = d.materialsDetails as any;
      const woodType = (dd.woodType === "Cedar" || dd.woodType === "Rough sawn cedar" || dd.woodType === "Cedar tone" || dd.woodType === "Pressure treated")
        ? dd.woodType
        : "Pressure treated";

      const horizontalCedarBoardProfile = dd.horizontalCedarBoardProfile === "1x6" || dd.horizontalCedarBoardProfile === "5/4"
        ? dd.horizontalCedarBoardProfile
        : "5/4";

      const horizontalCedarBoardMaterial =
        dd.horizontalCedarBoardMaterial === "5/4 cedar" ||
        dd.horizontalCedarBoardMaterial === "1x6 cedar" ||
        dd.horizontalCedarBoardMaterial === "CedarTone" ||
        dd.horizontalCedarBoardMaterial === "Pressure Treated"
          ? dd.horizontalCedarBoardMaterial
          : "5/4 cedar";

      const shadowboxBoardMaterial = dd.shadowboxBoardMaterial === "Cedar" || dd.shadowboxBoardMaterial === "Rough sawn cedar" || dd.shadowboxBoardMaterial === "Pressure Treated"
        ? dd.shadowboxBoardMaterial
        : "Pressure Treated";

      const wireMeshCornerBoardsOverride = Number.isFinite(Number(dd.wireMeshCornerBoardsOverride))
        ? Math.max(-1, Math.floor(Number(dd.wireMeshCornerBoardsOverride)))
        : -1;
      const wireMeshVerticalBoardsOverride = Number.isFinite(Number(dd.wireMeshVerticalBoardsOverride))
        ? Math.max(-1, Math.floor(Number(dd.wireMeshVerticalBoardsOverride)))
        : -1;

      const railMaterial = (dd.railMaterial === "Cedar" || dd.railMaterial === "Rough sawn cedar" || dd.railMaterial === "Cedar tone" || dd.railMaterial === "Pressure treated")
        ? dd.railMaterial
        : woodType;
      const picketMaterial = (
        dd.picketMaterial === "Cedar" ||
        dd.picketMaterial === "Rough sawn cedar" ||
        dd.picketMaterial === "Rough sawn cedar 5/8" ||
        dd.picketMaterial === "Rough sawn cedar 3/4" ||
        dd.picketMaterial === "Cedar tone" ||
        dd.picketMaterial === "Pressure treated"
      )
        ? dd.picketMaterial
        : woodType;
      const trimMaterial = (dd.trimMaterial === "Cedar" || dd.trimMaterial === "Rough sawn cedar" || dd.trimMaterial === "Cedar tone" || dd.trimMaterial === "Pressure treated")
        ? dd.trimMaterial
        : woodType;
      const twoByTwoMaterial = (dd.twoByTwoMaterial === "Cedar" || dd.twoByTwoMaterial === "Rough sawn cedar" || dd.twoByTwoMaterial === "Cedar tone" || dd.twoByTwoMaterial === "Pressure treated")
        ? dd.twoByTwoMaterial
        : woodType;
      const splitRailMaterial = (dd.splitRailMaterial === "Cedar tone" || dd.splitRailMaterial === "Pressure treated")
        ? dd.splitRailMaterial
        : "Pressure treated";

      const postType = (dd.postType === "Cedar" || dd.postType === "Rough sawn cedar" || dd.postType === "Cedar tone" || dd.postType === "Pressure treated")
        ? dd.postType
        : "Pressure treated";

      let postCaps = typeof dd.postCaps === "boolean" ? dd.postCaps : false;
      let topCaps = typeof (dd as any).topCaps === "boolean" ? (dd as any).topCaps : Boolean(dd.topCap);
      if (postCaps && topCaps) {
        topCaps = false;
      }
      const arbor = typeof dd.arbor === "boolean" ? dd.arbor : String(dd.arbor).toLowerCase() === "yes";

      const splitRailRails = dd.splitRailRails === 2 || dd.splitRailRails === 3
        ? dd.splitRailRails
        : 3;
      const splitRailWireMesh = typeof dd.splitRailWireMesh === "boolean" ? dd.splitRailWireMesh : false;
      const fourRailPoplarWireMesh = typeof dd.fourRailPoplarWireMesh === "boolean" ? dd.fourRailPoplarWireMesh : false;
      const fourRailPoplarPostCaps = typeof dd.fourRailPoplarPostCaps === "boolean" ? dd.fourRailPoplarPostCaps : false;
      const fourRailPoplarThreeRail = typeof dd.fourRailPoplarThreeRail === "boolean" ? dd.fourRailPoplarThreeRail : false;
      const fourRailWireMeshWireMesh = typeof dd.fourRailWireMeshWireMesh === "boolean" ? dd.fourRailWireMeshWireMesh : false;
      const fourRailWireMeshPostCaps = typeof dd.fourRailWireMeshPostCaps === "boolean" ? dd.fourRailWireMeshPostCaps : false;
      const fourRailWireMeshThreeRail = typeof dd.fourRailWireMeshThreeRail === "boolean" ? dd.fourRailWireMeshThreeRail : false;
      const splitRailCornerPosts = Number.isFinite(Number(dd.splitRailCornerPosts))
        ? Math.max(0, Math.floor(Number(dd.splitRailCornerPosts)))
        : 0;
      const splitRailEndPosts = Number.isFinite(Number(dd.splitRailEndPosts))
        ? Math.max(0, Math.floor(Number(dd.splitRailEndPosts)))
        : 0;
      const pictureFrameTrimPieces = (dd.pictureFrameTrimPieces === 2 || dd.pictureFrameTrimPieces === 3)
        ? dd.pictureFrameTrimPieces
        : 3;
      const pictureFrameTrimMaterial = (dd.pictureFrameTrimMaterial === "Cedar" || dd.pictureFrameTrimMaterial === "Rough sawn cedar" || dd.pictureFrameTrimMaterial === "Cedar tone" || dd.pictureFrameTrimMaterial === "Pressure treated")
        ? dd.pictureFrameTrimMaterial
        : woodType;
      const takeoffPreset = dd.takeoffPreset === "horizontal_cedar" || dd.takeoffPreset === "standard"
        ? dd.takeoffPreset
        : "standard";
      const horizontalCedarVerticals = typeof dd.horizontalCedarVerticals === "boolean" ? dd.horizontalCedarVerticals : false;
      const horizontalCedarCornerAdjust = Number.isFinite(Number(dd.horizontalCedarCornerAdjust))
        ? Number(dd.horizontalCedarCornerAdjust)
        : 0;

      const railEndBracketPacks = Number.isFinite(Number(dd.railEndBracketPacks))
        ? Math.max(0, Math.floor(Number(dd.railEndBracketPacks)))
        : (typeof dd.railEndBrackets === "boolean" ? (dd.railEndBrackets ? 1 : 0) : 0);

      const mansfieldWalkGateOptions = Array.isArray(dd.mansfieldWalkGateOptions)
        ? dd.mansfieldWalkGateOptions.map((x: any) => String(x))
        : [];
      const mansfieldDoubleGateOptions = Array.isArray(dd.mansfieldDoubleGateOptions)
        ? dd.mansfieldDoubleGateOptions.map((x: any) => String(x))
        : [];
      const atlanticWalkGateOptions = Array.isArray(dd.atlanticWalkGateOptions)
        ? dd.atlanticWalkGateOptions.map((x: any) => String(x))
        : [];
      const atlanticDoubleGateOptions = Array.isArray(dd.atlanticDoubleGateOptions)
        ? dd.atlanticDoubleGateOptions.map((x: any) => {
          const v = String(x);
          return v === "double_60_4_arched" ? "double_60_4" : v;
        })
        : [];
      const pacificWalkGateOptions = Array.isArray(dd.pacificWalkGateOptions)
        ? dd.pacificWalkGateOptions.map((x: any) => String(x))
        : [];
      const pacificDoubleGateOptions = Array.isArray(dd.pacificDoubleGateOptions)
        ? dd.pacificDoubleGateOptions.map((x: any) => String(x))
        : [];
      const toledoWalkGateOptions = Array.isArray(dd.toledoWalkGateOptions)
        ? dd.toledoWalkGateOptions.map((x: any) => {
          const v = String(x);
          if (v === "walk_48_5_arched") return "walk_48_5";
          if (v === "walk_60_5_arched") return "walk_60_5";
          return v;
        })
        : [];
      const toledoDoubleGateOptions = Array.isArray(dd.toledoDoubleGateOptions)
        ? dd.toledoDoubleGateOptions.map((x: any) => {
          const v = String(x);
          if (v === "double_60_4_arched") return "double_60_4";
          if (v === "double_60_5_arched") return "double_60_5";
          return v;
        })
        : [];
      const vinylColor = typeof dd.vinylColor === "string" ? dd.vinylColor : "White";
      const vinylPanelWidthFt = Number.isFinite(Number(dd.vinylPanelWidthFt)) ? Number(dd.vinylPanelWidthFt) : 6;
      const vinylPanelHeightFt = Number.isFinite(Number(dd.vinylPanelHeightFt)) ? Number(dd.vinylPanelHeightFt) : 6;
      const vinylCornerPosts = Number.isFinite(Number(dd.vinylCornerPosts))
        ? Math.max(0, Math.floor(Number(dd.vinylCornerPosts)))
        : (typeof dd.vinylCornerPosts === "boolean" ? (dd.vinylCornerPosts ? 1 : 0) : 0);
      const vinylEndPosts = Number.isFinite(Number(dd.vinylEndPosts))
        ? Math.max(0, Math.floor(Number(dd.vinylEndPosts)))
        : (typeof dd.vinylEndPosts === "boolean" ? (dd.vinylEndPosts ? 1 : 0) : 0);
      const vinylBlankPosts = Number.isFinite(Number(dd.vinylBlankPosts))
        ? Math.max(0, Math.floor(Number(dd.vinylBlankPosts)))
        : (typeof dd.vinylBlankPosts === "boolean" ? (dd.vinylBlankPosts ? 1 : 0) : 0);
      const vinylThreeWayPosts = Number.isFinite(Number(dd.vinylThreeWayPosts))
        ? Math.max(0, Math.floor(Number(dd.vinylThreeWayPosts)))
        : (typeof dd.vinylThreeWayPosts === "boolean" ? (dd.vinylThreeWayPosts ? 1 : 0) : 0);
      const vinylPostStiffeners = Number.isFinite(Number(dd.vinylPostStiffeners))
        ? Math.max(0, Math.floor(Number(dd.vinylPostStiffeners)))
        : (typeof dd.vinylPostStiffeners === "boolean" ? (dd.vinylPostStiffeners ? 1 : 0) : 0);
      const mansfieldBlankGatePost = typeof dd.mansfieldBlankGatePost === "boolean" ? dd.mansfieldBlankGatePost : false;

      setMaterialsDetails((prev) => ({
        ...prev,
        ...dd,
        woodType,
        railMaterial,
        picketMaterial,
        trimMaterial,
        twoByTwoMaterial,
        horizontalCedarBoardProfile,
        horizontalCedarBoardMaterial,
        shadowboxBoardMaterial,
        wireMeshCornerBoardsOverride,
        wireMeshVerticalBoardsOverride,
        postType,
        postCaps,
        topCaps,
        arbor,
        splitRailRails,
        splitRailWireMesh,
        splitRailMaterial,
        fourRailPoplarWireMesh,
        fourRailPoplarPostCaps,
        fourRailPoplarThreeRail,
        fourRailWireMeshWireMesh,
        fourRailWireMeshPostCaps,
        fourRailWireMeshThreeRail,
        splitRailCornerPosts,
        splitRailEndPosts,
        pictureFrameTrimPieces,
        pictureFrameTrimMaterial,
        takeoffPreset,
        horizontalCedarVerticals,
        horizontalCedarCornerAdjust,
        railEndBracketPacks,
        mansfieldWalkGateOptions,
        mansfieldDoubleGateOptions,
        atlanticWalkGateOptions,
        atlanticDoubleGateOptions,
        pacificWalkGateOptions,
        pacificDoubleGateOptions,
        toledoWalkGateOptions,
        toledoDoubleGateOptions,
        vinylColor,
        vinylPanelWidthFt,
        vinylPanelHeightFt,
        vinylCornerPosts,
        vinylEndPosts,
        vinylBlankPosts,
        vinylThreeWayPosts,
        vinylPostStiffeners,
        mansfieldBlankGatePost
      }));
    }
    if (d.materialUnitPrices && typeof d.materialUnitPrices === "object") {
      setMaterialUnitPrices((prev) => {
        const incoming = d.materialUnitPrices as Record<string, any>;
        const patch: Record<string, number> = {};
        for (const [k, v] of Object.entries(incoming)) {
          const n = Number(v);
          if (!Number.isFinite(n)) continue;
          // Prevent older drafts from wiping newer default prices.
          // If the incoming value is 0, only apply it when the previous value is also 0/empty.
          if (n === 0 && Number(prev[k] ?? 0) !== 0) continue;
          patch[k] = n;
        }
        if (!Object.keys(patch).length) return prev;
        return { ...prev, ...patch };
      });
    }

    if ((d as any).takeoffUnitPriceOverrides && typeof (d as any).takeoffUnitPriceOverrides === "object") {
      setTakeoffUnitPriceOverrides(() => {
        const incoming = (d as any).takeoffUnitPriceOverrides as Record<string, any>;
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(incoming)) {
          const n = Number(v);
          if (!Number.isFinite(n)) continue;
          out[String(k)] = n;
        }
        return out;
      });
    } else {
      setTakeoffUnitPriceOverrides({});
    }
    setTakeoffUnitPriceOverrideDrafts({});

    setTakeoffManualItems(
      Array.isArray((d as any).takeoffManualItems)
        ? (((d as any).takeoffManualItems as any[]) as QuoteItem[]).filter((x) => x && typeof x === "object")
        : []
    );
    setTakeoffManualDraft({ desc: "", qty: "", unitPrice: "" });

    setTakeoffPerPanelAddons(
      Array.isArray((d as any).takeoffPerPanelAddons)
        ? (((d as any).takeoffPerPanelAddons as any[]) as Array<{ id: string; desc: string; qtyPerPanel: number; unitPrice: number }>).filter((x) => x && typeof x === "object")
        : []
    );
    setTakeoffPerPanelDraft({ desc: "", qtyPerPanel: "", unitPrice: "" });
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
    setSegments(
      Array.isArray(d.segments)
        ? d.segments.map((s: any) => {
            const legacyGate = Boolean(s?.gate);
            const gateType = (s?.gateType === "walk" || s?.gateType === "double" || s?.gateType === "none")
              ? s.gateType
              : (legacyGate ? "walk" : "none");
            const cardId = (s?.cardId === null || typeof s?.cardId === "string") ? s.cardId : null;
            const legacyRemoved = Boolean(s?.removed);
            const removal = Boolean((s as any).removal) || legacyRemoved;
            return { ...s, removed: false, removal, cardId, gateType, gate: gateType === "walk" };
          })
        : []
    );
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

      if (!draftParam) {
        writeUnsavedSnapshot();
      }
      const id = String(draftParam || draftId || "").trim() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      if (!draftId) setDraftId(id);

      const payload = buildContractPayload(id);

      // Best-effort local preview cache (can fail on iOS when storage is full).
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }

      // Persist contract onto the draft so the contract page can fetch it remotely.
      try {
        const store = readDraftStore();
        const prev = (store as any)[id] ?? {};
        (store as any)[id] = {
          ...prev,
          ...buildDraftData(id),
          contract: payload,
          updatedAt: Date.now()
        };
        writeDraftStore(store);
        try {
          void upsertDraft({ id, data: (store as any)[id] });
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }

      // Navigate with draft id so contract page can fetch even if localStorage is unavailable.
      try {
        window.location.href = `/estimates/contract?draft=${encodeURIComponent(id)}`;
      } catch {
        router.push(`/estimates/contract?draft=${encodeURIComponent(id)}`);
      }
    } catch {
      // ignore
    }
  }

  const phoneDigits = String(phoneNumber || "").replace(/[^0-9+]/g, "");
  const canCall = phoneDigits.length >= 7;
  const canMessage = phoneDigits.length >= 7;
  const canNavigate = String(projectAddress || "").trim().length > 0;

  return (
    <div className="min-h-[100dvh] space-y-4 pb-[calc(env(safe-area-inset-bottom)+64px)]">
      {portalReady && photoViewerSrc ? createPortal(
        <div className="fixed inset-0 z-[90] grid place-items-center p-3" data-no-swipe="true">
          <div
            className="absolute inset-0 bg-[rgba(0,0,0,.78)]"
            onClick={() => setPhotoViewerSrc(null)}
          />
          <div
            className="relative w-full max-w-[980px]"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <GlassCard className="p-3 overflow-hidden">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-black truncate">Photo</div>
                <SecondaryButton data-no-swipe="true" onClick={() => setPhotoViewerSrc(null)}>
                  Close
                </SecondaryButton>
              </div>
              <div className="mt-2 rounded-2xl overflow-hidden border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]">
                <div
                  className="relative w-full max-h-[78dvh] overflow-hidden"
                  style={{ touchAction: "none" }}
                  onPointerDown={(e) => {
                    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                    viewerPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    const pts = Array.from(viewerPointersRef.current.values());
                    if (pts.length === 1) {
                      viewerGestureRef.current = {
                        startScale: photoViewerScale,
                        startX: photoViewerX,
                        startY: photoViewerY,
                        startDist: 0,
                        startCenter: { x: pts[0].x, y: pts[0].y }
                      };
                    }
                    if (pts.length >= 2) {
                      const a = pts[0];
                      const b = pts[1];
                      viewerGestureRef.current = {
                        startScale: photoViewerScale,
                        startX: photoViewerX,
                        startY: photoViewerY,
                        startDist: dist(a, b) || 1,
                        startCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
                      };
                    }
                  }}
                  onPointerMove={(e) => {
                    if (!viewerPointersRef.current.has(e.pointerId)) return;
                    viewerPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    const pts = Array.from(viewerPointersRef.current.values());
                    const g = viewerGestureRef.current;
                    if (!g) return;

                    if (pts.length >= 2) {
                      const a = pts[0];
                      const b = pts[1];
                      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                      const dNow = dist(a, b) || 1;
                      const nextScale = clamp(g.startScale * (dNow / (g.startDist || 1)), 1, 5);
                      const dx = center.x - g.startCenter.x;
                      const dy = center.y - g.startCenter.y;
                      setPhotoViewerScale(nextScale);
                      setPhotoViewerX(g.startX + dx);
                      setPhotoViewerY(g.startY + dy);
                      return;
                    }

                    if (pts.length === 1) {
                      const p = pts[0];
                      const dx = p.x - g.startCenter.x;
                      const dy = p.y - g.startCenter.y;
                      setPhotoViewerX(g.startX + dx);
                      setPhotoViewerY(g.startY + dy);
                    }
                  }}
                  onPointerUp={(e) => {
                    viewerPointersRef.current.delete(e.pointerId);
                    const pts = Array.from(viewerPointersRef.current.values());
                    if (pts.length === 1) {
                      viewerGestureRef.current = {
                        startScale: photoViewerScale,
                        startX: photoViewerX,
                        startY: photoViewerY,
                        startDist: 0,
                        startCenter: { x: pts[0].x, y: pts[0].y }
                      };
                      return;
                    }
                    if (pts.length === 0) {
                      viewerGestureRef.current = null;
                    }
                  }}
                  onPointerCancel={(e) => {
                    viewerPointersRef.current.delete(e.pointerId);
                    if (viewerPointersRef.current.size === 0) viewerGestureRef.current = null;
                  }}
                  onDoubleClick={() => {
                    setPhotoViewerScale(1);
                    setPhotoViewerX(0);
                    setPhotoViewerY(0);
                  }}
                >
                  <img
                    src={photoViewerSrc}
                    alt=""
                    className="block w-full h-auto object-contain"
                    style={{
                      transform: `translate3d(${photoViewerX}px, ${photoViewerY}px, 0) scale(${photoViewerScale})`,
                      transformOrigin: "center center",
                      willChange: "transform"
                    }}
                    draggable={false}
                  />
                </div>
              </div>
              <div className="mt-2 text-[11px] text-[var(--muted)]">Pinch to zoom</div>
            </GlassCard>
          </div>
        </div>,
        document.body
      ) : null}

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
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Phone number"
              />
            </div>
            <div>
              <div className="text-[11px] text-[var(--muted)] mb-1">Email</div>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
            </div>
          </div>
        </div>

        <div className="border-t border-[rgba(255,255,255,.12)] bg-[rgba(20,30,24,.55)] backdrop-blur-ios">
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

      <SectionTitle title="Project photo" />
      <GlassCard className="p-4">
        <div className="grid md:grid-cols-12 gap-3">
          <div className="md:col-span-5">
            <div className="text-[11px] text-[var(--muted)] mb-2">Upload</div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setProjectPhoto(file);
                if (file) {
                  fileToCompressedDataUrl(file, 1280, 0.72).then((data) => {
                    if (!data) return;
                    setProjectPhotoDataUrl(data);
                    setProjectPhotoUrl(data);
                    setProjectPhotoPath(null);
                  });
                }
              }}
              className="block w-full text-sm text-[rgba(255,255,255,.85)] file:mr-3 file:rounded-xl file:border file:border-[rgba(255,255,255,.16)] file:bg-[rgba(255,255,255,.10)] file:px-3 file:py-2 file:text-sm file:font-extrabold file:text-white"
            />

            <div className="mt-2">
              <SecondaryButton
                onClick={() => {
                  setProjectPhoto(null);
                  setProjectPhotoDataUrl(null);
                  setProjectPhotoUrl(null);
                  setProjectPhotoPath(null);
                }}
                disabled={!projectPhoto && !projectPhotoUrl && !projectPhotoDataUrl}
                data-no-swipe="true"
                className="w-full"
              >
                Clear photo
              </SecondaryButton>
            </div>
          </div>

          <div className="md:col-span-7">
            <div className="text-[11px] text-[var(--muted)] mb-1">Photo</div>
            <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] overflow-hidden">
              {projectPhotoUrl || projectPhotoDataUrl ? (
                <button
                  type="button"
                  data-no-swipe="true"
                  onClick={() => setPhotoViewerSrc(String(projectPhotoUrl || projectPhotoDataUrl || ""))}
                  className="block w-full text-left"
                >
                  <img
                    src={String(projectPhotoUrl || projectPhotoDataUrl || "")}
                    alt="Project photo"
                    className="w-full h-[260px] object-cover"
                  />
                </button>
              ) : (
                <div className="h-[260px] flex items-center justify-center text-sm text-[var(--muted)]">
                  Drop in a photo to save with this customer
                </div>
              )}
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2">
              <SecondaryButton
                onClick={() => {
                  const src = projectPhotoUrl || projectPhotoDataUrl;
                  if (!src) return;
                  setPhotoViewerSrc(src);
                }}
                disabled={!projectPhotoUrl && !projectPhotoDataUrl}
                data-no-swipe="true"
              >
                View photo
              </SecondaryButton>
            </div>
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
              className={(() => {
                if (comboCards.length <= 1) {
                  return "rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] px-2 py-2";
                }
                const assignedId = resolveSegmentCardId(seg);
                const idx = comboCards.findIndex((c) => c.id === assignedId);
                const base = "rounded-2xl border px-2 py-2 ";
                if (idx === 0) {
                  return base + "border-[rgba(255,214,10,.55)] bg-[rgba(255,214,10,.10)]";
                }
                if (idx === 1) {
                  return base + "border-[rgba(60,140,255,.70)] bg-[rgba(60,140,255,.14)]";
                }
                if (idx === 2) {
                  return base + "border-[rgba(170,90,255,.42)] bg-[rgba(170,90,255,.12)]";
                }
                if (idx === 3) {
                  return base + "border-[rgba(255,90,180,.40)] bg-[rgba(255,90,180,.10)]";
                }
                if (idx >= 4) {
                  return base + "border-[rgba(40,210,180,.40)] bg-[rgba(40,210,180,.10)]";
                }
                return "rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] px-2 py-2";
              })()}
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
                    type="tel"
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
                    onClick={() => {
                      const cur = (seg as any).gateType as ("none" | "walk" | "double" | undefined);
                      const legacy = Boolean((seg as any).gate);
                      const effective: "none" | "walk" | "double" = cur ?? (legacy ? "walk" : "none");
                      const next: "none" | "walk" | "double" = effective === "none" ? "walk" : effective === "walk" ? "double" : "none";
                      patchSegment(seg.id, { gateType: next, gate: next === "walk" });
                    }}
                    aria-pressed={
                      ((seg as any).gateType && (seg as any).gateType !== "none") ||
                      ((seg as any).gateType == null && Boolean((seg as any).gate))
                    }
                    aria-label="Gate"
                    title={(() => {
                      const cur = (seg as any).gateType as ("none" | "walk" | "double" | undefined);
                      const legacy = Boolean((seg as any).gate);
                      const effective: "none" | "walk" | "double" = cur ?? (legacy ? "walk" : "none");
                      return effective === "walk" ? "Walk gate" : effective === "double" ? "Double gate" : "No gate";
                    })()}
                    style={(() => {
                      const cur = (seg as any).gateType as ("none" | "walk" | "double" | undefined);
                      const legacy = Boolean((seg as any).gate);
                      const effective: "none" | "walk" | "double" = cur ?? (legacy ? "walk" : "none");

                      if (effective === "walk") {
                        return {
                          backgroundColor: "rgba(31,200,120,.22)",
                          borderColor: "rgba(31,200,120,.40)",
                          color: "rgba(235,255,245,.98)"
                        };
                      }

                      if (effective === "double") {
                        return {
                          backgroundColor: "rgba(60,140,255,.24)",
                          borderColor: "rgba(60,140,255,.70)",
                          color: "rgba(235,245,255,.98)"
                        };
                      }

                      return undefined;
                    })()}
                    className={
                      "w-full min-w-0 px-2 py-2 text-[14px] leading-none transition-none active:bg-[rgba(31,200,120,.22)] active:border-[rgba(31,200,120,.40)]"
                    }
                  >
                    {(() => {
                      const cur = (seg as any).gateType as ("none" | "walk" | "double" | undefined);
                      const legacy = Boolean((seg as any).gate);
                      const effective: "none" | "walk" | "double" = cur ?? (legacy ? "walk" : "none");
                      return effective === "walk" ? "🚪 W" : effective === "double" ? "🚪 D" : "🚪";
                    })()}
                  </SecondaryButton>
                  <SecondaryButton
                    type="button"
                    data-no-swipe="true"
                    onClick={() => patchSegment(seg.id, { removal: !Boolean((seg as any).removal) })}
                    aria-pressed={Boolean((seg as any).removal)}
                    aria-label="Fence removal"
                    title="Fence removal"
                    style={
                      Boolean((seg as any).removal)
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
                              type="tel"
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
                        <div className="text-[11px] text-[var(--muted)] mb-2">Cards</div>
                        <div className="grid gap-2">
                          {comboCards.map((c, idx) => (
                            <div
                              key={c.id}
                              className={
                                "rounded-2xl border p-2 bg-[rgba(255,255,255,.05)] " +
                                (c.id === activeComboCardId
                                  ? ""
                                  : "border-[rgba(255,255,255,.12)]")
                              }
                              style={(() => {
                                if (c.id !== activeComboCardId) return undefined;
                                if (Boolean((c as any).shared)) return { borderColor: "rgba(255,214,10,.55)", backgroundColor: "rgba(255,214,10,.08)" };
                                const accent = comboCardAccent(idx);
                                if (!accent) return { borderColor: "rgba(255,214,10,.55)", backgroundColor: "rgba(255,214,10,.08)" };
                                return { borderColor: accent.border, backgroundColor: accent.bg };
                              })()}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  data-no-swipe="true"
                                  onClick={() => setActiveComboCardId(c.id)}
                                  className="flex-1 text-left"
                                >
                                  <div className="text-sm font-black">{`Card ${idx + 1}`}</div>
                                  <div className="text-[11px] text-[var(--muted)] truncate">
                                    {String(c.fenceType || "").toUpperCase()}
                                    {c.selectedStyle?.name ? ` · ${c.selectedStyle.name}` : ""}
                                  </div>
                                </button>

                                <div className="flex items-center gap-1">
                                  {idx > 0 ? (
                                    <SecondaryButton
                                      data-no-swipe="true"
                                      aria-pressed={Boolean(c.shared)}
                                      onClick={() =>
                                        setComboCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, shared: !x.shared } : x)))
                                      }
                                      className={
                                        (c.shared
                                          ? "!bg-[rgba(60,140,255,.24)] !border-[rgba(60,140,255,.70)] !text-[rgba(235,245,255,.98)] "
                                          : "") + "px-3 py-2 text-[12px]"
                                      }
                                      title="Shared"
                                    >
                                      Shared
                                    </SecondaryButton>
                                  ) : null}
                                  {idx > 0 ? (
                                    <SecondaryButton
                                      data-no-swipe="true"
                                      className="px-2 py-2 text-[12px]"
                                      aria-label={`Delete Card ${idx + 1}`}
                                      title={`Delete Card ${idx + 1}`}
                                      onClick={() => deleteComboCard(c.id)}
                                    >
                                      ✕
                                    </SecondaryButton>
                                  ) : null}
                                </div>
                              </div>

                              {comboCards.length > 1 && segments.length ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {segments
                                    .filter((s) => !s.removed)
                                    .map((s) => {
                                      const assigned = resolveSegmentCardId(s);
                                      const onThis = assigned === c.id;
                                      const highlightClass =
                                        idx === 0
                                          ? "bg-[rgba(255,214,10,.30)] border-[rgba(255,214,10,.55)] text-[rgba(255,244,200,.98)]"
                                          : idx === 1
                                            ? "bg-[rgba(60,140,255,.24)] border-[rgba(60,140,255,.70)] text-[rgba(235,245,255,.98)]"
                                            : idx === 2
                                              ? "bg-[rgba(170,90,255,.22)] border-[rgba(170,90,255,.42)] text-[rgba(245,235,255,.98)]"
                                              : idx === 3
                                                ? "bg-[rgba(255,90,180,.20)] border-[rgba(255,90,180,.40)] text-[rgba(255,235,245,.98)]"
                                                : "bg-[rgba(40,210,180,.20)] border-[rgba(40,210,180,.40)] text-[rgba(235,255,252,.98)]";
                                      return (
                                        <button
                                          key={s.id}
                                          type="button"
                                          data-no-swipe="true"
                                          onClick={() => {
                                            const next = onThis ? null : c.id;
                                            patchSegment(s.id, { cardId: next });
                                          }}
                                          className={
                                            "rounded-xl px-3 py-2 text-[12px] font-black border transition-none " +
                                            (onThis
                                              ? highlightClass
                                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                                          }
                                          aria-pressed={onThis}
                                          title={onThis ? "Assigned" : "Assign"}
                                        >
                                          {s.label}
                                        </button>
                                      );
                                    })}
                                </div>
                              ) : null}
                            </div>
                          ))}
                          <PrimaryButton
                            data-no-swipe="true"
                            onClick={() => {
                              const id =
                                typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
                                  ? (crypto as any).randomUUID()
                                  : `card-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                              setComboCards((prev) => [
                                ...prev,
                                {
                                  id,
                                  fenceType: selectedFenceType,
                                  vinylStyleTab,
                                  selectedStyle,
                                  materialsDetails,
                                  extraPosts,
                                  shared: false
                                }
                              ]);
                              setActiveComboCardId(id);
                            }}
                            className="px-3 py-2 text-[12px]"
                          >
                            Combo
                          </PrimaryButton>
                        </div>

                        <div className="mt-2 text-[11px] text-[var(--muted)]">Use Combo to add a second tile, then assign segments to each card below.</div>
                      </div>

                      <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                        <div className="text-[11px] text-[var(--muted)] mb-1">Fence type</div>
                        <Select value={selectedFenceType} onChange={(e) => {
                          const next = e.target.value as "wood" | "vinyl" | "aluminum" | "chainlink";
                          setSelectedFenceType(next);
                          setSelectedStyle(null);
                          setMaterialsDetails({ ...DEFAULT_MATERIALS_DETAILS });
                          setVinylStyleTab("privacy");
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
                              ((materialsDetailsOpen || materialUnitPricesActive || (selectedStyle?.name === "Horizontal Cedar" ? horizontalCedarDetailsActive : materialsDetailsActive))
                                ? "!bg-[rgba(255,214,10,.34)] !border-[rgba(255,214,10,.65)] !text-[rgba(255,244,200,.98)] hover:!bg-[rgba(255,214,10,.34)] "
                                : "") +
                              "transition-colors duration-0 active:bg-[rgba(255,214,10,.34)] active:border-[rgba(255,214,10,.65)]"
                            }
                          >
                            Details
                          </SecondaryButton>
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
                              <div className="rounded-xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] px-2 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm font-extrabold">Manual line items</div>
                                </div>
                                <div className="mt-2 grid grid-cols-12 gap-2 items-end">
                                  <div className="col-span-12">
                                    <div className="text-[11px] text-[var(--muted)] mb-1">Description</div>
                                    <Input
                                      value={takeoffManualDraft.desc}
                                      onChange={(e) => setTakeoffManualDraft((p) => ({ ...p, desc: e.target.value }))}
                                      placeholder="Description"
                                    />
                                  </div>
                                  <div className="col-span-4">
                                    <div className="text-[11px] text-[var(--muted)] mb-1">Qty</div>
                                    <Input
                                      type="tel"
                                      inputMode="decimal"
                                      value={takeoffManualDraft.qty}
                                      onChange={(e) => setTakeoffManualDraft((p) => ({ ...p, qty: e.target.value }))}
                                      placeholder="0"
                                    />
                                  </div>
                                  <div className="col-span-4">
                                    <div className="text-[11px] text-[var(--muted)] mb-1">Unit Price</div>
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      value={takeoffManualDraft.unitPrice}
                                      onChange={(e) => setTakeoffManualDraft((p) => ({ ...p, unitPrice: e.target.value }))}
                                      placeholder="$"
                                    />
                                  </div>
                                  <div className="col-span-4">
                                    <div className="text-[11px] text-[var(--muted)] mb-1">Total</div>
                                    <div className="rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)] text-right font-black">
                                      {money(
                                        Math.round(
                                          ((Number(String(takeoffManualDraft.qty || "").trim()) || 0) *
                                            (Number(String(takeoffManualDraft.unitPrice || "").trim()) || 0)) *
                                            100
                                        ) / 100
                                      )}
                                    </div>
                                  </div>
                                  <div className="col-span-12">
                                    <PrimaryButton
                                      data-no-swipe="true"
                                      className="w-full px-3 py-2 text-[12px]"
                                      onClick={() => {
                                        const desc = String(takeoffManualDraft.desc || "").trim();
                                        const qty = Number(String(takeoffManualDraft.qty || "").trim());
                                        const unitPrice = Number(String(takeoffManualDraft.unitPrice || "").trim());
                                        const safeQty = Number.isFinite(qty) ? qty : 0;
                                        const safeUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
                                        if (!desc) return;
                                        const lineTotal = Math.round(safeQty * safeUnitPrice * 100) / 100;
                                        const id =
                                          typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
                                            ? (crypto as any).randomUUID()
                                            : `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                                        setTakeoffManualItems((prev) => [
                                          ...(Array.isArray(prev) ? prev : []),
                                          {
                                            id,
                                            section: "materials",
                                            name: desc,
                                            qty: safeQty,
                                            unit: "ea",
                                            unitPrice: safeUnitPrice,
                                            lineTotal
                                          } as any
                                        ]);
                                        setTakeoffManualDraft({ desc: "", qty: "", unitPrice: "" });
                                      }}
                                    >
                                      Add line item
                                    </PrimaryButton>
                                  </div>
                                </div>
                              </div>

                              {(Array.isArray(takeoffManualItems) ? takeoffManualItems : []).length ? (
                                <div className="grid gap-2">
                                  {(Array.isArray(takeoffManualItems) ? takeoffManualItems : []).map((m, mi) => (
                                    <div
                                      key={String((m as any).id || mi)}
                                      className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-2 py-2"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-sm font-extrabold truncate min-w-0">{String((m as any).name || "")}</div>
                                        <div className="flex items-center gap-2">
                                          <div className="text-sm font-black">{money(Number((m as any).lineTotal) || 0)}</div>
                                          <SecondaryButton
                                            data-no-swipe="true"
                                            className="px-3 py-2 text-[12px] !border-[rgba(255,80,80,.55)] !bg-[rgba(255,80,80,.22)] !text-white"
                                            onClick={() => setTakeoffManualItems((prev) => (Array.isArray(prev) ? prev : []).filter((_, i) => i !== mi))}
                                          >
                                            ✕
                                          </SecondaryButton>
                                        </div>
                                      </div>
                                      <div className="mt-1 grid grid-cols-12 gap-2 items-end">
                                        <div className="col-span-4">
                                          <div className="text-[11px] text-[var(--muted)] mb-1">Qty</div>
                                          <Input
                                            type="text"
                                            inputMode="decimal"
                                            value={String((m as any).qty ?? "")}
                                            onChange={(e) => {
                                              const raw = e.target.value;
                                              const qty = Number(String(raw || "").trim());
                                              setTakeoffManualItems((prev) =>
                                                (Array.isArray(prev) ? prev : []).map((row, i) => {
                                                  if (i !== mi) return row;
                                                  const safeQty = Number.isFinite(qty) ? qty : 0;
                                                  const unitPrice = Number((row as any).unitPrice) || 0;
                                                  const lineTotal = Math.round(safeQty * unitPrice * 100) / 100;
                                                  return { ...(row as any), qty: safeQty, lineTotal } as any;
                                                })
                                              );
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-4">
                                          <div className="text-[11px] text-[var(--muted)] mb-1">Unit Price</div>
                                          <Input
                                            type="text"
                                            inputMode="decimal"
                                            value={String((m as any).unitPrice ?? "")}
                                            onChange={(e) => {
                                              const raw = e.target.value;
                                              const unitPrice = Number(String(raw || "").trim());
                                              setTakeoffManualItems((prev) =>
                                                (Array.isArray(prev) ? prev : []).map((row, i) => {
                                                  if (i !== mi) return row;
                                                  const safeUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
                                                  const qty = Number((row as any).qty) || 0;
                                                  const lineTotal = Math.round(qty * safeUnitPrice * 100) / 100;
                                                  return { ...(row as any), unitPrice: safeUnitPrice, lineTotal } as any;
                                                })
                                              );
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-4">
                                          <div className="text-[11px] text-[var(--muted)] mb-1">Total</div>
                                          <div className="rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)] text-right font-black">
                                            {money(Number((m as any).lineTotal) || 0)}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {(Array.isArray(takeoffPerPanelAddonItems) ? takeoffPerPanelAddonItems : []).length ? (
                                <div className="grid gap-2">
                                  {(Array.isArray(takeoffPerPanelAddonItems) ? takeoffPerPanelAddonItems : []).map((m, mi) => (
                                    <div
                                      key={String((m as any).id || `addon-${mi}`)}
                                      className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-2 py-2"
                                      style={(() => {
                                        const idx = comboCards.findIndex((c) => c.id === activeComboCardId);
                                        const isSharedCard = Boolean(comboCards[idx]?.shared);
                                        if (isSharedCard) return undefined;
                                        const accent = comboCardAccent(idx);
                                        if (!accent) return undefined;
                                        return {
                                          borderColor: accent.border,
                                          backgroundColor: accent.bg
                                        };
                                      })()}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-sm font-extrabold truncate min-w-0">{String((m as any).name || "")}</div>
                                        <div className="text-sm font-black">{money(Number((m as any).lineTotal) || 0)}</div>
                                      </div>
                                      <div className="mt-1 grid grid-cols-12 gap-2 items-end">
                                        <div className="col-span-4">
                                          <div className="text-[11px] text-[var(--muted)] mb-1">Qty</div>
                                          <div className="rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)]">
                                            {Number((m as any).qty) || 0} {String((m as any).unit || "")}
                                          </div>
                                        </div>
                                        <div className="col-span-4">
                                          <div className="text-[11px] text-[var(--muted)] mb-1">Unit Price</div>
                                          <div className="rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)] text-right font-black">
                                            {money(Number((m as any).unitPrice) || 0)}
                                          </div>
                                        </div>
                                        <div className="col-span-4">
                                          <div className="text-[11px] text-[var(--muted)] mb-1">Total</div>
                                          <div className="rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)] text-right font-black">
                                            {money(Number((m as any).lineTotal) || 0)}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {generatedMaterials.map((m) => (
                                <div
                                  key={m.name}
                                  className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-2 py-2"
                                  style={(() => {
                                    const ids = Array.isArray((m as any).__cardIds) ? ((m as any).__cardIds as string[]) : [];
                                    const shared = Boolean((m as any).__shared);
                                    if (shared) return undefined;
                                    if (ids.length !== 1) return undefined;
                                    const idx = comboCards.findIndex((c) => c.id === ids[0]);
                                    const isSharedCard = Boolean(comboCards[idx]?.shared);
                                    if (isSharedCard) return undefined;
                                    const accent = comboCardAccent(idx);
                                    if (!accent) return undefined;
                                    return {
                                      borderColor: accent.border,
                                      backgroundColor: accent.bg
                                    };
                                  })()}
                                >
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
                                        type="tel"
                                        inputMode="decimal"
                                        value={
                                          takeoffUnitPriceOverrideDrafts[takeoffLineKeyForItem(m)] ??
                                          (() => {
                                            const k = takeoffLineKeyForItem(m);
                                            const override = Number((takeoffUnitPriceOverrides as any)[k]);
                                            if (Number.isFinite(override)) return String(override);
                                            return String(m.unitPrice ?? 0);
                                          })()
                                        }
                                        onChange={(e) =>
                                          setTakeoffUnitPriceOverrideDrafts((prev) => ({
                                            ...prev,
                                            [takeoffLineKeyForItem(m)]: e.target.value
                                          }))
                                        }
                                        onBlur={() => {
                                          const k = takeoffLineKeyForItem(m);
                                          const raw = takeoffUnitPriceOverrideDrafts[k];
                                          if (raw === undefined) return;
                                          const trimmed = String(raw || "").trim();
                                          const parsed = trimmed === "" ? NaN : Number(trimmed);
                                          setTakeoffUnitPriceOverrides((prev) => {
                                            const next = { ...prev };
                                            if (trimmed === "") {
                                              delete next[k];
                                            } else {
                                              next[k] = Number.isFinite(parsed) ? parsed : 0;
                                            }
                                            return next;
                                          });
                                          setTakeoffMaterialsStable((prev) =>
                                            (Array.isArray(prev) ? prev : []).map((row) => {
                                              const rk = takeoffLineKeyForItem(row);
                                              if (rk !== k) return row;
                                              const unitPrice = trimmed === "" ? Number((row as any).unitPrice) || 0 : (Number.isFinite(parsed) ? parsed : 0);
                                              const qty = Number((row as any).qty) || 0;
                                              const lineTotal = Math.round(qty * unitPrice * 100) / 100;
                                              return { ...(row as any), unitPrice, lineTotal } as QuoteItem;
                                            })
                                          );
                                          setTakeoffUnitPriceOverrideDrafts((prev) => {
                                            const next = { ...prev };
                                            delete next[k];
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

                              <div className="rounded-xl border border-[rgba(255,214,10,.35)] bg-[rgba(255,214,10,.10)] px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm font-extrabold">Materials &amp; Expenses Total</div>
                                  <div className="text-sm font-black">
                                    {money(takeoffMaterialsAndExpensesTotal)}
                                  </div>
                                </div>
                              </div>
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
                          <div className="grid md:grid-cols-12 gap-2 items-end">
                            <div className="md:col-span-5">
                              <div className="text-[11px] text-[var(--muted)] mb-1">Fence removal ($6/LF)</div>
                              <div className="text-[11px] text-[var(--muted)]">Tap 🗑 on segments to include them.</div>
                            </div>
                            <div className="md:col-span-4">
                              <div className="text-[11px] text-[var(--muted)] mb-1">Removal total</div>
                              <div className="rounded-xl px-3 py-2 text-[16px] md:text-sm bg-[rgba(255,255,255,.06)] border border-[rgba(255,255,255,.12)] text-right font-black">
                                {money(removalTotal)}
                              </div>
                              <div className="mt-1 text-[11px] text-[var(--muted)]">Removal LF {removalLf.toFixed(0)}</div>
                            </div>
                            <div className="md:col-span-3" />
                          </div>
                        </div>

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
                                    type="tel"
                                    inputMode="decimal"
                                    value={laborManualDays}
                                    onChange={(e) => setLaborManualDays(e.target.value)}
                                    placeholder="0"
                                  />
                                </div>
                                <div className="col-span-5">
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Manual cost</div>
                                  <Input
                                    type="tel"
                                    inputMode="decimal"
                                    value={laborManualCost}
                                    onChange={(e) => setLaborManualCost(e.target.value)}
                                    placeholder="$"
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
                              "w-full px-3 py-2 text-[12px] transition-none active:bg-[rgba(255,214,10,.34)] active:border-[rgba(255,214,10,.65)]"
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
                              "w-full px-3 py-2 text-[12px] transition-none active:bg-[rgba(255,214,10,.34)] active:border-[rgba(255,214,10,.65)]"
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
                                type="tel"
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
                                type="tel"
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
            const baseTs = Date.now();
            const placeholders: Array<{ src: string; srcPath?: string; note: string; createdAt: number }> = files.map((_, i) => ({
              src: "",
              srcPath: undefined,
              note: "",
              createdAt: baseTs + i
            }));

            placeholders.forEach((p) => {
              preInstallPendingRef.current.add(p.createdAt);
            });
            setPreInstallPendingCount(preInstallPendingRef.current.size);

            setPreInstallPhotos((prev) => [...prev, ...placeholders]);
            setNotePhotoIdx((cur) => (cur == null ? startIdx : cur));

            const draftIdForPhoto = draftId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            if (!draftId) setDraftId(draftIdForPhoto);

            files.forEach((file, i) => {
              const createdAt = baseTs + i;
              fileToCompressedDataUrl(file, 1280, 0.72).then((data) => {
                if (!data) return;
                setPreInstallPhotos((prev) => prev.map((p) => (p.createdAt === createdAt ? { ...p, src: data } : p)));
                if (preInstallPendingRef.current.has(createdAt)) {
                  preInstallPendingRef.current.delete(createdAt);
                  setPreInstallPendingCount(preInstallPendingRef.current.size);
                }
              });

              (async () => {
                const uploaded = await uploadDraftPhoto({
                  draftId: draftIdForPhoto,
                  file,
                  filename: (file as any)?.name,
                  kind: "preinstall"
                });
                if (uploaded.ok) {
                  setPreInstallPhotos((prev) => prev.map((p) => (p.createdAt === createdAt ? { ...p, src: uploaded.url, srcPath: uploaded.path } : p)));
                  if (preInstallPendingRef.current.has(createdAt)) {
                    preInstallPendingRef.current.delete(createdAt);
                    setPreInstallPendingCount(preInstallPendingRef.current.size);
                  }
                  return;
                }
                const blob = await fileToCompressedBlob(file, 1280, 0.72);
                if (!blob) return;
                const uploaded2 = await uploadDraftPhoto({
                  draftId: draftIdForPhoto,
                  file: blob,
                  filename: (file as any)?.name,
                  kind: "preinstall"
                });
                if (!uploaded2.ok) return;
                setPreInstallPhotos((prev) => prev.map((p) => (p.createdAt === createdAt ? { ...p, src: uploaded2.url, srcPath: uploaded2.path } : p)));
                if (preInstallPendingRef.current.has(createdAt)) {
                  preInstallPendingRef.current.delete(createdAt);
                  setPreInstallPendingCount(preInstallPendingRef.current.size);
                }
              })().catch(() => {
                // ignore
              });
            });

            e.target.value = "";
          }}
        />

        {preInstallPhotos.length ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {preInstallPhotos.map((p, idx) => (
              <div key={`${idx}`} className="relative rounded-xl overflow-hidden border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)]">
                <button
                  type="button"
                  data-no-swipe="true"
                  onClick={() => setPhotoViewerSrc(p.src)}
                  className="relative block w-full text-left"
                >
                  <div className="relative w-full aspect-square">
                    <NextImage src={p.src} alt="" fill sizes="120px" className="object-cover" />
                  </div>
                </button>
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

                {selectedFenceType === "vinyl" ? (
                  <div className="mt-3">
                    <div className="grid grid-cols-5 gap-2">
                      <button
                        type="button"
                        data-no-swipe="true"
                        onClick={() => setVinylStyleTab("privacy")}
                        className={
                          "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none font-extrabold " +
                          (vinylStyleTab === "privacy"
                            ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                            : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                        }
                      >
                        Privacy
                      </button>
                      <button
                        type="button"
                        data-no-swipe="true"
                        onClick={() => setVinylStyleTab("semi-privacy")}
                        className={
                          "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none font-extrabold " +
                          (vinylStyleTab === "semi-privacy"
                            ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                            : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                        }
                      >
                        Semi-Privacy
                      </button>
                      <button
                        type="button"
                        data-no-swipe="true"
                        onClick={() => setVinylStyleTab("pool")}
                        className={
                          "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none font-extrabold " +
                          (vinylStyleTab === "pool"
                            ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                            : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                        }
                      >
                        Pool
                      </button>
                      <button
                        type="button"
                        data-no-swipe="true"
                        onClick={() => setVinylStyleTab("horse")}
                        className={
                          "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none font-extrabold " +
                          (vinylStyleTab === "horse"
                            ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                            : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                        }
                      >
                        Horse
                      </button>
                      <button
                        type="button"
                        data-no-swipe="true"
                        onClick={() => setVinylStyleTab("picket")}
                        className={
                          "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none font-extrabold " +
                          (vinylStyleTab === "picket"
                            ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                            : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                        }
                      >
                        Picket
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {visibleStyleOptions.map((st) => (
                    <button
                      key={st.name}
                      type="button"
                      onClick={() => setStylePreview({ name: st.name, thumb: st.thumb })}
                      className={
                        "rounded-2xl border p-2 text-left transition-none " +
                        (selectedStyle?.name === st.name
                          ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)]"
                          : "border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)]")
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={st.thumb}
                        alt=""
                        className="w-full aspect-[4/3] rounded-xl object-cover"
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (img.dataset.fallbackDone === "1") return;
                          img.dataset.fallbackDone = "1";
                          img.src =
                            "data:image/svg+xml;charset=utf-8," +
                            encodeURIComponent(
                              `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 60'>
                                <rect width='80' height='60' rx='12' fill='rgba(255,255,255,.08)'/>
                                <rect x='10' y='10' width='60' height='40' rx='10' fill='rgba(0,0,0,.18)'/>
                                <path d='M18 40l10-10 10 10 10-12 14 18H18z' fill='rgba(255,255,255,.22)'/>
                                <circle cx='28' cy='24' r='5' fill='rgba(255,255,255,.22)'/>
                              </svg>`
                            );
                        }}
                      />
                      <div className="mt-2 text-sm font-extrabold">{st.name}</div>
                    </button>
                  ))}
                </div>

                {portalReady && stylePreview
                  ? createPortal(
                    <div className="fixed inset-0 z-[70]" data-no-swipe="true">
                      <div
                        className="absolute inset-0 bg-[rgba(0,0,0,.75)]"
                        onClick={() => setStylePreview(null)}
                      />
                      <div className="absolute inset-0">
                        {(() => {
                          const idx = visibleStyleOptions.findIndex((s) => s.name === stylePreview.name);
                          const hasPrev = idx > 0;
                          const hasNext = idx >= 0 && idx < visibleStyleOptions.length - 1;
                          const goPrev = () => {
                            if (!hasPrev) return;
                            const prev = visibleStyleOptions[idx - 1];
                            setStylePreview({ name: prev.name, thumb: prev.thumb });
                          };
                          const goNext = () => {
                            if (!hasNext) return;
                            const next = visibleStyleOptions[idx + 1];
                            setStylePreview({ name: next.name, thumb: next.thumb });
                          };
                          return (
                            <>
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  goPrev();
                                }}
                                disabled={!hasPrev}
                                className={
                                  "absolute left-3 top-1/2 -translate-y-1/2 z-[80] rounded-full border px-3 py-2 text-[18px] font-black backdrop-blur-ios " +
                                  (hasPrev
                                    ? "border-[rgba(255,255,255,.18)] bg-[rgba(20,30,24,.72)]"
                                    : "border-[rgba(255,255,255,.10)] bg-[rgba(20,30,24,.35)] opacity-50")
                                }
                                aria-label="Previous style"
                              >
                                ‹
                              </button>
                              <button
                                type="button"
                                data-no-swipe="true"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  goNext();
                                }}
                                disabled={!hasNext}
                                className={
                                  "absolute right-3 top-1/2 -translate-y-1/2 z-[80] rounded-full border px-3 py-2 text-[18px] font-black backdrop-blur-ios " +
                                  (hasNext
                                    ? "border-[rgba(255,255,255,.18)] bg-[rgba(20,30,24,.72)]"
                                    : "border-[rgba(255,255,255,.10)] bg-[rgba(20,30,24,.35)] opacity-50")
                                }
                                aria-label="Next style"
                              >
                                ›
                              </button>
                            </>
                          );
                        })()}

                        <div className="absolute left-0 right-0 top-0 z-[85] flex items-center justify-between gap-3 p-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}>
                          <SecondaryButton
                            data-no-swipe="true"
                            onClick={() => setStylePreview(null)}
                          >
                            Back
                          </SecondaryButton>
                          <div className="text-sm font-extrabold truncate">{stylePreview.name}</div>
                          <PrimaryButton
                            data-no-swipe="true"
                            onClick={() => {
                              setMaterialStyle(stylePreview);
                              setStylePreview(null);
                            }}
                          >
                            OK
                          </PrimaryButton>
                        </div>
                        <div className="absolute inset-0 grid place-items-center p-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={stylePreview.thumb}
                            alt=""
                            className="max-h-[78dvh] w-full max-w-[980px] rounded-2xl object-contain border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)]"
                            onError={(e) => {
                              const img = e.currentTarget;
                              if (img.dataset.fallbackDone === "1") return;
                              img.dataset.fallbackDone = "1";
                              img.src =
                                "data:image/svg+xml;charset=utf-8," +
                                encodeURIComponent(
                                  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 60'>
                                    <rect width='80' height='60' rx='12' fill='rgba(255,255,255,.08)'/>
                                    <rect x='10' y='10' width='60' height='40' rx='10' fill='rgba(0,0,0,.18)'/>
                                    <path d='M18 40l10-10 10 10 10-12 14 18H18z' fill='rgba(255,255,255,.22)'/>
                                    <circle cx='28' cy='24' r='5' fill='rgba(255,255,255,.22)'/>
                                  </svg>`
                                );
                            }}
                          />
                        </div>
                      </div>
                    </div>,
                    document.body
                  )
                  : null}
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

                <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {selectedFenceType === "aluminum" ? (
                    <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                      <div className="text-[11px] text-[var(--muted)] mb-2">Aluminum details</div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Panel height</div>
                          <Select
                            value={String(materialsDetails.aluminumPanelHeight)}
                            onChange={(e) =>
                              setMaterialsDetails((p) => ({
                                ...p,
                                aluminumPanelHeight: Math.max(0, Number(e.target.value) || 0)
                              }))
                            }
                          >
                            {aluminumAllowedPanelHeights.map((h) => (
                              <option key={h} value={String(h)}>
                                {h === 54 ? "4.5'" : `${Math.round(h / 12)}'`}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Panel width</div>
                          <div className="rounded-xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] px-3 py-2 text-[13px] font-black">
                            6 ft
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2">
                        <div className="text-[11px] text-[var(--muted)]">Post selectors</div>

                        <button
                          type="button"
                          data-no-swipe="true"
                          onClick={() => setMaterialsDetails((p) => ({ ...p, aluminumGateAuto: !p.aluminumGateAuto }))}
                          className={
                            "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none font-extrabold text-left " +
                            (materialsDetails.aluminumGateAuto
                              ? "bg-[rgba(255,214,10,.20)] border-[rgba(255,214,10,.55)]"
                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                          }
                          aria-pressed={materialsDetails.aluminumGateAuto}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>Auto-fill gate posts</div>
                            <div className="text-[11px] text-[var(--muted)]">{materialsDetails.aluminumGateAuto ? "On" : "Off"}</div>
                          </div>
                        </button>

                        {selectedStyle?.name === "Mansfield" && (activeCardWalkGates > 0 || activeCardDoubleGates > 0) ? (
                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Gate options</div>
                            <div className="text-[10px] text-[var(--muted)] mb-2">Applies after you mark gates. Select each gate’s size/price.</div>

                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div className="col-span-2">
                                <div className="text-[11px] text-[var(--muted)] mb-1">Blank gate post ($65.99)</div>
                                <button
                                  type="button"
                                  data-no-swipe="true"
                                  onClick={() =>
                                    setMaterialsDetails((p) => ({
                                      ...p,
                                      mansfieldBlankGatePost: !p.mansfieldBlankGatePost
                                    }))
                                  }
                                  className={
                                    "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none font-extrabold text-left " +
                                    (materialsDetails.mansfieldBlankGatePost
                                      ? "bg-[rgba(255,214,10,.20)] border-[rgba(255,214,10,.55)]"
                                      : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                                  }
                                  aria-pressed={materialsDetails.mansfieldBlankGatePost}
                                >
                                  <div className="flex items-center justify-between">
                                    <div>{materialsDetails.mansfieldBlankGatePost ? "On" : "Off"}</div>
                                    <div className="text-[11px] text-[var(--muted)]">Tap</div>
                                  </div>
                                </button>
                              </div>
                            </div>

                            {(materialsDetails.mansfieldWalkGateOptions || []).map((v, i) => (
                              <div key={`walk-${i}`} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 items-center mb-2">
                                <div className="text-[12px] font-extrabold">Walk gate {i + 1}</div>
                                <div className="min-w-0">
                                  <Select
                                    value={v}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        mansfieldWalkGateOptions: (p.mansfieldWalkGateOptions || []).map((cur, idx) =>
                                          idx === i ? String(e.target.value) : cur
                                        )
                                      }))
                                    }
                                    disabled={!([48, 60].includes(Number(materialsDetails.aluminumPanelHeight) || 0))}
                                  >
                                    {Number(materialsDetails.aluminumPanelHeight) === 60 ? (
                                      <>
                                        <option value="walk_48_5">
                                          48" wide x 5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "WALK", widthIn: 48, hIn: 60 }) }))}
                                        </option>
                                        <option value="walk_60_5">
                                          60" wide x 5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "WALK", widthIn: 60, hIn: 60 }) }))}
                                        </option>
                                      </>
                                    ) : (
                                      <>
                                        <option value="walk_48_4">
                                          48" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "WALK", widthIn: 48, hIn: 48 }) }))}
                                        </option>
                                        <option value="walk_60_4">
                                          60" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "WALK", widthIn: 60, hIn: 48 }) }))}
                                        </option>
                                      </>
                                    )}
                                  </Select>
                                </div>
                              </div>
                            ))}

                            {(materialsDetails.mansfieldDoubleGateOptions || []).map((v, i) => (
                              <div key={`double-${i}`} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 items-center">
                                <div className="text-[12px] font-extrabold">Double gate {i + 1}</div>
                                <div className="min-w-0">
                                  <Select
                                    value={v}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        mansfieldDoubleGateOptions: (p.mansfieldDoubleGateOptions || []).map((cur, idx) =>
                                          idx === i ? String(e.target.value) : cur
                                        )
                                      }))
                                    }
                                    disabled={!([48, 60].includes(Number(materialsDetails.aluminumPanelHeight) || 0))}
                                  >
                                    {Number(materialsDetails.aluminumPanelHeight) === 60 ? (
                                      <>
                                        <option value="double_48_5">
                                          48" wide x 5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "DOUBLE", widthIn: 48, hIn: 60 }) }))}
                                        </option>
                                        <option value="double_60_5">
                                          60" wide x 5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "DOUBLE", widthIn: 60, hIn: 60 }) }))}
                                        </option>
                                      </>
                                    ) : (
                                      <>
                                        <option value="double_48_4">
                                          48" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "DOUBLE", widthIn: 48, hIn: 48 }) }))}
                                        </option>
                                        <option value="double_60_4">
                                          60" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Mansfield", kind: "DOUBLE", widthIn: 60, hIn: 48 }) }))}
                                        </option>
                                      </>
                                    )}
                                  </Select>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {selectedStyle?.name === "Pacific" && (activeCardWalkGates > 0 || activeCardDoubleGates > 0) ? (
                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Gate options</div>
                            <div className="text-[10px] text-[var(--muted)] mb-2">Select each gate’s size/price.</div>

                            {(materialsDetails.pacificWalkGateOptions || []).map((v, i) => (
                              <div key={`pac-walk-${i}`} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 items-center mb-2">
                                <div className="text-[12px] font-extrabold">Walk gate {i + 1}</div>
                                <div className="min-w-0">
                                  <Select
                                    value={v}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        pacificWalkGateOptions: (p.pacificWalkGateOptions || []).map((cur, idx) =>
                                          idx === i ? String(e.target.value) : cur
                                        )
                                      }))
                                    }
                                    disabled={!([48, 60].includes(Number(materialsDetails.aluminumPanelHeight) || 0))}
                                  >
                                    <option value="walk_48_45">
                                      48" wide x 4.5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Pacific", kind: "WALK", widthIn: 48, hIn: 54 }) }))}
                                    </option>
                                    <option value="walk_60_45">
                                      60" wide x 4.5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Pacific", kind: "WALK", widthIn: 60, hIn: 54 }) }))}
                                    </option>
                                  </Select>
                                </div>
                              </div>
                            ))}

                            {(materialsDetails.pacificDoubleGateOptions || []).map((v, i) => (
                              <div key={`pac-double-${i}`} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 items-center">
                                <div className="text-[12px] font-extrabold">Double gate {i + 1}</div>
                                <div className="min-w-0">
                                  <Select
                                    value={v}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        pacificDoubleGateOptions: (p.pacificDoubleGateOptions || []).map((cur, idx) =>
                                          idx === i ? String(e.target.value) : cur
                                        )
                                      }))
                                    }
                                    disabled={!([48, 60].includes(Number(materialsDetails.aluminumPanelHeight) || 0))}
                                  >
                                    <option value="double_48_45">
                                      48" wide x 4.5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Pacific", kind: "DOUBLE", widthIn: 48, hIn: 54 }) }))}
                                    </option>
                                    <option value="double_60_45">
                                      60" wide x 4.5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Pacific", kind: "DOUBLE", widthIn: 60, hIn: 54 }) }))}
                                    </option>
                                  </Select>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {selectedStyle?.name === "Atlantic" && (activeCardWalkGates > 0 || activeCardDoubleGates > 0) ? (
                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Gate options</div>
                            <div className="text-[10px] text-[var(--muted)] mb-2">Select each gate’s size/price.</div>

                            {(materialsDetails.atlanticWalkGateOptions || []).length > 0 ? (
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.04)] px-3 py-2 text-[11px] text-[var(--muted)] mb-2">
                                Atlantic walk gate pricing currently configured for 4' height only.
                              </div>
                            ) : null}

                            {(materialsDetails.atlanticWalkGateOptions || []).map((v, i) => (
                              <div key={`atl-walk-${i}`} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 items-center mb-2">
                                <div className="text-[12px] font-extrabold">Walk gate {i + 1}</div>
                                <div className="min-w-0">
                                  <Select
                                    value={v}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        atlanticWalkGateOptions: (p.atlanticWalkGateOptions || []).map((cur, idx) =>
                                          idx === i ? String(e.target.value) : cur
                                        )
                                      }))
                                    }
                                    disabled={Number(materialsDetails.aluminumPanelHeight) !== 48}
                                  >
                                    <option value="walk_48_4">
                                      48" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Atlantic", kind: "WALK", widthIn: 48, hIn: 48 }) }))}
                                    </option>
                                    <option value="walk_60_4">
                                      60" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Atlantic", kind: "WALK", widthIn: 60, hIn: 48 }) }))}
                                    </option>
                                  </Select>
                                </div>
                              </div>
                            ))}

                            {(materialsDetails.atlanticDoubleGateOptions || []).map((v, i) => (
                              <div key={`atl-double-${i}`} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 items-center">
                                <div className="text-[12px] font-extrabold">Double gate {i + 1}</div>
                                <div className="min-w-0">
                                  <Select
                                    value={v}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        atlanticDoubleGateOptions: (p.atlanticDoubleGateOptions || []).map((cur, idx) =>
                                          idx === i ? String(e.target.value) : cur
                                        )
                                      }))
                                    }
                                    disabled={Number(materialsDetails.aluminumPanelHeight) !== 48}
                                  >
                                    <option value="double_48_4">
                                      48" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Atlantic", kind: "DOUBLE", widthIn: 48, hIn: 48 }) }))}
                                    </option>
                                    <option value="double_60_4">
                                      60" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Atlantic", kind: "DOUBLE", widthIn: 60, hIn: 48 }) }))}
                                    </option>
                                  </Select>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {selectedStyle?.name === "Toledo" && (activeCardWalkGates > 0 || activeCardDoubleGates > 0) ? (
                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Gate options</div>
                            <div className="text-[10px] text-[var(--muted)] mb-2">Select each gate’s size/price.</div>

                            {(materialsDetails.toledoWalkGateOptions || []).map((v, i) => (
                              <div key={`tol-walk-${i}`} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 items-center mb-2">
                                <div className="text-[12px] font-extrabold">Walk gate {i + 1}</div>
                                <div className="min-w-0">
                                  <Select
                                    value={v}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        toledoWalkGateOptions: (p.toledoWalkGateOptions || []).map((cur, idx) =>
                                          idx === i ? String(e.target.value) : cur
                                        )
                                      }))
                                    }
                                    disabled={!([48, 60].includes(Number(materialsDetails.aluminumPanelHeight) || 0))}
                                  >
                                    {Number(materialsDetails.aluminumPanelHeight) === 60 ? (
                                      <>
                                        <option value="walk_48_5">
                                          48\" wide x 5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "WALK", widthIn: 48, hIn: 60 }) }))}
                                        </option>
                                        <option value="walk_60_5">
                                          60\" wide x 5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "WALK", widthIn: 60, hIn: 60 }) }))}
                                        </option>
                                      </>
                                    ) : (
                                      <>
                                        <option value="walk_48_4">
                                          48\" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "WALK", widthIn: 48, hIn: 48 }) }))}
                                        </option>
                                        <option value="walk_60_4">
                                          60\" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "WALK", widthIn: 60, hIn: 48 }) }))}
                                        </option>
                                      </>
                                    )}
                                  </Select>
                                </div>
                              </div>
                            ))}

                            {(materialsDetails.toledoDoubleGateOptions || []).map((v, i) => (
                              <div key={`tol-double-${i}`} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 items-center">
                                <div className="text-[12px] font-extrabold">Double gate {i + 1}</div>
                                <div className="min-w-0">
                                  <Select
                                    value={v}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        toledoDoubleGateOptions: (p.toledoDoubleGateOptions || []).map((cur, idx) =>
                                          idx === i ? String(e.target.value) : cur
                                        )
                                      }))
                                    }
                                    disabled={!([48, 60].includes(Number(materialsDetails.aluminumPanelHeight) || 0))}
                                  >
                                    {Number(materialsDetails.aluminumPanelHeight) === 60 ? (
                                      <>
                                        <option value="double_48_5">
                                          48\" wide x 5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "DOUBLE", widthIn: 48, hIn: 60 }) }))}
                                        </option>
                                        <option value="double_60_5">
                                          60\" wide x 5' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "DOUBLE", widthIn: 60, hIn: 60 }) }))}
                                        </option>
                                      </>
                                    ) : (
                                      <>
                                        <option value="double_48_4">
                                          48\" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "DOUBLE", widthIn: 48, hIn: 48 }) }))}
                                        </option>
                                        <option value="double_60_4">
                                          60\" wide x 4' high — {money(getUnitPriceFromMap({ materialUnitPrices, name: "", priceKey: aluminumGatePriceKey({ style: "Toledo", kind: "DOUBLE", widthIn: 60, hIn: 48 }) }))}
                                        </option>
                                      </>
                                    )}
                                  </Select>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Corner posts</div>
                            <div className="grid grid-cols-3 gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    aluminumCornerPosts: Math.max(0, (Number(p.aluminumCornerPosts) || 0) - 1)
                                  }))
                                }
                              >
                                -
                              </PrimaryButton>
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                {Math.max(0, Number(materialsDetails.aluminumCornerPosts) || 0)}
                              </div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    aluminumCornerPosts: Math.max(0, (Number(p.aluminumCornerPosts) || 0) + 1)
                                  }))
                                }
                              >
                                +
                              </PrimaryButton>
                            </div>
                          </div>

                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">End posts</div>
                            <div className="grid grid-cols-3 gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    aluminumEndPosts: Math.max(0, (Number(p.aluminumEndPosts) || 0) - 1)
                                  }))
                                }
                              >
                                -
                              </PrimaryButton>
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                {Math.max(0, Number(materialsDetails.aluminumEndPosts) || 0)}
                              </div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    aluminumEndPosts: Math.max(0, (Number(p.aluminumEndPosts) || 0) + 1)
                                  }))
                                }
                              >
                                +
                              </PrimaryButton>
                            </div>
                          </div>

                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Gate posts</div>
                            <div className="grid grid-cols-3 gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    aluminumGatePosts: Math.max(0, (Number(p.aluminumGatePosts) || 0) - 1)
                                  }))
                                }
                                disabled={materialsDetails.aluminumGateAuto}
                              >
                                -
                              </PrimaryButton>
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                {materialsDetails.aluminumGateAuto ? aluminumPostsSummary.gateDerived : Math.max(0, Number(materialsDetails.aluminumGatePosts) || 0)}
                              </div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    aluminumGatePosts: Math.max(0, (Number(p.aluminumGatePosts) || 0) + 1)
                                  }))
                                }
                                disabled={materialsDetails.aluminumGateAuto}
                              >
                                +
                              </PrimaryButton>
                            </div>
                            <div className="mt-1 text-[10px] text-[var(--muted)]">Auto = 2 posts per gate (incl. doubles)</div>
                          </div>

                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Blank posts</div>
                            <div className="grid grid-cols-3 gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    aluminumBlankPosts: Math.max(0, (Number(p.aluminumBlankPosts) || 0) - 1)
                                  }))
                                }
                              >
                                -
                              </PrimaryButton>
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                {Math.max(0, Number(materialsDetails.aluminumBlankPosts) || 0)}
                              </div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    aluminumBlankPosts: Math.max(0, (Number(p.aluminumBlankPosts) || 0) + 1)
                                  }))
                                }
                              >
                                +
                              </PrimaryButton>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2">
                          <div className="text-[11px] text-[var(--muted)]">Total posts</div>
                          <div className="text-[14px] font-black">{aluminumPostsSummary.total}</div>
                        </div>
                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2">
                          <div className="text-[11px] text-[var(--muted)]">Line posts</div>
                          <div className="text-[14px] font-black">{aluminumPostsSummary.line}</div>
                        </div>
                      </div>
                    </div>
                  ) : selectedFenceType === "vinyl" ? (
                    <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                      <div className="text-[11px] text-[var(--muted)] mb-2">Vinyl details</div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Panel height</div>
                          <Select
                            value={String(materialsDetails.vinylPanelHeightFt)}
                            onChange={(e) => setMaterialsDetails((p) => ({ ...p, vinylPanelHeightFt: Number(e.target.value) }))}
                            disabled={!selectedStyle}
                          >
                            {vinylAllowed.heights.map((h: number) => (
                              <option key={h} value={String(h)}>{h}'</option>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Panel width</div>
                          <Select
                            value={String(materialsDetails.vinylPanelWidthFt)}
                            onChange={(e) => setMaterialsDetails((p) => ({ ...p, vinylPanelWidthFt: Number(e.target.value) }))}
                            disabled={!selectedStyle}
                          >
                            {vinylAllowed.widths.map((w: number) => (
                              <option key={w} value={String(w)}>{w}'</option>
                            ))}
                          </Select>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="text-[11px] text-[var(--muted)] mb-1">Color</div>
                        <div className="rounded-xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.04)] p-2">
                          <div className="grid grid-cols-6 gap-2">
                            {(() => {
                              const preferredOrder = [
                                "White",
                                "Tan",
                                "Khaki",
                                "Gray",
                                "Cedar woodgrain",
                                "Coastal gray woodgrain",
                                "Black"
                              ];
                              const allowed = (vinylAllowed.colors || []) as string[];
                              const ordered = preferredOrder.filter((c) => allowed.includes(c));
                              const remainder = allowed.filter((c) => !preferredOrder.includes(c));
                              const colors = [...ordered, ...remainder];

                              return colors.map((c) => {
                                const sw = vinylColorSwatches[c] ?? { label: c, bg: "rgba(255,255,255,.10)", fg: "rgba(255,255,255,.92)", border: "rgba(255,255,255,.18)" };
                                const active = String(materialsDetails.vinylColor) === c;
                                return (
                                  <button
                                    key={c}
                                    type="button"
                                    data-no-swipe="true"
                                    disabled={!selectedStyle}
                                    onClick={() => setMaterialsDetails((p) => ({ ...p, vinylColor: c }))}
                                    className={
                                      "h-10 rounded-lg border text-[11px] font-black transition-none " +
                                      (active
                                        ? "ring-2 ring-[rgba(255,214,10,.55)]"
                                        : "")
                                    }
                                    style={{
                                      background: sw.bg,
                                      color: sw.fg,
                                      borderColor: active ? "rgba(255,214,10,.65)" : sw.border
                                    }}
                                    aria-pressed={active}
                                  >
                                    {sw.label}
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2">
                          <div className="text-[11px] text-[var(--muted)]">Panels</div>
                          <div className="text-[14px] font-black">{vinylSummary.panels}</div>
                        </div>
                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2">
                          <div className="text-[11px] text-[var(--muted)]">Posts</div>
                          <div className="text-[14px] font-black">{vinylSummary.posts}</div>
                        </div>
                      </div>

                      <div className="mt-2 text-[11px] text-[var(--muted)]">
                        {selectedStyle ? `${selectedStyle.name}` : "Select a style"}
                      </div>

                      <div className="mt-3 rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                        <div className="text-[11px] text-[var(--muted)] mb-2">Hardware</div>
                        <div className="grid gap-2">
                          {[
                            { name: "1.5\" x 5.5\" U-mount", code: "AXBR!UMOUNT!1.5X5.5" },
                            { name: "1.5\" x 5.5\" Post Hole Cover", code: "AXCP!CVR!1.5X5.5" },
                            { name: "5\" x 5\" x 54\" Concrete Mount", code: "AXPT!CMOUNT!5X54" },
                            { name: "4\" x 4\" x 36\" Concrete Mount", code: "AXPT!CMOUNT!4X36" },
                            { name: "2\" x 3.5\" Post Hole Cover", code: "AXCP!CVR!1.75X3.5" },
                            { name: "Hinged Screw Cap", code: "AXCP!SCREWCAP" },
                            { name: "Self Tapping Screw", code: "AMFA!SCREWTAP-1.0ss" },
                            { name: "2\" x 3.5\" U-mount", code: "AXBR!UMOUNT!2X3.5" },
                            { name: "2\" x 6\" U-mount", code: "AXBR!UMOUNT!2X6" },
                            { name: "1.5\" x 5.5\" External U-mount", code: "AXBR!UMOUNTEXT!1.5X5.5" }
                          ].map((it) => (
                            <div key={it.code} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                              <div className="text-[12px] font-extrabold truncate">{it.name}</div>
                              <div className="text-[11px] font-black text-[rgba(255,255,255,.92)] rounded-lg border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] px-2 py-1">
                                {it.code}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2">
                        <div className="text-[11px] text-[var(--muted)]">Post selectors</div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Corner posts</div>
                            <div className="grid grid-cols-3 gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() => setMaterialsDetails((p) => ({ ...p, vinylCornerPosts: Math.max(0, Math.floor(Number(p.vinylCornerPosts) || 0) - 1) }))}
                              >
                                -
                              </PrimaryButton>
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                {Math.max(0, Math.floor(Number(materialsDetails.vinylCornerPosts) || 0))}
                              </div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() => setMaterialsDetails((p) => ({ ...p, vinylCornerPosts: Math.max(0, Math.floor(Number(p.vinylCornerPosts) || 0) + 1) }))}
                              >
                                +
                              </PrimaryButton>
                            </div>
                          </div>

                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">End posts</div>
                            <div className="grid grid-cols-3 gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() => setMaterialsDetails((p) => ({ ...p, vinylEndPosts: Math.max(0, Math.floor(Number(p.vinylEndPosts) || 0) - 1) }))}
                              >
                                -
                              </PrimaryButton>
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                {Math.max(0, Math.floor(Number(materialsDetails.vinylEndPosts) || 0))}
                              </div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() => setMaterialsDetails((p) => ({ ...p, vinylEndPosts: Math.max(0, Math.floor(Number(p.vinylEndPosts) || 0) + 1) }))}
                              >
                                +
                              </PrimaryButton>
                            </div>
                          </div>

                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Blank posts</div>
                            <div className="grid grid-cols-3 gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() => setMaterialsDetails((p) => ({ ...p, vinylBlankPosts: Math.max(0, Math.floor(Number(p.vinylBlankPosts) || 0) - 1) }))}
                              >
                                -
                              </PrimaryButton>
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                {Math.max(0, Math.floor(Number(materialsDetails.vinylBlankPosts) || 0))}
                              </div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() => setMaterialsDetails((p) => ({ ...p, vinylBlankPosts: Math.max(0, Math.floor(Number(p.vinylBlankPosts) || 0) + 1) }))}
                              >
                                +
                              </PrimaryButton>
                            </div>
                          </div>

                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                            <div className="text-[11px] text-[var(--muted)] mb-1">3-way posts</div>
                            <div className="grid grid-cols-3 gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() => setMaterialsDetails((p) => ({ ...p, vinylThreeWayPosts: Math.max(0, Math.floor(Number(p.vinylThreeWayPosts) || 0) - 1) }))}
                              >
                                -
                              </PrimaryButton>
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                {Math.max(0, Math.floor(Number(materialsDetails.vinylThreeWayPosts) || 0))}
                              </div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() => setMaterialsDetails((p) => ({ ...p, vinylThreeWayPosts: Math.max(0, Math.floor(Number(p.vinylThreeWayPosts) || 0) + 1) }))}
                              >
                                +
                              </PrimaryButton>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                          <div className="text-[11px] text-[var(--muted)] mb-1">Post stiffeners</div>
                          <div className="grid grid-cols-3 gap-2">
                            <PrimaryButton
                              type="button"
                              data-no-swipe="true"
                              className="px-3 py-2 text-[12px]"
                              onClick={() => setMaterialsDetails((p) => ({ ...p, vinylPostStiffeners: Math.max(0, Math.floor(Number(p.vinylPostStiffeners) || 0) - 1) }))}
                            >
                              -
                            </PrimaryButton>
                            <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                              {Math.max(0, Math.floor(Number(materialsDetails.vinylPostStiffeners) || 0))}
                            </div>
                            <PrimaryButton
                              type="button"
                              data-no-swipe="true"
                              className="px-3 py-2 text-[12px]"
                              onClick={() => setMaterialsDetails((p) => ({ ...p, vinylPostStiffeners: Math.max(0, Math.floor(Number(p.vinylPostStiffeners) || 0) + 1) }))}
                            >
                              +
                            </PrimaryButton>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {selectedStyleKind === "wood_four_rail_poplar" ? (
                    <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                      <div className="text-[11px] text-[var(--muted)] mb-2">Four rail poplar</div>

                      <div>
                        <div className="text-[11px] text-[var(--muted)] mb-1">Wire mesh</div>
                        <button
                          type="button"
                          data-no-swipe="true"
                          onClick={() => setMaterialsDetails((p) => ({ ...p, fourRailPoplarWireMesh: !p.fourRailPoplarWireMesh }))}
                          className={
                            "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                            (materialsDetails.fourRailPoplarWireMesh
                              ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                          }
                          aria-pressed={materialsDetails.fourRailPoplarWireMesh}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-extrabold">{materialsDetails.fourRailPoplarWireMesh ? "On" : "Off"}</div>
                            <div className="text-[11px] text-[var(--muted)]">Tap</div>
                          </div>
                        </button>
                      </div>

                      <div className="mt-2">
                        <div className="text-[11px] text-[var(--muted)] mb-1">Post caps</div>
                        <button
                          type="button"
                          data-no-swipe="true"
                          onClick={() => setMaterialsDetails((p) => ({ ...p, fourRailPoplarPostCaps: !p.fourRailPoplarPostCaps }))}
                          className={
                            "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                            (materialsDetails.fourRailPoplarPostCaps
                              ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                          }
                          aria-pressed={materialsDetails.fourRailPoplarPostCaps}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-extrabold">{materialsDetails.fourRailPoplarPostCaps ? "On" : "Off"}</div>
                            <div className="text-[11px] text-[var(--muted)]">Tap</div>
                          </div>
                        </button>
                      </div>

                      <div className="mt-2">
                        <div className="text-[11px] text-[var(--muted)] mb-1">3 rail</div>
                        <button
                          type="button"
                          data-no-swipe="true"
                          onClick={() => setMaterialsDetails((p) => ({ ...p, fourRailPoplarThreeRail: !p.fourRailPoplarThreeRail }))}
                          className={
                            "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                            (materialsDetails.fourRailPoplarThreeRail
                              ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                          }
                          aria-pressed={materialsDetails.fourRailPoplarThreeRail}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-extrabold">{materialsDetails.fourRailPoplarThreeRail ? "On" : "Off"}</div>
                            <div className="text-[11px] text-[var(--muted)]">Tap</div>
                          </div>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {selectedStyleKind === "wood_4_rail_wire_mesh" ? (
                    <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                      <div className="text-[11px] text-[var(--muted)] mb-2">4 rail wire mesh</div>

                      <div>
                        <div className="text-[11px] text-[var(--muted)] mb-1">Wire mesh</div>
                        <button
                          type="button"
                          data-no-swipe="true"
                          onClick={() => setMaterialsDetails((p) => ({ ...p, fourRailWireMeshWireMesh: !p.fourRailWireMeshWireMesh }))}
                          className={
                            "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                            (materialsDetails.fourRailWireMeshWireMesh
                              ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                          }
                          aria-pressed={materialsDetails.fourRailWireMeshWireMesh}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-extrabold">{materialsDetails.fourRailWireMeshWireMesh ? "On" : "Off"}</div>
                            <div className="text-[11px] text-[var(--muted)]">Tap</div>
                          </div>
                        </button>
                      </div>

                      <div className="mt-2">
                        <div className="text-[11px] text-[var(--muted)] mb-1">Post caps</div>
                        <button
                          type="button"
                          data-no-swipe="true"
                          onClick={() => setMaterialsDetails((p) => ({ ...p, fourRailWireMeshPostCaps: !p.fourRailWireMeshPostCaps }))}
                          className={
                            "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                            (materialsDetails.fourRailWireMeshPostCaps
                              ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                          }
                          aria-pressed={materialsDetails.fourRailWireMeshPostCaps}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-extrabold">{materialsDetails.fourRailWireMeshPostCaps ? "On" : "Off"}</div>
                            <div className="text-[11px] text-[var(--muted)]">Tap</div>
                          </div>
                        </button>
                      </div>

                      <div className="mt-2">
                        <div className="text-[11px] text-[var(--muted)] mb-1">3 rail</div>
                        <button
                          type="button"
                          data-no-swipe="true"
                          onClick={() => setMaterialsDetails((p) => ({ ...p, fourRailWireMeshThreeRail: !p.fourRailWireMeshThreeRail }))}
                          className={
                            "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                            (materialsDetails.fourRailWireMeshThreeRail
                              ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                              : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                          }
                          aria-pressed={materialsDetails.fourRailWireMeshThreeRail}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-extrabold">{materialsDetails.fourRailWireMeshThreeRail ? "On" : "Off"}</div>
                            <div className="text-[11px] text-[var(--muted)]">Tap</div>
                          </div>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {selectedStyleKind === "wood_wire_mesh" && String(selectedStyle?.name || "")
                    .trim()
                    .toLowerCase()
                    .replaceAll("/", ":")
                    .replaceAll("-", " ")
                    .replace(/\s+/g, " ") === "5:4 2 rail mesh" ? (
                      <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                        <div className="text-[11px] text-[var(--muted)] mb-2">5:4 2 rail mesh</div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="text-[11px] text-[var(--muted)] mb-1">Verticals</div>
                            <button
                              type="button"
                              data-no-swipe="true"
                              onClick={() => setMaterialsDetails((p) => ({ ...p, fiveQuarterTwoRailMeshVerticals: !p.fiveQuarterTwoRailMeshVerticals }))}
                              className={
                                "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                                (materialsDetails.fiveQuarterTwoRailMeshVerticals
                                  ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                                  : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                              }
                              aria-pressed={materialsDetails.fiveQuarterTwoRailMeshVerticals}
                            >
                              <div className="flex items-center justify-between">
                                <div className="font-extrabold">{materialsDetails.fiveQuarterTwoRailMeshVerticals ? "On" : "Off"}</div>
                                <div className="text-[11px] text-[var(--muted)]">Adds posts/3</div>
                              </div>
                            </button>
                          </div>

                          <div>
                            <div className="text-[11px] text-[var(--muted)] mb-1">Corners</div>
                            <button
                              type="button"
                              data-no-swipe="true"
                              onClick={() => setMaterialsDetails((p) => ({ ...p, fiveQuarterTwoRailMeshCorners: !p.fiveQuarterTwoRailMeshCorners }))}
                              className={
                                "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                                (materialsDetails.fiveQuarterTwoRailMeshCorners
                                  ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                                  : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                              }
                              aria-pressed={materialsDetails.fiveQuarterTwoRailMeshCorners}
                            >
                              <div className="flex items-center justify-between">
                                <div className="font-extrabold">{materialsDetails.fiveQuarterTwoRailMeshCorners ? "On" : "Off"}</div>
                                <div className="text-[11px] text-[var(--muted)]">Adds corners</div>
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                  {selectedStyleKind === "wood_wire_mesh" && String(selectedStyle?.name || "")
                    .trim()
                    .toLowerCase()
                    .replaceAll("/", ":")
                    .replaceAll("-", " ")
                    .replace(/\s+/g, " ") !== "5:4 2 rail mesh" ? (
                      <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                        <div className="text-[11px] text-[var(--muted)] mb-2">Wire mesh</div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="text-[11px] text-[var(--muted)] mb-1">Corners</div>
                            <div className="grid grid-cols-3 gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    wireMeshCornerBoardsOverride: Math.max(
                                      -1,
                                      Math.floor((Number(p.wireMeshCornerBoardsOverride) || -1) - 1)
                                    )
                                  }))
                                }
                              >
                                -
                              </PrimaryButton>
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                {(Number(materialsDetails.wireMeshCornerBoardsOverride) || -1) < 0
                                  ? "Auto"
                                  : String(Math.max(0, Math.floor(Number(materialsDetails.wireMeshCornerBoardsOverride) || 0)))}
                              </div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    wireMeshCornerBoardsOverride: Math.max(0, Math.floor((Number(p.wireMeshCornerBoardsOverride) || -1) + 1))
                                  }))
                                }
                              >
                                +
                              </PrimaryButton>
                            </div>
                            <button
                              type="button"
                              data-no-swipe="true"
                              onClick={() => setMaterialsDetails((p) => ({ ...p, wireMeshCornerBoardsOverride: -1 }))}
                              className="mt-2 w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]"
                            >
                              <div className="flex items-center justify-between">
                                <div className="font-extrabold">Auto</div>
                                <div className="text-[11px] text-[var(--muted)]">Reset</div>
                              </div>
                            </button>
                          </div>

                          <div>
                            <div className="text-[11px] text-[var(--muted)] mb-1">Verticals</div>
                            <div className="grid grid-cols-3 gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    wireMeshVerticalBoardsOverride: Math.max(
                                      -1,
                                      Math.floor((Number(p.wireMeshVerticalBoardsOverride) || -1) - 1)
                                    )
                                  }))
                                }
                              >
                                -
                              </PrimaryButton>
                              <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                {(Number(materialsDetails.wireMeshVerticalBoardsOverride) || -1) < 0
                                  ? "Auto"
                                  : String(Math.max(0, Math.floor(Number(materialsDetails.wireMeshVerticalBoardsOverride) || 0)))}
                              </div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="px-3 py-2 text-[12px]"
                                onClick={() =>
                                  setMaterialsDetails((p) => ({
                                    ...p,
                                    wireMeshVerticalBoardsOverride: Math.max(0, Math.floor((Number(p.wireMeshVerticalBoardsOverride) || -1) + 1))
                                  }))
                                }
                              >
                                +
                              </PrimaryButton>
                            </div>
                            <button
                              type="button"
                              data-no-swipe="true"
                              onClick={() => setMaterialsDetails((p) => ({ ...p, wireMeshVerticalBoardsOverride: -1 }))}
                              className="mt-2 w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]"
                            >
                              <div className="flex items-center justify-between">
                                <div className="font-extrabold">Auto</div>
                                <div className="text-[11px] text-[var(--muted)]">Reset</div>
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                  {selectedFenceType === "wood" ? (
                    <>
                      <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3 lg:col-span-2">
                        <div className="text-[11px] text-[var(--muted)] mb-2">Per-panel add-ons</div>

                        <div className="mt-2 grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-12">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Description</div>
                            <Input
                              value={takeoffPerPanelDraft.desc}
                              onChange={(e) => setTakeoffPerPanelDraft((p) => ({ ...p, desc: e.target.value }))}
                              placeholder="Description"
                            />
                          </div>
                          <div className="col-span-4">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Qty / panel</div>
                            <Input
                              type="tel"
                              inputMode="decimal"
                              value={takeoffPerPanelDraft.qtyPerPanel}
                              onChange={(e) => setTakeoffPerPanelDraft((p) => ({ ...p, qtyPerPanel: e.target.value }))}
                              placeholder="0"
                            />
                          </div>
                          <div className="col-span-4">
                            <div className="text-[11px] text-[var(--muted)] mb-1">Unit Price</div>
                            <Input
                              type="tel"
                              inputMode="decimal"
                              value={takeoffPerPanelDraft.unitPrice}
                              onChange={(e) => setTakeoffPerPanelDraft((p) => ({ ...p, unitPrice: e.target.value }))}
                              placeholder="$"
                            />
                          </div>
                          <div className="col-span-4">
                            <div className="text-[11px] text-[var(--muted)] mb-1"> </div>
                            <PrimaryButton
                              data-no-swipe="true"
                              className="w-full px-3 py-2 text-[12px]"
                              onClick={() => {
                                const desc = String(takeoffPerPanelDraft.desc || "").trim();
                                if (!desc) return;
                                const qtyPerPanel = Number(String(takeoffPerPanelDraft.qtyPerPanel || "").trim());
                                const unitPrice = Number(String(takeoffPerPanelDraft.unitPrice || "").trim());
                                const safeQtyPerPanel = Number.isFinite(qtyPerPanel) ? qtyPerPanel : 0;
                                const safeUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
                                const id =
                                  typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
                                    ? (crypto as any).randomUUID()
                                    : `pp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                                setTakeoffPerPanelAddons((prev) => [
                                  ...(Array.isArray(prev) ? prev : []),
                                  { id, desc, qtyPerPanel: safeQtyPerPanel, unitPrice: safeUnitPrice }
                                ]);
                                setTakeoffPerPanelDraft({ desc: "", qtyPerPanel: "", unitPrice: "" });
                              }}
                            >
                              Add
                            </PrimaryButton>
                          </div>
                        </div>

                        {(Array.isArray(takeoffPerPanelAddons) ? takeoffPerPanelAddons : []).length ? (
                          <div className="mt-2 grid gap-2">
                            {(Array.isArray(takeoffPerPanelAddons) ? takeoffPerPanelAddons : []).map((a, ai) => (
                              <div
                                key={String((a as any).id || ai)}
                                className="rounded-2xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm font-extrabold truncate min-w-0">{String((a as any).desc || "")}</div>
                                  <SecondaryButton
                                    data-no-swipe="true"
                                    className="px-3 py-2 text-[12px] !border-[rgba(255,80,80,.55)] !bg-[rgba(255,80,80,.22)] !text-white"
                                    onClick={() => setTakeoffPerPanelAddons((prev) => (Array.isArray(prev) ? prev : []).filter((_, i) => i !== ai))}
                                  >
                                    ✕
                                  </SecondaryButton>
                                </div>
                                <div className="mt-1 grid grid-cols-12 gap-2 items-end">
                                  <div className="col-span-12">
                                    <div className="text-[11px] text-[var(--muted)] mb-1">Description</div>
                                    <Input
                                      value={String((a as any).desc || "")}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setTakeoffPerPanelAddons((prev) =>
                                          (Array.isArray(prev) ? prev : []).map((row, i) => (i === ai ? ({ ...(row as any), desc: v } as any) : row))
                                        );
                                      }}
                                    />
                                  </div>
                                  <div className="col-span-6">
                                    <div className="text-[11px] text-[var(--muted)] mb-1">Qty / panel</div>
                                    <Input
                                      type="tel"
                                      inputMode="decimal"
                                      value={String((a as any).qtyPerPanel ?? "")}
                                      onChange={(e) => {
                                        const qtyPerPanel = Number(String(e.target.value || "").trim());
                                        const safe = Number.isFinite(qtyPerPanel) ? qtyPerPanel : 0;
                                        setTakeoffPerPanelAddons((prev) =>
                                          (Array.isArray(prev) ? prev : []).map((row, i) => (i === ai ? ({ ...(row as any), qtyPerPanel: safe } as any) : row))
                                        );
                                      }}
                                    />
                                  </div>
                                  <div className="col-span-6">
                                    <div className="text-[11px] text-[var(--muted)] mb-1">Unit Price</div>
                                    <Input
                                      type="tel"
                                      inputMode="decimal"
                                      value={String((a as any).unitPrice ?? "")}
                                      onChange={(e) => {
                                        const unitPrice = Number(String(e.target.value || "").trim());
                                        const safe = Number.isFinite(unitPrice) ? unitPrice : 0;
                                        setTakeoffPerPanelAddons((prev) =>
                                          (Array.isArray(prev) ? prev : []).map((row, i) => (i === ai ? ({ ...(row as any), unitPrice: safe } as any) : row))
                                        );
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {useHorizontalCedarTakeoff ? (
                        <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                          <div className="text-[11px] text-[var(--muted)] mb-2">Height</div>
                          <Select
                            value={String(Math.max(4, Math.min(6, Math.floor(Number(materialsDetails.vinylPanelHeightFt) || 6))))}
                            onChange={(e) => setMaterialsDetails((p) => ({ ...p, vinylPanelHeightFt: Number(e.target.value) }))}
                            disabled={!selectedStyle}
                          >
                            {[4, 5, 6].map((h) => (
                              <option key={h} value={String(h)}>{h}'</option>
                            ))}
                          </Select>
                        </div>
                      ) : null}

                      {selectedFenceType === "wood" ? (
                        <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                          <div className="text-[11px] text-[var(--muted)] mb-2">Wood material set</div>
                          <div>
                            <div className="text-[11px] text-[var(--muted)] mb-1">Material set</div>
                            <Select
                              value={materialsDetails.woodType}
                              onChange={(e) => {
                                const next = e.target.value as "Pressure treated" | "Cedar" | "Rough sawn cedar" | "Cedar tone";
                                setMaterialsDetails((p) => ({
                                  ...p,
                                  woodType: next,
                                  postType: next,
                                  railMaterial: next,
                                  picketMaterial: next,
                                  trimMaterial: next,
                                  twoByTwoMaterial: next,
                                  pictureFrameTrimMaterial: next,
                                  horizontalCedarBoardMaterial:
                                    next === "Cedar tone"
                                      ? "CedarTone"
                                      : next === "Pressure treated"
                                        ? "Pressure Treated"
                                        : (p.horizontalCedarBoardProfile === "1x6" ? "1x6 cedar" : "5/4 cedar"),
                                  shadowboxBoardMaterial: (next === "Pressure treated" ? "Pressure Treated" : next)
                                }));
                              }}
                            >
                              <option value="Pressure treated">Pressure treated</option>
                              <option value="Cedar">Cedar</option>
                              <option value="Rough sawn cedar">Rough sawn cedar</option>
                              <option value="Cedar tone">Cedar tone</option>
                            </Select>
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                        <div className="text-[11px] text-[var(--muted)] mb-2">Posts</div>
                        <div className="grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Size</div>
                          <Select
                            value={materialsDetails.postDim}
                            onChange={(e) => {
                              const next = e.target.value as "4x4" | "6x6";
                              setMaterialsDetails((p) => ({
                                ...p,
                                postDim: next,
                                topCaps: selectedStyleKind === "wood_casto" && next !== "4x4" ? false : p.topCaps
                              }));
                            }}
                          >
                            <option value="4x4">4x4</option>
                            <option value="6x6">6x6</option>
                          </Select>
                        </div>
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
                          <div className="text-[11px] text-[var(--muted)] mb-1">Post material</div>
                          <Select
                            value={materialsDetails.postType}
                            onChange={(e) =>
                              setMaterialsDetails((p) => ({
                                ...p,
                                postType: e.target.value as "Pressure treated" | "Cedar" | "Rough sawn cedar" | "Cedar tone"
                              }))
                            }
                          >
                            <option value="Pressure treated">Pressure treated</option>
                            <option value="Cedar">Cedar</option>
                            <option value="Rough sawn cedar">Rough sawn cedar</option>
                            <option value="Cedar tone">Cedar tone</option>
                          </Select>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="text-[11px] text-[var(--muted)] mb-2">Extra posts</div>
                        <div className="grid grid-cols-2 gap-3 items-end">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-extrabold">Extra posts</div>
                            <div className="flex items-center gap-2">
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="w-11 h-11 min-w-[44px] min-h-[44px] px-0 py-0 text-[16px] leading-none flex items-center justify-center touch-manipulation select-none"
                                onClick={() => setExtraPosts((v) => Math.max(0, (Number(v) || 0) - 1))}
                              >
                                -
                              </PrimaryButton>
                              <div className="min-w-8 text-center font-black">{extraPosts}</div>
                              <PrimaryButton
                                type="button"
                                data-no-swipe="true"
                                className="w-11 h-11 min-w-[44px] min-h-[44px] px-0 py-0 text-[16px] leading-none flex items-center justify-center touch-manipulation select-none"
                                onClick={() => setExtraPosts((v) => (Number(v) || 0) + 1)}
                              >
                                +
                              </PrimaryButton>
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[var(--muted)] mb-1">Extra post height</div>
                            <Select
                              value={String(extraPostSize)}
                              onChange={(e) => setExtraPostSize(Number(e.target.value))}
                            >
                              <option value="8">8</option>
                              <option value="10">10</option>
                              <option value="12">12</option>
                              <option value="14">14</option>
                            </Select>
                          </div>
                        </div>
                      </div>
                      </div>

                      {selectedFenceType === "wood" ? (
                        <>
                          {useHorizontalCedarTakeoff ? (
                            <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                              <div className="text-[11px] text-[var(--muted)] mb-2">Rails & board profile</div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Rails</div>
                                  <Select
                                    value={materialsDetails.railMaterial}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        railMaterial: e.target.value as "Pressure treated" | "Cedar" | "Rough sawn cedar" | "Cedar tone"
                                      }))
                                    }
                                  >
                                    <option value="Pressure treated">Pressure treated</option>
                                    <option value="Cedar">Cedar</option>
                                    <option value="Rough sawn cedar">Rough sawn cedar</option>
                                    <option value="Cedar tone">Cedar tone</option>
                                  </Select>
                                </div>

                                <div>
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Board profile</div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <button
                                      type="button"
                                      data-no-swipe="true"
                                      onClick={() => setMaterialsDetails((p) => ({ ...p, horizontalCedarBoardProfile: "5/4" }))}
                                      className={
                                        "w-full rounded-xl px-3 py-2 text-[12px] font-extrabold border transition-none " +
                                        (materialsDetails.horizontalCedarBoardProfile === "5/4"
                                          ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                                          : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                                      }
                                      aria-pressed={materialsDetails.horizontalCedarBoardProfile === "5/4"}
                                    >
                                      5/4
                                    </button>

                                    <button
                                      type="button"
                                      data-no-swipe="true"
                                      onClick={() => setMaterialsDetails((p) => ({ ...p, horizontalCedarBoardProfile: "1x6" }))}
                                      className={
                                        "w-full rounded-xl px-3 py-2 text-[12px] font-extrabold border transition-none " +
                                        (materialsDetails.horizontalCedarBoardProfile === "1x6"
                                          ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                                          : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                                      }
                                      aria-pressed={materialsDetails.horizontalCedarBoardProfile === "1x6"}
                                    >
                                      1x6
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                              <div className="text-[11px] text-[var(--muted)] mb-2">Rails & pickets</div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Rails</div>
                                  <Select
                                    value={materialsDetails.railMaterial}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        railMaterial: e.target.value as "Pressure treated" | "Cedar" | "Rough sawn cedar" | "Cedar tone"
                                      }))
                                    }
                                  >
                                    <option value="Pressure treated">Pressure treated</option>
                                    <option value="Cedar">Cedar</option>
                                    <option value="Rough sawn cedar">Rough sawn cedar</option>
                                    <option value="Cedar tone">Cedar tone</option>
                                  </Select>
                                </div>
                                <div>
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Pickets</div>
                                  <Select
                                    value={materialsDetails.picketMaterial}
                                    onChange={(e) =>
                                      setMaterialsDetails((p) => ({
                                        ...p,
                                        picketMaterial: e.target.value as "Pressure treated" | "Cedar" | "Rough sawn cedar" | "Rough sawn cedar 5/8" | "Rough sawn cedar 3/4" | "Cedar tone"
                                      }))
                                    }
                                  >
                                    <option value="Pressure treated">Pressure treated</option>
                                    <option value="Cedar">Cedar</option>
                                    <option value="Rough sawn cedar">Rough sawn cedar</option>
                                    <option value="Rough sawn cedar 5/8">Rough sawn cedar (5/8)</option>
                                    <option value="Rough sawn cedar 3/4">Rough sawn cedar (3/4)</option>
                                    <option value="Cedar tone">Cedar tone</option>
                                  </Select>
                                </div>
                              </div>

                              {selectedFenceType === "wood" &&
                              selectedStyleKind !== "wood_shadowbox" &&
                              selectedStyleKind !== "wood_shadowbox_pickets" &&
                              selectedStyleKind !== "wood_shadowbox_top_cap" &&
                              selectedStyleKind !== "wood_board_on_board" ? (
                                <div className="mt-3">
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Picket spacing</div>
                                  <Select
                                    value={String((materialsDetails as any).picketSpacingIn === 8 ? 8 : 5.5)}
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      setMaterialsDetails((p) => ({ ...p, picketSpacingIn: (n === 8 ? 8 : 5.5) as 5.5 | 8 }));
                                    }}
                                  >
                                    <option value="5.5">Standard spacing</option>
                                    <option value="8">2.5" spacing</option>
                                  </Select>
                                </div>
                              ) : null}
                            </div>
                          )}

                          {useHorizontalCedarTakeoff ? (
                            <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3 lg:col-span-2">
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Verticals</div>
                                  <button
                                    type="button"
                                    data-no-swipe="true"
                                    onClick={() => setMaterialsDetails((p) => ({ ...p, horizontalCedarVerticals: !p.horizontalCedarVerticals }))}
                                    className={
                                      "w-full rounded-xl px-3 py-2 text-[12px] font-extrabold border transition-none " +
                                      (materialsDetails.horizontalCedarVerticals
                                        ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                                        : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                                    }
                                    aria-pressed={materialsDetails.horizontalCedarVerticals}
                                  >
                                    {materialsDetails.horizontalCedarVerticals ? "On" : "Off"}
                                  </button>
                                </div>

                                <div>
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Corners</div>
                                  <div className="grid grid-cols-3 gap-2">
                                    <PrimaryButton
                                      type="button"
                                      data-no-swipe="true"
                                      className="px-3 py-2 text-[12px]"
                                      onClick={() => setMaterialsDetails((p) => ({ ...p, horizontalCedarCornerAdjust: (Number(p.horizontalCedarCornerAdjust) || 0) - 1 }))}
                                    >
                                      -
                                    </PrimaryButton>
                                    <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                                      {(Number(materialsDetails.horizontalCedarCornerAdjust) || 0) >= 0 ? "+" : ""}{Number(materialsDetails.horizontalCedarCornerAdjust) || 0}
                                    </div>
                                    <PrimaryButton
                                      type="button"
                                      data-no-swipe="true"
                                      className="px-3 py-2 text-[12px]"
                                      onClick={() => setMaterialsDetails((p) => ({ ...p, horizontalCedarCornerAdjust: (Number(p.horizontalCedarCornerAdjust) || 0) + 1 }))}
                                    >
                                      +
                                    </PrimaryButton>
                                  </div>
                                </div>

                                <div>
                                  <div className="text-[11px] text-[var(--muted)] mb-1">Extra boards</div>
                                  <Input
                                    type="tel"
                                    inputMode="numeric"
                                    value={String(Math.max(0, Math.floor(Number(materialsDetails.horizontalCedarExtraBoards) || 0)))}
                                    onChange={(e) => {
                                      const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                      setMaterialsDetails((p) => ({ ...p, horizontalCedarExtraBoards: n }));
                                    }}
                                    placeholder="0"
                                  />
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      {selectedFenceType === "wood" && selectedStyleKind === "wood_split_rail" ? (
                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Split rail material</div>
                          <Select
                            value={materialsDetails.splitRailMaterial}
                            onChange={(e) => setMaterialsDetails((p) => ({ ...p, splitRailMaterial: e.target.value as any }))}
                          >
                            <option value="Pressure treated">Pressure treated</option>
                            <option value="Cedar tone">Cedar tone</option>
                          </Select>
                        </div>
                      ) : null}

                    </>
                  ) : null}

                  {selectedFenceType === "aluminum" ? (
                    <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                      <div className="text-[11px] text-[var(--muted)] mb-2">Hardware</div>
                      <div>
                        <div className="text-[11px] text-[var(--muted)] mb-1">Rail end bracket packs (3 per pack @ $4.50 ea)</div>
                        <div className="grid grid-cols-3 gap-2">
                          <PrimaryButton
                            type="button"
                            data-no-swipe="true"
                            className="px-3 py-2 text-[12px]"
                            onClick={() =>
                              setMaterialsDetails((p) => ({
                                ...p,
                                railEndBracketPacks: Math.max(0, Math.floor(Number(p.railEndBracketPacks) || 0) - 1)
                              }))
                            }
                          >
                            -
                          </PrimaryButton>
                          <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                            {Math.max(0, Math.floor(Number(materialsDetails.railEndBracketPacks) || 0))}
                          </div>
                          <PrimaryButton
                            type="button"
                            data-no-swipe="true"
                            className="px-3 py-2 text-[12px]"
                            onClick={() =>
                              setMaterialsDetails((p) => ({
                                ...p,
                                railEndBracketPacks: Math.max(0, Math.floor(Number(p.railEndBracketPacks) || 0) + 1)
                              }))
                            }
                          >
                            +
                          </PrimaryButton>
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--muted)]">
                          Total brackets: {Math.max(0, Math.floor(Number(materialsDetails.railEndBracketPacks) || 0)) * 3}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {selectedFenceType === "wood" && selectedStyleKind !== "wood_wire_mesh" && selectedStyleKind !== "wood_split_rail" ? (
                    <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3 lg:col-span-2">
                      <div className="text-[11px] text-[var(--muted)] mb-2">Caps & arbor</div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Post caps</div>
                          <button
                            type="button"
                            data-no-swipe="true"
                            onClick={() =>
                              setMaterialsDetails((p) => ({
                                ...p,
                                postCaps: !p.postCaps,
                                topCaps: !p.postCaps ? false : p.topCaps
                              }))
                            }
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
                          <div className="text-[11px] text-[var(--muted)] mb-1">Top caps</div>
                          <button
                            type="button"
                            data-no-swipe="true"
                            onClick={() => {
                              if (castoTopCapsLocked) return;
                              setMaterialsDetails((p) => ({
                                ...p,
                                topCaps: !p.topCaps,
                                postCaps: !p.topCaps ? false : p.postCaps
                              }));
                            }}
                            className={
                              "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                              (castoTopCapsLocked ? "opacity-50 cursor-not-allowed " : "") +
                              (materialsDetails.topCaps
                                ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                                : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                            }
                            aria-disabled={castoTopCapsLocked}
                          >
                            <div className="flex items-center justify-between">
                              <div className="font-extrabold">{materialsDetails.topCaps ? "On" : "Off"}</div>
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
                  ) : null}

                  {selectedStyleKind === "wood_split_rail" ? (
                    <div className="rounded-2xl border border-[rgba(255,255,255,.12)] bg-[rgba(255,255,255,.06)] p-3">
                      <div className="text-[11px] text-[var(--muted)] mb-2">Split rail details</div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Rails</div>
                          <Select
                            value={String(materialsDetails.splitRailRails)}
                            onChange={(e) =>
                              setMaterialsDetails((p) => ({
                                ...p,
                                splitRailRails: (Number(e.target.value) === 2 ? 2 : 3) as 2 | 3
                              }))
                            }
                          >
                            <option value="3">3 rail</option>
                            <option value="2">2 rail</option>
                          </Select>
                        </div>
                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Wire mesh</div>
                          <button
                            type="button"
                            data-no-swipe="true"
                            onClick={() => setMaterialsDetails((p) => ({ ...p, splitRailWireMesh: !p.splitRailWireMesh }))}
                            className={
                              "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none " +
                              (materialsDetails.splitRailWireMesh
                                ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                                : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                            }
                            aria-pressed={materialsDetails.splitRailWireMesh}
                          >
                            <div className="flex items-center justify-between">
                              <div className="font-extrabold">{materialsDetails.splitRailWireMesh ? "On" : "Off"}</div>
                              <div className="text-[11px] text-[var(--muted)]">Tap</div>
                            </div>
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                          <div className="text-[11px] text-[var(--muted)] mb-1">Corner posts</div>
                          <div className="grid grid-cols-3 gap-2">
                            <PrimaryButton
                              type="button"
                              data-no-swipe="true"
                              className="px-3 py-2 text-[12px]"
                              onClick={() =>
                                setMaterialsDetails((p) => ({
                                  ...p,
                                  splitRailCornerPosts: Math.max(0, (Number(p.splitRailCornerPosts) || 0) - 1)
                                }))
                              }
                            >
                              -
                            </PrimaryButton>
                            <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                              {Math.max(0, Number(materialsDetails.splitRailCornerPosts) || 0)}
                            </div>
                            <PrimaryButton
                              type="button"
                              data-no-swipe="true"
                              className="px-3 py-2 text-[12px]"
                              onClick={() =>
                                setMaterialsDetails((p) => ({
                                  ...p,
                                  splitRailCornerPosts: Math.max(0, (Number(p.splitRailCornerPosts) || 0) + 1)
                                }))
                              }
                            >
                              +
                            </PrimaryButton>
                          </div>
                        </div>

                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] p-2">
                          <div className="text-[11px] text-[var(--muted)] mb-1">End posts</div>
                          <div className="grid grid-cols-3 gap-2">
                            <PrimaryButton
                              type="button"
                              data-no-swipe="true"
                              className="px-3 py-2 text-[12px]"
                              onClick={() =>
                                setMaterialsDetails((p) => ({
                                  ...p,
                                  splitRailEndPosts: Math.max(0, (Number(p.splitRailEndPosts) || 0) - 1)
                                }))
                              }
                            >
                              -
                            </PrimaryButton>
                            <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2 text-center font-black">
                              {Math.max(0, Number(materialsDetails.splitRailEndPosts) || 0)}
                            </div>
                            <PrimaryButton
                              type="button"
                              data-no-swipe="true"
                              className="px-3 py-2 text-[12px]"
                              onClick={() =>
                                setMaterialsDetails((p) => ({
                                  ...p,
                                  splitRailEndPosts: Math.max(0, (Number(p.splitRailEndPosts) || 0) + 1)
                                }))
                              }
                            >
                              +
                            </PrimaryButton>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2">
                          <div className="text-[11px] text-[var(--muted)]">Total posts</div>
                          <div className="text-[14px] font-black">{splitRailPostsSummary.total}</div>
                        </div>
                        <div className="rounded-xl border border-[rgba(255,255,255,.10)] bg-[rgba(255,255,255,.05)] px-3 py-2">
                          <div className="text-[11px] text-[var(--muted)]">Line posts</div>
                          <div className="text-[14px] font-black">{splitRailPostsSummary.line}</div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {selectedStyleKind === "wood_shadowbox" ? (
                    <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                      <div className="text-[11px] text-[var(--muted)] mb-2">Shadowbox details</div>
                      <div>
                        <div className="text-[11px] text-[var(--muted)] mb-1">1x4 material</div>
                        <Select
                          value={materialsDetails.shadowboxBoardMaterial}
                          onChange={(e) =>
                            setMaterialsDetails((p) => ({
                              ...p,
                              shadowboxBoardMaterial: (e.target.value === "Pressure Treated" || e.target.value === "Cedar" || e.target.value === "Rough sawn cedar" || e.target.value === "Cedar tone")
                                ? (e.target.value as any)
                                : ("Pressure Treated" as any)
                            }))
                          }
                        >
                          <option value="Pressure Treated">Pressure treated</option>
                          <option value="Cedar">Cedar</option>
                          <option value="Rough sawn cedar">Rough sawn cedar</option>
                        </Select>
                      </div>
                    </div>
                  ) : null}

                  {(
                    selectedStyleKind === "wood_picture_framed" ||
                    selectedStyleKind === "wood_niko" ||
                    selectedStyleKind === "wood_casto" ||
                    selectedStyleKind === "wood_picture_framed_4ft" ||
                    selectedStyleKind === "wood_picture_framed_lattice"
                  ) ? (
                    <div className="rounded-2xl border border-[rgba(183,119,41,.42)] bg-[rgba(138,90,43,.40)] p-3">
                      <div className="text-[11px] text-[var(--muted)] mb-2">Trim</div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Material</div>
                          <Select
                            value={materialsDetails.pictureFrameTrimMaterial}
                            onChange={(e) =>
                              setMaterialsDetails((p) => ({
                                ...p,
                                pictureFrameTrimMaterial: e.target.value as "Pressure treated" | "Cedar" | "Rough sawn cedar" | "Cedar tone"
                              }))
                            }
                          >
                            <option value="Pressure treated">Pressure treated</option>
                            <option value="Cedar">Cedar</option>
                            <option value="Rough sawn cedar">Rough sawn cedar</option>
                            <option value="Cedar tone">Cedar tone</option>
                          </Select>
                        </div>

                        <div>
                          <div className="text-[11px] text-[var(--muted)] mb-1">Qty</div>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              data-no-swipe="true"
                              onClick={() => setMaterialsDetails((p) => ({ ...p, pictureFrameTrimPieces: 2 }))}
                              className={
                                "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none font-extrabold " +
                                (materialsDetails.pictureFrameTrimPieces === 2
                                  ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                                  : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                              }
                            >
                              2x
                            </button>
                            <button
                              type="button"
                              data-no-swipe="true"
                              onClick={() => setMaterialsDetails((p) => ({ ...p, pictureFrameTrimPieces: 3 }))}
                              className={
                                "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm border transition-none font-extrabold " +
                                (materialsDetails.pictureFrameTrimPieces === 3
                                  ? "bg-[rgba(255,214,10,.34)] border-[rgba(255,214,10,.65)] text-[rgba(255,244,200,.98)]"
                                  : "bg-[rgba(255,255,255,.06)] border-[rgba(255,255,255,.12)]")
                              }
                            >
                              3x
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
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
            <span className="text-[var(--muted)]">Materials &amp; expenses</span>
            <span className="font-black">{money(takeoffMaterialsAndExpensesTotal)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[var(--muted)]">Additional fees</span>
            <span className="font-black">{money(additionalFeesTotal)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[var(--muted)]">Fence removal</span>
            <span className="font-black">{money(removalTotal)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[var(--muted)]">Labor</span>
            <span className="font-black">{money(laborBaseTotal)}</span>
          </div>

          {sharedLf > 0 ? (
            <div className="mt-1 grid gap-1">
              <div className="text-[11px] font-extrabold text-[var(--muted)]">Shared portion</div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--muted)]">LF</span>
                <span className="font-black">{sharedLf.toFixed(0)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--muted)]">Total</span>
                <span className="font-black">{money(sharedTotal)}</span>
              </div>
            </div>
          ) : null}

          <div className="h-px bg-[rgba(255,255,255,.12)] my-1" />
          <div className="flex justify-between text-base">
            <span className="font-black">TOTAL</span>
            <span className="font-black">{money(grandTotal)}</span>
          </div>
        </div>

      {debugTotals ? (
        <div className="mt-3 text-[11px] text-[var(--muted)]">
          takeoffMaterialsTotal={String(takeoffMaterialsTotal)} takeoffMaterialsAndExpensesTotal={String(takeoffMaterialsAndExpensesTotal)} materialsDepositTotal={String(materialsDepositTotal)} materialsSubtotal(items)={String(materialsSubtotal)}
        </div>
      ) : null}
      </GlassCard>

      <div className="flex justify-end">
        <SecondaryButton onClick={generateContract}>Generate Contract</SecondaryButton>
      </div>

      {portalReady
        ? createPortal(
          <>
            {(!takeoffError && (generatedMaterials?.length || 0) === 0 && takeoffDiagnostics) || takeoffError || saveError || saveNotice ? (
              <div
                className="fixed left-0 right-0 z-50 transform-gpu will-change-transform isolate px-4"
                style={{ bottom: "calc(max(calc(env(safe-area-inset-bottom) - 6px), 0px) + 76px)" }}
                aria-label="Estimate notices"
              >
                <div className="mx-auto max-w-[980px] grid gap-2">
                  {(!takeoffError && (generatedMaterials?.length || 0) === 0 && takeoffDiagnostics) ? (
                    <div className="rounded-2xl border border-[rgba(255,214,10,.55)] bg-[rgba(255,214,10,.16)] px-4 py-3 text-[12px] font-black text-[rgba(255,244,200,.98)] shadow-glass">
                      <div>
                        {(() => {
                          if (!takeoffDiagnostics.hasStyledCards) return "No takeoff yet: pick a style.";
                          if (!takeoffDiagnostics.hasEligibleSegments) return "No takeoff yet: enter at least one segment length.";
                          if (!takeoffDiagnostics.hasAnyAssignedToStyled) return "No takeoff: your measured segments are not assigned to a styled card. Assign segments to Card 1 (or pick a style on the card they’re assigned to).";
                          return "No takeoff yet.";
                        })()}
                      </div>
                      <div className="mt-1 text-[11px] font-extrabold text-[rgba(255,244,200,.92)]">
                        {`segments=${takeoffDiagnostics.eligibleSegments} styledCards=${takeoffDiagnostics.perCard.filter((p) => p.hasStyle).length} active=${takeoffDiagnostics.activeId.slice(0, 6)}`}
                      </div>
                      <div className="mt-1 text-[11px] font-extrabold text-[rgba(255,244,200,.92)]">
                        {takeoffDiagnostics.perCard
                          .map((p, idx) => {
                            const active = p.id === takeoffDiagnostics.activeId ? "*" : "";
                            const style = p.hasStyle ? "style" : "no-style";
                            return `C${idx + 1}${active}(${style},seg=${p.assignedSegments})`;
                          })
                          .join(" ")}
                      </div>
                    </div>
                  ) : null}
                  {takeoffError ? (
                    <div className="rounded-2xl border border-[rgba(255,80,80,.45)] bg-[rgba(255,80,80,.14)] px-4 py-3 text-[12px] font-black text-[rgba(255,240,240,.95)] shadow-glass">
                      {takeoffError}
                    </div>
                  ) : null}
                  {saveError ? (
                    <div className="rounded-2xl border border-[rgba(255,80,80,.45)] bg-[rgba(255,80,80,.14)] px-4 py-3 text-[12px] font-black text-[rgba(255,240,240,.95)] shadow-glass">
                      {saveError}
                    </div>
                  ) : null}
                  {saveNotice ? (
                    <div className="rounded-2xl border border-[rgba(255,214,10,.45)] bg-[rgba(255,214,10,.10)] px-4 py-3 text-[12px] font-black text-[rgba(255,244,200,.95)] shadow-glass">
                      {saveNotice}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <nav
              className="fixed left-0 right-0 z-[9999] px-4 pointer-events-auto"
              style={{ bottom: 0, touchAction: "manipulation" }}
              aria-label="Estimate actions"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <div className="mx-auto max-w-[980px]">
                <div className="bg-[rgba(20,30,24,.75)] border border-[var(--stroke)] shadow-glass rounded-2xl flex flex-col justify-end pb-[max(calc(env(safe-area-inset-bottom) - 6px),0px)]" style={{ WebkitBackdropFilter: "none", backdropFilter: "none" }}>
                  <div className="h-16 flex items-center justify-around">
                    <PrimaryButton
                      type="button"
                      data-no-swipe="true"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={save}
                      disabled={saving || savingAsNew}
                      style={{ touchAction: "manipulation" }}
                    >
                      {saving ? "Saving…" : "Save"}
                    </PrimaryButton>
                    <SecondaryButton
                      type="button"
                      data-no-swipe="true"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={saveAsNew}
                      disabled={saving || savingAsNew}
                      style={{ touchAction: "manipulation" }}
                    >
                      {savingAsNew ? "Saving…" : saveAsNewJustSaved ? "Saved" : "Save as new"}
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      data-no-swipe="true"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={resetEstimate}
                      disabled={saving || savingAsNew}
                      style={{ touchAction: "manipulation" }}
                    >
                      Reset
                    </SecondaryButton>
                  </div>
                </div>
              </div>
            </nav>
          </>,
          document.body
        )
        : null}
    </div>
  );
}
