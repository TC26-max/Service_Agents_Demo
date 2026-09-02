// GET /api/health: token-free health probe. No upstream call, no key use. Drives the page's status
// pill and issues the short-lived demo token that /api/transcribe requires (audit G-20, Phase 5).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { issueToken } from "../lib/security.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let VERSION = "dev";
for (const p of [path.join(process.cwd(), "version.json"), path.join(HERE, "..", "version.json")]) { try { VERSION = JSON.parse(fs.readFileSync(p, "utf8")).version; break; } catch (e) {} }

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  const keySet = !!(process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.MISTRAL_API_KEY);
  res.status(200).json({
    ok: keySet, version: VERSION,
    provider: (process.env.PROVIDER || "openai").toLowerCase(),
    model: (process.env.CHAT_MODEL || "").split(",")[0] || null,
    streaming: true, retrieval: "hybrid",
    token: keySet ? issueToken() : null,
    limits: { chatPer5Min: 20, voicePer5Min: 10 }
  });
}
