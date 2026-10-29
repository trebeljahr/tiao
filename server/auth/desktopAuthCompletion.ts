import { createHash } from "node:crypto";
import mongoose from "mongoose";

type Completion = {
  _id: string;
  challenge: string;
  code?: string;
  reason?: string;
  expiresAt: Date;
};
function completions() {
  return mongoose.connection.getClient().db().collection<Completion>("desktopAuthCompletions");
}

/** Only a PKCE-bound flow can finish without the browser opening the app. */
export async function storeDesktopCompletion(state: string, code: string, challenge?: string) {
  if (!challenge) return;
  await completions().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await completions().updateOne(
    { _id: state },
    { $set: { challenge, code, expiresAt: new Date(Date.now() + 300_000) } },
    { upsert: true },
  );
}

export async function storeDesktopFailure(state: string, reason: string, challenge?: string) {
  if (!challenge) return;
  await completions().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await completions().updateOne(
    { _id: state },
    { $set: { challenge, reason, expiresAt: new Date(Date.now() + 300_000) }, $unset: { code: 1 } },
    { upsert: true },
  );
}

export async function consumeDesktopCompletion(state: string, verifier: string) {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return completions().findOneAndDelete({ _id: state, challenge, expiresAt: { $gt: new Date() } });
}
