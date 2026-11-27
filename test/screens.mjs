#!/usr/bin/env node
// test/screens.mjs: captures the same set of screens every time (reduced motion, fixed viewports, mocked
// provider), for the screenshot diff in .github/workflows/ui-budget.yml. Usage: node test/screens.mjs <outdir>
import fs from "node:fs"; import path from "node:path";
import { startHarness, launchBrowser, wait, ROOT } from "./lib.mjs";
const out = path.resolve(process.argv[2] || path.join(ROOT, "dist", "screens")); fs.mkdirSync(out, { recursive: true });
const H = await startHarness({ port: 8858 }); const B = H.base; const browser = await launchBrowser();
if (!browser) { console.log("(Chromium unavailable: no screens)"); H.close(); process.exit(0); }
const shots = [];
const shoot = async (name, vp, mode, steps) => {
  const c = await browser.newContext({ viewport: vp, reducedMotion: "reduce", isMobile: vp.width < 500, hasTouch: vp.width < 500, extraHTTPHeaders: { "x-real-ip": "10.66.0." + (shots.length + 1) } });
  await c.addInitScript(m => { try { localStorage.setItem("g-mode", m); localStorage.setItem("g-tips", "1"); } catch (e) {} }, mode);
  const p = await c.newPage(); p.setDefaultTimeout(5000); await p.goto(B + "/"); await p.waitForSelector("#enterBtn"); await wait(1400);
  // an older build (the base branch) may lack a control; the screen is still taken, so the diff shows why
  for (const s of steps) { try { await s(p); } catch (e) { console.log(`(${name}-${mode}: a step was skipped: ${String(e.message).split("\n")[0].slice(0, 90)})`); } }
  await p.evaluate(() => document.fonts && document.fonts.ready); await wait(300);
  const file = path.join(out, `${name}-${mode}.png`); await p.screenshot({ path: file, animations: "disabled", caret: "hide" }); shots.push(path.basename(file)); await c.close(); };
const enter = async p => { await p.click("#enterBtn"); await wait(500); };
const ask = async p => { await p.fill("#input", "What is your refund policy?"); await p.click("#send"); await wait(1500); };
const view = v => async p => { await p.click(`#viewseg button[data-view="${v}"]`); await wait(400); };
const rank = async p => { await p.fill("#xq", "my slack notifications stopped working"); await p.click("#xgo"); await wait(1500); };
const book = async p => { await p.click('.kbmode button[data-m="book"]'); await wait(300); };
const desk = { width: 1280, height: 860 }, phone = { width: 390, height: 844 };
for (const mode of ["dark", "light"]) {
  await shoot("intro", desk, mode, []);
  await shoot("chat", desk, mode, [enter, ask]);
  await shoot("xray", desk, mode, [enter, view("xray"), rank]);
  await shoot("handbook", desk, mode, [enter, view("kb"), book]);
  await shoot("tested", desk, mode, [enter, view("tested")]);
  await shoot("phone-intro", phone, mode, []);
  await shoot("phone-chat", phone, mode, [enter, ask]);
}
await browser.close(); H.close();
console.log(`${shots.length} screens in ${out}`);
