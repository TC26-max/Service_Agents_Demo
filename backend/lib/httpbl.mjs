// backend/lib/httpbl.mjs (v3.4, audit 2026-11-26, Phase 3): an optional abuse signal from Project Honey Pot.
//
// http:BL is a DNS lookup (https://www.projecthoneypot.org/httpbl_api.php): query
// <access-key>.<reversed IPv4>.dnsbl.httpbl.org and an A record 127.<days>.<threat>.<type> comes back for
// addresses the network has seen; no record means not listed. <type> is a bitmask (1 suspicious,
// 2 harvester, 4 comment spammer); 0 means a search engine, whose third octet is then an engine id, not a
// threat score. A listed, recent, non-search-engine address with a threat score at or above the threshold
// gets tighter limits; nothing is ever blocked outright on this signal alone.
//
// Off unless HTTPBL_KEY holds a 12-letter access key (kept in the environment, never committed). IPv4 only.
// Results are cached per warm instance for an hour; a lookup never waits more than 400 ms.
import dns from "node:dns";

const CACHE = new Map(); const TTL = 3600e3, MAX = 5000;
export function httpblEnabled(key = process.env.HTTPBL_KEY) { return typeof key === "string" && /^[a-z]{12}$/.test(key); }

export async function reputation(ip, { key = process.env.HTTPBL_KEY, threshold = +(process.env.HTTPBL_THRESHOLD || 25), maxDays = 30,
  resolve4 = dns.promises.resolve4, now = Date.now(), timeoutMs = 400 } = {}) {
  if (!httpblEnabled(key)) return { checked: false, reason: "off" };
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(ip || ""))) return { checked: false, reason: "not IPv4" };
  const hit = CACHE.get(ip); if (hit && now - hit.at < TTL) return hit.result;
  const q = `${key}.${ip.split(".").reverse().join(".")}.dnsbl.httpbl.org`; let result;
  try {
    const rec = await Promise.race([resolve4(q), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), timeoutMs))]);
    const [a, days, threat, type] = String(rec[0] || "").split(".").map(Number);
    if (a !== 127) result = { checked: true, listed: false };
    else result = { checked: true, listed: true, days, threat, type, suspicious: type !== 0 && threat >= threshold && days <= maxDays };
  } catch (e) {
    result = (e && (e.code === "ENOTFOUND" || e.code === "ENODATA")) ? { checked: true, listed: false } : { checked: false, reason: "lookup failed" };
  }
  if (result.checked) { if (CACHE.size >= MAX) CACHE.delete(CACHE.keys().next().value); CACHE.set(ip, { at: now, result }); }
  return result;
}
export function _clearHttpblCache() { CACHE.clear(); }
