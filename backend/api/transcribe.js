// Speech-to-text via Gemini (reliable, server-side) — replaces the flaky browser Web Speech API.
// POST { audio: <base64 WAV>, mime: "audio/wav" }  ->  { text: "<transcript>" }
const KEY = process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY;
const MODELS = (process.env.STT_MODEL || "gemini-2.5-flash-lite,gemini-2.5-flash")
  .split(",").map(s => s.trim()).filter(Boolean);
const NATIVE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEAD = new Set();

// Fair-use limiter (v2.2) — same best-effort per-instance approach as api/chat.js.
const RL_WINDOW_MS = 5 * 60 * 1000, RL_MAX = 10;          // voice is costlier: 10 clips / 5 min / IP
const RL_DAY_MS = 24 * 60 * 60 * 1000, RL_DAY_MAX = 300;
const RL = new Map();
let RL_DAY = { start: Date.now(), n: 0 };
function rateLimited(req) {
  const now = Date.now();
  if (now - RL_DAY.start > RL_DAY_MS) RL_DAY = { start: now, n: 0 };
  if (++RL_DAY.n > RL_DAY_MAX) return true;
  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "?").split(",")[0].trim();
  const e = RL.get(ip);
  if (!e || now - e.t > RL_WINDOW_MS) { if (RL.size > 5000) RL.clear(); RL.set(ip, { t: now, n: 1 }); return false; }
  return ++e.n > RL_MAX;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!KEY) { res.status(500).json({ error: "API key not set" }); return; }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const audio = body.audio;
    const mime = body.mime || "audio/wav";
    if (!audio) { res.status(400).json({ error: "no audio" }); return; }
    if (rateLimited(req)) { res.status(429).json({ error: "fair-use limit reached — this free public demo caps voice usage; please try again in a few minutes." }); return; }
    if (typeof audio !== "string" || audio.length > 2_000_000) { res.status(413).json({ error: "recording too long — keep it under ~15 seconds" }); return; }
    const payload = JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mime, data: audio } },
        { text: "Transcribe the spoken words in this audio verbatim. Return ONLY the transcript text — no quotes, no commentary. If there is no clear speech, return nothing." }
      ] }],
      generationConfig: { temperature: 0 }
    });
    let lastErr = "";
    for (const model of MODELS) {
      if (DEAD.has(model)) continue;
      const r = await fetch(`${NATIVE}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: payload
      });
      if (r.ok) {
        const j = await r.json();
        const text = (((j.candidates || [])[0] || {}).content || {}).parts ?
          j.candidates[0].content.parts.map(p => p.text || "").join("").trim() : "";
        res.status(200).json({ text });
        return;
      }
      const t = (await r.text()).slice(0, 300);
      lastErr = "transcribe " + r.status + " (" + model + ") " + t;
      if (r.status === 404 || /limit:\s*0/.test(t)) DEAD.add(model); // permanent -> skip; 429/5xx -> just try next
    }
    res.status(500).json({ error: lastErr || "transcription failed" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
