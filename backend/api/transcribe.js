// Grounded, api/transcribe.js (v3.1): speech-to-text via the Gemini native API (server-side, reliable).
// POST { audio: <base64 WAV>, mime: "audio/wav" } with header x-demo-token (issued by GET /api/health)
//   -> { text: "<transcript>" }
// The token is not authentication (the page fetches it openly); it stops the endpoint from being
// scripted as a free speech-to-text service without loading the demo, and it expires in 15 minutes.
// Voice usage is capped harder than chat: 10 clips per 5 minutes and 30 per day per IP, 150 per day
// per instance, counting accepted clips only (audit N-01).
// Audit N-15: only WAV audio is accepted (the page always sends 16 kHz mono WAV), so the endpoint
// cannot be used to read images or PDFs. Audit N-07: a malformed token is a 401, never a crash.
import { clientIp, verifyToken, readJsonBody } from "../lib/security.mjs";
import { makeLimiter } from "../lib/limits.mjs";

const KEY = process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY;
const MODELS = (process.env.STT_MODEL || "gemini-2.5-flash-lite,gemini-2.5-flash").split(",").map(s => s.trim()).filter(Boolean);
const NATIVE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEAD = new Set();
const LIMIT = makeLimiter({ name: "voice", windowMs: 5 * 60 * 1000, perIp: 10, perIpDay: 30, perDay: 150 });
const ALLOWED_MIME = new Set(["audio/wav", "audio/x-wav"]);
const MAX_B64 = 2_000_000;
// A WAV file starts with "RIFF", a 4-byte size, then "WAVE": check the decoded first 12 bytes.
const looksLikeWav = b64 => { const h = Buffer.from(b64.slice(0, 16), "base64"); return h.length >= 12 && h.toString("latin1", 0, 4) === "RIFF" && h.toString("latin1", 8, 12) === "WAVE"; };
const FAIL = { error: "transcription_unavailable", message: "Transcription could not complete. Please try again, or type your question." };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-demo-token");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    if (!KEY) { res.status(500).json({ error: "API key not set" }); return; }
    if (!verifyToken(req.headers["x-demo-token"])) { res.status(401).json({ error: "demo_token_required", message: "Load the demo page first; the voice feature uses a short-lived page token." }); return; }
    const body = readJsonBody(req);
    if (body === null) { res.status(400).json({ error: "invalid_json", message: "The request body must be JSON." }); return; }
    const audio = body.audio; const mime = String(body.mime || "audio/wav").toLowerCase();
    if (!audio) { res.status(400).json({ error: "no audio" }); return; }
    if (!ALLOWED_MIME.has(mime)) { res.status(415).json({ error: "unsupported_media_type", message: "Only WAV audio is accepted." }); return; }
    if (typeof audio !== "string" || audio.length > MAX_B64) { res.status(413).json({ error: "recording too long, keep it under about 15 seconds" }); return; }
    if (!looksLikeWav(audio)) { res.status(415).json({ error: "unsupported_media_type", message: "Only WAV audio is accepted." }); return; }
    if (!LIMIT.check(clientIp(req)).ok) { res.status(429).json({ error: "fair-use limit reached: this free public demo caps voice usage; please try again in a few minutes." }); return; }
    const payload = JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: "audio/wav", data: audio } }, { text: "Transcribe the spoken words in this audio verbatim. Return ONLY the transcript text, no quotes, no commentary. If there is no clear speech, return nothing." }] }], generationConfig: { temperature: 0 } });
    let lastStatus = 0;
    for (const model of MODELS) {
      if (DEAD.has(model)) continue;
      const r = await fetch(`${NATIVE}/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body: payload });
      if (r.ok) {
        const j = await r.json();
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        res.status(200).json({ text: parts.map(p => p.text || "").join("").trim().slice(0, 2000) }); return;
      }
      const b = await r.text(); lastStatus = r.status;
      console.error("[grounded] transcribe provider error:", model, r.status, b.slice(0, 300));
      if (r.status === 404 || /limit:\s*0/.test(b)) DEAD.add(model);
      if (r.status === 429) break;
    }
    if (lastStatus === 429) { res.status(503).json({ error: "provider_rate_limited", message: "The model provider is rate limiting voice right now. Please try again in a few seconds." }); return; }
    res.status(502).json(FAIL);
  } catch (e) {
    console.error("[grounded] transcribe error:", e && e.message);
    if (!res.headersSent) res.status(502).json(FAIL);
  }
}
