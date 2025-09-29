import { Router } from "express";

const router = Router();

/**
 * Lightweight, DB-independent demo session.
 * Returns a stable user object so the frontend can boot.
 * Replace later with real auth if needed.
 */
router.get("/session", (_req, res) => {
  const userId = "00000000-0000-0000-0000-000000000000";
  return res.status(200).json({
    ok: true,
    user: {
      id: userId,
      userId, // for UIs expecting 'userId'
      username: "demo",
      roles: ["admin"],
    },
    ts: new Date().toISOString(),
  });
});

/** Optional stubs to appease callers; no-ops but deterministic. */
router.post("/session/login", (_req, res) => {
  return res
    .status(200)
    .json({ ok: true, message: "logged-in (demo)", ts: new Date().toISOString() });
});

router.post("/session/logout", (_req, res) => {
  return res
    .status(200)
    .json({ ok: true, message: "logged-out (demo)", ts: new Date().toISOString() });
});

export default router;
