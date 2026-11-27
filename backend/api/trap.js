// api/trap.js (v3.4, audit 2026-11-26, Phase 3): a honeypot. vercel.json rewrites a few paths that only
// scanners ask for (/wp-login.php, /.env, /xmlrpc.php, /phpmyadmin, /wp-admin) to this function. It answers
// exactly like any missing page (the site's 404) and logs one line with the path family and nothing else:
// no address, no headers, no body. The count of those lines in the platform logs is the signal.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const PAGE = (() => { for (const p of [path.join(DIR, "..", "public", "404.html"), path.join(process.cwd(), "public", "404.html"), path.join(process.cwd(), "backend", "public", "404.html")]) { try { if (fs.existsSync(p)) return fs.readFileSync(p, "utf8"); } catch (e) {} } return "<!DOCTYPE html><title>Not found</title><p>Not found.</p>"; })();
const FAMILIES = new Set(["wp-login", "wp-admin", "xmlrpc", "env", "phpmyadmin"]);
export default function handler(req, res) {
  let from = "other"; try { const f = new URL(req.url, "http://x").searchParams.get("from") || ""; if (FAMILIES.has(f)) from = f; } catch (e) {}
  console.log("[grounded] trap " + JSON.stringify({ from }));
  res.statusCode = 404; res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
  res.end(req.method === "HEAD" ? "" : PAGE);
}
