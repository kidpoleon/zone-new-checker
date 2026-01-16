import "./globals.css";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const enableAnalytics = process.env.NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS === "1";
const enableSpeedInsights = process.env.NEXT_PUBLIC_ENABLE_VERCEL_SPEED_INSIGHTS === "1";

export const metadata: Metadata = {
  title: "ZONE NEW CHECKER",
  description: "Built for r/IPTV_ZONENEW — Xtream + Stalker (MAC) validator",
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
