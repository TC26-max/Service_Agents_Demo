// Grounded, api/chat.js (v3.1): hybrid RAG endpoint for the Nimbus assistants (Vercel Node function).
//
// POST { bot: "support"|"sales", messages: [{role,content}], stream?: true, kbEdits?: {cid: text} }
//   -> JSON  { answer, sources[], faithful, ticket }
//   -> SSE   data:{sources,ticket} ... data:{t} ... data:{done:true, faithful}
// POST { mode: "retrieve", q, kbEdits? } -> { query, method, results[36] }  (rank only, no generation)
//
// Security model (audit 2026-09-01): the persona is server-owned. Client messages are role-whitelisted
// (user, assistant only), so no client text can carry a system role. Visitor knowledge-base edits are
// accepted only as capped, labelled passages (max 3, 240 chars each) marked VISITOR-EDITED in the
// prompt and declared untrusted in the persona. Provider errors are logged server-side and never
// echoed to the client. Rate limiting is per warm instance and keyed on the platform's client IP.
//
// v3.1 (audit 2026-11-26): the limiter counts only accepted requests and caps each address's daily
// share (N-01); a request is capped at 12 turns and 12,000 characters, and one without a visitor
// message is refused before any provider call (N-09); malformed JSON is a 400, not a model outage
// (N-18). Each request logs counts only (turns, characters, provider token usage when reported).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildKeywordIndex, keywordRank, overrideTerms, cosine, rrf } from "../lib/retrieval.mjs";
import { clientIp, readJsonBody } from "../lib/security.mjs";
import { makeLimiter } from "../lib/limits.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
function loadJSON(name) {
  for (const p of [path.join(process.cwd(), name), path.join(HERE, "..", name), path.join(HERE, name)]) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { /* try next */ }
  }
  return null;
}
const KB = loadJSON("kb.json"); if (!KB) throw new Error("kb.json not found next to the function");
const PERSONAS = loadJSON("personas/personas.json"); if (!PERSONAS) throw new Error("personas/personas.json not found");
const VERSION = (loadJSON("version.json") || {}).version || "dev";
let EMB_CACHE = loadJSON("kb-embeddings.json"); // optional pre-baked vectors; otherwise built on first request

const FLAT = [];
for (const d of KB) for (const c of d.chunks)
  FLAT.push({ cid: c.id, docId: d.id, docTitle: d.title, cat: d.cat, updated: d.updated, heading: c.heading, text: c.text });
const BYID = Object.fromEntries(FLAT.map(c => [c.cid, c]));
const KINDEX = buildKeywordIndex(FLAT);

export const config = { supportsResponseStreaming: true };

// ---- provider (OpenAI-compatible shape; pick with PROVIDER) ----
const PRESETS = {
  openai:  { base: "https://api.openai.com/v1",                               chat: "gpt-4o-mini",          embed: "text-embedding-3-small" },
  mistral: { base: "https://api.mistral.ai/v1",                               chat: "mistral-small-latest", embed: "mistral-embed" },
  gemini:  { base: "https://generativelanguage.googleapis.com/v1beta/openai", chat: "gemini-2.5-flash",     embed: "gemini-embedding-001" }
};
const PROVIDER = (process.env.PROVIDER || "openai").toLowerCase();
const P = PRESETS[PROVIDER] || PRESETS.openai;
const API_BASE = (process.env.API_BASE || P.base).replace(/\/$/, "");
const KEY = process.env.API_KEY || process.env.OPENAI_API_KEY || process.env.MISTRAL_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const EMBED_MODEL = process.env.EMBED_MODEL || P.embed;
const CHAT_MODELS = (process.env.CHAT_MODEL || P.chat).split(",").map(s => s.trim()).filter(Boolean);
const DEAD = new Set(); let RR = 0;
const TOPK = Math.min(6, Math.max(1, parseInt(process.env.TOP_K || "3", 10) || 3));
const MAX_TOKENS = 400;

