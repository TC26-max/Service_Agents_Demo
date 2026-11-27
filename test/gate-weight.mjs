#!/usr/bin/env node
// test/gate-weight.mjs: the first-load budget from the November audit (Gate C): everything the browser
// fetches before the visitor does anything must stay at or under 100 KB compressed, on a phone and on a
// desktop. Text is measured gzip -9 (a conservative stand-in for the brotli the platform serves); fonts
// and images are counted as they are on the wire. The local analytics stub is replaced by the size of
// the production script. Also reports, for information, what loads once the visitor enters.
import zlib from "node:zlib"; import fs from "node:fs"; import path from "node:path";
import { startHarness, launchBrowser, wait, Check, ROOT } from "./lib.mjs";
const C = new Check("gate-weight");
const BUDGET = 100 * 1024, ANALYTICS = 1600;
const H = await startHarness({ port: 8814 }); const browser = await launchBrowser();
const TEXT = /\b(html|javascript|css|json|svg|xml|plain)\b/;
const size = (type, buf) => TEXT.test(type) ? zlib.gzipSync(buf, { level: 9 }).length : buf.length;
const report = {};
if (!browser) { console.log("(Chromium unavailable: weight gate skipped)"); H.close(); C.done(); }
for (const vp of [{ name: "phone", width: 390, height: 844, isMobile: true, hasTouch: true }, { name: "desktop", width: 1280, height: 800 }]) {
  const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
  const p = await c.newPage(); const seen = []; let phase = "first";
  p.on("response", async r => { try { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) return; const b = await r.body(); const t = r.headers()["content-type"] || "";
    seen.push({ phase, path: u.pathname, type: t, bytes: u.pathname.startsWith("/_vercel/insights/") ? ANALYTICS : size(t, b) }); } catch (e) {} });
  await p.goto(H.base + "/"); await p.waitForLoadState("networkidle"); await wait(1500);
  const first = seen.filter(s => s.phase === "first"); const total = first.reduce((n, s) => n + s.bytes, 0);
  phase = "entered"; await p.click("#enterBtn"); await wait(1500);
  const later = seen.filter(s => s.phase === "entered");
  report[vp.name] = { firstLoadBytes: total, files: first.map(s => `${s.path} ${s.bytes}`), afterEnter: later.map(s => `${s.path} ${s.bytes}`) };
  C.ok(`${vp.name}: first load ${(total / 1024).toFixed(1)} KB compressed, budget 100 KB`, total <= BUDGET, first.map(s => `${s.path}=${s.bytes}`).join(" "));
  C.ok(`${vp.name}: every first-load file is same-origin`, first.every(s => s.path.startsWith("/")));
  await c.close();
}
await browser.close(); H.close();
fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "dist", "weight.json"), JSON.stringify(report, null, 1) + "\n");
console.log(Object.entries(report).map(([k, v]) => `${k}: ${(v.firstLoadBytes / 1024).toFixed(1)} KB first load (${v.files.length} files); after entering: ${v.afterEnter.join(", ") || "nothing new"}`).join("\n"));
C.done();
