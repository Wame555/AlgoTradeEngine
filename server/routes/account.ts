import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";

const router = Router();

router.get("/account/state", async (_req, res) => {
  try {
    const r = await db.execute(sql`SELECT total_balance, equity, updated_at FROM public."system_state" WHERE id=1;`);
    const row = (r as any)?.rows?.[0] ?? {};
    const total = Number(row.total_balance ?? 0);
    const eq = Number(row.equity ?? total);
    return res.json({ ok: true, totalBalance: total, equity: eq, updatedAt: row.updated_at ?? new Date().toISOString() });
  } catch (e: any) {
    console.error("[account/state:get]", e?.message || e);
    return res.status(500).json({ ok: false, message: "read error" });
  }
});

router.post("/account/state", async (req, res) => {
  try {
    const raw = String(req.body?.totalBalance ?? "").trim().replace(/\u00A0/g, " ").replace(/\s+/g, "").replace(",", ".");
    const total = Number(raw);
    if (!Number.isFinite(total) || total < 0) return res.status(400).json({ ok: false, message: "invalid totalBalance" });

    const equityRaw = req.body?.equity;
    const eq = Number.isFinite(Number(equityRaw)) ? Number(equityRaw) : total;

    await db.execute(sql`
      INSERT INTO public."system_state"(id,total_balance,equity,updated_at)
      VALUES (1, ${total}, ${eq}, now())
      ON CONFLICT ON CONSTRAINT system_state_pkey
      DO UPDATE SET total_balance=EXCLUDED.total_balance,
                    equity=EXCLUDED.equity,
                    updated_at=EXCLUDED.updated_at;
    `);

    return res.json({ ok: true, totalBalance: total, equity: eq, updatedAt: new Date().toISOString() });
  } catch (e: any) {
    console.error("[account/state:post]", e?.message || e);
    return res.status(500).json({ ok: false, message: "write error" });
  }
});

export default router;
