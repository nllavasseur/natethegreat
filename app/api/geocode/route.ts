import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") || "").trim();
    if (!q) return NextResponse.json({ ok: false, reason: "missing_query", results: [] }, { status: 400 });

    const nominatimUrl = new URL("https://nominatim.openstreetmap.org/search");
    nominatimUrl.searchParams.set("q", q);
    nominatimUrl.searchParams.set("format", "json");
    nominatimUrl.searchParams.set("addressdetails", "0");
    nominatimUrl.searchParams.set("limit", "6");

    const res = await fetch(nominatimUrl.toString(), {
      headers: {
        "User-Agent": "vasseur-estimator/1.0",
        "Accept": "application/json"
      },
      cache: "no-store"
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, reason: "upstream_error", results: [] }, { status: 502 });
    }

    const raw = (await res.json()) as any[];
    const results = Array.isArray(raw)
      ? raw
          .map((r: any) => ({
            displayName: String(r?.display_name || ""),
            lat: Number(r?.lat),
            lon: Number(r?.lon)
          }))
          .filter((r) => r.displayName && Number.isFinite(r.lat) && Number.isFinite(r.lon))
      : [];

    return NextResponse.json({ ok: true, results });
  } catch {
    return NextResponse.json({ ok: false, reason: "error", results: [] }, { status: 500 });
  }
}
