# Agents — User Guide

AI agents powered by Ollama. Each agent has its own identity, memory, tool access, and can run autonomously in the background.

---

## Getting Started

### Spawning an Agent

Click **Spawn Agent** (top-right of the hub, or the `+` button in the sidebar) to open the create form.

**Quickest path:** pick a preset from the dropdown at the top — it fills in the name, role, system prompt, and recommended tools automatically.

**Key fields:**
- **Name** — give it something memorable
- **Model** — choose based on what you need (Qwen 14B for complex reasoning, 7B for speed)
- **Pipeline Role** — this changes how the agent processes your messages:
  - `assistant` — standard chat, no pre-processing
  - `researcher` — generates a structured TLDR before answering; good for analysis tasks
  - `vibecoder` — breaks your request into a numbered task list before working; good for dev tasks
  - `forwardChat` — consumer deployment mode for external sites
- **System Prompt** — what the agent knows about itself and its job. Use the Prompt Builder to generate one from simple inputs.
- **Domains** — capability tags; used for routing and reporting

---

## The Hub

The main interface is the **two-panel hub** at `/agents`.

**Left sidebar:** all agents. Click any row to open it in the detail panel. Use the filter input to search by name. The `+` button spawns a new agent.

**Status badges** on each sidebar row:
- Coloured dot — agent status (green = idle/running, grey = stopped)
- `●` pink dot — background process is running
- Number badge — pending tasks
- `!` badge — task needs your reply

### Agent Header Actions

When you select an agent, the header shows:

| Button | What it does |
|---|---|
| **Chat** | Open the chat modal to talk to this agent |
| **Start BG / Stop BG** | Start or stop the autonomous background process |
| **Start / Stop** | Toggle the agent's operational status |
| **Clone** | Open the create modal pre-filled with this agent's full config (name prefixed "Copy of …") |
| **forwardChat** | Deploy this agent to bih chat or external sites |
| **Reset NSP** | Wipe the agent's namespace collections (tasks, notes, crons, actions) |

---

## Chatting with an Agent

Click **Chat** to open the chat modal. The context strip at the top shows memory health (turns, KB entries, whether summary/LTM are set).

The agent works in a **tool loop** — if it has tools enabled, it may call one or more before responding. You'll see live indicators as tools fire.

If the agent has a `researcher` or `vibecoder` role, it runs a pre-processing step on your message before the main loop — you'll see a TLDR or task breakdown card in the Actions tab.

**Background findings** — if the agent's background process has been running, recent findings are injected into its context automatically.

---

## Tabs

### Notes
Agent-written notes stored in `agent_notes`. Agents write here via the `mongo_write` MCP tool. You can delete individual notes. These are separate from memory — they're free-form scratchpad entries the agent creates itself.

### Actions
Log of everything the agent has produced: background outputs, TLDRs, task lists, images, findings. Filter by type. Each action can be promoted:
- **KB** → adds to the agent's Knowledge Base (injected into future context)
- **LTM** → merges into Long-Term Memory/Notes

### Tasks
The agent's task queue. Three states: **needs human** (agent is blocked and wants your input), **pending**, **complete**.

- **+ Add Task** — inject a task directly as the operator
- Reply to a `needs_human` task inline to unblock the agent
- Tasks are consumed during background ticks (up to 5 per tick, highest priority first)

### Crons
Scheduled recurring tasks. Set an interval (in minutes) and a content description of what the agent should do on each run. Crons inject tasks into the agent's background queue on schedule.

### Memory
Read-only view of the agent's memory state:
- **Thread Summary** — auto-updated rolling summary of recent conversations
- **Long-Term Memory / Notes** — extracted decisions, action items, persistent context
- **Background Findings** — rolling log of autonomous work output
- **Knowledge Base** — discrete reusable facts extracted from conversations
- **Recent Conversations** — last conversation turns

### Logs
Runtime logs from the agent process. Filter by `info`, `warn`, `error`. Auto-updated via socket.

### Background
Control the autonomous background process. Set a **Background Prompt** to give the agent a standing directive (otherwise it works from its task queue). Background runs on a configurable interval (default set at agent creation).

The **productivity score** tracks how often the agent is doing useful work vs. idling. If it idles too many consecutive ticks, it enters task-invention mode and starts generating its own tasks.

**Tick history** shows the last 20 ticks: title, summary, and timestamp.

### Settings
Full agent configuration in 5 independently-saveable sections:

