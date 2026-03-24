import mongoose from "mongoose";
import { MONGODB_URI } from "../config/envVars";

let connectionAttempt: Promise<void> | null = null;

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function connectToDB(): Promise<void> {
  if (isDatabaseReady()) {
    return;
  }

  if (!connectionAttempt) {
    connectionAttempt = mongoose
      .connect(MONGODB_URI)
      .then((connection) => {
        const dbName = connection.connections[0]?.name;
        console.debug(`Connected to Mongo! Database name: "${dbName}"`);
      })
      .catch((error) => {
        console.error("Error connecting to mongo:", error);
        throw error;
      })
      .finally(() => {
        connectionAttempt = null;
      });
  }

  await connectionAttempt;
}

export async function disconnectFromDB(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
}
