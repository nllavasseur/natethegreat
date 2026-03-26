"use client";

import Link from "next/link";
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
    const html = document.documentElement;
    if (body.style.position === "fixed" || body.style.overflow === "hidden") {
      let restoreY: number | null = null;
      try {
        const top = body.style.top;
        if (top && top.endsWith("px")) {
          const n = Number(top.replace("px", ""));
          if (Number.isFinite(n)) restoreY = Math.abs(Math.round(n));
        }
      } catch {
        // ignore
      }

      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.width = "";
      body.style.overflow = "";

      try {
        if (restoreY != null) window.scrollTo(0, restoreY);
      } catch {
        // ignore
      }
    }

    if (html.style.overflow === "hidden") {
      html.style.overflow = "";
    }
  }, [pathname]);

  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const prefetch = () => {
        try {
          tabs.forEach((t) => {
            if (!t?.href) return;
            if (t.href === active) return;
            try {
              router.prefetch(t.href);
            } catch {
              // ignore
            }
          });
        } catch {
          // ignore
        }
      };

      const ric = (window as any).requestIdleCallback as any;
      if (typeof ric === "function") {
        ric(prefetch, { timeout: 1500 });
      } else {
        window.setTimeout(prefetch, 50);
      }
    } catch {
      // ignore
    }
  }, [active, router]);

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

  const prevPathRef = React.useRef<string>("");
  const restorePathRef = React.useRef<string>("");

  const isRestorablePath = React.useCallback((p: string) => {
    if (!p) return false;
    if (p.startsWith("/auth")) return false;
    if (p.startsWith("/estimates/contract")) return false;
    if (p.startsWith("/quotes/print")) return false;
    return true;
  }, []);

  const saveScrollForPath = React.useCallback((p: string) => {
    if (typeof window === "undefined") return;
    if (!isRestorablePath(p)) return;
    try {
      window.sessionStorage.setItem(`vf_scroll_y:${p}`, String(Math.max(0, Math.round(window.scrollY || 0))));
    } catch {
      // ignore
    }
  }, [isRestorablePath]);

  const restoreScrollForPath = React.useCallback((p: string) => {
    if (typeof window === "undefined") return;
    if (!isRestorablePath(p)) return;
    let y: number | null = null;
    try {
      const raw = window.sessionStorage.getItem(`vf_scroll_y:${p}`);
      const n = raw == null ? NaN : Number(raw);
      if (Number.isFinite(n)) y = Math.max(0, Math.round(n));
    } catch {
      y = null;
    }
    if (y == null) return;

    try {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            window.scrollTo({ top: y as number, left: 0, behavior: "auto" });
          } catch {
            try {
              window.scrollTo(0, y as number);
            } catch {
              // ignore
            }
          }
        });
      });
    } catch {
      try {
        window.scrollTo(0, y);
      } catch {
        // ignore
      }
    }
  }, [isRestorablePath]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const onPopState = () => {
      try {
        const p = window.location.pathname || "";
        if (isRestorablePath(p)) restorePathRef.current = p;
      } catch {
        // ignore
      }
    };

    const onPageShow = () => {
      try {
        const p = window.location.pathname || "";
        if (isRestorablePath(p)) restoreScrollForPath(p);
      } catch {
        // ignore
      }
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [isRestorablePath, restoreScrollForPath]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const currentPath = pathname || window.location.pathname;
    const prev = prevPathRef.current;
    if (prev && prev !== currentPath) saveScrollForPath(prev);
    prevPathRef.current = currentPath;

    if (isRestorablePath(currentPath)) {
      try {
        window.localStorage.setItem("vf_last_route_v1", currentPath);
      } catch {
        // ignore
      }
    }

    const shouldRestore = restorePathRef.current === currentPath;
    if (shouldRestore) {
      restorePathRef.current = "";
      restoreScrollForPath(currentPath);
    }
  }, [pathname, isRestorablePath, restoreScrollForPath, saveScrollForPath]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const onPageHide = () => {
      try {
        const p = pathname || window.location.pathname;
        saveScrollForPath(p);
      } catch {
        // ignore
      }
    };

    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [pathname, saveScrollForPath]);

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
    <div className="min-h-dvh flex flex-col vf-app-bg overflow-x-hidden max-w-full">
      {hideChrome ? null : (
        <div ref={headerRef} className="sticky top-0 z-[59] isolate w-full max-w-full">
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
                      prefetch
                      aria-current={isActive ? "page" : undefined}
                      onClick={(e) => {
                        try {
                          if (isActive) {
                            e.preventDefault();
                            return;
                          }
                          const currentPath = pathname || "";
                          saveScrollForPath(currentPath);
                          restorePathRef.current = t.href;
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
                    </Link>
                  );
                })}
              </div>
            </div>
          </nav>
        </div>
      )}

      <main
        ref={(el) => {
          mainRef.current = el;
        }}
        className={clsx(
          "flex-1 max-w-[980px] w-full mx-auto max-w-full overflow-x-hidden",
          hideChrome ? "px-0 pb-0 pt-0" : "px-4 pb-6 pt-3"
        )}
      >
        {children}
      </main>
    </div>
  );
}
