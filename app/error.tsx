"use client";

import React from "react";

export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  const digest = typeof props.error?.digest === "string" ? props.error.digest : "";
  if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")) {
    throw props.error;
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Application error</h1>
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{String(props.error?.message || props.error)}</pre>
        {props.error?.digest ? (
          <div style={{ marginTop: 12, opacity: 0.7, fontSize: 12 }}>Digest: {props.error.digest}</div>
        ) : null}
        <button
          onClick={() => props.reset()}
          style={{ marginTop: 12, padding: "10px 14px", fontWeight: 800, borderRadius: 12 }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
