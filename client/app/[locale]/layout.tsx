import { OfflineBanner } from "@/components/OfflineBanner";
import { routing } from "@/i18n/routing";
import { OG_IMAGES } from "@/lib/metadata";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Zen_Kaku_Gothic_New, Zen_Old_Mincho } from "next/font/google";
import { notFound } from "next/navigation";
import { Providers } from "./providers";
import "./globals.css";

const zenKaku = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-zen-kaku",
  display: "swap",
});

const zenOldMincho = Zen_Old_Mincho({
  subsets: ["latin"],
  weight: ["500", "700"],
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
