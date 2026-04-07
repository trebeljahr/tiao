"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Badge } from "@/components/ui/badge";
import { SkeletonPage } from "@/components/ui/skeleton";
import { Navbar } from "@/components/Navbar";
import { BadgeSelector } from "@/components/BadgeSelector";
import { UserBadge, BADGE_DEFINITIONS, type BadgeId } from "@/components/UserBadge";
import { THEMES } from "@/components/game/boardThemes";
import { ThemeSwatch } from "@/components/game/ThemePicker";
import { getShopCatalog, createCheckoutSession, type ShopCatalogItem } from "@/lib/api";
import { isAdmin } from "@/lib/featureGate";
import { toastError } from "@/lib/errors";
import { Link } from "@/i18n/navigation";
import confetti from "canvas-confetti";

const BADGE_DESCRIPTION_KEYS: Record<string, string> = {
  supporter: "supporterDesc",
  contributor: "contributorDesc",
  "super-supporter": "superSupporterDesc",
  "official-champion": "championDesc",
  creator: "creatorDesc",
};

const PURCHASE_CONFETTI_COLORS = [
  "#ffd700",
  "#ffb347",
  "#ff6b6b",
  "#48dbfb",
  "#ff9ff3",
  "#54a0ff",
  "#5f27cd",
  "#01a3a4",
  "#f368e0",
  "#ff9f43",
];

