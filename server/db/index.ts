import mongoose from "mongoose";
import { MONGODB_URI } from "../config/envVars";

export async function connectToDB(): Promise<void> {
  try {
    const x = await mongoose.connect(MONGODB_URI);
    const dbName = x.connections[0].name;
    console.debug(`Connected to Mongo! Database name: "${dbName}"`);
  } catch (err) {
    console.error("Error connecting to mongo: ", err);
  }
}
