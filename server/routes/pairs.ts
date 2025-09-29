import { Router } from "express";
import { DEFAULT_PAIRS } from "../config/defaultPairs";

const router = Router();

// Simple list for UI bootstrap
router.get("/pairs", (_req, res) => {
  res.json({ ok: true, symbols: DEFAULT_PAIRS, count: DEFAULT_PAIRS.length, ts: new Date().toISOString() });
});

export default router;
