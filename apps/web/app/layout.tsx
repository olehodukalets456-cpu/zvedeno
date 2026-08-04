import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./ai-shell.css";
import "./ai-home.css";
import "./auth.css";
import "./workspace.css";
import "./report-v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zvedeno",
  description: "AI-powered Meta Ads reporting and project analytics"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
