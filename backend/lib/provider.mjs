// backend/lib/provider.mjs: model provider settings shared by the chat and health functions (Node only).
// OpenAI-compatible shape; pick with PROVIDER. v3.2 (audit N-13): the request body depends on the model
// family, so CHAT_MODEL can move from the legacy-gated Gemini 2.5 Flash to a current model (Google
// recommends Gemini 3.5 Flash-Lite for new projects) without a code change, and /api/health runs a
// small canary call so the status pill reflects whether the model actually answers.
export const PRESETS = {
  openai:  { base: "https://api.openai.com/v1",                               chat: "gpt-4o-mini",          embed: "text-embedding-3-small" },
  mistral: { base: "https://api.mistral.ai/v1",                               chat: "mistral-small-latest", embed: "mistral-embed" },
  gemini:  { base: "https://generativelanguage.googleapis.com/v1beta/openai", chat: "gemini-2.5-flash",     embed: "gemini-embedding-001" }
};
export const PROVIDER = (process.env.PROVIDER || "openai").toLowerCase();
const P = PRESETS[PROVIDER] || PRESETS.openai;
export const API_BASE = (process.env.API_BASE || P.base).replace(/\/$/, "");
export const KEY = process.env.API_KEY || process.env.OPENAI_API_KEY || process.env.MISTRAL_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
export const EMBED_MODEL = process.env.EMBED_MODEL || P.embed;
export const CHAT_MODELS = (process.env.CHAT_MODEL || P.chat).split(",").map(s => s.trim()).filter(Boolean);

// Gemini 2.5 reasons by default and bills hidden tokens against max_tokens, so thinking is turned off.
// Gemini 3.x cannot turn reasoning off: it runs at the model's default level, keeps its recommended
// default temperature, and gets headroom so reasoning cannot crowd out the visible answer.
export function payloadFor(model, system, messages, max, stream) {
  const gem = PROVIDER === "gemini", gem25 = gem && /^gemini-2\.5/i.test(model), gem3 = gem && /^gemini-3/i.test(model);
  return JSON.stringify({
    model, ...(gem3 ? {} : { temperature: 0.3 }), max_tokens: gem3 ? Math.max(max, 1024) : max, ...(stream ? { stream: true } : {}),
    ...(gem25 ? { extra_body: { google: { thinking_config: { thinking_budget: 0, include_thoughts: false } } } } : {}),
    messages: [{ role: "system", content: system }, ...messages]
  });
}

// One small call, cached per warm instance: 6 hours after a success, 10 minutes after a failure.
// It spends at most four calls a day per instance and never runs without a key.
let CANARY = null;
export async function canary({ force = false, now = Date.now() } = {}) {
  if (!KEY) return { ok: false, reason: "no key", model: CHAT_MODELS[0] || null };
  const ttl = CANARY && (CANARY.ok ? 6 * 3600e3 : 10 * 60e3);
  if (CANARY && !force && now - CANARY.at < ttl) return CANARY.result;
  const model = CHAT_MODELS[0]; const t0 = Date.now(); let result;
  try {
    const r = await fetch(API_BASE + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY },
      body: payloadFor(model, "Reply with the single word OK.", [{ role: "user", content: "Health check." }], 16, false), signal: AbortSignal.timeout(8000) });
    result = { ok: r.ok, status: r.status, model, ms: Date.now() - t0, checkedAt: new Date(now).toISOString() };
    if (!r.ok) console.error("[grounded] canary failed:", model, r.status, (await r.text()).slice(0, 200));
  } catch (e) { result = { ok: false, status: 0, model, ms: Date.now() - t0, checkedAt: new Date(now).toISOString() }; console.error("[grounded] canary error:", model, e && e.message); }
  CANARY = { at: now, ok: result.ok, result };
  return result;
}
