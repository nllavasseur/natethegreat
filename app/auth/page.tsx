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
    setStatus("sending");
    setMessage("");
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.signInWithOtp({
        email: e,
        options: {
          emailRedirectTo: origin ? `${origin}/estimates` : undefined
        }
      });
      if (error) throw error;
      setStatus("sent");
      setMessage("Magic link sent. Check your email.");
    } catch (err: any) {
      setStatus("error");
      setMessage(err?.message ? String(err.message) : "Failed to send magic link");
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

        {message ? (
          <div className="mt-3 text-[12px] font-extrabold text-[rgba(255,255,255,.88)]">{message}</div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <SecondaryButton onClick={signOut}>Sign out</SecondaryButton>
          <PrimaryButton onClick={sendMagicLink} disabled={status === "sending"}>
            {status === "sending" ? "Sending..." : "Send magic link"}
          </PrimaryButton>
        </div>
      </GlassCard>
    </div>
  );
}
