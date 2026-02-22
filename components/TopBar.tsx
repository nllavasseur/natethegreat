"use client";

import React from "react";

export default function TopBar() {
  const [iconOk, setIconOk] = React.useState(true);

  return (
    <header>
      <div className="backdrop-blur-ios bg-[rgba(10,18,14,.55)] border-b border-[var(--stroke)]">
        <div
          className="max-w-[980px] mx-auto px-4 grid grid-cols-[2.5rem_1fr_2.5rem] items-center"
          style={{
            paddingTop: "var(--vf-sat, 0px)",
            height: "calc(3.5rem + var(--vf-sat, 0px))"
          }}
        >
          <div className="flex items-center justify-start">
            {iconOk ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/IMG_3454.JPG"
                alt="Vasseur Fencing"
                className="h-10 w-10 rounded-xl border border-[var(--stroke)] bg-[rgba(255,255,255,.06)] object-cover"
                onError={() => setIconOk(false)}
              />
            ) : (
              <div className="h-10 w-10 rounded-xl bg-[rgba(255,255,255,.10)] border border-[var(--stroke)] shadow-glass grid place-items-center">
                <span className="font-black tracking-tight">VF</span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex items-center justify-center">
            <div className="text-white font-black tracking-tight text-3xl leading-none truncate text-center">
              Vasseur Fencing
            </div>
          </div>

          <div aria-hidden className="h-10 w-10" />
        </div>
      </div>
    </header>
  );
}
