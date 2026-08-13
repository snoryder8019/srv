// ─────────────────────────────────────────────────────────────────────────────
// ingressProvision.js — client for the VPS `ingress-mcp` server, which puts a
// tenant custom domain LIVE (Let's Encrypt cert + Apache vhost + reload) on
// demand. We call it the moment a tenant saves a custom domain, so the cert +
// vhost exist within seconds instead of waiting on any poll.
//
// Transport: MCP over Streamable HTTP. Responses are SSE frames — the JSON-RPC
// envelope arrives on a `data:` line, and the tool's payload is a JSON string
// inside result.content[0].text. Auth: static bearer.
// ─────────────────────────────────────────────────────────────────────────────
const MCP_URL = process.env.INGRESS_MCP_URL || 'https://ingress-mcp.madladslab.com/mcp';
const token = () => process.env.INGRESS_MCP_TOKEN || process.env.MCP_TOKENS || '';

export function ingressConfigured() { return !!token(); }

// Pull the JSON-RPC envelope out of an SSE (or plain-JSON) MCP response body.
function parseMcpBody(text) {
  const line = text
    .split('\n')
    .map((l) => l.replace(/^data:\s?/, ''))
    .find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error('ingress-mcp: no JSON in response');
  return JSON.parse(line);
}

async function mcpCall(name, args, { timeoutMs = 20000 } = {}) {
  if (!token()) throw new Error('INGRESS_MCP_TOKEN not set');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const env = parseMcpBody(await res.text());
    if (env.error) throw new Error(env.error.message || 'ingress-mcp error');
    const txt = env.result?.content?.[0]?.text;
    try { return JSON.parse(txt); } catch { return txt; }
  } finally {
    clearTimeout(t);
  }
}

/**
 * Provision (or confirm) cert + vhost for a custom domain. Idempotent on the
 * VPS side. Returns the tool's parsed result — e.g. { ok: true, ... } or
 * { ok: false, reason: 'dns_not_pointed' } when the domain's DNS isn't pointed
 * at the VPS yet (a normal "retry later" state, NOT an error to alarm on).
 */
export async function provisionDomain(apex, { aliases } = {}) {
  const a = String(apex).trim().toLowerCase().replace(/^www\./, '');
  return mcpCall('provision_domain', { apex: a, aliases: aliases || [`www.${a}`] });
}

export async function domainStatus(apex) {
  return mcpCall('domain_status', { apex: String(apex).trim().toLowerCase() });
}

/**
 * Fire-and-forget wrapper for request handlers: never throws, logs the outcome.
 * `dns_not_pointed` is logged as info (tenant retries after DNS propagates).
 */
export function provisionDomainSafe(apex, opts = {}) {
  provisionDomain(apex, opts)
    .then((r) => {
      if (r && r.ok === false && r.reason === 'dns_not_pointed') {
        console.log(`[ingress] ${apex}: DNS not pointed at VPS yet — will retry when tenant re-saves / DNS propagates`);
      } else {
        console.log(`[ingress] provision_domain(${apex}):`, typeof r === 'string' ? r : JSON.stringify(r));
      }
    })
    .catch((e) => console.error(`[ingress] provision_domain(${apex}) failed:`, e.message));
}
