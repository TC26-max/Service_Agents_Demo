// backend/lib/security.mjs: client IP resolution and the short-lived demo token (Node only).
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

// Demo token: HMAC of a timestamp with a secret derived from the deployment key. Issued by
// GET /api/health, required by /api/transcribe. It is not authentication (anyone can fetch it);
// it stops the voice endpoint from being scripted as a free speech-to-text service without first
// loading the demo, and it expires in 15 minutes (audit G-20).
const TOKEN_TTL_MS = 15 * 60 * 1000;
function secret() { return crypto.createHash("sha256").update("grounded-demo:" + (process.env.API_KEY || process.env.GEMINI_API_KEY || "no-key")).digest(); }
export function issueToken(now = Date.now()) {
  const ts = String(now); const sig = crypto.createHmac("sha256", secret()).update(ts).digest("hex").slice(0, 32);
  return ts + "." + sig;
}
export function verifyToken(token, now = Date.now()) {
  if (typeof token !== "string") return false;
  const [ts, sig] = token.split("."); if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(now - Number(ts)) > TOKEN_TTL_MS) return false;
  const expect = crypto.createHmac("sha256", secret()).update(ts).digest("hex").slice(0, 32);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
}
