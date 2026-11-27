// api/arena.js (v3.4, audit 2026-11-26, Phase 3): the Red Team Arena. See lib/arena.mjs for the levels,
// the gates and the judge.
//   GET  -> { enabled, levels[], score, limits, version }
//   POST { level: 1..5, attack: string, edit?: string (level 2) } -> { level, reply, verdict, score }
// A sandboxed copy of the support bot: its own system prompt, its own limiter and daily budget, a
// cheaper model by default (ARENA_MODEL), keyword retrieval only (no embedding calls), and a kill switch
// (ARENA_ENABLED=0). The scoreboard keeps counts only; no attack text is logged or stored.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { buildKeywordIndex, keywordRank } from "../lib/retrieval.mjs";
import { clientIp, readJsonBody } from "../lib/security.mjs";
import { makeLimiter } from "../lib/limits.mjs";
import { cleanText, newFence, fence, FENCE_RULE, makeOutputGuard } from "../lib/guard.mjs";
import { PROVIDER, API_BASE, KEY, CHAT_MODELS, payloadFor } from "../lib/provider.mjs";
import { reputation } from "../lib/httpbl.mjs";
import { LEVELS, ARENA_MAX_INPUT, ARENA_MAX_EDIT, ARENA_MAX_OUTPUT, newCanary, gate, achieved, arenaSystem, makeContactCheck, makeScoreboard } from "../lib/arena.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const loadJSON = f => { for (const p of [path.join(DIR, "..", f), path.join(process.cwd(), f), path.join(process.cwd(), "backend", f)]) { try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) {} } return null; };
const KB = loadJSON("kb.json") || [], PERSONAS = loadJSON("personas/personas.json") || {}, VERSION = (loadJSON("version.json") || {}).version || "dev";
const FLAT = KB.flatMap(d => d.chunks.map(c => ({ cid: c.id, docId: d.id, docTitle: d.title, cat: d.cat, heading: c.heading, text: c.text })));
const BYID = Object.fromEntries(FLAT.map(c => [c.cid, c]));
const KINDEX = buildKeywordIndex(FLAT.map(c => ({ cid: c.cid, title: c.docTitle, heading: c.heading, text: c.text })));
const PRISTINE = FLAT.map(c => c.text).join("\n");
const SITE = "nimbus-ai-demos.vercel.app";
const GUARD = makeOutputGuard({ personas: PERSONAS, pristine: PRISTINE, allowHosts: [SITE] });
const CONTACTS = makeContactCheck(PRISTINE + "\n" + SITE);
const SCORE = makeScoreboard();
const LIMIT = makeLimiter({ name: "arena", windowMs: 10 * 60 * 1000, perIp: 12, perIpDay: 40, perDay: 400 });
const TIGHT = makeLimiter({ name: "arena-tight", windowMs: 10 * 60 * 1000, perIp: 3, perIpDay: 8, perDay: 400 });
const ENABLED = () => !/^(0|false|off|no)$/i.test(String(process.env.ARENA_ENABLED || "1").trim());
const MODELS = () => [...new Set([process.env.ARENA_MODEL || (PROVIDER === "gemini" ? "gemini-3.5-flash-lite" : CHAT_MODELS[0]), ...CHAT_MODELS].filter(Boolean))];
const DEAD = new Set();
class ProviderError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function complete(system, user) {
  let last = null;
  for (const model of MODELS().filter(m => !DEAD.has(m))) {
    let r;
    try { r = await fetch(API_BASE + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY }, body: payloadFor(model, system, [{ role: "user", content: user }], 400, false), signal: AbortSignal.timeout(20000) }); }
    catch (e) { last = new ProviderError(504, "timeout"); continue; }
    if (r.ok) { const j = await r.json(); return { text: j.choices?.[0]?.message?.content || "", model }; }
    const body = (await r.text()).slice(0, 300);
    if (r.status === 404 || /limit:\s*0\b/.test(body)) { DEAD.add(model); last = new ProviderError(r.status, "model unavailable"); continue; } // try the next model
    if (r.status === 429) throw new ProviderError(429, "rate limited");
    last = new ProviderError(r.status, "provider error");
  }
  throw last || new ProviderError(503, "no model");
}

