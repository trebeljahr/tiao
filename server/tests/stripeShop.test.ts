import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { findShopItem, type ShopItem } from "../config/shopCatalog";
import type { ISubscription } from "../models/GameAccount";
import {
  invoiceSubscriptionId,
  otherSubscriptionEntitles,
  type StripePurchaseRecord,
  StripeShop,
  type StripeShopStore,
} from "../payments/stripeShop";

const PLAYER = "64b000000000000000000001";
const item = findShopItem("badge", "supporter")!;
const patron = findShopItem("badge", "patron")!;
const NOW = Date.UTC(2026, 9, 29);
const metadata = (i = item) => ({ playerId: PLAYER, itemType: i.type, itemId: i.id });
const copy = <T>(value: T): T => structuredClone(value);

class MemoryStore implements StripeShopStore {
  rows = new Map<string, StripePurchaseRecord>();
  badges = new Set<string>();
  subs: ISubscription[] = [];
  failGrant = false;
  failRevoke = false;
  otherPurchase = false;
  async reserve(row: StripePurchaseRecord) {
    const existing = [...this.rows.values()].find(
      (r) => r.purchaseKey === row.purchaseKey && r.active,
    );
    if (existing) return copy(existing);
    this.rows.set(row._id, copy(row));
    return copy(row);
  }
  async update(id: string, patch: Partial<StripePurchaseRecord>) {
    Object.assign(this.rows.get(id)!, patch);
  }
  async findSession(id: string) {
    return copy([...this.rows.values()].find((r) => r.sessionId === id) ?? null);
  }
  async findAttempt(id: string) {
    return copy(this.rows.get(id) ?? null);
  }
  async grant(_player: string, i: ShopItem) {
    if (this.failGrant) throw new Error("DB grant unavailable");
    this.badges.add(i.id);
  }
  async revoke(_player: string, i: ShopItem) {
    if (this.failRevoke) throw new Error("DB revoke unavailable");
    if (i.recurring && otherSubscriptionEntitles(this.subs, i.id, undefined, NOW)) return;
    if (!this.otherPurchase) this.badges.delete(i.id);
  }
  async putSubscription(_player: string, row: ISubscription) {
    this.subs = [...this.subs.filter((s) => s.subscriptionId !== row.subscriptionId), copy(row)];
  }
  async removeSubscription(_player: string, id: string) {
    this.subs = this.subs.filter((s) => s.subscriptionId !== id);
  }
}

class FakeStripe {
  sessions = new Map<string, any>();
  payments = new Map<string, any>();
  subs = new Map<string, any>();
  invoiceRows = new Map<string, any>();
  invoicePaymentsRows: any[] = [];
  disputesRows: any[] = [];
  creates = new Map<string, any>();
  requests: any[] = [];
  checkout = {
    sessions: {
      create: async (params: any, options: any) => {
        this.requests.push({ params, options });
        if (this.creates.has(options.idempotencyKey))
          return copy(this.creates.get(options.idempotencyKey));
        const session = {
          ...copy(params),
          id: `cs_test_${this.creates.size}`,
          url: "https://checkout.stripe.com/test",
          status: "open",
          payment_status: "unpaid",
          amount_total: params.line_items[0].price_data.unit_amount,
          currency: params.line_items[0].price_data.currency,
        };
        this.creates.set(options.idempotencyKey, session);
        this.sessions.set(session.id, session);
        return copy(session);
      },
      retrieve: async (id: string) => copy(this.sessions.get(id)),
      list: async ({ payment_intent }: any) => ({
        data: copy([...this.sessions.values()].filter((s) => s.payment_intent === payment_intent)),
      }),
    },
  };
  paymentIntents = { retrieve: async (id: string) => copy(this.payments.get(id)) };
  subscriptions = { retrieve: async (id: string) => copy(this.subs.get(id)) };
  invoices = { retrieve: async (id: string) => copy(this.invoiceRows.get(id)) };
  invoicePayments = {
    list: async ({ invoice, payment }: any) => ({
      data: copy(
        this.invoicePaymentsRows.filter((p) =>
          invoice ? p.invoice.id === invoice : p.payment.payment_intent === payment.payment_intent,
        ),
      ),
    }),
  };
  disputes = { list: async () => ({ data: copy(this.disputesRows) }) };
  paidPayment(id = "pi_1") {
    const p = {
      id,
      status: "succeeded",
      latest_charge: { amount: item.price, amount_refunded: 0, refunded: false, disputed: false },
    };
    this.payments.set(id, p);
    return p;
  }
  subscription() {
    const s = {
      id: "sub_1",
      metadata: metadata(patron),
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ current_period_end: NOW / 1000 + 86400 }] },
    };
    this.subs.set(s.id, s);
    return s as any;
  }
}

