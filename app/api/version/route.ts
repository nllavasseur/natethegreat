import { NextResponse } from "next/server";

export function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    "";
  const ref = process.env.VERCEL_GIT_COMMIT_REF || "";
  const env = process.env.VERCEL_ENV || "";
  return NextResponse.json({ sha, ref, env });
}
