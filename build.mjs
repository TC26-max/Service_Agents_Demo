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
    "api/csp-report.js": { maxDuration: 5 },
    "api/arena.js": { includeFiles: "{kb.json,personas/*.json,version.json}", maxDuration: 30 },
    "api/trap.js": { includeFiles: "public/404.html", maxDuration: 5 }
  },
  // v3.4 (Phase 3): paths only scanners ask for land in the honeypot, which answers like any missing page
  rewrites: [["/wp-login.php", "wp-login"], ["/wp-admin/:path*", "wp-admin"], ["/xmlrpc.php", "xmlrpc"], ["/.env", "env"], ["/phpmyadmin/:path*", "phpmyadmin"]]
    .map(([source, from]) => ({ source, destination: `/api/trap?from=${from}` })),
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

// ---- v3.4 (Phase 3): the security page, rendered from security.json; its headers table is read from the
// same configuration as vercel.json, so the page cannot drift from what the platform sends ----
const sec = JSON.parse(R("security.json"));
const hdrs = vercel.headers[0].headers;
const tr = cells => "<tr>" + cells.map((c, i) => i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`).join("") + "</tr>";
const securityHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Security · Grounded</title>
<meta name="description" content="Threat model, headers, OWASP Top 10 for LLM Applications 2026, MITRE ATLAS and CIS Controls v8.1 coverage, and disclosure for the Grounded demo."/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<style>
@font-face{font-family:"Archivo Grounded";src:url(/fonts/archivo-display.woff2) format("woff2");font-weight:600 800;font-stretch:75% 100%;font-display:swap}
@font-face{font-family:"JetBrains Mono Grounded";src:url(/fonts/jetbrains-mono-500.woff2) format("woff2");font-weight:500;font-display:swap}
:root{color-scheme:light dark;--bg:#f7f8fc;--panel:#fff;--ink:#0f172a;--muted:#475569;--line:#e2e6ef;--accent:#1d4ed8;--ok:#15803d;--warn:#b45309;--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--display:"Archivo Grounded",var(--font);--mono:"JetBrains Mono Grounded",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--panel:#111a2e;--ink:#e7edf7;--muted:#a8b5c8;--line:#24324d;--accent:#93b0ff;--ok:#34d399;--warn:#f5a623}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--font)}
main{max-width:980px;margin:0 auto;padding:28px 20px 60px}
a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
h1,h2{font-family:var(--display);font-stretch:85%;line-height:1.1;letter-spacing:-.2px}
h1{font-size:40px;margin:14px 0 8px}h2{font-size:24px;margin:34px 0 10px}h3{font-size:15px;margin:18px 0 6px}
.lede{font-size:17px;color:var(--muted);max-width:760px}
.back{display:inline-block;font-size:14px;font-weight:600;min-height:44px;line-height:44px}
nav.toc{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:14px;margin:14px 0 6px}
nav.toc a{min-height:44px;display:inline-flex;align-items:center}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:14px}
caption{text-align:left;padding:10px 12px;font-weight:600;color:var(--muted)}
th,td{text-align:left;vertical-align:top;padding:9px 12px;border-top:1px solid var(--line)}
thead th{border-top:0;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}
tbody th{font-weight:600;white-space:nowrap}
code,.mono{font-family:var(--mono);font-size:12.5px;overflow-wrap:anywhere}
ul{padding-left:20px}li{margin:3px 0}
.note{font-size:13px;color:var(--muted)}
.card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:12px 16px}
footer{margin-top:40px;font-size:13px;color:var(--muted)}
@media(max-width:640px){h1{font-size:31px}tbody th{white-space:normal}}
</style>
</head>
<body>
<main id="main">
<a class="back" href="/">Back to the demo</a>
<h1>Security</h1>
<p class="lede">${esc(sec.summary)}</p>
<nav class="toc" aria-label="On this page"><a href="#threats">Threat model</a><a href="#headers">Headers</a><a href="#owasp">OWASP 2026</a><a href="#atlas">MITRE ATLAS</a><a href="#cis">CIS Controls</a><a href="#deps">Dependency watch</a><a href="#arena">Red Team Arena</a><a href="#disclosure">Disclosure</a><a href="#sources">Sources</a></nav>

<h2 id="threats">Threat model</h2>
<div class="wrap"><table><caption>What is worth protecting, what threatens it, and what stops it</caption><thead><tr><th scope="col">Asset</th><th scope="col">Risk</th><th scope="col">Controls</th></tr></thead><tbody>
${sec.assets.map(a => tr([esc(a.name), esc(a.risk), esc(a.controls)])).join("\n")}
</tbody></table></div>
<h3>Who might attack</h3><ul>${sec.actors.map(a => `<li>${esc(a)}</li>`).join("")}</ul>
<h3>Entry points</h3><ul>${sec.entryPoints.map(a => `<li>${esc(a)}</li>`).join("")}</ul>
<h3>Trust boundary</h3><p>${esc(sec.boundary)}</p>

<h2 id="headers">Headers on every response</h2>
<p>Generated by the build into <code>vercel.json</code> and read from the same place for this table. The script hashes in the policy pin the page's own inline scripts; nothing loads from another origin.</p>
<div class="wrap"><table><caption>HTTP response headers</caption><thead><tr><th scope="col">Header</th><th scope="col">Value</th></tr></thead><tbody>
${hdrs.map(h => tr([esc(h.key), `<span class="mono">${esc(h.value)}</span>`])).join("\n")}
<tr><th scope="row">Cache-Control (on /api)</th><td><span class="mono">no-store</span></td></tr>
</tbody></table></div>

<h2 id="owasp">OWASP Top 10 for LLM Applications 2026</h2>
<div class="wrap"><table><caption>All ten risks, how this demo handles each, and where it is tested</caption><thead><tr><th scope="col">Risk</th><th scope="col">Status</th><th scope="col">How</th><th scope="col">Tested</th></tr></thead><tbody>
${sec.owasp.map(o => tr([`${esc(o.id)} ${esc(o.name)}`, esc(o.status), esc(o.how), esc(o.tested)])).join("\n")}
</tbody></table></div>
<p class="note">Finding IDs (G-, N-) refer to the Tested page of the demo, which lists every finding with its fix and its gate.</p>

<h2 id="atlas">MITRE ATLAS techniques</h2>
<div class="wrap"><table><caption>Adversary techniques this demo is tested against</caption><thead><tr><th scope="col">Technique</th><th scope="col">Name</th><th scope="col">Where it is tested</th></tr></thead><tbody>
${sec.atlas.map(a => tr([`<span class="mono">${esc(a.id)}</span>`, esc(a.name), esc(a.where)])).join("\n")}
</tbody></table></div>
<p class="note">IDs checked against MITRE ATLAS and D3FEND technique pages in November 2026. ATLAS is revised every month, so IDs can move.</p>

<h2 id="cis">CIS Critical Security Controls v8.1</h2>
<div class="wrap"><table><caption>All 18 Controls, read for a serverless demo with no accounts</caption><thead><tr><th scope="col">Control</th><th scope="col">Status</th><th scope="col">How</th></tr></thead><tbody>
${sec.cis.map(c => tr([`${c.n}. ${esc(c.name)}`, esc(c.status), esc(c.how)])).join("\n")}
</tbody></table></div>

<h2 id="deps">Dependency watch</h2>
<div class="card"><p>A scheduled workflow (<code>.github/workflows/depwatch.yml</code>) reads <code>package-lock.json</code> and the workflow files every day, asks the OSV database for known advisories, follows each to its CVE record (the CNA's score first), and checks the CISA Known Exploited Vulnerabilities catalog and FIRST's EPSS exploit-probability score. A known-exploited issue, or a high-severity or likely-exploited issue in anything the site or its pipeline runs, fails the workflow; the workflow's badge in the README shows the latest result, and each run's summary lists every advisory it found. The deployed functions themselves have no npm dependencies.</p>
<p class="note">This product uses data from the NVD API but is not endorsed or certified by the NVD. The NVD is consulted only when a CVE record carries no score from its CNA or from CISA.</p></div>

<h2 id="arena">Red Team Arena</h2>
<p>Anyone can attack a sandboxed copy of the support assistant on <a href="/#arena">the Arena tab</a>: five levels mapped to the table above, each attempt judged twice by deterministic code, once on the model's raw reply and once on what reaches the screen. The scoreboard keeps counts only; nothing typed there is stored.</p>

<h2 id="disclosure">Disclosure</h2>
<div class="card"><p>Report security issues through GitHub's private vulnerability reporting: <a href="https://github.com/TC26-max/Service_Agents_Demo/security/advisories/new">open a private report</a>. The same address is in <a href="/.well-known/security.txt">security.txt</a>, and the full policy, with what is in scope and the safe harbor, is in <a href="https://github.com/TC26-max/Service_Agents_Demo/blob/main/SECURITY.md">SECURITY.md</a>.</p>
<p>Please do not load-test the live site or enter real personal or payment details. A win in the arena counts as a finding: send what you typed and when.</p></div>

<h2 id="sources">Sources</h2>
<ul>${sec.sources.map(s => `<li><a href="${esc(s.url)}">${esc(s.name)}</a></li>`).join("")}</ul>

<footer>Grounded v${esc(version.version)} · page updated ${esc(sec.updated)} · a portfolio demo of a fictional company; privately built for demonstration and portfolio purposes only.</footer>
</main>
</body>
</html>
`;
W("backend/public/security.html", securityHtml);
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

- v3.4 (AUDIT-2026-11-26, Phase 3): the Red Team Arena (five levels on OWASP LLM 2026 risks, judged twice by code, counts-only scoreboard, its own budget and kill switch), the security page (threat model, live headers, OWASP 2026, MITRE ATLAS, CIS Controls v8.1), a daily dependency watch (OSV, CVE, CISA KEV, FIRST EPSS), workflow actions pinned to commits, a honeypot and an optional http:BL signal.
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
