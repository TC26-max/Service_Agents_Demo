#!/usr/bin/env node
// tools/depwatch.mjs (v3.4, audit 2026-11-26, Phase 3): the daily dependency watch.
//
// Inventory: every package in package-lock.json (all of them development-only today: the deployed functions
// import nothing from npm) and every action the workflows use. For each, known advisories come from OSV
// (osv.dev), each advisory is followed to its CVE records, and each CVE gets:
//   - a score from its CVE record, the CNA's own score first, then the CISA ADP's (cveawg.mitre.org);
//     the NVD is asked only when the record carries neither (and is credited as the NVD requires);
//   - whether it is in CISA's Known Exploited Vulnerabilities catalog;
//   - FIRST's EPSS probability of exploitation in the next 30 days.
// Policy: anything known exploited fails; a high or critical score, or EPSS of 0.1 or more, fails for what the
// site or its pipeline runs (runtime packages, workflow actions) and is a warning for development packages.
// Writes report.json, summary.md and a shields.io endpoint badge.json; exits 1 when something fails.
//
// Usage: node tools/depwatch.mjs [--out dist/deps] [--lock package-lock.json] [--workflows .github/workflows]
//        [--fixture dir]   (reads every source from files in dir instead of the network; used by the tests)
import fs from "node:fs"; import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? a.concat([[x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]]) : a), []));
const ROOT = process.cwd();
const OUT = path.resolve(args.out || "dist/deps"), LOCK = path.resolve(args.lock || "package-lock.json"), WF = path.resolve(args.workflows || ".github/workflows");
const FIX = args.fixture ? path.resolve(args.fixture) : null;
const NOTICE = "This product uses data from the NVD API but is not endorsed or certified by the NVD.";
const UA = { "User-Agent": "grounded-depwatch (+https://github.com/TC26-max/Service_Agents_Demo)" };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const readFix = (...p) => { const f = path.join(FIX, ...p); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; };
async function getJSON(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      throw new Error(`${url} answered ${r.status}`);
    } catch (e) { if (i === tries - 1) throw e; await sleep(1500 * (i + 1)); }
  }
  return null;
}

