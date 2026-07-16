import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The display face of Francisco's professional language (see
// ai-workflow/RUBRIC.md). The rule read off the seed: serif carries the
// sentence that makes the argument; mono carries stamps and labels. Veto had
// no display register at all, which is why its hierarchy read flat.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

const TITLE = "Veto — the pre-trade gate that argues back";
const DESCRIPTION =
  "Paste your trade thesis. Veto decomposes it into falsifiable premises, verifies each against fresh sources, runs the bear case — and refuses to bless weak cards.";

export const metadata: Metadata = {
  metadataBase: new URL("https://veto-production.up.railway.app"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "Veto",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
