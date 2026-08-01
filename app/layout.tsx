import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SK_AI — one console, every model",
  description:
    "SK_AI classifies each prompt and routes it to the best-scoring AI model through OpenRouter, with live health, latency, and automatic fallback.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
