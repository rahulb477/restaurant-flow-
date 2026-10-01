import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ToastProvider } from "@/components/ui";
import { publicEnv } from "@/config/env";

export const metadata: Metadata = {
  metadataBase: publicEnv.appUrl ? new URL(publicEnv.appUrl) : undefined,
  title: { default: `${publicEnv.appName} — Run your cafe smarter`, template: `%s · ${publicEnv.appName}` },
  description: "QR ordering, POS, kitchen display, inventory, billing, loyalty and analytics for cafes and restaurants.",
  applicationName: publicEnv.appName,
  openGraph: { title: `${publicEnv.appName} — Run your cafe smarter`, description: "The all-in-one cafe & restaurant management platform.", type: "website", siteName: publicEnv.appName },
  appleWebApp: { capable: true, title: publicEnv.appName, statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#0c0c0e", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
