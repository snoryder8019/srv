/**
 * Seed script: register madladslab.com and ballzinholez.com as forwardChat sites
 * and assign the most suitable active agent to each.
 * Run once: node utils/seed-forwardchat.js
 */
import mongoose from "mongoose";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const MONGO_URI = process.env.DB_URL;
const DB_NAME   = process.env.DB_NAME || "madLadsLab";

await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
console.log("Connected to", DB_NAME);

// ── Inline schemas (avoid full app import chain) ──────────────────────────────
const AgentSchema = new mongoose.Schema({
  name: String, role: String, status: String,
  bihBot: { enabled: Boolean, trigger: String, displayName: String, chatMode: String },
  forwardChat: { sites: Array, bihEnabled: Boolean, sessionLimit: Number, rateLimitPerHour: Number },
  config: { systemPrompt: String, temperature: Number },
  model: String
}, { collection: "agents" });

const SiteSchema = new mongoose.Schema({
  siteName: String, siteUrl: String, origin: String,
  plugin: { token: { type: String, default: () => randomUUID() }, verified: Boolean, installedAt: Date, lastPing: Date, testHitConfirmed: Boolean },
  activeAgent: mongoose.Schema.Types.ObjectId,
  chatMode: String, enabled: Boolean, createdBy: mongoose.Schema.Types.ObjectId
}, { collection: "forwardchatsites", timestamps: true });

const Agent = mongoose.models.Agent || mongoose.model("Agent", AgentSchema);
const Site  = mongoose.models.ForwardChatSite || mongoose.model("ForwardChatSite", SiteSchema);

// ── List available agents ─────────────────────────────────────────────────────
const agents = await Agent.find({}, "name role status model bihBot forwardChat").lean();
console.log("\nAvailable agents:");
agents.forEach((a, i) => console.log(`  [${i}] ${a._id}  ${a.name}  (${a.role}, ${a.status})`));

if (!agents.length) {
  console.error("No agents found — create at least one in the dashboard first.");
  process.exit(1);
}

// Pick best agent: prefer active/idle, non-null
const preferredAgent = agents.find(a => a.status === "idle" || a.status === "running") || agents[0];
console.log(`\nUsing agent: ${preferredAgent.name} (${preferredAgent._id})`);

// ── Register / upsert madladslab.com ─────────────────────────────────────────
let mll = await Site.findOne({ siteUrl: /madladslab\.com/i });
if (!mll) {
  mll = await Site.create({
    siteName: "madLadsLab",
    siteUrl:  "https://madladslab.com",
    origin:   "https://madladslab.com",
    chatMode: "active",
    enabled:  true,
    activeAgent: preferredAgent._id,
    plugin: { token: randomUUID(), verified: false }
  });
  console.log("\n[madladslab.com] Created — token:", mll.plugin.token);
} else {
  if (!mll.activeAgent) {
    mll.activeAgent = preferredAgent._id;
    await mll.save();
    console.log("\n[madladslab.com] Existed, agent assigned.");
  } else {
    console.log("\n[madladslab.com] Already registered, agent already set.");
  }
}

// ── Register / upsert ballzinholez.com ───────────────────────────────────────
let bih = await Site.findOne({ siteUrl: /ballzinholez\.com/i });
if (!bih) {
  bih = await Site.create({
    siteName: "ballzinholez.com",
    siteUrl:  "https://ballzinholez.com",
    origin:   "https://ballzinholez.com",
    chatMode: "active",
    enabled:  true,
    activeAgent: preferredAgent._id,
    plugin: { token: randomUUID(), verified: false }
  });
  console.log("[ballzinholez.com] Created — token:", bih.plugin.token);
} else {
  if (!bih.activeAgent) {
    bih.activeAgent = preferredAgent._id;
    await bih.save();
    console.log("[ballzinholez.com] Existed, agent assigned.");
  } else {
    console.log("[ballzinholez.com] Already registered, agent already set.");
  }
}

// ── Sync agent's forwardChat.sites array ──────────────────────────────────────
const agent = await Agent.findById(preferredAgent._id);
for (const site of [mll, bih]) {
  const alreadyLinked = agent.forwardChat?.sites?.some(
    s => s.siteId?.toString() === site._id.toString()
  );
  if (!alreadyLinked) {
    if (!agent.forwardChat) agent.forwardChat = { sites: [], sessionLimit: 50, rateLimitPerHour: 60 };
    if (!agent.forwardChat.sites) agent.forwardChat.sites = [];
    agent.forwardChat.sites.push({ siteId: site._id, chatMode: "active", enabled: true });
  }
}
await agent.save();

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n── forwardChat sites ready ──────────────────────────────────────");
console.log(`madladslab.com   token: ${mll.plugin.token}`);
console.log(`ballzinholez.com token: ${bih.plugin.token}`);
console.log(`\nInstall snippet (madladslab.com):\n  <script src="https://madladslab.com/plugin/forwardchat.js?site=${mll.plugin.token}"></script>`);
console.log(`\nInstall snippet (ballzinholez.com):\n  <script src="https://madladslab.com/plugin/forwardchat.js?site=${bih.plugin.token}"></script>`);
console.log("\nAgent serving both:", agent.name);

await mongoose.disconnect();
