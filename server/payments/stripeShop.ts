import { randomUUID } from "node:crypto";
import { findShopItem, type ShopItem } from "../config/shopCatalog";
import type { ISubscription } from "../models/GameAccount";
import { otherSubscriptionEntitles } from "./googlePlayFulfillment";

// Stripe event/API objects differ across webhook versions. Normalize their references here.
type StripeObject = Record<string, any>;
export const stripeId = (value: any): string | undefined =>
  typeof value === "string" ? value : value?.id;
export const invoiceSubscriptionId = (invoice: StripeObject): string | undefined =>
  stripeId(invoice.parent?.subscription_details?.subscription ?? invoice.subscription);

export function subscriptionPeriodEnd(subscription: StripeObject): Date {
  const raw = subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`Stripe subscription ${subscription.id} is missing current_period_end`);
  }
  return new Date(raw * 1000);
}

export type CheckoutState = "open" | "pending" | "granted" | "failed" | "expired" | "revoked";
export interface StripePurchaseRecord {
  _id: string;
  purchaseKey: string;
  playerId: string;
  itemType: "badge" | "theme";
  itemId: string;
  desktop: boolean;
  active: boolean;
  state: CheckoutState;
  createdAt: Date;
  sessionId?: string;
}

export interface StripeShopStore {
  reserve(record: StripePurchaseRecord): Promise<StripePurchaseRecord>;
  update(id: string, patch: Partial<StripePurchaseRecord>): Promise<void>;
  findSession(sessionId: string): Promise<StripePurchaseRecord | null>;
  findAttempt(id: string): Promise<StripePurchaseRecord | null>;
  grant(playerId: string, item: ShopItem): Promise<void>;
  /** Checks other payment providers and removes only this purchase's entitlement. */
  revoke(playerId: string, item: ShopItem, exceptSession?: string): Promise<void>;
  putSubscription(playerId: string, record: ISubscription): Promise<void>;
  removeSubscription(playerId: string, id: string): Promise<void>;
}

function purchaseMetadata(object: StripeObject): { playerId: string; item: ShopItem } | null {
  const { playerId, itemType, itemId } = object.metadata ?? {};
  if (typeof playerId !== "string" || !/^[a-f0-9]{24}$/i.test(playerId)) return null;
  const item = findShopItem(itemType, itemId);
  return item ? { playerId, item } : null;
}

export class StripeShop {
  constructor(
    private stripe: any,
    private store: StripeShopStore,
    private origin: string,
    private now = () => Date.now(),
  ) {}

  async checkout(playerId: string, item: ShopItem, desktop: boolean, customer?: string) {
    for (let retry = 0; retry < 2; retry++) {
      const attempt = await this.store.reserve({
        _id: randomUUID(),
        purchaseKey: `${playerId}:${item.type}:${item.id}`,
        playerId,
        itemType: item.type,
        itemId: item.id,
        desktop,
        active: true,
        state: "open",
        createdAt: new Date(this.now()),
      });
      if (attempt.sessionId) {
        const session = await this.stripe.checkout.sessions.retrieve(attempt.sessionId);
        if (session.status === "expired") {
          await this.store.update(attempt._id, { active: false, state: "expired" });
          continue;
        }
        // Completed sessions cannot be paid twice. Keep pending payments locked.
        if (session.status === "complete") {
          const result = await this.fulfill(session);
          return { sessionId: session.id, url: null, ...result };
        }
        return { sessionId: session.id, url: session.url, status: "open" as const };
      }
      // Stripe retains idempotency keys for at least 24h. Never blindly recreate
      // an old attempt whose response was lost; doing so could charge twice.
      if (this.now() - attempt.createdAt.getTime() > 23 * 3600_000) {
        throw new Error("Checkout needs reconciliation before another payment can be started.");
      }
      const metadata = { playerId, itemType: item.type, itemId: item.id, checkoutId: attempt._id };
      const session = await this.stripe.checkout.sessions.create(
        {
          mode: item.recurring ? "subscription" : "payment",
          ...(item.recurring
            ? { customer, subscription_data: { metadata } }
            : { payment_intent_data: { metadata } }),
          client_reference_id: attempt._id,
          line_items: [
            {
              price_data: {
                currency: item.currency,
                unit_amount: item.price,
                ...(item.recurring ? { recurring: item.recurring } : {}),
                product_data: { name: item.stripeName },
              },
              quantity: 1,
            },
          ],
          metadata,
          success_url: `${this.origin}/shop?session_id={CHECKOUT_SESSION_ID}${attempt.desktop ? "&desktop=true" : ""}`,
          cancel_url: `${this.origin}/shop?cancelled=true${attempt.desktop ? "&desktop=true" : ""}`,
        },
        { idempotencyKey: `shop:${attempt._id}` },
      );
      await this.store.update(attempt._id, { sessionId: session.id });
      return { sessionId: session.id, url: session.url, status: "open" as const };
    }
    throw new Error("Checkout expired. Please retry.");
  }

