import "./globals.css";
import type { Metadata } from "next";
import type { Viewport } from "next";
import TabShell from "@/components/TabShell";

export const metadata: Metadata = {
  title: "Vasseur Estimator (iOS Glass)",
  description: "No-auth iOS-glass starter for Estimates / Quotes / Calendar",
  manifest: "/manifest.webmanifest",
  themeColor: "#1F4D3A",
  appleWebApp: {
    capable: true,
    title: "Vasseur Estimator",
    statusBarStyle: "black-translucent"
  },
  icons: {
    icon: "/IMG_3454.JPG",
    apple: "/IMG_3454.JPG"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TabShell>{children}</TabShell>
      </body>
    </html>
  );
}
