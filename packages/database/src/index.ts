import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as coreSchema from "./schema";
import * as reportingFeatures from "./reporting-features";

const schema = { ...coreSchema, ...reportingFeatures };

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString, max: 5 });
  return { db: drizzle(pool, { schema }), pool };
}

export * from "./schema";
export * from "./reporting-features";
