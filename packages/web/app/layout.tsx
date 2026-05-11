import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Headline title + description used in the <title>, search results,
// and as the OpenGraph / Twitter card fallback. Kept short — twitter
// truncates around 60 chars and search engines around 65.
const SITE_TITLE = "Apis — permissionless GPU compute marketplace on Solana";
const SITE_DESCRIPTION =
  "Pay USDC, get IPFS results, settled on Solana. No accounts, no middleman. " +
  "Open Anchor program, registered providers, escrow-backed payments.";
const SITE_URL = "https://apis-web-five.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s · Apis",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Apis",
  keywords: [
    "Solana",
    "GPU",
    "compute marketplace",
    "Flux Schnell",
    "Anchor",
    "USDC",
    "IPFS",
    "DePIN",
  ],
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "Apis",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  // Tells the right-click "view source" agents that this is a real
  // app, not a server-side surface.
  robots: { index: true, follow: true },
};

/** Viewport-level tweaks. Next 15 split these out of `metadata` so
 *  the layout doesn't have to re-serialize on every request. */
export const viewport: Viewport = {
  themeColor: "#000000",
  // Don't auto-scale the Cyberpunk Swarm hero — we hand-tune the
  // mobile layout via tailwind breakpoints.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <Providers>
        <body
          suppressHydrationWarning
          className={`${inter.variable} ${geistMono.variable} antialiased`}
        >
          {children}
        </body>
      </Providers>
    </html>
  );
}
