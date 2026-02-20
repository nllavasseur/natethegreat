import clsx from "clsx";
import React from "react";

export function GlassCard({ className, children }: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={clsx(
      "rounded-2xl border border-[var(--stroke)] bg-[var(--card)] shadow-glass backdrop-blur-ios",
      className
    )}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2 mt-4">
      <h2 className="text-sm font-extrabold tracking-tight">{title}</h2>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={clsx(
        "rounded-xl px-4 py-2 text-sm font-extrabold border border-[rgba(255,255,255,.16)]",
        "bg-[rgba(31,77,58,.85)] hover:bg-[rgba(31,77,58,.95)] active:scale-[.99] transition",
        props.className
      )}
    />
  );
}

export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={clsx(
        "rounded-xl px-4 py-2 text-sm font-extrabold border border-[rgba(255,255,255,.16)]",
        "bg-[rgba(255,255,255,.10)] hover:bg-[rgba(255,255,255,.14)] active:scale-[.99] transition",
        props.className
      )}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm",
        "bg-[rgba(255,255,255,.08)] border border-[rgba(255,255,255,.14)]",
        "outline-none focus:ring-2 focus:ring-[rgba(138,90,43,.55)]",
        props.className
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        "w-full rounded-xl px-3 py-2 text-[16px] md:text-sm",
        "bg-[rgba(255,255,255,.08)] border border-[rgba(255,255,255,.14)]",
        "outline-none focus:ring-2 focus:ring-[rgba(138,90,43,.55)]",
        props.className
      )}
    />
  );
}
