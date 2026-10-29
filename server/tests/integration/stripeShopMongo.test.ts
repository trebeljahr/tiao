import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import mongoose from "mongoose";
import { findShopItem } from "../../config/shopCatalog";
import AppStorePurchase from "../../models/AppStorePurchase";
import GameAccount from "../../models/GameAccount";
import PlayPurchase from "../../models/PlayPurchase";
import StorePurchase from "../../models/StorePurchase";
import StripePurchase from "../../models/StripePurchase";
import { mongoStripeShop } from "../../payments/mongoStripeShop";
import { type StripePurchaseRecord, StripeShop } from "../../payments/stripeShop";

const uri = process.env.STRIPE_SHOP_TEST_MONGO_URI;
const PLAYER = "64b000000000000000000001";
const item = findShopItem("badge", "supporter")!;
const patron = findShopItem("badge", "patron")!;
const NOW = Date.now();

describe("Stripe MongoDB payment guarantees", { skip: !uri }, () => {
  before(async () => {
    // This suite deletes its database. Refuse an ordinary project database.
    if (!/^tiao_stripe_test_[a-zA-Z0-9_]+$/.test(new URL(uri!).pathname.slice(1))) {
      throw new Error("Use an isolated tiao_stripe_test_* database.");
    }
    await mongoose.connect(uri!, { serverSelectionTimeoutMS: 3000 });
    await Promise.all([
      StripePurchase.init(),
      GameAccount.init(),
      StorePurchase.init(),
      PlayPurchase.init(),
      AppStorePurchase.init(),
    ]);
  });
  beforeEach(async () => {
    for (const model of [
      StripePurchase,
      GameAccount,
      StorePurchase,
      PlayPurchase,
      AppStorePurchase,
    ])
      await model.collection.deleteMany({});
    await GameAccount.collection.insertOne({
      _id: new mongoose.Types.ObjectId(PLAYER),
      displayName: "Stripe QA",
      badges: [item.id, patron.id],
      activeBadges: [item.id, patron.id],
      unlockedThemes: ["sakura"],
      activeSubscriptions: [],
    });
  });
  after(async () => {
    if (mongoose.connection.name?.startsWith("tiao_stripe_test_"))
      await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  const attempt = (id: string): StripePurchaseRecord => ({
    _id: id,
    playerId: PLAYER,
    purchaseKey: `${PLAYER}:badge:supporter`,
    itemType: "badge",
    itemId: item.id,
    desktop: false,
    active: true,
    state: "open",
    createdAt: new Date(),
  });

  test("twenty concurrent API workers share one active checkout; expired attempts can be replaced", async () => {
    const rows = await Promise.all(
      Array.from({ length: 20 }, (_, n) => mongoStripeShop.reserve(attempt(`attempt_${n}`))),
    );
    assert.equal(new Set(rows.map((r) => r._id)).size, 1);
    assert.equal(await StripePurchase.countDocuments({ active: true }), 1);
    await mongoStripeShop.update(rows[0]._id, { active: false, state: "expired" });
    const next = await mongoStripeShop.reserve(attempt("new_attempt"));
    assert.equal(next._id, "new_attempt");
    assert.equal(await StripePurchase.countDocuments(), 2);
  });

  test("Stripe refunds preserve paid Steam, Microsoft, Google Play, Apple and other Stripe purchases", async () => {
    const match = { playerId: PLAYER, itemType: "badge", itemId: item.id };
    const providers = [
      [StorePurchase, { ...match, provider: "steam", externalId: "steam_qa", status: "granted" }],
      [StorePurchase, { ...match, provider: "msstore", externalId: "ms_qa", status: "granted" }],
      [PlayPurchase, { ...match, purchaseToken: "play_qa", state: "purchased" }],
      [AppStorePurchase, { ...match, originalTransactionId: "apple_qa", status: "active" }],
      [
        StripePurchase,
        { ...attempt("paid_attempt"), sessionId: "cs_other", active: false, state: "granted" },
      ],
    ] as const;
    for (const [model, record] of providers) {
      const inserted = await model.collection.insertOne(record as never);
      await mongoStripeShop.revoke(PLAYER, item, "cs_refunded");
      assert.equal((await GameAccount.findById(PLAYER))!.badges.includes(item.id), true);
      await model.collection.deleteOne({ _id: inserted.insertedId } as never);
    }
    await mongoStripeShop.revoke(PLAYER, item, "cs_refunded");
    const account = (await GameAccount.findById(PLAYER))!;
    assert.equal(account.badges.includes(item.id), false);
    assert.equal(account.activeBadges.includes(item.id), false);
  });

  test("overlapping subscriptions retain Patron until the last entitled provider ends", async () => {
    for (const provider of ["apple", "google_play", "stripe"] as const) {
      const row = {
        subscriptionId: `${provider}:qa`,
        badgeId: patron.id,
        provider,
        status: "active" as const,
        currentPeriodEnd: new Date(NOW + 86400000),
      };
      // Concurrent notification/reconciliation updates must not duplicate rows.
      await Promise.all(
        Array.from({ length: 5 }, () => mongoStripeShop.putSubscription(PLAYER, row)),
      );
      assert.equal((await GameAccount.findById(PLAYER))!.activeSubscriptions.length, 1);
      await mongoStripeShop.revoke(PLAYER, patron);
      assert.equal((await GameAccount.findById(PLAYER))!.badges.includes(patron.id), true);
      await mongoStripeShop.removeSubscription(PLAYER, row.subscriptionId);
    }
    await mongoStripeShop.revoke(PLAYER, patron);
    assert.equal((await GameAccount.findById(PLAYER))!.badges.includes(patron.id), false);
  });

  test("an expired canceled subscription and Google Play account hold do not retain access", async () => {
    await mongoStripeShop.putSubscription(PLAYER, {
      subscriptionId: "old",
      badgeId: patron.id,
      status: "canceled",
      currentPeriodEnd: new Date(NOW - 1),
    });
    await mongoStripeShop.putSubscription(PLAYER, {
      subscriptionId: "play:hold",
      provider: "google_play",
      badgeId: patron.id,
      status: "past_due",
      currentPeriodEnd: new Date(NOW + 86400000),
    });
    await mongoStripeShop.revoke(PLAYER, patron);
    assert.equal((await GameAccount.findById(PLAYER))!.badges.includes(patron.id), false);
  });

  test("suspended Stripe access can be revoked without hiding ongoing billing controls", async () => {
    await mongoStripeShop.putSubscription(PLAYER, {
      subscriptionId: "sub_disputed",
      provider: "stripe",
      badgeId: patron.id,
      status: "active",
      accessSuspended: true,
      currentPeriodEnd: new Date(NOW + 86400000),
    });
    await mongoStripeShop.revoke(PLAYER, patron, "sub_disputed");
    const account = (await GameAccount.findById(PLAYER))!;
    assert.equal(account.badges.includes(patron.id), false);
    assert.equal(account.activeSubscriptions[0].subscriptionId, "sub_disputed");
    assert.equal(account.activeSubscriptions[0].accessSuspended, true);
  });

  test("a paid checkout recovers into the actual account without a webhook and rejects another player", async () => {
    await GameAccount.updateOne({ _id: PLAYER }, { $pull: { badges: item.id } });
    const row = await mongoStripeShop.reserve(attempt("recover"));
    await mongoStripeShop.update(row._id, { sessionId: "cs_test_recover" });
    const session = {
      id: "cs_test_recover",
      status: "complete",
      payment_status: "paid",
      mode: "payment",
      amount_total: item.price,
      currency: item.currency,
      payment_intent: "pi_qa",
      metadata: { playerId: PLAYER, itemType: item.type, itemId: item.id },
    };
    const stripe = {
      checkout: { sessions: { retrieve: async () => session } },
      paymentIntents: {
        retrieve: async () => ({
          status: "succeeded",
          latest_charge: { amount: item.price, amount_refunded: 0 },
        }),
      },
    };
    const shop = new StripeShop(stripe, mongoStripeShop, "https://playtiao.com");
    assert.equal(await shop.status(session.id, "64b000000000000000000002"), null);
    assert.equal((await shop.status(session.id, PLAYER))!.status, "granted");
    assert.equal((await GameAccount.findById(PLAYER))!.badges.includes(item.id), true);
    assert.equal((await StripePurchase.findById(row._id))!.active, false);
  });
});
