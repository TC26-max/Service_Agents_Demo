// Speech-to-text via Gemini (reliable, server-side) — replaces the flaky browser Web Speech API.
// POST { audio: <base64 WAV>, mime: "audio/wav" }  ->  { text: "<transcript>" }
const KEY = process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY;
const MODELS = (process.env.STT_MODEL || process.env.CHAT_MODEL || "gemini-2.5-flash,gemini-2.0-flash-lite,gemini-2.5-flash-lite,gemini-1.5-flash")
  .split(",").map(s => s.trim()).filter(Boolean);
const NATIVE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEAD = new Set();

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
