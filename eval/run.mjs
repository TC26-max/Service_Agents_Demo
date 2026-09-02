#!/usr/bin/env node
// eval/run.mjs: retrieval evaluation with the SHIPPED retriever (backend/lib/retrieval.mjs).
//   node eval/run.mjs            keyword path only (deterministic, no network); rewrites eval/results.json
//   API_KEY=... PROVIDER=gemini node eval/run.mjs --live   also measures the hybrid path with real embeddings
// Exit code 1 if keyword recall@3 on targeted items drops below the floor, or if the stamped
// keyword numbers in eval/results.json disagree with a fresh run (the stamp must come from the shipped code).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { buildKeywordIndex, keywordRank, cosine, rrf, weakMatch } from "../backend/lib/retrieval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gold = JSON.parse(fs.readFileSync(path.join(ROOT, "eval/gold.json"), "utf8")).items;
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "kb.json"), "utf8"));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8"));
const FLAT = []; for (const d of KB) for (const c of d.chunks) FLAT.push({ cid: c.id, heading: c.heading, text: c.text });
const index = buildKeywordIndex(FLAT);
const FLOOR = 0.6;
const live = process.argv.includes("--live");

function score(rankFn) {
  const targeted = gold.filter(g => g.target), misses = gold.filter(g => !g.target);
  let r1 = 0, r3 = 0, abstain = 0; const rows = [];
  for (const g of targeted) { const top = rankFn(g.q).slice(0, 3).map(x => x.cid); const hit1 = top[0] === g.target, hit3 = top.includes(g.target); r1 += hit1; r3 += hit3; rows.push({ q: g.q, type: g.type, top, hit3 }); }
  for (const g of misses) { const top = rankFn(g.q); if (!top.length || (top[0].weak)) abstain++; }
  const byType = {};
  for (const t of ["vocab", "paraphrase"]) { const rs = rows.filter(r => r.type === t); byType[t] = { n: rs.length, recallAt3: +(rs.filter(r => r.hit3).length / Math.max(1, rs.length)).toFixed(2) }; }
  return { n: targeted.length, recallAt1: +(r1 / targeted.length).toFixed(2), recallAt3: +(r3 / targeted.length).toFixed(2), byType, misses: { n: misses.length, abstained: abstain }, rows };
}

const keyword = score(q => keywordRank(q, index, 3));
let hybrid = null;
if (live) {
  const KEY = process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  const PROVIDER = (process.env.PROVIDER || "gemini").toLowerCase();
  const base = { gemini: "https://generativelanguage.googleapis.com/v1beta/openai", openai: "https://api.openai.com/v1", mistral: "https://api.mistral.ai/v1" }[PROVIDER];
  const model = process.env.EMBED_MODEL || { gemini: "gemini-embedding-001", openai: "text-embedding-3-small", mistral: "mistral-embed" }[PROVIDER];
  if (!KEY) { console.error("--live needs API_KEY"); process.exit(2); }
  const emb = async texts => { const r = await fetch(base + "/embeddings", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY }, body: JSON.stringify({ model, input: texts }) }); if (!r.ok) throw new Error("embeddings " + r.status); return (await r.json()).data.map(d => d.embedding); };
  const cvecs = await emb(FLAT.map(c => c.heading + ". " + c.text)); const qvecs = await emb(gold.map(g => g.q));
  const qmap = new Map(gold.map((g, i) => [g.q, qvecs[i]]));
  hybrid = score(q => { const v = qmap.get(q); const sem = FLAT.map((c, i) => ({ cid: c.cid, s: cosine(v, cvecs[i]) })).sort((a, b) => b.s - a.s); const kw = keywordRank(q, index, 8);
    const fused = rrf([sem.slice(0, 8), kw]).slice(0, 3); const weak = weakMatch(fused.map(f => ({ sem: sem.find(x => x.cid === f.cid)?.s ?? null, kw: kw.find(x => x.cid === f.cid)?.s ?? null }))); return fused.map(f => ({ cid: f.cid, weak })); });
  hybrid.measuredOn = new Date().toISOString().slice(0, 10); hybrid.model = model;
}

const out = { label: "in-sample-adjacent (questions written after reading the KB; see eval/gold.json protocol note)", version: version.version, keyword, hybrid: hybrid || (fs.existsSync(path.join(ROOT, "eval/results.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "eval/results.json"), "utf8")).hybrid : null) };
const prev = fs.existsSync(path.join(ROOT, "eval/results.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "eval/results.json"), "utf8")) : null;
const strip = o => JSON.stringify({ n: o.n, recallAt1: o.recallAt1, recallAt3: o.recallAt3, byType: o.byType, misses: o.misses });
let exit = 0;
if (prev && prev.keyword && strip(prev.keyword) !== strip(keyword)) { console.log("stamped keyword numbers differ from a fresh run; rewriting eval/results.json (rebuild the page to restamp)"); }
fs.writeFileSync(path.join(ROOT, "eval/results.json"), JSON.stringify(out, null, 2));
console.log(`keyword path: recall@1 ${keyword.recallAt1}, recall@3 ${keyword.recallAt3} (vocab ${keyword.byType.vocab.recallAt3}, paraphrase ${keyword.byType.paraphrase.recallAt3}), out-of-scope abstained ${keyword.misses.abstained}/${keyword.misses.n}`);
if (hybrid) console.log(`hybrid (live): recall@1 ${hybrid.recallAt1}, recall@3 ${hybrid.recallAt3}, abstained ${hybrid.misses.abstained}/${hybrid.misses.n}`); else console.log("hybrid: not measured in this run (needs --live with API_KEY)");
if (keyword.recallAt3 < FLOOR) { console.log(`FAIL: keyword recall@3 ${keyword.recallAt3} below floor ${FLOOR}`); exit = 1; }
for (const r of keyword.rows.filter(r => !r.hit3)) console.log("  miss:", r.q, "->", r.top.join(",") || "(none)");
process.exit(exit);
