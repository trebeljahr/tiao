import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Minimal Google Play Developer API (androidpublisher v3) client.
 *
 * Only the four calls the shop needs, over plain fetch, so the server does
 * not pull in the multi-megabyte `googleapis` package. Auth is the standard
 * service-account flow: sign a JWT with the account's private key, swap it
 * for an OAuth access token, cache the token until shortly before expiry.
 *
 * `fetchImpl` and `now` are injectable so tests can stand in for Google.
 */

export const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

export type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

/** purchases.products.get — https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products */
export type ProductPurchase = {
  orderId?: string;
  /** 0 purchased, 1 canceled, 2 pending. */
  purchaseState?: number;
  /** 0 yet to be acknowledged, 1 acknowledged. */
  acknowledgementState?: number;
  /** 0 yet to be consumed, 1 consumed. */
  consumptionState?: number;
  /** 0 test (license tester), 1 promo, 2 rewarded. Absent for a normal purchase. */
  purchaseType?: number;
  purchaseTimeMillis?: string;
  obfuscatedExternalAccountId?: string;
  productId?: string;
  regionCode?: string;
};

export type SubscriptionState =
  | "SUBSCRIPTION_STATE_UNSPECIFIED"
  | "SUBSCRIPTION_STATE_PENDING"
  | "SUBSCRIPTION_STATE_ACTIVE"
  | "SUBSCRIPTION_STATE_PAUSED"
  | "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  | "SUBSCRIPTION_STATE_ON_HOLD"
  | "SUBSCRIPTION_STATE_CANCELED"
  | "SUBSCRIPTION_STATE_EXPIRED"
  | "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED";

/** purchases.subscriptionsv2.get — https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2 */
export type SubscriptionPurchaseV2 = {
  subscriptionState?: SubscriptionState;
  acknowledgementState?:
    | "ACKNOWLEDGEMENT_STATE_UNSPECIFIED"
    | "ACKNOWLEDGEMENT_STATE_PENDING"
    | "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
  latestOrderId?: string;
  linkedPurchaseToken?: string;
  startTime?: string;
  regionCode?: string;
  testPurchase?: Record<string, never>;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    latestSuccessfulOrderId?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    offerDetails?: { basePlanId?: string; offerId?: string };
  }>;
};

export class GooglePlayApiError extends Error {
  readonly status: number;
  readonly reason?: string;
  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = "GooglePlayApiError";
    this.status = status;
    this.reason = reason;
  }

  /**
   * The token is unknown to Google or has aged out (410 after 60 days past
   * expiry). Retrying will never help.
   */
  get isPermanent(): boolean {
    return this.status === 400 || this.status === 404 || this.status === 410;
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type GooglePlayApiOptions = {
  packageName: string;
  serviceAccount: ServiceAccountKey;
  fetchImpl?: FetchLike;
  now?: () => number;
};

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export class GooglePlayApi {
  readonly packageName: string;
  private readonly serviceAccount: ServiceAccountKey;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(options: GooglePlayApiOptions) {
    this.packageName = options.packageName;
    this.serviceAccount = options.serviceAccount;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
  }

  private signAssertion(): string {
    const tokenUri = this.serviceAccount.token_uri || DEFAULT_TOKEN_URI;
    const iat = Math.floor(this.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
      JSON.stringify({
        iss: this.serviceAccount.client_email,
        scope: ANDROID_PUBLISHER_SCOPE,
        aud: tokenUri,
        iat,
        exp: iat + 3600,
      }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    const signature = signer.sign(this.serviceAccount.private_key).toString("base64url");
    return `${header}.${claims}.${signature}`;
  }

  private async accessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > this.now()) {
      return this.cachedToken.value;
    }
    const tokenUri = this.serviceAccount.token_uri || DEFAULT_TOKEN_URI;
    const res = await this.fetchImpl(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: this.signAssertion(),
      }).toString(),
    });
    if (!res.ok) {
      throw new GooglePlayApiError(
        res.status >= 500 ? res.status : 503,
        `Google OAuth token exchange failed (${res.status})`,
      );
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new GooglePlayApiError(503, "Google OAuth response had no access_token");
    }
    const ttlMs = (body.expires_in ?? 3600) * 1000;
    // Refresh a minute early so a token never expires mid-request.
    this.cachedToken = { value: body.access_token, expiresAt: this.now() + ttlMs - 60_000 };
    return body.access_token;
  }

  private async call<T>(method: "GET" | "POST", path: string): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${API_BASE}/applications/${this.packageName}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    if (res.status === 401) {
      // Revoked or rotated key: drop the cached token so the next call re-auths.
      this.cachedToken = null;
    }
    if (!res.ok) {
      let reason: string | undefined;
      let message = `Google Play API ${method} ${path.split("/tokens/")[0]} failed (${res.status})`;
      try {
        const body = (await res.json()) as {
          error?: { message?: string; errors?: Array<{ reason?: string }> };
        };
        reason = body.error?.errors?.[0]?.reason;
        if (body.error?.message) message = `${message}: ${body.error.message}`;
      } catch {
        // Non-JSON error body — keep the status-only message.
      }
      throw new GooglePlayApiError(res.status, message, reason);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  getProductPurchase(productId: string, purchaseToken: string): Promise<ProductPurchase> {
    return this.call(
      "GET",
      `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`,
    );
  }

  async acknowledgeProduct(productId: string, purchaseToken: string): Promise<void> {
    await this.call(
      "POST",
      `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    );
  }

  getSubscription(purchaseToken: string): Promise<SubscriptionPurchaseV2> {
    return this.call(
      "GET",
      `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    );
  }

  async acknowledgeSubscription(subscriptionId: string, purchaseToken: string): Promise<void> {
    await this.call(
      "POST",
      `/purchases/subscriptions/${encodeURIComponent(subscriptionId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    );
  }
}

/**
 * Service account key from the environment. Accepts, in order:
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON — the key file contents, raw or base64
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_FILE — a path to the key file
 * Returns null when neither is set or the key is unusable.
 */
export function loadServiceAccountFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ServiceAccountKey | null {
  let raw = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw && env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE) {
    try {
      raw = readFileSync(env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE, "utf8").trim();
    } catch (err) {
      console.error("[google-play] Cannot read GOOGLE_PLAY_SERVICE_ACCOUNT_FILE:", err);
      return null;
    }
  }
  if (!raw) return null;
  if (!raw.startsWith("{")) {
    raw = Buffer.from(raw, "base64").toString("utf8");
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      console.error("[google-play] Service account key is missing client_email or private_key");
      return null;
    }
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      token_uri: parsed.token_uri,
    };
  } catch {
    console.error("[google-play] Service account key is not valid JSON");
    return null;
  }
}

export const DEFAULT_ANDROID_PACKAGE_NAME = "com.ricoslabs.tiao";

let singleton: GooglePlayApi | null | undefined;

/** The configured client, or null when Play billing is not set up on this server. */
export function getGooglePlayApi(): GooglePlayApi | null {
  if (singleton !== undefined) return singleton;
  const serviceAccount = loadServiceAccountFromEnv();
  singleton = serviceAccount
    ? new GooglePlayApi({
        packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME || DEFAULT_ANDROID_PACKAGE_NAME,
        serviceAccount,
      })
    : null;
  return singleton;
}

/** Tests swap in a client backed by a fake fetch; null clears the override. */
export function setGooglePlayApiForTesting(api: GooglePlayApi | null | undefined): void {
  singleton = api;
}
