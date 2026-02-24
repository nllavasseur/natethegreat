"use client";

import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import React from "react";
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

  const hideChrome = pathname?.startsWith("/estimates/contract") || pathname?.startsWith("/auth");

  const [sessionChecked, setSessionChecked] = React.useState(false);

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
    if (typeof window === "undefined") return;
    // If any modal left the body in a scroll-locked state, iOS can act like the top UI is blocked
    // until the next scroll/paint. Always clear stale locks on route changes.
    const body = document.body;
    if (body.style.position === "fixed" || body.style.overflow === "hidden") {
      body.style.position = "";
      body.style.top = "";
      body.style.width = "";
      body.style.overflow = "";
    }
  }, [pathname]);

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

  const headerRef = React.useRef<HTMLDivElement | null>(null);
  const mainRef = React.useRef<HTMLElement | null>(null);

  const [tabTapDebug, setTabTapDebug] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!pathname?.startsWith("/estimates")) return;
    if (!String(window.location.search || "").includes("draft=")) return;

    let enabled = true;
    const off = window.setTimeout(() => {
      enabled = false;
      setTabTapDebug(null);
    }, 12000);

    const onDown = (e: PointerEvent) => {
      if (!enabled) return;
      try {
        const y = (e as any).clientY as number;
        const headerH = headerRef.current?.getBoundingClientRect().bottom ?? 0;
        if (y > headerH + 8) return;

        const x = (e as any).clientX as number;
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        const tag = el?.tagName ? el.tagName.toLowerCase() : "";
        const cls = el?.className ? String(el.className) : "";
        const pe = el ? window.getComputedStyle(el).pointerEvents : "";
        const zi = el ? window.getComputedStyle(el).zIndex : "";
        setTabTapDebug(`${tag}${cls ? `.${cls}` : ""} pe=${pe} z=${zi}`.slice(0, 220));
        window.setTimeout(() => setTabTapDebug(null), 2500);
      } catch {
        // ignore
      }
    };

    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      window.clearTimeout(off);
      document.removeEventListener("pointerdown", onDown as any);
    };
  }, [pathname]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (hideChrome) {
      document.documentElement.style.setProperty("--vf-header-h", "0px");
      return;
    }

    const el = headerRef.current;
    if (!el) return;

    const setHeaderH = () => {
      const h = Math.max(0, Math.ceil(el.getBoundingClientRect().height));
      document.documentElement.style.setProperty("--vf-header-h", `${h}px`);
    };

    const raf = window.requestAnimationFrame(setHeaderH);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => setHeaderH());
      ro.observe(el);
    }

    window.addEventListener("resize", setHeaderH);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", setHeaderH);
      try {
        ro?.disconnect();
      } catch {
        // ignore
      }
    };
  }, [hideChrome, pathname]);

  if (!sessionChecked && !pathname?.startsWith("/quotes/print") && !pathname?.startsWith("/estimates/contract")) {
    return <div className="min-h-dvh vf-app-bg" />;
  }

  return (
    <div className="min-h-dvh flex flex-col vf-app-bg">
      {hideChrome ? null : (
        <div ref={headerRef} className="sticky top-0 z-[59] isolate transform-gpu">
          <TopBar />
          <nav aria-label="Top navigation">
            <div className="mx-auto max-w-[980px] px-4 pb-3 pt-3">
              <div className="backdrop-blur-ios bg-[rgba(20,30,24,.55)] border border-[var(--stroke)] shadow-glass rounded-2xl h-16 flex items-center justify-around">
                {tabs.map((t) => {
                  const isActive = active === t.href;
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.href}
                      type="button"
                      onPointerDown={(e) => {
                        try {
                          window.location.href = t.href;
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : String(err || "");
                          setTabTapDebug((prev) => `${prev || ""} navErr=${msg}`.slice(0, 220));
                        }
                      }}
                      onClick={() => {
                        try {
                          window.location.href = t.href;
                        } catch {
                          try {
                            window.location.href = t.href;
                          } catch {
                            // ignore
                          }
                        }
                      }}
                      className={clsx(
                        "flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-xl transition touch-manipulation",
                        isActive ? "bg-[rgba(255,255,255,.10)]" : "opacity-80 hover:opacity-100"
                      )}
                    >
                      <Icon className={clsx("h-5 w-5", isActive ? "text-white" : "text-[rgba(255,255,255,.8)]")} />
                      <span
                        className={clsx(
                          "text-[11px] font-semibold",
                          isActive ? "text-white" : "text-[rgba(255,255,255,.75)]"
                        )}
                      >
                        {t.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {tabTapDebug ? (
                <div className="mt-2 rounded-2xl border border-[rgba(255,214,10,.45)] bg-[rgba(255,214,10,.16)] px-3 py-2 text-[11px] font-black text-[rgba(255,244,200,.98)]">
                  {tabTapDebug}
                </div>
              ) : null}
            </div>
          </nav>
        </div>
      )}

      <main
        ref={(el) => {
          mainRef.current = el;
        }}
        className={clsx(
          "flex-1 max-w-[980px] w-full mx-auto",
          hideChrome ? "px-0 pb-0 pt-0" : "px-4 pb-6 pt-3"
        )}
      >
        {children}
      </main>
    </div>
  );
}
