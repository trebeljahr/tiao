import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { notFound } from "next/navigation";
import { Providers } from "./providers";
import "./globals.css";

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
    images: [{ url: "/tiao-thumbnail.png", width: 1200, height: 630, alt: "Tiao board game" }],
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
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
