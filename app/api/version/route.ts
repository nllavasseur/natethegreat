import { NextResponse } from "next/server";

export function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_REF ||
    process.env.HEAD ||
    process.env.GITHUB_SHA ||
    "";
  const ref = process.env.VERCEL_GIT_COMMIT_REF || process.env.HEAD || process.env.BRANCH || process.env.GITHUB_REF_NAME || "";
  const env = process.env.VERCEL_ENV || process.env.CONTEXT || process.env.NODE_ENV || "";
  const provider = process.env.NETLIFY
    ? "netlify"
    : process.env.VERCEL
      ? "vercel"
      : process.env.GITHUB_ACTIONS
        ? "github"
        : "";
  return NextResponse.json({ sha, ref, env, provider });
}
