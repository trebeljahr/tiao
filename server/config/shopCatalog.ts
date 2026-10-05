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
  /**
   * Steam Microtransactions item id (uint32) sent to ISteamMicroTxn/InitTxn.
   * Steam has no portal-side catalog for MicroTxn: the id, price, and
   * description travel with each InitTxn call, so this number is the only
   * stable link between a Steam order and the item. Never reuse or
   * renumber an id once it has been sold — QueryTxn and refund reports
   * echo it back. Absent for items that are not sold on Steam
   * (subscriptions).
   */
  steamItemId?: number;
  /**
   * Microsoft Store add-on Product ID (Partner Center "InAppOfferToken").
   * This is the developer-chosen string, not the 12-character Store ID —
   * the Store ID is assigned by Partner Center and resolved at runtime on
   * the client. The server matches collection items on this token.
   * Absent for items that are not sold in the Microsoft Store.
   */
  msStoreOfferToken?: string;
};

export const SHOP_ITEMS: ShopItem[] = [
  // Badges — supporter tiers (including color variants) are purchasable.
  // Contributor, Champion, and Creator are earned/granted, not sold.
  {
    type: "badge",
    id: "supporter",
    steamItemId: 1001,
    msStoreOfferToken: "tiao.badge.supporter",
    price: 299,
    currency: "usd",
    stripeName: "Supporter Badge — Classic Gold",
  },
  {
    type: "badge",
    id: "super-supporter",
    steamItemId: 1002,
    msStoreOfferToken: "tiao.badge.super-supporter",
    price: 599,
    currency: "usd",
    stripeName: "Super Supporter Badge — Animated Gold",
  },
  {
    type: "badge",
    id: "badge-1",
    steamItemId: 1003,
    msStoreOfferToken: "tiao.badge.badge-1",
    price: 299,
    currency: "usd",
    stripeName: "Supporter Badge — Coral",
  },
  {
    type: "badge",
    id: "badge-2",
    steamItemId: 1004,
    msStoreOfferToken: "tiao.badge.badge-2",
    price: 299,
    currency: "usd",
    stripeName: "Supporter Badge — Indigo",
  },
  {
    type: "badge",
    id: "badge-3",
    steamItemId: 1005,
    msStoreOfferToken: "tiao.badge.badge-3",
    price: 599,
    currency: "usd",
    stripeName: "Supporter Badge — Rose Shimmer",
  },
  {
    type: "badge",
    id: "badge-4",
    steamItemId: 1006,
    msStoreOfferToken: "tiao.badge.badge-4",
    price: 599,
    currency: "usd",
    stripeName: "Supporter Badge — Teal Shimmer",
  },
  {
    type: "badge",
    id: "badge-5",
    steamItemId: 1007,
    msStoreOfferToken: "tiao.badge.badge-5",
    price: 299,
    currency: "usd",
    stripeName: "Supporter Badge — Slate",
  },
  {
    type: "badge",
    id: "badge-6",
    steamItemId: 1008,
    msStoreOfferToken: "tiao.badge.badge-6",
    price: 599,
    currency: "usd",
    stripeName: "Supporter Badge — Ember Shimmer",
  },
  {
    type: "badge",
    id: "badge-7",
    steamItemId: 1009,
    msStoreOfferToken: "tiao.badge.badge-7",
    price: 999,
    currency: "usd",
    stripeName: "Supporter Badge — Prism Rainbow",
  },
  {
    type: "badge",
    id: "badge-8",
    steamItemId: 1010,
    msStoreOfferToken: "tiao.badge.badge-8",
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
  {
    type: "theme",
    id: "night",
    price: 199,
    currency: "usd",
    stripeName: "Night Board Theme",
    steamItemId: 2001,
    msStoreOfferToken: "tiao.theme.night",
  },
  {
    type: "theme",
    id: "sakura",
    price: 199,
    currency: "usd",
    stripeName: "Sakura Board Theme",
    steamItemId: 2002,
    msStoreOfferToken: "tiao.theme.sakura",
  },
  {
    type: "theme",
    id: "ocean",
    price: 199,
    currency: "usd",
    stripeName: "Ocean Board Theme",
    steamItemId: 2003,
    msStoreOfferToken: "tiao.theme.ocean",
  },
  {
    type: "theme",
    id: "marble",
    price: 199,
    currency: "usd",
    stripeName: "Marble Board Theme",
    steamItemId: 2004,
    msStoreOfferToken: "tiao.theme.marble",
  },
];

/** Lookup a shop item by type + id. */
export function findShopItem(type: ShopItemType, id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.type === type && item.id === id);
}

/** Lookup a shop item by its Steam MicroTxn item id. */
export function findShopItemBySteamItemId(steamItemId: number): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.steamItemId === steamItemId);
}

/** Lookup a shop item by its Microsoft Store add-on Product ID. */
export function findShopItemByMsStoreOfferToken(token: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.msStoreOfferToken === token);
}