// ---------------------------------------------------------------- inventory
function inventory() {
  const items = [];
  const lock = JSON.parse(fs.readFileSync(LOCK, "utf8"));
  for (const [key, v] of Object.entries(lock.packages || {})) {
    if (!key || !v.version) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    items.push({ ecosystem: "npm", name, version: v.version, cls: v.dev ? "dev" : "runtime" });
  }
  if (fs.existsSync(WF)) for (const f of fs.readdirSync(WF).filter(f => /\.ya?ml$/.test(f))) {
    for (const line of fs.readFileSync(path.join(WF, f), "utf8").split("\n")) {
      const m = /uses:\s*([\w.-]+\/[\w.-]+)@([\w.-]+)(?:\s*#\s*v?([\d.]+))?/.exec(line); if (!m) continue;
      const version = m[3] || m[2].replace(/^v/, "");
      if (!items.some(x => x.ecosystem === "GitHub Actions" && x.name === m[1] && x.version === version)) items.push({ ecosystem: "GitHub Actions", name: m[1], version, cls: "pipeline", pinned: /^[0-9a-f]{40}$/.test(m[2]) });
    }
  }
  return items;
}

// ---------------------------------------------------------------- sources
async function osvBatch(items) {
  if (FIX) return readFix("osv-querybatch.json") || { results: items.map(() => ({})) };
  const out = { results: [] };
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    const j = await getJSON("https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queries: chunk.map(x => ({ package: { name: x.name, ecosystem: x.ecosystem }, version: x.version })) }) });
    out.results.push(...((j && j.results) || chunk.map(() => ({}))));
  }
  return out;
}
const osvVuln = async id => FIX ? readFix("osv-vulns", id + ".json") : getJSON("https://api.osv.dev/v1/vulns/" + encodeURIComponent(id));
const kevSet = async () => { const j = FIX ? readFix("kev.json") : await getJSON("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"); return new Set(((j && j.vulnerabilities) || []).map(v => v.cveID)); };
async function epss(cves) {
  const map = new Map(); if (!cves.length) return map;
  const j = FIX ? readFix("epss.json") : { data: [] };
  if (!FIX) for (let i = 0; i < cves.length; i += 80) { const r = await getJSON("https://api.first.org/data/v1/epss?cve=" + cves.slice(i, i + 80).join(",")); if (r && r.data) j.data.push(...r.data); }
  for (const d of (j && j.data) || []) map.set(d.cve, { epss: +d.epss, percentile: +d.percentile, date: d.date });
  return map;
}
function scoreFrom(metrics) {
  for (const m of metrics || []) for (const k of ["cvssV4_0", "cvssV3_1", "cvssV3_0", "cvssV2_0"]) if (m[k] && typeof m[k].baseScore === "number") return { score: m[k].baseScore, severity: m[k].baseSeverity || null, version: k };
  return null;
}
let nvdCalls = 0;
async function cveScore(cve) {
  const rec = FIX ? readFix("cve", cve + ".json") : await getJSON("https://cveawg.mitre.org/api/cve/" + cve);
  const cna = rec && rec.containers && scoreFrom(rec.containers.cna && rec.containers.cna.metrics);
  if (cna) return { ...cna, source: "CNA" };
  const adp = rec && rec.containers && (rec.containers.adp || []).map(a => scoreFrom(a.metrics)).find(Boolean);
  if (adp) return { ...adp, source: "CISA ADP" };
  // the NVD only when the record has no score of its own; without an API key it allows 5 requests per 30 seconds
  if (!FIX && nvdCalls++) await sleep(process.env.NVD_API_KEY ? 700 : 6500);
  const nvd = FIX ? readFix("nvd", cve + ".json") : await getJSON("https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=" + cve, process.env.NVD_API_KEY ? { headers: { apiKey: process.env.NVD_API_KEY } } : {});
  const m = nvd && nvd.vulnerabilities && nvd.vulnerabilities[0] && nvd.vulnerabilities[0].cve.metrics;
  const n = m && ((m.cvssMetricV40 || [])[0] || (m.cvssMetricV31 || [])[0] || (m.cvssMetricV30 || [])[0]);
  if (n && n.cvssData) return { score: n.cvssData.baseScore, severity: n.cvssData.baseSeverity || null, version: n.cvssData.version, source: "NVD" };
  return null;
}

// ---------------------------------------------------------------- run
const items = inventory();
const batch = await osvBatch(items);
const advisories = new Map(); // id -> { vuln, packages[] }
batch.results.forEach((r, i) => { for (const v of (r && r.vulns) || []) { if (!advisories.has(v.id)) advisories.set(v.id, { pk: [] }); advisories.get(v.id).pk.push(items[i]); } });
for (const [id, a] of advisories) a.vuln = await osvVuln(id);
const cves = [...new Set([...advisories.values()].flatMap(a => [a.vuln && a.vuln.id, ...((a.vuln && a.vuln.aliases) || [])]).filter(x => /^CVE-\d{4}-\d{4,}$/.test(x || "")))];
const kev = await kevSet(), ep = await epss(cves), scores = new Map();
for (const c of cves) scores.set(c, await cveScore(c));
const SEV_RANK = { LOW: 1, MODERATE: 2, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const findings = [];
for (const [id, a] of advisories) {
  const v = a.vuln || {}, ids = [v.id, ...(v.aliases || [])].filter(x => /^CVE-/.test(x || ""));
  const sc = ids.map(c => scores.get(c)).filter(Boolean).sort((x, y) => y.score - x.score)[0] || null;
  const osvSev = ((v.database_specific && v.database_specific.severity) || "").toUpperCase() || null;
  const inKev = ids.some(c => kev.has(c)), e = ids.map(c => ep.get(c)).filter(Boolean).sort((x, y) => y.epss - x.epss)[0] || null;
  const high = (sc && sc.score >= 7) || (!sc && SEV_RANK[osvSev] >= 3), likely = !!(e && e.epss >= 0.1);
  for (const p of a.pk) {
    const decision = inKev ? "fail" : (high || likely) ? (p.cls === "dev" ? "warn" : "fail") : "info";
    findings.push({ package: p.name, version: p.version, ecosystem: p.ecosystem, class: p.cls, advisory: id, cves: ids, summary: (v.summary || "").slice(0, 200),
      score: sc ? sc.score : null, scoreSource: sc ? sc.source : (osvSev ? "OSV severity" : null), severity: sc ? sc.severity : osvSev, kev: inKev, epss: e ? e.epss : null, epssPercentile: e ? e.percentile : null, decision });
  }
}
findings.sort((x, y) => ({ fail: 0, warn: 1, info: 2 })[x.decision] - ({ fail: 0, warn: 1, info: 2 })[y.decision] || (y.score || 0) - (x.score || 0));
const nFail = findings.filter(f => f.decision === "fail").length, nWarn = findings.filter(f => f.decision === "warn").length;
const report = { generatedAt: new Date().toISOString(), fixture: !!FIX, inventory: { npm: items.filter(x => x.ecosystem === "npm").length, runtime: items.filter(x => x.cls === "runtime").length, actions: items.filter(x => x.ecosystem === "GitHub Actions").length, actionsPinned: items.filter(x => x.pinned).length },
  policy: "Known exploited (CISA KEV) fails. CVSS 7.0 or more, or EPSS 0.1 or more, fails for runtime packages and workflow actions and warns for development packages.", nvdUsed: [...scores.values()].some(s => s && s.source === "NVD"), notice: NOTICE, findings };
const rows = findings.map(f => `| ${f.decision} | ${f.ecosystem} ${f.package}@${f.version} (${f.class}) | ${f.advisory}${f.cves.length ? " / " + f.cves.join(", ") : ""} | ${f.score ?? "n/a"}${f.scoreSource ? " (" + f.scoreSource + ")" : ""} | ${f.kev ? "yes" : "no"} | ${f.epss == null ? "n/a" : f.epss.toFixed(3)} |`);
const md = `## Dependency watch\n\n${report.inventory.npm} npm packages (${report.inventory.runtime} at runtime) and ${report.inventory.actions} workflow actions (${report.inventory.actionsPinned} pinned to a commit) checked against OSV, CVE records, CISA KEV and FIRST EPSS.\n\n` +
  (findings.length ? "| Decision | Package | Advisory | Score | Known exploited | EPSS |\n|---|---|---|---|---|---|\n" + rows.join("\n") + "\n" : "No known advisories.\n") +
  `\n${report.policy}\n\n${report.nvdUsed ? NOTICE + "\n" : ""}`;
const badge = { schemaVersion: 1, label: "dependencies", message: nFail ? `${nFail} to fix` : nWarn ? `${nWarn} to watch` : "no known issues", color: nFail ? "red" : nWarn ? "yellow" : "brightgreen" };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1) + "\n");
fs.writeFileSync(path.join(OUT, "summary.md"), md);
fs.writeFileSync(path.join(OUT, "badge.json"), JSON.stringify(badge) + "\n");
console.log(md);
process.exit(nFail ? 1 : 0);
