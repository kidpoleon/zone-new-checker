import "./globals.css";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

// Enable analytics by default in production, opt-out via env var
const enableAnalytics = process.env.NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS !== "0";
const enableSpeedInsights = process.env.NEXT_PUBLIC_ENABLE_VERCEL_SPEED_INSIGHTS !== "0";

export const metadata: Metadata = {
  title: "ZONE NEW CHECKER v3.1",
  description: "Professional IPTV credential validator with smart Base64 decoding — Xtream Codes + Stalker/MAG portal checker",
  icons: {
    icon: "https://i.ibb.co/5hqtGGDW/Zone-NEW-ICON-1024-x-1024-px.png",
    apple: "https://i.ibb.co/5hqtGGDW/Zone-NEW-ICON-1024-x-1024-px.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {enableAnalytics ? <Analytics /> : null}
        {enableSpeedInsights ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
