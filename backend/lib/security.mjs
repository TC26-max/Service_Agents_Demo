// backend/lib/security.mjs: client IP resolution, request-body parsing, and the short-lived demo token (Node only).
import crypto from "node:crypto";

// Vercel sets x-real-ip on every request; that is the only header the limiter trusts by default.
// x-forwarded-for is client-writable, so it is used only when TRUST_XFF=1 (last hop, the one the
// platform appends). Without a trusted header every caller shares one bucket, which fails closed
// (audit G-16: a rotating header must never rotate the limiter).
export function clientIp(req) {
  const real = req.headers["x-real-ip"]; if (real) return String(real).trim();
  if (process.env.TRUST_XFF === "1") {
    const xff = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return "shared";
}

// Audit N-18: a malformed body is the client's mistake, not a model outage. Returns the parsed object,
// or null when the body is not valid JSON. On Vercel, reading req.body can itself throw for bad JSON.
export function readJsonBody(req) {
  try {
    const b = req.body;
    if (b == null || b === "") return {};
    if (typeof b === "string") return JSON.parse(b);
    if (Buffer.isBuffer(b)) return b.length ? JSON.parse(b.toString("utf8")) : {};
    return typeof b === "object" ? b : null;
  } catch (e) { return null; }
}

// Demo token: HMAC of a timestamp. Issued by GET /api/health, required by /api/transcribe. It is not
// authentication (anyone can fetch it); it stops the voice endpoint from being scripted as a free
// speech-to-text service without first loading the demo, and it expires in 15 minutes (audit G-20).
// Audit N-22: the secret is TOKEN_SECRET, a value that rotates on its own. Until it is set, the
// v3.0 derivation from the provider key keeps existing deployments working.
const TOKEN_TTL_MS = 15 * 60 * 1000;
function secret() {
  if (process.env.TOKEN_SECRET) return crypto.createHash("sha256").update("grounded-token:" + process.env.TOKEN_SECRET).digest();
  return crypto.createHash("sha256").update("grounded-demo:" + (process.env.API_KEY || process.env.GEMINI_API_KEY || "no-key")).digest();
}
// Labelled keys for other HMAC uses (v3.2: signed chat history), derived from the same secret.
export function keyFor(label) { return crypto.createHmac("sha256", secret()).update("grounded-key:" + label).digest(); }
export function issueToken(now = Date.now()) {
  const ts = String(now); const sig = crypto.createHmac("sha256", secret()).update(ts).digest("hex").slice(0, 32);
  return ts + "." + sig;
}
// Audit N-07: timingSafeEqual throws when the lengths differ, and the caller ran this outside its
// try/catch, so a malformed token crashed the function (500). Any malformed token is now just false.
export function verifyToken(token, now = Date.now()) {
  try {
    if (typeof token !== "string" || token.length > 64) return false;
    const [ts, sig] = token.split("."); if (!ts || !sig || !/^\d{1,16}$/.test(ts) || !/^[0-9a-f]{32}$/.test(sig)) return false;
    if (Math.abs(now - Number(ts)) > TOKEN_TTL_MS) return false;
    const expect = crypto.createHmac("sha256", secret()).update(ts).digest("hex").slice(0, 32);
    const a = Buffer.from(sig, "utf8"), b = Buffer.from(expect, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}