| Section | What you can change |
|---|---|
| **Identity** | Name, description, model, pipeline role, category, tier |
| **LLM Parameters** | System prompt, temperature, max tokens, context window, top-P, top-K, repeat penalty. Use the **quick preset chips** (Balanced, Code, Creative, Terse, etc.) to snap to common parameter combinations in one click. |
| **bihBot Config** | Enable/disable bih chat integration, chat mode (passive/active/agent), trigger word, display name, avatar, rate limit |
| **Guardrails** | Consumer-mode content controls: allowed topics, blocked keywords, max response length, profanity filter, prompt lock, rate limits |
| **MCP Tools** | Two-column checkbox grid — enable/disable each tool for **Chat** and **Background** independently |

Changes in each section are committed only when you click its **Save** button.

---

## forwardChat — Deploying to External Sites

The **forwardChat** panel in the agent header lets you deploy an agent as a chat widget on external sites.

**bih deploy:** one click to make this agent respond to messages in the bih gaming community chat.

**Site assignment:**
1. Go to **manage sites** to register a site (name + URL)
2. Copy the install snippet (a `<script>` tag with your site token)
3. Paste it into your site's HTML
4. Back in the forwardChat panel, use the dropdown to assign this agent to that site

The plugin widget will then route visitor messages to this agent and display its responses.

---

## Presets

When creating an agent, presets auto-fill identity, system prompt, model, tools, and background config. Available presets:

**Platform / Dev**
| Preset | Role | Best for |
|---|---|---|
| Vibecoder | vibecoder | Writing and editing code across `/srv` |
| Debug Detective | assistant | Stack traces, root cause analysis |
| Server Monitor | researcher | Watching services, ports, tmux sessions |
| Coordinator | assistant | Task delegation across the agent org |
| Agent Architect | assistant | Designing and deploying new agents |

**Research / Security**
| Preset | Role | Best for |
|---|---|---|
| Researcher | researcher | Evidence-first deep analysis |
| Security Auditor | researcher | OWASP Top 10 code review |
| Data Scout | researcher | MongoDB read-only query analysis |

**Consumer**
| Preset | Role | Best for |
|---|---|---|
| Support Agent | forwardChat | Consumer-facing chat deployment |
| Sales Assistant | forwardChat | Lead qualification chat |

**Maintenance**
| Preset | Role | Best for |
|---|---|---|
| Prompt Doctor | researcher | Auditing and improving system prompts |
| KB Curator | assistant | Knowledge base maintenance |

**Support Roles** — auto-apply when selected as a support agent
| Preset | Best for |
|---|---|
| Summarizer | Condenses threads and background findings |
| Fact Checker | Verifies claims and citations |
| Tone Adjuster | Enforces consistent voice and style |
| Context Injector | Enriches requests with KB content |
| Quality Gate | Approves, flags, or blocks outputs |
| Escalation Handler | Routes edge cases to the right agent |
| Data Validator | Validates structured output against schemas |
| Memory Manager | Controls what gets persisted to KB/LTM |
| Task Planner | Decomposes goals into actionable tasks |
| Output Formatter | Standardises response format |
| Content Filter | Blocks out-of-scope responses |

**Creative / Persona**
| Preset | Best for |
|---|---|
| Narrator | World-building and lore for PS |
| Persona Scout | Research and embody a character |
| Copywriter | Marketing, email, ad, social, UX, and long-form copy |

**From Existing Agent** — the preset dropdown also includes all your existing agents. Select any one to clone its full config (LLM params, system prompt, MCP tools, working dir) into the form as a starting point.

---

## Namespace Reset

**Reset NSP** on any agent wipes its operational state without deleting the agent itself. Choose which collections to clear:

| Collection | Contains |
|---|---|
| `agent_tasks` | pending task queue |
| `agent_notes` | agent-written scratchpad notes |
| `agent_crons` | scheduled jobs |
| `agent_actions` | findings and output log |
| **in-doc memory** | KB, conversations, summaries (inside the Agent document) |

Use **Reset All NSP** (top-right of the hub) to wipe selected collections across all agents at once. This cannot be undone.

---

## Org Stats (Top Bar)

The hub topbar shows live org-wide stats:
- Total agents
- How many are running background processes
- Pending tasks across all agents
- How many tasks are waiting for human input

These update on page load and after socket events.

---

## Other Views

| URL | Purpose |
|---|---|
| `/agents/digest` | Live background activity feed across all agents. Filter by agent or action type. Includes org chart, background controls, and task queue. |
| `/agents/display` | TV/wall dashboard. Agents grouped by category with live status and productivity scores. |
| `/agents/reports` | Activity reports and summaries. |
