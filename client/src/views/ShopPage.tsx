"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Badge } from "@/components/ui/badge";
import { SkeletonPage } from "@/components/ui/skeleton";
import { PageLayout } from "@/components/PageLayout";
import { BackButton } from "@/components/BackButton";
import { BadgeSelector } from "@/components/BadgeSelector";
import { UserBadge, BADGE_DEFINITIONS, type BadgeId } from "@/components/UserBadge";
import { THEMES } from "@/components/game/boardThemes";
import { ThemeSwatch } from "@/components/game/ThemePicker";
import {
  getShopCatalog,
  createCheckoutSession,
  getMyAchievements,
  getSubscriptions,
  cancelSubscription,
  type ShopCatalogItem,
  type Subscription,
} from "@/lib/api";
import { isAdmin, canSeeShop } from "@/lib/featureGate";
import { toastError } from "@/lib/errors";
import { Link } from "@/i18n/navigation";
import confetti from "canvas-confetti";

// Achievement IDs that auto-grant a corresponding badge (must match server/config/badgeRewards.ts)
const ACHIEVEMENT_BADGE_MAP: Record<string, string> = {
  veteran: "veteran",
  "top-one-percent": "top-one-percent",
  "tournament-champion": "tournament-champion",
  "one-jump-wonder": "one-jump-wonder",
  "flawless-victory": "flawless-victory",
  "one-second-glory": "one-second-glory",
  "david-vs-goliath": "david-vs-goliath",
};

// Reverse lookup: badgeId → achievementId, used to deep-link locked
// achievement-earned badges to the achievement that unlocks them.
const BADGE_ACHIEVEMENT_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ACHIEVEMENT_BADGE_MAP).map(([ach, badge]) => [badge, ach]),
);

