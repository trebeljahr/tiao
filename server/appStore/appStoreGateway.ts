import { X509Certificate } from "node:crypto";
import {
  APIException,
  AppStoreServerAPIClient,
  Environment,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
  SignedDataVerifier,
} from "@apple/app-store-server-library";
import { APP_STORE_BUNDLE_ID } from "../config/shopCatalog";
import { APPLE_ROOT_CA_G3_PEM } from "./appleRootCertificates";

/**
 * Everything the App Store purchase flow needs from Apple, behind one
 * interface so tests can swap in a gateway that trusts a test root CA.
 *
 *   - verify*: check a JWS against Apple's certificate chain and decode it.
 *     Each payload carries its own environment (Production / Sandbox); the
 *     matching verifier also rejects a payload whose bundle id, app id or
 *     environment does not match this app.
 *   - fetchSignedTransaction: ask the App Store Server API for a
 *     transaction by id. The Mac App Store build uses this: Electron's
 *     inAppPurchase module is StoreKit 1 and only hands the renderer a
 *     transaction id, never a signed JWS.
 *   - setAppAccountToken: tag a StoreKit 1 purchase with the account
 *     token after the fact, so later server notifications find the account.
 */
export interface AppStoreGateway {
  verifyTransaction(signedTransaction: string): Promise<JWSTransactionDecodedPayload>;
  verifyRenewalInfo(signedRenewalInfo: string): Promise<JWSRenewalInfoDecodedPayload>;
  verifyNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload>;
  /** Null when the Server API key is not configured. */
  fetchSignedTransaction: ((transactionId: string) => Promise<string>) | null;
  setAppAccountToken:
    | ((originalTransactionId: string, environment: string, token: string) => Promise<void>)
    | null;
}

export class AppStoreGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type AppStoreServerApiConfig = {
  keyId: string;
  issuerId: string;
  /** Contents of the .p8 key from App Store Connect. */
  privateKey: string;
};

export type AppStoreGatewayOptions = {
  bundleId: string;
  /** Apple's numeric app id; required to accept Production payloads. */
  appAppleId?: number;
  /** Environments this server accepts payloads from. */
  environments: Environment[];
  rootCertificates: Buffer[];
  /** OCSP revocation checks against Apple. On in production. */
  enableOnlineChecks: boolean;
  serverApi?: AppStoreServerApiConfig;
  /** Test seam for the App Store Server API client. */
  createApiClient?: (
    environment: Environment,
  ) => Pick<AppStoreServerAPIClient, "getTransactionInfo" | "setAppAccountToken">;
};

/** Decode a JWS payload without verifying it, to pick a verifier. */
function peekPayload(jws: string): Record<string, unknown> {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw new AppStoreGatewayError(400, "INVALID_SIGNED_DATA", "Malformed signed data.");
  }
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new AppStoreGatewayError(400, "INVALID_SIGNED_DATA", "Malformed signed data.");
  }
}

function asEnvironment(value: unknown): Environment | null {
  return Object.values(Environment).includes(value as Environment) ? (value as Environment) : null;
}

