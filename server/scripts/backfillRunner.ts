import "dotenv/config";

import { runFuturesBackfill } from "../services/backfill";

(async () => {
  try {
    await runFuturesBackfill();
    console.info("[backfill] Completed");
  } catch (error) {
    console.error("[backfill] Runner failed", error);
    process.exitCode = 1;
  }
})();
