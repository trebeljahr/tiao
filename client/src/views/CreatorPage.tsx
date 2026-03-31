"use client";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { getPublicProfile } from "@/lib/api";

type CreatorLink = { label: string; href: string };

type CreatorPageProps = {
  name: string;
  /** Stable player ID for profile links. */
  playerId?: string;
  /** Fallback username for profile links when playerId is unavailable or lookup fails. */
  fallbackUsername?: string;
  image: string;
  roleKey: string;
  bioKey: string;
  bioTags: Record<string, (chunks: ReactNode) => ReactNode>;
  links: CreatorLink[];
};

export function CreatorPage({
  name,
  playerId,
  fallbackUsername,
  image,
  roleKey,
  bioKey,
  bioTags,
  links,
}: CreatorPageProps) {
  const t = useTranslations("creator");
  const tCommon = useTranslations("common");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileSlug, setProfileSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId) {
      // No env var — use fallback username directly
      if (fallbackUsername) {
        setProfileName(fallbackUsername);
        setProfileSlug(fallbackUsername);
      }
      return;
    }
    getPublicProfile(playerId)
      .then(({ profile }) => {
        setProfileName(profile.displayName);
        setProfileSlug(profile.displayName);
      })
      .catch(() => {
        // Lookup failed — fall back to username
        if (fallbackUsername) {
          setProfileName(fallbackUsername);
          setProfileSlug(fallbackUsername);
        }
      });
  }, [playerId, fallbackUsername]);

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

      <Navbar
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 pb-12 pt-20 sm:px-6 lg:pt-24">
        <Button
          variant="ghost"
          className="self-start text-[#8b7356]"
          onClick={() => router.push("/")}
        >
          &larr; {tCommon("backToLobby")}
        </Button>

        <Card className={paperCard + " w-full"}>
          <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
            <img
              src={image}
              alt={name}
              className="h-32 w-32 rounded-full border-4 border-[#e8d9c0] object-cover shadow-[0_20px_40px_-20px_rgba(63,37,17,0.4)]"
            />

            <div className="text-center">
              <h1 className="font-display text-3xl font-bold text-[#2b1e14]">{name}</h1>
              <p className="mt-1 text-sm font-medium text-[#8d7760]">{t(roleKey)}</p>
            </div>

            <p className="max-w-lg leading-relaxed text-[#4e3d2c]">{t.rich(bioKey, bioTags)}</p>

            <div className="flex flex-wrap gap-3">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#d8c29c] bg-[#fff8ee]/80 px-4 py-2 text-sm font-semibold text-[#5d4732] transition-colors hover:bg-[#f5e8d4]"
                >
                  {link.label}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-50"
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              ))}
            </div>

            {profileSlug && (
              <div className="w-full border-t border-[#dbc6a2] pt-4">
                <p className="text-center text-sm text-[#8d7760]">
                  {t("seeProfile")}{" "}
                  <button
                    type="button"
                    className="font-semibold text-[#5d4732] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#3a2818]"
                    onClick={() => router.push(`/profile/${encodeURIComponent(profileSlug)}`)}
                  >
                    @{profileName ?? name}
                  </button>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
