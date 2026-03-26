import { MongoClient, type Db, type Collection, type Document } from "mongodb";

const MONGO_E2E_URI = "mongodb://127.0.0.1:27018";
const DB_NAME = "tiao-e2e";

let client: MongoClient | null = null;

async function getClient(): Promise<MongoClient> {
  if (!client) {
    client = new MongoClient(MONGO_E2E_URI);
    await client.connect();
  }
  return client;
}

export async function getDb(): Promise<Db> {
  const c = await getClient();
  return c.db(DB_NAME);
}

export async function getCollection<T extends Document = Document>(
  name: string
): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(name);
}

export async function cleanDatabase(): Promise<void> {
  const db = await getDb();
  const collections = await db.listCollections().toArray();
  await Promise.all(
    collections.map((col) => db.collection(col.name).deleteMany({}))
  );
}

export async function closeDbConnection(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
