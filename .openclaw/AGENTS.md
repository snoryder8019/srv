# OpenClaw — Agent Orchestration

OpenClaw is the root agent. It spawns specialized subagents for parallelizable, isolated, or context-heavy tasks. This document defines when and how to use them.

---

## Available Subagent Types

| Type | Use For | Speed |
|------|---------|-------|
| `Bash` | Git ops, tmux commands, npm, file ops via shell | Fast |
| `Explore` | Codebase scanning, pattern search, architecture research | Medium |
| `general-purpose` | Multi-step research, web fetch + analysis, complex open-ended tasks | Slower |
| `Plan` | Designing implementation strategies, architecture decisions | Medium |

---

## When to Spawn Subagents

### Spawn in parallel when tasks are independent:
```
Example: User asks to "check all services and find any that are broken"
→ Spawn multiple Bash agents simultaneously:
  - Agent 1: tmux ls + capture bih session
  - Agent 2: capture madladslab session
  - Agent 3: netstat -tlnp for port conflicts
→ All return, synthesize results
```

### Spawn sequentially when tasks depend on each other:
```
Example: "Find the bug in bih auth, then fix it"
→ Step 1: Explore agent scans bih/routes/auth.js and bih/config/passport.js
→ Wait for result
→ Step 2: Based on findings, Edit the specific file
→ Bash agent restarts bih service
```

### Spawn to protect main context:
```
Example: Scanning a 1000-line file for a specific pattern
→ Use Explore or Grep directly instead of reading the whole file into context
→ Only pull in the specific lines that matter
```

---

## Parallel Task Patterns

### Pattern 1: Service Health Check
```
Parallel spawns:
- Bash: "tmux ls" → which sessions are running
- Bash: "netstat -tlnp | grep -E '3000|3055|3399|3500|3600'" → port status
- Bash: "curl -s -o /dev/null -w '%{http_code}' http://localhost:3055/" → bih health
```

### Pattern 2: Cross-Service Feature Search
```
Parallel spawns:
- Explore: search bih/ for pattern X
- Explore: search madladslab/ for pattern X
- Explore: search ps/ for pattern X
→ Synthesize: where is this pattern used across services?
```

### Pattern 3: Read + Analyze Multiple Files
```
Parallel spawns (or parallel Read tool calls):
- Read bih/app.js
- Read bih/routes/auth.js
- Read bih/models/User.js
→ Synthesize the auth flow from all three
```

---

## Subagent Prompt Requirements

Every subagent prompt must include:
1. **What to do** — specific, actionable task
2. **Where to look** — exact file paths when known
3. **What to return** — what format the result should be in
4. **Context** — any constraints or relevant background

Do NOT assume subagents have conversation history. They start fresh.

### Good subagent prompt:
```
Search /srv/bih/routes/ for all Socket.IO event emitters.
Look for patterns like: io.emit(), socket.emit(), io.to().emit()
Return: a list of event names and the file:line where each is emitted.
Context: bih uses Socket.IO /chat namespace. app.js is the entry point.
```

### Bad subagent prompt:
```
Find the socket events
```

---

## Agent Result Synthesis

After subagents return:
1. Do not repeat their full output to the user — summarize
2. Cross-reference results if multiple agents worked on related tasks
3. Update MEMORY.md if findings reveal something significant
4. Identify follow-up tasks and either do them or add to todo list

---

## Recursion Limit

OpenClaw should not spawn subagents that spawn further subagents unless explicitly needed. Max depth: 2 (OpenClaw → subagent → single Bash/Read tool call within that agent).

---

## Memory After Subagent Work

If a subagent discovers something that changes the project understanding:
- Add it to `MEMORY.md` under the relevant project section
- Note it in the session log at the bottom of MEMORY.md

---

## Cost Awareness

- Prefer direct tool calls (Glob, Grep, Read) for simple targeted searches
- Only spawn Explore agents when you need multi-location, multi-pattern searches
- Only spawn general-purpose agents when you need web fetching + synthesis
- Bash agents are fast and cheap — prefer them for shell operations