function fireConfettiBurst(x: number, y: number) {
  // Burst 1: fast outward spray
  confetti({
    particleCount: 80,
    spread: 360,
    startVelocity: 30,
    origin: { x, y },
    colors: PURCHASE_CONFETTI_COLORS,
    scalar: 1.0,
    gravity: 0.8,
    ticks: 160,
    shapes: ["circle", "square"],
  });

  // Burst 2: slower sparkle follow-up
  setTimeout(() => {
    confetti({
      particleCount: 50,
      spread: 280,
      startVelocity: 20,
      origin: { x, y },
      colors: PURCHASE_CONFETTI_COLORS,
      scalar: 0.8,
      gravity: 0.6,
      ticks: 200,
      shapes: ["circle"],
    });
  }, 150);
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function ShopPage() {
  const t = useTranslations("shop");
  const tBadges = useTranslations("badges");
  const { auth, authLoading, applyAuth, onOpenAuth, onLogout } = useAuth();
  const searchParams = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const [catalog, setCatalog] = useState<ShopCatalogItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyingItem, setBuyingItem] = useState<string | null>(null);

  const isAccount = auth?.player.kind === "account";

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getShopCatalog();
      setCatalog(res.catalog);
    } catch {
      // Silently fail — show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog, auth]);

  // Handle Stripe redirect — track the purchased item for confetti after load
  const [purchasedItem, setPurchasedItem] = useState<string | null>(null);

  useEffect(() => {
    const success = searchParams?.get("success");
    const cancelled = searchParams?.get("cancelled");
    const item = searchParams?.get("item");

    if (success === "true") {
      toast.success(t("purchaseSuccess", { item: item ?? "" }));
      if (item) setPurchasedItem(item);
      void fetchCatalog();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (cancelled === "true") {
      toast(t("purchaseCancelled"));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire confetti + scroll once the purchased item is in the DOM (after auth + catalog load)
  useEffect(() => {
    if (!purchasedItem || loading || authLoading) return;

    const el = document.getElementById(purchasedItem);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Fire confetti after scroll settles
      setTimeout(() => {
        const rect = el.getBoundingClientRect();
        const x = (rect.left + rect.width / 2) / window.innerWidth;
        const y = (rect.top + rect.height / 2) / window.innerHeight;
        fireConfettiBurst(x, y);
        el.classList.add("shop-item-highlight");
        el.addEventListener("animationend", () => el.classList.remove("shop-item-highlight"), {
          once: true,
        });
      }, 400);
    } else {
      // Element not found — fire from center
      fireConfettiBurst(0.5, 0.45);
    }
    setPurchasedItem(null);
  }, [purchasedItem, loading, authLoading]);

  // Scroll to and highlight the target element from the URL hash
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    // Wait a tick for the DOM to render
    const timer = setTimeout(() => {
      const el = document.getElementById(hash);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("shop-item-highlight");
      const cleanup = () => el.classList.remove("shop-item-highlight");
      el.addEventListener("animationend", cleanup, { once: true });
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  async function handleBuy(item: ShopCatalogItem) {
    if (!isAccount) {
      onOpenAuth("signup");
      return;
    }

    setBuyingItem(`${item.type}-${item.id}`);
    try {
      const { url } = await createCheckoutSession(item.type, item.id);
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      toastError(error);
    } finally {
      setBuyingItem(null);
    }
  }

  if (authLoading) {
    return <SkeletonPage />;
  }

  const badgeItems = catalog?.filter((i) => i.type === "badge") ?? [];
  const themeItems = catalog?.filter((i) => i.type === "theme") ?? [];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      <Navbar
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 pb-12 pt-20 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-4xl text-[#2b1e14]">{t("title")}</h1>
            <p className="mt-1 text-sm text-[#6e5b48]">{t("description")}</p>
          </div>
          {isAdmin(auth) && (
            <Link href="/admin/badges">
              <Button variant="outline" size="sm" className="text-xs">
                {t("adminPanel")}
              </Button>
            </Link>
          )}
        </div>

        {/* Active Badge Selector (if user has badges) */}
        {isAccount && <BadgeSelector auth={auth} onAuthChange={applyAuth} />}

        {/* Badges Section */}
        <AnimatedCard>
          <PaperCard id="badges" className="scroll-mt-24">
            <CardHeader>
              <Badge className="w-fit bg-[#f4e8d2] text-[#6c543c] mb-2">{t("badgesLabel")}</Badge>
              <CardTitle className="text-2xl text-[#2b1e14]">{t("badgesTitle")}</CardTitle>
              <CardDescription>{t("badgesDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-pulse">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-5 h-40"
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {badgeItems.map((item) => {
                    const def = BADGE_DEFINITIONS[item.id as BadgeId];
                    if (!def) return null;
                    const descKey = BADGE_DESCRIPTION_KEYS[item.id];

                    return (
                      <div
                        key={item.id}
                        id={`badge-${item.id}`}
                        className="flex flex-col justify-between rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-5 shadow-xs shop-item scroll-mt-24"
                      >
                        <div>
                          <div className="mb-3">
                            <UserBadge badge={item.id as BadgeId} />
                          </div>
                          <p className="text-sm text-[#6e5b48]">
                            {descKey ? tBadges(descKey) : def.label}
                          </p>
                        </div>
                        <div className="mt-4 flex items-center justify-between">
                          <span className="font-display text-lg font-bold text-[#2b1e14]">
                            {formatPrice(item.price, item.currency)}
                          </span>
                          {item.owned ? (
                            <Badge className="bg-emerald-100 text-emerald-700">{t("owned")}</Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleBuy(item)}
                              disabled={buyingItem === `${item.type}-${item.id}`}
                            >
                              {buyingItem === `${item.type}-${item.id}`
                                ? t("processing")
                                : t("buy")}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </PaperCard>
        </AnimatedCard>

        {/* Board Themes Section */}
        <AnimatedCard delay={0.05}>
          <PaperCard id="themes" className="scroll-mt-24">
            <CardHeader>
              <Badge className="w-fit bg-[#e8e0f4] text-[#5a4570] mb-2">{t("themesLabel")}</Badge>
              <CardTitle className="text-2xl text-[#2b1e14]">{t("themesTitle")}</CardTitle>
              <CardDescription>{t("themesDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 animate-pulse">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-4 h-48"
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {themeItems.map((item) => {
                    const theme = THEMES.find((t) => t.id === item.id);
                    if (!theme) return null;

                    return (
                      <div
                        key={item.id}
                        id={`theme-${item.id}`}
                        className="flex flex-col justify-between rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-4 shadow-xs shop-item scroll-mt-24"
                      >
                        <div>
                          <div className="mb-3 w-full">
                            <ThemeSwatch theme={theme} />
                          </div>
                          <h3 className="text-sm font-semibold text-[#2b1e14]">{theme.name}</h3>
                          <p className="text-xs text-[#6e5b48] mt-0.5">{theme.description}</p>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className="font-display text-base font-bold text-[#2b1e14]">
                            {formatPrice(item.price, item.currency)}
                          </span>
                          {item.owned ? (
                            <Badge className="bg-emerald-100 text-emerald-700">{t("owned")}</Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleBuy(item)}
                              disabled={buyingItem === `${item.type}-${item.id}`}
                            >
                              {buyingItem === `${item.type}-${item.id}`
                                ? t("processing")
                                : t("buy")}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </PaperCard>
        </AnimatedCard>
      </main>
    </div>
  );
}
