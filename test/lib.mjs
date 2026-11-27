// test/lib.mjs: shared eval helper. Starts a local HTTP server that serves backend/public/ (the only
// static root, as on Vercel with outputDirectory "public") and mounts the REAL api handlers behind a
// Vercel-style shim with the upstream provider mocked (deterministic, meaning-correlated embeddings).
// Also launches headless Chromium when Playwright is available.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
import { pathToFileURL, fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BACKEND = path.join(ROOT, "backend");
export const PUBLIC = path.join(BACKEND, "public");

export class Check {
  constructor(name) { this.name = name; this.pass = 0; this.fail = 0; this.log = []; }
  ok(label, cond, evidence = "") { if (cond) this.pass++; else { this.fail++; this.log.push(label + (evidence ? "  [" + evidence + "]" : "")); } }
  done() { console.log(`${this.name}: ${this.pass} passed, ${this.fail} failed`); for (const l of this.log) console.log("  FAIL " + l); process.exit(this.fail ? 1 : 0); }
}

export async function startHarness({ port = 8811, env = {} } = {}) {
  Object.assign(process.env, { PROVIDER: "gemini", API_KEY: "AIzaTESTKEY000000000000000", CHAT_MODEL: "gemini-2.5-flash" }, env);
  process.chdir(BACKEND);
  const capture = []; const mode = { upstream401: false, streamFail: false, reply: null };
  const vec = t => { const s = String(t).toLowerCase(); return [s.includes("refund") ? 1 : 0.05, s.includes("slack") ? 1 : 0.05, s.includes("password") ? 1 : 0.05, s.includes("hipaa") ? 1 : 0.05, s.includes("export") ? 1 : 0.05, 1]; };
  globalThis.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    if (String(url).includes("/embeddings")) { const inp = body.input; return { ok: true, json: async () => ({ data: (Array.isArray(inp) ? inp : [inp]).map(t => ({ embedding: vec(t) })) }) }; }
    if (String(url).includes("/chat/completions")) {
      capture.push({ stream: !!body.stream, model: body.model, messages: body.messages });
      if (mode.upstream401) return { ok: false, status: 401, text: async () => '{"error":{"message":"API key not valid. key=AIzaTESTKEY000000000000000","status":"UNAUTHENTICATED"}}' };
      const lastUser = [...body.messages].reverse().find(m => m.role === "user")?.content || "";
      const m = /\[\[reply:(.*?)\]\]/s.exec(lastUser); const sys = body.messages[0].content;
      const ticket = (sys.match(/NIM-\d{5}/) || ["NIM-00000"])[0];
      const canary = (sys.match(/ARENA-[A-Z0-9]{4}-[A-Z0-9]{4}/) || ["ARENA-0000-0000"])[0]; // v3.4: the arena's per-attempt canary
      const reply = (mode.reply || (m ? m[1] : "Paid plans are refundable within 14 days of a charge [S1].")).replace("{TICKET}", ticket).split("{CANARY}").join(canary).split("{CANARY_B64}").join(Buffer.from(canary).toString("base64")).split("{CANARY_REV}").join([...canary].reverse().join(""));
      if (body.stream) {
        if (mode.streamFail) return { ok: false, status: 500, text: async () => "stream unavailable", body: null };
        const enc = new TextEncoder(); const parts = reply.match(/.{1,12}/gs) || [reply];
        const chunks = [...parts.map(p => "data: " + JSON.stringify({ choices: [{ delta: { content: p } }] }) + "\n\n"), "data: [DONE]\n\n"];
        return new Response(new ReadableStream({ start(c) { chunks.forEach(x => c.enqueue(enc.encode(x))); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) };
    }
    if (String(url).includes("generateContent")) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "hello world" }] } }] }) };
    throw new Error("unmocked upstream " + url);
  };
  const { default: chat } = await import(pathToFileURL(path.join(BACKEND, "api/chat.js")).href);
  const { default: transcribe } = await import(pathToFileURL(path.join(BACKEND, "api/transcribe.js")).href);
  const { default: health } = await import(pathToFileURL(path.join(BACKEND, "api/health.js")).href);
  const { default: cspReport } = await import(pathToFileURL(path.join(BACKEND, "api/csp-report.js")).href);
  const { default: arena } = await import(pathToFileURL(path.join(BACKEND, "api/arena.js")).href);
  const { default: trap } = await import(pathToFileURL(path.join(BACKEND, "api/trap.js")).href);
  const ROUTES = { "/api/chat": chat, "/api/transcribe": transcribe, "/api/health": health, "/api/csp-report": cspReport, "/api/arena": arena, "/api/trap": trap };
  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".xml": "application/xml", ".woff2": "font/woff2" };
  // v3.3: text is served compressed when the browser asks, as the platform does, so Lighthouse sees realistic bytes
  const ZCACHE = new Map(); const TEXTY = /^(text\/|application\/(json|xml)|image\/svg)/;
  const sendStatic = (req, res, f, type) => { const buf = fs.readFileSync(f); const ae = String(req.headers["accept-encoding"] || "");
    res.setHeader("Content-Type", type); if (!TEXTY.test(type) || !/\b(br|gzip)\b/.test(ae)) return res.end(buf);
    const enc = /\bbr\b/.test(ae) ? "br" : "gzip", key = f + ":" + enc + ":" + fs.statSync(f).mtimeMs;
    if (!ZCACHE.has(key)) ZCACHE.set(key, enc === "br" ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }) : zlib.gzipSync(buf, { level: 9 }));
    res.setHeader("Content-Encoding", enc); res.setHeader("Vary", "Accept-Encoding"); return res.end(ZCACHE.get(key)); };
  const vcfg = JSON.parse(fs.readFileSync(path.join(BACKEND, "vercel.json"), "utf8"));
  const headers = vcfg.headers?.[0]?.headers || []; const apiHeaders = (vcfg.headers || []).find(h => h.source === "/api/(.*)")?.headers || [];
  const STATIC_ROOT = path.join(BACKEND, vcfg.outputDirectory || ".");
  const server = http.createServer(async (req, res) => {
    for (const h of headers) res.setHeader(h.key, h.value); // serve under the exact deploy headers (CSP included)
    let u = new URL(req.url, "http://x");
    // v3.4: the deploy's rewrites apply here too (the honeypot paths land in /api/trap)
    const rw = (vcfg.rewrites || []).find(r => new RegExp("^" + r.source.replace(/[.]/g, "\\.").replace(/\/:\w+\*/g, "(?:/.*)?") + "$").test(u.pathname));
    if (rw) { u = new URL(rw.destination, "http://x"); req.url = u.pathname + u.search; }
    res.status = c => { res.statusCode = c; return res; }; res.json = o => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith("/api/")) {
      for (const h of apiHeaders) res.setHeader(h.key, h.value);
      let raw = ""; for await (const ch of req) raw += ch; try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
      try { const fn = ROUTES[u.pathname]; if (fn) await fn(req, res); else { res.statusCode = 404; res.end(); } }
      catch (e) { res.statusCode = 500; res.end("handler threw: " + e.message); }
      return;
    }
    if (u.pathname.startsWith("/_vercel/insights/")) { res.setHeader("Content-Type", "text/javascript"); return res.end("/* analytics stub for local gates */"); }
    const p = u.pathname === "/" ? "/index.html" : decodeURIComponent(u.pathname); const f = path.join(STATIC_ROOT, p);
    if (f.startsWith(STATIC_ROOT + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return sendStatic(req, res, f, MIME[path.extname(f)] || "application/octet-stream");
    const nf = path.join(STATIC_ROOT, "404.html"); res.statusCode = 404;
    if (fs.existsSync(nf)) return sendStatic(req, res, nf, MIME[".html"]);
    res.end("not found");
  });
  await new Promise(r => server.listen(port, r));
  const base = `http://localhost:${port}`;
  const raw = (url, opts = {}) => new Promise((resolve, reject) => { const u = new URL(url); const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || "GET", headers: opts.headers || {} }, res => { let b = ""; res.on("data", d => b += d); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: async () => b, json: async () => JSON.parse(b) })); }); r.on("error", reject); if (opts.body) r.write(opts.body); r.end(); });
  // ordinary test requests carry the platform IP header the limiter trusts (x-real-ip); tests that
  // exercise the client-writable header build their own request with raw()
  const post = (body, ip = "10.0.0.1", extra = {}) => raw(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip, ...extra }, body: JSON.stringify(body) });
  return { base, capture, mode, post, raw, close: () => server.close() };
}

export async function launchBrowser() {
  let pw = null;
  try { pw = await import("playwright"); } catch { try { pw = await import(pathToFileURL(path.join(ROOT, "node_modules/playwright/index.mjs")).href); } catch { return null; } }
  try { return await pw.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-proxy-server"] }); } catch (e) { console.log("(playwright present but Chromium failed to launch: " + String(e.message).slice(0, 120) + ")"); return null; }
}
export const STUB_INIT = () => { window.__replies = []; window.__calls = []; window.cowork = { askClaude: async p => { window.__calls.push(p); const d = window.__delay || 0; if (d) await new Promise(r => setTimeout(r, d)); if (/SUPPORTED or UNSUPPORTED/.test(p)) return "SUPPORTED"; return window.__replies.shift() ?? "Default stub answer [S1]."; } }; };
export const wait = ms => new Promise(r => setTimeout(r, ms));
