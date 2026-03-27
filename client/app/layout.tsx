import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tiao",
  description: "Tiao with local play, invite rooms, and a Go-board inspired interface.",
  openGraph: {
    title: "Tiao",
    description: "Local and multiplayer Tiao with a polished Go-board inspired interface.",
    images: ["/tiao-thumbnail.png"],
  },
  icons: {
    icon: { url: "/tiao-icon.svg", type: "image/svg+xml" },
    apple: "/tiao-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2a1d13",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