export function createAppStoreGateway(options: AppStoreGatewayOptions): AppStoreGateway {
  const verifiers = new Map<Environment, SignedDataVerifier>();
  for (const environment of options.environments) {
    if (environment === Environment.PRODUCTION && options.appAppleId === undefined) continue;
    verifiers.set(
      environment,
      new SignedDataVerifier(
        options.rootCertificates,
        options.enableOnlineChecks,
        environment,
        options.bundleId,
        options.appAppleId,
      ),
    );
  }
  if (verifiers.size === 0) {
    throw new Error("App Store gateway needs at least one usable environment.");
  }

  function verifierFor(environment: unknown): SignedDataVerifier {
    const env = asEnvironment(environment);
    const verifier = env ? verifiers.get(env) : undefined;
    if (!verifier) {
      throw new AppStoreGatewayError(
        400,
        "ENVIRONMENT_NOT_ACCEPTED",
        `App Store environment ${String(environment)} is not accepted by this server.`,
      );
    }
    return verifier;
  }

  async function verify<T>(jws: string, run: (verifier: SignedDataVerifier) => Promise<T>) {
    const payload = peekPayload(jws);
    const data = payload.data as { environment?: unknown } | undefined;
    const summary = payload.summary as { environment?: unknown } | undefined;
    const environment = payload.environment ?? data?.environment ?? summary?.environment;
    const verifier = verifierFor(environment);
    try {
      return await run(verifier);
    } catch (error) {
      if (error instanceof AppStoreGatewayError) throw error;
      throw new AppStoreGatewayError(
        400,
        "INVALID_SIGNED_DATA",
        `App Store signed data failed verification (${(error as { status?: unknown }).status ?? "unknown"}).`,
      );
    }
  }

  const apiClients = new Map<
    Environment,
    Pick<AppStoreServerAPIClient, "getTransactionInfo" | "setAppAccountToken">
  >();
  const serverApi = options.serverApi;
  const createApiClient =
    options.createApiClient ??
    (serverApi
      ? (environment: Environment) =>
          new AppStoreServerAPIClient(
            serverApi.privateKey,
            serverApi.keyId,
            serverApi.issuerId,
            options.bundleId,
            environment,
          )
      : null);
  function apiClient(environment: Environment) {
    if (!createApiClient) throw new Error("App Store Server API is not configured.");
    let client = apiClients.get(environment);
    if (!client) {
      client = createApiClient(environment);
      apiClients.set(environment, client);
    }
    return client;
  }

  const apiEnvironments = [...verifiers.keys()];

  return {
    verifyTransaction: (jws) => verify(jws, (v) => v.verifyAndDecodeTransaction(jws)),
    verifyRenewalInfo: (jws) => verify(jws, (v) => v.verifyAndDecodeRenewalInfo(jws)),
    verifyNotification: (jws) => verify(jws, (v) => v.verifyAndDecodeNotification(jws)),

    fetchSignedTransaction: createApiClient
      ? async (transactionId) => {
          // Sandbox purchases (TestFlight, App Review) only exist in the
          // sandbox API, so fall through on "not found".
          for (const environment of apiEnvironments) {
            try {
              const res = await apiClient(environment).getTransactionInfo(transactionId);
              if (res.signedTransactionInfo) return res.signedTransactionInfo;
            } catch (error) {
              if (error instanceof APIException && error.httpStatusCode === 404) continue;
              if (error instanceof APIException && error.httpStatusCode === 400) {
                throw new AppStoreGatewayError(
                  400,
                  "INVALID_TRANSACTION_ID",
                  "That App Store transaction id is not valid.",
                );
              }
              throw error;
            }
          }
          throw new AppStoreGatewayError(
            404,
            "TRANSACTION_NOT_FOUND",
            "The App Store has no record of that transaction.",
          );
        }
      : null,

    setAppAccountToken: createApiClient
      ? async (originalTransactionId, environment, token) => {
          const env = asEnvironment(environment);
          if (!env || env === Environment.XCODE || env === Environment.LOCAL_TESTING) return;
          await apiClient(env).setAppAccountToken(originalTransactionId, {
            appAccountToken: token,
          });
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Environment-driven singleton
// ---------------------------------------------------------------------------

function readServerApiConfig(): AppStoreServerApiConfig | undefined {
  const keyId = process.env.APPLE_IAP_KEY_ID;
  const issuerId = process.env.APPLE_IAP_ISSUER_ID;
  const privateKey = process.env.APPLE_IAP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!keyId || !issuerId || !privateKey) return undefined;
  return { keyId, issuerId, privateKey };
}

function readEnvironments(): Environment[] {
  const raw = process.env.APPLE_IAP_ENVIRONMENTS ?? "Production,Sandbox";
  return raw
    .split(",")
    .map((s) => asEnvironment(s.trim()))
    .filter((env): env is Environment => env !== null);
}

/**
 * Builds the gateway from APPLE_IAP_* env vars, or returns null when App
 * Store purchases are not configured on this server.
 *
 * Production requires APPLE_IAP_APP_APPLE_ID: without it the server
 * could only verify sandbox purchases, which would let App Review pass
 * while every real purchase failed. Outside production, sandbox alone is
 * enough for local and TestFlight testing.
 */
function gatewayFromEnv(): AppStoreGateway | null {
  if (process.env.APPLE_IAP_ENABLED === "false") return null;
  const rawAppId = process.env.APPLE_IAP_APP_APPLE_ID;
  const appAppleId = rawAppId ? Number(rawAppId) : undefined;
  if (appAppleId !== undefined && !Number.isInteger(appAppleId)) {
    console.error("[appStore] APPLE_IAP_APP_APPLE_ID is not an integer; App Store purchases off.");
    return null;
  }
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && appAppleId === undefined) return null;
  if (!isProduction && process.env.APPLE_IAP_ENABLED !== "true") return null;

  try {
    return createAppStoreGateway({
      bundleId: process.env.APPLE_IAP_BUNDLE_ID || APP_STORE_BUNDLE_ID,
      appAppleId,
      environments: readEnvironments(),
      rootCertificates: [new X509Certificate(APPLE_ROOT_CA_G3_PEM).raw],
      enableOnlineChecks: isProduction && process.env.APPLE_IAP_ONLINE_CHECKS !== "false",
      serverApi: readServerApiConfig(),
    });
  } catch (error) {
    console.error("[appStore] Could not configure App Store verification:", error);
    return null;
  }
}

let cached: AppStoreGateway | null | undefined;

export function getAppStoreGateway(): AppStoreGateway | null {
  if (cached === undefined) cached = gatewayFromEnv();
  return cached;
}

/** Test-only: replace (or with undefined, reset) the gateway singleton. */
export function setAppStoreGatewayForTests(gateway: AppStoreGateway | null | undefined): void {
  cached = gateway;
}
