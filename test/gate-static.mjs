#!/usr/bin/env node
// test/gate-static.mjs: repo-wide invariants. Dashes, persona rules in every shipped prompt, docs that
// do not overstate, deterministic build, CSP hashes, attribution, versioning, evidence consistency.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { execFileSync } from "node:child_process";
import { ROOT, Check } from "./lib.mjs";
const C = new Check("gate-static");
const R = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const walk = d => { let out = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(node_modules|\.git|audit-evidence-[\d-]+|dist)$/.test(e.name)) out = out.concat(walk(p)); } else out.push(p); } return out; };
const textFiles = walk(ROOT).filter(f => /\.(html|md|txt|js|mjs|json|yml|yaml|py|css)$/.test(f));

// 1. no em or en dashes anywhere in the repo
const dashed = textFiles.filter(f => /[\u2014\u2013]/.test(fs.readFileSync(f, "utf8"))).map(f => path.relative(ROOT, f));
C.ok("no em/en dashes in any repo file", dashed.length === 0, dashed.slice(0, 6).join(", "));

// 2. persona rules present in personas.json and in the built page's fallback prompts
const rules = JSON.parse(R("backend/personas/rules.json")).rules; const personas = JSON.parse(R("backend/personas/personas.json"));
const built = R("backend/public/index.html");
const pageSupport = (built.match(/id="sys-support">([\s\S]*?)<\/script>/) || [, ""])[1], pageSales = (built.match(/id="sys-sales">([\s\S]*?)<\/script>/) || [, ""])[1];
for (const [name, re] of Object.entries(rules)) {
  const rx = new RegExp(re, "i");
  C.ok(`rule ${name} in support persona`, rx.test(personas.support)); C.ok(`rule ${name} in sales persona`, rx.test(personas.sales));
  C.ok(`rule ${name} in built page support prompt`, rx.test(pageSupport)); C.ok(`rule ${name} in built page sales prompt`, rx.test(pageSales));
}
C.ok("built page fallback prompts equal personas.json", pageSupport === personas.support && pageSales === personas.sales);
C.ok("no stale dates in personas", !/June 30/.test(personas.support + personas.sales));

// 3. the retriever in the page is the server module, verbatim
const mod = R("backend/lib/retrieval.mjs").replace(/^export (const|function) /gm, "$1 ");
C.ok("page contains the shared retriever verbatim", built.includes(mod));

// 4. docs must not overstate (audit G-08)
const readme = R("README.md");
for (const s of ["books a demo", "Every answer is grounded", "RAG on/off toggle", "faithfulness check", "see every chunk", "used verbatim"]) C.ok(`README does not say "${s}"`, !readme.includes(s));
for (const f of ["DESIGN-support-agent.md", "DESIGN-sales-chatbot.md"]) C.ok(`${f} marked historical, not verbatim`, /historical/i.test(R(f)) && !/used verbatim by the app/.test(R(f)));
C.ok("backend README does not say commit kb-embeddings", !/commit it/.test(R("backend/README.md")));
C.ok("LIVE-TEST-REPORT marked historical", /historical/i.test(R("LIVE-TEST-REPORT.md")));
C.ok("TEST-REPORT marked historical", /historical/i.test(R("TEST-REPORT.md")));

// 5. version stamp and health version match version.json
const ver = JSON.parse(R("version.json")).version;
C.ok("version stamped in page", built.includes(`data-version="${ver}"`) && built.includes(`<meta name="grounded-version" content="${ver}"/>`));
C.ok("backend/version.json matches", JSON.parse(R("backend/version.json")).version === ver);
C.ok("CHANGELOG mentions the version", R("CHANGELOG.md").includes(ver));

// 6. deterministic build: rebuild and compare bytes
const before = crypto.createHash("sha256").update(built).digest("hex") + crypto.createHash("sha256").update(R("backend/vercel.json")).digest("hex");
execFileSync(process.execPath, [path.join(ROOT, "build.mjs")], { stdio: "ignore" });
const after = crypto.createHash("sha256").update(R("backend/public/index.html")).digest("hex") + crypto.createHash("sha256").update(R("backend/vercel.json")).digest("hex");
C.ok("build is deterministic (byte-identical rebuild)", before === after);

// 7. CSP hashes match the built inline scripts
const vercel = JSON.parse(R("backend/vercel.json")); const csp = vercel.headers[0].headers.find(h => h.key === "Content-Security-Policy").value;
const want = [];
for (const m of R("backend/public/index.html").matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) { const a = m[1] || ""; if (/\bsrc=/.test(a) || (/type=/.test(a) && !/javascript/.test(a))) continue; want.push("'sha256-" + crypto.createHash("sha256").update(m[2], "utf8").digest("base64") + "'"); }
C.ok("CSP pins every inline script hash", want.length >= 3 && want.every(h => csp.includes(h)), `${want.length} scripts`);
C.ok("CSP has frame-ancestors none and no unsafe-inline scripts", /frame-ancestors 'none'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp));

