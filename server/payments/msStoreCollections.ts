import type { FetchLike } from "./steamMicroTxn";

/**
 * Microsoft Store collection API client: who owns which add-on.
 *
 * Two Entra ID (Azure AD) client-credential tokens, both minted here and
 * cached until shortly before expiry:
 *
 *   - audience `https://onestore.microsoft.com` — our own Authorization
 *     header for collections.mp.microsoft.com. Must never leave the
 *     server (Microsoft warns it enables replay attacks).
 *   - audience `https://onestore.microsoft.com/b2b/keys/create/collections`
 *     — the "service ticket" the AppX passes to
 *     StoreContext.GetCustomerCollectionsIdAsync. Safe to hand to the
 *     client; it can only mint Store ID keys for our client id.
 *
 * The client returns a Microsoft Store ID key (a JWT, valid 30 days)
 * representing the Store user signed in on that PC; we pass it as the
 * `b2b` beneficiary and get back their add-on collection.
 *
 * Docs: https://learn.microsoft.com/windows/uwp/monetize/view-and-grant-products-from-a-service
 *       https://learn.microsoft.com/windows/uwp/monetize/query-for-products
 */

export const MS_COLLECTIONS_AUDIENCE = "https://onestore.microsoft.com";
export const MS_COLLECTIONS_KEY_AUDIENCE =
  "https://onestore.microsoft.com/b2b/keys/create/collections";
export const MS_COLLECTIONS_QUERY_URL =
  "https://collections.mp.microsoft.com/v6.0/collections/query";
const STORE_KEY_AUD = "https://collections.mp.microsoft.com/v6.0/keys";

export class MsStoreApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message);
    this.name = "MsStoreApiError";
  }
}

export type MsStoreConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  now?: () => number;
  loginBaseUrl?: string;
  collectionsUrl?: string;
};

/** Subset of CollectionItemContractV6 we act on. */
export type MsCollectionItem = {
  itemId: string;
  productId: string;
  skuId?: string;
  inAppOfferToken?: string;
  productType: string;
  status: string;
  localTicketReference?: string;
  transactionId?: string;
  orderId?: string;
  acquiredDate?: string;
};

type CachedToken = { token: string; expiresAt: number };

/**
 * Decode (not verify) a Store ID key's claims. Microsoft verifies the
 * signature when we spend the key; we read it only to reject an obviously
 * wrong or expired key with a clear error before the network round trip.
 */
export function decodeStoreIdKey(key: string): Record<string, unknown> | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    const claims = JSON.parse(json) as unknown;
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type StoreIdKeyProblem = "malformed" | "wrong_audience" | "expired";

export function checkStoreIdKey(key: string, nowMs: number): StoreIdKeyProblem | null {
  const claims = decodeStoreIdKey(key);
  if (!claims) return "malformed";
  if (claims.aud !== STORE_KEY_AUD) return "wrong_audience";
  if (typeof claims.exp === "number" && claims.exp * 1000 < nowMs) return "expired";
  return null;
}

export class MsStoreCollectionsClient {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly tokens = new Map<string, CachedToken>();

  constructor(private readonly config: MsStoreConfig) {
    this.fetchImpl = config.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.now = config.now ?? Date.now;
  }

  /** Client-credentials token for one audience, cached until 5 min before expiry. */
  async getAccessToken(resource: string): Promise<string> {
    const cached = this.tokens.get(resource);
    if (cached && cached.expiresAt - 5 * 60_000 > this.now()) return cached.token;

    const base = this.config.loginBaseUrl ?? "https://login.microsoftonline.com";
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      resource,
    });
    const res = await this.fetchImpl(
      `${base}/${encodeURIComponent(this.config.tenantId)}/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
    );
    if (!res.ok) {
      // The body names the failing app/tenant but never the secret; log status only.
      throw new MsStoreApiError(`Entra token request failed with HTTP ${res.status}`, res.status);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: string | number };
    if (!body.access_token)
      throw new MsStoreApiError("Entra token response had no access_token", null);
    const ttl = Number(body.expires_in ?? 3600);
    this.tokens.set(resource, {
      token: body.access_token,
      expiresAt: this.now() + (Number.isFinite(ttl) ? ttl : 3600) * 1000,
    });
    return body.access_token;
  }

  /** Service ticket for GetCustomerCollectionsIdAsync on the client. */
  async getCollectionsServiceTicket(): Promise<string> {
    return this.getAccessToken(MS_COLLECTIONS_KEY_AUDIENCE);
  }

  /**
   * Every currently valid Durable the Store user behind `storeIdKey` owns
   * for apps tied to our Entra client id. Pages through continuation
   * tokens; capped so a misbehaving response cannot loop forever.
   */
  async queryOwnedDurables(
    storeIdKey: string,
    localTicketReference: string,
  ): Promise<MsCollectionItem[]> {
    const token = await this.getAccessToken(MS_COLLECTIONS_AUDIENCE);
    const url = this.config.collectionsUrl ?? MS_COLLECTIONS_QUERY_URL;
    const items: MsCollectionItem[] = [];
    let continuationToken: string | undefined;

    for (let page = 0; page < 20; page++) {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          beneficiaries: [{ identityType: "b2b", identityValue: storeIdKey, localTicketReference }],
          productTypes: ["Durable"],
          validityType: "Valid",
          maxPageSize: 100,
          ...(continuationToken ? { continuationToken } : {}),
        }),
      });
      if (res.status === 401) {
        // Token revoked or app un-associated in Partner Center: drop the cache.
        this.tokens.delete(MS_COLLECTIONS_AUDIENCE);
      }
      if (!res.ok) {
        throw new MsStoreApiError(`Collections query failed with HTTP ${res.status}`, res.status);
      }
      const body = (await res.json()) as { items?: MsCollectionItem[]; continuationToken?: string };
      items.push(...(body.items ?? []));
      continuationToken = body.continuationToken || undefined;
      if (!continuationToken) break;
    }
    return items;
  }
}

/** Build from env, or null when Microsoft Store purchases are not configured. */
export function msStoreCollectionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MsStoreCollectionsClient | null {
  const tenantId = env.MSSTORE_TENANT_ID;
  const clientId = env.MSSTORE_CLIENT_ID;
  const clientSecret = env.MSSTORE_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) return null;
  return new MsStoreCollectionsClient({ tenantId, clientId, clientSecret });
}
