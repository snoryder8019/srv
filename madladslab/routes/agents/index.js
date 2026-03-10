import express from "express";

import agentsRouter from "./agents.js";
import chatRouter from "./chat.js";
import tuningRouter from "./tuning.js";
import memoryRouter from "./memory.js";
import actionsRouter from "./actions.js";
import mcpRouter from "./mcp.js";
import backgroundRouter from "./background.js";
import forwardChatRouter from "./forwardchat.js";

const router = express.Router();

router.use(agentsRouter);
router.use(chatRouter);
router.use(tuningRouter);
router.use(memoryRouter);
router.use(actionsRouter);
router.use(mcpRouter);
router.use(backgroundRouter);
router.use(forwardChatRouter);

export default router;