// 8. attribution rule: pen name exactly once (cover byline), nowhere else; the account owner's real name nowhere.
// Both names are assembled at runtime so this file never contains them as literals.
const PEN = ["Emi" + "lio", "Rig" + "ales"].join(" "); const REAL = new RegExp("\\b" + String.fromCharCode(84, 111, 114, 105, 110) + "\\b", "i");
C.ok("pen name exactly once in the built page", built.split(PEN).length - 1 === 1);
const others = textFiles.filter(f => !f.endsWith(path.join("backend", "public", "index.html")) && !f.endsWith(path.join("src", "index.template.html")) && fs.readFileSync(f, "utf8").includes(PEN)).map(f => path.relative(ROOT, f));
C.ok("pen name in no other repo file", others.length === 0, others.join(", "));
C.ok("account owner's real name nowhere in the repo", !textFiles.some(f => REAL.test(fs.readFileSync(f, "utf8"))));

// 9. reproducibility and evidence pack
C.ok("og-image generator committed", fs.existsSync(path.join(ROOT, "tools/og-image.py")) && fs.existsSync(path.join(ROOT, "backend/public/og-image.png")));
C.ok("root package.json with test script", JSON.parse(R("package.json")).scripts?.test?.length > 0);
C.ok("CI workflow present", fs.existsSync(path.join(ROOT, ".github/workflows/test.yml")));
C.ok("legacy duplicates removed", !fs.existsSync(path.join(ROOT, "index.html")) && !fs.existsSync(path.join(ROOT, "deploy")));
const register = JSON.parse(R("findings.json")); const findings = register.findings;
const auditFor = id => R((register.audits || {})[id.split("-")[0]] || register.audit);
C.ok("every finding id appears in its audit and the built page", findings.every(f => auditFor(f.id).includes(f.id) && built.includes(`id="${f.id}"`)));
C.ok("finding ids are unique", new Set(findings.map(f => f.id)).size === findings.length);
C.ok("FIXES-APPLIED generated for this build date", fs.existsSync(path.join(ROOT, `FIXES-APPLIED-${JSON.parse(R("version.json")).buildDate}.md`)));
C.ok("sister project cross-linked in page and README", /Harlan/.test(built) && /Harlan/.test(readme));
C.ok("gold set and results present", fs.existsSync(path.join(ROOT, "eval/gold.json")) && fs.existsSync(path.join(ROOT, "eval/results.json")));

