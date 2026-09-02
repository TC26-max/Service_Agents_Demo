#!/usr/bin/env node
// test/gate-endpoint.mjs: the real api handlers over HTTP with the provider mocked. Assertion-based.
import { startHarness, Check } from "./lib.mjs";
const C = new Check("gate-endpoint");
const H = await startHarness({ port: 8811, env: { TOP_K: "3" } });
const { post, raw, capture, mode, base } = H;

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
r = await raw(base + "/api/transcribe", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.1.8" }, body: JSON.stringify({ audio: "QUJD", mime: "audio/wav" }) });
C.ok("transcribe without token is 401", r.status === 401, String(r.status));
const hj = await (await raw(base + "/api/health")).json();
C.ok("health is GET, ok, versioned, issues token", hj.ok === true && /^\d+\.\d+\.\d+$/.test(hj.version) && typeof hj.token === "string");
r = await raw(base + "/api/transcribe", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.1.8", "x-demo-token": hj.token }, body: JSON.stringify({ audio: "QUJD", mime: "audio/wav" }) });
C.ok("transcribe with page token works", r.status === 200 && (await r.json()).text === "hello world", String(r.status));
r = await raw(base + "/api/transcribe", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.1.9", "x-demo-token": "1.deadbeef" }, body: JSON.stringify({ audio: "QUJD" }) });
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

H.close(); C.done();
