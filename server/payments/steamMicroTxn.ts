/**
 * Thin client for the Steam partner Web API calls that Steam
 * Microtransactions needs: ISteamUserAuth/AuthenticateUserTicket (who is
 * buying) and ISteamMicroTxn InitTxn / QueryTxn / FinalizeTxn (the order).
 *
 * Every call uses the *publisher* Web API key, which must never leave the
 * server — it can refund, grant, and read every order for the app. The
 * key is a Steamworks group key with Microtransaction permission, not a
 * user key from steamcommunity.com/dev/apikey (those cannot call
 * partner.steam-api.com at all).
 *
 * `fetch` is injected so tests can replay Valve's response shapes without
 * network access.
 *
 * Docs: https://partner.steamgames.com/doc/webapi/ISteamMicroTxn
 *       https://partner.steamgames.com/doc/features/microtransactions/implementation
 */

export const STEAM_PARTNER_API_BASE = "https://partner.steam-api.com";

/**
 * Identity string the desktop passes to `GetAuthTicketForWebApi`. Steam
 * binds the ticket to it, so a ticket minted for another service cannot be
 * replayed against ours. Must match desktop/src/steam.cjs.
 */
export const STEAM_WEB_API_IDENTITY = "tiao-iap";

/** QueryTxn `status` values, per the ISteamMicroTxn docs. */
export type SteamTxnStatus =
  | "Init"
  | "Approved"
  | "Succeeded"
  | "Failed"
  | "Refunded"
  | "PartialRefund"
  | "Chargedback"
  | "RefundedSuspectedFraud"
  | "RefundedFriendlyFraud";

/** FinalizeTxn error code for "Transaction has already been committed". */
export const STEAM_ERR_ALREADY_COMMITTED = 6;

export class SteamApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "SteamApiError";
  }
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type SteamMicroTxnConfig = {
  publisherKey: string;
  appId: number;
  /** Use ISteamMicroTxnSandbox: approvals succeed without charging. */
  sandbox: boolean;
  fetch?: FetchLike;
  baseUrl?: string;
};

export type SteamTicketOwner = {
  steamId: string;
  ownerSteamId: string;
  publisherBanned: boolean;
};

export type SteamInitTxnItem = {
  itemId: number;
  /** Price in cents of `currency`. */
  amount: number;
  description: string;
  category?: string;
};

export type SteamTxn = {
  orderId: string;
  transId: string;
  steamId: string;
  status: SteamTxnStatus;
  currency?: string;
  items: Array<{ itemId: number; qty: number; amount: number; itemStatus?: string }>;
};

