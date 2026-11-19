import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CashFlowPilot — the agent that sells by proving the money first",
  description:
    "An autonomous revenue agent that finds finance teams, runs a no-risk trial on their invoices, shows what it recovers, and never closes a deal without the founder.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
