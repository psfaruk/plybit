import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OTC Binary Signals — Real-time Multi-Engine Analysis",
  description: "Real-time OTC market binary signal app with 6 weighted analysis engines, smart blender, and live WebSocket feed.",
  keywords: ["OTC", "Binary Signals", "Quotex", "Trading", "FastAPI", "WebSocket", "Real-time"],
  authors: [{ name: "OTC Signals" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "OTC Binary Signals",
    description: "Real-time OTC market binary signal app with 6 weighted analysis engines.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OTC Binary Signals",
    description: "Real-time OTC market binary signal app with 6 weighted analysis engines.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* TradingView Lightweight Charts library — same as reference app */}
        <script defer src="/lightweight-charts.js" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
