// One-time ingestion: embed every knowledge-base chunk and write kb-embeddings.json.
// Run locally before deploying:   OPENAI_API_KEY=sk-... npm run ingest
import fs from "node:fs";

const PRESETS = {
  openai:  { base: "https://api.openai.com/v1",                               embed: "text-embedding-3-small" },
  mistral: { base: "https://api.mistral.ai/v1",                               embed: "mistral-embed" },
  gemini:  { base: "https://generativelanguage.googleapis.com/v1beta/openai", embed: "gemini-embedding-001" }
};
const P = PRESETS[(process.env.PROVIDER || "openai").toLowerCase()] || PRESETS.openai;
const BASE = (process.env.API_BASE || P.base).replace(/\/$/, "");
const KEY = process.env.API_KEY || process.env.OPENAI_API_KEY || process.env.MISTRAL_API_KEY || process.env.GEMINI_API_KEY;
if (!KEY) { console.error("Set a key first, e.g.:  PROVIDER=mistral API_KEY=... npm run ingest"); process.exit(1); }
const MODEL = process.env.EMBED_MODEL || P.embed;

const KB = JSON.parse(fs.readFileSync("kb.json", "utf8"));
const flat = [];
for (const d of KB) for (const c of d.chunks) flat.push({ cid: c.id, text: c.heading + ". " + c.text });

async function embed(text) {
  const r = await fetch(BASE + "/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY },
    body: JSON.stringify({ model: MODEL, input: text })
  });
  if (!r.ok) throw new Error("embeddings " + r.status + " " + (await r.text()).slice(0, 160));
  return (await r.json()).data[0].embedding;
}

const out = [];
for (const f of flat) {
  out.push({ cid: f.cid, vector: await embed(f.text) });
  console.log("embedded", f.cid);
}
fs.writeFileSync("kb-embeddings.json", JSON.stringify(out));
console.log("Wrote kb-embeddings.json with", out.length, "vectors. Commit it and deploy.");
