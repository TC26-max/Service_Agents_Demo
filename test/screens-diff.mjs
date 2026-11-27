#!/usr/bin/env node
// test/screens-diff.mjs: compares two folders of screens from test/screens.mjs (usually the base branch and
// the pull request, captured on the same runner) and writes diff images plus a Markdown table. It informs a
// reviewer; it does not fail the build, because a visual change can be the point of the pull request.
// Usage: node test/screens-diff.mjs <before> <after> <outdir>
import fs from "node:fs"; import path from "node:path"; import { PNG } from "pngjs"; import pixelmatch from "pixelmatch";
const [before, after, outArg] = process.argv.slice(2); const out = path.resolve(outArg || "dist/screens-diff"); fs.mkdirSync(out, { recursive: true });
const names = [...new Set([...fs.readdirSync(before), ...fs.readdirSync(after)])].filter(n => n.endsWith(".png")).sort();
const rows = ["| Screen | Changed pixels | Note |", "|---|---|---|"];
for (const n of names) {
  const a = path.join(before, n), b = path.join(after, n);
  if (!fs.existsSync(a)) { rows.push(`| ${n} | new | only in the pull request |`); continue; }
  if (!fs.existsSync(b)) { rows.push(`| ${n} | removed | only on the base branch |`); continue; }
  const A = PNG.sync.read(fs.readFileSync(a)), Bm = PNG.sync.read(fs.readFileSync(b));
  if (A.width !== Bm.width || A.height !== Bm.height) { rows.push(`| ${n} | size changed | ${A.width}x${A.height} to ${Bm.width}x${Bm.height} |`); continue; }
  const D = new PNG({ width: A.width, height: A.height }); const px = pixelmatch(A.data, Bm.data, D.data, A.width, A.height, { threshold: 0.1 });
  const pct = (100 * px / (A.width * A.height)).toFixed(2); if (px) fs.writeFileSync(path.join(out, n.replace(/\.png$/, "-diff.png")), PNG.sync.write(D));
  rows.push(`| ${n} | ${pct}% | ${px ? "diff image attached" : "identical"} |`);
}
const md = "## Screenshot diff (base branch to pull request)\n\n" + rows.join("\n") + "\n";
fs.writeFileSync(path.join(out, "summary.md"), md); console.log(md);