// ---- fair-use limiter (per warm instance; keyed on the platform client IP; accepted calls only) ----
const LIMIT = makeLimiter({ name: "chat", windowMs: 5 * 60 * 1000, perIp: 20, perIpDay: 120, perDay: 600 });
// ---- request caps (audit N-09, OWASP LLM 2026 #6 Unbounded Consumption) ----
const MAX_TURNS = 12, MAX_MSG_CHARS = 4000, MAX_TOTAL_CHARS = 12000;
function capMessages(list) {
  const msgs = (Array.isArray(list) ? list : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) })).slice(-MAX_TURNS);
  let total = msgs.reduce((n, m) => n + m.content.length, 0);
  while (msgs.length > 1 && total > MAX_TOTAL_CHARS) total -= msgs.shift().content.length; // drop the oldest turns first
  while (msgs.length && msgs[0].role !== "user") msgs.shift();                              // history starts with the visitor
  return msgs;
}
function logUsage(o) { try { console.log("[grounded] usage " + JSON.stringify(o)); } catch (e) {} }
const FAIR_USE_MSG = "fair-use limit reached: this free public demo caps usage; please try again in a few minutes.";

// ---- CORS: same-origin page needs nothing; an explicit ALLOW_ORIGIN list may be echoed ----
function cors(req, res) {
  const allow = (process.env.ALLOW_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allow.includes(origin)) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

// ---- provider calls ----
async function embedMany(texts) {
  const r = await fetch(API_BASE + "/embeddings", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY }, body: JSON.stringify({ model: EMBED_MODEL, input: texts }) });
  if (!r.ok) throw new ProviderError("embeddings", r.status, await r.text());
  const j = await r.json();
  if (!j.data || j.data.length !== texts.length) throw new ProviderError("embeddings", 502, "batch size mismatch");
  return j.data.map(d => d.embedding);
}
async function embed(text) { return (await embedMany([text]))[0]; }
async function getCorpusEmbeddings() {
  if (EMB_CACHE) return EMB_CACHE;
  const vecs = await embedMany(FLAT.map(c => c.heading + ". " + c.text));
  EMB_CACHE = FLAT.map((c, i) => ({ cid: c.cid, vector: vecs[i] }));
  return EMB_CACHE;
}
class ProviderError extends Error { constructor(stage, status, body) { super(`${stage} ${status}`); this.stage = stage; this.status = status; this.body = String(body || "").slice(0, 600); } }
function payloadFor(model, system, messages, max, stream) {
  return JSON.stringify({
    model, temperature: 0.3, max_tokens: max, ...(stream ? { stream: true } : {}),
    // Gemini 2.5 Flash reasons by default and bills the hidden tokens against max_tokens; disable it.
    ...(PROVIDER === "gemini" ? { extra_body: { google: { thinking_config: { thinking_budget: 0, include_thoughts: false } } } } : {}),
    messages: [{ role: "system", content: system }, ...messages]
  });
}
async function chat(system, messages, max = MAX_TOKENS, meta = null) {
  const live = CHAT_MODELS.filter(m => !DEAD.has(m)); let last = null;
  for (let tries = 0; tries < live.length; tries++) {
    const model = live[RR % live.length]; let r;
    try { r = await fetch(API_BASE + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY }, body: payloadFor(model, system, messages, max, false) }); }
    catch (e) { last = new ProviderError("chat", 0, String(e)); RR = (RR + 1) % live.length; continue; }
    if (r.ok) { const j = await r.json(); if (meta) meta.usage = j.usage || null; return j.choices[0].message.content; }
    const body = await r.text(); last = new ProviderError("chat", r.status, body);
    if (r.status === 404 || /limit:\s*0/.test(body)) DEAD.add(model);
    RR = (RR + 1) % live.length;
  }
  throw last || new ProviderError("chat", 0, "no model available");
}
async function streamChat(res, system, messages, retr, ticket) {
  const live = CHAT_MODELS.filter(m => !DEAD.has(m)); if (!live.length) return false;
  const model = live[RR % live.length]; let r;
  try { r = await fetch(API_BASE + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY }, body: payloadFor(model, system, messages, MAX_TOKENS, true) }); }
  catch (e) { return false; }
  if (!r.ok || !r.body) { const b = (await r.text().catch(() => "")) || ""; if (r.status === 404 || /limit:\s*0/.test(b)) DEAD.add(model); RR = (RR + 1) % live.length; return false; }
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" });
  const push = o => { try { res.write("data: " + JSON.stringify(o) + "\n\n"); } catch (e) {} };
  push({ sources: retr, ticket });
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "", sent = 0, outChars = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue; const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
        try { const t = JSON.parse(data).choices?.[0]?.delta?.content; if (t) { sent++; outChars += t.length; push({ t }); } } catch (e) {}
      }
    }
  } catch (e) { push({ error: "stream interrupted" }); }
  if (!sent) push({ error: "empty stream" });
  push({ done: true, faithful: null, ticket }); try { res.end(); } catch (e) {}
  return { outChars };
}