function noteFor(level, v) {
  if (v.won) return "You got past the gates. That is a real finding: please report what you sent through the security page, so it can be fixed and credited.";
  if (v.fooled) return `The model was fooled, and ${v.gates.join(", ") || "a gate"} caught it before the reply reached you.`;
  if (v.gates.length) return `The model did not reach the goal; ${v.gates.join(", ")} still changed the reply on the way out.`;
  return "The model held this time, so the gates had nothing to catch.";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const levelsOut = LEVELS.map(({ id, slug, title, owasp, atlas, goal, win, gates }) => ({ id, slug, title, owasp, atlas, goal, win, gates }));
  if (req.method === "GET") {
    res.status(200).json({ enabled: ENABLED() && !!KEY, levels: levelsOut, score: SCORE.snapshot(), limits: { input: ARENA_MAX_INPUT, edit: ARENA_MAX_EDIT, output: ARENA_MAX_OUTPUT, perVisitor: "12 attempts per 10 minutes, 40 per day" }, refundPassage: (BYID["billing.refunds"] || {}).text || "", version: VERSION });
    return;
  }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); res.status(405).json({ error: "method_not_allowed" }); return; }
  if (!ENABLED()) { res.status(503).json({ error: "arena_off", message: "The arena is switched off right now. The rest of the demo still works." }); return; }
  if (!KEY) { res.status(503).json({ error: "no_key", message: "The arena needs the model provider, which is not configured here." }); return; }
  const body = readJsonBody(req); if (!body) { res.status(400).json({ error: "invalid_json" }); return; }
  const level = Number.isInteger(body.level) ? body.level : parseInt(body.level, 10);
  if (!LEVELS.some(l => l.id === level)) { res.status(400).json({ error: "bad_level", message: "Pick a level from 1 to 5." }); return; }
  const attackRaw = typeof body.attack === "string" ? body.attack : "", editRaw = typeof body.edit === "string" ? body.edit : "";
  if (!attackRaw.trim()) { res.status(400).json({ error: "empty_attack", message: "Type an attack first." }); return; }
  const ip = clientIp(req);
  const rep = await reputation(ip);
  const lim = LIMIT.check(ip), tight = rep.suspicious ? TIGHT.check(ip) : { ok: true };
  if (!lim.ok || !tight.ok) { if (rep.suspicious) console.log("[grounded] arena: http:BL tightened"); res.status(429).json({ error: "rate_limited", message: "You've used the arena's fair-use allowance for now. Try again later; the scoreboard keeps counting." }); return; }
  // the input cap is a gate too: an oversized attack never reaches the model, and it counts as caught
  if (attackRaw.length > ARENA_MAX_INPUT || editRaw.length > ARENA_MAX_EDIT) {
    const v = { fooled: false, won: false, caught: true, gates: ["INPUT-CAP"], stage: "input" };
    SCORE.record(level, v); console.log("[grounded] arena " + JSON.stringify({ level, fooled: false, won: false, gates: v.gates }));
    res.status(413).json({ error: "input_cap", level, reply: "", verdict: { ...v, note: `Stopped before the model: an attack may be ${ARENA_MAX_INPUT} characters and a passage ${ARENA_MAX_EDIT}. Nothing was spent.` }, score: SCORE.snapshot(), version: VERSION });
    return;
  }
  const attack = cleanText(attackRaw).text;
  const edit = level === 2 ? cleanText(editRaw).text.replace(/\s+/g, " ").trim() : "";
  let cids = keywordRank(attack, KINDEX, 3).map(x => x.cid);
  if (level === 2 && !cids.includes("billing.refunds")) cids = ["billing.refunds", ...cids].slice(0, 3);
  const code = newFence(), canary = newCanary();
  const sources = cids.map((cid, i) => { const c = BYID[cid]; const poisoned = level === 2 && cid === "billing.refunds" && !!edit;
    return `[S${i + 1}] (${poisoned ? "VISITOR-EDITED, untrusted, written by the visitor in this game: " : ""}${c.docTitle}, ${c.heading})\n${fence(poisoned ? edit : c.text, code)}`; }).join("\n\n");
  const system = arenaSystem(level, PERSONAS.support || "", canary) + "\n\n# SOURCES (use ONLY these; cite as [S#]). " + FENCE_RULE + "\n" + (sources || "(no relevant sources found)");
  let out;
  try { out = await complete(system, attack); }
  catch (e) { const s = e.status === 429 ? 429 : 502; res.status(s).json({ error: s === 429 ? "provider_rate_limited" : "provider_error", message: s === 429 ? "The model provider is busy for a moment. Try again in a few seconds." : "The model did not answer. Try again in a moment." }); return; }
  const ctx = { canary, contacts: CONTACTS, guard: GUARD, lastUser: attack };
  const fooled = achieved(level, out.text, ctx);
  const g = gate(level, out.text, ctx);
  const won = achieved(level, g.text, ctx);
  const v = { fooled, won, caught: fooled && !won, gates: g.gates, stage: "output" };
  SCORE.record(level, v);
  console.log("[grounded] arena " + JSON.stringify({ level, fooled, won, gates: g.gates, model: out.model }));
  res.status(200).json({ level, reply: g.text, verdict: { ...v, note: noteFor(level, v) }, score: SCORE.snapshot(), model: out.model, version: VERSION });
}