const BADGE_DESCRIPTION_KEYS: Record<string, string> = {
  supporter: "supporterDesc",
  contributor: "contributorDesc",
  "super-supporter": "superSupporterDesc",
  "official-champion": "championDesc",
  creator: "creatorDesc",
  veteran: "veteranDesc",
  "top-one-percent": "topOnePercentDesc",
  "tournament-champion": "tournamentChampionDesc",
  "one-jump-wonder": "oneJumpWonderDesc",
  "flawless-victory": "flawlessVictoryDesc",
  "one-second-glory": "oneSecondGloryDesc",
  "david-vs-goliath": "davidVsGoliathDesc",
  patron: "patronDesc",
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
  const { auth, authLoading, applyAuth, onOpenAuth } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [catalog, setCatalog] = useState<ShopCatalogItem[] | null>(null);
  const [earnedBadgeIds, setEarnedBadgeIds] = useState<Set<string>>(new Set());
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [buyingItem, setBuyingItem] = useState<string | null>(null);
  const [cancellingItem, setCancellingItem] = useState<string | null>(null);

  const isAccount = auth?.player.kind === "account";

  const fetchCatalog = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [shopRes, achievementRes, subsRes] = await Promise.all([
          getShopCatalog(),
          isAccount ? getMyAchievements() : Promise.resolve(null),
          isAccount ? getSubscriptions() : Promise.resolve(null),
        ]);
        setCatalog(shopRes.catalog);
        if (achievementRes) {
          const unlockedIds = new Set(achievementRes.achievements.map((a) => a.achievementId));
          const earned = new Set<string>();
          for (const [achId, badgeId] of Object.entries(ACHIEVEMENT_BADGE_MAP)) {
            if (unlockedIds.has(achId)) earned.add(badgeId);
          }
          setEarnedBadgeIds(earned);
        }
        if (subsRes) {
          setSubscriptions(subsRes.subscriptions);
        }
      } catch {
        // Silently fail — show empty state
      } finally {
        setLoading(false);
      }
    },
    [isAccount],
  );

  const hasFetchedRef = useRef(false);
  useEffect(() => {
    // First fetch shows loading skeleton; subsequent (auth change) fetches are silent
    void fetchCatalog(hasFetchedRef.current);
    hasFetchedRef.current = true;
  }, [fetchCatalog, auth]);

  // Handle Stripe redirect — track the purchased item for confetti after load
  const [purchasedItem, setPurchasedItem] = useState<string | null>(null);

  // Verify the Stripe webhook actually granted the item before celebrating.
  // Stripe redirects the player back here as soon as Checkout completes, but
  // the webhook that mutates the DB runs separately and can fail (e.g. a
  // schema validation error). If we toast + confetti unconditionally we lie
  // to the user; instead poll the catalog and only celebrate if ownership
  // (or an active subscription) actually flipped on.
  const verifyPurchase = useCallback(
    async (itemParam: string | null) => {
      if (!itemParam) return;
      // itemParam is "<type>-<id>" — split on first dash so multi-segment
      // ids like "badge-1" survive.
      const dash = itemParam.indexOf("-");
      if (dash < 0) return;
      const itemType = itemParam.slice(0, dash);
      const itemId = itemParam.slice(dash + 1);

      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const [shopRes, subsRes] = await Promise.all([
            getShopCatalog(),
            isAccount ? getSubscriptions() : Promise.resolve(null),
          ]);
          setCatalog(shopRes.catalog);
          if (subsRes) setSubscriptions(subsRes.subscriptions);

          const catalogItem = shopRes.catalog.find((i) => i.type === itemType && i.id === itemId);
          const isRecurring = !!catalogItem?.recurring;
          const subActive =
            isRecurring &&
            !!subsRes?.subscriptions.find((s) => s.badgeId === itemId && s.status === "active");

          if (catalogItem?.owned || subActive) {
            toast.success(t("purchaseSuccess", { item: itemParam }));
            setPurchasedItem(itemParam);
            return;
          }
        } catch {
          // ignore and retry
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Webhook never landed — clean error, no confetti.
      toast.error(t("purchaseFailed"));
    },
    [isAccount, t],
  );

  useEffect(() => {
    const success = searchParams?.get("success");
    const cancelled = searchParams?.get("cancelled");
    const item = searchParams?.get("item");

    if (success === "true") {
      window.history.replaceState({}, "", window.location.pathname);
      void verifyPurchase(item);
    } else if (cancelled === "true") {
      toast(t("purchaseCancelled"));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire confetti + scroll once the purchased item element appears in the DOM
  useEffect(() => {
    if (!purchasedItem) return;

    let cancelled = false;
    let checks = 0;

    function poll() {
      if (cancelled) return;
      checks++;

      // Re-query every time — React may replace DOM nodes during re-renders
      const el = document.getElementById(purchasedItem!);
      const rect = el?.getBoundingClientRect();
      const hasSize = rect && rect.width > 0 && rect.height > 0;

      if (el && hasSize) {
        // Scroll into view with instant behavior for speed
        el.scrollIntoView({ behavior: "instant", block: "center" });

        // Read position after instant scroll (no delay needed)
        requestAnimationFrame(() => {
          const r = el.getBoundingClientRect();
          const x = Math.max(0.05, Math.min(0.95, (r.left + r.width / 2) / window.innerWidth));
          const y = Math.max(0.05, Math.min(0.95, (r.top + r.height / 2) / window.innerHeight));

          fireConfettiBurst(x, y);
          el.classList.add("shop-purchase-wiggle");
          el.addEventListener("animationend", () => el.classList.remove("shop-purchase-wiggle"), {
            once: true,
          });
          setPurchasedItem(null);
        });
        return;
      }

      if (checks > 50) {
        // Give up — fire from center
        fireConfettiBurst(0.5, 0.45);
        setPurchasedItem(null);
      } else {
        // Element not ready yet — keep polling
        setTimeout(poll, 100);
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [purchasedItem]);

  // Scroll to and highlight the target element from the URL hash.
  // Wait until catalog is loaded so the target element exists in the DOM.
  useEffect(() => {
    if (loading) return; // catalog hasn't loaded yet
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const timer = setTimeout(() => {
      const el = document.getElementById(hash);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Delay adding the class so scroll finishes before the animation plays
      setTimeout(() => {
        el.classList.add("shop-item-highlight");
        el.addEventListener("animationend", () => el.classList.remove("shop-item-highlight"), {
          once: true,
        });
      }, 400);
    }, 100);
    return () => clearTimeout(timer);
  }, [loading]);

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

  async function handleCancel(sub: Subscription) {
    if (!confirm(t("cancelConfirm"))) return;

    setCancellingItem(sub.subscriptionId);
    try {
      const res = await cancelSubscription(sub.subscriptionId);
      const date = new Date(res.currentPeriodEnd).toLocaleDateString();
      toast.success(t("subscriptionCancelled", { date }));
      void fetchCatalog(true);
    } catch (error) {
      toastError(error);
    } finally {
      setCancellingItem(null);
    }
  }

  // In production the shop is admin-only (used to playtest Stripe flows
  // without exposing purchases to all players). Redirect anyone else home.
  useEffect(() => {
    if (authLoading) return;
    if (!canSeeShop(auth)) {
      router.replace("/");
    }
  }, [authLoading, auth, router]);

  if (authLoading || !canSeeShop(auth)) {
    return <SkeletonPage />;
  }

  const oneTimeBadgeItems = catalog?.filter((i) => i.type === "badge" && !i.recurring) ?? [];
  const subscriptionBadgeItems = catalog?.filter((i) => i.type === "badge" && i.recurring) ?? [];
  const themeItems = catalog?.filter((i) => i.type === "theme") ?? [];

  function getSubscriptionForBadge(badgeId: string): Subscription | undefined {
    return subscriptions.find((s) => s.badgeId === badgeId);
  }

  return (
    <PageLayout mainClassName="gap-6 pb-12">
      <BackButton />
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
                {oneTimeBadgeItems.map((item) => {
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
                          <Badge className="whitespace-nowrap bg-emerald-100 text-emerald-700">
                            {t("owned")}
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            className="whitespace-nowrap"
                            onClick={() => handleBuy(item)}
                            disabled={buyingItem === `${item.type}-${item.id}`}
                          >
                            {buyingItem === `${item.type}-${item.id}` ? t("processing") : t("buy")}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Subscription badges */}
                {subscriptionBadgeItems.map((item) => {
                  const def = BADGE_DEFINITIONS[item.id as BadgeId];
                  if (!def) return null;
                  const descKey = BADGE_DESCRIPTION_KEYS[item.id];
                  const sub = getSubscriptionForBadge(item.id);
                  const isCanceled = sub?.status === "canceled";

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
                      <div className="mt-4 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="font-display text-lg font-bold text-[#2b1e14]">
                            {t("perMonth", { price: formatPrice(item.price, item.currency) })}
                          </span>
                          {!sub && (
                            <Button
                              size="sm"
                              onClick={() => handleBuy(item)}
                              disabled={buyingItem === `${item.type}-${item.id}`}
                            >
                              {buyingItem === `${item.type}-${item.id}`
                                ? t("processing")
                                : t("subscribe")}
                            </Button>
                          )}
                        </div>
                        {sub?.status === "active" && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-emerald-700">
                              {t("activeSubscription", {
                                date: new Date(sub.currentPeriodEnd).toLocaleDateString(),
                              })}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-red-600 hover:text-red-700"
                              onClick={() => handleCancel(sub)}
                              disabled={cancellingItem === sub.subscriptionId}
                            >
                              {t("cancelSubscription")}
                            </Button>
                          </div>
                        )}
                        {isCanceled && sub && (
                          <span className="text-xs text-amber-600">
                            {t("cancellingSubscription", {
                              date: new Date(sub.currentPeriodEnd).toLocaleDateString(),
                            })}
                          </span>
                        )}
                        {sub?.status === "past_due" && (
                          <span className="text-xs text-red-600">{t("pastDueSubscription")}</span>
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

      {/* Earned Badges Section */}
      {Object.keys(ACHIEVEMENT_BADGE_MAP).length > 0 && (
        <AnimatedCard delay={0.05}>
          <PaperCard id="earned-badges" className="scroll-mt-24">
            <CardHeader>
              <Badge className="w-fit bg-[#d4edda] text-[#155724] mb-2">
                {t("earnedBadgesLabel")}
              </Badge>
              <CardTitle className="text-2xl text-[#2b1e14]">{t("earnedBadgesTitle")}</CardTitle>
              <CardDescription>{t("earnedBadgesDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Object.values(ACHIEVEMENT_BADGE_MAP).map((badgeId) => {
                  const def = BADGE_DEFINITIONS[badgeId as BadgeId];
                  if (!def) return null;
                  const descKey = BADGE_DESCRIPTION_KEYS[badgeId];
                  const earned = earnedBadgeIds.has(badgeId);
                  const achievementId = BADGE_ACHIEVEMENT_MAP[badgeId];

                  const card = (
                    <div
                      id={`badge-${badgeId}`}
                      className={cn(
                        "flex h-full flex-col justify-between rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-5 shadow-xs shop-item scroll-mt-24",
                        !earned && "opacity-60 transition hover:opacity-80",
                      )}
                    >
                      <div>
                        <div className="mb-3">
                          <UserBadge badge={badgeId as BadgeId} />
                        </div>
                        <p className="text-sm text-[#6e5b48]">
                          {descKey ? tBadges(descKey) : def.label}
                        </p>
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-2">
                        {earned ? (
                          <>
                            <span />
                            <Badge className="bg-emerald-100 text-emerald-700">{t("earned")}</Badge>
                          </>
                        ) : (
                          <>
                            <span className="text-xs font-medium text-[#8b7356] underline-offset-2 group-hover:underline">
                              {t("viewAchievement")} →
                            </span>
                            <Badge variant="outline" className="text-[#8b7356]">
                              {t("locked")}
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                  );

                  if (!earned && achievementId) {
                    return (
                      <Link
                        key={badgeId}
                        href={`/achievements#achievement-${achievementId}`}
                        className="group block"
                      >
                        {card}
                      </Link>
                    );
                  }

                  return <div key={badgeId}>{card}</div>;
                })}
              </div>
            </CardContent>
          </PaperCard>
        </AnimatedCard>
      )}

      {/* Board Themes Section */}
      <AnimatedCard delay={0.1}>
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
                          <Badge className="whitespace-nowrap bg-emerald-100 text-emerald-700">
                            {t("owned")}
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            className="whitespace-nowrap"
                            onClick={() => handleBuy(item)}
                            disabled={buyingItem === `${item.type}-${item.id}`}
                          >
                            {buyingItem === `${item.type}-${item.id}` ? t("processing") : t("buy")}
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
    </PageLayout>
  );
}
