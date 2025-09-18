import express from "express";
import {
  joinPlayer, submitAction, listPending, verifyAction, getScoreboard
} from "../../api/v1/ep/contest.js";
import { getPlayers, getPlayerById, createPlayer } from "../../api/v1/ep/contest.js";
import user from './user.js'
const router = express.Router();

// Middleware: require authenticated user
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// Middleware: require contest manager
function requireMgr(req, res, next) {
  if (req.user?.contest === "mgr") return next();
  return res.status(403).json({ error: "Forbidden" });
}

// View scoreboard (open)
router.get("/", async (req, res) => {
  const scoreboard = await getScoreboard();
  res.render("contest/index", {
    scoreboard,
    user: req.user || null // <-- add this line
  });
});

// Player join (registered user only)
// Player join (registered user only)
router.post("/player/join", requireAuth, async (req, res) => {
  const userId = req.user._id;
  const name = req.user.name || req.body.name;

  // Try to find player by userId
  let player = (await getPlayers()).find(p => p.userId?.toString() === userId.toString());
  if (!player) {
    player = await createPlayer({ name, userId, role: req.user.contest || "player" });
  }
  res.json(player);
});

// Current player info
router.get("/me", requireAuth, async (req, res) => {
  const userId = req.user._id;
  const player = (await getPlayers()).find(p => p.userId?.toString() === userId.toString());
  if (!player) return res.status(204).end();
  res.json(player);
});

// Submit action (registered user only)
router.post("/player/:id/action", requireAuth, async (req, res) => {
  const userId = req.user._id;
  const player = (await getPlayers()).find(p => p.userId?.toString() === userId.toString());
  if (!player) return res.status(403).json({ error: "Not a player" });

  const created = await submitAction(player._id, req.body);

  const io = req.app.get("io");
  if (io) {
    const scoreboard = await getScoreboard();
    io.of("/contest").emit("score:update", scoreboard);
  }
  res.json(created);
});

// Manager: list pending actions
router.get("/mgr/pending", requireAuth, requireMgr, async (req, res) => {
  res.json(await listPending());
});

// Manager: verify action
router.post("/mgr/verify/:actionId", requireAuth, requireMgr, async (req, res) => {
  const { status, approvedBy } = req.body;
  res.json(await verifyAction(req.params.actionId, status, approvedBy));
});

// Leave session (optional, for cookie cleanup)
router.post("/session/leave", (req, res) => {
  res.clearCookie("contest_pid", { sameSite: "lax" });
  res.json({ ok: true });
});

router.use('/user', user);

export default router;