  /** Check the current payment, rather than trusting an old webhook's snapshot. */
  private async paymentEntitles(id: string): Promise<boolean> {
    const payment = await this.stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] });
    if (payment.status !== "succeeded") return false;
    const charge = payment.latest_charge;
    if (!charge || typeof charge === "string") throw new Error("Missing expanded payment charge.");
    if (charge.refunded || charge.amount_refunded >= charge.amount) return false;
    if (charge.disputed) {
      const disputes = await this.stripe.disputes.list({ payment_intent: id, limit: 100 });
      if (disputes.data.some((d: StripeObject) => !["won", "warning_closed"].includes(d.status)))
        return false;
    }
    return true;
  }

  private async paymentFailed(session: StripeObject): Promise<boolean> {
    let ids = [stripeId(session.payment_intent)].filter(Boolean) as string[];
    const subscriptionId = stripeId(session.subscription);
    if (!ids.length && subscriptionId) {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      if (["canceled", "incomplete_expired", "unpaid"].includes(subscription.status)) return true;
      const invoiceId = stripeId(subscription.latest_invoice);
      if (invoiceId) {
        const payments = await this.stripe.invoicePayments.list({ invoice: invoiceId, limit: 100 });
        ids = payments.data
          .map((p: StripeObject) => stripeId(p.payment?.payment_intent))
          .filter(Boolean);
        if (!ids.length) {
          const invoice = await this.stripe.invoices.retrieve(invoiceId);
          const legacy = stripeId(invoice.payment_intent);
          if (legacy) ids.push(legacy);
        }
      }
    }
    const payments = await Promise.all(ids.map((id) => this.stripe.paymentIntents.retrieve(id)));
    return (
      payments.length > 0 &&
      payments.every((p) => ["canceled", "requires_payment_method"].includes(p.status))
    );
  }

  async fulfill(session: StripeObject) {
    const meta = purchaseMetadata(session);
    if (!meta) throw new Error(`Checkout ${session.id} has invalid shop metadata.`);
    const { playerId, item } = meta;
    let record = await this.store.findSession(session.id);
    if (!record && session.metadata.checkoutId) {
      record = await this.store.findAttempt(session.metadata.checkoutId);
    }
    if (
      record &&
      (record.playerId !== playerId || record.itemId !== item.id || record.itemType !== item.type)
    ) {
      throw new Error("Checkout ownership does not match its reserved attempt.");
    }
    let status: CheckoutState =
      session.status === "expired" ? "expired" : session.status === "open" ? "open" : "pending";
    if (record?.state === "failed" && status === "pending") status = "failed";
    const paid =
      session.payment_status === "paid" || session.payment_status === "no_payment_required";
    if (status === "pending" && !paid && (await this.paymentFailed(session))) status = "failed";
    if (session.status === "complete" && paid) {
      if (session.amount_total !== item.price || session.currency !== item.currency) {
        throw new Error("Checkout amount does not match the shop catalog.");
      }
      if (item.recurring) {
        const subscription = stripeId(session.subscription);
        if (!subscription) throw new Error("Subscription checkout has no subscription.");
        status = (await this.syncSubscription(subscription)) ? "granted" : "revoked";
      } else {
        const payment = stripeId(session.payment_intent);
        const entitled = payment ? await this.paymentEntitles(payment) : session.amount_total === 0;
        status = entitled ? "granted" : "revoked";
      }
    }
    if (record)
      await this.store.update(record._id, {
        sessionId: session.id,
        state: status,
        active: status === "open" || status === "pending" || status === "granted",
      });
    if (!item.recurring) {
      // Mark revoked before checking for other paid attempts. Repeat both grant
      // and revoke on retries so a transient DB failure is always recoverable.
      if (status === "granted") await this.store.grant(playerId, item);
      else if (status === "revoked") await this.store.revoke(playerId, item, session.id);
    }
    if (record && status === "granted") await this.store.update(record._id, { active: false });
    return { status, itemType: item.type, itemId: item.id };
  }

  async status(sessionId: string, playerId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.playerId !== playerId) return null;
    return this.fulfill(session);
  }

  async syncSubscription(id: string): Promise<boolean> {
    const subscription = await this.stripe.subscriptions.retrieve(id);
    const meta = purchaseMetadata(subscription);
    if (!meta || !meta.item.recurring) return false;
    const { playerId, item } = meta;
    const billingActive = ["active", "trialing", "past_due"].includes(subscription.status);
    let entitled = billingActive;
    const latestInvoice = stripeId(subscription.latest_invoice);
    if (entitled && latestInvoice) {
      const invoice = await this.stripe.invoices.retrieve(latestInvoice);
      // A failed renewal may keep its grace period, but a fully refunded or
      // disputed current paid invoice no longer buys that period.
      if (invoice.status === "paid" && invoice.amount_paid > 0) {
        const payments = await this.stripe.invoicePayments.list({
          invoice: latestInvoice,
          status: "paid",
          limit: 100,
        });
        const ids = payments.data
          .map((p: StripeObject) => stripeId(p.payment?.payment_intent))
          .filter(Boolean);
        const legacy = stripeId(invoice.payment_intent);
        if (!ids.length && legacy) ids.push(legacy);
        if (!ids.length) throw new Error("Paid subscription invoice has no verifiable payment.");
        const coverage = await Promise.all(
          ids.map((payment: string) => this.paymentEntitles(payment)),
        );
        entitled = coverage.some(Boolean);
      }
    }
    if (billingActive) {
      await this.store.putSubscription(playerId, {
        subscriptionId: id,
        badgeId: item.id,
        provider: "stripe",
        accessSuspended: !entitled,
        status: subscription.cancel_at_period_end
          ? "canceled"
          : subscription.status === "past_due"
            ? "past_due"
            : "active",
        currentPeriodEnd: subscriptionPeriodEnd(subscription),
      });
    } else {
      await this.store.removeSubscription(playerId, id);
    }
    if (entitled) await this.store.grant(playerId, item);
    else await this.store.revoke(playerId, item, id);
    return entitled;
  }

  private async paymentChanged(paymentId: string) {
    const sessions = await this.stripe.checkout.sessions.list({
      payment_intent: paymentId,
      limit: 100,
    });
    for (const session of sessions.data) {
      if (purchaseMetadata(session))
        await this.fulfill(await this.stripe.checkout.sessions.retrieve(session.id));
    }
    // Renewal payments are not linked to Checkout. InvoicePayments supports
    // both the current invoice shape and subscriptions created before this ledger.
    const payments = await this.stripe.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: paymentId },
      limit: 100,
      expand: ["data.invoice"],
    });
    for (const payment of payments.data) {
      const invoice =
        typeof payment.invoice === "string"
          ? await this.stripe.invoices.retrieve(payment.invoice)
          : payment.invoice;
      const id = invoiceSubscriptionId(invoice);
      if (id) await this.syncSubscription(id);
    }
  }

  async webhook(type: string, object: StripeObject) {
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
      ].includes(type)
    ) {
      // Ignore unrelated checkouts sharing this Stripe account.
      if (!purchaseMetadata(object)) return;
      const session = await this.stripe.checkout.sessions.retrieve(object.id);
      const result = await this.fulfill(session);
      if (type === "checkout.session.async_payment_failed" && result.status === "pending") {
        const record = await this.store.findSession(session.id);
        if (record) await this.store.update(record._id, { state: "failed", active: false });
      }
    } else if (type.startsWith("customer.subscription.")) {
      if (purchaseMetadata(object)) await this.syncSubscription(object.id);
    } else if (["invoice.paid", "invoice.payment_failed"].includes(type)) {
      const id = invoiceSubscriptionId(object);
      if (id) await this.syncSubscription(id);
    } else if (
      [
        "charge.refunded",
        "charge.dispute.created",
        "charge.dispute.updated",
        "charge.dispute.closed",
      ].includes(type)
    ) {
      const id = stripeId(object.payment_intent);
      if (id) await this.paymentChanged(id);
    }
  }
}

export { otherSubscriptionEntitles };
