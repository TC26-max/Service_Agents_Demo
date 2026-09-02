#!/usr/bin/env node
// probe-2026-09-01.mjs: reproduces every finding in AUDIT-2026-09-01.md by execution.
// Exits non-zero while any finding still reproduces, so it doubles as the regression gate.
//
// Usage (from the repo root):   node probe-2026-09-01.mjs
// Optional: install Playwright to enable the browser probes (npm i playwright && npx playwright install chromium).
// No network access is needed: the real api handlers are mounted on a local HTTP server and the
// upstream provider is mocked with deterministic, meaning-correlated embeddings.

import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const BACKEND = path.join(ROOT, "backend");
const PORT = +(process.env.PROBE_PORT || 8797);
const findings = []; const solid = [];
const F = (id, title, reproduced, evidence) => { (reproduced ? findings : solid).push({ id, title, evidence }); };
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

// ---------------------------------------------------------------- static checks
const html = read("backend/index.html"); const chatSrc = read("backend/api/chat.js");
const dashFiles = {};
for (const f of walk(ROOT)) {
  if (!/\.(html|md|txt|js|mjs|json)$/.test(f) || /node_modules|\.git\//.test(f)) continue;
  const t = fs.readFileSync(f, "utf8"); const n = (t.match(/[\u2014\u2013]/g) || []).length; if (n) dashFiles[path.relative(ROOT, f)] = n;
}
const totalDashes = Object.values(dashFiles).reduce((a, b) => a + b, 0);
F("G-10", "em/en dashes present (standing rule)", totalDashes > 0, `${totalDashes} dashes in ${Object.keys(dashFiles).length} files; title has dash: ${/<title>[^<]*[\u2014\u2013]/.test(html)}`);

// 2026-09-01 v3.0 note: personas moved from api/chat.js into backend/personas/personas.json (single source); read either.
const personasFile = fs.existsSync(path.join(ROOT, "backend/personas/personas.json")) ? JSON.parse(read("backend/personas/personas.json")) : null;
const salesPersona = personasFile ? personasFile.sales : (chatSrc.match(/\bsales: "((?:[^"\\]|\\.)*)"/s) || [, ""])[1];
F("G-02", "deployed sales persona has no crisis clause", !/self-harm/i.test(salesPersona), `sales persona bytes=${salesPersona.length}; contains "self-harm": ${/self-harm/i.test(salesPersona)}`);

const designS = read("DESIGN-support-agent.md");
F("G-08a", "DESIGN docs claim the prompt is used verbatim", /used verbatim by the app/.test(designS), `DESIGN-support-agent.md contains "used verbatim by the app"; shipped support persona differs (see audit, similarity 0.03)`);
const readme = read("README.md");
F("G-08b", "README overstates: books a demo / every answer cited / RAG toggle / faithfulness / see every chunk",
  /books a demo|Every answer is|RAG on\/off toggle|faithfulness check|see every/.test(readme),
  `matches: ${["books a demo", "Every answer is", "RAG on/off toggle", "faithfulness check", "see every"].filter(s => readme.includes(s)).join(" | ")}`);
F("G-08c", "stale test reports (top-4 retrieval, Hugging Face Space, scripted transcripts marked pass)",
  /top-4/.test(read("LIVE-TEST-REPORT.md")) || /Hugging Face/.test(read("TEST-REPORT.md")),
  `LIVE-TEST-REPORT mentions top-4: ${/top-4/.test(read("LIVE-TEST-REPORT.md"))}; TEST-REPORT mentions Hugging Face: ${/Hugging Face/.test(read("TEST-REPORT.md"))}; TEST-REPORT says transcripts are "representative expected behavior": ${/representative expected behavior/.test(read("TEST-REPORT.md"))}`);
F("G-08d", "backend README contradicts code/gitignore (OpenAI embeddings, commit kb-embeddings.json)",
  /commit it/.test(read("backend/README.md")) && /kb-embeddings/.test(read(".gitignore")),
  `backend/README.md says "commit it" for kb-embeddings.json while .gitignore ignores it`);
