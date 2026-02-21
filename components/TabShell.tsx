"use client";

import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import Link from "next/link";
import React from "react";
import { IconCalendar, IconDoc, IconPortfolio, IconQuote } from "./icons";
import TopBar from "./TopBar";
import { supabase } from "@/lib/supabaseClient";

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

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        const isAuthRoute = pathname?.startsWith("/auth");
        const isPublicRoute = pathname?.startsWith("/estimates/contract") || pathname?.startsWith("/quotes/print");
        const hasSession = Boolean(data.session);

        if (!hasSession && !isAuthRoute && !isPublicRoute) {
          router.replace("/auth");
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const isAuthRoute = pathname?.startsWith("/auth");
      const isPublicRoute = pathname?.startsWith("/estimates/contract") || pathname?.startsWith("/quotes/print");
      const hasSession = Boolean(session);
      if (!hasSession && !isAuthRoute && !isPublicRoute) {
        router.replace("/auth");
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [pathname, router]);

  const mainRef = React.useRef<HTMLElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const pendingXRef = React.useRef<number | null>(null);
  const dragXRef = React.useRef(0);
  const draggingRef = React.useRef(false);
  const settlingRef = React.useRef(false);

  const swipeRef = React.useRef<{
    x0: number;
    y0: number;
    t0: number;
    pointerId: number | null;
    hasLockedDirection: boolean;
    isHorizontal: boolean;
    hasCaptured: boolean;
    lastX: number;
    lastT: number;
    scrolled: boolean;
    width: number;
    activeIndex: number;
  } | null>(null);

  React.useEffect(() => {
    // Route changes can happen mid-gesture; always snap back to a clean state.
    settlingRef.current = false;
    draggingRef.current = false;
    swipeRef.current = null;
    const el = contentRef.current;
    if (el) {
      el.style.transition = "none";
      el.style.transform = "translate3d(0px, 0, 0)";
    }
  }, [pathname]);

  function isInteractiveTarget(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return Boolean(
      el.closest(
        "input, textarea, select, button, [role='button'], [contenteditable='true'], [data-no-swipe='true']"
      )
    );
  }

  function goToAdjacentTab(direction: -1 | 1) {
    const activeIndex = tabs.findIndex((t) => t.href === active);
    if (activeIndex === -1) return;
    const nextIndex = activeIndex + direction;
    if (nextIndex < 0 || nextIndex >= tabs.length) return;
    router.push(tabs[nextIndex].href);
  }

  function applyTransform(x: number, transitionMs?: number) {
    const el = contentRef.current;
    if (!el) return;
    dragXRef.current = x;
    if (transitionMs === undefined) {
      el.style.transition = "none";
    } else {
      el.style.transition = `transform ${transitionMs}ms cubic-bezier(.18,.9,.22,1)`;
    }
    const px = Number.isFinite(x) ? x : 0;
    el.style.transform = px ? `translate3d(${px}px, 0, 0)` : "translate3d(0px, 0, 0)";
  }

  function scheduleSetDragX(nextX: number) {
    pendingXRef.current = nextX;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      const x = pendingXRef.current;
      pendingXRef.current = null;
      applyTransform(typeof x === "number" ? x : 0);
      frameRef.current = null;
    });
  }

  React.useEffect(() => {
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  if (!sessionChecked && !pathname?.startsWith("/quotes/print") && !pathname?.startsWith("/estimates/contract")) {
    return null;
  }

  return (
    <div className="min-h-dvh flex flex-col vf-app-bg">
      {hideChrome ? null : <TopBar />}

      {hideChrome ? null : (
        <nav className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30" aria-label="Top navigation">
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
      )}

      <main
        ref={(el) => {
          mainRef.current = el;
        }}
        className={clsx(
          "flex-1 max-w-[980px] w-full mx-auto",
          hideChrome ? "px-0 pb-0 pt-0" : "px-4 pb-6 pt-3"
        )}
        style={{ touchAction: "pan-y" }}
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") return;
          if (isInteractiveTarget(e.target)) return;
          if (settlingRef.current) return;

          // If the page is already scrolled, require a stronger horizontal intent before we hijack.
          const scrolled = (e.currentTarget as HTMLElement).scrollTop > 0;

          const width = mainRef.current?.clientWidth ?? (e.currentTarget as HTMLElement).clientWidth ?? 0;
          const activeIndex = tabs.findIndex((t) => t.href === active);

          swipeRef.current = {
            x0: e.clientX,
            y0: e.clientY,
            t0: Date.now(),
            pointerId: e.pointerId,
            hasLockedDirection: false,
            isHorizontal: false,
            hasCaptured: false,
            lastX: e.clientX,
            lastT: Date.now(),
            scrolled,
            width,
            activeIndex
          };
          draggingRef.current = false;
        }}
        onPointerMove={(e) => {
          const s = swipeRef.current;
          if (!s) return;
          if (s.pointerId !== e.pointerId) return;

          const dx = e.clientX - s.x0;
          const dy = e.clientY - s.y0;

          if (!s.hasLockedDirection) {
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);
            if (absX < 3 && absY < 3) return;
            s.hasLockedDirection = true;
            const ratio = s.scrolled ? 1.3 : 1.05;
            s.isHorizontal = absX > absY * ratio;
            if (s.isHorizontal) {
              draggingRef.current = true;
              if (!s.hasCaptured) {
                try {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  s.hasCaptured = true;
                } catch {
                  // ignore
                }
              }
            }
          }

          if (!s.isHorizontal) return;

          const activeIndex = s.activeIndex;
          const width = s.width;

          let nextX = dx;
          if ((activeIndex <= 0 && nextX > 0) || (activeIndex >= tabs.length - 1 && nextX < 0)) {
            nextX = nextX * 0.35;
          }

          const clamp = width ? Math.max(-width, Math.min(width, nextX)) : nextX;
          scheduleSetDragX(clamp);

          s.lastX = e.clientX;
          s.lastT = Date.now();
        }}
        onPointerUp={(e) => {
          const s = swipeRef.current;
          swipeRef.current = null;
          if (!s) return;
          if (s.pointerId !== e.pointerId) return;

          const dx = e.clientX - s.x0;
          const dy = e.clientY - s.y0;
          const dt = Math.max(1, Date.now() - s.t0);

          const absX = Math.abs(dx);
          const absY = Math.abs(dy);
          const width = s.width;
          const velocityX = absX / dt;

          draggingRef.current = false;

          const isHorizontal = s.isHorizontal || absX > absY * 1.25;
          if (!isHorizontal) {
            settlingRef.current = true;
            applyTransform(0, 180);
            setTimeout(() => {
              settlingRef.current = false;
            }, 190);
            return;
          }

          const farEnough = width ? absX >= Math.min(110, width * 0.22) : absX >= 80;
          const fastEnough = velocityX >= 0.4;
          const shouldNavigate = farEnough || fastEnough;

          const direction: -1 | 1 = dx < 0 ? 1 : -1;
          const activeIndex = s.activeIndex;
          const canNavigate =
            (direction === -1 && activeIndex > 0) ||
            (direction === 1 && activeIndex < tabs.length - 1);

          if (!shouldNavigate || !canNavigate) {
            settlingRef.current = true;
            applyTransform(0, 180);
            setTimeout(() => {
              settlingRef.current = false;
            }, 190);
            return;
          }

          settlingRef.current = true;
          applyTransform(direction === 1 ? -width : width, 190);
          setTimeout(() => {
            goToAdjacentTab(direction);
            applyTransform(0);
            settlingRef.current = false;
          }, 195);
        }}
        onPointerCancel={() => {
          swipeRef.current = null;
          draggingRef.current = false;
          settlingRef.current = true;
          applyTransform(0, 180);
          setTimeout(() => {
            settlingRef.current = false;
          }, 190);
        }}
      >
        <div
          ref={contentRef}
          style={{
            willChange: "transform"
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
