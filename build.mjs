#!/usr/bin/env node
// build.mjs: assembles the deployable page from single-source inputs. Deterministic: same inputs, same bytes.
//   src/index.template.html + kb.json + backend/personas/personas.json + backend/lib/retrieval.mjs
//   + version.json + findings.json + eval/results.json  ->  backend/index.html, backend/kb.json,
//   backend/vercel.json (CSP with per-script hashes), backend/version.json, FIXES-APPLIED-<date>.md
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
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- retrieval module injected verbatim (export keywords stripped) ----
const retrievalJs = R("backend/lib/retrieval.mjs").replace(/^export (const|function) /gm, "$1 ");

// ---- Tested page ----
const sevOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
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
<div class="xhead"><b>How it was tested, and what broke.</b> This demo was built AI-assisted; every behavior is specified, tested against a gold set, red-teamed, and explainable. On 2026-09-01 it went through a full audit (<a href="https://github.com/TC26-max/Service_Agents_Demo/blob/main/AUDIT-2026-09-01.md" target="_blank" rel="noopener">AUDIT-2026-09-01.md</a>): every finding below was reproduced by execution, and a probe script in the repo re-runs them all and fails while any still reproduces. Version ${esc(version.version)}, built ${esc(version.buildDate)}.</div>
${nums}
<div class="xhead">Retrieval numbers come from the shipped retriever module run over <code>eval/gold.json</code> at build time. The questions were written by the same person who tuned the retriever after reading the knowledge base, so they are an optimistic bound; a held-out protocol is described in the gold file. The hybrid number needs real embeddings and is measured with <code>npm run eval:live</code>.</div>
${fx.map(f => `<div class="find" id="${esc(f.id)}"><span class="sev ${esc(f.severity.toLowerCase())}">${esc(f.severity)}</span><b>${esc(f.id)}: ${esc(f.title)}</b><p>${esc(f.plain)}</p><span class="tn">${esc(f.technical)}</span><p><b>Before:</b> ${esc(f.before)} <b>After:</b> ${esc(f.after)} <b>Gate:</b> ${esc(f.gate)} <b>Status:</b> ${esc(f.status)}</p></div>`).join("\n")}
<div class="xhead">Deliberately still open: a live red-team pass on the v3.0 prompts, faithfulness and refusal numbers (needs a model budget), the held-out question set, and the live hybrid retrieval number.</div>`;

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
  "connect-src 'self'", "media-src 'self' blob:", "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
].join("; ");
const vercel = {
  "$schema": "https://openapi.vercel.sh/vercel.json",
  functions: {
    "api/chat.js": { includeFiles: "{kb*.json,personas/*.json,version.json}", maxDuration: 30 },
    "api/transcribe.js": { maxDuration: 30 },
    "api/health.js": { includeFiles: "version.json", maxDuration: 10 }
  },
  headers: [{ source: "/(.*)", headers: [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=()" }
  ] }]
};

W("backend/index.html", html);
W("backend/kb.json", JSON.stringify(kb, null, 2) + "\n");
W("backend/vercel.json", JSON.stringify(vercel, null, 2) + "\n");
W("backend/version.json", JSON.stringify({ version: version.version, buildDate: version.buildDate }, null, 2) + "\n");

// ---- FIXES-APPLIED (generated) ----
const fixes = `# FIXES APPLIED ${version.buildDate}: Grounded v${version.version}

Generated by build.mjs from findings.json, eval/results.json and version.json. Do not edit by hand.
Companion to AUDIT-2026-09-01.md. Every fix has a gate; \`npm test\` runs the build, the gates, the retrieval eval, and the audit probe (which must report zero reproduced findings).

## Numbers

- Findings: ${fx.length} (${fx.filter(f => f.status === "fixed").length} fixed, ${fx.filter(f => f.status !== "fixed").length} partially fixed or pending live verification)
- Keyword-path retrieval, in-sample-adjacent gold set (${kw ? kw.n : 0} targeted questions): recall@1 ${kw ? kw.recallAt1 : "n/a"}, recall@3 ${kw ? kw.recallAt3 : "n/a"} (vocabulary ${kw ? kw.byType.vocab.recallAt3 : "n/a"}, paraphrase ${kw ? kw.byType.paraphrase.recallAt3 : "n/a"}); out-of-scope abstained ${kw ? kw.misses.abstained + "/" + kw.misses.n : "n/a"}
- Hybrid retrieval: ${hy ? `recall@3 ${hy.recallAt3} measured live on ${hy.measuredOn}` : "not yet measured (run npm run eval:live with API_KEY)"}
- Inline scripts pinned in the CSP: ${hashes.length}

## Findings

| ID | Severity | Title | Before | After | Gate | Status |
|---|---|---|---|---|---|---|
${fx.map(f => `| ${f.id} | ${f.severity} | ${f.title} | ${f.before} | ${f.after} | ${f.gate} | ${f.status} |`).join("\n")}

## What changed, by area

- Backend: role whitelist, fixed error copy, capped and labelled visitor edits, TOP_K applied, limiter keyed on the platform client IP, server-issued ticket IDs, GET /api/health with the voice token, CORS allowlist, transcription token and lower ceiling, one shared retriever module.
- Page: chat-first phone layout, reply filed to the bot that asked, queued suggestions, hidden dead controls, demo-account card, completion-claim guard and Handed off badge, Escape and deep links, version stamp, sister-project link, X-ray with all 36 passages, Tested page.
- Repo: build.mjs (deterministic, CSP hashes), findings.json register, eval gold set and runner, four gates plus the audit probe under npm test, GitHub Actions, CHANGELOG, committed og-image generator, docs rewritten to match the code, dash sweep.

## Deliberately still open

- Live red-team pass on the v3.0 prompts (needs a model budget)
- Faithfulness and refusal numbers (the faithfulness checker exists behind FAITHFULNESS=1)
- Held-out question set written by a second person
- Live hybrid retrieval number
`;
W(`FIXES-APPLIED-${version.buildDate}.md`, fixes);
console.log(`built v${version.version}: backend/index.html (${html.length} bytes), ${hashes.length} inline scripts hashed, ${fx.length} findings rendered`);
