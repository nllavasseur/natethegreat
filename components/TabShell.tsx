"use client";

import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import Link from "next/link";
import React from "react";
import { createPortal } from "react-dom";
import { IconCalendar, IconDoc, IconPortfolio, IconQuote } from "./icons";
import TopBar from "./TopBar";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";

const tabs = [
  { href: "/portfolio", label: "Portfolio", icon: IconPortfolio },
  { href: "/estimates", label: "Estimates", icon: IconDoc },
  { href: "/quotes", label: "Quotes", icon: IconQuote },
  { href: "/calendar", label: "Calendar", icon: IconCalendar }
];

export default function TabShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = tabs.find(t => pathname?.startsWith(t.href))?.href ?? "/estimates";
  const estimatesHeaderOffsetPx = pathname?.startsWith("/estimates") ? 44 : 0;

  const hideChrome = pathname?.startsWith("/estimates/contract") || pathname?.startsWith("/auth");

  const [sessionChecked, setSessionChecked] = React.useState(false);
  const [portalReady, setPortalReady] = React.useState(false);

  const hasLocalAuthToken = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "development") return;
    (window as any).supabase = supabase;
    (window as any).__supabase = supabase;
  }, []);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!supabaseConfigured) {
          return;
        }
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise<{ data: { session: null } }>((resolve) => setTimeout(() => resolve({ data: { session: null } }), 1200))
        ]);
        const { data } = sessionResult as any;
        if (cancelled) return;

        const isAuthRoute = pathname?.startsWith("/auth");
        const isPublicRoute = pathname?.startsWith("/estimates/contract") || pathname?.startsWith("/quotes/print");
        const hasSession = Boolean(data.session);

        if (!hasSession && !hasLocalAuthToken && !isAuthRoute && !isPublicRoute) {
          router.replace("/auth");
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();

    if (!supabaseConfigured) {
      setSessionChecked(true);
      return () => {
        cancelled = true;
      };
    }

    const sub = supabaseConfigured
      ? supabase.auth.onAuthStateChange((_event, session) => {
          const isAuthRoute = pathname?.startsWith("/auth");
          const isPublicRoute = pathname?.startsWith("/estimates/contract") || pathname?.startsWith("/quotes/print");
          const hasSession = Boolean(session);
          if (!hasSession && !hasLocalAuthToken && !isAuthRoute && !isPublicRoute) {
            router.replace("/auth");
          }
        })
      : null;

    return () => {
      cancelled = true;
      try {
        sub?.data?.subscription?.unsubscribe();
      } catch {
        // ignore
      }
    };
  }, [pathname, router]);

  const mainRef = React.useRef<HTMLElement | null>(null);

  if (!sessionChecked && !pathname?.startsWith("/quotes/print") && !pathname?.startsWith("/estimates/contract")) {
    return <div className="min-h-dvh vf-app-bg" />;
  }

  return (
    <div className="min-h-dvh flex flex-col vf-app-bg">
      {hideChrome
        ? null
        : portalReady
          ? createPortal(
              <div
                className="fixed left-0 right-0 z-40"
                style={{ top: estimatesHeaderOffsetPx ? `${estimatesHeaderOffsetPx}px` : "0px" }}
              >
                <TopBar />
                <nav aria-label="Top navigation">
                  <div className="mx-auto max-w-[980px] px-4 pb-3 pt-3">
                    <div className="backdrop-blur-ios bg-[rgba(20,30,24,.55)] border border-[var(--stroke)] shadow-glass rounded-2xl h-16 flex items-center justify-around">
                      {tabs.map((t) => {
                        const isActive = active === t.href;
                        const Icon = t.icon;
                        return (
                          <Link
                            key={t.href}
                            href={t.href}
                            className={clsx(
                              "flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-xl transition",
                              isActive ? "bg-[rgba(255,255,255,.10)]" : "opacity-80 hover:opacity-100"
                            )}
                          >
                            <Icon
                              className={clsx(
                                "h-5 w-5",
                                isActive ? "text-white" : "text-[rgba(255,255,255,.8)]"
                              )}
                            />
                            <span
                              className={clsx(
                                "text-[11px] font-semibold",
                                isActive ? "text-white" : "text-[rgba(255,255,255,.75)]"
                              )}
                            >
                              {t.label}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </nav>
              </div>,
              document.body
            )
          : null}

      <main
        ref={(el) => {
          mainRef.current = el;
        }}
        className={clsx(
          "flex-1 max-w-[980px] w-full mx-auto",
          hideChrome ? "px-0 pb-0 pt-0" : "px-4 pb-6 pt-3"
        )}
        style={
          hideChrome
            ? undefined
            : {
                paddingTop: `calc(9rem + min(env(safe-area-inset-top), 44px) + ${estimatesHeaderOffsetPx}px)`
              }
        }
      >
        {children}
      </main>
    </div>
  );
}