F("G-09", "no tests, no root package.json test script, no CI in the repo",
  !fs.existsSync(path.join(ROOT, "package.json")) || !fs.existsSync(path.join(ROOT, ".github/workflows")),
  `root package.json: ${fs.existsSync(path.join(ROOT, "package.json"))}; .github/workflows: ${fs.existsSync(path.join(ROOT, ".github/workflows"))}; test files: ${walk(ROOT).filter(f => /test.*\.m?js$/.test(f) && !/node_modules/.test(f)).length}`);
F("G-13c", "TOP_K env var is read but never used (retrieval hard-codes slice(0, 3))", (chatSrc.match(/TOPK/g) || []).length === 1 && /slice\(0, 3\)/.test(chatSrc), `TOPK references: ${(chatSrc.match(/TOPK/g) || []).length}`);
// 2026-09-01 v3.0 note: the stopword list moved from api/chat.js into backend/lib/retrieval.mjs (shared retriever); read it from either.
const retrSrc = fs.existsSync(path.join(ROOT, "backend/lib/retrieval.mjs")) ? read("backend/lib/retrieval.mjs") : "";
const stop = ((chatSrc + "\n" + retrSrc).match(/const STOPW(?:ORDS)? = new Set\(\(?"(.*?)"/s) || [, ""])[1].replace(/"\s*\+\s*"/g, "").split(/\s+/);
const missing = ["what", "which", "does", "when", "where", "who", "why", "have", "has"].filter(w => !stop.includes(w));
F("G-17", "keyword ranker stopword list misses common question words", missing.length > 0, `missing: ${missing.join(", ")} (list has ${stop.length} words)`);
F("G-22", "no version stamp on the page, og-image generator not in repo, package version never bumped",
  !/data-version|id="version"/.test(html) || !walk(ROOT).some(f => /og-image.*\.(py|mjs|js)$/.test(f)),
  `version element: ${/data-version|id="version"/.test(html)}; og-image generator: ${walk(ROOT).some(f => /og-image.*\.(py|mjs|js)$/.test(f))}; backend/package.json version: ${JSON.parse(read("backend/package.json")).version}`);
F("G-23", "no cross-link to the sister project (Harlan & West)", !/Harlan/.test(html + readme), `"Harlan" in page or README: ${/Harlan/.test(html + readme)}`);
F("G-24", "X-ray copy promises every chunk, shows top 10", /see every/.test(readme) || /every chunk/.test(html), `README "see every": ${/see every/.test(readme)}`);
F("G-19", "no retrieval gold set or published retrieval number in the repo", !walk(ROOT).some(f => /gold|eval/i.test(path.basename(f)) && /\.(json|mjs|js)$/.test(f)), `gold/eval files: ${walk(ROOT).filter(f => /gold|eval/i.test(path.basename(f))).length}`);
const vercelCfg = JSON.parse(read("backend/vercel.json"));
F("G-06a", "no security headers configured (CSP, nosniff, frame-ancestors, referrer, permissions)", !vercelCfg.headers, `backend/vercel.json headers key: ${!!vercelCfg.headers}`);
F("G-14", "identity gate demo values not discoverable on the page", !/acme-co|owner@/.test(html.replace(/<script[^>]*type="application\/json"[\s\S]*?<\/script>/, "")), `page mentions acme-co or owner@ outside the KB JSON: ${/acme-co|owner@/.test(html.replace(/<script[^>]*type="application\/json"[\s\S]*?<\/script>/, ""))}`);

// ---------------------------------------------------------------- real handlers over HTTP, provider mocked
process.env.PROVIDER = "gemini"; process.env.API_KEY = "AIzaPROBEKEY0000000000000"; process.env.CHAT_MODEL = "gemini-2.5-flash";
process.chdir(BACKEND);
const CAPTURE = []; const MODE = { upstream401: false };
const vec = t => { const s = String(t).toLowerCase(); return [s.includes("refund") ? 1 : 0.05, s.includes("slack") ? 1 : 0.05, s.includes("password") ? 1 : 0.05, 1]; };
globalThis.fetch = async (url, opts) => {
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  if (String(url).includes("/embeddings")) { const inp = body.input; return { ok: true, json: async () => ({ data: (Array.isArray(inp) ? inp : [inp]).map(t => ({ embedding: vec(t) })) }) }; }
  if (String(url).includes("/chat/completions")) {
    CAPTURE.push(body);
    if (MODE.upstream401) return { ok: false, status: 401, text: async () => '{"error":{"message":"API key not valid. key=AIzaPROBEKEY0000000000000","status":"UNAUTHENTICATED"}}' };
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Paid plans are refundable within 14 days [S1]." } }] }) };
  }
  if (String(url).includes("generateContent")) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "hello world" }] } }] }) };
  throw new Error("unmocked " + url);
};
const { default: chat } = await import(pathToFileURL(path.join(BACKEND, "api/chat.js")).href);
const { default: transcribe } = await import(pathToFileURL(path.join(BACKEND, "api/transcribe.js")).href);
const server = http.createServer(async (req, res) => {
  res.status = c => { res.statusCode = c; return res; }; res.json = o => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
  let raw = ""; for await (const ch of req) raw += ch; try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
  try { if (req.url === "/api/chat") await chat(req, res); else if (req.url === "/api/transcribe") await transcribe(req, res); else { res.statusCode = 404; res.end(); } }
  catch (e) { res.statusCode = 500; res.end(String(e)); }
}).listen(PORT);
// 2026-09-01 v3.0 note: ordinary probe requests now also carry x-real-ip (the platform-set header the limiter
// trusts); the G-16 rotation test below deliberately sends only the client-writable x-forwarded-for header.
const post = (body, ip) => globalThis.__realFetch(`http://localhost:${PORT}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, "x-real-ip": ip }, body: JSON.stringify(body) });
const postXffOnly = (body, ip) => globalThis.__realFetch(`http://localhost:${PORT}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
globalThis.__realFetch = (await import("node:http")) && ((url, opts) => new Promise((resolve, reject) => {
  const u = new URL(url); const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: opts.method || "GET", headers: opts.headers || {} }, res => { let b = ""; res.on("data", d => b += d); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: async () => b, json: async () => JSON.parse(b) })); }); r.on("error", reject); if (opts.body) r.write(opts.body); r.end(); }));

