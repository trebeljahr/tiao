import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DESKTOP_SPA_PARAM_VALUE } from "@/lib/desktopPathParam";
import { OG_IMAGES } from "@/lib/metadata";
import { PublicProfilePage } from "@/views/PublicProfilePage";

type Props = { params: Promise<{ locale: string; username: string }> };

// See the matching constant in /app/[locale]/game/[gameId]/page.tsx —
// controls the web/desktop split for the shareable dynamic routes.
const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_PLATFORM === "desktop";

async function fetchPublicProfile(username: string) {
  if (process.env.NODE_ENV === "development") return null;
  const apiBase = process.env.API_URL || `http://127.0.0.1:${process.env.API_PORT || "5005"}`;
  try {
    const res = await fetch(`${apiBase}/api/player/profile/${encodeURIComponent(username)}`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      profile: { displayName: string; profilePicture?: string };
    };
    return data.profile;
  } catch {
    return null;
  }
}

/** See the twin function in /app/[locale]/game/[gameId]/page.tsx. */
export function generateStaticParams() {
  if (IS_DESKTOP_BUILD) return [{ username: DESKTOP_SPA_PARAM_VALUE }];
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, username } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  // Desktop static export: static fallback metadata only. See the
  // matching /game/[gameId]/page.tsx branch for the reasoning.
  if (IS_DESKTOP_BUILD) {
    const title = t("publicProfileTitle", { name: "" }).trim() || "Tiao";
    const description = t("siteDescription");
    return {
      title,
      description,
      openGraph: { title, description, images: OG_IMAGES },
    };
  }

  const profile = await fetchPublicProfile(username);

  const name = profile?.displayName ?? username;
  const title = t("publicProfileTitle", { name });
  const description = t("publicProfileDescription", { name });

  return {
    title,
    description,
    openGraph: { title, description, images: OG_IMAGES },
  };
}

export default function Page() {
  return <PublicProfilePage />;
}
