#!/usr/bin/env node
// build.mjs: assembles the deployable page from single-source inputs. Deterministic: same inputs, same bytes.
//   src/index.template.html + kb.json + backend/personas/personas.json + backend/lib/retrieval.mjs
//   + version.json + findings.json + eval/results.json  ->  backend/public/index.html, backend/kb.json,
//   backend/vercel.json (CSP with per-script hashes), backend/version.json, FIXES-APPLIED-<date>.md
// Only backend/public/ is served as static files (audit N-10); server code, prompts and the knowledge
// base JSON stay beside the functions and are bundled into them, never published as URLs.
// Never hand-edit the generated files; edit the inputs and run `npm run build`.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const R = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const W = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);
const version = JSON.parse(R("version.json"));
const kb = JSON.parse(R("kb.json"));
const personas = JSON.parse(R("backend/personas/personas.json"));
const findings = JSON.parse(R("findings.json"));
const evalRes = fs.existsSync(path.join(ROOT, "eval/results.json")) ? JSON.parse(R("eval/results.json")) : null;
const replays = JSON.parse(R("redteam-replays.json")); // v3.3: the 16 live probes of the November audit
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- retrieval module injected verbatim (export keywords stripped) ----
const retrievalJs = R("backend/lib/retrieval.mjs").replace(/^export (const|function) /gm, "$1 ");

