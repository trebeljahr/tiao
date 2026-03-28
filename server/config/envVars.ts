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
const REDIS_URL = process.env.REDIS_URL;

export {
  TOKEN_SECRET,
  MONGODB_URI,
  PORT,
  FRONTEND_URL,
  CORRECT_PATH,
  BUCKET_NAME,
  CLOUDFRONT_URL,
  S3_ENDPOINT,
  S3_FORCE_PATH_STYLE,
  REDIS_URL,
};
