export const SYMBOL_LIST = process.env.SYMBOL_LIST?.split(",") ?? [];
export const FUTURES = process.env.FUTURES === "true";
export const RUN_MIGRATIONS_ON_START = process.env.RUN_MIGRATIONS_ON_START === "true";
