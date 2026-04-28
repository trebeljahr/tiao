import { OfflineBanner } from "@/components/OfflineBanner";
import { routing } from "@/i18n/routing";
import { OG_IMAGES } from "@/lib/metadata";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { Providers } from "./providers";
import "./globals.css";

const zenKaku = localFont({
  src: [
    { path: "../fonts/ZenKakuGothicNew-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ZenKakuGothicNew-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ZenKakuGothicNew-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-zen-kaku",
  display: "swap",
});

const zenOldMincho = localFont({
  src: [
    { path: "../fonts/ZenOldMincho-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ZenOldMincho-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-zen-old-mincho",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Tiao — Play Online",
    template: "%s | Tiao",
  },
  description:
    "A beautiful abstract strategy board game. Play online with friends, against AI, or over the board — with a Go-board inspired interface.",
  metadataBase: new URL("https://playtiao.com"),
  openGraph: {
    type: "website",
    siteName: "Tiao",
    title: "Tiao — Play Online",
    description:
      "A beautiful abstract strategy board game. Play online with friends, against AI, or over the board.",
    images: OG_IMAGES,
  },
  twitter: {
    card: "summary_large_image",
    title: "Tiao — Play Online",
    description:
      "A beautiful abstract strategy board game. Play online with friends, against AI, or over the board.",
    images: ["/tiao-thumbnail.png"],
  },
  icons: {
    icon: { url: "/tiao-icon.svg", type: "image/svg+xml" },
    apple: "/tiao-icon.png",
  },
  manifest: "/manifest.json",
  robots: {
    index: true,
    follow: true,
  },
  appleWebApp: false,
};

export const viewport: Viewport = {
  themeColor: "#2a1d13",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${zenKaku.variable} ${zenOldMincho.variable}`}
      suppressHydrationWarning
    >
      <body>
        <NextIntlClientProvider messages={messages}>
          <OfflineBanner />
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
