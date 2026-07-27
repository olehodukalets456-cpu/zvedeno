import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

try {
  loadEnvFile(resolve(currentDirectory, "../../.env"));
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;

  if (code !== "ENOENT") {
    throw error;
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for Drizzle commands");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
  verbose: true
});
