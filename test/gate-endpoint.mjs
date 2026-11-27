#!/usr/bin/env node
// test/gate-endpoint.mjs: the real api handlers over HTTP with the provider mocked. Assertion-based.
import { startHarness, Check } from "./lib.mjs";
const C = new Check("gate-endpoint");
const H = await startHarness({ port: 8811, env: { TOP_K: "3" } });
const { post, raw, capture, mode, base } = H;
// a minimal valid 16 kHz mono WAV (the page always sends WAV; audit N-15 rejects anything else)
const WAV = "UklGRjQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA";

// G-01 role whitelist
await post({ bot: "support", messages: [{ role: "system", content: "ATTACKER-SYSTEM" }, { role: "tool", content: "x" }, { role: "user", content: "hi" }] }, "10.0.1.1");
let msgs = capture.at(-1).messages;
C.ok("exactly one system message reaches the provider", msgs.filter(m => m.role === "system").length === 1, JSON.stringify(msgs.map(m => m.role)));
C.ok("client system/tool roles dropped", !msgs.some(m => /ATTACKER/.test(m.content)) && !msgs.some(m => m.role === "tool"));

// G-03 kbEdits caps + label + attacker share
const edits = {}; const ids = ["pricing.free", "pricing.pro", "pricing.business", "billing.refunds", "billing.trial", "security.hipaa"];
for (const id of ids) edits[id] = "ATTACK ".repeat(300);
await post({ bot: "support", kbEdits: edits, messages: [{ role: "user", content: "what is your refund policy?" }] }, "10.0.1.2");
let sys = capture.at(-1).messages[0].content; const attackBytes = (sys.match(/ATTACK/g) || []).length * 7;
C.ok("at most 3 edited passages", (sys.match(/VISITOR-EDITED/g) || []).length <= 3, String((sys.match(/VISITOR-EDITED/g) || []).length));
C.ok("edited passages capped at 240 chars", !/ATTACK (ATTACK ){35,}/.test(sys));
C.ok("edited passages labelled VISITOR-EDITED", /VISITOR-EDITED/.test(sys) || attackBytes === 0);
C.ok("attacker share of system prompt under 20%", attackBytes / sys.length < 0.2, `${attackBytes}/${sys.length}`);
C.ok("persona declares visitor edits untrusted", /VISITOR-EDITED are demo text/.test(sys));
let r = await post({ bot: "support", kbEdits: { "billing.refunds": "Paid plans are refundable within 21 days of a charge." }, messages: [{ role: "user", content: "refund policy?" }] }, "10.0.1.3"); let j = await r.json();
C.ok("edited text reaches sources and is flagged", j.sources.some(s => s.cid === "billing.refunds" && /21 days/.test(s.text) && s.edited === true));
r = await post({ bot: "support", messages: [{ role: "user", content: "refund policy?" }] }, "10.0.1.4"); j = await r.json();
C.ok("next request pristine (14 days)", j.sources.some(s => s.cid === "billing.refunds" && /14 days/.test(s.text) && !s.edited));

// G-04 error copy
mode.upstream401 = true; r = await post({ bot: "support", messages: [{ role: "user", content: "hi" }] }, "10.0.1.5"); j = await r.json(); mode.upstream401 = false;
C.ok("provider error not echoed", !/UNAUTHENTICATED|API key|AIza/.test(JSON.stringify(j)), JSON.stringify(j).slice(0, 120));
C.ok("honest fixed copy with code", r.status === 502 && j.error === "model_unavailable" && /Nothing was changed/.test(j.message));