let db: MemoryStore, stripe: FakeStripe, shop: StripeShop;
beforeEach(() => {
  db = new MemoryStore();
  stripe = new FakeStripe();
  shop = new StripeShop(stripe, db, "https://playtiao.com", () => NOW);
});

async function buy(i = item) {
  const result = await shop.checkout(PLAYER, i, false);
  return stripe.sessions.get(result.sessionId)!;
}
async function pay() {
  const session = await buy();
  session.status = "complete";
  session.payment_status = "paid";
  session.payment_intent = "pi_1";
  stripe.paidPayment();
  await shop.webhook("checkout.session.completed", copy(session));
  return session;
}

test("concurrent requests reuse a persisted attempt and Stripe idempotency key", async () => {
  const results = await Promise.all([
    shop.checkout(PLAYER, item, true),
    shop.checkout(PLAYER, item, false),
  ]);
  assert.equal(results[0].sessionId, results[1].sessionId);
  assert.equal(stripe.creates.size, 1);
  assert.equal(db.rows.size, 1);
  assert.equal(
    stripe.requests[0].options.idempotencyKey,
    stripe.requests[1].options.idempotencyKey,
  );
  assert.match(
    stripe.requests[0].params.success_url,
    /session_id=\{CHECKOUT_SESSION_ID\}&desktop=true$/,
  );
  assert.deepEqual(stripe.requests[0].params, stripe.requests[1].params);
});

test("an expired session releases the attempt; a delayed unpaid payment keeps it locked", async () => {
  const first = await buy();
  first.status = "expired";
  const second = await buy();
  assert.notEqual(first.id, second.id);
  second.status = "complete";
  const retry = await shop.checkout(PLAYER, item, false);
  assert.equal(retry.sessionId, second.id);
  assert.equal(retry.status, "pending");
  assert.equal(stripe.creates.size, 2);
});

test("unpaid completion grants nothing; asynchronous payment success grants exactly one badge", async () => {
  const session = await buy();
  session.status = "complete";
  await shop.webhook("checkout.session.completed", copy(session));
  assert.equal(db.badges.size, 0);
  session.payment_status = "paid";
  session.payment_intent = "pi_1";
  stripe.paidPayment();
  await shop.webhook("checkout.session.async_payment_succeeded", copy(session));
  await shop.webhook("checkout.session.completed", copy(session));
  assert.deepEqual([...db.badges], [item.id]);
});

test("failed asynchronous payment unlocks retry without granting or later becoming pending", async () => {
  const session = await buy();
  session.status = "complete";
  await shop.webhook("checkout.session.async_payment_failed", copy(session));
  assert.equal((await shop.status(session.id, PLAYER))?.status, "failed");
  assert.equal(db.badges.size, 0);
  assert.notEqual((await buy()).id, session.id);
});

