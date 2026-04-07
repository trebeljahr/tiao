import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PublicProfilePage } from "@/views/PublicProfilePage";

type Props = { params: Promise<{ locale: string; username: string }> };

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, username } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  const profile = await fetchPublicProfile(username);

  const name = profile?.displayName ?? username;
  const title = t("publicProfileTitle", { name });
  const description = t("publicProfileDescription", { name });

  return {
    title,
    description,
    openGraph: { title, description },
  };
}

export default function Page() {
  return <PublicProfilePage />;
}
