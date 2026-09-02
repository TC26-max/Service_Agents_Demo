// Grounded, api/transcribe.js (v3.0): speech-to-text via the Gemini native API (server-side, reliable).
// POST { audio: <base64 WAV>, mime: "audio/wav" } with header x-demo-token (issued by GET /api/health)
//   -> { text: "<transcript>" }
// The token is not authentication (the page fetches it openly); it stops the endpoint from being
// scripted as a free speech-to-text service without loading the demo, and it expires in 15 minutes.
// Voice usage is capped harder than chat: 10 clips per 5 minutes per IP, 150 per day per instance.
import { clientIp, verifyToken } from "../lib/security.mjs";

const KEY = process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY;
const MODELS = (process.env.STT_MODEL || "gemini-2.5-flash-lite,gemini-2.5-flash").split(",").map(s => s.trim()).filter(Boolean);
const NATIVE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEAD = new Set();

const RL_WINDOW_MS = 5 * 60 * 1000, RL_MAX = 10, RL_DAY_MS = 24 * 60 * 60 * 1000, RL_DAY_MAX = 150;
const RL = new Map(); let RL_DAY = { start: Date.now(), n: 0 };
function rateLimited(req) {
  const now = Date.now();
  if (now - RL_DAY.start > RL_DAY_MS) RL_DAY = { start: now, n: 0 };
  if (++RL_DAY.n > RL_DAY_MAX) return true;
  const ip = clientIp(req); const e = RL.get(ip);
  if (!e || now - e.t > RL_WINDOW_MS) { if (RL.size > 5000) RL.clear(); RL.set(ip, { t: now, n: 1 }); return false; }
  return ++e.n > RL_MAX;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-demo-token");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!KEY) { res.status(500).json({ error: "API key not set" }); return; }
  if (!verifyToken(req.headers["x-demo-token"])) { res.status(401).json({ error: "demo_token_required", message: "Load the demo page first; the voice feature uses a short-lived page token." }); return; }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const audio = body.audio; const mime = body.mime || "audio/wav";
    if (!audio) { res.status(400).json({ error: "no audio" }); return; }
    if (rateLimited(req)) { res.status(429).json({ error: "fair-use limit reached: this free public demo caps voice usage; please try again in a few minutes." }); return; }
    if (typeof audio !== "string" || audio.length > 2_000_000) { res.status(413).json({ error: "recording too long, keep it under about 15 seconds" }); return; }
    const payload = JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data: audio } }, { text: "Transcribe the spoken words in this audio verbatim. Return ONLY the transcript text, no quotes, no commentary. If there is no clear speech, return nothing." }] }], generationConfig: { temperature: 0 } });
    let lastStatus = 0;
    for (const model of MODELS) {
      if (DEAD.has(model)) continue;
      const r = await fetch(`${NATIVE}/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body: payload });
      if (r.ok) {
        const j = await r.json();
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        res.status(200).json({ text: parts.map(p => p.text || "").join("").trim() }); return;
      }
      const b = await r.text(); lastStatus = r.status;
      console.error("[grounded] transcribe provider error:", model, r.status, b.slice(0, 300));
      if (r.status === 404 || /limit:\s*0/.test(b)) DEAD.add(model);
      if (r.status === 429) break;
    }
    if (lastStatus === 429) { res.status(503).json({ error: "provider_rate_limited", message: "The model provider is rate limiting voice right now. Please try again in a few seconds." }); return; }
    res.status(502).json({ error: "transcription_unavailable", message: "Transcription could not complete. Please try again, or type your question." });
  } catch (e) {
    console.error("[grounded] transcribe error:", e && e.message);
    res.status(502).json({ error: "transcription_unavailable", message: "Transcription could not complete. Please try again, or type your question." });
  }
}
