import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const baseConfig = {
  schema: "./shared/schema.ts",
  out: "./drizzle",
  driver: "pg" as const,
  dialect: "postgresql" as const,
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
};

export default defineConfig({
  schema: baseConfig.schema,
  out: baseConfig.out,
  dialect: baseConfig.dialect,
  dbCredentials: baseConfig.dbCredentials,
});