test("authenticated reconciliation repairs missed webhooks and refuses another account", async () => {
  const session = await buy();
  session.status = "complete";
  session.payment_status = "paid";
  session.payment_intent = "pi_1";
  stripe.paidPayment();
  assert.equal(await shop.status(session.id, "64b000000000000000000002"), null);
  assert.equal(db.badges.size, 0);
  assert.equal((await shop.status(session.id, PLAYER))?.status, "granted");
});

test("a missed asynchronous failure webhook is recovered from the current PaymentIntent", async () => {
  const session = await buy();
  session.status = "complete";
  session.payment_intent = "pi_failed";
  stripe.payments.set("pi_failed", { status: "requires_payment_method" });
  assert.equal((await shop.status(session.id, PLAYER))!.status, "failed");
  assert.equal(db.badges.size, 0);
  assert.notEqual((await buy()).id, session.id);
});

test("an unpaid subscription checkout recovers a failed initial invoice without a webhook", async () => {
  const session = await buy(patron);
  session.status = "complete";
  session.subscription = "sub_1";
  const sub = stripe.subscription();
  sub.latest_invoice = "in_failed";
  stripe.invoicePaymentsRows = [
    { invoice: { id: "in_failed" }, payment: { payment_intent: "pi_failed" } },
  ];
  stripe.payments.set("pi_failed", { status: "canceled" });
  assert.equal((await shop.status(session.id, PLAYER))!.status, "failed");
  assert.equal(db.badges.size, 0);
});

test("failed fulfillment propagates and retries keep the original checkout", async () => {
  const session = await buy();
  session.status = "complete";
  session.payment_status = "paid";
  session.payment_intent = "pi_1";
  stripe.paidPayment();
  db.failGrant = true;
  await assert.rejects(shop.webhook("checkout.session.completed", copy(session)), /DB grant/);
  assert.equal([...db.rows.values()][0].active, true);
  db.failGrant = false;
  assert.equal((await shop.checkout(PLAYER, item, false)).status, "granted");
  assert.equal(stripe.creates.size, 1);
});

test("partial refund retains access; full refund removes it and stale completion cannot regrant", async () => {
  const session = await pay();
  const charge = stripe.payments.get("pi_1").latest_charge;
  charge.amount_refunded = 1;
  await shop.webhook("charge.refunded", { payment_intent: "pi_1" });
  assert.equal(db.badges.has(item.id), true);
  charge.amount_refunded = charge.amount;
  charge.refunded = true;
  await shop.webhook("charge.refunded", { payment_intent: "pi_1" });
  assert.equal(db.badges.has(item.id), false);
  await shop.webhook("checkout.session.completed", copy(session));
  assert.equal(db.badges.has(item.id), false);
});

test("a dispute suspends access and winning restores it; other purchases keep access", async () => {
  await pay();
  stripe.payments.get("pi_1").latest_charge.disputed = true;
  stripe.disputesRows = [{ status: "needs_response" }];
  await shop.webhook("charge.dispute.created", { payment_intent: "pi_1" });
  assert.equal(db.badges.has(item.id), false);
  stripe.disputesRows[0].status = "won";
  await shop.webhook("charge.dispute.closed", { payment_intent: "pi_1" });
  assert.equal(db.badges.has(item.id), true);
  db.otherPurchase = true;
  stripe.disputesRows[0].status = "lost";
  await shop.webhook("charge.dispute.closed", { payment_intent: "pi_1" });
  assert.equal(db.badges.has(item.id), true);
});

test("cancel-at-period-end stays canceled despite Stripe's active status", async () => {
  const sub = stripe.subscription();
  sub.cancel_at_period_end = true;
  await shop.webhook("customer.subscription.updated", copy(sub));
  assert.equal(db.subs[0].status, "canceled");
  assert.equal(db.badges.has(patron.id), true);
});