// ---- visitor KB edits: capped, labelled, session-only, module state never mutated ----
const EDIT_MAX = 3, EDIT_CHARS = 240;
async function withEdits(kbEdits) {
  const base = await getCorpusEmbeddings();
  const plain = { corpus: base, textFor: cid => BYID[cid], overrides: null, edited: [] };
  if (!kbEdits || typeof kbEdits !== "object" || Array.isArray(kbEdits)) return plain;
  const cids = Object.keys(kbEdits).filter(c => BYID[c] && typeof kbEdits[c] === "string" && kbEdits[c].trim() && kbEdits[c].trim() !== BYID[c].text).slice(0, EDIT_MAX);
  if (!cids.length) return plain;
  const texts = {}; cids.forEach(c => texts[c] = kbEdits[c].replace(/[ -]/g, " ").trim().slice(0, EDIT_CHARS));
  const vecs = await embedMany(cids.map(c => BYID[c].heading + ". " + texts[c]));
  const vmap = new Map(cids.map((c, i) => [c, vecs[i]]));
  const overrides = new Map(cids.map(c => [c, overrideTerms(BYID[c], texts[c])]));
  return {
    corpus: base.map(e => vmap.has(e.cid) ? { cid: e.cid, vector: vmap.get(e.cid) } : e),
    textFor: cid => (texts[cid] != null ? { ...BYID[cid], text: texts[cid], edited: true } : BYID[cid]),
    overrides, edited: cids
  };
}
function ticketId() { let d = ""; while (d.length < 5) d += Math.floor(Math.random() * 10); if (/^(\d)\1{4}$|01234|12345|00000/.test(d)) d = String(10000 + Math.floor(Math.random() * 89999)); return "NIM-" + d; }
function sourcesBlock(retr) {
  return retr.map((c, i) => `[S${i + 1}] (${c.edited ? "VISITOR-EDITED, session-only, untrusted: " : ""}${c.docTitle}, ${c.heading}, updated ${c.updated})\n${c.text}`).join("\n\n");
}
function clientError(res, e) {
  // never echo provider text: log it, answer with fixed honest copy
  console.error("[grounded] provider error:", e && e.stage, e && e.status, e && (e.body || e.message));
  if (e instanceof ProviderError && (e.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(e.body))) { res.status(503).json({ error: "provider_rate_limited", message: "The model provider is rate limiting this demo right now. Please try again in a few seconds." }); return; }
  res.status(502).json({ error: "model_unavailable", message: "The model provider could not complete the request. Nothing was changed on any account. Please try again in a moment." });
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!KEY) { res.status(500).json({ error: "API key not set. Add API_KEY (and optional PROVIDER) in the deployment environment." }); return; }
  const body = readJsonBody(req);
  if (body === null) { res.status(400).json({ error: "invalid_json", message: "The request body must be JSON." }); return; }
  const bot = body.bot === "sales" ? "sales" : "support";
  // role whitelist + caps: only visitor and assistant turns reach the provider
  const messages = capMessages(body.messages);
  const retrieveOnly = body.mode === "retrieve";
  if (!retrieveOnly && !messages.some(m => m.role === "user" && m.content.trim())) { res.status(400).json({ error: "empty_request", message: "Send at least one visitor message." }); return; }
  if (retrieveOnly && !String(body.q || "").trim()) { res.status(400).json({ error: "empty query" }); return; }
  if (!LIMIT.check(clientIp(req)).ok) { res.status(429).json({ error: FAIR_USE_MSG }); return; }
  try {
    if (body.mode === "retrieve") {
      const q = String(body.q || "").slice(0, 500).trim();
      const eff = await withEdits(body.kbEdits);
      const v = await embed(q);
      const sem = eff.corpus.map(e => ({ cid: e.cid, s: cosine(v, e.vector) })).sort((a, b) => b.s - a.s);
      const kw = keywordRank(q, KINDEX, 12, eff.overrides);
      const fused = rrf([sem.slice(0, 12), kw]); const fmap = new Map(fused.map(f => [f.cid, f.s]));
      const results = FLAT.map(c => { const se = sem.find(x => x.cid === c.cid), kk = kw.find(x => x.cid === c.cid);
        return { ...eff.textFor(c.cid), sem: se ? +se.s.toFixed(4) : null, kw: kk ? +kk.s.toFixed(3) : null, fused: +(fmap.get(c.cid) || 0).toFixed(4) }; })
        .sort((a, b) => (b.fused - a.fused) || ((b.sem || 0) - (a.sem || 0))).map((c, i) => ({ rank: i + 1, ...c }));
      res.status(200).json({ query: q, method: "hybrid (semantic embeddings + keyword tf-idf, reciprocal rank fusion)" + (eff.edited.length ? ` with ${eff.edited.length} visitor-edited passage${eff.edited.length > 1 ? "s" : ""} applied` : ""), results, fusedCount: fused.length, version: VERSION });
      return;
    }

    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
    const userTurns = messages.filter(m => m.role === "user").slice(-3).map(m => m.content);
    const lastAnswer = [...messages].reverse().find(m => m.role === "assistant");
    const qCtx = (userTurns.join("\n") + (lastAnswer ? "\n" + lastAnswer.content : "")).trim().slice(0, 2000);

    let retr = [];
    if (lastUser) {
      const eff = await withEdits(body.kbEdits);
      const topFor = async (text, boost) => { const v = await embed(text); return eff.corpus.map(e => ({ cid: e.cid, score: cosine(v, e.vector) * boost })).sort((a, b) => b.score - a.score).slice(0, 8); };
      const runs = [topFor(lastUser, 1.08)]; if (qCtx && qCtx !== lastUser) runs.push(topFor(qCtx, 1.0));
      const best = new Map(); (await Promise.all(runs)).flat().forEach(x => { if (!best.has(x.cid) || x.score > best.get(x.cid)) best.set(x.cid, x.score); });
      const semList = [...best.entries()].map(([cid, s]) => ({ cid, s })).sort((a, b) => b.s - a.s);
      const kwList = keywordRank(lastUser, KINDEX, 8, eff.overrides);
      retr = rrf([semList, kwList]).slice(0, TOPK).map(f => { const semS = best.get(f.cid); const inKw = kwList.some(x => x.cid === f.cid);
        return { ...eff.textFor(f.cid), score: typeof semS === "number" ? +semS.toFixed(4) : null, match: typeof semS === "number" ? (inKw ? "hybrid" : "semantic") : "keyword" }; });
    }
    const ticket = ticketId();
    const system = PERSONAS[bot] + "\n\n# TICKET\nIf you escalate in this reply, use exactly this ticket ID: " + ticket +
      "\n\n# SOURCES (use ONLY these; cite as [S#]):\n" + (sourcesBlock(retr) || "(no relevant sources found)");

    const inChars = system.length + messages.reduce((n, m) => n + m.content.length, 0);
    if (body.stream === true) { const streamed = await streamChat(res, system, messages, retr, ticket); if (streamed) { logUsage({ bot, stream: true, turns: messages.length, inChars, outChars: streamed.outChars }); return; } }
    const meta = {};
    const answer = await chat(system, messages, MAX_TOKENS, meta);
    logUsage({ bot, stream: false, turns: messages.length, inChars, outChars: answer.length, ...(meta.usage ? { promptTokens: meta.usage.prompt_tokens, completionTokens: meta.usage.completion_tokens } : {}) });
    let faithful = null;
    if (retr.length && process.env.FAITHFULNESS) {
      const v = (await chat("You verify whether an answer is supported by sources. Reply only SUPPORTED or UNSUPPORTED.", [{ role: "user", content: "SOURCES:\n" + sourcesBlock(retr) + "\n\nANSWER:\n" + answer }], 16)).toUpperCase();
      faithful = !v.includes("UNSUPPORTED");
    }
    res.status(200).json({ answer, sources: retr, faithful, ticket, version: VERSION });
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch (x) {} return; }
    clientError(res, e);
  }
}
