#!/usr/bin/env node
// test/gate-ui.mjs: the built page in headless Chromium, served under the exact deploy headers (CSP included),
// with the real handlers mounted and the provider mocked. Asserts from the visitor's side of the screen.
// Falls back to jsdom for the DOM-logic checks when Chromium is unavailable (layout and CSP checks are skipped).
import { startHarness, launchBrowser, STUB_INIT, wait, Check, ROOT } from "./lib.mjs";
import path from "node:path"; import fs from "node:fs"; import { pathToFileURL } from "node:url";
const NFIND = JSON.parse(fs.readFileSync(path.join(ROOT, "findings.json"), "utf8")).findings.length;
const C = new Check("gate-ui");
const H = await startHarness({ port: 8812 }); const B = H.base;
const browser = await launchBrowser();

const PHANTOM = ["I've booked your demo for Tuesday at 3pm.", "Your refund of $120 has been processed to your card.", "I've applied a 20% discount to your account.", "I've emailed the invoice to you just now.", "Ticket NIM-12345 has been created and assigned to Sarah in billing.", "Your plan has been upgraded to Business.", "I've reset your password; check your inbox.", "I've cancelled your subscription effective today.", "I notified the billing team and they will call you within the hour.", "Your account is now unlocked.", "I've added 5 seats to your workspace.", "Done! Your data export is downloading now.", "I've scheduled a call with a specialist for tomorrow morning.", "Your workspace ownership has been transferred.", "I've waived this month's fee for you.", "I've escalated this and a manager is joining the chat now.", "Your SSO has been enabled.", "I've extended your trial by 14 days.", "I processed the chargeback reversal.", "Your ticket is now marked resolved."];
const LEGIT = ["To reset your password, use the self-service link at nimbushq.example/reset [S1].", "Refunds for paid plans are available within 14 days of a charge [S1].", "Business is $22 per user per month billed annually [S1].", "To connect Slack, go to Settings, Integrations, Slack and authorize it [S1].", "A 30 percent discount is published for verified nonprofits and educational institutions [S1].", "Data export to CSV or JSON is available on all paid plans [S1].", "Business priority support targets a first response within 4 business hours [S1].", "SSO with Google or Microsoft is configured by a workspace admin on Business [S1].", "Ownership transfers are completed by the support team after out-of-band verification [S1].", "The 14-day Business trial requires no credit card [S1].", "Nimbus is SOC 2 Type II certified and GDPR compliant [S1].", "HIPAA support is an Enterprise add-on [S1].", "Invoices are available under Settings, Billing, Invoices [S1].", "Admins can add or remove seats under Settings, Members [S1].", "Data is hosted in the United States by default [S1].", "A REST API and webhooks are available on Pro and above [S1].", "Service status is published at status.nimbushq.example [S1].", "Free plans use community support [S1].", "When you downgrade an annual plan, the unused balance becomes prorated credit [S1].", "Enterprise pricing is custom; a specialist can provide a quote [S1]."];

