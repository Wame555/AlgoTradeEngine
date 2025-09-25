import type { Client, Pool } from "pg";

import { ensureUserSettingsGuard } from "../scripts/dbGuard";

const DISABLE_AUTOHEAL = (process.env.AUTOHEAL_DISABLE ?? "").toLowerCase() === "true";

export async function ensureSchema(db: Pool | Client): Promise<void> {
  if (DISABLE_AUTOHEAL) {
    console.info("[ensureSchema] AUTOHEAL_DISABLE=true -> skipping database guard");
    return;
  }

  console.info("[ensureSchema] running database guard to self-heal schema anomalies");

  try {
    await ensureUserSettingsGuard(db);
    console.info("[ensureSchema] database guard completed");
  } catch (error) {
    console.error("[ensureSchema] guard execution failed", error);
    throw error;
  }
}