// ---- Tested page (v3.3: a case-file board with filters, and replay cards for the live probes) ----
const sevOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const stOf = f => f.status === "fixed" ? "fixed" : "pending";
const fx = [...findings.findings].sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || a.id.localeCompare(b.id));
const kw = evalRes && evalRes.keyword, hy = evalRes && evalRes.hybrid;
const nums = `<div class="nums">
  <div class="num"><b>${fx.length}</b>findings, ${fx.filter(f => f.status === "fixed").length} fixed</div>
  <div class="num"><b>${kw ? kw.recallAt3 : "n/a"}</b>keyword recall@3 (${kw ? kw.n : 0} questions, in-sample-adjacent)</div>
  <div class="num"><b>${kw ? kw.byType.paraphrase.recallAt3 : "n/a"}</b>keyword recall@3 on paraphrases</div>
  <div class="num"><b>${hy ? hy.recallAt3 : "not yet measured"}</b>hybrid recall@3${hy ? " (live, " + hy.measuredOn + ")" : " (needs a live key run)"}</div>
  <div class="num"><b>${kw ? kw.misses.abstained + "/" + kw.misses.n : "n/a"}</b>out-of-scope questions abstained (keyword path)</div>
</div>`;
const testedHtml = `
<div class="xhead"><b>How it was tested, and what broke.</b> This demo was built AI-assisted; every behavior is specified, tested against a gold set, red-teamed, and explainable. It has been through two full audits, on 2026-09-01 (<a href="https://github.com/TC26-max/Service_Agents_Demo/blob/main/AUDIT-2026-09-01.md" target="_blank" rel="noopener">G-01 to G-24</a>) and on 2026-11-26 (<a href="https://github.com/TC26-max/Service_Agents_Demo/blob/main/AUDIT-2026-11-26.md" target="_blank" rel="noopener">N-01 to N-24</a>, including a live red-team pass): every finding below was reproduced by execution, and probe scripts in the repo re-run them and fail if a fixed one comes back. Findings still open say which phase will close them. Version ${esc(version.version)}, built ${esc(version.buildDate)}.</div>
${nums}
<div class="xhead">Retrieval numbers come from the shipped retriever module run over <code>eval/gold.json</code> at build time. The questions were written by the same person who tuned the retriever after reading the knowledge base, so they are an optimistic bound; a held-out protocol is described in the gold file. The hybrid number needs real embeddings and is measured with <code>npm run eval:live</code>.</div>
<div class="cfbar" role="toolbar" aria-label="Filter the findings">
  <div class="grp"><span class="gl">Severity</span>${[["all", "All", fx.length], ...Object.keys(sevOrder).map(k => [k.toLowerCase(), k, fx.filter(f => f.severity === k).length])].filter(x => x[2]).map(([v, l, n]) => `<button type="button" data-f="sev" data-v="${v}" aria-pressed="${v === "all"}">${l} ${n}</button>`).join("")}</div>
  <div class="grp"><span class="gl">Status</span>${[["all", "Any"], ["fixed", "Fixed"], ["pending", "Pending"]].map(([v, l]) => `<button type="button" data-f="st" data-v="${v}" aria-pressed="${v === "all"}">${l} ${v === "all" ? fx.length : fx.filter(f => stOf(f) === v).length}</button>`).join("")}</div>
</div>
<p class="cfcount" aria-live="polite">Showing ${fx.length} of ${fx.length} findings</p>
<div class="cases">
${fx.map(f => `<article class="find" id="${esc(f.id)}" data-sev="${esc(f.severity.toLowerCase())}" data-st="${stOf(f)}"><header><span class="sev ${esc(f.severity.toLowerCase())}">${esc(f.severity)}</span><span class="cid">${esc(f.id)}</span><span class="stamp ${stOf(f)}">${stOf(f) === "fixed" ? "Fixed" : "Pending"}</span></header><h4>${esc(f.title)}</h4><p>${esc(f.plain)}</p><details><summary>Case notes</summary><span class="tn">${esc(f.technical)}</span><p><b>Before:</b> ${esc(f.before)} <b>After:</b> ${esc(f.after)} <b>Gate:</b> ${esc(f.gate)} <b>Status:</b> ${esc(f.status)}</p></details></article>`).join("\n")}
</div>
<section class="replays" aria-labelledby="replaysH"><h3 id="replaysH">Attack replays: the ${replays.replays.length} live probes of ${esc(replays.date)}</h3>
<div class="xhead">${replays.replays.length} probes ran against the deployed demo (${replays.replays.filter(r => r.channel === "chat").length} chat, ${replays.replays.filter(r => r.channel === "voice").length} voice): ${replays.replays.filter(r => r.verdict === "held").length} held and ${replays.replays.filter(r => r.verdict === "broke").length} broke. Attacks are described rather than quoted, replies are condensed, and quotation marks mark the bot's own words. Replay redraws a card; it makes no model call.</div>
<div class="rgrid">
${replays.replays.map(r => `<article class="rcard" data-verdict="${esc(r.verdict)}"><header><span class="rv ${esc(r.verdict)}">${r.verdict === "held" ? "Held" : "Broke"}</span><span class="rid">#${String(r.n).padStart(2, "0")} · ${esc(r.channel)}</span><b>${esc(r.title)}</b><time datetime="${esc(replays.date)}">${esc(replays.date)}</time></header><div class="rlog"><p class="ra"><b>Attack</b>${esc(r.attack)}</p><p class="rr"><b>Reply</b>${esc(r.reply)}</p></div><p class="rfix"><b>Fix:</b> ${r.finding ? `<a href="#${esc(r.finding)}">${esc(r.finding)}</a>. ` : ""}${esc(r.fix)}</p><button type="button" class="rplay" aria-label="Replay probe ${r.n}, ${esc(r.title)}">Replay</button></article>`).join("\n")}
</div></section>
<div class="xhead">Deliberately still open: live reruns of the prompt-level fixes (N-05, N-17), owner steps in the Vercel and Google dashboards (N-03, N-13, N-22), faithfulness and refusal numbers (needs a model budget), the held-out question set, and the live hybrid retrieval number.</div>`;

// ---- page ----
let html = R("src/index.template.html")
  .replace("{{KB_JSON}}", JSON.stringify(kb))
  .replace("{{SYS_SUPPORT}}", personas.support.replace(/<\/script/gi, "<\\/script"))
  .replace("{{SYS_SALES}}", personas.sales.replace(/<\/script/gi, "<\\/script"))
  .replace("{{RETRIEVAL_JS}}", retrievalJs)
  .replace("{{TESTED_HTML}}", testedHtml)
  .replace(/\{\{SISTER_URL\}\}/g, version.sisterUrl)
  .replace(/\{\{VERSION\}\}/g, version.version)
  .replace(/\{\{BUILD_DATE\}\}/g, version.buildDate);
const leftover = html.match(/\{\{[A-Z_]+\}\}/g); if (leftover) throw new Error("unfilled placeholders: " + leftover.join(","));

// ---- CSP: hash every inline script that the browser will execute ----
const hashes = [];
for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  const attrs = m[1] || ""; if (/\bsrc=/.test(attrs) || (/type=/.test(attrs) && !/javascript/.test(attrs))) continue;
  hashes.push("'sha256-" + crypto.createHash("sha256").update(m[2], "utf8").digest("base64") + "'");
}
const csp = [
  "default-src 'self'", `script-src 'self' ${hashes.join(" ")}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  "connect-src 'self'", "media-src 'self' blob:", "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  "report-uri /api/csp-report"
].join("; ");
const vercel = {
  "$schema": "https://openapi.vercel.sh/vercel.json",
  outputDirectory: "public",
  functions: {
    "api/chat.js": { includeFiles: "{kb*.json,personas/*.json,version.json}", maxDuration: 30 },
    "api/transcribe.js": { maxDuration: 30 },
    "api/health.js": { includeFiles: "version.json", maxDuration: 10 },
    "api/csp-report.js": { maxDuration: 5 }
  },
  headers: [
    { source: "/(.*)", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" }
    ] },
    { source: "/api/(.*)", headers: [{ key: "Cache-Control", value: "no-store" }] }
  ]
};

W("backend/public/index.html", html);
W("backend/kb.json", JSON.stringify(kb, null, 2) + "\n");
W("backend/vercel.json", JSON.stringify(vercel, null, 2) + "\n");
W("backend/version.json", JSON.stringify({ version: version.version, buildDate: version.buildDate }, null, 2) + "\n");