// 10. v3.3 (Phase 2): the motion contract, the replay cards, the fonts and the icons
const motionDoc = R("MOTION.md"); const tpl = R("src/index.template.html");
const keyframes = [...new Set([...tpl.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map(m => m[1]))];
const undocumented = keyframes.filter(k => !motionDoc.includes("`" + k + "`"));
C.ok("every @keyframes animation in the page is listed in MOTION.md", keyframes.length >= 10 && undocumented.length === 0, undocumented.join(", "));
C.ok("MOTION.md states the switch, the pause rule and the flash rule", /prefers-reduced-motion/.test(motionDoc) && /2\.2\.2/.test(motionDoc) && /2\.3\.1/.test(motionDoc));
const replayData = JSON.parse(R("redteam-replays.json")).replays; const findingIds = new Set(findings.map(f => f.id));
C.ok("16 live-probe replays: 14 chat and 2 voice", replayData.length === 16 && replayData.filter(r => r.channel === "chat").length === 14 && replayData.filter(r => r.channel === "voice").length === 2);
C.ok("every replay has a verdict and cites a real finding or none", replayData.every(r => /^(held|broke)$/.test(r.verdict) && (r.finding === null || findingIds.has(r.finding))), replayData.filter(r => r.finding && !findingIds.has(r.finding)).map(r => r.finding).join(","));
C.ok("the built page carries all 16 replay cards and a case card per finding", (built.match(/class="rcard"/g) || []).length === 16 && (built.match(/<article class="find"/g) || []).length === findings.length);
const fontsDir = path.join(ROOT, "backend", "public", "fonts"), fontFiles = ["archivo-display.woff2", "jetbrains-mono-500.woff2"];
C.ok("both subset fonts and their license are published", fontFiles.concat("OFL.txt").every(f => fs.existsSync(path.join(fontsDir, f))));
const fontBytes = fontFiles.reduce((n, f) => n + (fs.existsSync(path.join(fontsDir, f)) ? fs.statSync(path.join(fontsDir, f)).size : 0), 0);
C.ok("font subsets total 30 to 60 KB", fontBytes >= 30 * 1024 && fontBytes <= 60 * 1024, `${fontBytes} bytes`);
C.ok("no third-party scripts, styles or fonts (everything self-hosted)", !/<(script|link)[^>]+(src|href)="https?:/i.test(built) && !/url\((["']?)https?:/i.test(built));
const emoji = built.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];
C.ok("interface icons are SVG, not emoji (only the sales greeting waves)", emoji.length <= 1 && (emoji.length === 0 || /Hey! \u{1F44B}/u.test(built)), emoji.join(" "));

// 11. v3.4 (Phase 3): the security page, the arena's mapping, the supply chain
const secPath = path.join(ROOT, "backend", "public", "security.html"); const secPage = fs.existsSync(secPath) ? fs.readFileSync(secPath, "utf8") : "";
const secData = JSON.parse(R("security.json"));
// the OWASP Top 10 for LLM Applications 2026, in rank order (checked November 2026)
const OWASP26 = ["Prompt Injection", "Sensitive Information Disclosure", "Excessive Agency", "Supply Chain", "Data and Model Poisoning", "Unbounded Consumption", "Misinformation", "Hidden Context Exposure", "Vector and Embedding Weaknesses", "Improper Output Handling"];
C.ok("security page lists all ten OWASP 2026 risks under their 2026 numbers", secData.owasp.length === 10 && secData.owasp.every((o, i) => o.id === `LLM${String(i + 1).padStart(2, "0")}:2026` && o.name === OWASP26[i]) && OWASP26.every((n, i) => secPage.includes(`LLM${String(i + 1).padStart(2, "0")}:2026 ${n}`)));
const CIS18 = ["Inventory and Control of Enterprise Assets", "Inventory and Control of Software Assets", "Data Protection", "Secure Configuration of Enterprise Assets and Software", "Account Management", "Access Control Management", "Continuous Vulnerability Management", "Audit Log Management", "Email and Web Browser Protections", "Malware Defenses", "Data Recovery", "Network Infrastructure Management", "Network Monitoring and Defense", "Security Awareness and Skills Training", "Service Provider Management", "Application Software Security", "Incident Response Management", "Penetration Testing"];
C.ok("security page covers all 18 CIS Controls v8.1, by name and number", secData.cis.length === 18 && secData.cis.every((c, i) => c.n === i + 1 && c.name === CIS18[i]) && CIS18.every((n, i) => secPage.includes(`${i + 1}. ${n.replace(/&/g, "&amp;")}`)));
C.ok("security page maps MITRE ATLAS techniques by ID", ["AML.T0051.000", "AML.T0051.001", "AML.T0056", "AML.T0077", "AML.T0034"].every(id => secPage.includes(id)) && secData.atlas.every(a => /^AML\.T\d{4}(\.\d{3})?$/.test(a.id)));
const vjs = JSON.parse(R("backend/vercel.json"));
C.ok("security page's header table is the deploy's own headers", vjs.headers[0].headers.every(h => secPage.includes(`<th scope="row">${h.key}</th>`) && secPage.includes(h.value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"))));
C.ok("security page runs no script and credits the NVD", !/<script/i.test(secPage) && secPage.includes("not endorsed or certified by the NVD") && secPage.includes("/.well-known/security.txt") && secPage.includes("security/advisories/new"));
const arenaSrc = R("backend/lib/arena.mjs");
const levelOwasp = [...arenaSrc.matchAll(/id: (\d), slug: "\w+", title: "[^"]+", owasp: "(LLM\d\d:2026)/g)].map(m => [+m[1], m[2]]);
C.ok("each arena level's OWASP risk names that level on the security page", levelOwasp.length === 5 && levelOwasp.every(([n, id]) => secData.owasp.some(o => o.id === id && new RegExp(`Arena levels? (?:\\d and )?(?:\\d, )*${n}\\b|Arena levels? ${n}\\b|Arena levels \\d and ${n}\\b`).test(o.tested))), JSON.stringify(levelOwasp));
C.ok("the deploy routes the arena and the honeypot, and the honeypot paths land in it", !!vjs.functions["api/arena.js"] && !!vjs.functions["api/trap.js"] && ["/wp-login.php", "/.env", "/xmlrpc.php"].every(src => (vjs.rewrites || []).some(r => r.source === src && r.destination.startsWith("/api/trap"))));
const wfDir = path.join(ROOT, ".github", "workflows"); const wfs = fs.readdirSync(wfDir).filter(f => /\.ya?ml$/.test(f)).map(f => [f, fs.readFileSync(path.join(wfDir, f), "utf8")]);
const usesLines = wfs.flatMap(([f, t]) => t.split("\n").filter(l => /^\s*-?\s*uses:/.test(l)).map(l => f + ": " + l.trim()));
C.ok("every workflow action is pinned to a commit, with its version noted", usesLines.length >= 9 && usesLines.every(l => /@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(l)), usesLines.filter(l => !/@[0-9a-f]{40} # v/.test(l)).join(" | "));
C.ok("every workflow runs with read-only repository permissions", wfs.every(([f, t]) => /\npermissions:\n\s+contents: read\n/.test(t) && !/contents:\s*write/.test(t)), wfs.filter(([f, t]) => !/permissions:\n\s+contents: read/.test(t)).map(([f]) => f).join(","));
C.ok("Dependabot keeps actions and development packages current", /package-ecosystem: github-actions/.test(R(".github/dependabot.yml")) && /package-ecosystem: npm/.test(R(".github/dependabot.yml")));
C.ok("the dependency watch runs daily and on lockfile changes", /cron:/.test(R(".github/workflows/depwatch.yml")) && /package-lock\.json/.test(R(".github/workflows/depwatch.yml")) && fs.existsSync(path.join(ROOT, "tools", "depwatch.mjs")));
C.done();
