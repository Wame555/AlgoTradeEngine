export const SYMBOL_LIST = (process.env.SYMBOL_LIST ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
export const FUTURES = process.env.FUTURES === "true";
export const RUN_MIGRATIONS_ON_START = process.env.RUN_MIGRATIONS_ON_START === "true";