await post({ bot: "support", messages: [{ role: "system", content: "ATTACKER-SYSTEM" }, { role: "user", content: "hi" }] }, "10.0.0.1");
let msgs = CAPTURE[CAPTURE.length - 1].messages;
F("G-01", "client-supplied system-role messages are forwarded to the provider", msgs.some(m => m.role === "system" && /ATTACKER-SYSTEM/.test(m.content)), `roles forwarded: ${[...new Set(msgs.map(m => m.role))].join(",")}; attacker system message at index ${msgs.findIndex(m => /ATTACKER/.test(m.content))}`);

const ids = ["pricing.free", "pricing.pro", "pricing.business", "pricing.enterprise", "pricing.discounts", "billing.refunds", "billing.proration", "billing.invoices", "billing.trial", "billing.payment", "security.certs", "security.encryption", "security.hipaa", "security.residency", "security.access", "integrations.list", "integrations.connect", "integrations.slack", "integrations.api", "accounts.login", "accounts.sso", "accounts.roles", "accounts.ownership", "accounts.seats", "data.export", "data.portability", "data.deletion", "support.channels", "support.sla", "support.escalation", "support.status", "sales.differentiators", "sales.competitors", "sales.roi", "sales.fit", "sales.convert"];
const edits = {}; for (const id of ids) edits[id] = "ATTACK ".repeat(214).slice(0, 1500);
await post({ bot: "support", kbEdits: edits, messages: [{ role: "user", content: "refund policy?" }] }, "10.0.0.2");
const sys = CAPTURE[CAPTURE.length - 1].messages[0].content; const attackBytes = (sys.match(/ATTACK/g) || []).length * 7;
F("G-03", "attacker-controlled bytes in the system prompt via kbEdits, unlabelled", attackBytes / sys.length > 0.25 || !/visitor-edited|untrusted/i.test(sys), `${attackBytes} of ${sys.length} bytes (${Math.round(100 * attackBytes / sys.length)}%) attacker-controlled; labelled untrusted: ${/visitor-edited|untrusted/i.test(sys)}`);

