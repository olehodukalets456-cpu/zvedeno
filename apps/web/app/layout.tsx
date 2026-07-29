import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./report-v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zvedeno",
  description: "Persistent client-ready Meta Ads reports"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
