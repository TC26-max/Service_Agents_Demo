// POST /api/csp-report: receives Content-Security-Policy violation reports (audit N-21).
// The policy names this endpoint with report-uri. A report is reduced to counts-only fields before it
// is logged: the directive, the blocked resource's origin (or keyword such as "inline"), and the page
// path. Query strings, full URLs and script samples are never logged. Always answers 204.
import { clientIp } from "../lib/security.mjs";
import { makeLimiter } from "../lib/limits.mjs";

// Browsers send application/csp-report or application/reports+json, which the default body parser
// does not read; turn it off and read the raw stream (capped) instead.
export const config = { api: { bodyParser: false } };
const LIMIT = makeLimiter({ name: "csp-report", windowMs: 5 * 60 * 1000, perIp: 30, perIpDay: 200, perDay: 5000 });
const MAX_BYTES = 16 * 1024;

function originOf(u) {
  if (!u || typeof u !== "string") return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return u.slice(0, 24); // keywords: inline, eval, wasm-eval, data
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : x.protocol; } catch (e) { return "invalid"; }
}
function pathOf(u) { try { return new URL(u).pathname.slice(0, 80); } catch (e) { return ""; } }

// Accepts both shapes: { "csp-report": {...} } (report-uri) and [{ type: "csp-violation", body: {...} }] (Reporting API).
export function summarize(raw) {
  let data = raw;
  if (typeof data === "string" || Buffer.isBuffer(data)) {
    const text = String(data).slice(0, MAX_BYTES);
    try { data = JSON.parse(text); } catch (e) { return []; }
  }
  const items = Array.isArray(data) ? data.map(r => r && r.body) : [data && data["csp-report"]];
  return items.filter(b => b && typeof b === "object").slice(0, 10).map(b => ({
    directive: String(b["effective-directive"] || b.effectiveDirective || b["violated-directive"] || "").split(" ")[0].slice(0, 40),
    blocked: originOf(b["blocked-uri"] || b.blockedURL || ""),
    page: pathOf(b["document-uri"] || b.documentURL || "")
  }));
}

async function readRaw(req) {
  if (req.body !== undefined && req.body !== null && req.body !== "") return req.body; // already read (local harness)
  let size = 0; const parts = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BYTES) break; parts.push(chunk); }
  return Buffer.concat(parts);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  try {
    const raw = await readRaw(req);
    if (LIMIT.check(clientIp(req)).ok) for (const s of summarize(raw)) console.warn("[grounded] csp-violation " + JSON.stringify(s));
  } catch (e) { /* a report must never fail the page */ }
  res.status(204).end();
}