MODE.upstream401 = true; let r = await post({ bot: "support", messages: [{ role: "user", content: "hi" }] }, "10.0.0.3"); let j = await r.json(); MODE.upstream401 = false;
F("G-04", "provider error body forwarded verbatim to the client", /UNAUTHENTICATED|API key not valid/.test(j.error || ""), `status ${r.status}; error contains provider text: ${/UNAUTHENTICATED/.test(j.error || "")}; contains key fragment: ${/AIzaPROBE/.test(j.error || "")}`);

let rot = -1; for (let i = 0; i < 25; i++) { const rr = await postXffOnly({ bot: "support", messages: [{ role: "user", content: "hi" }] }, "10.9." + i + ".1"); if (rr.status === 429) { rot = i; break; } }
F("G-16", "rate limit keyed on the first x-forwarded-for value (rotating header never limited)", rot === -1, `25 requests with rotating x-forwarded-for: 429 at ${rot === -1 ? "never" : rot + 1}`);

r = await post({ bot: "support", messages: [{ role: "user", content: "hi" }] }, "10.0.0.5");
F("G-06b", "CORS wildcard on the API", r.headers["access-control-allow-origin"] === "*", `access-control-allow-origin: ${r.headers["access-control-allow-origin"]}`);

r = await globalThis.__realFetch(`http://localhost:${PORT}/api/transcribe`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.6" }, body: JSON.stringify({ audio: "QUJD", mime: "audio/wav" }) });
F("G-20", "transcription endpoint usable anonymously as a speech-to-text service", r.status === 200, `anonymous POST /api/transcribe status ${r.status}`);

r = await post({ bot: "support", messages: [{ role: "user", content: "what is your refund policy?" }] }, "10.0.0.7"); j = await r.json();
F("G-17b", "keyword-only junk chunk enters top-3 because question words are not stopwords", j.sources.some(s => s.match === "keyword" && /portability|included/.test(s.cid + s.heading)), `top-3: ${j.sources.map(s => s.cid + "(" + s.match + ")").join(", ")}`);

// ---------------------------------------------------------------- browser probes (optional)
let pw = null; try { pw = await import("playwright"); } catch { try { pw = await import(pathToFileURL(path.join(ROOT, "node_modules/playwright/index.mjs")).href); } catch { } }
if (pw) {
  const staticRoot = BACKEND; const sPort = PORT + 1;
  const sServer = http.createServer((req, res) => { const p = req.url === "/" ? "/index.html" : req.url.split("?")[0]; const f = path.join(staticRoot, p); if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.setHeader("Content-Type", p.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream"); return res.end(fs.readFileSync(f)); } res.statusCode = 404; res.end(); }).listen(sPort);
  const browser = await pw.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-proxy-server"] });
  const stub = async (w = 1280, h = 800) => { const c = await browser.newContext({ viewport: { width: w, height: h } }); await c.addInitScript(() => { window.__replies = []; window.cowork = { askClaude: async p => { const d = window.__delay || 0; if (d) await new Promise(r => setTimeout(r, d)); if (/SUPPORTED or UNSUPPORTED/.test(p)) return "SUPPORTED"; return window.__replies.shift() ?? "Default stub answer [S1]."; } }; }); return c; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  { const c = await stub(); const p = await c.newPage(); await p.goto(`http://localhost:${sPort}/`); await p.waitForSelector("#enterBtn");
    await p.evaluate(() => { document.getElementById("enterBtn").click(); window.__delay = 1200; window.__replies.push("Support answer that should stay in support [S1]."); const i = document.getElementById("input"); i.value = "refund?"; document.getElementById("send").click(); });
    await wait(300); await p.evaluate(() => selectBot("sales")); await wait(3500);
    const inSales = await p.evaluate(() => document.querySelector("#chat").innerText.includes("should stay in support"));
    await p.evaluate(() => selectBot("support")); const inSupport = await p.evaluate(() => document.querySelector("#chat").innerText.includes("should stay in support"));
    F("G-11", "answer arriving after a bot switch is misfiled into the other transcript", inSales && !inSupport, `shown in sales: ${inSales}; shown in support: ${inSupport}`);
    await c.close(); }
  { const c = await stub(); const p = await c.newPage(); await p.goto(`http://localhost:${sPort}/`); await p.waitForSelector("#enterBtn");
    await p.evaluate(() => { document.getElementById("enterBtn").click(); window.__delay = 1200; window.__replies.push("Slow [S1]."); const i = document.getElementById("input"); i.value = "first"; document.getElementById("send").click(); });
    await wait(200); const r2 = await p.evaluate(() => { const i = document.getElementById("input"); i.value = "draft I was typing"; document.querySelector("#trybox .trychip").click(); return i.value; });
    F("G-12", "clicking a sidebar suggestion while busy overwrites the visitor's draft and sends nothing", r2 !== "draft I was typing", `input after click: "${r2}"`);
    await c.close(); }
  { const c = await stub(); const p = await c.newPage(); await p.goto(`http://localhost:${sPort}/`); await p.waitForSelector("#enterBtn");
    const esc = await p.evaluate(async () => { document.getElementById("enterBtn").click(); window.__replies.push("Answer [S1]."); const i = document.getElementById("input"); i.value = "refund?"; document.getElementById("send").click(); await new Promise(r => setTimeout(r, 700)); const cite = document.querySelector("#chat .cite"); if (!cite) return null; cite.click(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await new Promise(r => setTimeout(r, 100)); return document.getElementById("drawer").classList.contains("open"); });
    F("G-21", "Escape does not close the source drawer", esc === true, `drawer open after Escape: ${esc}`);
    await c.close(); }
  { const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage(); await p.goto(`http://localhost:${sPort}/`); await p.waitForSelector("#enterBtn");
    const m = await p.evaluate(() => { document.getElementById("enterBtn").click(); const chat = document.querySelector(".chatcard").getBoundingClientRect(); return { chatTop: Math.round(chat.top), innerHeight }; });
    F("G-07", "phone first screen has no chat (chat far below the fold)", m.chatTop > m.innerHeight, `chat top at ${m.chatTop}px on a ${m.innerHeight}px viewport`);
    await c.close(); }
  await browser.close(); sServer.close();
} else { console.log("(Playwright not installed: skipping browser probes G-07, G-11, G-12, G-21; install with npm i playwright && npx playwright install chromium)"); }
server.close();

// ---------------------------------------------------------------- report
console.log("\nREPRODUCED FINDINGS: " + findings.length);
for (const f of findings) console.log(`  [${f.id}] ${f.title}\n        ${f.evidence}`);
console.log("\nNOT REPRODUCED (fixed or not applicable): " + solid.length);
for (const s of solid) console.log(`  [${s.id}] ${s.title}`);
console.log("\nLive-only findings not covered here (need the deployed model): G-15 over-escalation of informational questions and discount over-extension, G-18 repeating ticket IDs.");
process.exit(findings.length ? 1 : 0);

function walk(d) { let out = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/node_modules|\.git$/.test(e.name)) out = out.concat(walk(p)); } else out.push(p); } return out; }
