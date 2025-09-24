import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
}

export default defineConfig({
    out: "./migrations",
    schema: [
        "./shared/schema.ts",
        "./shared/schemaPaper.ts",   // ide jön a paper táblák
    ],
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL,
    },
});
