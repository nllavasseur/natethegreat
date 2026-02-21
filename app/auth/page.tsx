"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { GlassCard, PrimaryButton, SecondaryButton, SectionTitle, Input } from "@/components/ui";
import { supabase } from "@/lib/supabaseClient";

export default function AuthPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = React.useState<string>("");
  const [cooldownUntil, setCooldownUntil] = React.useState<number>(0);
  const [code, setCode] = React.useState("");
  const [verifying, setVerifying] = React.useState(false);

  const now = Date.now();
  const cooldownMsLeft = Math.max(0, cooldownUntil - now);
  const canSend = status !== "sending" && cooldownMsLeft === 0;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          router.replace("/estimates");
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  async function sendMagicLink() {
    const e = String(email || "").trim();
    if (!e) return;
    if (!canSend) return;
    setStatus("sending");
    setMessage("");
    try {
      // Prevent repeated taps / accidental spam.
      setCooldownUntil(Date.now() + 60_000);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.signInWithOtp({
        email: e,
        options: {
          emailRedirectTo: origin ? `${origin}/estimates` : undefined
        }
      });
      if (error) throw error;
      setStatus("sent");
      setMessage("Email sent. Use the magic link or enter the 6-digit code from the email.");
    } catch (err: any) {
      setStatus("error");
      const raw = err?.message ? String(err.message) : "Failed to send magic link";
      const lower = raw.toLowerCase();
      if (lower.includes("rate limit")) {
        setMessage("Email rate limit exceeded. Wait a bit and try again.");
      } else {
        setMessage(raw);
      }
    }
  }

  async function verifyCode() {
    const e = String(email || "").trim();
    const t = String(code || "").trim().replace(/\s+/g, "");
    if (!e || !t) return;
    if (verifying) return;
    setVerifying(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: e,
        token: t,
        type: "email"
      });
      if (error) throw error;
      router.replace("/estimates");
    } catch (err: any) {
      const raw = err?.message ? String(err.message) : "Failed to verify code";
      setMessage(raw);
    } finally {
      setVerifying(false);
    }
  }

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <SectionTitle title="Sign in" />
      <GlassCard className="p-4">
        <div className="text-sm text-[var(--muted)]">Use your email to get a magic link.</div>

        <div className="mt-4 grid gap-2">
          <div className="text-[11px] text-[var(--muted)]">Email</div>
          <Input
            value={email}
            inputMode="email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </div>

        <div className="mt-4 grid gap-2">
          <div className="text-[11px] text-[var(--muted)]">6-digit code (works best for Home Screen app)</div>
          <Input
            value={code}
            inputMode="numeric"
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
          />
        </div>

        {message ? (
          <div className="mt-3 text-[12px] font-extrabold text-[rgba(255,255,255,.88)]">{message}</div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <SecondaryButton onClick={signOut}>Sign out</SecondaryButton>
          <PrimaryButton onClick={sendMagicLink} disabled={!canSend}>
            {status === "sending"
              ? "Sending..."
              : cooldownMsLeft > 0
                ? `Try again in ${Math.ceil(cooldownMsLeft / 1000)}s`
                : "Send magic link"}
          </PrimaryButton>
        </div>

        <div className="mt-2 flex items-center justify-end">
          <PrimaryButton onClick={verifyCode} disabled={verifying || !String(email || "").trim() || !String(code || "").trim()}>
            {verifying ? "Verifying..." : "Verify code"}
          </PrimaryButton>
        </div>
      </GlassCard>
    </div>
  );
}
