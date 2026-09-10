import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "GuardrunAgent",
  description: "AI-agent observability, cost tracking, and guardrails",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
