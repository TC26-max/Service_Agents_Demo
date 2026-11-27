#!/usr/bin/env node
// test/lh-budget.mjs: Lighthouse budget for the November audit's Gate C. Serves the built page with the repo
// harness (deploy headers, compression, real handlers, provider mocked) and runs Lighthouse on a phone and a
// desktop profile. Fails unless the median of LH_RUNS runs (3 by default, 5 in CI) keeps Performance at 95 or more and every run keeps
// Accessibility at 100. Needs Chrome; LIGHTHOUSE_BIN picks the binary (default: npx lighthouse@12.8.2).
import { execFile } from "node:child_process"; import { promisify } from "node:util"; import fs from "node:fs"; import path from "node:path";
import { startHarness, Check, ROOT } from "./lib.mjs";
const run = promisify(execFile); const C = new Check("lh-budget");
const RUNS = +(process.env.LH_RUNS || 3), out = path.join(ROOT, "dist", "lighthouse"); fs.mkdirSync(out, { recursive: true });
const bin = process.env.LIGHTHOUSE_BIN || "npx"; const pre = process.env.LIGHTHOUSE_BIN ? [] : ["--yes", "lighthouse@12.8.2"];
const H = await startHarness({ port: 8857 }); const summary = {};
for (const preset of ["mobile", "desktop"]) {
  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    const file = path.join(out, `${preset}-${i}.json`);
    const args = [...pre, H.base + "/", "--quiet", "--output=json", `--output-path=${file}`, "--only-categories=performance,accessibility,best-practices,seo", "--chrome-flags=--headless=new --no-sandbox --no-proxy-server --disable-gpu"];
    if (preset === "desktop") args.push("--preset=desktop");
    // Lighthouse itself sometimes fails to record a trace (NO_NAVSTART and similar); that is retried, not scored
    let ok = false, err = "";
    for (let t = 0; t < 3 && !ok; t++) { try { await run(bin, args, { timeout: 300000, maxBuffer: 1 << 26 }); ok = true; } catch (e) { err = String(e.stderr || e.message).slice(0, 300); console.log(`(${preset} run ${i + 1}, attempt ${t + 1} failed: ${err.split("\n")[0]})`); } }
    if (!ok) continue;
    const j = JSON.parse(fs.readFileSync(file, "utf8")); const sc = k => Math.round((j.categories[k] || {}).score * 100);
    rows.push({ perf: sc("performance"), a11y: sc("accessibility"), bp: sc("best-practices"), seo: sc("seo"), tbt: Math.round(j.audits["total-blocking-time"].numericValue), lcp: Math.round(j.audits["largest-contentful-paint"].numericValue), cls: +j.audits["cumulative-layout-shift"].numericValue.toFixed(3) });
  }
  C.ok(`${preset}: at least ${Math.min(3, RUNS)} Lighthouse runs completed`, rows.length >= Math.min(3, RUNS), `${rows.length} of ${RUNS}`);
  if (!rows.length) continue;
  const perf = rows.map(r => r.perf).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  summary[preset] = { medianPerformance: perf, runs: rows };
  C.ok(`${preset}: median Performance ${perf}, budget 95`, perf >= 95, JSON.stringify(rows));
  C.ok(`${preset}: Accessibility 100 in every run`, rows.every(r => r.a11y === 100), rows.map(r => r.a11y).join(","));
}
H.close();
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify(summary));
C.done();
