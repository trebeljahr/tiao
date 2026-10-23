import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";

export const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
export const OPENID_NS = "http://specs.openid.net/auth/2.0";
const SELECT_ID = "http://specs.openid.net/auth/2.0/identifier_select";
const TTL_MS = 10 * 60 * 1000;
export const steamProof = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type SteamFlow = {
  _id: string;
  kind: "state" | "pending";
  steamId?: string;
  targetUserId?: string;
  targetSessionId?: string;
  returnPath: string;
  returnTo?: string;
  expiresAt: Date;
};
function flows() {
  return mongoose.connection.getClient().db().collection<SteamFlow>("steamAuthFlows");
}
let indexes: Promise<unknown> | undefined;
export async function storeSteamFlow(key: string, data: Omit<SteamFlow, "_id" | "expiresAt">) {
  indexes ??= flows()
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    .catch((error) => {
      indexes = undefined;
      throw error;
    });
  await indexes;
  await flows().insertOne({ ...data, _id: hash(key), expiresAt: new Date(Date.now() + TTL_MS) });
}
export async function readSteamFlow(key: string, consume = false) {
  const filter = { _id: hash(key), expiresAt: { $gt: new Date() } };
  return consume ? flows().findOneAndDelete(filter) : flows().findOne(filter);
}
export function steamReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/.test(value)
  )
    return "/en/play";
  const url = new URL(value, "https://tiao.invalid");
  if (url.origin !== "https://tiao.invalid" || url.pathname.startsWith("/api/")) return "/en/play";
  return url.pathname + url.search;
}
export function steamAuthorizationUrl(returnTo: string) {
  const query = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": new URL(returnTo).origin,
    "openid.identity": SELECT_ID,
    "openid.claimed_id": SELECT_ID,
  });
  return `${STEAM_OPENID_ENDPOINT}?${query}`;
}

/** Fixed Steam discovery endpoint, exact return URL, signed fields and one-use nonce. */
export async function verifySteamOpenId(
  params: URLSearchParams,
  returnTo: string,
  now = Date.now(),
): Promise<string> {
  const fail = () => {
    throw new Error("Invalid Steam OpenID response");
  };
  for (const [key] of params) if (params.getAll(key).length !== 1) fail();
  if (
    params.get("openid.ns") !== OPENID_NS ||
    params.get("openid.mode") !== "id_res" ||
    params.get("openid.op_endpoint") !== STEAM_OPENID_ENDPOINT ||
    params.get("openid.return_to") !== returnTo
  )
    fail();
  const claimed = params.get("openid.claimed_id") || "";
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimed);
  if (!match || params.get("openid.identity") !== claimed) fail();
  const signed = new Set((params.get("openid.signed") || "").split(","));
  for (const field of [
    "op_endpoint",
    "claimed_id",
    "identity",
    "return_to",
    "response_nonce",
    "assoc_handle",
  ])
    if (!signed.has(field) || !params.get(`openid.${field}`)) fail();
  if (!params.get("openid.sig")) fail();
  const nonce = params.get("openid.response_nonce") || "";
  const timestamp = Date.parse(nonce.slice(0, 20));
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z.+$/.test(nonce) ||
    !Number.isFinite(timestamp) ||
    timestamp < now - 5 * 60_000 ||
    timestamp > now + 60_000 ||
    nonce.length > 256 ||
    nonce.length <= 20
  )
    fail();
  const assertion = new URLSearchParams();
  for (const [key, value] of params) if (key.startsWith("openid.")) assertion.set(key, value);
  assertion.set("openid.mode", "check_authentication");
  const response = await fetch(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: assertion.toString(),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !(await response.text()).split(/\r?\n/).includes("is_valid:true")) fail();
  // A global nonce reservation prevents replay against a fresh browser state.
  await storeSteamFlow(`nonce:${nonce}`, { kind: "state", returnPath: "/" });
  return match![1];
}