if (browser) {
  const stubCtx = async (w = 1280, h = 800) => { const c = await browser.newContext({ viewport: { width: w, height: h } }); await c.addInitScript(STUB_INIT); return c; };
  const realCtx = async (w = 1280, h = 800) => browser.newContext({ viewport: { width: w, height: h } });
  const sendAndWait = async (p, text, ms = 800) => { await p.evaluate(t => { const i = document.getElementById("input"); i.value = t; document.getElementById("send").click(); }, text); await wait(ms); };

  // Boot under CSP, no console errors, health pill, hidden dead controls, credentials, version
  { const c = await realCtx(); const p = await c.newPage(); const errors = []; p.on("console", m => { if (m.type() === "error") errors.push(m.text()); }); p.on("pageerror", e => errors.push(String(e)));
    await p.goto(B + "/"); await p.waitForSelector("#enterBtn"); await wait(600);
    const s = await p.evaluate(() => ({ title: document.title, pill: document.getElementById("status").textContent, dead: ["gear", "ragLabel", "ragToggle", "modal", "apikey"].filter(id => document.getElementById(id)).length, offsite: /api\.openai\.com|api\.anthropic\.com/.test(document.documentElement.innerHTML), ver: document.getElementById("version").dataset.version, tabs: document.querySelectorAll("#viewseg button").length }));
    C.ok("no console or CSP errors on boot", errors.length === 0, errors.slice(0, 2).join(" | "));
    C.ok("title has no dash", !/[\u2014\u2013]/.test(s.title));
    C.ok("health-driven pill shows live + version", /Live/.test(s.pill) && /v3\./.test(s.pill), s.pill);
    C.ok("N-20 bring-your-own-key controls and third-party model calls removed", s.dead === 0 && !s.offsite, `${s.dead} dead controls, offsite calls: ${s.offsite}`);
    C.ok("four tabs incl. Tested", s.tabs === 4);
    await p.evaluate(() => document.getElementById("enterBtn").click());
    const cred = await p.evaluate(() => (document.querySelector(".cred") || {}).textContent || "");
    C.ok("demo credentials on screen next to the support chat", /owner@acme-co\.example/.test(cred) && /acme-co/.test(cred));
    // real handler round trip under CSP: streamed answer, citation, sources, handed-off card with intent
    await sendAndWait(p, "what is your refund policy?", 1500);
    const a1 = await p.evaluate(() => ({ cite: !!document.querySelector("#chat .cite"), badges: [...document.querySelectorAll("#chat .tagb")].map(b => b.textContent), src: [...document.querySelectorAll("#chat .srcitem")].map(s => s.textContent) }));
    C.ok("cited grounded answer over the real handler", a1.cite && a1.badges.some(b => /Grounded/.test(b)), a1.badges.join(","));
    C.ok("source chip carries semantic score and match", a1.src.some(s => /semantic/.test(s)));
    await sendAndWait(p, "i want to talk to an agent [[reply:I understand. I have logged ticket {TICKET} and a specialist will follow up by email.]]", 1500);
    const a2 = await p.evaluate(() => ({ card: !!document.querySelector("#chat .ticket"), badges: [...document.querySelectorAll("#chat .row.bot:last-of-type .tagb")].map(b => b.textContent) }));
    C.ok("escalation with intent renders the ticket card and Handed off badge", a2.card && a2.badges.some(b => /Handed off/.test(b)) && !a2.badges.some(b => /Not in knowledge base/.test(b)), a2.badges.join(","));
    // Escape closes drawer; deep link
    const esc = await p.evaluate(async () => { document.querySelector("#chat .cite").click(); const o = document.getElementById("drawer").classList.contains("open"); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await new Promise(r => setTimeout(r, 80)); return o && !document.getElementById("drawer").classList.contains("open"); });
    C.ok("Escape closes the source drawer", esc);
    await p.goto(B + "/#xray"); await wait(500);
    C.ok("deep link #xray skips the cover and opens the X-ray", await p.evaluate(() => document.body.classList.contains("entered") && document.getElementById("xrayview").classList.contains("show")));
    await p.evaluate(() => { document.getElementById("xq").value = "refund policy"; document.getElementById("xgo").click(); }); await wait(1200);
    const x = await p.evaluate(() => ({ items: document.querySelectorAll("#xrayview .xitem").length, more: [...document.querySelectorAll("#xrayview button")].some(b => /Show all 36/.test(b.textContent)) }));
    C.ok("X-ray shows 10 with a fold to all 36", x.items === 10 && x.more, JSON.stringify(x));
    await p.goto(B + "/#tested"); await wait(400);
    C.ok(`Tested page renders all ${NFIND} findings`, await p.evaluate(() => document.querySelectorAll("#testedview .find").length) === NFIND);
    await c.close(); }

  // G-11 bot switch keeps the answer with the bot that asked (stub, slow reply)
  { const c = await stubCtx(); const p = await c.newPage(); await p.goto(B + "/"); await p.waitForSelector("#enterBtn");
    await p.evaluate(() => { document.getElementById("enterBtn").click(); window.__delay = 1000; window.__replies.push("Stays in support [S1]."); const i = document.getElementById("input"); i.value = "refund?"; document.getElementById("send").click(); });
    await wait(250); await p.evaluate(() => selectBot("sales")); await wait(3000);
    const inSales = await p.evaluate(() => document.querySelector("#chat").innerText.includes("Stays in support"));
    await p.evaluate(() => selectBot("support")); await wait(100);
    const inSupport = await p.evaluate(() => document.querySelector("#chat").innerText.includes("Stays in support"));
    C.ok("late answer filed under the bot that was asked", inSupport && !inSales, `sales:${inSales} support:${inSupport}`);
    await c.close(); }

  // G-12 queued suggestion, draft preserved
  { const c = await stubCtx(); const p = await c.newPage(); await p.goto(B + "/"); await p.waitForSelector("#enterBtn");
    await p.evaluate(() => { document.getElementById("enterBtn").click(); window.__delay = 900; window.__replies.push("First [S1].", "Second [S1]."); const i = document.getElementById("input"); i.value = "first question"; document.getElementById("send").click(); });
    await wait(200);
    const draft = await p.evaluate(() => { const i = document.getElementById("input"); i.value = "draft I was typing"; document.querySelector("#trybox .trychip").click(); return i.value; });
    C.ok("draft not overwritten by a suggestion while busy", draft === "draft I was typing", draft);
    await wait(3200);
    const turns = await p.evaluate(() => [...document.querySelectorAll("#chat .row.user .bubble")].map(b => b.textContent));
    C.ok("queued suggestion sent after the pending reply", turns.length === 2 && /refund/i.test(turns[1]), turns.join(" | "));
    await c.close(); }

  // G-05 claim guard: 20 phantom flagged, 20 legitimate untouched, no card without intent
  { let flagged = 0, cards = 0, legitFlagged = 0;
    const run = async (t, q) => { const c = await stubCtx(); const p = await c.newPage(); await p.goto(B + "/"); await p.waitForSelector("#enterBtn");
      const r = await p.evaluate(async ([t, q]) => { document.getElementById("enterBtn").click(); window.__replies.push(t); const i = document.getElementById("input"); i.value = q; document.getElementById("send").click(); await new Promise(r => setTimeout(r, 500)); return { claim: !!document.querySelector("#chat .tagb.claim"), card: !!document.querySelector("#chat .ticket") }; }, [t, q]); await c.close(); return r; };
    for (const t of PHANTOM) { const r = await run(t, "help me with my account"); if (r.claim) flagged++; if (r.card) cards++; }
    for (const t of LEGIT) { const r = await run(t, "how does this work?"); if (r.claim) legitFlagged++; }
    C.ok("all 20 phantom action claims flagged", flagged === 20, `${flagged}/20`);
    C.ok("no ticket card without escalation intent", cards === 0, `${cards}`);
    C.ok("0 of 20 legitimate answers flagged", legitFlagged === 0, `${legitFlagged}/20`); }

  // G-07 phone layout: chat in the first screen, no overflow; both themes render
  for (const scheme of ["dark", "light"]) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme }); const p = await c.newPage(); await p.goto(B + "/"); await p.waitForSelector("#enterBtn");
    if (scheme === "light") await p.evaluate(() => { document.getElementById("modeBtn") && localStorage.setItem("g-mode", "light"); document.documentElement.setAttribute("data-mode", "light"); });
    await p.evaluate(() => document.getElementById("enterBtn").click()); await wait(500);
    const m = await p.evaluate(() => { const r = document.querySelector(".chatcard").getBoundingClientRect(); return { chatTop: Math.round(r.top), h: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 2, tips: document.getElementById("tips") ? getComputedStyle(document.getElementById("tips")).display : "none" }; });
    C.ok(`phone ${scheme}: chat visible in the first screen`, m.chatTop < m.h, `chat top ${m.chatTop} of ${m.h}`);
    C.ok(`phone ${scheme}: no horizontal overflow`, !m.overflow);
    C.ok(`phone ${scheme}: tips popup hidden`, m.tips === "none");
    await p.screenshot({ path: path.join(ROOT, "dist", `phone-${scheme}.png`) }).catch(() => {});
    await c.close(); }
  { const c = await realCtx(); const p = await c.newPage(); await p.goto(B + "/"); await p.waitForSelector("#enterBtn"); await p.screenshot({ path: path.join(ROOT, "dist", "desktop-dark-cover.png") }).catch(() => {}); await p.evaluate(() => document.getElementById("enterBtn").click()); await wait(500); await p.screenshot({ path: path.join(ROOT, "dist", "desktop-dark.png") }).catch(() => {});
    await p.evaluate(() => { localStorage.setItem("g-mode", "light"); document.documentElement.setAttribute("data-mode", "light"); }); await wait(200); await p.screenshot({ path: path.join(ROOT, "dist", "desktop-light.png") }).catch(() => {}); await c.close(); }

  // ---- v3.1, audit 2026-11-26 (Phase 0, Gate A) ----
  const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
  const axeSerious = async p => { await p.addScriptTag({ content: AXE }); return p.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"], resultTypes: ["violations"] })).violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "(" + v.nodes.length + ")")); };
  for (const mode of ["dark", "light"]) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 860 }, bypassCSP: true }); await c.addInitScript(m => { try { localStorage.setItem("g-mode", m); } catch (e) {} }, mode);
    const p = await c.newPage(); await p.goto(B + "/"); await p.waitForSelector("#enterBtn"); await wait(400);
    let v = await axeSerious(p); C.ok(`N-11/N-23 axe: no serious issues on the intro (${mode})`, v.length === 0, v.join(", "));
    // N-12: Tab never leaves the intro while it shows
    let escaped = 0; for (let i = 0; i < 12; i++) { await p.keyboard.press("Tab"); if (await p.evaluate(() => { const a = document.activeElement; return !!(a && a !== document.body && !a.closest("#cover")); })) escaped++; }
    C.ok(`N-12 keyboard focus stays in the intro (${mode})`, escaped === 0, `${escaped} of 12 Tab presses landed behind it`);
    await p.click("#enterBtn"); await wait(700);
    C.ok(`N-12 page is interactive after entering, intro inert (${mode})`, await p.evaluate(() => !document.getElementById("app").inert && document.getElementById("cover").inert));
    await p.fill("#input", "What is your refund policy?"); await p.click("#send"); await wait(1500);
    for (const view of ["chat", "kb", "xray", "tested"]) {
      if (view !== "chat") { await p.click(`#viewseg button[data-view="${view}"]`); await wait(400); }
      if (view === "xray") { await p.fill("#xq", "my slack notifications stopped"); await p.click("#xgo"); await wait(900); }
      v = await axeSerious(p); C.ok(`N-11/N-23 axe: no serious issues in ${view} (${mode})`, v.length === 0, v.join(", "));
      if (view === "chat") {
        C.ok(`N-03 privacy note visible under the composer (${mode})`, await p.evaluate(() => { const e = document.getElementById("privacy"); return !!e && e.offsetHeight > 0 && /Gemini/.test(e.textContent); }));
        // N-12: the source drawer takes focus and gives it back
        const d = await p.evaluate(async () => { const cite = document.querySelector("#chat .cite"); cite.focus(); cite.click(); await new Promise(r => setTimeout(r, 120));
          const dr = document.getElementById("drawer"); const inside = dr.contains(document.activeElement); const appInert = document.getElementById("app").inert;
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await new Promise(r => setTimeout(r, 60));
          return { inside, appInert, role: dr.getAttribute("role"), label: document.getElementById("dClose").getAttribute("aria-label"), back: document.activeElement === cite, closedInert: dr.inert }; });
        C.ok(`N-12 drawer is a labelled dialog that takes focus (${mode})`, d.role === "dialog" && d.inside && d.appInert && !!d.label, JSON.stringify(d));
        C.ok(`N-12 closing the drawer returns focus to the citation (${mode})`, d.back && d.closedInert);
      }
    }
    await c.close(); }
  // N-17: a citation list such as [S1, S2] becomes two source buttons
  { const c = await stubCtx(); const p = await c.newPage(); await p.goto(B + "/"); await p.waitForSelector("#enterBtn");
    const n = await p.evaluate(async () => { document.getElementById("enterBtn").click(); window.__replies.push("Refunds take 14 days [S1, S2] and invoices are monthly [S3]."); const i = document.getElementById("input"); i.value = "refund policy and invoices?"; document.getElementById("send").click(); await new Promise(r => setTimeout(r, 900));
      const b = document.querySelector("#chat .row.bot:last-of-type .bubble"); return { cites: b.querySelectorAll(".cite").length, raw: /\[S\d/.test(b.textContent) }; });
    C.ok("N-17 [S1, S2] renders as two citation buttons, no raw markers", n.cites === 3 && !n.raw, JSON.stringify(n));
    await c.close(); }
  // N-19: the intro's animation stops once the visitor is in
  { const c = await realCtx(); const p = await c.newPage(); await p.goto(B + "/"); await p.waitForSelector("#enterBtn"); await p.click("#enterBtn"); await wait(700);
    const flips = await p.evaluate(() => new Promise(res => { let n = 0; const mo = new MutationObserver(m => n += m.length); document.querySelectorAll("#pipe .ps").forEach(x => mo.observe(x, { attributes: true })); setTimeout(() => { mo.disconnect(); res(n); }, 2200); }));
    C.ok("N-19 intro animation stops after entering", flips === 0, `${flips} class changes in 2.2 s`);
    await c.close(); }
  // N-14: phones keep the composer in the first screen; every control is at least 44 px
  for (const vp of [{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 360, height: 740 }]) {
    const c = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, bypassCSP: true }); const p = await c.newPage(); await p.goto(B + "/"); await p.waitForSelector("#enterBtn"); await p.click("#enterBtn"); await wait(600);
    const m = await p.evaluate(() => { const r = document.getElementById("composer").getBoundingClientRect();
      const small = [...document.querySelectorAll("button,a,input,textarea,select,[role=button],summary")].filter(e => { const b = e.getBoundingClientRect(); return b.width && b.height && (b.width < 44 || b.height < 44) && e.offsetParent && !e.closest("#cover,[inert]") && !e.classList.contains("cite"); }).map(e => e.id || e.className || e.tagName);
      return { bottom: Math.round(r.bottom), h: innerHeight, small, overflow: document.documentElement.scrollWidth > innerWidth }; });
    C.ok(`N-14 ${vp.width}x${vp.height}: composer fully in the first screen`, m.bottom <= m.h, `bottom ${m.bottom} of ${m.h}`);
    C.ok(`N-14 ${vp.width}x${vp.height}: no control under 44 px`, m.small.length === 0, m.small.slice(0, 6).join(", "));
    C.ok(`N-14 ${vp.width}x${vp.height}: no horizontal overflow`, !m.overflow);
    if (vp.width === 375) { const v = await axeSerious(p); C.ok("N-11/N-23 axe: no serious issues on a phone", v.length === 0, v.join(", ")); }
    await c.close(); }
  await browser.close();
} else {
  console.log("(Chromium unavailable: running the jsdom subset; layout and CSP checks skipped)");
  let JSDOM = null; try { ({ JSDOM } = await import("jsdom")); } catch { try { ({ JSDOM } = await import(pathToFileURL(path.join(ROOT, "node_modules/jsdom/lib/api.js")).href)); } catch { } }
  if (!JSDOM) { console.log("(jsdom unavailable too: UI gate skipped; install devDependencies)"); H.close(); C.done(); }
  const html = (await import("node:fs")).readFileSync(path.join(ROOT, "backend/public/index.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://nimbus-ai-demos.vercel.app/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w) { w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder; w.__replies = []; w.cowork = { askClaude: async () => w.__replies.shift() ?? "Default stub answer [S1]." }; w.fetch = async () => { throw new Error("no network in jsdom"); }; } });
  await wait(100); const d = dom.window.document;
  C.ok(`tested page has all ${NFIND} findings`, d.querySelectorAll("#testedview .find").length === NFIND);
  C.ok("credentials card present", /owner@acme-co\.example/.test(d.body.textContent));
  C.ok("version stamp present", !!d.getElementById("version"));
}
H.close(); C.done();
