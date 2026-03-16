"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    try {
      const last = String(window.localStorage.getItem("vf_last_route_v1") || "").trim();
      if (last && last.startsWith("/") && last !== "/") {
        router.replace(last);
        return;
      }
    } catch {
      // ignore
    }
    router.replace("/estimates");
  }, [router]);

  return null;
}