// ---- FIXES-APPLIED (generated) ----
const fixes = `# FIXES APPLIED ${version.buildDate}: Grounded v${version.version}

Generated by build.mjs from findings.json, eval/results.json and version.json. Do not edit by hand.
Companion to AUDIT-2026-09-01.md and AUDIT-2026-11-26.md. Every fix has a gate; \`npm test\` runs the build, the gates, the retrieval eval, and both audit probes (the September probe must report zero; the November probe fails if any finding not scheduled for a later phase reproduces).

## Numbers

- Findings: ${fx.length} (${fx.filter(f => f.status === "fixed").length} fixed, ${fx.filter(f => /^open/.test(f.status)).length} open and scheduled, ${fx.filter(f => f.status !== "fixed" && !/^open/.test(f.status)).length} partially fixed or pending live verification or an owner step)
- Keyword-path retrieval, in-sample-adjacent gold set (${kw ? kw.n : 0} targeted questions): recall@1 ${kw ? kw.recallAt1 : "n/a"}, recall@3 ${kw ? kw.recallAt3 : "n/a"} (vocabulary ${kw ? kw.byType.vocab.recallAt3 : "n/a"}, paraphrase ${kw ? kw.byType.paraphrase.recallAt3 : "n/a"}); out-of-scope abstained ${kw ? kw.misses.abstained + "/" + kw.misses.n : "n/a"}
- Hybrid retrieval: ${hy ? `recall@3 ${hy.recallAt3} measured live on ${hy.measuredOn}` : "not yet measured (run npm run eval:live with API_KEY)"}
- Inline scripts pinned in the CSP: ${hashes.length}

## Findings

| ID | Severity | Title | Before | After | Gate | Status |
|---|---|---|---|---|---|---|
${fx.map(f => `| ${f.id} | ${f.severity} | ${f.title} | ${f.before} | ${f.after} | ${f.gate} | ${f.status} |`).join("\n")}

## What changed, by area

- v3.3 (AUDIT-2026-11-26, Phase 2): the visual layer, with every animation listed in MOTION.md and one motion switch; the X-ray lens on the intro, the passage field, the embedding map and the latency HUD in the Retrieval X-ray, citation previews and the chip-to-drawer morph, the handbook, the case-file board with replays of the 16 live probes; self-hosted fonts and SVG icons; first load at most 100 KB compressed (gate-weight) and a Lighthouse budget in CI.
- v3.2 (AUDIT-2026-11-26, Phase 1): guard layer (lib/guard.mjs): invisible-character stripping and NFKC; signed assistant turns; fenced passages with a per-request code; output rules for card and credential requests, unknown contacts, card-like numbers, prompt recitation, images and the student discount; edits answered as checked JSON with a Uses your edit tag and the original passage in the drawer; plural stemming and guarded fusion; model-aware requests, a deep health canary and a daily canary workflow.
- v3.1 (AUDIT-2026-11-26, Phase 0): limiter counts accepted requests only with a per-visitor daily share; request caps and no model call without a visitor message; malformed tokens and JSON answered as client errors; WAV-only voice; TOKEN_SECRET; only backend/public is served; security.txt, robots, sitemap, 404 page, CSP reporting, COOP and CORP; privacy note and example contact details; contrast tokens, inert intro, dialog drawer with focus return, phone composer in view with 44 px controls, landmarks and headings; citation lists; dead key code removed.
- Backend: role whitelist, fixed error copy, capped and labelled visitor edits, TOP_K applied, limiter keyed on the platform client IP, server-issued ticket IDs, GET /api/health with the voice token, CORS allowlist, transcription token and lower ceiling, one shared retriever module.
- Page: chat-first phone layout, reply filed to the bot that asked, queued suggestions, hidden dead controls, demo-account card, completion-claim guard and Handed off badge, Escape and deep links, version stamp, sister-project link, X-ray with all 36 passages, Tested page.
- Repo: build.mjs (deterministic, CSP hashes), findings.json register, eval gold set and runner, four gates plus the audit probe under npm test, GitHub Actions, CHANGELOG, committed og-image generator, docs rewritten to match the code, dash sweep.

## Deliberately still open

- Live reruns of the prompt-level fixes: N-05, N-17
- Owner steps: Gemini paid tier (N-03), switching CHAT_MODEL (N-13), TOKEN_SECRET (N-22), the Vercel WAF rule (N-01, recommended)
- Faithfulness and refusal numbers (the faithfulness checker exists behind FAITHFULNESS=1)
- Held-out question set written by a second person
- Live hybrid retrieval number
`;
W(`FIXES-APPLIED-${version.buildDate}.md`, fixes);
console.log(`built v${version.version}: backend/public/index.html (${html.length} bytes), ${hashes.length} inline scripts hashed, ${fx.length} findings rendered`);
