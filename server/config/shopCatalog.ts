export type ShopItemType = "badge" | "theme";

export type ShopItem = {
  type: ShopItemType;
  id: string;
  /** Price in cents (USD). */
  price: number;
  currency: "usd";
  /**
   * Human-readable English name passed to Stripe as the line-item product
   * name. Shown in Stripe Checkout and on email receipts — never in the app
   * itself (the app reads localized names from the client translation files
   * via the badge id). Use distinct names per variant so customers can tell
   * receipts apart at a glance.
   */
  stripeName: string;
  /** If present, this is a subscription item. */
  recurring?: { interval: "month" | "year" };
};

export const SHOP_ITEMS: ShopItem[] = [
  // Badges — supporter tiers (including color variants) are purchasable.
  // Contributor, Champion, and Creator are earned/granted, not sold.
  {
    type: "badge",
    id: "supporter",
    price: 299,
    currency: "usd",
    stripeName: "Supporter Badge — Classic Gold",
  },
  {
    type: "badge",
    id: "super-supporter",
    price: 599,
    currency: "usd",
    stripeName: "Super Supporter Badge — Animated Gold",
  },
  {
    type: "badge",
    id: "badge-1",
    price: 299,
    currency: "usd",
    stripeName: "Supporter Badge — Coral",
  },
  {
    type: "badge",
    id: "badge-2",
    price: 299,
    currency: "usd",
    stripeName: "Supporter Badge — Indigo",
  },
  {
    type: "badge",
    id: "badge-3",
    price: 599,
    currency: "usd",
    stripeName: "Supporter Badge — Rose Shimmer",
  },
  {
    type: "badge",
    id: "badge-4",
    price: 599,
    currency: "usd",
    stripeName: "Supporter Badge — Teal Shimmer",
  },
  {
    type: "badge",
    id: "badge-5",
    price: 299,
    currency: "usd",
    stripeName: "Supporter Badge — Slate",
  },
  {
    type: "badge",
    id: "badge-6",
    price: 599,
    currency: "usd",
    stripeName: "Supporter Badge — Ember Shimmer",
  },
  {
    type: "badge",
    id: "badge-7",
    price: 999,
    currency: "usd",
    stripeName: "Supporter Badge — Prism Rainbow",
  },
  {
    type: "badge",
    id: "badge-8",
    price: 599,
    currency: "usd",
    stripeName: "Supporter Badge — Midnight Blue",
  },

  // Subscription badges
  {
    type: "badge",
    id: "patron",
    price: 499,
    currency: "usd",
    stripeName: "Patron Badge",
    recurring: { interval: "month" },
  },

  // Board themes (classic is free/default, not in shop)
  { type: "theme", id: "night", price: 199, currency: "usd", stripeName: "Night Board Theme" },
  { type: "theme", id: "sakura", price: 199, currency: "usd", stripeName: "Sakura Board Theme" },
  { type: "theme", id: "ocean", price: 199, currency: "usd", stripeName: "Ocean Board Theme" },
  { type: "theme", id: "marble", price: 199, currency: "usd", stripeName: "Marble Board Theme" },
];

/** Lookup a shop item by type + id. */
export function findShopItem(type: ShopItemType, id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.type === type && item.id === id);
}
