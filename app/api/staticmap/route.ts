import { NextResponse } from "next/server";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    const zoom = clamp(Number(url.searchParams.get("z") || 18), 1, 20);
    const w = clamp(Number(url.searchParams.get("w") || 900), 200, 1400);
    const h = clamp(Number(url.searchParams.get("h") || 600), 200, 1400);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ ok: false, reason: "missing_lat_lon" }, { status: 400 });
    }

    // Using OpenStreetMap's static map endpoint (provided by OSM infrastructure).
    // Note: subject to OSM usage policies; can be swapped to a self-hosted static map service later.
    const upstream = new URL("https://staticmap.openstreetmap.de/staticmap.php");
    upstream.searchParams.set("center", `${lat},${lon}`);
    upstream.searchParams.set("zoom", String(zoom));
    upstream.searchParams.set("size", `${w}x${h}`);
    upstream.searchParams.set("maptype", "mapnik");
    upstream.searchParams.set("markers", `${lat},${lon},lightblue1`);

    const res = await fetch(upstream.toString(), {
      headers: {
        "User-Agent": "vasseur-estimator/1.0"
      },
      cache: "no-store"
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, reason: "upstream_error" }, { status: 502 });
    }

    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // Don't cache aggressively; keeps results fresh.
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return NextResponse.json({ ok: false, reason: "error" }, { status: 500 });
  }
}
