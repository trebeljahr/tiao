import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.development" });

function getRequiredEnv(
  name: string,
  options: {
    testDefault?: string;
    aliases?: string[];
  } = {},
): string {
  const value =
    process.env[name] ||
    options.aliases?.map((alias) => process.env[alias]).find(Boolean) ||
    (process.env.NODE_ENV === "test" ? options.testDefault : undefined);

  if (!value) {
    console.error(`${name} not provided in the environment`);
    process.exit(1);
  }

  return value;
}

const TOKEN_SECRET = getRequiredEnv("TOKEN_SECRET", {
  testDefault: "test-token-secret",
});
const MONGODB_URI = getRequiredEnv("MONGODB_URI", {
  testDefault: "mongodb://127.0.0.1:27017/tiao-test",
});
const PORT = (process.env.PORT || "5005") as string;
const BUCKET_NAME = getRequiredEnv("S3_BUCKET_NAME", {
  testDefault: "tiao-test-assets",
});
const CLOUDFRONT_URL = getRequiredEnv("S3_PUBLIC_URL", {
  aliases: ["CLOUDFRONT_URL"],
  testDefault: "https://assets.test.local",
});
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE === "true";

const CORRECT_PATH = process.cwd();

const FRONTEND_URL = process.env.FRONTEND_URL;
const GLITCHTIP_DSN = process.env.GLITCHTIP_DSN;
if (!FRONTEND_URL && process.env.NODE_ENV === "production") {
  console.error(
    "FRONTEND_URL is required in production — CORS and WebSocket origin checks are disabled without it.",
  );
  process.exit(1);
}
const REDIS_URL = process.env.REDIS_URL;

// --- OpenPanel analytics ----------------------------------------------------
// CLIENT_ID and CLIENT_SECRET together authenticate the Node SDK. The
// secret never ships to the browser — it must stay server-side. API_URL
// points at a self-hosted OpenPanel (see server/.env.example); if any of
// the three is missing the server-side SDK boots fully disabled and all
// track() calls become no-ops.
const OPENPANEL_CLIENT_ID = process.env.OPENPANEL_CLIENT_ID;
const OPENPANEL_CLIENT_SECRET = process.env.OPENPANEL_CLIENT_SECRET;
const OPENPANEL_API_URL = process.env.OPENPANEL_API_URL;

// Read-mode credentials for the Export API (GDPR data export). Separate
// from the write credentials above because OpenPanel scopes access by
// client mode. When missing the data export still works — it just won't
// include the analytics_events section.
const OPENPANEL_READ_CLIENT_ID = process.env.OPENPANEL_READ_CLIENT_ID;
const OPENPANEL_READ_CLIENT_SECRET = process.env.OPENPANEL_READ_CLIENT_SECRET;

// --- Discord webhooks -------------------------------------------------------
// Each announcement feature has its own webhook URL. Unset means the feature
// is a silent no-op (see server/discord/webhooks.ts).
const DISCORD_WEBHOOK_GAME_RESULTS = process.env.DISCORD_WEBHOOK_GAME_RESULTS;

export {
  BUCKET_NAME,
  CLOUDFRONT_URL,
  CORRECT_PATH,
  DISCORD_WEBHOOK_GAME_RESULTS,
  FRONTEND_URL,
  GLITCHTIP_DSN,
  MONGODB_URI,
  OPENPANEL_API_URL,
  OPENPANEL_CLIENT_ID,
  OPENPANEL_CLIENT_SECRET,
  OPENPANEL_READ_CLIENT_ID,
  OPENPANEL_READ_CLIENT_SECRET,
  PORT,
  REDIS_URL,
  S3_ENDPOINT,
  S3_FORCE_PATH_STYLE,
  TOKEN_SECRET,
};
