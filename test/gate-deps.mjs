#!/usr/bin/env node
// test/gate-deps.mjs (v3.4): runs the dependency watch against recorded fixtures (no network) and checks the
// policy: known exploited fails, high severity fails for runtime and pipeline but only warns for development
// packages, the CNA's score comes before CISA's and the NVD's, and the NVD notice appears when it was used.
import { execFile } from "node:child_process"; import { promisify } from "node:util"; import fs from "node:fs"; import path from "node:path";
import { Check, ROOT } from "./lib.mjs";
const run = promisify(execFile); const C = new Check("gate-deps");
const F = path.join(ROOT, "test", "fixtures", "deps"), OUT = path.join(ROOT, "dist", "deps-fixture");
let code = 0; try { await run(process.execPath, [path.join(ROOT, "tools", "depwatch.mjs"), "--fixture", F, "--lock", path.join(F, "package-lock.json"), "--workflows", path.join(F, "workflows"), "--out", OUT], { cwd: ROOT }); } catch (e) { code = e.code; }
const rep = JSON.parse(fs.readFileSync(path.join(OUT, "report.json"), "utf8")), badge = JSON.parse(fs.readFileSync(path.join(OUT, "badge.json"), "utf8")), md = fs.readFileSync(path.join(OUT, "summary.md"), "utf8");
const by = n => rep.findings.find(f => f.package === n) || {};
C.ok("a known-exploited runtime package fails the run (exit 1)", code === 1 && by("evil-lib").decision === "fail" && by("evil-lib").kev === true, `exit ${code}`);
C.ok("the CNA's score is used first", by("evil-lib").score === 9.8 && by("evil-lib").scoreSource === "CNA");
C.ok("a critical development package warns instead of failing, scored by CISA ADP", by("minimist").decision === "warn" && by("minimist").scoreSource === "CISA ADP");
C.ok("an advisory without a CVE falls back to OSV's severity and stays informational", by("left-pad").decision === "info" && by("left-pad").scoreSource === "OSV severity");
C.ok("the NVD is asked only when the record has no score, and its notice is printed", by("old-lib").scoreSource === "NVD" && by("old-lib").score === 5.3 && rep.nvdUsed && md.includes("not endorsed or certified by the NVD"));
C.ok("EPSS is attached to each CVE", by("evil-lib").epss === 0.42 && by("minimist").epss === 0.012);
C.ok("the inventory covers npm packages and workflow actions, counting pinned ones", rep.inventory.npm === 5 && rep.inventory.actions === 2 && rep.inventory.actionsPinned === 1 && rep.inventory.runtime === 1, JSON.stringify(rep.inventory));
C.ok("the badge is a shields.io endpoint saying what to fix", badge.schemaVersion === 1 && badge.message === "1 to fix" && badge.color === "red");
C.ok("packages without advisories are not reported", !rep.findings.some(f => f.package === "safe-lib"));
C.done();
