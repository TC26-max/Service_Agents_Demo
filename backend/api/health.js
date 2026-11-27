// GET /api/health: health probe. Drives the page's status pill and issues the short-lived demo token
// that /api/transcribe requires (audit G-20). The plain call never touches the model provider.
// v3.2 (audit N-13): GET /api/health?deep=1 also runs the model canary (lib/provider.mjs: one small
// call, cached per warm instance for 6 hours after a success and 10 minutes after a failure; deep
// checks are limited to 6 per hour per visitor). The page runs it once after loading, and a daily
// GitHub Action runs it so a model that stops answering is noticed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { issueToken, clientIp } from "../lib/security.mjs";
import { makeLimiter } from "../lib/limits.mjs";
import { canary, PROVIDER, CHAT_MODELS } from "../lib/provider.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let VERSION = "dev";
for (const p of [path.join(process.cwd(), "version.json"), path.join(HERE, "..", "version.json")]) { try { VERSION = JSON.parse(fs.readFileSync(p, "utf8")).version; break; } catch (e) {} }
const DEEP = makeLimiter({ name: "canary", windowMs: 60 * 60 * 1000, perIp: 6, perIpDay: 24, perDay: 500 });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  const keySet = !!(process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.MISTRAL_API_KEY);
  const deep = (req.query && String(req.query.deep) === "1") || /[?&]deep=1(?:&|$)/.test(String(req.url || ""));
  let check = null;
  if (deep && keySet) {
    if (!DEEP.check(clientIp(req)).ok) { res.status(429).json({ error: "deep health checks are limited; try again later" }); return; }
    check = await canary();
  }
  res.status(200).json({
    ok: keySet && (check ? check.ok : true), version: VERSION,
    provider: PROVIDER,
    model: CHAT_MODELS[0] || null,
    streaming: true, retrieval: "hybrid",
    canary: check,
    token: keySet ? issueToken() : null,
    limits: { chatPer5Min: 20, voicePer5Min: 10 }
  });
}
