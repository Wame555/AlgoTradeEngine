import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
}

const rawConfig = {
    schema: "./shared/schema.ts",
    out: "./drizzle",
    driver: "pg" as const,
    dialect: "postgresql" as const,
    dbCredentials: {
        url: process.env.DATABASE_URL,
    },
};

const config = new Proxy(rawConfig, {
    get(target, prop) {
        if (prop === "driver") {
            return undefined;
        }
        return Reflect.get(target, prop);
    },
    has(target, prop) {
        if (prop === "driver") {
            return false;
        }
        return Reflect.has(target, prop);
    },
    ownKeys(target) {
        return Reflect.ownKeys(target).filter((key) => key !== "driver");
    },
    getOwnPropertyDescriptor(target, prop) {
        if (prop === "driver") {
            return undefined;
        }
        return Object.getOwnPropertyDescriptor(target, prop as keyof typeof target);
    },
});

export default defineConfig(config as unknown as Parameters<typeof defineConfig>[0]);