test("ending Stripe preserves an active Apple or Google Play subscription", async () => {
  const sub = stripe.subscription();
  await shop.syncSubscription(sub.id);
  for (const provider of ["apple", "google_play"] as const) {
    db.subs.push({
      subscriptionId: `${provider}:other`,
      provider,
      badgeId: patron.id,
      status: "active",
      currentPeriodEnd: new Date(NOW + 86400000),
    });
    sub.status = "canceled";
    await shop.webhook("customer.subscription.deleted", copy(sub));
    assert.equal(db.badges.has(patron.id), true);
    db.subs = [];
    sub.status = "active";
    await shop.syncSubscription(sub.id);
  }
});

test("revocation errors propagate after removing a subscription row; retry still revokes", async () => {
  const sub = stripe.subscription();
  await shop.syncSubscription(sub.id);
  sub.status = "canceled";
  db.failRevoke = true;
  await assert.rejects(shop.webhook("customer.subscription.deleted", copy(sub)), /DB revoke/);
  assert.equal(db.subs.length, 0);
  db.failRevoke = false;
  await shop.webhook("customer.subscription.deleted", copy(sub));
  assert.equal(db.badges.has(patron.id), false);
});

test("new and legacy failed invoice references reconcile current subscription status", async () => {
  const sub = stripe.subscription();
  sub.status = "past_due";
  for (const invoice of [
    { subscription: sub.id },
    { parent: { subscription_details: { subscription: { id: sub.id } } } },
  ]) {
    assert.equal(invoiceSubscriptionId(invoice), sub.id);
    await shop.webhook("invoice.payment_failed", invoice);
    assert.equal(db.subs[0].status, "past_due");
  }
  sub.status = "active";
  // A stale failure event cannot overwrite recovered payment state.
  await shop.webhook("invoice.payment_failed", { subscription: sub.id });
  assert.equal(db.subs[0].status, "active");
});

test("current-period refund revokes Patron; refunding an old invoice preserves a newer paid period", async () => {
  const sub = stripe.subscription();
  sub.latest_invoice = "in_new";
  const oldInvoice = { id: "in_old", parent: { subscription_details: { subscription: sub.id } } };
  const invoice = {
    id: "in_new",
    status: "paid",
    amount_paid: patron.price,
    parent: { subscription_details: { subscription: sub.id } },
  };
  stripe.invoiceRows.set(invoice.id, invoice);
  stripe.invoicePaymentsRows = [
    { invoice: oldInvoice, payment: { payment_intent: "pi_old" } },
    { invoice, payment: { payment_intent: "pi_new" } },
  ];
  stripe.paidPayment("pi_old").latest_charge.refunded = true;
  stripe.paidPayment("pi_new");
  await shop.webhook("charge.refunded", { payment_intent: "pi_old" });
  assert.equal(db.badges.has(patron.id), true);
  stripe.payments.get("pi_new").latest_charge.refunded = true;
  await shop.webhook("charge.refunded", { payment_intent: "pi_new" });
  assert.equal(db.badges.has(patron.id), false);
  assert.equal(db.subs[0].subscriptionId, sub.id);
  assert.equal(db.subs[0].accessSuspended, true);
  assert.equal(otherSubscriptionEntitles(db.subs, patron.id, undefined, NOW), false);
});

test("terminal unpaid subscription states remove access and old events cannot resurrect it", async () => {
  const sub = stripe.subscription();
  await shop.syncSubscription(sub.id);
  const stale = copy(sub);
  sub.status = "unpaid";
  await shop.webhook("customer.subscription.updated", stale);
  assert.equal(db.badges.has(patron.id), false);
});

test("checkout amount mismatch fails closed and old unknown attempts cannot be recreated", async () => {
  const session = await buy();
  session.status = "complete";
  session.payment_status = "paid";
  session.amount_total = 1;
  await assert.rejects(shop.status(session.id, PLAYER), /amount/);
  const row = [...db.rows.values()][0];
  delete row.sessionId;
  row.createdAt = new Date(NOW - 24 * 3600000);
  await assert.rejects(shop.checkout(PLAYER, item, false), /reconciliation/);
});
