// backend/lib/limits.mjs: the fair-use limiter shared by the API functions (Node only, per warm instance).
//
// Audit N-01 (2026-11-26): the v3.0 limiter raised the instance-wide daily counter before the per-IP
// check, so one client's REJECTED requests spent everyone's budget and locked the demo for up to a
// day. This limiter checks the caller first and counts only accepted requests:
//   1. per-IP window (e.g. 20 per 5 minutes): a rejected request spends nothing;
//   2. per-IP daily share (e.g. 120 per day): one address can never take the whole daily budget;
//   3. instance-wide daily budget (e.g. 600 per day): the provider spend ceiling.
// It logs one line when the daily budget passes 80% and when it runs out, so the drain is visible in
// the Vercel logs. The edge rule (Vercel WAF rate limiting, see DEPLOY-GUIDE.md) sits in front of it.
export function makeLimiter({ name, windowMs, perIp, perIpDay, perDay, dayMs = 24 * 60 * 60 * 1000, maxKeys = 5000 }) {
  const win = new Map(); const daily = new Map();
  let day = { start: Date.now(), n: 0, warned: 0 };
  function check(ip, now = Date.now()) {
    if (now - day.start > dayMs) { day = { start: now, n: 0, warned: 0 }; daily.clear(); }
    let w = win.get(ip);
    if (w && now - w.t > windowMs) { win.delete(ip); w = null; }
    if (w && w.n >= perIp) return { ok: false, reason: "ip" };
    const d = daily.get(ip) || 0;
    if (perIpDay && d >= perIpDay) return { ok: false, reason: "ip-day" };
    if (day.n >= perDay) return { ok: false, reason: "day" };
    // accepted: only now does anything count
    if (!w) { if (win.size >= maxKeys) win.clear(); win.set(ip, { t: now, n: 1 }); } else w.n++;
    if (daily.size >= maxKeys) daily.clear();
    daily.set(ip, d + 1);
    day.n++;
    if (day.n >= perDay && day.warned < 2) { day.warned = 2; console.warn(`[grounded] ${name}: daily budget exhausted on this instance (${day.n}/${perDay})`); }
    else if (day.n >= Math.ceil(perDay * 0.8) && day.warned < 1) { day.warned = 1; console.warn(`[grounded] ${name}: daily budget past 80% on this instance (${day.n}/${perDay})`); }
    return { ok: true };
  }
  return { check, stats: () => ({ name, dayCount: day.n, perDay, ips: win.size }) };
}
