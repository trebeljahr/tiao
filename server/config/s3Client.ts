import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();

console.debug("Running Node.js version:", process.version);

console.debug("AWS_REGION", process.env.AWS_REGION);
console.debug("AWS_ACCESS_KEY_ID", process.env.AWS_ACCESS_KEY_ID);
console.debug("AWS_SECRET_ACCESS_KEY", process.env.AWS_SECRET_ACCESS_KEY);

export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});