type Envelope = {
  response?: {
    result?: string;
    params?: Record<string, unknown>;
    error?: { errorcode?: number; errordesc?: string };
  };
};

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export class SteamMicroTxnClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(private readonly config: SteamMicroTxnConfig) {
    this.fetchImpl = config.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.baseUrl = config.baseUrl ?? STEAM_PARTNER_API_BASE;
  }

  get appId(): number {
    return this.config.appId;
  }

  get sandbox(): boolean {
    return this.config.sandbox;
  }

  private get txnInterface(): string {
    return this.config.sandbox ? "ISteamMicroTxnSandbox" : "ISteamMicroTxn";
  }

  private async call(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number>,
  ): Promise<Envelope> {
    const form = new URLSearchParams();
    form.set("key", this.config.publisherKey);
    for (const [k, v] of Object.entries(params)) form.set(k, String(v));

    const url =
      method === "GET" ? `${this.baseUrl}${path}?${form.toString()}` : `${this.baseUrl}${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers:
        method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      body: method === "POST" ? form.toString() : undefined,
    });

    if (!res.ok) {
      // Valve answers a bad or under-privileged key with 403 and an HTML
      // body; surface the status, never the request (it carries the key).
      throw new SteamApiError(`Steam ${path} returned HTTP ${res.status}`, null, res.status);
    }
    return (await res.json()) as Envelope;
  }

  /**
   * MicroTxn endpoints report failure as `result: "Failure"` with an
   * `error` object, inside an HTTP 200.
   */
  private unwrapTxn(path: string, body: Envelope): Record<string, unknown> {
    const r = body.response;
    if (!r || r.result !== "OK" || !r.params) {
      const code = typeof r?.error?.errorcode === "number" ? r.error.errorcode : null;
      throw new SteamApiError(`Steam ${path} failed: ${r?.error?.errordesc ?? "no result"}`, code);
    }
    return r.params;
  }

  /**
   * Resolve a `GetAuthTicketForWebApi` ticket (hex) to the SteamID that
   * minted it. This is what stops a client from initiating an order
   * against somebody else's SteamID.
   */
  async authenticateUserTicket(ticketHex: string): Promise<SteamTicketOwner> {
    const path = "/ISteamUserAuth/AuthenticateUserTicket/v1/";
    const body = await this.call("GET", path, {
      appid: this.config.appId,
      ticket: ticketHex,
      identity: STEAM_WEB_API_IDENTITY,
    });
    const r = body.response;
    // AuthenticateUserTicket nests `result` inside `params`, unlike MicroTxn.
    const params = r?.params;
    if (!params || params.result !== "OK" || !str(params.steamid)) {
      const code = typeof r?.error?.errorcode === "number" ? r.error.errorcode : null;
      throw new SteamApiError(
        `Steam ticket rejected: ${r?.error?.errordesc ?? "no steamid"}`,
        code,
      );
    }
    return {
      steamId: str(params.steamid),
      ownerSteamId: str(params.ownersteamid) || str(params.steamid),
      publisherBanned: params.publisherbanned === true,
    };
  }

  /**
   * Create the order. On success Steam pushes the approval dialog into
   * the running game's overlay (`usersession=client`) and later fires
   * `MicroTxnAuthorizationResponse_t` on the client.
   */
  async initTxn(input: {
    orderId: string;
    steamId: string;
    language: string;
    currency: string;
    item: SteamInitTxnItem;
  }): Promise<{ orderId: string; transId: string }> {
    const path = `/${this.txnInterface}/InitTxn/v3/`;
    const params: Record<string, string | number> = {
      orderid: input.orderId,
      steamid: input.steamId,
      appid: this.config.appId,
      itemcount: 1,
      language: input.language,
      currency: input.currency,
      usersession: "client",
      "itemid[0]": input.item.itemId,
      "qty[0]": 1,
      "amount[0]": input.item.amount,
      "description[0]": input.item.description,
    };
    if (input.item.category) params["category[0]"] = input.item.category;
    const out = this.unwrapTxn(path, await this.call("POST", path, params));
    return { orderId: str(out.orderid), transId: str(out.transid) };
  }

  async queryTxn(orderId: string): Promise<SteamTxn> {
    const path = `/${this.txnInterface}/QueryTxn/v3/`;
    const out = this.unwrapTxn(
      path,
      await this.call("GET", path, { appid: this.config.appId, orderid: orderId }),
    );
    const rawItems = Array.isArray(out.items) ? (out.items as Record<string, unknown>[]) : [];
    return {
      orderId: str(out.orderid),
      transId: str(out.transid),
      steamId: str(out.steamid),
      status: str(out.status) as SteamTxnStatus,
      currency: str(out.currency) || undefined,
      items: rawItems.map((i) => ({
        itemId: Number(i.itemid),
        qty: Number(i.qty),
        amount: Number(i.amount),
        itemStatus: str(i.itemstatus) || undefined,
      })),
    };
  }

  /** Capture the funds of an Approved order. Throws code 6 if already done. */
  async finalizeTxn(orderId: string): Promise<{ orderId: string; transId: string }> {
    const path = `/${this.txnInterface}/FinalizeTxn/v2/`;
    const out = this.unwrapTxn(
      path,
      await this.call("POST", path, { orderid: orderId, appid: this.config.appId }),
    );
    return { orderId: str(out.orderid), transId: str(out.transid) };
  }
}

/**
 * Build the client from env, or null when Steam purchases are not
 * configured. Production refuses the sandbox interface: a sandbox
 * approval charges nothing, so honoring it there would hand out paid
 * items for free.
 */
export function steamMicroTxnFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SteamMicroTxnClient | null {
  const publisherKey = env.STEAM_PUBLISHER_WEB_API_KEY;
  const appId = Number.parseInt(env.STEAM_APPID ?? "", 10);
  if (!publisherKey || !Number.isInteger(appId) || appId <= 0) return null;
  const sandbox = env.STEAM_MICROTXN_SANDBOX === "true";
  if (sandbox && env.NODE_ENV === "production") return null;
  return new SteamMicroTxnClient({ publisherKey, appId, sandbox });
}
