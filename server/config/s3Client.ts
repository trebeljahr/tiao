import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { S3_ENDPOINT, S3_FORCE_PATH_STYLE } from "./envVars";

dotenv.config();

const endpoint = S3_ENDPOINT?.trim();

export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  endpoint: endpoint || undefined,
  forcePathStyle: S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});