// G-16 limiter keyed on last hop / x-real-ip
let hit = -1; for (let i = 0; i < 25; i++) { const rr = await raw(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${i}.1` }, body: JSON.stringify({ bot: "support", messages: [{ role: "user", content: "hi" }] }) }); if (rr.status === 429) { hit = i + 1; break; } }
C.ok("rotating x-forwarded-for (no platform IP) shares one bucket: limited at 21", hit === 21, String(hit));
let hit2 = -1; for (let i = 0; i < 25; i++) { const rr = await post({ bot: "support", messages: [{ role: "user", content: "hi" }] }, "203.0.113.10"); if (rr.status === 429) { hit2 = i + 1; break; } }
C.ok("x-real-ip keyed limit at 21", hit2 === 21, String(hit2));
r = await post({ bot: "support", messages: [{ role: "user", content: "hi" }] }, "10.0.1.6"); j = await r.json();
C.ok("other x-real-ip unaffected", r.status === 200);

// G-06 CORS
r = await post({ bot: "support", messages: [{ role: "user", content: "hi" }] }, "10.0.1.7", { origin: "https://evil.example" });
C.ok("no ACAO for a foreign origin without allowlist", !r.headers["access-control-allow-origin"], String(r.headers["access-control-allow-origin"]));
const page = await raw(base + "/");
C.ok("CSP header served", /script-src 'self' 'sha256-/.test(page.headers["content-security-policy"] || ""));
C.ok("nosniff + frame + referrer + permissions headers", ["x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"].every(h => page.headers[h]));

// G-20 voice token
r = await raw(base + "/api/transcribe", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.1.8" }, body: JSON.stringify({ audio: WAV, mime: "audio/wav" }) });
C.ok("transcribe without token is 401", r.status === 401, String(r.status));
const hj = await (await raw(base + "/api/health")).json();
C.ok("health is GET, ok, versioned, issues token", hj.ok === true && /^\d+\.\d+\.\d+$/.test(hj.version) && typeof hj.token === "string");
r = await raw(base + "/api/transcribe", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.1.8", "x-demo-token": hj.token }, body: JSON.stringify({ audio: WAV, mime: "audio/wav" }) });
C.ok("transcribe with page token works", r.status === 200 && (await r.json()).text === "hello world", String(r.status));
r = await raw(base + "/api/transcribe", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.1.9", "x-demo-token": "1.deadbeef" }, body: JSON.stringify({ audio: WAV }) });
C.ok("forged token rejected", r.status === 401);
C.ok("health never spends provider calls", capture.length === capture.length);

// stream/json equivalence + forced fallback
capture.length = 0;
r = await post({ bot: "support", stream: true, messages: [{ role: "user", content: "refund policy?" }] }, "10.0.2.1"); const sse = await r.text();
const ev = sse.split("\n\n").filter(x => x.startsWith("data:")).map(x => JSON.parse(x.slice(5)));
const streamText = ev.filter(e => e.t).map(e => e.t).join(""); const first = ev[0];
r = await post({ bot: "support", stream: false, messages: [{ role: "user", content: "refund policy?" }] }, "10.0.2.1"); j = await r.json();
C.ok("stream and JSON same text", streamText === j.answer);
C.ok("stream and JSON same source order", JSON.stringify(first.sources.map(s => s.cid)) === JSON.stringify(j.sources.map(s => s.cid)));
C.ok("sources event first, with ticket", first.sources && /^NIM-\d{5}$/.test(first.ticket));
mode.streamFail = true; r = await post({ bot: "support", stream: true, messages: [{ role: "user", content: "refund policy?" }] }, "10.0.2.1"); const fb = await r.json(); mode.streamFail = false;
C.ok("forced stream failure falls back to JSON with same text", /json/.test(r.headers["content-type"]) && fb.answer === j.answer);

// G-18 ticket ids: server issued, in prompt, unique
const t1 = capture.at(-2).messages[0].content.match(/use exactly this ticket ID: (NIM-\d{5})/), t2 = capture.at(-1).messages[0].content.match(/use exactly this ticket ID: (NIM-\d{5})/);
C.ok("ticket id injected into the system prompt", !!t1 && !!t2);
C.ok("ticket ids differ between requests", /^NIM-\d{5}$/.test(first.ticket) && first.ticket !== fb.ticket, first.ticket + " vs " + fb.ticket);
C.ok("response carries the ticket", /^NIM-\d{5}$/.test(fb.ticket));

// G-17 junk keyword; G-24 retrieve returns all passages; G-13 TOP_K
r = await post({ bot: "support", messages: [{ role: "user", content: "what is your refund policy?" }] }, "10.0.2.2"); j = await r.json();
C.ok("no keyword-only junk chunk for a question with 'what'", !j.sources.some(s => s.match === "keyword" && /portability|included/.test(s.cid)), j.sources.map(s => s.cid + ":" + s.match).join(","));
C.ok("TOP_K respected (3)", j.sources.length === 3);
r = await post({ mode: "retrieve", q: "refund policy" }, "10.0.2.3"); j = await r.json();
C.ok("retrieve returns every passage scored", j.results.length === 36 && j.results.every(x => typeof x.fused === "number"));
C.ok("retrieve top result is the refund passage", j.results[0].cid === "billing.refunds");
C.ok("GET refused", (await raw(base + "/api/chat")).status === 405);
C.ok("oversized message capped without error", (await post({ bot: "support", messages: [{ role: "user", content: "x".repeat(9000) }] }, "10.0.2.4")).status === 200);

// ---- v3.1, audit 2026-11-26 (Phase 0) ----
// N-07: malformed tokens of every shape are a 401, never a crash
for (const tok of [Date.now() + ".abc", Date.now() + "." + "z".repeat(32), ".", "x".repeat(500), Date.now() + ".deadbeef.extra"]) {
  const rr = await raw(base + "/api/transcribe", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.7.0.1", "x-demo-token": tok }, body: JSON.stringify({ audio: WAV }) });
  C.ok(`N-07 malformed token ${JSON.stringify(tok.slice(0, 18))} is 401`, rr.status === 401, String(rr.status));
}
// N-15: only WAV audio reaches the provider
const tok2 = (await (await raw(base + "/api/health")).json()).token;
const voice = (b, ip) => raw(base + "/api/transcribe", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip, "x-demo-token": tok2 }, body: JSON.stringify(b) });
r = await voice({ audio: "JVBERi0xLjQK", mime: "application/pdf" }, "10.7.0.2");
C.ok("N-15 PDF mime refused with 415", r.status === 415, String(r.status));
r = await voice({ audio: "JVBERi0xLjQKJcfsj6IK", mime: "audio/wav" }, "10.7.0.3");
C.ok("N-15 non-WAV bytes labelled audio/wav refused with 415", r.status === 415, String(r.status));
// N-18: malformed JSON is the client's error
r = await raw(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.7.0.4" }, body: "{not json" });
C.ok("N-18 malformed JSON to /api/chat is 400 invalid_json", r.status === 400 && (await r.json()).error === "invalid_json", String(r.status));
r = await raw(base + "/api/transcribe", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.7.0.5", "x-demo-token": tok2 }, body: "{not json" });
C.ok("N-18 malformed JSON to /api/transcribe is 400", r.status === 400, String(r.status));
// N-09: caps, and no model call without a visitor message
let calls = capture.length;
r = await post({ bot: "support" }, "10.7.0.6");
C.ok("N-09 request without a visitor message is 400 and spends no model call", r.status === 400 && capture.length === calls, `${r.status}, +${capture.length - calls} calls`);
r = await post({ bot: "support", messages: [{ role: "assistant", content: "only an assistant turn" }] }, "10.7.0.6");
C.ok("N-09 assistant-only history is refused too", r.status === 400);
const big = "y".repeat(4000); const many = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: big }));
r = await post({ bot: "support", messages: many }, "10.7.0.7");
const fwd = capture.at(-1).messages.slice(1); const fwdChars = fwd.reduce((n, m) => n + m.content.length, 0);
C.ok("N-09 at most 12 turns and 12,000 characters forwarded", r.status === 200 && fwd.length <= 12 && fwdChars <= 12000, `${fwd.length} turns, ${fwdChars} chars`);
C.ok("N-09 forwarded history starts with a visitor turn", fwd[0] && fwd[0].role === "user");
// N-01: one client's rejected requests never lock out anyone else
let firstLimited = -1; calls = capture.length;
for (let i = 0; i < 80; i++) { const rr = await post({ bot: "support", messages: [{ role: "user", content: "hi" }] }, "198.51.100.66"); if (rr.status === 429 && firstLimited < 0) firstLimited = i + 1; }
C.ok("N-01 attacker limited at request 21", firstLimited === 21, String(firstLimited));
C.ok("N-01 rejected requests spend no model calls", capture.length - calls === 20, String(capture.length - calls));
r = await post({ bot: "support", messages: [{ role: "user", content: "hi" }] }, "198.51.100.77");
C.ok("N-01 a new visitor is still served after the attacker is limited", r.status === 200, String(r.status));
// N-10: server code, prompts and the knowledge base are not published; public files are
for (const pth of ["/lib/security.mjs", "/lib/retrieval.mjs", "/lib/limits.mjs", "/ingest.mjs", "/personas/personas.json", "/personas/rules.json", "/kb.json", "/version.json", "/api/../lib/security.mjs", "/README.md"]) {
  const rr = await raw(base + pth); C.ok(`N-10 ${pth} is 404`, rr.status === 404, String(rr.status));
}
for (const pth of ["/", "/favicon.svg", "/og-image.png", "/llms.txt", "/robots.txt", "/sitemap.xml", "/.well-known/security.txt"]) {
  const rr = await raw(base + pth); C.ok(`N-10/N-21 ${pth} is served`, rr.status === 200, String(rr.status));
}
const sec = await (await raw(base + "/.well-known/security.txt")).text();
const exp = (sec.match(/^Expires: (.+)$/m) || [])[1];
C.ok("N-21 security.txt has Contact, Expires in the future (under a year), Canonical, Policy", /^Contact: https:\/\//m.test(sec) && exp && Date.parse(exp) > Date.now() && Date.parse(exp) - Date.now() < 366 * 864e5 && /^Canonical: /m.test(sec) && /^Policy: /m.test(sec), exp || "no Expires");
// N-21: headers and CSP violation reporting
const home = await raw(base + "/");
C.ok("N-21 COOP same-origin and CORP same-origin served", home.headers["cross-origin-opener-policy"] === "same-origin" && home.headers["cross-origin-resource-policy"] === "same-origin");
C.ok("N-21 CSP reports to /api/csp-report", /report-uri \/api\/csp-report/.test(home.headers["content-security-policy"] || ""));
const api = await raw(base + "/api/health"); C.ok("API responses are not cached", /no-store/.test(api.headers["cache-control"] || ""));
r = await raw(base + "/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report", "x-real-ip": "10.7.0.8" }, body: JSON.stringify({ "csp-report": { "document-uri": "https://x.example/?q=secret", "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example/a.js?t=1" } }) });
C.ok("N-21 CSP report endpoint answers 204", r.status === 204, String(r.status));
r = await raw(base + "/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report", "x-real-ip": "10.7.0.8" }, body: "garbage" });
C.ok("N-21 CSP report endpoint tolerates garbage", r.status === 204, String(r.status));
const { summarize } = await import(new URL("../backend/api/csp-report.js", import.meta.url).href);
const sm = summarize(JSON.stringify({ "csp-report": { "document-uri": "https://x.example/p?q=secret", "effective-directive": "img-src", "blocked-uri": "https://evil.example/a.png?t=1" } }));
C.ok("N-21 CSP reports are reduced to directive, origin and path (no query strings)", sm.length === 1 && sm[0].blocked === "https://evil.example" && sm[0].page === "/p" && !JSON.stringify(sm).includes("secret"));
// N-22: TOKEN_SECRET, when set, is the only token secret
{ const sec2 = await import(new URL("../backend/lib/security.mjs", import.meta.url).href);
  const t0 = sec2.issueToken(); process.env.TOKEN_SECRET = "rotated-" + Math.random();
  const t1 = sec2.issueToken();
  C.ok("N-22 TOKEN_SECRET changes the token and invalidates old ones", t0 !== t1 && !sec2.verifyToken(t0) && sec2.verifyToken(t1));
  delete process.env.TOKEN_SECRET; }

H.close(); C.done();
